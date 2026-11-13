-- Sólo lectura. Audita exclusivamente los pedidos de esta sesión de pruebas.
with qa as (
  select * from public.orders where notes like 'QA-20261018%'
)
select jsonb_build_object(
  'pedidos', (select count(*) from qa),
  'pagados', (select count(*) from qa where status='paid'),
  'cancelados', (select count(*) from qa where status='cancelled'),
  'abiertos', (select count(*) from qa where status not in ('paid','cancelled')),
  'total_pagado', (select coalesce(sum(total),0) from qa where status='paid'),
  'partidas_pago', (select count(*) from public.payments p join qa q on q.id=p.order_id),
  'importe_pagos', (select coalesce(sum(amount),0) from public.payments p join qa q on q.id=p.order_id),
  'tickets', (select count(*) from public.tickets t join qa q on q.id=t.order_id),
  'movimientos_inventario', (select count(*) from public.inventory_movements i join qa q on q.id=i.order_id),
  'cajas_creadas', (select count(*) from public.cash_register_sessions)
) as resumen_qa,
(select jsonb_agg(jsonb_build_object('pedido',q.order_number,'estado',q.status,'total',q.total,
  'version',q.version,'motivo',q.cancellation_reason,
  'pagos',(select coalesce(jsonb_agg(jsonb_build_object('metodo',p.method,'importe',p.amount)),'[]'::jsonb) from public.payments p where p.order_id=q.id))
  order by q.order_number) from qa q) as detalle_qa;
