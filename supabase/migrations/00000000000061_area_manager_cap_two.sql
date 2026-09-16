-- Reverting migration 60: area manager goes back to up to 2 per shift
-- (opening/closing independently), with 1 as a soft/informational minimum
-- only (already surfaced by the allocations view's "אין אחראי/ת מתחם" gap
-- chip, not enforced here). The earlier cap-to-1 was really fixing a
-- different problem -- the combined "associate both" shortcut button made
-- a single area-manager slot look like 3 options -- which is now fixed by
-- removing that shortcut button from the UI instead.
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
            and (
              select count(*) from shift_assignments sa
              where sa.shift_id = s.id and sa.assignment_role = 'area_manager'
            ) < 2
          )
        )
    )
  );
