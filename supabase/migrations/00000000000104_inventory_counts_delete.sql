-- Shift closing now saves each inventory count as it's typed. Clearing a
-- number must remove its saved count too, which needs a delete policy --
-- same roles that can already insert and update counts.

create policy inventory_counts_delete_staffers on inventory_counts
  for delete
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));
