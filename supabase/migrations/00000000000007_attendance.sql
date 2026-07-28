-- Milestone 6: attendance. Standalone capability for now; Milestone 7's
-- closing wizard will later wrap this as its first step.

create type attendance_status as enum ('present', 'absent', 'late');

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  shift_assignment_id uuid not null references shift_assignments(id),
  status attendance_status not null,
  note text,
  recorded_by uuid not null default auth.uid() references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_assignment_id)
);

create trigger attendance_records_set_updated_at
  before update on attendance_records
  for each row execute function set_updated_at();

alter table attendance_records enable row level security;

create policy attendance_records_select_approved on attendance_records
  for select
  using (is_approved());

create policy attendance_records_insert_managers on attendance_records
  for insert
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

create policy attendance_records_update_managers on attendance_records
  for update
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'))
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

-- No delete policy: immutable history, correct mistakes via update.
