-- A real, persistent stock level on each product, instead of only ever
-- deriving "current stock" from whichever shift last counted it -- since
-- receiving a purchase order needs somewhere to add to that isn't tied
-- to a shift.

alter table inventory_items add column current_stock numeric not null default 0;

-- A physical count is ground truth: overwrite current_stock to exactly
-- what was counted, whenever a count is recorded/corrected.
create function sync_current_stock_from_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update inventory_items set current_stock = new.quantity_counted where id = new.inventory_item_id;
  return new;
end;
$$;

create trigger inventory_counts_sync_current_stock
  after insert or update on inventory_counts
  for each row execute function sync_current_stock_from_count();

-- Receiving adds to whatever is already there.
create function receive_purchase_order(p_order_id uuid)
returns purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order purchase_orders;
begin
  if is_admin() is not true then
    raise exception 'only administrators can receive purchase orders';
  end if;

  select * into v_order from purchase_orders where id = p_order_id;
  if not found then
    raise exception 'purchase order % not found', p_order_id;
  end if;

  if v_order.status != 'ordered' then
    raise exception 'purchase order must be ordered to mark as received (current status: %)', v_order.status;
  end if;

  update inventory_items ii
  set current_stock = ii.current_stock + poi.quantity
  from purchase_order_items poi
  where poi.purchase_order_id = p_order_id and poi.inventory_item_id = ii.id;

  update purchase_orders
  set status = 'received', received_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

drop view inventory_items_with_latest_count;

create view inventory_items_with_latest_count
as
select
  ii.*,
  lc.quantity_counted as latest_counted_quantity,
  lc.created_at as latest_counted_at,
  (ii.minimum_quantity is not null and ii.current_stock < ii.minimum_quantity) as is_low_stock
from inventory_items ii
left join lateral (
  select ic.quantity_counted, ic.created_at
  from inventory_counts ic
  where ic.inventory_item_id = ii.id
  order by ic.created_at desc
  limit 1
) lc on true;
