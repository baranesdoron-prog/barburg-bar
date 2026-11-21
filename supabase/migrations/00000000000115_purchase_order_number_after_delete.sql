-- Purchase order numbers were "orders this year + 1". After an order was
-- deleted (cancelled orders can be), that count was lower than the highest
-- number in use, so a new order got an existing number and failed with
-- purchase_orders_order_number_unique. Now: highest number this year + 1.
-- Security definer so it sees every order regardless of RLS, and an
-- advisory lock so two orders created at once don't get the same number.

create or replace function generate_purchase_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
begin
  perform pg_advisory_xact_lock(hashtext('purchase_order_number:' || v_year));

  select coalesce(max(substring(order_number from '^PO-' || v_year || '-([0-9]+)$')::int), 0) + 1
  into v_seq
  from purchase_orders
  where order_number like 'PO-' || v_year || '-%';

  new.order_number := 'PO-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;
