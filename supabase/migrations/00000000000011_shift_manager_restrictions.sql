-- Restrict who can be picked as a shift's manager, and who can close it.

create function list_shift_manager_employees()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (current_app_role() in ('bar_manager', 'administrator')) is not true then
    raise exception 'only managers can list shift managers';
  end if;

  return query
    select e.id, e.full_name
    from employees e
    join app_users au on au.employee_id = e.id
    where au.role = 'shift_manager' and au.status = 'approved' and e.active
    order by e.full_name;
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
  select * into v_shift from shifts where id = p_shift_id;
  if not found then
    raise exception 'shift % not found', p_shift_id;
  end if;

  if (
    exists (
      select 1 from app_users
      where id = auth.uid() and employee_id = v_shift.shift_manager_id
    )
    or current_app_role() in ('bar_manager', 'administrator')
  ) is not true then
    raise exception 'only the assigned shift manager, or a bar manager, can close this shift';
  end if;

  if v_shift.status not in ('published', 'reopened') then
    raise exception 'shift must be published or reopened to close (current status: %)', v_shift.status;
  end if;

  if now() < v_shift.end_time then
    raise exception 'a shift cannot be closed before its scheduled end time';
  end if;

  if exists (
    select 1 from inventory_items ii
    where ii.active
      and not exists (
        select 1 from inventory_counts ic
        where ic.shift_id = p_shift_id and ic.inventory_item_id = ii.id
      )
  ) then
    raise exception 'all active inventory items must be counted before closing this shift';
  end if;

  if not exists (select 1 from journal_entries where shift_id = p_shift_id) then
    raise exception 'at least one journal entry is required before closing this shift';
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
