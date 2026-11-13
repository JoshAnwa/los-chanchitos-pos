-- Sólo lectura. Ejecutar únicamente en el proyecto autorizado de Los Chanchitos.
-- No consulta contraseñas, sesiones, tokens ni las cuentas de otras aplicaciones.
select jsonb_build_object(
  'staff', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', full_name, 'role', role, 'active', is_active, 'branch', branch_id
  ) order by id), '[]'::jsonb) from public.profiles),
  'rls_tables', (select count(*) from pg_tables where schemaname='public' and rowsecurity),
  'direct_insert_orders', has_table_privilege('authenticated','public.orders','insert'),
  'direct_update_products', has_table_privilege('authenticated','public.products','update'),
  'direct_update_profiles', has_table_privilege('authenticated','public.profiles','update'),
  'orders', (select count(*) from public.orders),
  'open_orders', (select count(*) from public.orders where status not in ('paid','cancelled')),
  'payment_rows', (select count(*) from public.payments),
  'payment_total', (select coalesce(sum(amount),0) from public.payments),
  'qa_cashier', (select coalesce(jsonb_agg(jsonb_build_object(
    'number', q.order_number, 'status', q.status, 'version', q.version,
    'total', q.total, 'notes', q.notes, 'created_by', q.created_by,
    'quantity', (select sum(i.quantity) from public.order_items i where i.order_id=q.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'method', p.method, 'amount', p.amount, 'received_by', p.received_by
    )), '[]'::jsonb) from public.payments p where p.order_id=q.id),
    'tickets', (select count(*) from public.tickets t where t.order_id=q.id),
    'inventory_movements', (select count(*) from public.inventory_movements m where m.order_id=q.id),
    'cash_session', q.cash_session_id
  ) order by q.order_number), '[]'::jsonb)
    from public.orders q where q.notes like 'QA-20261019-CAJERO%')
) as staff_access;
