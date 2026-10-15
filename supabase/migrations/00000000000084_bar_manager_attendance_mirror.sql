-- set_weekly_shift_manager() now also mirrors the bar manager into a
-- paired shift_assignments row (role 'bar_manager', one per shift
-- instance -- same whole-evening pattern bartender/area_manager/
-- area_supervisor already use), fully replaced on every call. This is
-- purely a read-side mirror for attendance-taking and the closing report
-- snapshot; shift_manager_id / shift_manager_assignments stay the real
-- source of truth and are unchanged above.
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
  v_shift_ids uuid[];
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

  select array_agg(id) into v_shift_ids
  from shifts
  where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled';

  if v_shift_ids is not null then
    delete from shift_assignments
    where shift_id = any(v_shift_ids) and assignment_role = 'bar_manager';
  end if;

  if p_employee_id is not null and v_shift_ids is not null then
    insert into shift_assignments (shift_id, employee_id, assignment_role)
    select s, p_employee_id, 'bar_manager' from unnest(v_shift_ids) as s;
  end if;
end;
$$;

-- shift_assignments_delete_self_future_week had no assignment_role check
-- at all -- harmless before (bartender/area_manager/area_supervisor are
-- all legitimately self-removable), but a bar manager's row is now a
-- mirror of shift_manager_id, not an independent assignment, so deleting
-- it directly would desync the two without going through
-- set_weekly_shift_manager(). Exclude it; bar manager's own self-removal
-- still goes through the existing Users/Shifts admin flow.
alter policy shift_assignments_delete_self_future_week on shift_assignments
  using (
    current_app_role() in ('bartender', 'shift_manager')
    and assignment_role <> 'bar_manager'
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.week_start > active_week_start()
    )
  );

-- list_employee_shift_counts() already counts bar manager shifts via
-- shift_manager_id (unchanged, still the source of truth for this
-- count); exclude the new mirrored shift_assignments rows from the
-- generic duty subquery so a bar manager's evenings aren't counted
-- twice now that both representations exist.
drop function if exists list_employee_shift_counts();

create function list_employee_shift_counts()
returns table (
  employee_id uuid,
  bartender_count bigint,
  area_manager_count bigint,
  area_supervisor_count bigint,
  bar_manager_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    employee_id,
    count(*) filter (where duty = 'bartender')::bigint as bartender_count,
    count(*) filter (where duty = 'area_manager')::bigint as area_manager_count,
    count(*) filter (where duty = 'area_supervisor')::bigint as area_supervisor_count,
    count(*) filter (where duty = 'bar_manager')::bigint as bar_manager_count
  from (
    select s.shift_manager_id as employee_id, 'bar_manager' as duty
    from shifts_with_effective_status s
    where s.shift_manager_id is not null
      and s.effective_status in ('completed', 'reopened')
    union all
    select employee_id, duty
    from (
      select distinct sa.employee_id, sa.assignment_role::text as duty, s.week_start
      from shift_assignments sa
      join shifts_with_effective_status s on s.id = sa.shift_id
      where s.effective_status in ('completed', 'reopened')
        and sa.assignment_role <> 'bar_manager'
    ) distinct_evenings
  ) counts
  group by employee_id;
$$;
