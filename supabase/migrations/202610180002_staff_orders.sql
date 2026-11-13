-- Acceso interno y pedidos persistentes. Aplicar después de 202610170001.
-- Las escrituras pasan por funciones que verifican usuario, sucursal y versión.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.orders add column version integer not null default 1;
alter table public.orders add column save_request_id uuid;
alter table public.orders add column payment_request_id uuid;
create unique index orders_payment_request_unique on public.orders(payment_request_id) where payment_request_id is not null;
create unique index orders_one_open_table on public.orders(branch_id, table_label)
  where type = 'table' and status in ('draft', 'sent', 'preparing', 'ready');

-- Crear una cuenta de Auth no autoriza automáticamente a operar el negocio.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, role, is_active, branch_id)
  values(new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Personal'), 'cashier', false, null);
  return new;
end;
$$;

-- Mantener únicamente lectura por sucursal. El SQL Editor sigue siendo administrativo.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.branches, public.profiles, public.products, public.ingredients,
  public.product_recipes, public.suppliers, public.purchases, public.purchase_items,
  public.cash_register_sessions, public.orders, public.order_items, public.payments,
  public.tickets, public.price_overrides, public.inventory_movements to authenticated;

do $$
declare policy_row record;
begin
  for policy_row in select tablename, policyname from pg_policies where schemaname = 'public'
    and tablename = any(array['branches','profiles','products','ingredients','product_recipes','suppliers','purchases',
      'purchase_items','cash_register_sessions','orders','order_items','payments','tickets','price_overrides','inventory_movements'])
  loop
    execute format('drop policy %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end;
$$;

create policy staff_branch on public.branches for select to authenticated using(id = (select public.current_user_branch()));
create policy staff_profiles on public.profiles for select to authenticated using(
  id = (select auth.uid()) or (branch_id = (select public.current_user_branch()) and (select public.is_owner())));

do $$
declare table_name text;
begin
  foreach table_name in array array['products','ingredients','suppliers','purchases','cash_register_sessions','orders','inventory_movements'] loop
    execute format('create policy staff_branch_read on public.%I for select to authenticated using (branch_id = (select public.current_user_branch()))', table_name);
  end loop;
  foreach table_name in array array['order_items','payments','tickets'] loop
    execute format('create policy staff_order_read on public.%I for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())))', table_name);
  end loop;
end;
$$;
create policy staff_recipe_read on public.product_recipes for select to authenticated using(exists(
  select 1 from public.products p where p.id = product_id and p.branch_id = (select public.current_user_branch())));
create policy staff_purchase_read on public.purchase_items for select to authenticated using(exists(
  select 1 from public.purchases p where p.id = purchase_id and p.branch_id = (select public.current_user_branch())));
create policy staff_price_read on public.price_overrides for select to authenticated using(exists(
  select 1 from public.products p where p.id = product_id and p.branch_id = (select public.current_user_branch())));

-- Quitar el antiguo cobro que creaba una nueva orden en cada intento.
revoke execute on function public.complete_sale(public.order_type,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke execute on function public.handle_new_user(), public.deduct_paid_order_inventory(), public.receive_purchase_item(), public.set_updated_at() from public, anon, authenticated;

create function private.staff_branch() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare branch uuid;
begin
  select branch_id into branch from public.profiles where id = (select auth.uid()) and is_active;
  if branch is null then raise exception 'STAFF_REQUIRED' using errcode = '42501'; end if;
  return branch;
end;
$$;

create function private.order_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',o.id,'number',o.order_number,'version',o.version,'type',o.type,'table_label',o.table_label,
    'status',o.status,'total',o.total,'notes',coalesce(o.notes,''),'created_at',o.created_at,'paid_at',o.paid_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name,
      'quantity',i.quantity,'unit_price',i.unit_price) order by i.created_at,i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('method',p.method,'amount',p.amount) order by p.created_at,p.id)
      from public.payments p where p.order_id=o.id),'[]'::jsonb))
  from public.orders o where o.id=p_id;
$$;

create function public.list_pos_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare branch uuid := private.staff_branch(); result jsonb;
begin
  select coalesce(jsonb_agg(private.order_json(o.id) order by o.created_at desc), '[]'::jsonb) into result
  from public.orders o where o.branch_id=branch and (
    o.status in ('draft','sent','preparing','ready') or o.id in (
      select id from public.orders where branch_id=branch and status='paid' order by paid_at desc limit 100));
  return result;
end;
$$;

create function public.save_pos_order(
  p_id uuid, p_version integer, p_request_id uuid, p_type public.order_type,
  p_table_label text, p_items jsonb, p_notes text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  branch uuid := private.staff_branch(); old_order public.orders; snapshot jsonb;
  item_count integer; valid_count integer; is_new boolean; next_total numeric(12,2);
begin
  if p_id is null or p_request_id is null or p_version is null or p_version < 0
    or p_type is null or length(coalesce(p_notes,'')) > 300 then
    raise exception 'INVALID_ORDER' using errcode='22023';
  end if;
  if p_type='table' and (p_table_label is null or p_table_label !~ '^Mesa [1-5]$') then
    raise exception 'INVALID_TABLE' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'INVALID_ITEMS' using errcode='22023'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 100 then raise exception 'INVALID_ITEMS' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where
    jsonb_typeof(i->'quantity') is distinct from 'number' or coalesce(i->>'quantity','') !~ '^[1-9][0-9]{0,3}$'
    or coalesce(i->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    or (select count(distinct i->>'product_id') from jsonb_array_elements(p_items) i) <> item_count then
    raise exception 'INVALID_ITEMS' using errcode='22023';
  end if;

  -- Una sola escritura por orden; además serializar altas sobre la misma mesa.
  perform pg_advisory_xact_lock(hashtextextended(branch::text || ':' || p_id::text,0));
  if p_type='table' then perform pg_advisory_xact_lock(hashtextextended(branch::text || ':' || p_table_label,0)); end if;
  select * into old_order from public.orders where id=p_id for update;
  is_new := not found;
  if not is_new then
    if old_order.branch_id <> branch then raise exception 'ORDER_NOT_FOUND' using errcode='42501'; end if;
    if old_order.status in ('paid','cancelled') then raise exception 'ORDER_CLOSED' using errcode='P0001'; end if;
    if old_order.save_request_id = p_request_id then return private.order_json(p_id); end if;
    if old_order.version <> p_version then raise exception 'ORDER_CHANGED' using errcode='40001'; end if;
    if old_order.type <> p_type or (p_type='table' and old_order.table_label <> p_table_label) then
      raise exception 'ORDER_DESTINATION_CHANGED' using errcode='22023';
    end if;
  elsif p_version <> 0 then raise exception 'ORDER_NOT_FOUND' using errcode='42501';
  end if;

  if p_type='table' and exists(select 1 from public.orders where branch_id=branch and table_label=p_table_label
    and type='table' and status in ('draft','sent','preparing','ready') and id<>p_id) then
    raise exception 'TABLE_OCCUPIED' using errcode='23505';
  end if;

  select count(*), jsonb_agg(jsonb_build_object('product_id',p.id,'name',coalesce(oi.product_name,p.name),
    'quantity',(i->>'quantity')::integer,'price',coalesce(oi.unit_price,p.price)))
    into valid_count,snapshot
  from jsonb_array_elements(p_items) i
  join public.products p on p.id=(i->>'product_id')::uuid and p.branch_id=branch and p.is_active
  left join public.order_items oi on oi.order_id=p_id and oi.product_id=p.id;
  if valid_count <> item_count then raise exception 'PRODUCT_UNAVAILABLE' using errcode='22023'; end if;

  if is_new then
    insert into public.orders(id,branch_id,type,table_label,created_by)
      values(p_id,branch,p_type,case when p_type='table' then p_table_label end,(select auth.uid()));
  end if;
  delete from public.order_items where order_id=p_id;
  insert into public.order_items(order_id,product_id,product_name,quantity,unit_price)
    select p_id,(i->>'product_id')::uuid,i->>'name',(i->>'quantity')::integer,(i->>'price')::numeric
    from jsonb_array_elements(snapshot) i;
  select sum(subtotal) into next_total from public.order_items where order_id=p_id;
  update public.orders set notes=nullif(trim(p_notes),''),subtotal=next_total,total=next_total,discount=0,
    version=case when is_new then 1 else old_order.version+1 end,save_request_id=p_request_id where id=p_id;
  return private.order_json(p_id);
end;
$$;

create function public.pay_pos_order(p_id uuid,p_version integer,p_request_id uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare branch uuid := private.staff_branch(); current_order public.orders; payment_sum numeric; cash_session uuid;
begin
  if p_id is null or p_request_id is null then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text || ':' || p_id::text,0));
  select * into current_order from public.orders where id=p_id and branch_id=branch for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='42501'; end if;
  if current_order.status='paid' and current_order.payment_request_id=p_request_id then return private.order_json(p_id); end if;
  if current_order.status in ('paid','cancelled') then raise exception 'ORDER_CLOSED' using errcode='P0001'; end if;
  if p_version is distinct from current_order.version then raise exception 'ORDER_CHANGED' using errcode='40001'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  if jsonb_array_length(p_payments) not between 1 and 3 or exists(
    select 1 from jsonb_array_elements(p_payments) p where coalesce(p->>'method','') not in ('cash','card','transfer')
    or jsonb_typeof(p->'amount') is distinct from 'number' or coalesce(p->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or (p->>'amount')::numeric <= 0 or (p->>'amount')::numeric > 99999999)
    or (select count(distinct p->>'method') from jsonb_array_elements(p_payments) p) <> jsonb_array_length(p_payments) then
    raise exception 'INVALID_PAYMENT' using errcode='22023';
  end if;
  select sum((p->>'amount')::numeric) into payment_sum from jsonb_array_elements(p_payments) p;
  if current_order.total <= 0 or payment_sum <> current_order.total then raise exception 'PAYMENT_MISMATCH' using errcode='22023'; end if;
  -- Caja será un módulo posterior. Se vincula si existe una apertura; no se inventa una.
  select id into cash_session from public.cash_register_sessions where branch_id=branch and status='open' for share;
  insert into public.payments(order_id,method,amount,received_by)
    select p_id,(p->>'method')::public.payment_method,(p->>'amount')::numeric,(select auth.uid()) from jsonb_array_elements(p_payments) p;
  update public.orders set status='paid',paid_at=now(),payment_request_id=p_request_id,version=version+1,cash_session_id=cash_session where id=p_id;
  insert into public.tickets(order_id,format) values(p_id,'digital');
  return private.order_json(p_id);
end;
$$;

create function public.cancel_pos_order(p_id uuid,p_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare branch uuid := private.staff_branch(); current_order public.orders;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 300 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text || ':' || p_id::text,0));
  select * into current_order from public.orders where id=p_id and branch_id=branch for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='42501'; end if;
  if current_order.status in ('paid','cancelled') then raise exception 'ORDER_CLOSED' using errcode='P0001'; end if;
  if p_version is distinct from current_order.version then raise exception 'ORDER_CHANGED' using errcode='40001'; end if;
  update public.orders set status='cancelled',cancelled_at=now(),cancelled_by=(select auth.uid()),
    cancellation_reason=trim(p_reason),version=version+1 where id=p_id;
  return private.order_json(p_id);
end;
$$;

revoke all on all functions in schema private from public,anon,authenticated;
revoke execute on function public.list_pos_orders(),
  public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text),
  public.pay_pos_order(uuid,integer,uuid,jsonb),public.cancel_pos_order(uuid,integer,text) from public,anon;
grant execute on function public.list_pos_orders(),
  public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text),
  public.pay_pos_order(uuid,integer,uuid,jsonb),public.cancel_pos_order(uuid,integer,text) to authenticated;

commit;
