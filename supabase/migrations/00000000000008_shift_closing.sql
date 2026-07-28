-- Milestone 7: shift closing wizard — journal, follow-ups, inventory
-- counting, and immutable report generation.

create type journal_category as enum (
  'equipment_issue',
  'broken_equipment',
  'items_missing',
  'special_event',
  'improvement_suggestion',
  'positive_feedback',
  'general_note'
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id),
  category journal_category not null,
  description text not null,
  quantity integer,
  requires_follow_up boolean not null default false,
  photo_url text,
  author uuid not null default auth.uid() references app_users(id),
  created_at timestamptz not null default now()
);

alter table journal_entries enable row level security;

create policy journal_entries_select_approved on journal_entries
  for select
  using (is_approved());

create policy journal_entries_insert_managers on journal_entries
  for insert
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

-- No update/delete: a journal entry, once written, is part of the
-- historical record. Correcting a mistake means adding a new entry.

create table operational_follow_ups (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null unique references journal_entries(id),
  shift_id uuid not null references shifts(id),
  created_at timestamptz not null default now()
);

alter table operational_follow_ups enable row level security;

create policy operational_follow_ups_select_bar_managers on operational_follow_ups
  for select
  using (current_app_role() in ('bar_manager', 'administrator'));

-- No insert policy: only the trigger below (security definer) creates rows.

create function create_follow_up_for_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requires_follow_up then
    insert into operational_follow_ups (journal_entry_id, shift_id)
    values (new.id, new.shift_id);
  end if;
  return new;
end;
$$;

create trigger journal_entries_create_follow_up
  after insert on journal_entries
  for each row execute function create_follow_up_for_journal_entry();

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger inventory_items_set_updated_at
  before update on inventory_items
  for each row execute function set_updated_at();

alter table inventory_items enable row level security;

create policy inventory_items_select_approved on inventory_items
  for select
  using (is_approved());

create policy inventory_items_insert_managers on inventory_items
  for insert
  with check (current_app_role() in ('bar_manager', 'administrator'));

create policy inventory_items_update_managers on inventory_items
  for update
  using (current_app_role() in ('bar_manager', 'administrator'))
  with check (current_app_role() in ('bar_manager', 'administrator'));

create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id),
  inventory_item_id uuid not null references inventory_items(id),
  quantity_counted numeric not null,
  recorded_by uuid not null default auth.uid() references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id, inventory_item_id)
);

create trigger inventory_counts_set_updated_at
  before update on inventory_counts
  for each row execute function set_updated_at();

alter table inventory_counts enable row level security;

create policy inventory_counts_select_approved on inventory_counts
  for select
  using (is_approved());

create policy inventory_counts_insert_staffers on inventory_counts
  for insert
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

create policy inventory_counts_update_staffers on inventory_counts
  for update
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'))
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

create table shift_reports (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts(id),
  generated_by uuid not null default auth.uid() references app_users(id),
  generated_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table shift_reports enable row level security;

create policy shift_reports_select_approved on shift_reports
  for select
  using (is_approved());

-- No insert/update policy: only finish_shift_closing() writes it.

create function finish_shift_closing(p_shift_id uuid)
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

create function reopen_shift(p_shift_id uuid)
returns shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
begin
  if (current_app_role() in ('bar_manager', 'administrator')) is not true then
    raise exception 'only bar managers can reopen a shift';
  end if;

  update shifts
  set status = 'reopened'
  where id = p_shift_id and status = 'completed'
  returning * into v_shift;

  if not found then
    raise exception 'completed shift % not found', p_shift_id;
  end if;

  return v_shift;
end;
$$;
