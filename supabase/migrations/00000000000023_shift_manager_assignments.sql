-- Standing admin task: keep a shift manager assigned to each upcoming week.
-- Assigning a week materializes that week's two Thursday shifts (opening
-- 19:30-22:00, closing 22:00-00:30), already published with that manager
-- attached, so the shift manager's only remaining job is staffing bartenders.

create table shift_manager_assignments (
  week_start date primary key,
  employee_id uuid not null references employees(id),
  assigned_by uuid references app_users(id),
  assigned_at timestamptz not null default now()
);

alter table shift_manager_assignments enable row level security;

create policy shift_manager_assignments_select_approved on shift_manager_assignments
  for select using (is_approved());

create policy shift_manager_assignments_write_admin on shift_manager_assignments
  for all using (is_admin()) with check (is_admin());

create function set_weekly_shift_manager(p_week_start date, p_employee_id uuid)
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
    insert into shifts (start_time, end_time, shift_type, shift_manager_id, status) values
      (v_thu_start, v_thu_mid, 'פתיחה', p_employee_id, 'published'),
      (v_thu_mid, v_thu_end, 'סגירה', p_employee_id, 'published');
  end if;
end;
$$;
