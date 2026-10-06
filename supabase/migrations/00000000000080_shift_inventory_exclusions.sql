-- Lets a bar manager/admin skip a specific item from being required in
-- *this* shift's inventory check (e.g. it wasn't tracked/available
-- tonight) without touching the item's catalog-wide active flag, which
-- would exclude it from every future shift too. Scoped per shift, not a
-- permanent decision -- the item is back in the list next time.
create table shift_inventory_exclusions (
  shift_id uuid not null references shifts(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  excluded_by uuid not null default auth.uid() references app_users(id),
  excluded_at timestamptz not null default now(),
  primary key (shift_id, inventory_item_id)
);

alter table shift_inventory_exclusions enable row level security;

create policy shift_inventory_exclusions_select_approved on shift_inventory_exclusions
  for select
  using (is_approved());

-- Same roles as inventory_counts_insert_staffers/update_staffers -- a
-- delete (undo) is allowed too, unlike counts, since this is a
-- reversible per-shift toggle rather than a historical record.
create policy shift_inventory_exclusions_write_staffers on shift_inventory_exclusions
  for all
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'))
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

-- finish_shift_closing()'s "every active item must be counted" check now
-- also treats an excluded item as satisfied.
create or replace function finish_shift_closing(p_shift_id uuid)
returns shift_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
  v_opening_shift_id uuid;
  v_snapshot jsonb;
  v_report shift_reports;
begin
  select * into v_shift from shifts where id = p_shift_id;
  if not found then
    raise exception 'shift % not found', p_shift_id;
  end if;

  select id into v_opening_shift_id
  from shifts
  where week_start = v_shift.week_start and shift_type = 'opening';

  if (
    exists (
      select 1 from app_users
      where id = auth.uid() and employee_id = v_shift.shift_manager_id
    )
    or current_app_role() in ('bar_manager', 'shift_manager', 'administrator')
  ) is not true then
    raise exception 'only a bar manager or administrator can close this shift';
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
      and not exists (
        select 1 from shift_inventory_exclusions sie
        where sie.shift_id = p_shift_id and sie.inventory_item_id = ii.id
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
      where sa.shift_id in (p_shift_id, v_opening_shift_id)
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
        'quantity_counted', ic.quantity_counted,
        'previous_quantity', prev.quantity_counted,
        'unit_price', ii.unit_price,
        'used_quantity', case
          when prev.quantity_counted is not null then prev.quantity_counted - ic.quantity_counted
          else null
        end,
        'cost', case
          when prev.quantity_counted is not null and ii.unit_price is not null
            then (prev.quantity_counted - ic.quantity_counted) * ii.unit_price
          else null
        end
      ))
      from inventory_counts ic
      join inventory_items ii on ii.id = ic.inventory_item_id
      left join lateral (
        select ic2.quantity_counted
        from inventory_counts ic2
        where ic2.inventory_item_id = ic.inventory_item_id
          and ic2.created_at < ic.created_at
        order by ic2.created_at desc
        limit 1
      ) prev on true
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
