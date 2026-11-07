-- Once the customer closes the order card after showing it to the
-- bartender, the order is "closed": reopening it shows the time it was
-- placed, frozen, instead of a live clock, so it can't be shown again as
-- a new order.

alter table punchcard_orders add column closed_at timestamptz;

create function close_punchcard_order(p_order_id uuid)
returns punchcard_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order punchcard_orders;
begin
  update punchcard_orders
  set closed_at = coalesce(closed_at, now())
  where id = p_order_id and owner_id = auth.uid() and status = 'confirmed'
  returning * into v_order;
  if not found then
    raise exception 'order not found';
  end if;
  return v_order;
end;
$$;
