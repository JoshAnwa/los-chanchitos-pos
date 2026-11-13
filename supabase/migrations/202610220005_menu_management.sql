-- Administración del menú por Dueño. No cambia productos, precios o pedidos existentes.
begin;

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

commit;
