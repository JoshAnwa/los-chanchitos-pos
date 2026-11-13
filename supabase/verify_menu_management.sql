-- Auditoría de sólo lectura antes/después de activar la migración de menú.
select jsonb_build_object(
  'products', (select jsonb_build_object('count',count(*),'active',count(*) filter(where is_active),
    'digest',md5(coalesce(string_agg((to_jsonb(p)-'version')::text,'' order by id),''))) from public.products p),
  'duplicate_names',(select count(*) from (select branch_id,lower(btrim(name)) from public.products group by 1,2 having count(*)>1) d),
  'orders',(select jsonb_build_object('count',count(*),'paid',count(*) filter(where status='paid'),
    'open',count(*) filter(where status='draft'),'digest',md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),''))) from public.orders o),
  'order_items_digest',(select md5(coalesce(string_agg(to_jsonb(i)::text,'' order by id),'')) from public.order_items i),
  'payments',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),
    'digest',md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),''))) from public.payments p),
  'cash',(select jsonb_build_object('count',count(*),'open',count(*) filter(where status='open'),
    'digest',md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),''))) from public.cash_register_sessions c),
  'tickets_digest',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.tickets t),
  'profiles_digest',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.profiles p),
  'inventory_movements',(select count(*) from public.inventory_movements),
  'price_overrides',(select count(*) from public.price_overrides),
  'menu_table',to_regclass('public.product_changes') is not null,
  'menu_rpcs',jsonb_build_object('list',to_regprocedure('public.list_pos_products()') is not null,
    'dashboard',to_regprocedure('public.get_menu_dashboard()') is not null,
    'save',to_regprocedure('public.save_menu_product(uuid,integer,uuid,text,text,text,numeric,boolean,text)') is not null),
  'direct_product_writes',has_table_privilege('authenticated','public.products','INSERT')
    or has_table_privilege('authenticated','public.products','UPDATE') or has_table_privilege('authenticated','public.products','DELETE')
) as menu_audit;
