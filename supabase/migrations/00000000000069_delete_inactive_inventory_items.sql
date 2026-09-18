-- Inventory items previously had no delete policy at all (deactivate
-- instead), matching suppliers/employees. But a disabled product that
-- was never actually counted or ordered (e.g. added by mistake) is just
-- clutter -- let managers remove it once it's inactive. Still referenced
-- by inventory_counts/purchase_order_items rows if it has real history,
-- so the delete itself fails with a foreign-key error in that case
-- rather than silently losing data.
create policy inventory_items_delete_inactive on inventory_items
  for delete
  using (
    current_app_role() in ('shift_manager', 'bar_manager', 'administrator')
    and not active
  );
