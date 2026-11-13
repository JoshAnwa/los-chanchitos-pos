-- Sólo lectura. Ejecutar en el SQL Editor de los-chanchitos-desarrollo.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')) as tablas,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity) as tablas_con_rls,
  (select count(*) from public.products) as productos,
  (select count(*) from public.branches) as sucursales,
  (select count(*) from public.ingredients) as ingredientes,
  (select count(*) from auth.users) as usuarios_auth,
  has_schema_privilege('authenticated','public','USAGE') as personal_accede_esquema,
  has_table_privilege('anon','public.products','SELECT') as anon_lee_productos,
  has_table_privilege('authenticated','public.orders','INSERT') as personal_inserta_directo,
  has_table_privilege('authenticated','public.profiles','UPDATE') as personal_cambia_roles,
  has_function_privilege('authenticated','public.list_pos_orders()','EXECUTE') as personal_lee_pedidos,
  has_function_privilege('anon','public.list_pos_orders()','EXECUTE') as anon_lee_pedidos,
  has_function_privilege('authenticated','public.complete_sale(public.order_type,text,jsonb,jsonb,text)','EXECUTE') as cobro_antiguo_habilitado;
