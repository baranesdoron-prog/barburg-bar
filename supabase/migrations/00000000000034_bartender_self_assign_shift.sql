-- Bartenders/shift managers may self-assign to a published, current-or-
-- future-week shift that still has room (or has no cap).
create policy shift_assignments_insert_self on shift_assignments
  for insert
  with check (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          s.required_staff_count is null
          or (select count(*) from shift_assignments sa where sa.shift_id = s.id) < s.required_staff_count
        )
    )
  );

-- Self-removal without approval, but only for a future week's shift —
-- this week's shift still requires the replacement-request flow.
create policy shift_assignments_delete_self_future_week on shift_assignments
  for delete
  using (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.week_start > active_week_start()
    )
  );
