-- Let an employee record their own attendance (self check-in), in addition
-- to the existing manager-only insert/update policies. Additive: does not
-- change what shift_manager/bar_manager/administrator can already do.

create policy attendance_records_insert_self on attendance_records
  for insert
  with check (
    exists (
      select 1
      from shift_assignments sa
      join app_users au on au.employee_id = sa.employee_id
      where sa.id = shift_assignment_id and au.id = auth.uid()
    )
  );

create policy attendance_records_update_self on attendance_records
  for update
  using (
    exists (
      select 1
      from shift_assignments sa
      join app_users au on au.employee_id = sa.employee_id
      where sa.id = shift_assignment_id and au.id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from shift_assignments sa
      join app_users au on au.employee_id = sa.employee_id
      where sa.id = shift_assignment_id and au.id = auth.uid()
    )
  );
