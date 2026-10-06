-- shift_assignments_insert_self already requires s.status = 'published',
-- so a bartender self-assigning (the onboarding wizard, the self-service
-- columns in Shifts.tsx) was already correctly blocked from a cancelled
-- shift. The manager-facing "staffers" policy (used when a bar manager/
-- admin assigns someone directly via Shifts.tsx's RoleSection) had no
-- status check at all -- close that gap too, so no one can be newly
-- assigned to a cancelled shift from any screen.
alter policy shift_assignments_insert_staffers on shift_assignments
  with check (
    current_app_role() = any (array['shift_manager', 'bar_manager', 'administrator']::app_role[])
    and exists (
      select 1 from shifts s
      where s.id = shift_assignments.shift_id and s.status = 'published'
    )
  );

-- Bar manager duty is week-level (shift_manager_assignments), not tied to
-- a single shift_assignments row, so the fix above doesn't cover it.
-- Block assigning a bar manager for a week whose shifts already exist and
-- are all cancelled (nothing left to manage) -- matches the "cancel the
-- whole week together" model the week-level cancel/restore buttons use.
create or replace function set_weekly_shift_manager(p_week_start date, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thu_start timestamptz := (p_week_start + 4 + time '19:30') at time zone 'Asia/Jerusalem';
  v_thu_mid   timestamptz := (p_week_start + 4 + time '22:00') at time zone 'Asia/Jerusalem';
  v_thu_end   timestamptz := (p_week_start + 5 + time '00:30') at time zone 'Asia/Jerusalem';
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only a manager can assign shift managers';
  end if;

  if p_employee_id is not null
    and exists (select 1 from shifts where start_time in (v_thu_start, v_thu_mid))
    and not exists (select 1 from shifts where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled')
  then
    raise exception 'cannot assign a bar manager to a cancelled shift';
  end if;

  insert into shift_manager_assignments (week_start, employee_id, assigned_by)
  values (p_week_start, p_employee_id, auth.uid())
  on conflict (week_start) do update
    set employee_id = excluded.employee_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now();

  update shifts
  set shift_manager_id = p_employee_id
  where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled';

  if not exists (select 1 from shifts where start_time in (v_thu_start, v_thu_mid)) then
    insert into shifts (start_time, end_time, shift_type, shift_manager_id, status, week_start) values
      (v_thu_start, v_thu_mid, 'opening', p_employee_id, 'published', p_week_start),
      (v_thu_mid, v_thu_end, 'closing', p_employee_id, 'published', p_week_start);
  end if;
end;
$$;
