-- Bartenders can now see the unified allocations view too (client-side
-- restricted to self-service only -- no bar-manager editing, no picking
-- someone else), and that view lets them self-associate as area manager
-- duty, not just bartender duty. shift_assignments_insert_self only ever
-- allowed assignment_role = 'bartender' (migration 57); widen it to also
-- allow 'area_manager', capped at 2 per shift the same way the client
-- already caps it, instead of comparing against required_staff_count
-- (which has only ever meant "bartenders needed").
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
