-- Sólo lectura. Confirmar el destino Los Chanchitos antes de ejecutar.
with functions as (
  select p.oid::regprocedure::text as signature, p.prosecdef as security_definer,
    p.proconfig as configuration, p.proacl::text as permissions,
    strpos(pg_get_functiondef(p.oid), $code$errcode='PT409'$code$) > 0 as conflict_409,
    strpos(pg_get_functiondef(p.oid), $code$errcode='40001'$code$) > 0 as retries_40001
  from pg_proc p where p.oid in (
    to_regprocedure('public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text)'),
    to_regprocedure('public.pay_pos_order(uuid,integer,uuid,jsonb)'),
    to_regprocedure('public.cancel_pos_order(uuid,integer,text)')
  )
)
select jsonb_build_object(
  'functions', (select jsonb_agg(to_jsonb(f) order by signature) from functions f),
  'orders', (select count(*) from public.orders),
  'paid', (select count(*) from public.orders where status='paid'),
  'cancelled', (select count(*) from public.orders where status='cancelled'),
  'open', (select count(*) from public.orders where status not in ('paid','cancelled')),
  'payments', (select count(*) from public.payments),
  'payment_total', (select coalesce(sum(amount),0) from public.payments),
  'products', (select count(*) from public.products),
  'rls_tables', (select count(*) from pg_tables where schemaname='public' and rowsecurity),
  'conflict_qa', (select coalesce(jsonb_agg(jsonb_build_object(
    'number', q.order_number, 'version', q.version, 'status', q.status, 'total', q.total,
    'notes', q.notes, 'reason', q.cancellation_reason,
    'quantity', (select sum(i.quantity) from public.order_items i where i.order_id=q.id),
    'payments', (select count(*) from public.payments p where p.order_id=q.id),
    'tickets', (select count(*) from public.tickets t where t.order_id=q.id)
  ) order by q.order_number), '[]'::jsonb)
    from public.orders q where q.notes like 'QA-20261019-FIX%'),
  'active_order_requests', (select coalesce(jsonb_agg(jsonb_build_object(
    'pid', pid, 'state', state, 'wait_type', wait_event_type, 'wait', wait_event,
    'seconds', extract(epoch from clock_timestamp()-query_start)::integer
  )), '[]'::jsonb) from pg_stat_activity where usename='authenticator' and state='active'
    and pid<>pg_backend_pid() and (query like '%save_pos_order%' or query like '%pay_pos_order%' or query like '%cancel_pos_order%'))
) as conflict_fix;
