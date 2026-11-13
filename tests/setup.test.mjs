import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildSetupSql, setupFile } from "../scripts/supabase-setup.mjs";

async function freshDatabase(run) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
    `);
    await run(db);
  } finally { await db.close(); }
}

async function installSql() {
  // Igual que las pruebas de negocio: gen_random_uuid es nativo en este PostgreSQL local.
  return (await buildSetupSql()).replace("create extension if not exists pgcrypto;", "");
}

async function expectBlocked(db) {
  await assert.rejects(db.exec(await installSql()), /INSTALACION_DETENIDA/);
  await db.exec("rollback;");
  assert.equal((await db.query("select to_regclass('public.orders') as orders")).rows[0].orders, null);
}

test("el instalador entregado coincide con las seis migraciones, el seed y su comprobación", async () => {
  const actual = (await readFile(setupFile, "utf8")).replace(/\r\n/g, "\n");
  assert.equal(actual.trimEnd(), (await buildSetupSql()).trimEnd());
});

test("instala menú y permisos finales juntos en una base nueva", async () => freshDatabase(async (db) => {
  await db.exec(await installSql());
  assert.equal((await db.query("select count(*)::int as n from public.products")).rows[0].n, 26);
  assert.equal((await db.query("select count(*)::int as n from public.ingredients")).rows[0].n, 0);
  const access = (await db.query("select has_function_privilege('anon','public.list_pos_orders()','execute') as allowed")).rows[0];
  assert.equal(access.allowed, false);
  await db.exec("insert into auth.users(id,email) values(gen_random_uuid(),'staff@test.invalid');");
  assert.equal((await db.query("select is_active from public.profiles")).rows[0].is_active, false);
}));

const conflictFix = () => readFile(new URL("../supabase/migrations/202610190003_order_conflict_http.sql", import.meta.url), "utf8");
const rpcSignatures = [
  "public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text)",
  "public.pay_pos_order(uuid,integer,uuid,jsonb)", "public.cancel_pos_order(uuid,integer,text)",
];
async function oldInstallation(db) {
  for (const name of ["202610170001_initial_schema.sql", "202610180002_staff_orders.sql"]) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", ""));
  }
  await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
}
async function functionSecurity(db) {
  return (await db.query(`select oid::regprocedure::text as signature, proowner, prosecdef, proconfig, proacl::text
    from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text`, [rpcSignatures])).rows;
}

async function cashierActivation(email, id) {
  const template=await readFile(new URL("../supabase/activate_cashier.sql",import.meta.url),"utf8");
  return template.replace("'REEMPLAZAR_CORREO'", `'${email}'`).replace("expected_auth_id uuid := null", `expected_auth_id uuid := '${id}'`);
}

test("activar Cajero exige correo y UUID exactos, conserva al Dueño y no amplía permisos SQL", async () => freshDatabase(async (db) => {
  await db.exec(await installSql());
  const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", cashier="cccccccc-cccc-4ccc-cccc-cccccccccccc";
  await db.query("insert into auth.users(id,email) values($1,'owner-activation@test.invalid'),($2,'cashier-activation@test.invalid')",[owner,cashier]);
  await db.query("update public.profiles set role='owner',is_active=true,branch_id='11111111-1111-1111-1111-111111111111' where id=$1",[owner]);
  const ownerBefore=(await db.query("select * from public.profiles where id=$1",[owner])).rows;
  const permissions=await functionSecurity(db);
  await assert.rejects(db.exec(await cashierActivation("cashier-activation@test.invalid",owner)),/CASHIER_ACTIVATION_STOPPED/);
  assert.equal((await db.query("select is_active from public.profiles where id=$1",[cashier])).rows[0].is_active,false);
  await db.exec(await cashierActivation("cashier-activation@test.invalid",cashier));
  const profile=(await db.query("select role,is_active,full_name,branch_id from public.profiles where id=$1",[cashier])).rows[0];
  assert.deepEqual(profile,{role:"cashier",is_active:true,full_name:"Cajero de prueba",branch_id:"11111111-1111-1111-1111-111111111111"});
  await db.exec(await cashierActivation("cashier-activation@test.invalid",cashier));
  assert.deepEqual((await db.query("select * from public.profiles where id=$1",[owner])).rows,ownerBefore);
  assert.deepEqual(await functionSecurity(db),permissions);
}));

test("la plantilla Cajero rechaza valores vacíos, Dueño y cuentas de otra sucursal", async () => freshDatabase(async (db) => {
  await db.exec(await installSql());
  const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", outsider="dddddddd-dddd-4ddd-dddd-dddddddddddd";
  await db.query("insert into auth.users(id,email) values($1,'owner-guard@test.invalid'),($2,'other-guard@test.invalid')",[owner,outsider]);
  await db.query("update public.profiles set role='owner',is_active=true where id=$1",[owner]);
  await db.exec("insert into public.branches(id,name) values('22222222-2222-4222-8222-222222222222','Otra sucursal')");
  await db.query("update public.profiles set branch_id='22222222-2222-4222-8222-222222222222' where id=$1",[outsider]);
  const before=(await db.query("select * from public.profiles order by id")).rows;
  await assert.rejects(db.exec(await readFile(new URL("../supabase/activate_cashier.sql",import.meta.url),"utf8")),/CASHIER_ACTIVATION_STOPPED/);
  await assert.rejects(db.exec(await cashierActivation("owner-guard@test.invalid",owner)),/no modifica cuentas Dueño/);
  await assert.rejects(db.exec(await cashierActivation("other-guard@test.invalid",outsider)),/otra sucursal/);
  assert.deepEqual((await db.query("select * from public.profiles order by id")).rows,before);
}));

test("actualiza una instalación existente: conflictos de guardar, cobrar y cancelar devuelven PT409", async () => freshDatabase(async (db) => {
  await oldInstallation(db);
  const user="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", order="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  await db.query("insert into auth.users(id,email) values($1,'qa-upgrade@test.invalid')", [user]);
  await db.query("update public.profiles set role='owner',is_active=true,branch_id='11111111-1111-1111-1111-111111111111' where id=$1", [user]);
  const product=(await db.query("select id from public.products where name='Tacos'")).rows[0].id;
  async function staff(sql, params=[]) {
    return db.transaction(async tx => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
      return tx.query(sql,params);
    });
  }
  const saveSql="select public.save_pos_order($1,$2,gen_random_uuid(),'takeaway',null,$3,'QA migración')";
  const items=JSON.stringify([{product_id:product,quantity:1}]);
  await staff(saveSql,[order,0,items]);
  await staff(saveSql,[order,1,items]);
  await assert.rejects(staff(saveSql,[order,1,items]), {message:"ORDER_CHANGED",code:"40001"});
  const permissions=await functionSecurity(db);
  const records=(await db.query("select id,version,total,notes,status from public.orders")).rows;
  await db.exec(await conflictFix());
  for (const [sql,params] of [
    [saveSql,[order,1,items]],
    ["select public.pay_pos_order($1,1,gen_random_uuid(),'[{\"method\":\"cash\",\"amount\":25}]')",[order]],
    ["select public.cancel_pos_order($1,1,'QA intento viejo')",[order]],
  ]) await assert.rejects(staff(sql,params), {message:"ORDER_CHANGED",code:"PT409"});
  assert.deepEqual((await db.query("select id,version,total,notes,status from public.orders")).rows, records);
  assert.equal((await db.query("select count(*)::int as n from public.payments")).rows[0].n,0);
  assert.deepEqual(await functionSecurity(db), permissions);
  await db.exec(await conflictFix()); // Reaplicación segura; no cambia pedidos, permisos ni versiones.
  assert.deepEqual(await functionSecurity(db), permissions);
  assert.deepEqual((await db.query("select id,version,total,notes,status from public.orders")).rows, records);
}));

test("la corrección se detiene y revierte si encuentra una función inesperada", async () => freshDatabase(async (db) => {
  await oldInstallation(db);
  const signature=rpcSignatures[2];
  const definition=(await db.query("select pg_get_functiondef($1::regprocedure) as sql",[signature])).rows[0].sql;
  await db.exec(definition.replace("errcode='40001'", "errcode='P0001'"));
  await assert.rejects(db.exec(await conflictFix()), /CONFLICT_FIX_STOPPED/);
  await db.exec("rollback;");
  const first=(await db.query("select pg_get_functiondef($1::regprocedure) as sql",[rpcSignatures[0]])).rows[0].sql;
  assert.ok(first.includes("errcode='40001'"), "El fallo de la tercera función debe revertir también la primera");
  assert.equal((await db.query("select count(*)::int as n from public.products")).rows[0].n,26);
}));

test("actualizar Caja conserva ventas antiguas y no crea ni asigna aperturas",async()=>freshDatabase(async db=>{
  await oldInstallation(db); await db.exec(await conflictFix());
  const user="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",order="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  await db.query("insert into auth.users(id,email) values($1,'qa-cash-upgrade@test.invalid')",[user]);
  await db.query("update public.profiles set role='owner',is_active=true,branch_id='11111111-1111-1111-1111-111111111111' where id=$1",[user]);
  await db.query("insert into public.orders(id,branch_id,type,status,subtotal,total,created_by,paid_at) values($1,'11111111-1111-1111-1111-111111111111','takeaway','paid',25,25,$2,now())",[order,user]);
  await db.query("insert into public.payments(order_id,method,amount,received_by) values($1,'cash',25,$2)",[order,user]);
  const records=(await db.query("select * from public.orders order by id")).rows;
  const payments=(await db.query("select * from public.payments order by id")).rows;
  const permissions=await functionSecurity(db);
  await db.exec(await readFile(new URL("../supabase/migrations/202610210004_cash_register.sql",import.meta.url),"utf8"));
  assert.deepEqual((await db.query("select * from public.orders order by id")).rows,records);
  assert.deepEqual((await db.query("select * from public.payments order by id")).rows,payments);
  assert.deepEqual(await functionSecurity(db),permissions);
  assert.equal((await db.query("select count(*)::int as n from public.cash_register_sessions")).rows[0].n,0);
}));

test("actualizar Menú conserva productos, ventas y permisos anteriores sin crear cambios",async()=>freshDatabase(async db=>{
  await oldInstallation(db);await db.exec(await conflictFix());
  await db.exec(await readFile(new URL("../supabase/migrations/202610210004_cash_register.sql",import.meta.url),"utf8"));
  const user="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",order="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  await db.query("insert into auth.users(id,email) values($1,'qa-menu-upgrade@test.invalid')",[user]);
  await db.query("update public.profiles set role='owner',is_active=true,branch_id='11111111-1111-1111-1111-111111111111' where id=$1",[user]);
  await db.query("insert into public.orders(id,branch_id,type,status,subtotal,total,created_by,paid_at) values($1,'11111111-1111-1111-1111-111111111111','takeaway','paid',25,25,$2,now())",[order,user]);
  await db.query("insert into public.payments(order_id,method,amount,received_by) values($1,'cash',25,$2)",[order,user]);
  const snapshot=async()=>Object.fromEntries(await Promise.all(["orders","payments","profiles","cash_register_sessions"].map(async table=>[table,(await db.query(`select * from public.${table} order by id`)).rows])));
  const records=await snapshot(),products=(await db.query("select to_jsonb(p)-'version' as p from public.products p order by id")).rows,permissions=await functionSecurity(db);
  await db.exec(await readFile(new URL("../supabase/migrations/202610220005_menu_management.sql",import.meta.url),"utf8"));
  assert.deepEqual(await snapshot(),records);assert.deepEqual((await db.query("select to_jsonb(p)-'version' as p from public.products p order by id")).rows,products);
  assert.deepEqual(await functionSecurity(db),permissions);assert.equal((await db.query("select count(*)::int as n from public.product_changes")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from public.products where version=1")).rows[0].n,26);
}));

test("actualizar Menú con nombres duplicados se detiene sin borrar ni renombrar datos",async()=>freshDatabase(async db=>{
  await oldInstallation(db);await db.exec(await conflictFix());
  await db.exec(await readFile(new URL("../supabase/migrations/202610210004_cash_register.sql",import.meta.url),"utf8"));
  await db.exec("insert into public.products(branch_id,name,category,price) values('11111111-1111-1111-1111-111111111111',' TACOS ','QA',1)");
  const before=(await db.query("select * from public.products order by id")).rows;
  await assert.rejects(db.exec(await readFile(new URL("../supabase/migrations/202610220005_menu_management.sql",import.meta.url),"utf8")),{code:"23505"});
  await db.exec("rollback;");assert.deepEqual((await db.query("select * from public.products order by id")).rows,before);
  assert.equal((await db.query("select to_regclass('public.product_changes') as table_name")).rows[0].table_name,null);
}));

test("rechaza otra aplicación con tablas sin alterar sus datos", async () => freshDatabase(async (db) => {
  await db.exec("create table public.other_business(id int primary key, note text); insert into public.other_business values(1,'Conservar');");
  await expectBlocked(db);
  assert.deepEqual((await db.query("select * from public.other_business")).rows, [{id:1,note:"Conservar"}]);
}));

test("rechaza un proyecto con usuarios Auth existentes", async () => freshDatabase(async (db) => {
  await db.exec("insert into auth.users(id,email) values(gen_random_uuid(),'existing@test.invalid');");
  await expectBlocked(db);
  assert.equal((await db.query("select count(*)::int as n from auth.users")).rows[0].n, 1);
}));

test("rechaza un proyecto con depósitos de archivos existentes", async () => freshDatabase(async (db) => {
  await db.exec("create schema storage; create table storage.buckets(id text); insert into storage.buckets values('Conservar');");
  await expectBlocked(db);
  assert.equal((await db.query("select id from storage.buckets")).rows[0].id, "Conservar");
}));

test("rechaza funciones y tipos de otra aplicación", async () => freshDatabase(async (db) => {
  await db.exec("create function public.other_application() returns text language sql as $$ select 'Conservar'::text $$;");
  await expectBlocked(db);
  assert.equal((await db.query("select public.other_application() as value")).rows[0].value, "Conservar");
  await db.exec("drop function public.other_application(); create type public.other_status as enum ('existing');");
  await expectBlocked(db);
  assert.equal((await db.query("select 'existing'::public.other_status as value")).rows[0].value, "existing");
}));

test("un error durante la instalación revierte tablas, tipos y triggers creados", async () => freshDatabase(async (db) => {
  const broken = (await installSql()).replace(/commit;\s*$/i, "select * from public.deliberately_missing_table;\ncommit;");
  await assert.rejects(db.exec(broken), /deliberately_missing_table/);
  await db.exec("rollback;");
  assert.equal((await db.query("select to_regclass('public.products') as products, to_regtype('public.user_role') as role")).rows[0].products, null);
  assert.equal((await db.query("select to_regtype('public.user_role') as role")).rows[0].role, null);
  assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal")).rows[0].n, 0);
}));
