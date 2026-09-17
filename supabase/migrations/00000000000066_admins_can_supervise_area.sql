-- Administrators can now self-associate as area supervisor too, on top of
-- the explicit can_supervise_area allow-list -- matches the existing "an
-- admin can also cover bartender/area-manager duty" precedent.
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
          or (
            assignment_role = 'area_supervisor'
            and exists (
              select 1 from employees e
              where e.id = employee_id
                and (
                  e.can_supervise_area
                  or exists (
                    select 1 from app_users au
                    where au.employee_id = e.id and au.role = 'administrator' and au.status = 'approved'
                  )
                )
            )
            and (
              select count(*) from shift_assignments sa
              where sa.shift_id = s.id and sa.assignment_role = 'area_supervisor'
            ) < 1
          )
        )
    )
  );
