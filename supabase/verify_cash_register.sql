-- Auditoría de sólo lectura antes/después de activar Caja; no consulta Auth ni secretos.
select jsonb_build_object(
  'cash_rpcs',jsonb_build_object(
    'status',to_regprocedure('public.get_pos_cash_status()') is not null,
    'dashboard',to_regprocedure('public.get_cash_dashboard()') is not null,
    'open',to_regprocedure('public.open_cash_session(uuid,numeric)') is not null,
    'close',to_regprocedure('public.close_cash_session(uuid,numeric,integer,text)') is not null),
  'orders',(select jsonb_build_object('count',count(*),'open',count(*) filter(where status in ('draft','sent','preparing','ready')),
    'paid',count(*) filter(where status='paid'),'cancelled',count(*) filter(where status='cancelled'),
    'digest',md5(coalesce(string_agg(row_to_json(o)::text,'' order by id),''))) from public.orders o),
  'payments',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),
    'digest',md5(coalesce(string_agg(row_to_json(p)::text,'' order by id),''))) from public.payments p),
  'profiles_digest',(select md5(coalesce(string_agg(row_to_json(p)::text,'' order by id),'')) from public.profiles p),
  'cash',(select jsonb_build_object('count',count(*),'open',count(*) filter(where status='open'),'closed',count(*) filter(where status='closed')) from public.cash_register_sessions),
  'qa_sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'opening',c.opening_amount,
    'expected',c.expected_amount,'counted',c.closing_amount,'difference',c.difference,'notes',c.notes)
    order by c.opened_at),'[]'::jsonb) from public.cash_register_sessions c where c.notes like 'QA-20261021-CAJA%'),
  'qa_orders',(select coalesce(jsonb_agg(jsonb_build_object('number',o.order_number,'status',o.status,'total',o.total,
    'cash_session_id',o.cash_session_id,'payment_count',(select count(*) from public.payments where order_id=o.id),
    'payment_total',(select sum(amount) from public.payments where order_id=o.id),
    'ticket_count',(select count(*) from public.tickets where order_id=o.id)) order by o.order_number),'[]'::jsonb)
    from public.orders o where o.notes like 'QA-20261021-CAJA%'),
  'tickets',(select count(*) from public.tickets),
  'inventory_movements',(select count(*) from public.inventory_movements),
  'direct_cash_writes',has_table_privilege('authenticated','public.cash_register_sessions','INSERT')
    or has_table_privilege('authenticated','public.cash_register_sessions','UPDATE')
    or has_table_privilege('authenticated','public.cash_register_sessions','DELETE')
) as cash_audit;
