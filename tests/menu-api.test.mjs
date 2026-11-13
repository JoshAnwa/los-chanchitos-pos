import test, {after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
const url=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`;
const requestUrl=url(await readFile(new URL("../src/lib/order-request.ts",import.meta.url),"utf8"));
const fastUrl=url(`import {runOrderRequest as run} from ${JSON.stringify(requestUrl)};export {ORDER_REQUEST_TIMEOUT_MESSAGE} from ${JSON.stringify(requestUrl)};export const runOrderRequest=operation=>run(operation,25);`);
const pureUrl=url(await readFile(new URL("../src/lib/menu-management.ts",import.meta.url),"utf8"));
const clientUrl=url('export const createClient=()=>globalThis[Symbol.for("menu-test-client")]();');
const source=(await readFile(new URL("../src/lib/menu-api.ts",import.meta.url),"utf8")).replace('"./supabase/client"',JSON.stringify(clientUrl)).replace('"./order-request"',JSON.stringify(fastUrl)).replace('"./menu-management"',JSON.stringify(pureUrl));
const api=await import(url(source)),key=Symbol.for("menu-test-client"),calls=[];
after(()=>{delete globalThis[key];});
function client(handler,accessToken=async()=>null){const sdk=createClient("https://qa.invalid","test-public-key",{accessToken,auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{calls.push({url:String(input),init});return handler(input,init);}}});globalThis[key]=()=>sdk;calls.length=0;}
const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
const input={name:" Tacos ",category:" Antojitos ",description:" QA ",price:"25.50",active:true,reason:" Autorizado "};
test("menú API: usa sólo RPC y parámetros autorizados, con señal y precio decimal",async()=>{
  client(()=>Promise.resolve(ok({})));
  await api.getMenuDashboard();await api.getPosMenu();await api.saveMenuProduct("product",2,"same-intent",input);
  assert.deepEqual(calls.map(c=>c.url.split("/").at(-1)),["get_menu_dashboard","list_pos_products","save_menu_product"]);
  assert.deepEqual(JSON.parse(calls[2].init.body),{p_id:"product",p_version:2,p_request_id:"same-intent",p_name:"Tacos",p_category:"Antojitos",p_description:"QA",p_price:25.5,p_is_active:true,p_reason:"Autorizado"});
  assert.ok(calls.every(c=>!c.init.signal.aborted));
});
test("menú API: conflicto no se reintenta automáticamente ni oculta el motivo",async()=>{
  client(()=>Promise.resolve(new Response(JSON.stringify({code:"PT409",message:"PRODUCT_CHANGED"}),{status:409})));
  await assert.rejects(api.saveMenuProduct("product",2,"same-intent",input),/Otra persona/);assert.equal(calls.length,1);
});
test("menú API: respuesta perdida aborta y permite reintento idéntico sin cambiar solicitud",async()=>{
  client(()=>new Promise(()=>{}));await assert.rejects(api.saveMenuProduct("product",2,"same-intent",input),/Puede haberse guardado/);
  assert.equal(calls.length,1);assert.equal(calls[0].init.signal.aborted,true);const first=JSON.parse(calls[0].init.body);
  client(()=>Promise.resolve(ok({id:"product"})));await api.saveMenuProduct("product",2,"same-intent",input);assert.deepEqual(JSON.parse(calls[0].init.body),first);
});
test("menú API: sesión bloqueada también devuelve el control sin enviar la operación",async()=>{
  client(()=>{throw new Error("No enviar HTTP");},()=>new Promise(()=>{}));await assert.rejects(api.getMenuDashboard(),/Puede haberse guardado/);assert.equal(calls.length,0);
});
