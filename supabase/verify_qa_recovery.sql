-- Sólo lectura: auditoría de la prueba de recuperación del 19 de octubre.
select jsonb_build_object(
  'orders', count(*),
  'open_orders', count(*) filter (where status not in ('paid', 'cancelled')),
  'paid_orders', count(*) filter (where status = 'paid'),
  'cancelled_orders', count(*) filter (where status = 'cancelled'),
  'payment_rows', (select count(*) from public.payments p where p.order_id in
    (select id from public.orders where notes like 'QA-20261019%')),
  'details', coalesce(jsonb_agg(jsonb_build_object(
    'number', order_number, 'status', status, 'version', version, 'total', total,
    'notes', notes, 'cancellation_reason', cancellation_reason
  )), '[]'::jsonb)
) as qa_recovery
from public.orders where notes like 'QA-20261019%';
