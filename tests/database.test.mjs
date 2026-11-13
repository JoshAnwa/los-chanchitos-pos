import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// PostgreSQL local en memoria para probar SQL/RLS sin cuenta de pago ni Docker.
// Auth se simula con los mismos roles y auth.uid(); no reemplaza la prueba remota de Supabase Auth.
const db = new PGlite();
const branch = "11111111-1111-1111-1111-111111111111";
const owner = randomUUID(), cashier = randomUUID(), outsider = randomUUID(), inactive = randomUUID();
let taco;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  const initial = await readFile(new URL("../supabase/migrations/202610170001_initial_schema.sql", import.meta.url), "utf8");
  // gen_random_uuid está integrado en PostgreSQL; pgcrypto sólo es una extensión opcional en este motor de pruebas.
  await db.exec(initial.replace("create extension if not exists pgcrypto;", ""));
  await db.exec(await readFile(new URL("../supabase/migrations/202610180002_staff_orders.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202610190003_order_conflict_http.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202610210004_cash_register.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
  for (const [id, email] of [[owner,"owner@test.invalid"],[cashier,"cashier@test.invalid"],[outsider,"other@test.invalid"],[inactive,"inactive@test.invalid"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id,email,JSON.stringify({user_role:"owner",role:"owner",is_active:true})]);
  }
  await db.query("update public.profiles set branch_id=$1,is_active=true,role='owner' where id=$2",[branch,owner]);
  await db.query("update public.profiles set branch_id=$1,is_active=true where id=$2",[branch,cashier]);
  const otherBranch=randomUUID();
  await db.query("insert into public.branches(id,name) values($1,'Otra sucursal')",[otherBranch]);
  await db.query("update public.profiles set branch_id=$1,is_active=true,role='owner' where id=$2",[otherBranch,outsider]);
  taco=(await db.query("select id from public.products where name='Tacos'")).rows[0].id;
  await db.query("insert into public.cash_register_sessions(branch_id,opened_by,opening_amount) values($1,$2,100)",[branch,owner]);
});
after(() => db.close());

async function asUser(user, sql, params=[], role="authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user ?? ""]);
    return tx.query(sql,params);
  });
}
const save = (user,id,version=0,quantity=2,request=randomUUID(),table=null) => asUser(user,
  "select public.save_pos_order($1,$2,$3,$4,$5,$6,$7) as result",
  [id,version,request,table ? "table" : "takeaway",table,JSON.stringify([{product_id:taco,quantity}]),"Sin cebolla"]);
const pay = (user,id,version,request,amount=50) => asUser(user,
  "select public.pay_pos_order($1,$2,$3,$4) as result",[id,version,request,JSON.stringify([{method:"cash",amount}])]);

test("Auth nuevo queda inactivo aunque intente asignarse owner en sus metadatos", async () => {
  const profile=(await db.query("select role,is_active,branch_id from public.profiles where id=$1",[inactive])).rows[0];
  assert.deepEqual(profile,{role:"cashier",is_active:false,branch_id:null});
  await assert.rejects(asUser(inactive,"select public.list_pos_orders()"),/STAFF_REQUIRED/);
});
test("sin sesión no se leen datos ni se crean pedidos", async () => {
  await assert.rejects(asUser(null,"select * from public.orders",[],"anon"),/permission denied/);
  await assert.rejects(asUser(null,"select public.list_pos_orders()",[],"anon"),/permission denied/);
  await assert.rejects(save(null,randomUUID()),/STAFF_REQUIRED/);
});
test("cajero no puede alterar precios, roles, pedidos ni pagos fuera de los RPC", async () => {
  for(const sql of ["update public.products set price=1", "update public.profiles set role='owner'", "update public.orders set total=1", "delete from public.payments", "select public.complete_sale('takeaway',null,'[]','[]',null)"]) {
    await assert.rejects(asUser(cashier,sql),/permission denied/);
  }
});
test("se guarda y vuelve a leer un pedido con precio calculado en PostgreSQL", async () => {
  const id=randomUUID();
  const row=(await save(cashier,id)).rows[0].result;
  assert.equal(row.total,50); assert.equal(row.version,1);
  const list=(await asUser(cashier,"select public.list_pos_orders() as result")).rows[0].result;
  assert.equal(list.find(order=>order.id===id).items[0].quantity,2);
  assert.equal(list.find(order=>order.id===id).notes,"Sin cebolla");
  assert.equal((await asUser(outsider,"select * from public.orders where id=$1",[id])).rows.length,0);
  await assert.rejects(save(outsider,id,1),/ORDER_NOT_FOUND/);
});
test("reintentar guardar la misma solicitud es idempotente", async () => {
  const id=randomUUID(), request=randomUUID();
  await save(cashier,id,0,2,request);
  const retry=(await save(cashier,id,0,2,request)).rows[0].result;
  assert.equal(retry.version,1);
  assert.equal((await db.query("select count(*)::integer as n from public.order_items where order_id=$1",[id])).rows[0].n,1);
});
test("una versión vieja no pisa cambios de otro equipo", async () => {
  const id=randomUUID();
  await save(cashier,id);
  await save(owner,id,1,3);
  await assert.rejects(save(cashier,id,1,4), { message: "ORDER_CHANGED", code: "PT409" });
  assert.equal((await db.query("select total from public.orders where id=$1",[id])).rows[0].total,"75.00");
});
test("no se abren dos pedidos en una mesa pero sí varios para llevar", async () => {
  await save(cashier,randomUUID(),0,1,randomUUID(),"Mesa 1");
  await assert.rejects(save(owner,randomUUID(),0,1,randomUUID(),"Mesa 1"),/TABLE_OCCUPIED/);
  await save(cashier,randomUUID()); await save(owner,randomUUID());
  await assert.rejects(save(owner,randomUUID(),0,1,randomUUID(),"Mesa 6"),/INVALID_TABLE/);
});
test("rechaza cantidades cero, negativas, fraccionadas y productos desconocidos", async () => {
  for(const amount of [0,-1,1.5,10000]) await assert.rejects(save(cashier,randomUUID(),0,amount),/INVALID_ITEMS/);
  await assert.rejects(asUser(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'')",
    [randomUUID(),randomUUID(),JSON.stringify([{product_id:randomUUID(),quantity:1}])]),/PRODUCT_UNAVAILABLE/);
});
test("pago insuficiente hace rollback y no cierra el pedido", async () => {
  const id=randomUUID(); await save(cashier,id);
  await assert.rejects(pay(cashier,id,1,randomUUID(),49),/PAYMENT_MISMATCH/);
  assert.equal((await db.query("select count(*)::integer as n from public.payments where order_id=$1",[id])).rows[0].n,0);
  assert.equal((await db.query("select status from public.orders where id=$1",[id])).rows[0].status,"draft");
});
test("cobro repetido no duplica pagos, ticket ni descuento de ingredientes", async () => {
  const ingredient=randomUUID();
  await db.query("insert into public.ingredients(id,branch_id,name,unit,current_stock) values($1,$2,'Ingrediente de prueba','g',1000)",[ingredient,branch]);
  await db.query("insert into public.product_recipes(product_id,ingredient_id,quantity) values($1,$2,10)",[taco,ingredient]);
  const id=randomUUID(),request=randomUUID(); await save(cashier,id);
  const paid=(await pay(cashier,id,1,request)).rows[0].result;
  assert.equal(paid.status,"paid"); assert.equal(paid.version,2);
  await pay(cashier,id,1,request);
  await assert.rejects(pay(cashier,id,2,randomUUID()),/ORDER_CLOSED/);
  assert.equal((await db.query("select current_stock from public.ingredients where id=$1",[ingredient])).rows[0].current_stock,"980.000");
  for(const table of ["payments","tickets","inventory_movements"]) assert.equal((await db.query(`select count(*)::integer as n from public.${table} where order_id=$1`,[id])).rows[0].n,1);
  await assert.rejects(save(cashier,id,2,1),/ORDER_CLOSED/);
});
test("pago combinado conserva importes exactos", async () => {
  const id=randomUUID(); await save(cashier,id);
  const row=(await asUser(cashier,"select public.pay_pos_order($1,1,$2,$3) as result",
    [id,randomUUID(),JSON.stringify([{method:"cash",amount:20},{method:"card",amount:30}])])).rows[0].result;
  assert.equal(row.payments.length,2);
  assert.equal(row.payments.reduce((sum,payment)=>sum+payment.amount,0),50);
});
test("sólo dueño puede cancelar un pedido abierto y requiere motivo", async () => {
  const id=randomUUID(); await save(cashier,id);
  const sql="select public.cancel_pos_order($1,1,$2) as result";
  await assert.rejects(asUser(cashier,sql,[id,"Error en pedido"]),/OWNER_REQUIRED/);
  await assert.rejects(asUser(owner,sql,[id,""]),/REASON_REQUIRED/);
  assert.equal((await asUser(owner,sql,[id,"Error en pedido"])).rows[0].result.status,"cancelled");
  await assert.rejects(pay(cashier,id,2,randomUUID()),/ORDER_CLOSED/);
});

test("valida identificadores, versión y longitud de notas antes de escribir", async () => {
  const sql="select public.save_pos_order($1,$2,$3,'takeaway',null,$4,$5)";
  const items=JSON.stringify([{product_id:taco,quantity:1}]);
  for(const args of [[null,0,randomUUID(),items,""],[randomUUID(),null,randomUUID(),items,""],
    [randomUUID(),-1,randomUUID(),items,""],[randomUUID(),0,null,items,""],[randomUUID(),0,randomUUID(),items,"x".repeat(301)]]) {
    await assert.rejects(asUser(cashier,sql,args),/INVALID_ORDER/);
  }
});

test("rechaza listas de productos vacías, repetidas o mayores al límite", async () => {
  const item={product_id:taco,quantity:1};
  for(const items of [[],[item,item],Array.from({length:101},()=>item),null,{}]) {
    await assert.rejects(asUser(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'')",
      [randomUUID(),randomUUID(),JSON.stringify(items)]),/INVALID_ITEMS/);
  }
});

test("ignora precios enviados por el cliente y conserva el precio ya guardado", async () => {
  const id=randomUUID();
  const first=(await asUser(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'') as result",
    [id,randomUUID(),JSON.stringify([{product_id:taco,quantity:2,price:0.01,unit_price:0.01}])])).rows[0].result;
  assert.equal(first.total,50);
  try {
    await db.query("update public.products set price=999 where id=$1",[taco]);
    assert.equal((await save(cashier,id,1,3)).rows[0].result.total,75);
  } finally { await db.query("update public.products set price=25 where id=$1",[taco]); }
});

test("un producto desactivado no se puede agregar ni cobrar como nuevo pedido", async () => {
  try {
    await db.query("update public.products set is_active=false where id=$1",[taco]);
    await assert.rejects(save(cashier,randomUUID()),/PRODUCT_UNAVAILABLE/);
  } finally { await db.query("update public.products set is_active=true where id=$1",[taco]); }
});

test("no cambia el destino de un pedido guardado", async () => {
  const id=randomUUID(); await save(cashier,id);
  await assert.rejects(save(cashier,id,1,2,randomUUID(),"Mesa 2"),/ORDER_DESTINATION_CHANGED/);
});

test("ni un dueño de otra sucursal puede cobrar o cancelar la orden", async () => {
  const id=randomUUID(); await save(cashier,id);
  await assert.rejects(pay(outsider,id,1,randomUUID()),/ORDER_NOT_FOUND/);
  await assert.rejects(asUser(outsider,"select public.cancel_pos_order($1,1,'Prueba')",[id]),/ORDER_NOT_FOUND/);
});

test("rechaza pagos inválidos y no deja partidas parciales", async () => {
  const id=randomUUID(); await save(cashier,id);
  for(const payments of [[],null,{},[{method:"bitcoin",amount:50}],[{method:"cash",amount:0}],
    [{method:"cash",amount:-50}],[{method:"cash",amount:49.999}],
    [{method:"cash",amount:25},{method:"cash",amount:25}]]) {
    await assert.rejects(asUser(cashier,"select public.pay_pos_order($1,1,$2,$3)",[id,randomUUID(),JSON.stringify(payments)]),/INVALID_PAYMENT/);
  }
  await assert.rejects(pay(cashier,id,1,randomUUID(),51),/PAYMENT_MISMATCH/);
  assert.equal((await db.query("select count(*)::int as n from public.payments where order_id=$1",[id])).rows[0].n,0);
});

test("permite efectivo, tarjeta y transferencia en una misma operación exacta", async () => {
  const id=randomUUID(); await save(cashier,id);
  const paid=(await asUser(cashier,"select public.pay_pos_order($1,1,$2,$3) as result",[id,randomUUID(),JSON.stringify([
    {method:"cash",amount:10},{method:"card",amount:15},{method:"transfer",amount:25},
  ])])).rows[0].result;
  assert.equal(paid.status,"paid"); assert.equal(paid.payments.length,3); assert.equal(paid.total,50);
});

test("desactivar un perfil bloquea incluso sus llamadas con sesión existente", async () => {
  try {
    await db.query("update public.profiles set is_active=false where id=$1",[cashier]);
    await assert.rejects(asUser(cashier,"select public.list_pos_orders()"),/STAFF_REQUIRED/);
    await assert.rejects(save(cashier,randomUUID()),/STAFF_REQUIRED/);
    assert.equal((await asUser(cashier,"select * from public.products")).rows.length,0);
  } finally { await db.query("update public.profiles set is_active=true where id=$1",[cashier]); }
});

test("Dueño y Cajero comparten el pedido sin perder autor ni aceptar versiones viejas", async () => {
  const id=randomUUID();
  await save(owner,id,0,1);
  const readByCashier=(await asUser(cashier,"select public.list_pos_orders() as result")).rows[0].result;
  assert.equal(readByCashier.find(order=>order.id===id).version,1);
  await save(cashier,id,1,3);
  await assert.rejects(save(owner,id,1,2),{message:"ORDER_CHANGED",code:"PT409"});
  await assert.rejects(asUser(owner,"select public.cancel_pos_order($1,1,'Prueba entre roles')",[id]),{message:"ORDER_CHANGED",code:"PT409"});
  await assert.rejects(asUser(cashier,"select public.cancel_pos_order($1,2,'Prueba entre roles')",[id]),/OWNER_REQUIRED/);
  const unchanged=(await db.query("select created_by,status,total,version,cancelled_by from public.orders where id=$1",[id])).rows[0];
  assert.deepEqual(unchanged,{created_by:owner,status:"draft",total:"75.00",version:2,cancelled_by:null});
  await asUser(owner,"select public.cancel_pos_order($1,2,'Prueba entre roles')",[id]);
  const closed=(await db.query("select created_by,status,cancelled_by,version from public.orders where id=$1",[id])).rows[0];
  assert.deepEqual(closed,{created_by:owner,status:"cancelled",cancelled_by:owner,version:3});
  assert.equal((await db.query("select count(*)::int as n from public.payments where order_id=$1",[id])).rows[0].n,0);
});

test("un rol puede cobrar el pedido del otro conservando identidades y un solo pago", async () => {
  for(const [creator,receiver] of [[cashier,owner],[owner,cashier]]) {
    const id=randomUUID(),request=randomUUID();
    await save(creator,id,0,1);
    await pay(receiver,id,1,request,25);
    await pay(receiver,id,1,request,25);
    await assert.rejects(pay(creator,id,1,randomUUID(),25),/ORDER_CLOSED/);
    assert.deepEqual((await db.query("select created_by,status,version from public.orders where id=$1",[id])).rows[0],
      {created_by:creator,status:"paid",version:2});
    assert.deepEqual((await db.query("select received_by,amount from public.payments where order_id=$1",[id])).rows,
      [{received_by:receiver,amount:"25.00"}]);
    assert.equal((await db.query("select count(*)::int as n from public.tickets where order_id=$1",[id])).rows[0].n,1);
  }
});

test("un cobro se asocia a la apertura existente sin inventar otra caja", async () => {
  const session=(await db.query("select id from public.cash_register_sessions where status='open'")).rows[0].id,id=randomUUID();
  await save(cashier,id); await pay(cashier,id,1,randomUUID());
  assert.equal((await db.query("select cash_session_id from public.orders where id=$1",[id])).rows[0].cash_session_id,session);
  assert.equal((await db.query("select count(*)::int as n from public.cash_register_sessions")).rows[0].n,1);
});
