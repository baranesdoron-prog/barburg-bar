-- Area supervisors (employees.can_supervise_area) can now add and remove
-- area managers on any upcoming evening, not just themselves -- same
-- rights a bar manager/admin has, but scoped to the area_manager duty
-- only (bartenders, bar manager and area supervisor stay manager-only).
-- Most area supervisors hold the plain bartender account role, so this
-- is keyed on the employee flag rather than current_app_role().

-- Security definer so the check doesn't depend on the caller's own read
-- access to app_users/employees from inside a policy.
create function viewer_can_supervise_area()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from app_users au
    join employees e on e.id = au.employee_id
    where au.id = auth.uid()
      and au.status = 'approved'
      and e.can_supervise_area
  );
$$;

-- Same published/upcoming-week/cap-of-2 rules as an area manager signing
-- up themselves (shift_assignments_insert_self), for anyone they pick.
create policy shift_assignments_insert_area_managers_by_supervisor on shift_assignments
  for insert
  with check (
    assignment_role = 'area_manager'
    and viewer_can_supervise_area()
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          select count(*) from shift_assignments sa
          where sa.shift_id = s.id and sa.assignment_role = 'area_manager'
        ) < 2
    )
  );

-- Removal is allowed through the current week (unlike self-removal,
-- which is future weeks only) -- covering a last-minute dropout is
-- exactly what the supervisor needs this for.
create policy shift_assignments_delete_area_managers_by_supervisor on shift_assignments
  for delete
  using (
    assignment_role = 'area_manager'
    and viewer_can_supervise_area()
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.week_start >= active_week_start()
    )
  );
