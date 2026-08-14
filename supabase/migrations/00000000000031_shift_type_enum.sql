-- Formalize shift_type from free text into a real opening/closing
-- distinction. Postgres refuses to ALTER COLUMN ... TYPE a column a view
-- depends on, so drop + recreate shifts_with_effective_status the same
-- way migrations 00000000000006 and 00000000000025 already did for this
-- exact view.

create type shift_kind as enum ('opening', 'closing');

drop view shifts_with_effective_status;

alter table shifts
  alter column shift_type type shift_kind
  using (case when shift_type = 'פתיחה' then 'opening' else 'closing' end)::shift_kind;

create view shifts_with_effective_status
  with (security_invoker = true) as
select
  s.*,
  case
    when s.status in ('draft', 'cancelled', 'completed', 'reopened') then s.status::text
    when s.status = 'published' and now() < s.start_time then 'published'
    when s.status = 'published' and now() between s.start_time and s.end_time then 'active'
    else 'waiting_for_closure'
  end as effective_status,
  (select count(*) from shift_assignments sa where sa.shift_id = s.id) as assigned_count
from shifts s;

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
    insert into shifts (start_time, end_time, shift_type, shift_manager_id, status) values
      (v_thu_start, v_thu_mid, 'opening', p_employee_id, 'published'),
      (v_thu_mid, v_thu_end, 'closing', p_employee_id, 'published');
  end if;
end;
$$;

create or replace function finish_shift_closing(p_shift_id uuid)
returns shift_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
  v_snapshot jsonb;
  v_report shift_reports;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only shift managers can close a shift';
  end if;

  select * into v_shift from shifts where id = p_shift_id;
  if not found then
    raise exception 'shift % not found', p_shift_id;
  end if;

  if v_shift.shift_type <> 'closing' then
    raise exception 'only closing shifts can be closed';
  end if;

  if v_shift.status not in ('published', 'reopened') then
    raise exception 'shift must be published or reopened to close (current status: %)', v_shift.status;
  end if;

  if now() < v_shift.end_time then
    raise exception 'a shift cannot be closed before its scheduled end time';
  end if;

  select jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', sa.employee_id,
        'employee_name', e.full_name,
        'status', ar.status,
        'note', ar.note
      ))
      from shift_assignments sa
      join employees e on e.id = sa.employee_id
      left join attendance_records ar on ar.shift_assignment_id = sa.id
      where sa.shift_id = p_shift_id
    ), '[]'::jsonb),
    'journal_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', je.category,
        'description', je.description,
        'quantity', je.quantity,
        'requires_follow_up', je.requires_follow_up,
        'author_id', je.author,
        'created_at', je.created_at
      ))
      from journal_entries je
      where je.shift_id = p_shift_id
    ), '[]'::jsonb),
    'inventory_counts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_name', ii.name,
        'unit', ii.unit,
        'quantity_counted', ic.quantity_counted
      ))
      from inventory_counts ic
      join inventory_items ii on ii.id = ic.inventory_item_id
      where ic.shift_id = p_shift_id
    ), '[]'::jsonb)
  ) into v_snapshot;

  insert into shift_reports (shift_id, generated_by, generated_at, snapshot)
  values (p_shift_id, auth.uid(), now(), v_snapshot)
  on conflict (shift_id) do update
    set generated_by = excluded.generated_by,
        generated_at = excluded.generated_at,
        snapshot = excluded.snapshot
  returning * into v_report;

  update shifts set status = 'completed' where id = p_shift_id;

  return v_report;
end;
$$;
