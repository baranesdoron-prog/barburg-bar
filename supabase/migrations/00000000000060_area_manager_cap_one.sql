-- Area manager capacity was "up to 2" per shift-type, which combined with
-- the row-end "associate me to both" shortcut made the self-service view
-- show three "שבץ אותי" buttons for a single area-manager slot (opening,
-- closing, and the combined one) -- confusing, and not what's actually
-- needed. Area manager is exactly one person per shift (opening/closing
-- independently, so up to two people across the pair, never more than one
-- covering the same shift instance).
drop policy shift_assignments_insert_self on shift_assignments;
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
          (
            assignment_role = 'bartender'
            and (
              s.required_staff_count is null
              or (
                select count(*) from shift_assignments sa
                where sa.shift_id = s.id and sa.assignment_role = 'bartender'
              ) < s.required_staff_count
            )
          )
          or (
            assignment_role = 'area_manager'
            and not exists (
              select 1 from shift_assignments sa
              where sa.shift_id = s.id and sa.assignment_role = 'area_manager'
            )
          )
        )
    )
  );
