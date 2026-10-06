-- ensure_upcoming_shifts() runs routinely (every dashboard/shifts-page
-- load for a manager/admin) to make sure the next 12 weeks have shift
-- rows to schedule. Its ON CONFLICT ... WHERE status <> 'cancelled' only
-- skips when a *non-cancelled* row already exists -- a cancelled shift
-- doesn't count, so this silently created a brand-new 'published'
-- duplicate for any previously-cancelled upcoming week, every single
-- time it ran. In effect, cancelling a shift more than ~12 weeks before
-- it happens was never durable: the next manager login would quietly
-- resurrect it. This is what produced the pile of duplicate rows found
-- on 2026-10-15 (4 cancelled closings + fresh published ones). Skip
-- provisioning a slot that already has ANY row, cancelled or not --
-- a deliberate cancellation is a decision, not a gap to auto-fill.
create or replace function ensure_upcoming_shifts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
  v_thu_start timestamptz;
  v_thu_mid   timestamptz;
  v_thu_end   timestamptz;
  i int;
begin
  if not (current_app_role() in ('administrator', 'shift_manager', 'bar_manager')) then
    raise exception 'only a manager can provision upcoming shifts';
  end if;

  for i in 0..12 loop
    v_week := active_week_start() + (i * 7);
    v_thu_start := (v_week + 4 + time '19:30') at time zone 'Asia/Jerusalem';
    v_thu_mid   := (v_week + 4 + time '22:00') at time zone 'Asia/Jerusalem';
    v_thu_end   := (v_week + 5 + time '00:30') at time zone 'Asia/Jerusalem';

    if not exists (select 1 from shifts where week_start = v_week and shift_type = 'opening') then
      insert into shifts (start_time, end_time, shift_type, status, week_start, created_by, required_staff_count)
      values (v_thu_start, v_thu_mid, 'opening', 'published', v_week, auth.uid(), 3);
    end if;

    if not exists (select 1 from shifts where week_start = v_week and shift_type = 'closing') then
      insert into shifts (start_time, end_time, shift_type, status, week_start, created_by, required_staff_count)
      values (v_thu_mid, v_thu_end, 'closing', 'published', v_week, auth.uid(), 3);
    end if;
  end loop;
end;
$$;
