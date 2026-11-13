import test,{after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
const url=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`;
const requestUrl=url(await readFile(new URL("../src/lib/order-request.ts",import.meta.url),"utf8"));
const fastUrl=url(`import {runOrderRequest as run} from ${JSON.stringify(requestUrl)};export {ORDER_REQUEST_TIMEOUT_MESSAGE} from ${JSON.stringify(requestUrl)};export const runOrderRequest=operation=>run(operation,25);`);
const pureUrl=url(await readFile(new URL("../src/lib/owner-data.ts",import.meta.url),"utf8"));
const clientUrl=url('export const createClient=()=>globalThis[Symbol.for("owner-test-client")]();');
const source=(await readFile(new URL("../src/lib/owner-api.ts",import.meta.url),"utf8")).replace('"./supabase/client"',JSON.stringify(clientUrl)).replace('"./order-request"',JSON.stringify(fastUrl)).replace('"./owner-data"',JSON.stringify(pureUrl));
const api=await import(url(source)),key=Symbol.for("owner-test-client"),calls=[];
after(()=>{delete globalThis[key];});
function client(handler,accessToken=async()=>null){const sdk=createClient("https://qa.invalid","test-public-key",{accessToken,auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{calls.push({url:String(input),init});return handler(input,init);}}});globalThis[key]=()=>sdk;calls.length=0;}
const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
test("Dueño API: usa RPC exactos y señal sin escrituras directas",async()=>{
 client(()=>Promise.resolve(ok({})));await api.getInventory();await api.getBusiness();await api.getSales("2026-10-01","2026-10-26");await api.changeInventory("count","ingredient",3,"same-intent",{quantity:2,reason:"QA"});
 assert.deepEqual(calls.map(c=>c.url.split("/").at(-1)),["get_inventory_dashboard","get_business_settings","get_sales_report","inventory_action"]);
 assert.deepEqual(JSON.parse(calls[2].init.body),{p_from:"2026-10-01",p_to:"2026-10-26"});assert.deepEqual(JSON.parse(calls[3].init.body),{p_action:"count",p_id:"ingredient",p_version:3,p_request_id:"same-intent",p_data:{quantity:2,reason:"QA"}});assert.ok(calls.every(c=>!c.init.signal.aborted));
});
test("Dueño API: bloqueo de versión no se repite automáticamente",async()=>{client(()=>Promise.resolve(new Response(JSON.stringify({message:"INVENTORY_CHANGED",code:"PT409"}),{status:409})));await assert.rejects(api.changeInventory("count","i",1,"same",{quantity:2}),/otro equipo/);assert.equal(calls.length,1);});
test("Dueño API: conexión perdida aborta y reintenta sólo con la misma solicitud",async()=>{client(()=>new Promise(()=>{}));await assert.rejects(api.changeInventory("purchase","p",0,"same",{items:[]}),/Puede haberse guardado/);assert.equal(calls.length,1);assert.equal(calls[0].init.signal.aborted,true);const previous=JSON.parse(calls[0].init.body);client(()=>Promise.resolve(ok({ok:true})));await api.changeInventory("purchase","p",0,"same",{items:[]});assert.deepEqual(JSON.parse(calls[0].init.body),previous);});
test("Dueño API: espera de sesión y cuerpo HTTP tienen límite",async()=>{client(()=>{throw new Error("No HTTP");},()=>new Promise(()=>{}));await assert.rejects(api.getInventory(),/Puede haberse guardado/);assert.equal(calls.length,0);client(()=>Promise.resolve({ok:true,status:200,statusText:"OK",headers:new Headers(),text:()=>new Promise(()=>{})}));await assert.rejects(api.getSales("2026-10-01","2026-10-26"),/Puede haberse guardado/);assert.equal(calls.length,1);});
test("Dueño API: actualización faltante se explica sin mostrar error técnico",async()=>{client(()=>Promise.resolve(new Response(JSON.stringify({message:"missing function",code:"PGRST202"}),{status:404})));await assert.rejects(api.getInventory(),/Falta activar/);});
