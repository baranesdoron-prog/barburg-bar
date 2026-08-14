-- Block manual creation of a new shift for a week that's already passed.
-- Scoped to the plain-insert path only: set_weekly_shift_manager() is
-- security definer and bypasses RLS, so it's unaffected and can still
-- retroactively fix a past week's shifts (ShiftManagerSchedule.tsx's
-- year view relies on that).

create function active_week_start()
returns date
language sql
stable
as $$
  select case
    when extract(dow from (now() at time zone 'Asia/Jerusalem')::date) >= 5
      then (now() at time zone 'Asia/Jerusalem')::date
        - extract(dow from (now() at time zone 'Asia/Jerusalem')::date)::int + 7
    else (now() at time zone 'Asia/Jerusalem')::date
        - extract(dow from (now() at time zone 'Asia/Jerusalem')::date)::int
  end;
$$;

drop policy shifts_insert_managers on shifts;

create policy shifts_insert_managers on shifts
  for insert
  with check (
    current_app_role() in ('administrator', 'bar_manager')
    and week_start >= active_week_start()
  );
