-- Product categories could only be written by administrators, unlike
-- suppliers/inventory items which bar managers already manage. Split the
-- single admin-only "for all" policy into insert/update (matching the
-- suppliers pattern) so bar managers can add and edit categories too.
drop policy product_categories_write_admin on product_categories;

create policy product_categories_insert_managers on product_categories
  for insert
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

create policy product_categories_update_managers on product_categories
  for update
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'))
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

-- No delete policy: categories have no active flag to deactivate instead,
-- and can be referenced by inventory_items -- not asked for, leave for later.
