-- Caja compartida por sucursal. No modifica ventas anteriores ni crea aperturas.
-- Aplicar después de la migración 003; no ejecutar el instalador ni el seed.
begin;

alter table public.cash_register_sessions add column if not exists closed_summary jsonb;

drop policy if exists staff_branch_read on public.cash_register_sessions;
drop policy if exists owner_cash_read on public.cash_register_sessions;
create policy owner_cash_read on public.cash_register_sessions for select to authenticated
  using (branch_id=(select public.current_user_branch()) and (select public.is_owner()));

create or replace function private.cash_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'status',s.status,'opening_amount',s.opening_amount,
    'opened_at',s.opened_at,'closed_at',s.closed_at,'closing_amount',s.closing_amount,
    'difference',s.difference,'notes',coalesce(s.notes,''),
    'opened_by_name',(select full_name from public.profiles where id=s.opened_by),
    'closed_by_name',(select full_name from public.profiles where id=s.closed_by)
  ) || case when s.status='closed' and s.closed_summary is not null then s.closed_summary else
    jsonb_build_object('sales_count',t.sales_count,'cash_sales',t.cash_sales,'card_sales',t.card_sales,
      'transfer_sales',t.transfer_sales,'total_sales',t.cash_sales+t.card_sales+t.transfer_sales,
      'expected_amount',s.opening_amount+t.cash_sales) end
  from public.cash_register_sessions s cross join lateral (
    select count(distinct o.id)::integer as sales_count,
      coalesce(sum(p.amount) filter(where p.method='cash'),0) as cash_sales,
      coalesce(sum(p.amount) filter(where p.method='card'),0) as card_sales,
      coalesce(sum(p.amount) filter(where p.method='transfer'),0) as transfer_sales
    from public.orders o join public.payments p on p.order_id=o.id
    where o.cash_session_id=s.id and o.status='paid'
  ) t where s.id=p_id;
$$;

create or replace function public.get_pos_cash_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch();
begin
  return jsonb_build_object('open',exists(select 1 from public.cash_register_sessions where branch_id=branch and status='open'));
end;
$$;

create or replace function public.get_cash_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); result jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object(
    'current',(select private.cash_json(id) from public.cash_register_sessions where branch_id=branch and status='open'),
    'history',coalesce((select jsonb_agg(private.cash_json(id) order by closed_at desc,id)
      from (select id,closed_at from public.cash_register_sessions where branch_id=branch and status='closed'
        order by closed_at desc,id limit 30) recent),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.open_cash_session(p_id uuid,p_opening_amount numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); existing public.cash_register_sessions;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_opening_amount is null or p_opening_amount<0 or p_opening_amount>99999999.99
    or p_opening_amount<>round(p_opening_amount,2) then raise exception 'INVALID_CASH_AMOUNT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':cash-register',0));
  select * into existing from public.cash_register_sessions where id=p_id for update;
  if found then
    if existing.branch_id<>branch then raise exception 'CASH_NOT_FOUND' using errcode='42501'; end if;
    if existing.opening_amount<>p_opening_amount then raise exception 'CASH_REQUEST_CHANGED' using errcode='PT409'; end if;
    return private.cash_json(p_id);
  end if;
  if exists(select 1 from public.cash_register_sessions where branch_id=branch and status='open') then
    raise exception 'CASH_ALREADY_OPEN' using errcode='PT409';
  end if;
  insert into public.cash_register_sessions(id,branch_id,opened_by,opening_amount)
    values(p_id,branch,(select auth.uid()),p_opening_amount);
  return private.cash_json(p_id);
end;
$$;

create or replace function public.close_cash_session(p_id uuid,p_closing_amount numeric,p_sales_count integer,p_notes text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); current_session public.cash_register_sessions; summary jsonb;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_closing_amount is null or p_closing_amount<0 or p_closing_amount>99999999.99
    or p_closing_amount<>round(p_closing_amount,2) or p_sales_count is null or p_sales_count<0
    or length(coalesce(p_notes,''))>300 then raise exception 'INVALID_CASH_AMOUNT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':cash-register',0));
  select * into current_session from public.cash_register_sessions where id=p_id and branch_id=branch for update;
  if not found then raise exception 'CASH_NOT_FOUND' using errcode='42501'; end if;
  if current_session.status='closed' then
    if current_session.closing_amount=p_closing_amount and coalesce(current_session.notes,'')=trim(coalesce(p_notes,'')) then
      return private.cash_json(p_id);
    end if;
    raise exception 'CASH_CLOSED' using errcode='PT409';
  end if;
  -- El bloqueo de esta fila espera los cobros en curso. Los cobros nuevos deberán
  -- volver a comprobar que la misma fila siga abierta después de esperar.
  summary:=private.cash_json(p_id);
  if (summary->>'sales_count')::integer<>p_sales_count then raise exception 'CASH_CHANGED' using errcode='PT409'; end if;
  update public.cash_register_sessions set status='closed',closed_at=now(),closed_by=(select auth.uid()),
    expected_amount=(summary->>'expected_amount')::numeric,closing_amount=p_closing_amount,
    difference=p_closing_amount-(summary->>'expected_amount')::numeric,notes=nullif(trim(p_notes),''),
    closed_summary=jsonb_build_object('sales_count',summary->'sales_count','cash_sales',summary->'cash_sales',
      'card_sales',summary->'card_sales','transfer_sales',summary->'transfer_sales',
      'total_sales',summary->'total_sales','expected_amount',summary->'expected_amount') where id=p_id;
  return private.cash_json(p_id);
end;
$$;

create or replace function public.pay_pos_order(p_id uuid,p_version integer,p_request_id uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare branch uuid:=private.staff_branch(); current_order public.orders; payment_sum numeric; cash_session uuid;
begin
  if p_id is null or p_request_id is null then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(branch::text||':'||p_id::text,0));
  select * into current_order from public.orders where id=p_id and branch_id=branch for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='42501'; end if;
  if current_order.status='paid' and current_order.payment_request_id=p_request_id then return private.order_json(p_id); end if;
  if current_order.status in ('paid','cancelled') then raise exception 'ORDER_CLOSED' using errcode='P0001'; end if;
  if p_version is distinct from current_order.version then raise exception 'ORDER_CHANGED' using errcode='PT409'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
  if jsonb_array_length(p_payments) not between 1 and 3 or exists(
    select 1 from jsonb_array_elements(p_payments) p where coalesce(p->>'method','') not in ('cash','card','transfer')
    or jsonb_typeof(p->'amount') is distinct from 'number' or coalesce(p->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or (p->>'amount')::numeric<=0 or (p->>'amount')::numeric>99999999)
    or (select count(distinct p->>'method') from jsonb_array_elements(p_payments) p)<>jsonb_array_length(p_payments) then
    raise exception 'INVALID_PAYMENT' using errcode='22023';
  end if;
  select sum((p->>'amount')::numeric) into payment_sum from jsonb_array_elements(p_payments) p;
  if current_order.total<=0 or payment_sum<>current_order.total then raise exception 'PAYMENT_MISMATCH' using errcode='22023'; end if;
  select id into cash_session from public.cash_register_sessions where branch_id=branch and status='open' for share;
  if cash_session is null then raise exception 'CASH_REQUIRED' using errcode='P0001'; end if;
  insert into public.payments(order_id,method,amount,received_by)
    select p_id,(p->>'method')::public.payment_method,(p->>'amount')::numeric,(select auth.uid()) from jsonb_array_elements(p_payments) p;
  update public.orders set status='paid',paid_at=now(),payment_request_id=p_request_id,version=version+1,cash_session_id=cash_session where id=p_id;
  insert into public.tickets(order_id,format) values(p_id,'digital');
  return private.order_json(p_id);
end;
$$;

revoke all on function private.cash_json(uuid) from public,anon,authenticated;
revoke all on function public.get_pos_cash_status(),public.get_cash_dashboard(),public.open_cash_session(uuid,numeric),
  public.close_cash_session(uuid,numeric,integer,text) from public,anon,authenticated;
grant execute on function public.get_pos_cash_status(),public.get_cash_dashboard(),public.open_cash_session(uuid,numeric),
  public.close_cash_session(uuid,numeric,integer,text) to authenticated;
revoke execute on function public.pay_pos_order(uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.pay_pos_order(uuid,integer,uuid,jsonb) to authenticated;

commit;
