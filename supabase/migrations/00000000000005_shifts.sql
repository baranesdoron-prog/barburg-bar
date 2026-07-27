-- Milestone 4: shift data model. Foundation for assignments, attendance,
-- closing, journal, and reports in later milestones.

create type shift_status as enum ('draft', 'published', 'completed', 'cancelled', 'reopened');

create table shifts (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  shift_type text not null,
  shift_manager_id uuid references employees(id),
  notes text,
  status shift_status not null default 'draft',
  created_by uuid not null default auth.uid() references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint end_after_start check (end_time > start_time),
  constraint published_requires_manager check (status in ('draft', 'cancelled') or shift_manager_id is not null)
);

create index shifts_start_time_idx on shifts (start_time);

create trigger shifts_set_updated_at
  before update on shifts
  for each row execute function set_updated_at();

alter table shifts enable row level security;

create policy shifts_select_approved on shifts
  for select
  using (is_approved());

create policy shifts_insert_managers on shifts
  for insert
  with check (current_app_role() in ('administrator', 'bar_manager'));

create policy shifts_update_managers on shifts
  for update
  using (current_app_role() in ('administrator', 'bar_manager'))
  with check (current_app_role() in ('administrator', 'bar_manager'));

-- No delete policy: cancellation is a status change (status = 'cancelled'),
-- never a row delete, per "prefer immutable history over destructive updates".

-- Active / Waiting-for-closure must be calculated from the current time,
-- never manually set. security_invoker so the view enforces the querying
-- user's own RLS on the base table, not the view owner's privileges.
create view shifts_with_effective_status
  with (security_invoker = true) as
select
  s.*,
  case
    when s.status in ('draft', 'cancelled', 'completed', 'reopened') then s.status::text
    when s.status = 'published' and now() < s.start_time then 'published'
    when s.status = 'published' and now() between s.start_time and s.end_time then 'active'
    else 'waiting_for_closure'
  end as effective_status
from shifts s;
