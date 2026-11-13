import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const requestUrl = moduleUrl(await readFile(new URL("../src/lib/order-request.ts", import.meta.url), "utf8"));
const { runOrderRequest, ORDER_REQUEST_TIMEOUT_MS, ORDER_REQUEST_TIMEOUT_MESSAGE } = await import(requestUrl);
const fastRequestUrl = moduleUrl(`import {runOrderRequest as run} from ${JSON.stringify(requestUrl)};
  export const runOrderRequest = operation => run(operation, 25);`);
const clientKey = Symbol.for("los-chanchitos.order-request-test-client");
const clientUrl = moduleUrl(`export const createClient = () => globalThis[Symbol.for("los-chanchitos.order-request-test-client")]();`);
const apiSource = (await readFile(new URL("../src/lib/orders-api.ts", import.meta.url), "utf8"))
  .replace('"./supabase/client"', JSON.stringify(clientUrl))
  .replace('"./order-request"', JSON.stringify(fastRequestUrl));
const api = await import(moduleUrl(apiSource));
after(() => { delete globalThis[clientKey]; });

const pending = () => new Promise(() => {});
const row = { id: "qa-order", number: 6, version: 1, type: "takeaway", table_label: null,
  status: "draft", total: 25, notes: "QA local", created_at: "2026-10-19T18:00:00Z", paid_at: null,
  items: [{ product_id: "tacos", name: "Tacos", quantity: 1, unit_price: 25 }], payments: [] };
const draft = { orderId: row.id, version: 0, notes: row.notes, lines: [{ id: "tacos", name: "Tacos", price: 1, quantity: 1 }] };
const calls = [];
function client(fetchHandler, accessToken = async () => null) {
  const sdk = createClient("https://qa.invalid", "public-test-key", {
    accessToken, auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return fetchHandler(input, init);
    } },
  });
  globalThis[clientKey] = () => sdk;
  calls.length = 0;
}
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

test("el límite de producción es 15 segundos", () => {
  assert.equal(ORDER_REQUEST_TIMEOUT_MS, 15000);
});

test("el plazo predeterminado vence a los 15 segundos con reloj controlado", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const task = runOrderRequest(s => { signal = s; return pending(); });
  const rejected = assert.rejects(task, { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  await Promise.resolve();
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("una respuesta normal conserva el resultado y no aborta después", async () => {
  let signal;
  assert.equal(await runOrderRequest((s) => { signal = s; return Promise.resolve(55); }, 10), 55);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test("un bloqueo previo al HTTP termina por tiempo y aborta la señal", async () => {
  let signal;
  await assert.rejects(runOrderRequest((s) => { signal = s; return pending(); }, 10), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  assert.equal(signal.aborted, true);
});

test("una respuesta tardía no sustituye el error ni ejecuta el éxito", async () => {
  let finish, applied = false;
  const task = runOrderRequest(() => new Promise(resolve => { finish = resolve; }), 10).then(() => { applied = true; });
  await assert.rejects(task, { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  finish(25);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(applied, false);
});

test("una excepción inmediata se conserva y libera el temporizador", async () => {
  await assert.rejects(runOrderRequest(() => { throw new Error("fallo local"); }, 10), /fallo local/);
});

test("el aviso de tiempo gana aunque abortar rechace la operación", async () => {
  await assert.rejects(runOrderRequest(signal => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
  }), 10), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
});

test("listar, guardar, cobrar y cancelar usan señal y conservan sus parámetros", async () => {
  client((input) => Promise.resolve(ok(String(input).endsWith("list_pos_orders") ? [row] : row)));
  assert.equal((await api.listOrders([]))[0].total, 25);
  assert.equal((await api.saveOrder(draft, "Para llevar", "save-token", [])).total, 25);
  await api.payOrder(api.fromDatabaseOrder(row, []), [{ method: "cash", amount: 25 }], "pay-token", []);
  await api.cancelOrder({ ...draft, version: 1 }, "Prueba técnica");
  assert.equal(calls.length, 4);
  for (const { init } of calls) assert.equal(init.signal.aborted, false);
  const saved = JSON.parse(calls[1].init.body), paid = JSON.parse(calls[2].init.body);
  assert.deepEqual(saved.p_items, [{ product_id: "tacos", quantity: 1 }]); // No confía en el precio del navegador.
  assert.equal(saved.p_request_id, "save-token");
  assert.equal(paid.p_request_id, "pay-token");
});

test("el SDK devuelve conflicto viejo y el API lo muestra sin reintento", async () => {
  client(() => Promise.resolve(new Response(JSON.stringify({ message: "ORDER_CHANGED", code: "PT409" }), { status: 409 })));
  await assert.rejects(api.saveOrder(draft, "Mesa 1", "save-token", []), /Otra persona modificó/);
  assert.equal(calls.length, 1);
});

test("las cuatro operaciones recuperan el control si el transporte no responde", async () => {
  client(pending);
  const operations = [() => api.listOrders([]), () => api.saveOrder(draft, "Para llevar", "save-token", []),
    () => api.payOrder(api.fromDatabaseOrder(row, []), [{ method: "cash", amount: 25 }], "pay-token", []),
    () => api.cancelOrder(draft, "Prueba técnica")];
  for (const operation of operations) await assert.rejects(operation(), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  assert.equal(calls.length, 4); // No reenvío automático.
  for (const { init } of calls) assert.equal(init.signal.aborted, true);
});

test("un bloqueo al obtener sesión también termina, antes de enviar HTTP", async () => {
  client(() => { throw new Error("No debería llegar a HTTP"); }, pending);
  await assert.rejects(api.saveOrder(draft, "Para llevar", "save-token", []), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  assert.equal(calls.length, 0);
});

test("también limita la espera del cuerpo de una respuesta HTTP", async () => {
  client(() => Promise.resolve({ ok: true, status: 200, statusText: "OK", headers: new Headers(), text: pending }));
  await assert.rejects(api.listOrders([]), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  assert.equal(calls[0].init.signal.aborted, true);
});

test("el fallo de una petición no impide una posterior con señal nueva", async () => {
  client(() => Promise.reject(new TypeError("Failed to fetch")));
  await assert.rejects(api.saveOrder(draft, "Para llevar", "save-token", []), /No pudimos confirmar/);
  const failedSignal = calls[0].init.signal;
  client(() => Promise.resolve(ok(row)));
  assert.equal((await api.saveOrder(draft, "Para llevar", "save-token", [])).total, 25);
  assert.notEqual(calls[0].init.signal, failedSignal);
  assert.equal(calls[0].init.signal.aborted, false);
});

test("reintentar tras respuesta perdida conserva identificador y no repite solo", async () => {
  client(pending);
  await assert.rejects(api.saveOrder(draft, "Para llevar", "same-request", []), { message: ORDER_REQUEST_TIMEOUT_MESSAGE });
  const first = JSON.parse(calls[0].init.body);
  client(() => Promise.resolve(ok(row)));
  assert.equal((await api.saveOrder(draft, "Para llevar", "same-request", [])).number, "0006");
  assert.deepEqual(JSON.parse(calls[0].init.body), first);
  assert.equal(calls.length, 1);
});
