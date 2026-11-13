-- Inventario autogestionable. No carga recetas, ingredientes, existencias ni compras ficticias.
begin;
alter table public.ingredients add column if not exists version integer not null default 1;
alter table public.products add column if not exists recipe_version integer not null default 1;
do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='inventory_enabled') then
    alter table public.products add column inventory_enabled boolean not null default false;
    update public.products p set inventory_enabled=true where exists(select 1 from public.product_recipes r where r.product_id=p.id);
  end if;
end;
$$;
alter table public.purchases add column if not exists supplier_name text;
alter table public.branches add column if not exists settings_version integer not null default 1;
create unique index if not exists ingredients_branch_name_unique on public.ingredients(branch_id,lower(btrim(name)));

create table if not exists public.inventory_actions (
  request_id uuid primary key, branch_id uuid not null references public.branches(id),
  actor_id uuid not null references public.profiles(id), action text not null, target_id uuid not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.inventory_actions enable row level security;
revoke all on public.inventory_actions from public,anon,authenticated;
grant select on public.inventory_actions to authenticated;
drop policy if exists owner_inventory_actions on public.inventory_actions;
create policy owner_inventory_actions on public.inventory_actions for select to authenticated
using(branch_id=(select public.current_user_branch()) and (select public.is_owner()));

create or replace function private.inventory_number(p_data jsonb,p_key text,p_scale integer,p_max numeric,p_min numeric default 0)
returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(p_data->p_key) is distinct from 'number' then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
  n:=(p_data->>p_key)::numeric;
  if n<p_min or n>p_max or n<>round(n,p_scale) then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
  return n;
end;
$$;

create or replace function public.get_inventory_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object(
    'ingredients',(select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]') from public.ingredients i where branch_id=branch),
    'products',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_active',p.is_active,
      'inventory_enabled',p.inventory_enabled,'recipe_version',p.recipe_version,
      'recipe',(select coalesce(jsonb_agg(jsonb_build_object('ingredient_id',r.ingredient_id,'quantity',r.quantity) order by r.ingredient_id),'[]') from public.product_recipes r where r.product_id=p.id)) order by p.sort_order,p.name),'[]') from public.products p where branch_id=branch),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by created_at desc,id),'[]') from (
      select m.id,m.ingredient_id,i.name,i.unit,m.type,m.quantity,m.notes,m.created_at,p.full_name as actor
      from public.inventory_movements m join public.ingredients i on i.id=m.ingredient_id left join public.profiles p on p.id=m.created_by
      where m.branch_id=branch order by m.created_at desc,m.id limit 100) m),
    'purchases',(select coalesce(jsonb_agg(to_jsonb(p) order by received_at desc,id),'[]') from (
      select p.id,p.reference,p.supplier_name,p.total,p.received_at,p.notes,
        (select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'unit',i.unit,'quantity',pi.quantity,'unit_cost',pi.unit_cost,'subtotal',pi.subtotal) order by i.name),'[]')
         from public.purchase_items pi join public.ingredients i on i.id=pi.ingredient_id where pi.purchase_id=p.id) as items
      from public.purchases p where p.branch_id=branch order by p.received_at desc,p.id limit 50) p)
  ) into result;
  return result;
end;
$$;

create or replace function public.inventory_action(p_action text,p_id uuid,p_version integer,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  branch uuid:=private.staff_branch(); prior public.inventory_actions; ingredient public.ingredients;
  product public.products; payload jsonb; result jsonb; is_new boolean; n numeric; delta numeric;
  item jsonb; item_id uuid; qty numeric; cost numeric; total numeric:=0; rows_count integer; supplier text;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_request_id is null or p_version is null or p_version<0 or jsonb_typeof(p_data) is distinct from 'object'
    or p_action is null or p_action not in ('ingredient','count','purchase','recipe','business') then
    raise exception 'INVALID_INVENTORY_DATA' using errcode='22023';
  end if;
  payload:=jsonb_build_object('id',p_id,'version',p_version,'data',p_data);
  perform pg_advisory_xact_lock(hashtextextended('inventory-request:'||p_request_id::text,0));
  select * into prior from public.inventory_actions where request_id=p_request_id;
  if found then
    if prior.branch_id<>branch or prior.actor_id<>(select auth.uid()) or prior.action<>p_action or prior.payload<>payload then
      raise exception 'INVENTORY_REQUEST_CHANGED' using errcode='PT409';
    end if;
    return prior.result;
  end if;
  -- Misma exclusión que el descuento por venta; cantidades y recetas no cambian a mitad de un cobro.
  perform pg_advisory_xact_lock(hashtextextended('inventory-branch:'||branch::text,0));

  if p_action in ('ingredient','count') then
    select * into ingredient from public.ingredients where id=p_id for update;
    is_new:=not found;
    if not is_new and ingredient.branch_id<>branch then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
    if (is_new and p_version<>0) or (is_new and p_action='count') then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
    if not is_new and ingredient.version<>p_version then raise exception 'INVENTORY_CHANGED' using errcode='PT409'; end if;
    if p_action='ingredient' then
      if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 1 and 80
        or (p_data->>'name') ~ '[[:cntrl:]]' or coalesce(p_data->>'unit','') not in ('kg','g','l','ml','piece')
        or jsonb_typeof(p_data->'active') is distinct from 'boolean' then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
      n:=private.inventory_number(p_data,'minimum',3,99999999.999);
      if not is_new and ingredient.unit<>p_data->>'unit' then raise exception 'UNIT_LOCKED' using errcode='22023'; end if;
      if not (p_data->>'active')::boolean and exists(select 1 from public.product_recipes r join public.products p on p.id=r.product_id
        where r.ingredient_id=p_id and p.inventory_enabled) then raise exception 'INGREDIENT_IN_USE' using errcode='22023'; end if;
      if is_new then
        insert into public.ingredients(id,branch_id,name,unit,minimum_stock,is_active)
          values(p_id,branch,trim(p_data->>'name'),p_data->>'unit',n,(p_data->>'active')::boolean);
      else
        update public.ingredients set name=trim(p_data->>'name'),minimum_stock=n,is_active=(p_data->>'active')::boolean,version=version+1 where id=p_id;
      end if;
    else
      if not ingredient.is_active or length(trim(coalesce(p_data->>'reason',''))) not between 3 and 300 then raise exception 'INVENTORY_REASON_REQUIRED' using errcode='22023'; end if;
      n:=private.inventory_number(p_data,'quantity',3,99999999.999);
      delta:=n-ingredient.current_stock;
      if delta=0 then raise exception 'INVENTORY_NO_CHANGE' using errcode='22023'; end if;
      update public.ingredients set current_stock=n,version=version+1 where id=p_id;
      insert into public.inventory_movements(branch_id,ingredient_id,type,quantity,created_by,notes)
        values(branch,p_id,'adjustment',delta,(select auth.uid()),trim(p_data->>'reason'));
    end if;
  elsif p_action='purchase' then
    if p_version<>0 or exists(select 1 from public.purchases where id=p_id) then raise exception 'INVENTORY_CHANGED' using errcode='PT409'; end if;
    if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    rows_count:=jsonb_array_length(p_data->'items');
    if rows_count not between 1 and 50 or length(coalesce(p_data->>'reference',''))>100 or length(coalesce(p_data->>'supplier',''))>100
      or length(coalesce(p_data->>'notes',''))>300 then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    if (select count(distinct value->>'ingredient_id') from jsonb_array_elements(p_data->'items'))<>rows_count then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_data->'items') loop
      item_id:=(item->>'ingredient_id')::uuid;
      if item_id is null or not exists(select 1 from public.ingredients where id=item_id and branch_id=branch and is_active) then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
      qty:=private.inventory_number(item,'quantity',3,99999999.999,0.001);
      cost:=private.inventory_number(item,'unit_cost',4,9999999.9999);
      total:=total+round(qty*cost,2);
      if total>99999999.99 then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    end loop;
    insert into public.purchases(id,branch_id,reference,supplier_name,notes,total,received_by)
      values(p_id,branch,nullif(trim(p_data->>'reference'),''),nullif(trim(p_data->>'supplier'),''),nullif(trim(p_data->>'notes'),''),total,(select auth.uid()));
    for item in select value from jsonb_array_elements(p_data->'items') order by value->>'ingredient_id' loop
      insert into public.purchase_items(purchase_id,ingredient_id,quantity,unit_cost)
        values(p_id,(item->>'ingredient_id')::uuid,(item->>'quantity')::numeric,(item->>'unit_cost')::numeric);
    end loop;
  elsif p_action='recipe' then
    select * into product from public.products where id=p_id for update;
    if not found or product.branch_id<>branch then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
    if product.recipe_version<>p_version then raise exception 'INVENTORY_CHANGED' using errcode='PT409'; end if;
    if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or jsonb_typeof(p_data->'items') is distinct from 'array'
      then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    rows_count:=jsonb_array_length(p_data->'items');
    if rows_count>50 or ((p_data->>'enabled')::boolean and rows_count=0)
      or (select count(distinct value->>'ingredient_id') from jsonb_array_elements(p_data->'items'))<>rows_count
      then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_data->'items') loop
      item_id:=(item->>'ingredient_id')::uuid;
      if item_id is null or not exists(select 1 from public.ingredients where id=item_id and branch_id=branch and is_active) then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
      n:=private.inventory_number(item,'quantity',3,99999999.999,0.001);
    end loop;
    delete from public.product_recipes where product_id=p_id;
    insert into public.product_recipes(product_id,ingredient_id,quantity)
      select p_id,(value->>'ingredient_id')::uuid,(value->>'quantity')::numeric from jsonb_array_elements(p_data->'items');
    update public.products set inventory_enabled=(p_data->>'enabled')::boolean,recipe_version=recipe_version+1 where id=p_id;
  else
    if p_id<>branch then raise exception 'INVENTORY_NOT_FOUND' using errcode='42501'; end if;
    if not exists(select 1 from public.branches where id=branch and settings_version=p_version) then raise exception 'INVENTORY_CHANGED' using errcode='PT409'; end if;
    if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 1 and 80
      or (p_data->>'name') ~ '[[:cntrl:]]' or length(coalesce(p_data->>'address',''))>200 then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
    update public.branches set name=trim(p_data->>'name'),address=nullif(trim(p_data->>'address'),''),settings_version=settings_version+1 where id=branch;
  end if;
  result:=jsonb_build_object('id',p_id,'ok',true);
  insert into public.inventory_actions(request_id,branch_id,actor_id,action,target_id,payload,result)
    values(p_request_id,branch,(select auth.uid()),p_action,p_id,payload,result);
  return result;
end;
$$;

create or replace function public.receive_purchase_item() returns trigger
language plpgsql security definer set search_path='' as $$
declare purchase_row public.purchases; ingredient public.ingredients;
begin
  select * into purchase_row from public.purchases where id=new.purchase_id;
  select * into ingredient from public.ingredients where id=new.ingredient_id for update;
  if ingredient.branch_id<>purchase_row.branch_id or not ingredient.is_active or ingredient.current_stock+new.quantity>99999999.999
    then raise exception 'INVALID_INVENTORY_DATA' using errcode='22023'; end if;
  update public.ingredients set average_cost=(greatest(ingredient.current_stock,0)*ingredient.average_cost+new.quantity*new.unit_cost)
    /(greatest(ingredient.current_stock,0)+new.quantity),current_stock=ingredient.current_stock+new.quantity,version=version+1 where id=new.ingredient_id;
  insert into public.inventory_movements(branch_id,ingredient_id,type,quantity,unit_cost,purchase_id,created_by,notes)
    values(purchase_row.branch_id,new.ingredient_id,'purchase',new.quantity,new.unit_cost,new.purchase_id,purchase_row.received_by,purchase_row.notes);
  return new;
end;
$$;

create or replace function public.deduct_paid_order_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare usage record; ingredient public.ingredients;
begin
  if new.status='paid' and old.status<>'paid' and new.inventory_deducted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('inventory-branch:'||new.branch_id::text,0));
    for usage in select r.ingredient_id,sum(r.quantity*oi.quantity) as used_quantity
      from public.order_items oi join public.products p on p.id=oi.product_id and p.inventory_enabled
      join public.product_recipes r on r.product_id=p.id where oi.order_id=new.id group by r.ingredient_id order by r.ingredient_id loop
      select * into ingredient from public.ingredients where id=usage.ingredient_id for update;
      if ingredient.branch_id<>new.branch_id or not ingredient.is_active or ingredient.current_stock<usage.used_quantity
        then raise exception 'STOCK_INSUFFICIENT: %',ingredient.name using errcode='22023'; end if;
      update public.ingredients set current_stock=current_stock-usage.used_quantity,version=version+1 where id=ingredient.id;
      insert into public.inventory_movements(branch_id,ingredient_id,type,quantity,order_id,created_by,notes)
        values(new.branch_id,ingredient.id,'sale',-usage.used_quantity,new.id,(select auth.uid()),'Venta #'||new.order_number);
    end loop;
    new.inventory_deducted_at:=now();new.paid_at:=coalesce(new.paid_at,now());
  end if;
  return new;
end;
$$;

create or replace function public.get_business_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  select jsonb_build_object('id',id,'name',name,'address',coalesce(address,''),'version',settings_version) into result from public.branches where id=branch;
  return result;
end;
$$;

create or replace function public.get_sales_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb; start_at timestamptz; end_at timestamptz;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_REPORT_RANGE' using errcode='22023'; end if;
  start_at:=p_from::timestamp at time zone 'America/Mexico_City';end_at:=(p_to+1)::timestamp at time zone 'America/Mexico_City';
  select jsonb_build_object(
    'total',(select coalesce(sum(total),0) from public.orders where branch_id=branch and status='paid' and paid_at>=start_at and paid_at<end_at),
    'count',(select count(*) from public.orders where branch_id=branch and status='paid' and paid_at>=start_at and paid_at<end_at),
    'cancelled',(select count(*) from public.orders where branch_id=branch and status='cancelled' and cancelled_at>=start_at and cancelled_at<end_at),
    'methods',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (select p.method,sum(p.amount) as amount from public.payments p join public.orders o on o.id=p.order_id
      where o.branch_id=branch and o.status='paid' and o.paid_at>=start_at and o.paid_at<end_at group by p.method order by p.method) m),
    'products',(select coalesce(jsonb_agg(to_jsonb(i) order by amount desc,name),'[]') from (
      select oi.product_name as name,sum(oi.quantity) as quantity,sum(oi.subtotal) as amount from public.order_items oi join public.orders o on o.id=oi.order_id
      where o.branch_id=branch and o.status='paid' and o.paid_at>=start_at and o.paid_at<end_at group by oi.product_name) i),
    'purchases',(select coalesce(sum(total),0) from public.purchases where branch_id=branch and received_at>=start_at and received_at<end_at)
  ) into result;
  return result;
end;
$$;

revoke all on function private.inventory_number(jsonb,text,integer,numeric,numeric) from public,anon,authenticated;
revoke all on function public.get_inventory_dashboard(),public.inventory_action(text,uuid,integer,uuid,jsonb),
 public.get_business_settings(),public.get_sales_report(date,date) from public,anon,authenticated;
grant execute on function public.get_inventory_dashboard(),public.inventory_action(text,uuid,integer,uuid,jsonb),
 public.get_business_settings(),public.get_sales_report(date,date) to authenticated;
commit;
