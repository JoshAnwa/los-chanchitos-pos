import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import ts from "typescript";
import {buildSetupSql} from "../scripts/supabase-setup.mjs";
const db=new PGlite(),branch="11111111-1111-1111-1111-111111111111",owner=randomUUID(),cashier=randomUUID(),inactive=randomUUID(),outsider=randomUUID();
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec((await buildSetupSql()).replace("create extension if not exists pgcrypto;",""));
 for(const id of [owner,cashier,inactive,outsider])await db.query("insert into auth.users(id,email) values($1,$2)",[id,id+"@test.invalid"]);
 await db.query("update public.profiles set is_active=true,branch_id=$1,role='owner' where id=$2",[branch,owner]);
 await db.query("update public.profiles set is_active=true,branch_id=$1 where id=$2",[branch,cashier]);
 const other=randomUUID();await db.query("insert into public.branches(id,name) values($1,'Otra')",[other]);await db.query("update public.profiles set is_active=true,role='owner',branch_id=$1 where id=$2",[other,outsider]);
});after(()=>db.close());
async function staff(user,sql,args=[],role="authenticated"){return db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user??""]);return(await tx.query(sql,args)).rows;});}
const action=(kind,id,version,data,request=randomUUID(),user=owner)=>staff(user,"select public.inventory_action($1,$2,$3,$4,$5) as result",[kind,id,version,request,JSON.stringify(data)]).then(r=>r[0].result);
const dashboard=(user=owner)=>staff(user,"select public.get_inventory_dashboard() as result").then(r=>r[0].result);
const get=async id=>(await db.query("select * from public.ingredients where id=$1",[id])).rows[0];
async function ingredient(){const id=randomUUID();await action("ingredient",id,0,{name:"QA "+id,unit:"kg",minimum:1,active:true});return id;}
const count=async(id,quantity,reason="QA conteo")=>action("count",id,(await get(id)).version,{quantity,reason});
const recipe=(id,items,enabled=true,version=1,request=randomUUID())=>action("recipe",id,version,{enabled,items},request);
async function product(){const id=randomUUID();await db.query("insert into public.products(id,branch_id,name,category,price) values($1,$2,$3,'QA',10)",[id,branch,"QA "+id]);return id;}
async function saveOrder(id){const order=randomUUID();return(await staff(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'QA inventario local') as result",[order,randomUUID(),JSON.stringify([{product_id:id,quantity:1}])]))[0].result;}
const pay=(order,request=randomUUID())=>staff(cashier,"select public.pay_pos_order($1,1,$2,'[{\"method\":\"cash\",\"amount\":10}]') as result",[order.id,request]).then(r=>r[0].result);
const report=(from,to,user=owner)=>staff(user,"select public.get_sales_report($1,$2) as result",[from,to]).then(r=>r[0].result);

test("inventario: instalación vacía, sin recetas ni existencias inventadas",async()=>{const d=await dashboard();assert.equal(d.ingredients.length,0);assert.equal(d.purchases.length,0);assert.equal(d.movements.length,0);assert.ok(d.products.every(p=>!p.inventory_enabled&&!p.recipe.length));});
test("inventario: Cajero, invitado e inactivo no administran ni escriben en tablas",async()=>{
 await assert.rejects(dashboard(cashier),/OWNER_REQUIRED/);await assert.rejects(dashboard(inactive),/STAFF_REQUIRED/);
 await assert.rejects(staff(null,"select public.get_inventory_dashboard()",[],"anon"),/permission denied/);
 await assert.rejects(action("ingredient",randomUUID(),0,{name:"QA",unit:"kg",minimum:0,active:true},randomUUID(),cashier),/OWNER_REQUIRED/);
 for(const sql of ["update public.ingredients set current_stock=100","delete from public.product_recipes","delete from public.inventory_actions","update public.branches set name='Ajeno'","insert into public.purchases(branch_id,received_by) values(gen_random_uuid(),gen_random_uuid())"])
  await assert.rejects(staff(owner,sql),/permission denied/);
});
test("inventario: alta idempotente, nombres normalizados únicos y unidades fijas",async()=>{
 const id=randomUUID(),request=randomUUID(),data={name:"QA único "+id,unit:"kg",minimum:0,active:true};await action("ingredient",id,0,data,request);await action("ingredient",id,0,data,request);
 assert.equal(Number((await get(id)).current_stock),0);assert.equal((await db.query("select count(*)::int as n from public.inventory_actions where request_id=$1",[request])).rows[0].n,1);
 await assert.rejects(action("ingredient",randomUUID(),0,{...data,name:"  "+data.name.toUpperCase()+"  "}),{code:"23505"});
 await assert.rejects(action("ingredient",id,1,{...data,unit:"g"}),/UNIT_LOCKED/);
 await assert.rejects(action("ingredient",id,0,{...data,name:"Cambio"}),{code:"PT409",message:"INVENTORY_CHANGED"});
 await assert.rejects(action("ingredient",id,0,{...data,minimum:2},request),/INVENTORY_REQUEST_CHANGED/);
});
test("inventario: rechaza datos inválidos sin dejar altas parciales",async()=>{
 const base={name:"QA",unit:"kg",minimum:0,active:true};
 for(const patch of [{name:" "},{name:"x".repeat(81)},{name:"a\nb"},{unit:"toneladas"},{minimum:-1},{minimum:1.0001},{minimum:"1"},{active:"true"},{active:null}]) await assert.rejects(action("ingredient",randomUUID(),0,{...base,...patch}),/INVALID_INVENTORY_DATA/);
});
test("inventario: conteo reemplaza cantidad, exige motivo y no duplica movimientos",async()=>{
 const id=await ingredient();await count(id,3);const request=randomUUID();await action("count",id,2,{quantity:2,reason:"QA merma"},request);await action("count",id,2,{quantity:2,reason:"QA merma"},request);
 assert.equal(Number((await get(id)).current_stock),2);
 const rows=(await db.query("select quantity from public.inventory_movements where ingredient_id=$1 order by created_at,id",[id])).rows;assert.deepEqual(rows.map(r=>Number(r.quantity)),[3,-1]);
 await assert.rejects(count(id,-1),/INVALID_INVENTORY_DATA/);await assert.rejects(count(id,2),/INVENTORY_NO_CHANGE/);await assert.rejects(count(id,4,""),/INVENTORY_REASON_REQUIRED/);
});
test("inventario: compra con varias partidas suma una sola vez y guarda total/costo",async()=>{
 const a=await ingredient(),b=await ingredient(),id=randomUUID(),request=randomUUID(),data={supplier:"Proveedor QA",reference:"QA-001",notes:"Compra local",items:[{ingredient_id:a,quantity:2,unit_cost:100},{ingredient_id:b,quantity:1.5,unit_cost:20}]};
 await action("purchase",id,0,data,request);await action("purchase",id,0,data,request);
 assert.equal(Number((await get(a)).current_stock),2);assert.equal(Number((await get(a)).average_cost),100);assert.equal(Number((await get(b)).current_stock),1.5);
 assert.equal(Number((await db.query("select total from public.purchases where id=$1",[id])).rows[0].total),230);
 assert.equal((await db.query("select count(*)::int as n from public.purchase_items where purchase_id=$1",[id])).rows[0].n,2);
 await assert.rejects(action("purchase",id,0,{...data,notes:"Otro"},request),/INVENTORY_REQUEST_CHANGED/);
});
test("inventario: compra inválida revierte todas las cantidades y registros",async()=>{
 const id=await ingredient(),purchase=randomUUID(),before=await get(id);
 for(const items of [[],[{ingredient_id:id,quantity:0,unit_cost:1}],[{ingredient_id:id,quantity:1,unit_cost:-1}],[{ingredient_id:id,quantity:1.0001,unit_cost:1}],[{ingredient_id:id,quantity:1,unit_cost:1.00001}],[{ingredient_id:id,quantity:1,unit_cost:1},{ingredient_id:randomUUID(),quantity:1,unit_cost:1}],[{ingredient_id:id,quantity:1,unit_cost:1},{ingredient_id:id,quantity:1,unit_cost:1}]]) await assert.rejects(action("purchase",purchase,0,{items}));
 assert.deepEqual(await get(id),before);assert.equal((await db.query("select count(*)::int as n from public.purchases where id=$1",[purchase])).rows[0].n,0);
});
test("inventario: receta valida ingredientes, no permite cantidades cero, duplicados ni versiones viejas",async()=>{
 const p=await product(),i=await ingredient();await recipe(p,[{ingredient_id:i,quantity:.15}]);
 await assert.rejects(recipe(p,[{ingredient_id:i,quantity:.2}],true,1),/INVENTORY_CHANGED/);
 for(const items of [[],[{ingredient_id:i,quantity:0}],[{ingredient_id:i,quantity:.0001}],[{ingredient_id:i,quantity:1},{ingredient_id:i,quantity:1}]])await assert.rejects(recipe(p,items,true,2),/INVALID_INVENTORY_DATA/);
 assert.equal((await dashboard()).products.find(r=>r.id===p).recipe[0].quantity,.15);
 await assert.rejects(action("ingredient",i,1,{name:"Ingrediente usado",unit:"kg",minimum:0,active:false}),/INGREDIENT_IN_USE/);
});
test("inventario: aisla sucursales al consultar, comprar, contar y configurar recetas",async()=>{
 const i=await ingredient(),p=await product();assert.equal((await dashboard(outsider)).ingredients.length,0);
 await assert.rejects(action("count",i,1,{quantity:10,reason:"QA ajeno"},randomUUID(),outsider),/INVENTORY_NOT_FOUND/);
 await assert.rejects(action("purchase",randomUUID(),0,{items:[{ingredient_id:i,quantity:1,unit_cost:1}]},randomUUID(),outsider),/INVENTORY_NOT_FOUND/);
 await assert.rejects(action("recipe",p,1,{enabled:true,items:[{ingredient_id:i,quantity:1}]},randomUUID(),outsider),/INVENTORY_NOT_FOUND/);
 assert.equal((await staff(cashier,"select * from public.inventory_actions")).length,0);
});
test("inventario: cobrar descuenta receta una sola vez, conserva stock no negativo y actor",async()=>{
 const p=await product(),i=await ingredient();await count(i,2);await recipe(p,[{ingredient_id:i,quantity:.5}]);
 await staff(owner,"select public.open_cash_session($1,0)",[randomUUID()]);const order=await saveOrder(p),request=randomUUID();await pay(order,request);await pay(order,request);
 assert.equal(Number((await get(i)).current_stock),1.5);assert.equal((await get(i)).version,3);
 const moves=(await db.query("select * from public.inventory_movements where order_id=$1",[order.id])).rows;assert.equal(moves.length,1);assert.equal(moves[0].created_by,cashier);assert.equal(Number(moves[0].quantity),-.5);
});
test("inventario: falta de ingrediente revierte cobro, ticket y todos los descuentos",async()=>{
 const p=await product(),a=await ingredient(),b=await ingredient();await count(a,1);await recipe(p,[{ingredient_id:a,quantity:.5},{ingredient_id:b,quantity:.5}]);const order=await saveOrder(p);
 await assert.rejects(pay(order),/STOCK_INSUFFICIENT/);assert.equal(Number((await get(a)).current_stock),1);assert.equal(Number((await get(b)).current_stock),0);
 for(const table of ["payments","tickets","inventory_movements"])assert.equal((await db.query(`select count(*)::int as n from public.${table} where order_id=$1`,[order.id])).rows[0].n,0);
 assert.equal((await db.query("select status from public.orders where id=$1",[order.id])).rows[0].status,"draft");
});
test("inventario: venta sin control no requiere recetas ni inventario ficticio",async()=>{const p=await product(),order=await saveOrder(p);assert.equal((await pay(order)).total,10);assert.equal((await db.query("select count(*)::int as n from public.inventory_movements where order_id=$1",[order.id])).rows[0].n,0);});
test("inventario: venta cambia versión y bloquea un conteo iniciado con cantidades viejas",async()=>{const p=await product(),i=await ingredient();await count(i,1);const version=(await get(i)).version;await recipe(p,[{ingredient_id:i,quantity:.2}]);await pay(await saveOrder(p));await assert.rejects(action("count",i,version,{quantity:1,reason:"QA desactualizado"}),/INVENTORY_CHANGED/);assert.equal(Number((await get(i)).current_stock),.8);});
test("inventario: reaplicar migración no activa recetas apagadas ni cambia datos",async()=>{
 const p=await product(),i=await ingredient();await recipe(p,[{ingredient_id:i,quantity:.1}],false);
 const tables=["products","ingredients","product_recipes","inventory_actions","inventory_movements","purchases","purchase_items","orders","payments"];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`select to_jsonb(t) as data from public.${t} t order by to_jsonb(t)::text`)).rows])));
 const before=await snapshot();await db.exec(await readFile(new URL("../supabase/migrations/202610260006_self_service_inventory.sql",import.meta.url),"utf8"));assert.deepEqual(await snapshot(),before);
});
test("negocio: sólo Dueño cambia datos con versión, reintentos y aislamiento",async()=>{
 const sql="select public.get_business_settings() as result",before=(await staff(cashier,sql))[0].result;assert.equal(before.id,branch);
 const req=randomUUID(),payload={name:"Local QA",address:"Dirección QA"};await action("business",branch,1,payload,req);await action("business",branch,1,payload,req);
 assert.equal((await staff(owner,sql))[0].result.version,2);await assert.rejects(action("business",branch,1,{name:"Viejo"}),/INVENTORY_CHANGED/);
 await assert.rejects(action("business",branch,2,payload,randomUUID(),cashier),/OWNER_REQUIRED/);await assert.rejects(action("business",branch,2,payload,randomUUID(),outsider),/INVENTORY_NOT_FOUND/);
});
test("ventas: sólo Dueño, rango válido y totales exactos sin duplicar partidas",async()=>{
 const r=await report("2020-01-01","2020-01-02");assert.equal(r.count,0);assert.equal(r.total,0);assert.deepEqual(r.methods,[]);
 await assert.rejects(report(null,null),/INVALID_REPORT_RANGE/);await assert.rejects(report("2026-01-02","2026-01-01"),/INVALID_REPORT_RANGE/);await assert.rejects(report("2020-01-01","2026-01-01"),/INVALID_REPORT_RANGE/);await assert.rejects(report("2026-01-01","2026-01-02",cashier),/OWNER_REQUIRED/);
 const day=(await db.query("select (now() at time zone 'America/Mexico_City')::date::text as day")).rows[0].day,result=await report(day,day);
 const expected=Number((await db.query("select sum(total) as total from public.orders where branch_id=$1 and status='paid'",[branch])).rows[0].total);
 assert.equal(result.total,expected);assert.equal(result.methods.reduce((s,m)=>s+m.amount,0),expected);assert.equal(result.products.reduce((s,p)=>s+p.amount,0),expected);
 assert.equal((await report(day,day,outsider)).total,0);
});
const source=await readFile(new URL("../src/lib/owner-data.ts",import.meta.url),"utf8"),pure=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`);
test("inventario: validación del formulario evita decimales inválidos y fecha usa México",()=>{for(const value of ["","-1","NaN","1e3","1,5","1.0001"])assert.equal(pure.exactNumber(value),null);assert.equal(pure.exactNumber("0"),0);assert.equal(pure.exactNumber("0.125"),.125);assert.equal(pure.exactNumber("1.1234",4),1.1234);assert.equal(pure.localDay(new Date("2026-10-26T02:00:00Z")),"2026-10-25");assert.match(pure.ownerError({message:"UNIT_LOCKED"}),/unidad/);});
