import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import {PGlite} from "@electric-sql/pglite";
import {buildSetupSql} from "../scripts/supabase-setup.mjs";

const db=new PGlite(), branch="11111111-1111-1111-1111-111111111111";
const owner=randomUUID(),cashier=randomUUID(),inactive=randomUUID(),outsider=randomUUID();
let taco;
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec((await buildSetupSql()).replace("create extension if not exists pgcrypto;",""));
  for(const id of [owner,cashier,inactive,outsider]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,id+"@test.invalid"]);
  await db.query("update public.profiles set is_active=true,branch_id=$1,role='owner' where id=$2",[branch,owner]);
  await db.query("update public.profiles set is_active=true,branch_id=$1 where id=$2",[branch,cashier]);
  const other=randomUUID();await db.query("insert into public.branches(id,name) values($1,'Otra')",[other]);
  await db.query("update public.profiles set is_active=true,branch_id=$1,role='owner' where id=$2",[other,outsider]);
  taco=(await db.query("select id from public.products where name='Tacos'")).rows[0].id;
});
after(()=>db.close());
async function staff(user,sql,params=[],role="authenticated") {
  return db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user??""]);return (await tx.query(sql,params)).rows;});
}
const dashboard=(user=owner)=>staff(user,"select public.get_menu_dashboard() as result").then(rows=>rows[0].result);
const list=(user=cashier)=>staff(user,"select public.list_pos_products() as result").then(rows=>rows[0].result);
const product=()=>({id:randomUUID(),version:0,request:randomUUID(),name:`QA ${randomUUID()}`,category:"Pruebas",description:"QA local",price:10,active:true,reason:""});
const save=(p,user=owner)=>staff(user,"select public.save_menu_product($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",[p.id,p.version,p.request,p.name,p.category,p.description,p.price,p.active,p.reason]).then(rows=>rows[0].result);
const edit=(p,changes)=>({...p,version:p.version+1,request:randomUUID(),...changes});
const count=async(table,id)=>Number((await db.query(`select count(*) as n from public.${table} where product_id=$1`,[id])).rows[0].n);

test("menú: invitados, inactivos y Cajero no administran ni escriben directamente",async()=>{
  await assert.rejects(staff(null,"select public.list_pos_products()",[],"anon"),/permission denied/);
  await assert.rejects(list(inactive),/STAFF_REQUIRED/);
  await assert.rejects(dashboard(cashier),/OWNER_REQUIRED/);
  await assert.rejects(save(product(),cashier),/OWNER_REQUIRED/);
  for(const sql of ["update public.products set price=1", "delete from public.products", "delete from public.product_changes", "insert into public.products(branch_id,name,category,price) values(gen_random_uuid(),'QA','QA',1)"])
    await assert.rejects(staff(owner,sql),/permission denied/);
  assert.equal((await staff(cashier,"select * from public.product_changes")).length,0);
  assert.equal((await list()).length,26);
});
test("menú: alta y reintento idéntico crean un solo producto y un solo registro",async()=>{
  const p=product(),first=await save(p);assert.equal(first.version,1);assert.equal(first.price,10);
  assert.deepEqual(await save(p),first);assert.equal(await count("product_changes",p.id),1);
  assert.equal(await count("price_overrides",p.id),0);
  await assert.rejects(save({...p,price:11}),{code:"PT409",message:"PRODUCT_REQUEST_CHANGED"});
});
test("menú: valida precio, nombre, categoría, versión y campos obligatorios sin dar altas",async()=>{
  const p=product();
  for(const changes of [{price:null},{price:0},{price:-1},{price:1.001},{price:"NaN"},{price:"Infinity"},{price:100000000},{name:" "},{name:"x".repeat(81)},{name:"Hola\n"},{category:""},{category:"a".repeat(41)},{description:"a".repeat(161)},{reason:"a".repeat(301)},{active:null},{version:-1}])
    await assert.rejects(save({...p,...changes}),/INVALID_PRODUCT/);
  assert.equal(await count("product_changes",p.id),0);
});
test("menú: cambiar precio o disponibilidad exige motivo y registra al Dueño",async()=>{
  const p=product();await save(p);
  await assert.rejects(save(edit(p,{price:12})),/PRODUCT_REASON_REQUIRED/);
  await assert.rejects(save(edit(p,{active:false})),/PRODUCT_REASON_REQUIRED/);
  const changed=edit(p,{price:12,reason:"QA autorización"});const result=await save(changed);
  assert.equal(result.version,2);assert.equal(result.price,12);assert.equal(await count("price_overrides",p.id),1);
  await save(changed);assert.equal(await count("price_overrides",p.id),1);
  const audit=(await db.query("select * from public.price_overrides where product_id=$1",[p.id])).rows[0];
  assert.equal(audit.requested_by,owner);assert.equal(audit.authorized_by,owner);assert.equal(Number(audit.previous_price),10);assert.equal(Number(audit.new_price),12);assert.equal(audit.reason,"QA autorización");
  assert.equal((await dashboard()).changes.filter(c=>c.after.id===p.id).length,2);
});
test("menú: versiones viejas no sobrescriben; reintento anterior devuelve el estado actual",async()=>{
  const p=product();await save(p);const changed=edit(p,{price:13,reason:"QA precio"});await save(changed);
  await assert.rejects(save(edit(p,{name:"Otro"})),{code:"PT409",message:"PRODUCT_CHANGED"});
  assert.equal((await save(p)).price,13);assert.equal(await count("product_changes",p.id),2);
  await assert.rejects(save({...changed,request:randomUUID(),version:2}),/PRODUCT_NO_CHANGE/);
});
test("menú: nombre normalizado duplicado incluso desactivado revierte sin dejar auditoría",async()=>{
  const p=product();await save(p);await save(edit(p,{active:false,reason:"QA retiro"}));
  const duplicate=product();duplicate.name=`  ${p.name.toUpperCase()}  `;
  await assert.rejects(save(duplicate),{code:"23505"});assert.equal(await count("product_changes",duplicate.id),0);
  assert.equal((await list()).some(row=>row.id===p.id),false);
  const reactivated=await save(edit(p,{version:2,active:true,reason:"QA regreso"}));assert.equal(reactivated.is_active,true);
});
test("menú: sucursales aisladas y Cajero no ve el historial del Dueño",async()=>{
  const p=product();await save(p);assert.equal((await dashboard(outsider)).products.length,0);
  await assert.rejects(save(edit(p,{name:"Ajeno"}),outsider),/PRODUCT_NOT_FOUND/);
  await assert.rejects(save(p,outsider),/PRODUCT_REQUEST_CHANGED/);
  assert.equal((await staff(cashier,"select * from public.product_changes")).length,0);
  assert.ok((await staff(owner,"select * from public.product_changes")).length>0);
});
test("menú: precios guardados y cobrados no se alteran, pedidos nuevos usan precio nuevo",async()=>{
  const p=product();await save(p);
  async function order(){const id=randomUUID();return (await staff(cashier,"select public.save_pos_order($1,0,$2,'takeaway',null,$3,'QA menú') as result",[id,randomUUID(),JSON.stringify([{product_id:p.id,quantity:1}])]))[0].result;}
  const old=await order();assert.equal(old.total,10);
  await save(edit(p,{price:12,reason:"QA precio"}));assert.equal((await order()).total,12);
  const session=randomUUID();await staff(owner,"select public.open_cash_session($1,0)",[session]);
  const paid=(await staff(cashier,"select public.pay_pos_order($1,1,$2,$3) as result",[old.id,randomUUID(),JSON.stringify([{method:"cash",amount:10}])]))[0].result;
  assert.equal(paid.total,10);assert.equal(paid.items[0].unit_price,10);
  const before=(await db.query("select * from public.orders where id=$1",[old.id])).rows;
  await save(edit(p,{version:2,active:false,reason:"QA desactivación"}));
  assert.deepEqual((await db.query("select * from public.orders where id=$1",[old.id])).rows,before);
  assert.equal((await list()).some(row=>row.id===p.id),false);
  await assert.rejects(order(),/PRODUCT_UNAVAILABLE/);
});
test("menú: reaplicar migración conserva datos, ACL y las 17 tablas protegidas",async()=>{
  const tables=["products","product_changes","price_overrides","orders","order_items","payments","tickets","cash_register_sessions"];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`select * from public.${table} order by id`)).rows])));
  const before=await snapshot();
  await db.exec(await readFile(new URL("../supabase/migrations/202610220005_menu_management.sql",import.meta.url),"utf8"));
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.query("select count(*)::int as n from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and c.relrowsecurity")).rows[0].n,17);
  await assert.rejects(save(product(),cashier),/OWNER_REQUIRED/);await assert.rejects(staff(null,"select public.get_menu_dashboard()",[],"anon"),/permission denied/);
});

const source=await readFile(new URL("../src/lib/menu-management.ts",import.meta.url),"utf8");
const pure=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`);
test("menú: formulario valida importes, motivos y cambios reales; catálogo omite desactivados",()=>{
  for(const value of ["","0","-1","1e3","NaN","Infinity","1.001","1,50","100000000"])assert.equal(pure.productPrice(value),null);
  assert.equal(pure.productPrice("25.50"),25.5);
  const input={name:"Tacos",category:"Antojitos",description:"",price:"25",active:true,reason:""};
  const previous={id:"taco",name:"Tacos",category:"Antojitos",description:"",price:25,is_active:true,version:1,sort_order:0};
  assert.equal(pure.validProduct(input,null),true);assert.equal(pure.validProduct(input,previous),false);
  assert.equal(pure.validProduct({...input,price:"26"},previous),false);assert.equal(pure.validProduct({...input,price:"26",reason:"Autorizado"},previous),true);
  assert.equal(pure.validProduct({...input,active:false},previous),false);
  assert.equal(pure.saleProducts([previous,{...previous,id:"inactive",is_active:false}]).length,1);
  assert.match(pure.menuError({code:"23505",message:"duplicate"}),/desactivados/);
  assert.match(pure.menuError({message:"PRODUCT_CHANGED"}),/Otra persona/);
});
