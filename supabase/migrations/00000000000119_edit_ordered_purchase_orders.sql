-- Purchase orders already marked "ordered" can be edited too (the supplier
-- is out of something, or the bar changes its mind): add, change and remove
-- lines. Received orders stay locked, since their stock is already counted;
-- cancelled orders keep only the delete rule they already have.

drop policy purchase_order_items_insert_draft_only on purchase_order_items;
drop policy purchase_order_items_update_draft_only on purchase_order_items;
drop policy purchase_order_items_delete_draft_only on purchase_order_items;

create policy purchase_order_items_insert_open on purchase_order_items
  for insert
  with check (
    current_app_role() = any (array['bar_manager'::app_role, 'administrator'::app_role, 'shift_manager'::app_role])
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.status in ('draft', 'ordered')
    )
  );

create policy purchase_order_items_update_open on purchase_order_items
  for update
  using (
    current_app_role() = any (array['bar_manager'::app_role, 'administrator'::app_role, 'shift_manager'::app_role])
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.status in ('draft', 'ordered')
    )
  )
  with check (
    current_app_role() = any (array['bar_manager'::app_role, 'administrator'::app_role, 'shift_manager'::app_role])
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.status in ('draft', 'ordered')
    )
  );

create policy purchase_order_items_delete_open on purchase_order_items
  for delete
  using (
    current_app_role() = any (array['bar_manager'::app_role, 'administrator'::app_role, 'shift_manager'::app_role])
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.status in ('draft', 'ordered')
    )
  );
