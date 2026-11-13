import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`;
const requestUrl=moduleUrl(await readFile(new URL("../src/lib/order-request.ts",import.meta.url),"utf8"));
const fastRequestUrl=moduleUrl(`import {runOrderRequest as run} from ${JSON.stringify(requestUrl)};
  export {ORDER_REQUEST_TIMEOUT_MESSAGE} from ${JSON.stringify(requestUrl)};
  export const runOrderRequest=operation=>run(operation,25);`);
const pureUrl=moduleUrl(await readFile(new URL("../src/lib/cash.ts",import.meta.url),"utf8"));
const key=Symbol.for("los-chanchitos.cash-test-client");
const clientUrl=moduleUrl(`export const createClient=()=>globalThis[Symbol.for("los-chanchitos.cash-test-client")]();`);
const source=(await readFile(new URL("../src/lib/cash-api.ts",import.meta.url),"utf8"))
  .replace('"./supabase/client"',JSON.stringify(clientUrl)).replace('"./order-request"',JSON.stringify(fastRequestUrl)).replace('"./cash"',JSON.stringify(pureUrl));
const api=await import(moduleUrl(source));
after(()=>{delete globalThis[key];});
const calls=[];
function client(handler,accessToken=async()=>null){
  const sdk=createClient("https://qa.invalid","public-test-key",{accessToken,auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
    global:{fetch:async(input,init)=>{calls.push({url:String(input),init});return handler(input,init);}}});
  globalThis[key]=()=>sdk; calls.length=0;
}
const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
const session={id:"test-session",sales_count:2};

test("caja API: consulta y operaciones usan los RPC y argumentos exactos con señal",async()=>{
  client(()=>Promise.resolve(ok({open:true})));
  await api.getCashStatus(); await api.getCashDashboard(); await api.openCash("intent-1",100); await api.closeCash(session,140,"QA");
  assert.deepEqual(calls.map(call=>call.url.split("/").at(-1)),["get_pos_cash_status","get_cash_dashboard","open_cash_session","close_cash_session"]);
  assert.deepEqual(JSON.parse(calls[2].init.body),{p_id:"intent-1",p_opening_amount:100});
  assert.deepEqual(JSON.parse(calls[3].init.body),{p_id:"test-session",p_closing_amount:140,p_sales_count:2,p_notes:"QA"});
  for(const call of calls) assert.equal(call.init.signal.aborted,false);
});
test("caja API: un conflicto de cierre se muestra sin repetir automáticamente",async()=>{
  client(()=>Promise.resolve(new Response(JSON.stringify({message:"CASH_CHANGED",code:"PT409"}),{status:409})));
  await assert.rejects(api.closeCash(session,140,"QA"),/nuevos cobros/);
  assert.equal(calls.length,1);
});
test("caja API: tiempo agotado aborta sin declarar el corte cancelado y conserva el intento",async()=>{
  client(()=>new Promise(()=>{}));
  await assert.rejects(api.openCash("same-intent",100),/Puede haberse guardado/);
  assert.equal(calls.length,1); assert.equal(calls[0].init.signal.aborted,true);
  const first=JSON.parse(calls[0].init.body);
  client(()=>Promise.resolve(ok({id:"same-intent",status:"open"})));
  await api.openCash("same-intent",100);
  assert.deepEqual(JSON.parse(calls[0].init.body),first);
});
test("caja API: también limita la espera por sesión antes de enviar HTTP",async()=>{
  client(()=>{throw new Error("No debe enviar HTTP");},()=>new Promise(()=>{}));
  await assert.rejects(api.getCashDashboard(),/Puede haberse guardado/);
  assert.equal(calls.length,0);
});
