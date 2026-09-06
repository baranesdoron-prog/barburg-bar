-- Bartenders are fundamentally per-shift (a week's opening and closing
-- shift can have different people working them -- e.g. someone only
-- available for the opening), unlike the shift manager and area
-- manager, which are genuinely week-level roles that cascade onto both
-- shifts. Tracking bartender_ids as a single week-level array on
-- shift_manager_assignments also meant it silently diverged from real
-- shift_assignments the moment someone was staffed via ShiftDetail's
-- own per-shift picker instead of this screen -- exactly what happened
-- with a real bartender who was only ever visible on the dashboard's
-- capacity badge, never on this screen.
--
-- Drop that array; the Allocations screen now reads/writes real
-- shift_assignments directly, split into an opening selector and a
-- closing selector, so it's always the same data ShiftDetail.tsx and
-- the dashboard's capacity badge already use -- no separate ledger to
-- fall out of sync.
alter table shift_manager_assignments drop constraint bartender_ids_max_three;
alter table shift_manager_assignments drop column bartender_ids;

create or replace function set_weekly_team(
  p_week_start date,
  p_shift_manager_id uuid,
  p_area_manager_id uuid
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
  v_prev_area_manager_id uuid;
  v_shift_id uuid;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only a manager can assign a weekly team';
  end if;

  select area_manager_id into v_prev_area_manager_id
  from shift_manager_assignments where week_start = p_week_start;

  insert into shift_manager_assignments (week_start, employee_id, area_manager_id, assigned_by)
  values (p_week_start, p_shift_manager_id, p_area_manager_id, auth.uid())
  on conflict (week_start) do update
    set employee_id = excluded.employee_id,
        area_manager_id = excluded.area_manager_id,
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

  if v_prev_area_manager_id is distinct from p_area_manager_id then
    for v_shift_id in
      select id from shifts where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled'
    loop
      if v_prev_area_manager_id is not null then
        delete from shift_assignments sa
        where sa.shift_id = v_shift_id
          and sa.employee_id = v_prev_area_manager_id
          and not exists (select 1 from attendance_records ar where ar.shift_assignment_id = sa.id);
      end if;

      if p_area_manager_id is not null then
        insert into shift_assignments (shift_id, employee_id)
        values (v_shift_id, p_area_manager_id)
        on conflict (shift_id, employee_id) do nothing;
      end if;
    end loop;
  end if;
end;
$$;
