-- Cancelled purchase orders were previously permanent (no delete policy
-- existed at all, matching suppliers/employees/inventory_items — but
-- unlike those, a cancelled order has no ongoing referential meaning to
-- preserve, so let managers clean them up instead of leaving clutter.
create policy purchase_order_items_delete_cancelled on purchase_order_items
  for delete
  using (
    current_app_role() in ('bar_manager', 'administrator')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'cancelled'
    )
  );

create policy purchase_orders_delete_cancelled on purchase_orders
  for delete
  using (
    current_app_role() in ('bar_manager', 'administrator')
    and status = 'cancelled'
  );
