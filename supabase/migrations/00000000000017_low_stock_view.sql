-- Add a queryable is_low_stock column so the dashboard KPI and reorder
-- screen can filter on it via PostgREST (a cross-column comparison isn't
-- expressible as a query param otherwise). Appending a column at the end
-- is safe for CREATE OR REPLACE VIEW (only reordering/removing existing
-- columns is rejected).

create or replace view inventory_items_with_latest_count
as
select
  ii.*,
  lc.quantity_counted as latest_counted_quantity,
  lc.created_at as latest_counted_at,
  (
    ii.minimum_quantity is not null
    and lc.quantity_counted is not null
    and lc.quantity_counted < ii.minimum_quantity
  ) as is_low_stock
from inventory_items ii
left join lateral (
  select ic.quantity_counted, ic.created_at
  from inventory_counts ic
  where ic.inventory_item_id = ii.id
  order by ic.created_at desc
  limit 1
) lc on true;
