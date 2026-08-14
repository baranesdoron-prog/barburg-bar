-- Give every shift an explicit week (its Sunday), and enforce at most one
-- opening and one closing per week regardless of which path creates the
-- shift - set_weekly_shift_manager() already guaranteed this implicitly
-- for the automated path; this closes the same gap for manual creation.

alter table shifts add column week_start date;

update shifts
set week_start = (start_time at time zone 'Asia/Jerusalem')::date
  - (extract(dow from (start_time at time zone 'Asia/Jerusalem')::date))::int;

alter table shifts alter column week_start set not null;

-- Migration 00000000000031 defaulted any pre-existing free-text
-- shift_type it couldn't map to 'closing'. Two old completed test shifts
-- (2026-07-28, 2026-07-29) both landed on 'closing' in the same
-- Sun-Thu week, which would violate the unique index below - resolve by
-- treating the earlier of the two as 'opening' (also chronologically
-- correct: it happened first).
update shifts
set shift_type = 'opening'
where id = 'a2523486-182a-4cbc-9e01-b14ae3e97eb6';

-- Non-cancelled shifts only, so cancelling one frees its slot for a
-- replacement - same "cancel, never delete" convention as elsewhere.
create unique index shifts_one_per_week_type
  on shifts (week_start, shift_type)
  where status <> 'cancelled';

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
  if not is_admin() then
    raise exception 'only an administrator can assign shift managers';
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
