-- Sólo lectura: ejecutar después de la migración 005.
select jsonb_build_object(
  'protected_tables',(select count(*) from pg_tables t join pg_class c on c.relname=t.tablename
    join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname
    where t.schemaname='public' and c.relrowsecurity),
  'versioned_products',(select count(*) from public.products where version=1),
  'changes',(select count(*) from public.product_changes),
  'audit_rls',(select relrowsecurity from pg_class where oid='public.product_changes'::regclass),
  'audit_policy',(select qual from pg_policies where schemaname='public' and tablename='product_changes' and policyname='owner_product_changes'),
  'direct_audit_writes',has_table_privilege('authenticated','public.product_changes','INSERT')
    or has_table_privilege('authenticated','public.product_changes','UPDATE') or has_table_privilege('authenticated','public.product_changes','DELETE'),
  'functions',(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'security_definer',prosecdef,
    'settings',proconfig,'anon_execute',has_function_privilege('anon',oid,'execute'),
    'staff_execute',has_function_privilege('authenticated',oid,'execute'),
    'owner_check',case when proname='list_pos_products' then null else position('public.is_owner()' in pg_get_functiondef(oid))>0 end)
    order by proname) from pg_proc where oid=any(array[
      'public.list_pos_products()'::regprocedure,
      'public.get_menu_dashboard()'::regprocedure,
      'public.save_menu_product(uuid,integer,uuid,text,text,text,numeric,boolean,text)'::regprocedure]))
) as menu_security;
