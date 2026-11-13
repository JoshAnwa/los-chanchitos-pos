import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { buildSetupSql } from "../scripts/supabase-setup.mjs";

const db=new PGlite(),branch="11111111-1111-1111-1111-111111111111";
const owner=randomUUID(),cashier=randomUUID(),outsider=randomUUID(),inactive=randomUUID();
let taco;
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec((await buildSetupSql()).replace("create extension if not exists pgcrypto;",""));
  for(const id of [owner,cashier,outsider,inactive]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,id+"@test.invalid"]);
  await db.query("update public.profiles set is_active=true,branch_id=$1,role='owner' where id=$2",[branch,owner]);
  await db.query("update public.profiles set is_active=true,branch_id=$1 where id=$2",[branch,cashier]);
  const other=randomUUID();
  await db.query("insert into public.branches(id,name) values($1,'Otra')",[other]);
  await db.query("update public.profiles set is_active=true,branch_id=$1,role='owner' where id=$2",[other,outsider]);
  taco=(await db.query("select id from public.products where name='Tacos'")).rows[0].id;
});
after(()=>db.close());
async function staff(user,sql,params=[],role="authenticated") {
  return db.transaction(async tx=>{
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user??""]);
    return (await tx.query(sql,params)).rows[0]?.result;
  });
}
const open=(id,amount=100,user=owner)=>staff(user,"select public.open_cash_session($1,$2) as result",[id,amount]);
const close=(id,amount,count=0,notes="QA",user=owner)=>staff(user,"select public.close_cash_session($1,$2,$3,$4) as result",[id,amount,count,notes]);
const dashboard=(user=owner)=>staff(user,"select public.get_cash_dashboard() as result");
async function order(quantity=1) {
  const id=randomUUID();
  await staff(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'QA caja local') as result",
    [id,randomUUID(),JSON.stringify([{product_id:taco,quantity}])]);
  return id;
}
const pay=(id,payments=[{method:"cash",amount:25}],request=randomUUID())=>staff(cashier,
  "select public.pay_pos_order($1,1,$2,$3) as result",[id,request,JSON.stringify(payments)]);

test("caja: niega invitados, inactivos, Cajero y escrituras directas",async()=>{
  await assert.rejects(dashboard(cashier),/OWNER_REQUIRED/);
  await assert.rejects(dashboard(inactive),/STAFF_REQUIRED/);
  await assert.rejects(open(randomUUID(),0,cashier),/OWNER_REQUIRED/);
  await assert.rejects(close(randomUUID(),0,0,"",cashier),/OWNER_REQUIRED/);
  await assert.rejects(staff(null,"select public.get_cash_dashboard() as result",[],"anon"),/permission denied/);
  for(const sql of ["insert into public.cash_register_sessions(branch_id,opened_by,opening_amount) values(gen_random_uuid(),gen_random_uuid(),0)",
    "update public.cash_register_sessions set opening_amount=0", "delete from public.cash_register_sessions"]) {
    await assert.rejects(staff(owner,sql),/permission denied/);
  }
});

test("caja: valida importes exactos sin crear aperturas inválidas",async()=>{
  for(const amount of [null,-1,0.001,100000000,"NaN","Infinity"]) await assert.rejects(open(randomUUID(),amount),/INVALID_CASH_AMOUNT/);
  assert.equal((await dashboard()).current,null);
});

test("caja: abrir y reintentar no duplica ni cambia el fondo",async()=>{
  const id=randomUUID();
  const first=await open(id,100);
  assert.equal(first.opening_amount,100); assert.equal(first.expected_amount,100); assert.equal(first.sales_count,0);
  assert.equal((await open(id,100)).id,id);
  await assert.rejects(open(id,101),{message:"CASH_REQUEST_CHANGED",code:"PT409"});
  await assert.rejects(open(randomUUID(),100),{message:"CASH_ALREADY_OPEN",code:"PT409"});
  assert.equal((await staff(cashier,"select public.get_pos_cash_status() as result")).open,true);
  assert.equal((await db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[cashier]);return tx.query("select * from public.cash_register_sessions");})).rows.length,0);
  await close(id,100);
});

test("caja: no cobra sin apertura y el error no deja pagos ni tickets",async()=>{
  const id=await order();
  await assert.rejects(pay(id),/CASH_REQUIRED/);
  for(const table of ["payments","tickets"]) assert.equal((await db.query(`select count(*)::int as n from public.${table} where order_id=$1`,[id])).rows[0].n,0);
  assert.equal((await db.query("select status from public.orders where id=$1",[id])).rows[0].status,"draft");
});

test("caja: corte mixto suma sólo efectivo al fondo y conserva un pago por reintento",async()=>{
  const session=randomUUID(); await open(session,100);
  const id=await order(4),request=randomUUID();
  const payments=[{method:"cash",amount:40},{method:"card",amount:35},{method:"transfer",amount:25}];
  await pay(id,payments,request); await pay(id,payments,request);
  const current=(await dashboard()).current;
  assert.equal(current.sales_count,1); assert.equal(current.total_sales,100); assert.equal(current.expected_amount,140);
  assert.equal(current.cash_sales,40); assert.equal(current.card_sales,35); assert.equal(current.transfer_sales,25);
  const closed=await close(session,135,1,"Faltan cinco pesos");
  assert.equal(closed.difference,-5); assert.equal(closed.status,"closed"); assert.equal(closed.closing_amount,135);
  assert.equal((await close(session,135,1,"Faltan cinco pesos")).id,session);
  await assert.rejects(close(session,140,1,"Corregir"),{message:"CASH_CLOSED",code:"PT409"});
  assert.equal((await open(session,100)).status,"closed");
  // Incluso tras el cierre se puede confirmar un reintento idéntico ya guardado.
  assert.equal((await pay(id,payments,request)).status,"paid");
  assert.equal((await db.query("select count(*)::int as n from public.payments where order_id=$1",[id])).rows[0].n,3);
});

test("caja: un cobro nuevo obliga a revisar el corte sin cerrar con datos viejos",async()=>{
  const session=randomUUID(); await open(session,0);
  const initial=(await dashboard()).current;
  await pay(await order());
  await assert.rejects(close(session,25,initial.sales_count),{message:"CASH_CHANGED",code:"PT409"});
  assert.equal((await dashboard()).current.id,session);
  assert.equal((await close(session,30,1)).difference,5);
});

test("caja: rechaza conteos y notas inválidos sin cerrar ni alterar el fondo",async()=>{
  const session=randomUUID(); await open(session,20);
  for(const amount of [null,-1,0.001,100000000,"NaN"]) await assert.rejects(close(session,amount),/INVALID_CASH_AMOUNT/);
  await assert.rejects(close(session,20,null),/INVALID_CASH_AMOUNT/);
  await assert.rejects(close(session,20,0,"x".repeat(301)),/INVALID_CASH_AMOUNT/);
  assert.equal((await dashboard()).current.expected_amount,20);
  await close(session,20);
});

test("caja: mantiene pedidos pendientes y no mezcla turnos o ventas antiguas",async()=>{
  const session=randomUUID(),pending=await order(); await open(session,20);
  const current=(await dashboard()).current;
  assert.equal(current.total_sales,0); assert.equal(current.expected_amount,20); assert.equal(current.sales_count,0);
  await close(session,20);
  assert.equal((await db.query("select status,cash_session_id from public.orders where id=$1",[pending])).rows[0].status,"draft");
  const next=randomUUID(); await open(next,0); await pay(pending);
  assert.equal((await db.query("select cash_session_id from public.orders where id=$1",[pending])).rows[0].cash_session_id,next);
  assert.equal((await dashboard()).current.expected_amount,25);
  assert.equal((await close(next,25,1)).difference,0);
});

test("caja: otra sucursal no puede consultar ni cerrar turnos ajenos",async()=>{
  const session=randomUUID(); await open(session,10);
  assert.equal((await dashboard(outsider)).current,null);
  await assert.rejects(close(session,10,0,"QA",outsider),/CASH_NOT_FOUND/);
  await assert.rejects(open(session,10,outsider),/CASH_NOT_FOUND/);
  assert.equal((await dashboard()).current.id,session);
  await close(session,10);
});

test("caja: reaplicar migración conserva cortes y permisos, sin abrir otra caja",async()=>{
  const beforeRows=(await db.query("select * from public.cash_register_sessions order by id")).rows;
  const functions=["public.get_cash_dashboard()","public.get_pos_cash_status()","public.open_cash_session(uuid,numeric)","public.close_cash_session(uuid,numeric,integer,text)","public.pay_pos_order(uuid,integer,uuid,jsonb)"];
  const permissions=()=>db.query("select oid::regprocedure::text,proowner,proacl::text,proconfig,prosecdef from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text",[functions]);
  const beforePermissions=(await permissions()).rows;
  await db.exec(await readFile(new URL("../supabase/migrations/202610210004_cash_register.sql",import.meta.url),"utf8"));
  assert.deepEqual((await db.query("select * from public.cash_register_sessions order by id")).rows,beforeRows);
  assert.deepEqual((await permissions()).rows,beforePermissions);
});

const pureSource=await readFile(new URL("../src/lib/cash.ts",import.meta.url),"utf8");
const pureJs=ts.transpileModule(pureSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {cashAmount,cashError}=await import(`data:text/javascript;base64,${Buffer.from(pureJs).toString("base64")}`);
test("caja: el formulario rechaza vacíos, negativos, exponentes, NaN y más de dos decimales",()=>{
  for(const value of [""," ","-1","1.001","1e3","NaN","Infinity","100000000","1,50"]) assert.equal(cashAmount(value),null);
  for(const [value,expected] of [["0",0],["100",100],["100.50",100.5],["99999999.99",99999999.99]]) assert.equal(cashAmount(value),expected);
  assert.match(cashError({message:"CASH_CHANGED"}),/nuevos cobros/);
  assert.match(cashError({message:"OWNER_REQUIRED",code:"42501"}),/Dueño/);
});
