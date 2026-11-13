-- Los Chanchitos: instalación inicial, SÓLO para el proyecto NUEVO y vacío.

-- Confirma el nombre y la URL del proyecto en el panel antes de ejecutar.

-- No ejecutar en tu otro proyecto ni en una instalación ya configurada.

-- Todo se ejecuta en una transacción; un error revierte esta instalación.

-- Generado desde check_new_project.sql, las seis migraciones y seed.sql.

-- No editar este archivo por separado. Verificar con npm run supabase:check.

begin;

-- Fuente: check_new_project.sql
-- Esta comprobación sólo lee metadatos. Se incluye al inicio del instalador.
-- No identifica por sí sola el proyecto: confirma también nombre y URL en el panel.
do $check_new_project$
declare
  has_buckets boolean;
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  ) then
    raise exception 'INSTALACION_DETENIDA: public ya tiene tablas, vistas o secuencias. Usa el proyecto NUEVO de Los Chanchitos; no borres los datos existentes.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd', 'c')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
      )
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
  ) then
    raise exception 'INSTALACION_DETENIDA: public ya tiene tipos o funciones de una aplicación. Revisa el proyecto seleccionado sin modificarlo.';
  end if;

  if exists (select 1 from auth.users) then
    raise exception 'INSTALACION_DETENIDA: ya existen usuarios de Auth. El instalador es sólo para un proyecto nuevo, antes de crear cuentas de personal.';
  end if;

  if to_regclass('storage.buckets') is not null then
    execute 'select exists (select 1 from storage.buckets)' into has_buckets;
    if has_buckets then
      raise exception 'INSTALACION_DETENIDA: ya existen depósitos de Storage. No se modificó su contenido; verifica el proyecto nuevo.';
    end if;
  end if;
end;
$check_new_project$;

-- Fuente: migrations/202610170001_initial_schema.sql
-- Los Chanchitos · esquema inicial
-- Ejecutar con `supabase db push` o pegar en el SQL Editor de Supabase.

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'cashier');
create type public.order_type as enum ('table', 'takeaway');
create type public.order_status as enum ('draft', 'sent', 'preparing', 'ready', 'paid', 'cancelled');
create type public.payment_method as enum ('cash', 'card', 'transfer');
create type public.cash_session_status as enum ('open', 'closed');
create type public.inventory_movement_type as enum ('purchase', 'sale', 'adjustment', 'waste', 'cancellation');
create type public.ticket_format as enum ('digital', 'printed');

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null default 'America/Mexico_City',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  branch_id uuid references public.branches(id),
  full_name text not null,
  role public.user_role not null default 'cashier',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null,
  category text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null,
  unit text not null check (unit in ('kg', 'g', 'l', 'ml', 'piece')),
  current_stock numeric(12,3) not null default 0,
  minimum_stock numeric(12,3) not null default 0,
  average_cost numeric(12,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.product_recipes (
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(12,3) not null check (quantity > 0),
  primary key (product_id, ingredient_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  supplier_id uuid references public.suppliers(id),
  reference text,
  total numeric(12,2) not null default 0 check (total >= 0),
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(12,4) not null check (unit_cost >= 0),
  subtotal numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored
);

create table public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  status public.cash_session_status not null default 'open',
  opening_amount numeric(12,2) not null check (opening_amount >= 0),
  expected_amount numeric(12,2),
  closing_amount numeric(12,2),
  difference numeric(12,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  check ((status = 'open' and closed_at is null) or status = 'closed')
);

create unique index one_open_cash_session_per_branch
  on public.cash_register_sessions (branch_id) where status = 'open';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  cash_session_id uuid references public.cash_register_sessions(id),
  order_number bigint generated by default as identity,
  type public.order_type not null,
  table_label text,
  status public.order_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0,
  notes text,
  created_by uuid not null references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  inventory_deducted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  check ((type = 'table' and table_label is not null) or type = 'takeaway')
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  notes text,
  subtotal numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  received_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  format public.ticket_format not null,
  recipient text,
  sent_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.price_overrides (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  previous_price numeric(10,2) not null,
  new_price numeric(10,2) not null,
  reason text not null,
  requested_by uuid not null references public.profiles(id),
  authorized_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (previous_price <> new_price)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ingredient_id uuid not null references public.ingredients(id),
  type public.inventory_movement_type not null,
  quantity numeric(12,3) not null check (quantity <> 0),
  unit_cost numeric(12,4),
  order_id uuid references public.orders(id),
  purchase_id uuid references public.purchases(id),
  created_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create index orders_branch_created_idx on public.orders (branch_id, created_at desc);
create index orders_status_idx on public.orders (branch_id, status);
create index inventory_movements_ingredient_idx on public.inventory_movements (ingredient_id, created_at desc);
create index products_branch_active_idx on public.products (branch_id, is_active);

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger ingredients_updated_at before update on public.ingredients
for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare default_branch uuid;
begin
  select id into default_branch from public.branches where is_active limit 1;
  insert into public.profiles (id, branch_id, full_name, role)
  values (
    new.id,
    default_branch,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'user_role' = 'owner' then 'owner'::public.user_role else 'cashier'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active;
$$;

create function public.current_user_branch() returns uuid
language sql stable security definer set search_path = '' as $$
  select branch_id from public.profiles where id = (select auth.uid()) and is_active;
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = 'owner'::public.user_role, false);
$$;

-- Al pasar una orden a pagada, descuenta una sola vez los ingredientes de su receta.
create function public.deduct_paid_order_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.inventory_deducted_at is null then
    update public.ingredients i
      set current_stock = i.current_stock - usage.used_quantity
      from (
        select pr.ingredient_id, sum(pr.quantity * oi.quantity)::numeric(12,3) as used_quantity
        from public.order_items oi
        join public.product_recipes pr on pr.product_id = oi.product_id
        where oi.order_id = new.id
        group by pr.ingredient_id
      ) usage
      where i.id = usage.ingredient_id;

    insert into public.inventory_movements (branch_id, ingredient_id, type, quantity, order_id, created_by, notes)
      select new.branch_id, pr.ingredient_id, 'sale', -sum(pr.quantity * oi.quantity), new.id, new.created_by,
             'Descuento automático por venta #' || new.order_number
      from public.order_items oi
      join public.product_recipes pr on pr.product_id = oi.product_id
      where oi.order_id = new.id
      group by pr.ingredient_id;

    new.inventory_deducted_at = now();
    new.paid_at = coalesce(new.paid_at, now());
  end if;
  return new;
end;
$$;

create trigger deduct_inventory_on_payment before update of status on public.orders
for each row execute function public.deduct_paid_order_inventory();

-- Las entradas de compra actualizan existencias y costo promedio.
create function public.receive_purchase_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare purchase_row public.purchases;
begin
  select * into purchase_row from public.purchases where id = new.purchase_id;
  update public.ingredients
    set average_cost = case when current_stock + new.quantity = 0 then new.unit_cost
      else ((current_stock * average_cost) + (new.quantity * new.unit_cost)) / (current_stock + new.quantity) end,
        current_stock = current_stock + new.quantity
    where id = new.ingredient_id;
  insert into public.inventory_movements (branch_id, ingredient_id, type, quantity, unit_cost, purchase_id, created_by)
    values (purchase_row.branch_id, new.ingredient_id, 'purchase', new.quantity, new.unit_cost, new.purchase_id, purchase_row.received_by);
  return new;
end;
$$;

create trigger add_stock_on_purchase after insert on public.purchase_items
for each row execute function public.receive_purchase_item();

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.ingredients enable row level security;
alter table public.product_recipes enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.cash_register_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.price_overrides enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on all tables in schema public from anon;
grant select, insert, update on public.profiles, public.products, public.ingredients, public.product_recipes,
  public.suppliers, public.purchases, public.purchase_items, public.cash_register_sessions, public.orders,
  public.order_items, public.payments, public.tickets, public.price_overrides, public.inventory_movements,
  public.branches to authenticated;

create policy "authenticated branch" on public.branches for select to authenticated
  using (id = (select public.current_user_branch()));
create policy "profile self or owner select" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()));
create policy "owner manages profiles" on public.profiles for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy "branch reads products" on public.products for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "owner inserts products" on public.products for insert to authenticated
  with check ((select public.is_owner()) and branch_id = (select public.current_user_branch()));
create policy "owner updates products" on public.products for update to authenticated
  using ((select public.is_owner()) and branch_id = (select public.current_user_branch()));

create policy "branch reads ingredients" on public.ingredients for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "owner manages ingredients" on public.ingredients for all to authenticated
  using ((select public.is_owner()) and branch_id = (select public.current_user_branch()))
  with check ((select public.is_owner()) and branch_id = (select public.current_user_branch()));
create policy "branch reads recipes" on public.product_recipes for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.branch_id = (select public.current_user_branch())));
create policy "owner manages recipes" on public.product_recipes for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy "branch reads suppliers" on public.suppliers for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "owner manages suppliers" on public.suppliers for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "branch reads purchases" on public.purchases for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "staff creates purchases" on public.purchases for insert to authenticated
  with check (branch_id = (select public.current_user_branch()) and received_by = (select auth.uid()));
create policy "branch reads purchase items" on public.purchase_items for select to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id and p.branch_id = (select public.current_user_branch())));
create policy "staff creates purchase items" on public.purchase_items for insert to authenticated
  with check (exists (select 1 from public.purchases p where p.id = purchase_id and p.branch_id = (select public.current_user_branch())));

create policy "branch reads cash sessions" on public.cash_register_sessions for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "staff opens cash session" on public.cash_register_sessions for insert to authenticated
  with check (branch_id = (select public.current_user_branch()) and opened_by = (select auth.uid()));
create policy "staff closes own or owner closes cash" on public.cash_register_sessions for update to authenticated
  using (branch_id = (select public.current_user_branch()) and (opened_by = (select auth.uid()) or (select public.is_owner())));

create policy "branch reads orders" on public.orders for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "staff creates orders" on public.orders for insert to authenticated
  with check (branch_id = (select public.current_user_branch()) and created_by = (select auth.uid()));
create policy "staff updates branch orders" on public.orders for update to authenticated
  using (branch_id = (select public.current_user_branch())) with check (branch_id = (select public.current_user_branch()));
create policy "branch reads order items" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));
create policy "staff creates order items" on public.order_items for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));
create policy "staff updates order items" on public.order_items for update to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));

create policy "branch reads payments" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));
create policy "staff creates payments" on public.payments for insert to authenticated
  with check (received_by = (select auth.uid()) and exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));
create policy "branch handles tickets" on public.tickets for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())))
  with check (exists (select 1 from public.orders o where o.id = order_id and o.branch_id = (select public.current_user_branch())));

create policy "branch reads inventory movements" on public.inventory_movements for select to authenticated
  using (branch_id = (select public.current_user_branch()));
create policy "owner makes adjustments" on public.inventory_movements for insert to authenticated
  with check ((select public.is_owner()) and branch_id = (select public.current_user_branch()));
create policy "branch reads price overrides" on public.price_overrides for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.branch_id = (select public.current_user_branch())));
create policy "owner authorizes prices" on public.price_overrides for insert to authenticated
  with check ((select public.is_owner()) and authorized_by = (select auth.uid()));

revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.current_user_branch() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_branch() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- Punto transaccional único para registrar venta, pagos y descuento de inventario.
create function public.complete_sale(
  p_type public.order_type,
  p_table_label text,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_branch uuid;
  v_cash_session uuid;
  v_order uuid;
  v_total numeric(12,2);
  v_payment_total numeric(12,2);
begin
  select branch_id into v_branch from public.profiles where id = v_user and is_active;
  if v_branch is null then raise exception 'Usuario sin perfil activo'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene productos'; end if;
  if p_type = 'table' and nullif(trim(p_table_label), '') is null then raise exception 'Falta la mesa'; end if;

  select id into v_cash_session from public.cash_register_sessions
    where branch_id = v_branch and status = 'open' order by opened_at desc limit 1;

  insert into public.orders (branch_id, cash_session_id, type, table_label, status, notes, created_by)
    values (v_branch, v_cash_session, p_type, case when p_type = 'table' then p_table_label end, 'draft', p_notes, v_user)
    returning id into v_order;

  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
    select v_order, p.id, p.name, greatest((item ->> 'quantity')::integer, 1), p.price
    from jsonb_array_elements(p_items) item
    join public.products p on p.id = (item ->> 'product_id')::uuid
    where p.branch_id = v_branch and p.is_active;

  select coalesce(sum(subtotal), 0) into v_total from public.order_items where order_id = v_order;
  if v_total <= 0 then raise exception 'La orden no contiene productos válidos'; end if;

  insert into public.payments (order_id, method, amount, reference, received_by)
    select v_order, (payment ->> 'method')::public.payment_method,
           (payment ->> 'amount')::numeric, nullif(payment ->> 'reference', ''), v_user
    from jsonb_array_elements(p_payments) payment;

  select coalesce(sum(amount), 0) into v_payment_total from public.payments where order_id = v_order;
  if round(v_payment_total, 2) <> round(v_total, 2) then
    raise exception 'Los pagos (%) no coinciden con el total (%)', v_payment_total, v_total;
  end if;

  update public.orders set subtotal = v_total, total = v_total, status = 'paid' where id = v_order;
  return v_order;
end;
$$;

revoke execute on function public.complete_sale(public.order_type, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.complete_sale(public.order_type, text, jsonb, jsonb, text) to authenticated;

-- Fuente: migrations/202610180002_staff_orders.sql
-- Acceso interno y pedidos persistentes. Aplicar después de 202610170001.
-- Las escrituras pasan por funciones que verifican usuario, sucursal y versión.

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


-- Fuente: migrations/202610190003_order_conflict_http.sql
-- Un conflicto de versión es definitivo, no un fallo transitorio de serialización.
-- SQLSTATE 40001 hace que PostgREST 14 reintente la transacción indefinidamente.
-- PT409 devuelve HTTP 409 y conserva el mensaje ORDER_CHANGED de la interfaz.
-- Actualización acotada: no borra datos, no cambia permisos ni recrea el esquema.

do $migration$
declare
  signature text;
  function_id regprocedure;
  definition text;
  legacy constant text := $old$raise exception 'ORDER_CHANGED' using errcode='40001'$old$;
  corrected constant text := $new$raise exception 'ORDER_CHANGED' using errcode='PT409'$new$;
begin
  foreach signature in array array[
    'public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text)',
    'public.pay_pos_order(uuid,integer,uuid,jsonb)',
    'public.cancel_pos_order(uuid,integer,text)'
  ] loop
    function_id := to_regprocedure(signature);
    if function_id is null then
      raise exception 'CONFLICT_FIX_STOPPED: función requerida ausente: %', signature;
    end if;
    definition := pg_get_functiondef(function_id);
    if strpos(definition, legacy) > 0 then
      if (length(definition) - length(replace(definition, legacy, ''))) / length(legacy) <> 1
        or strpos(definition, corrected) > 0 then
        raise exception 'CONFLICT_FIX_STOPPED: revisar definición de %', signature;
      end if;
      -- pg_get_functiondef produce CREATE OR REPLACE y preserva la configuración.
      -- CREATE OR REPLACE conserva propietario y permisos existentes.
      execute replace(definition, legacy, corrected);
    elsif strpos(definition, corrected) = 0 or strpos(definition, '40001') > 0 then
      raise exception 'CONFLICT_FIX_STOPPED: definición inesperada de %', signature;
    end if;
  end loop;
end;
$migration$;


-- Fuente: migrations/202610210004_cash_register.sql
-- Caja compartida por sucursal. No modifica ventas anteriores ni crea aperturas.
-- Aplicar después de la migración 003; no ejecutar el instalador ni el seed.

alter table public.cash_register_sessions add column if not exists closed_summary jsonb;

drop policy if exists staff_branch_read on public.cash_register_sessions;
drop policy if exists owner_cash_read on public.cash_register_sessions;
create policy owner_cash_read on public.cash_register_sessions for select to authenticated
  using (branch_id=(select public.current_user_branch()) and (select public.is_owner()));

create or replace function private.cash_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'status',s.status,'opening_amount',s.opening_amount,
    'opened_at',s.opened_at,'closed_at',s.closed_at,'closing_amount',s.closing_amount,
    'difference',s.difference,'notes',coalesce(s.notes,''),
    'opened_by_name',(select full_name from public.profiles where id=s.opened_by),
    'closed_by_name',(select full_name from public.profiles where id=s.closed_by)
  ) || case when s.status='closed' and s.closed_summary is not null then s.closed_summary else
    jsonb_build_object('sales_count',t.sales_count,'cash_sales',t.cash_sales,'card_sales',t.card_sales,
      'transfer_sales',t.transfer_sales,'total_sales',t.cash_sales+t.card_sales+t.transfer_sales,
      'expected_amount',s.opening_amount+t.cash_sales) end
  from public.cash_register_sessions s cross join lateral (
    select count(distinct o.id)::integer as sales_count,
      coalesce(sum(p.amount) filter(where p.method='cash'),0) as cash_sales,
      coalesce(sum(p.amount) filter(where p.method='card'),0) as card_sales,
      coalesce(sum(p.amount) filter(where p.method='transfer'),0) as transfer_sales
    from public.orders o join public.payments p on p.order_id=o.id
    where o.cash_session_id=s.id and o.status='paid'
  ) t where s.id=p_id;
$$;

create or replace function public.get_pos_cash_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch();
begin
  return jsonb_build_object('open',exists(select 1 from public.cash_register_sessions where branch_id=branch and status='open'));
end;
$$;

create or replace function public.get_cash_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object(
    'current',(select private.cash_json(id) from public.cash_register_sessions where branch_id=branch and status='open'),
    'history',coalesce((select jsonb_agg(private.cash_json(id) order by closed_at desc,id)
      from (select id,closed_at from public.cash_register_sessions where branch_id=branch and status='closed'
        order by closed_at desc,id limit 30) recent),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.open_cash_session(p_id uuid,p_opening_amount numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); existing public.cash_register_sessions;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_opening_amount is null or p_opening_amount<0 or p_opening_amount>99999999.99
    or p_opening_amount<>round(p_opening_amount,2) then raise exception 'INVALID_CASH_AMOUNT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':cash-register',0));
  select * into existing from public.cash_register_sessions where id=p_id for update;
  if found then
    if existing.branch_id<>branch then raise exception 'CASH_NOT_FOUND' using errcode='42501'; end if;
    if existing.opening_amount<>p_opening_amount then raise exception 'CASH_REQUEST_CHANGED' using errcode='PT409'; end if;
    return private.cash_json(p_id);
  end if;
  if exists(select 1 from public.cash_register_sessions where branch_id=branch and status='open') then
    raise exception 'CASH_ALREADY_OPEN' using errcode='PT409';
  end if;
  insert into public.cash_register_sessions(id,branch_id,opened_by,opening_amount)
    values(p_id,branch,(select auth.uid()),p_opening_amount);
  return private.cash_json(p_id);
end;
$$;

create or replace function public.close_cash_session(p_id uuid,p_closing_amount numeric,p_sales_count integer,p_notes text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); current_session public.cash_register_sessions; summary jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_closing_amount is null or p_closing_amount<0 or p_closing_amount>99999999.99
    or p_closing_amount<>round(p_closing_amount,2) or p_sales_count is null or p_sales_count<0
    or length(coalesce(p_notes,''))>300 then raise exception 'INVALID_CASH_AMOUNT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':cash-register',0));
  select * into current_session from public.cash_register_sessions where id=p_id and branch_id=branch for update;
  if not found then raise exception 'CASH_NOT_FOUND' using errcode='42501'; end if;
  if current_session.status='closed' then
    if current_session.closing_amount=p_closing_amount and coalesce(current_session.notes,'')=trim(coalesce(p_notes,'')) then
      return private.cash_json(p_id);
    end if;
    raise exception 'CASH_CLOSED' using errcode='PT409';
  end if;
  -- El bloqueo de esta fila espera los cobros en curso. Los cobros nuevos deberán
  -- volver a comprobar que la misma fila siga abierta después de esperar.
  summary:=private.cash_json(p_id);
  if (summary->>'sales_count')::integer<>p_sales_count then raise exception 'CASH_CHANGED' using errcode='PT409'; end if;
  update public.cash_register_sessions set status='closed',closed_at=now(),closed_by=(select auth.uid()),
    expected_amount=(summary->>'expected_amount')::numeric,closing_amount=p_closing_amount,
    difference=p_closing_amount-(summary->>'expected_amount')::numeric,notes=nullif(trim(p_notes),''),
    closed_summary=jsonb_build_object('sales_count',summary->'sales_count','cash_sales',summary->'cash_sales',
      'card_sales',summary->'card_sales','transfer_sales',summary->'transfer_sales',
      'total_sales',summary->'total_sales','expected_amount',summary->'expected_amount') where id=p_id;
  return private.cash_json(p_id);
end;
$$;

create or replace function public.pay_pos_order(p_id uuid,p_version integer,p_request_id uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); current_order public.orders; payment_sum numeric; cash_session uuid;
begin
  if p_id is null or p_request_id is null then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':'||p_id::text,0));
  select * into current_order from public.orders where id=p_id and branch_id=branch for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='42501'; end if;
  if current_order.status='paid' and current_order.payment_request_id=p_request_id then return private.order_json(p_id); end if;
  if current_order.status in ('paid','cancelled') then raise exception 'ORDER_CLOSED' using errcode='P0001'; end if;
  if p_version is distinct from current_order.version then raise exception 'ORDER_CHANGED' using errcode='PT409'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  if jsonb_array_length(p_payments) not between 1 and 3 or exists(
    select 1 from jsonb_array_elements(p_payments) p where coalesce(p->>'method','') not in ('cash','card','transfer')
    or jsonb_typeof(p->'amount') is distinct from 'number' or coalesce(p->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or (p->>'amount')::numeric<=0 or (p->>'amount')::numeric>99999999)
    or (select count(distinct p->>'method') from jsonb_array_elements(p_payments) p)<>jsonb_array_length(p_payments) then
    raise exception 'INVALID_PAYMENT' using errcode='22023';
  end if;
  select sum((p->>'amount')::numeric) into payment_sum from jsonb_array_elements(p_payments) p;
  if current_order.total<=0 or payment_sum<>current_order.total then raise exception 'PAYMENT_MISMATCH' using errcode='22023'; end if;
  select id into cash_session from public.cash_register_sessions where branch_id=branch and status='open' for share;
  if cash_session is null then raise exception 'CASH_REQUIRED' using errcode='P0001'; end if;
  insert into public.payments(order_id,method,amount,received_by)
    select p_id,(p->>'method')::public.payment_method,(p->>'amount')::numeric,(select auth.uid()) from jsonb_array_elements(p_payments) p;
  update public.orders set status='paid',paid_at=now(),payment_request_id=p_request_id,version=version+1,cash_session_id=cash_session where id=p_id;
  insert into public.tickets(order_id,format) values(p_id,'digital');
  return private.order_json(p_id);
end;
$$;

revoke all on function private.cash_json(uuid) from public,anon,authenticated;
revoke all on function public.get_pos_cash_status(),public.get_cash_dashboard(),public.open_cash_session(uuid,numeric),
  public.close_cash_session(uuid,numeric,integer,text) from public,anon,authenticated;
grant execute on function public.get_pos_cash_status(),public.get_cash_dashboard(),public.open_cash_session(uuid,numeric),
  public.close_cash_session(uuid,numeric,integer,text) to authenticated;
revoke execute on function public.pay_pos_order(uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.pay_pos_order(uuid,integer,uuid,jsonb) to authenticated;


-- Fuente: migrations/202610220005_menu_management.sql
-- Administración del menú por Dueño. No cambia productos, precios o pedidos existentes.

alter table public.products add column if not exists version integer not null default 1;
create unique index if not exists products_branch_name_unique on public.products(branch_id,lower(btrim(name)));

create table if not exists public.product_changes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  request_id uuid not null unique,
  actor_id uuid not null references public.profiles(id),
  reason text not null,
  request_payload jsonb not null,
  before_values jsonb,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.product_changes enable row level security;
revoke all on public.product_changes from public,anon,authenticated;
grant select on public.product_changes to authenticated;
drop policy if exists owner_product_changes on public.product_changes;
create policy owner_product_changes on public.product_changes for select to authenticated
  using(branch_id=(select public.current_user_branch()) and (select public.is_owner()));
create index if not exists product_changes_branch_date on public.product_changes(branch_id,created_at desc);

create or replace function private.menu_product_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',id,'name',name,'category',category,'description',coalesce(description,''),
    'price',price,'is_active',is_active,'version',version,'sort_order',sort_order)
  from public.products where id=p_id;
$$;

create or replace function public.list_pos_products() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  select coalesce(jsonb_agg(private.menu_product_json(id) order by sort_order,name,id),'[]'::jsonb)
    into result from public.products where branch_id=branch and is_active;
  return result;
end;
$$;

create or replace function public.get_menu_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object(
    'products',(select coalesce(jsonb_agg(private.menu_product_json(id) order by sort_order,name,id),'[]'::jsonb)
      from public.products where branch_id=branch),
    'changes',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reason',c.reason,'before',c.before_values,
      'after',c.after_values,'created_at',c.created_at,'actor_name',p.full_name) order by c.created_at desc,c.id),'[]'::jsonb)
      from (select * from public.product_changes where branch_id=branch order by created_at desc,id limit 30) c
      join public.profiles p on p.id=c.actor_id)) into result;
  return result;
end;
$$;

create or replace function public.save_menu_product(p_id uuid,p_version integer,p_request_id uuid,
  p_name text,p_category text,p_description text,p_price numeric,p_is_active boolean,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  branch uuid:=private.staff_branch(); old_product public.products; previous_event public.product_changes;
  payload jsonb; before_json jsonb; after_json jsonb; reason text; is_new boolean;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_request_id is null or p_version is null or p_version<0 or p_is_active is null
    or length(trim(coalesce(p_name,''))) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or length(trim(coalesce(p_category,''))) not between 1 and 40 or p_category ~ '[[:cntrl:]]'
    or length(trim(coalesce(p_description,'')))>160 or length(trim(coalesce(p_reason,'')))>300
    or p_price is null or p_price<=0 or p_price>99999999.99 or p_price<>round(p_price,2) then
    raise exception 'INVALID_PRODUCT' using errcode='22023';
  end if;
  payload:=jsonb_build_object('id',p_id,'version',p_version,'name',trim(p_name),'category',trim(p_category),
    'description',trim(coalesce(p_description,'')),'price',p_price,'is_active',p_is_active,'reason',trim(coalesce(p_reason,'')));
  -- Serializa reintentos incluso si se reutiliza por error una clave en otro producto.
  perform pg_advisory_xact_lock(hashtextextended('menu-request:'||p_request_id::text,0));
  select * into previous_event from public.product_changes where request_id=p_request_id;
  if found then
    if previous_event.branch_id<>branch or previous_event.actor_id<>(select auth.uid()) or previous_event.request_payload<>payload then
      raise exception 'PRODUCT_REQUEST_CHANGED' using errcode='PT409';
    end if;
    return private.menu_product_json(p_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':product:'||p_id::text,0));
  select * into old_product from public.products where id=p_id for update;
  is_new:=not found;
  if not is_new then
    if old_product.branch_id<>branch then raise exception 'PRODUCT_NOT_FOUND' using errcode='42501'; end if;
    if old_product.version<>p_version then raise exception 'PRODUCT_CHANGED' using errcode='PT409'; end if;
    if old_product.name=trim(p_name) and old_product.category=trim(p_category)
      and coalesce(old_product.description,'')=trim(coalesce(p_description,''))
      and old_product.price=p_price and old_product.is_active=p_is_active then
      raise exception 'PRODUCT_NO_CHANGE' using errcode='22023';
    end if;
    before_json:=private.menu_product_json(p_id);
    if (old_product.price<>p_price or old_product.is_active<>p_is_active) and length(trim(coalesce(p_reason,'')))<3 then
      raise exception 'PRODUCT_REASON_REQUIRED' using errcode='22023';
    end if;
  elsif p_version<>0 then raise exception 'PRODUCT_NOT_FOUND' using errcode='42501';
  end if;
  reason:=coalesce(nullif(trim(p_reason),''),case when is_new then 'Alta de producto' else 'Actualización de datos' end);
  if is_new then
    insert into public.products(id,branch_id,name,category,description,price,is_active,sort_order)
      values(p_id,branch,trim(p_name),trim(p_category),nullif(trim(p_description),''),p_price,p_is_active,
        (select coalesce(max(sort_order),0)+1 from public.products where branch_id=branch));
  else
    update public.products set name=trim(p_name),category=trim(p_category),description=nullif(trim(p_description),''),
      price=p_price,is_active=p_is_active,version=version+1 where id=p_id;
    if old_product.price<>p_price then
      insert into public.price_overrides(product_id,previous_price,new_price,reason,requested_by,authorized_by)
        values(p_id,old_product.price,p_price,reason,(select auth.uid()),(select auth.uid()));
    end if;
  end if;
  after_json:=private.menu_product_json(p_id);
  insert into public.product_changes(branch_id,product_id,request_id,actor_id,reason,request_payload,before_values,after_values)
    values(branch,p_id,p_request_id,(select auth.uid()),reason,payload,before_json,after_json);
  return after_json;
end;
$$;

revoke all on function private.menu_product_json(uuid) from public,anon,authenticated;
revoke all on function public.list_pos_products(),public.get_menu_dashboard(),
  public.save_menu_product(uuid,integer,uuid,text,text,text,numeric,boolean,text) from public,anon,authenticated;
grant execute on function public.list_pos_products(),public.get_menu_dashboard(),
  public.save_menu_product(uuid,integer,uuid,text,text,text,numeric,boolean,text) to authenticated;


-- Fuente: migrations/202610260006_self_service_inventory.sql
-- Inventario autogestionable. No carga recetas, ingredientes, existencias ni compras ficticias.
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

-- Fuente: seed.sql
insert into public.branches (id, name, address)
values ('11111111-1111-1111-1111-111111111111', 'Los Chanchitos · Matriz', 'Sucursal única')
on conflict (id) do nothing;

-- Menú transcrito de la información entregada por el negocio.
-- No se inventan recetas ni existencias: se cargarán cuando el negocio las confirme.
insert into public.products (branch_id, name, category, description, price, sort_order) values
('11111111-1111-1111-1111-111111111111', 'Tacos', 'Antojitos', 'Orden', 25, 1),
('11111111-1111-1111-1111-111111111111', 'Cemitas', 'Antojitos', 'Pieza', 30, 2),
('11111111-1111-1111-1111-111111111111', 'Tacos dorados', 'Antojitos', 'Orden', 25, 3),
('11111111-1111-1111-1111-111111111111', 'Kilo', 'Por peso', '1 kilogramo', 310, 4),
('11111111-1111-1111-1111-111111111111', 'Medio kilo', 'Por peso', '500 gramos', 170, 5),
('11111111-1111-1111-1111-111111111111', 'Cuarto de kilo', 'Por peso', '250 gramos', 100, 6),
('11111111-1111-1111-1111-111111111111', 'Mojarra', 'Platillos', 'Platillo', 120, 7),
('11111111-1111-1111-1111-111111111111', 'Pozole', 'Platillos', 'Plato', 80, 8),
('11111111-1111-1111-1111-111111111111', 'Mole de panza', 'Platillos', 'Plato', 90, 9),
('11111111-1111-1111-1111-111111111111', 'Mixiote de carnero', 'Platillos', 'Platillo', 90, 10),
('11111111-1111-1111-1111-111111111111', 'Pollo', 'Platillos', 'Platillo', 80, 11),
('11111111-1111-1111-1111-111111111111', 'Desayuno', 'Menú del día', 'En el local', 80, 12),
('11111111-1111-1111-1111-111111111111', 'Desayuno para llevar', 'Menú del día', 'Para llevar', 85, 13),
('11111111-1111-1111-1111-111111111111', 'Comida corrida', 'Menú del día', 'En el local', 90, 14),
('11111111-1111-1111-1111-111111111111', 'Comida corrida para llevar', 'Menú del día', 'Para llevar', 95, 15),
('11111111-1111-1111-1111-111111111111', 'Agua · 1 litro', 'Bebidas', '1 litro', 30, 16),
('11111111-1111-1111-1111-111111111111', 'Agua · medio litro', 'Bebidas', '500 ml', 20, 17),
('11111111-1111-1111-1111-111111111111', 'Refresco', 'Bebidas', 'Pieza', 25, 18),
('11111111-1111-1111-1111-111111111111', 'Botana', 'Extras', 'Orden', 20, 19),
('11111111-1111-1111-1111-111111111111', 'Comida · 1 litro', 'Por litro', '1 litro', 150, 20),
('11111111-1111-1111-1111-111111111111', 'Comida · medio litro', 'Por litro', '500 ml', 80, 21),
('11111111-1111-1111-1111-111111111111', 'Arroz · 1 litro', 'Por litro', '1 litro', 70, 22),
('11111111-1111-1111-1111-111111111111', 'Arroz · medio litro', 'Por litro', '500 ml', 35, 23),
('11111111-1111-1111-1111-111111111111', 'Frijoles · 1 litro', 'Por litro', '1 litro', 70, 24),
('11111111-1111-1111-1111-111111111111', 'Frijoles · medio litro', 'Por litro', '500 ml', 35, 25),
('11111111-1111-1111-1111-111111111111', 'Orden de sopa o crema', 'Extras', 'Orden', 25, 26);

commit;

