-- inventory_items_with_latest_count's "ii.*" was expanded at view-definition
-- time (migration 46), so it never picked up display_order (migration 94) --
-- same gotcha documented in migration 46 itself. Drop and recreate so the
-- catalog page (which reads from this view) can actually sort by it.
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
