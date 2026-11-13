-- Sólo lectura. Evidencia de la prueba QA-20261026; no limpia ni modifica registros.
with qa_orders as (select id from public.orders where notes like 'QA-20261026%'),
qa_products as (select id from public.products where name like 'QA-20261026%'),
qa_ingredients as (select id from public.ingredients where name like 'QA-20261026%')
select jsonb_build_object(
 'original_products',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg((to_jsonb(p)-'recipe_version'-'inventory_enabled')::text,'' order by id),''))) from public.products p where id not in(select id from qa_products)),
 'original_orders',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),''))) from public.orders o where id not in(select id from qa_orders)),
 'original_payments',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),'digest',md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),''))) from public.payments p where order_id not in(select id from qa_orders)),
 'original_cash_digest',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) from public.cash_register_sessions c where coalesce(notes,'') not like 'QA-20261026%'),
 'profiles_digest',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.profiles p),
 'branch_values_digest',(select md5(coalesce(string_agg((to_jsonb(b)-'settings_version')::text,'' order by id),'')) from public.branches b),
 'qa_orders',(select coalesce(jsonb_agg(jsonb_build_object('number',o.order_number,'status',o.status,'total',o.total,'notes',o.notes,
   'payments',(select count(*) from public.payments where order_id=o.id),'paid_amount',(select coalesce(sum(amount),0) from public.payments where order_id=o.id),
   'tickets',(select count(*) from public.tickets where order_id=o.id),'deductions',(select count(*) from public.inventory_movements where order_id=o.id))),'[]') from public.orders o where id in(select id from qa_orders)),
 'qa_products',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'active',is_active,'tracking',inventory_enabled,'price',price)),'[]') from public.products where id in(select id from qa_products)),
 'qa_ingredients',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'active',is_active,'stock',current_stock)),'[]') from public.ingredients where id in(select id from qa_ingredients)),
 'qa_movements',(select count(*) from public.inventory_movements where ingredient_id in(select id from qa_ingredients)),
 'qa_purchases',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(total),0)) from public.purchases where reference='QA-20261026-SIN-PAGO-REAL'),
 'qa_cash',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'opening',opening_amount,'expected',expected_amount,'counted',closing_amount,'difference',difference)),'[]') from public.cash_register_sessions where notes like 'QA-20261026%'),
 'open_orders',(select count(*) from public.orders where status='draft'),'open_cash',(select count(*) from public.cash_register_sessions where status='open'),
 'total_payments',(select coalesce(sum(amount),0) from public.payments),
 'security',(select jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'settings',proconfig,'anon',has_function_privilege('anon',oid,'execute'),'staff',has_function_privilege('authenticated',oid,'execute')) order by proname)
   from pg_proc where oid=any(array['public.get_inventory_dashboard()'::regprocedure,'public.inventory_action(text,uuid,integer,uuid,jsonb)'::regprocedure,'public.get_sales_report(date,date)'::regprocedure,'public.get_business_settings()'::regprocedure]))
) as self_service_qa;
