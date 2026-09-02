-- A published shift no longer requires a manager - the next 4 weeks
-- get auto-provisioned before anyone picks who's running them.
alter table shifts drop constraint published_requires_manager;

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

  for i in 0..3 loop
    v_week := active_week_start() + (i * 7);
    v_thu_start := (v_week + 4 + time '19:30') at time zone 'Asia/Jerusalem';
    v_thu_mid   := (v_week + 4 + time '22:00') at time zone 'Asia/Jerusalem';
    v_thu_end   := (v_week + 5 + time '00:30') at time zone 'Asia/Jerusalem';

    insert into shifts (start_time, end_time, shift_type, status, week_start, created_by)
    values
      (v_thu_start, v_thu_mid, 'opening', 'published', v_week, auth.uid()),
      (v_thu_mid, v_thu_end, 'closing', 'published', v_week, auth.uid())
    on conflict (week_start, shift_type) where status <> 'cancelled' do nothing;
  end loop;
end;
$$;

grant execute on function ensure_upcoming_shifts() to authenticated;
