-- Sólo lectura. Comparar antes y después de la migración 006; no instala ni limpia datos.
select jsonb_build_object(
 'products',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg((to_jsonb(p)-'recipe_version'-'inventory_enabled')::text,'' order by id),''))) from public.products p),
 'ingredients',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg((to_jsonb(i)-'version')::text,'' order by id),''))) from public.ingredients i),
 'recipes',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(to_jsonb(r)::text,'' order by product_id,ingredient_id),''))) from public.product_recipes r),
 'purchases',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg((to_jsonb(p)-'supplier_name')::text,'' order by id),''))) from public.purchases p),
 'branches_digest',(select md5(coalesce(string_agg((to_jsonb(b)-'settings_version')::text,'' order by id),'')) from public.branches b),
 'orders',(select jsonb_build_object('count',count(*),'paid',count(*) filter(where status='paid'),'open',count(*) filter(where status='draft'),
   'digest',md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),''))) from public.orders o),
 'payments',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),'digest',md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),''))) from public.payments p),
 'cash',(select jsonb_build_object('count',count(*),'open',count(*) filter(where status='open'),'digest',md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),''))) from public.cash_register_sessions c),
 'tickets_digest',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.tickets t),
 'profiles_digest',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.profiles p),
 'inventory_movements',(select count(*) from public.inventory_movements),
 'rpcs',jsonb_build_object('inventory',to_regprocedure('public.get_inventory_dashboard()') is not null,
   'action',to_regprocedure('public.inventory_action(text,uuid,integer,uuid,jsonb)') is not null,
   'business',to_regprocedure('public.get_business_settings()') is not null,'sales',to_regprocedure('public.get_sales_report(date,date)') is not null),
 'protected_tables',(select count(*) from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and c.relrowsecurity)
) as self_service_audit;
