-- Items without their own supplier_id inherit product_categories.default_supplier_id
-- (this fallback already drives generate_reorder_purchase_orders). Surface the same
-- resolved value here so the UI can display/filter by "who this item actually orders
-- from today", not just its own possibly-null override.
-- CREATE OR REPLACE can't be used here: ii.* is expanded at view-definition
-- time, and inventory_items has gained columns (e.g. ideal_quantity) since
-- this view was first created, so a plain replace collides on column
-- position. Nothing else depends on this view, so drop and recreate.
drop view inventory_items_with_latest_count;

create view inventory_items_with_latest_count
as
select
  ii.*,
  lc.quantity_counted as latest_counted_quantity,
  lc.created_at as latest_counted_at,
  (ii.minimum_quantity is not null and ii.current_stock < ii.minimum_quantity) as is_low_stock,
  coalesce(ii.supplier_id, pc.default_supplier_id) as resolved_supplier_id
from inventory_items ii
left join product_categories pc on pc.id = ii.category_id
left join lateral (
  select ic.quantity_counted, ic.created_at
  from inventory_counts ic
  where ic.inventory_item_id = ii.id
  order by ic.created_at desc
  limit 1
) lc on true;
