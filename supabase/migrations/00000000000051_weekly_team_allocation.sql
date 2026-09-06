-- The weekly bar-manager picker becomes a full team allocation: shift
-- manager (as before) plus a single area manager and up to 3
-- bartenders. shift_manager_assignments already tracks "who's planned
-- for this week" (week_start pk) -- extend it rather than add new
-- tables, so a new RPC can diff the previous selection against the new
-- one when reconciling real shift_assignments rows.
alter table shift_manager_assignments add column area_manager_id uuid references employees(id);
alter table shift_manager_assignments add column bartender_ids uuid[];
alter table shift_manager_assignments add constraint bartender_ids_max_three
  check (bartender_ids is null or array_length(bartender_ids, 1) <= 3);

create function set_weekly_team(
  p_week_start date,
  p_shift_manager_id uuid,
  p_area_manager_id uuid,
  p_bartender_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thu_start timestamptz := (p_week_start + 4 + time '19:30') at time zone 'Asia/Jerusalem';
  v_thu_mid   timestamptz := (p_week_start + 4 + time '22:00') at time zone 'Asia/Jerusalem';
  v_thu_end   timestamptz := (p_week_start + 5 + time '00:30') at time zone 'Asia/Jerusalem';
  v_prev shift_manager_assignments;
  v_old_roster uuid[];
  v_new_roster uuid[];
  v_shift_id uuid;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only a manager can assign a weekly team';
  end if;

  if p_bartender_ids is not null and array_length(p_bartender_ids, 1) > 3 then
    raise exception 'at most 3 bartenders can be assigned per week';
  end if;

  select * into v_prev from shift_manager_assignments where week_start = p_week_start;

  v_old_roster := array_remove(
    array_cat(array[v_prev.area_manager_id], coalesce(v_prev.bartender_ids, array[]::uuid[])),
    null
  );
  v_new_roster := array_remove(
    array_cat(array[p_area_manager_id], coalesce(p_bartender_ids, array[]::uuid[])),
    null
  );

  insert into shift_manager_assignments (week_start, employee_id, area_manager_id, bartender_ids, assigned_by)
  values (p_week_start, p_shift_manager_id, p_area_manager_id, p_bartender_ids, auth.uid())
  on conflict (week_start) do update
    set employee_id = excluded.employee_id,
        area_manager_id = excluded.area_manager_id,
        bartender_ids = excluded.bartender_ids,
        assigned_by = excluded.assigned_by,
        assigned_at = now();

  update shifts
  set shift_manager_id = p_shift_manager_id
  where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled';

  if not exists (select 1 from shifts where start_time in (v_thu_start, v_thu_mid)) then
    insert into shifts (start_time, end_time, shift_type, shift_manager_id, status, week_start, required_staff_count) values
      (v_thu_start, v_thu_mid, 'opening', p_shift_manager_id, 'published', p_week_start, 3),
      (v_thu_mid, v_thu_end, 'closing', p_shift_manager_id, 'published', p_week_start, 3);
  end if;

  for v_shift_id in
    select id from shifts where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled'
  loop
    delete from shift_assignments sa
    where sa.shift_id = v_shift_id
      and sa.employee_id = any(v_old_roster)
      and not (sa.employee_id = any(v_new_roster))
      and not exists (select 1 from attendance_records ar where ar.shift_assignment_id = sa.id);

    insert into shift_assignments (shift_id, employee_id)
    select v_shift_id, emp_id
    from unnest(v_new_roster) as emp_id
    on conflict (shift_id, employee_id) do nothing;
  end loop;
end;
$$;

grant execute on function set_weekly_team(date, uuid, uuid, uuid[]) to authenticated;
