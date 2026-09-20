-- Journal entries were write-once by design ("correcting a mistake means
-- adding a new entry"). In practice managers want to fix a typo or wrong
-- category right after adding one -- allow editing, but only while the
-- shift hasn't actually been closed yet (status <> 'completed'). Once
-- closed, the shift_report snapshot is the immutable historical record;
-- the entries stay open to correction right up until that point.
create policy journal_entries_update_managers on journal_entries
  for update
  using (
    current_app_role() in ('shift_manager', 'bar_manager', 'administrator')
    and exists (select 1 from shifts s where s.id = journal_entries.shift_id and s.status <> 'completed')
  )
  with check (
    current_app_role() in ('shift_manager', 'bar_manager', 'administrator')
    and exists (select 1 from shifts s where s.id = journal_entries.shift_id and s.status <> 'completed')
  );
