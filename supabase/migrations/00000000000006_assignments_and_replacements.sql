-- Milestone 5: assignments + replacement requests.

alter table shifts add column required_staff_count integer
  check (required_staff_count is null or required_staff_count > 0);

create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id),
  employee_id uuid not null references employees(id),
  created_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

alter table shift_assignments enable row level security;

create policy shift_assignments_select_approved on shift_assignments
  for select
  using (is_approved());

create policy shift_assignments_insert_staffers on shift_assignments
  for insert
  with check (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

create policy shift_assignments_delete_staffers on shift_assignments
  for delete
  using (current_app_role() in ('shift_manager', 'bar_manager', 'administrator'));

-- No update policy: reassignment on approval goes through
-- approve_replacement_request() (security definer) only.

create type replacement_request_status as enum ('pending', 'approved', 'rejected');

create table replacement_requests (
  id uuid primary key default gen_random_uuid(),
  shift_assignment_id uuid not null references shift_assignments(id),
  requested_by uuid not null default auth.uid() references app_users(id),
  reason text,
  substitute_employee_id uuid references employees(id),
  status replacement_request_status not null default 'pending',
  reviewed_by uuid references app_users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

alter table replacement_requests enable row level security;

create policy replacement_requests_select on replacement_requests
  for select
  using (
    is_approved()
    and (requested_by = auth.uid() or current_app_role() in ('shift_manager', 'bar_manager', 'administrator'))
  );

-- No insert/update policy: request_replacement() / approve_replacement_request() /
-- reject_replacement_request() (all security definer) are the only write paths,
-- matching the app_users pattern from Milestone 1.

-- Dropped and recreated rather than CREATE OR REPLACE: `s.*` now includes
-- the just-added required_staff_count column ahead of effective_status,
-- which shifts that column's position — Postgres only allows CREATE OR
-- REPLACE VIEW to append new columns at the very end, not reorder existing
-- ones. Nothing else depends on this view, so dropping it is safe.
drop view shifts_with_effective_status;

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

create function request_replacement(
  p_shift_assignment_id uuid,
  p_reason text,
  p_substitute_employee_id uuid default null
)
returns replacement_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_employee_id uuid;
  v_caller_employee_id uuid;
  v_row replacement_requests;
begin
  select employee_id into v_assignment_employee_id
  from shift_assignments where id = p_shift_assignment_id;

  if not found then
    raise exception 'assignment % not found', p_shift_assignment_id;
  end if;

  select employee_id into v_caller_employee_id from app_users where id = auth.uid();

  if v_caller_employee_id is null or v_caller_employee_id != v_assignment_employee_id then
    raise exception 'you can only request a replacement for your own assignment';
  end if;

  if exists (
    select 1 from replacement_requests
    where shift_assignment_id = p_shift_assignment_id and status = 'pending'
  ) then
    raise exception 'a replacement request is already pending for this assignment';
  end if;

  insert into replacement_requests (shift_assignment_id, requested_by, reason, substitute_employee_id)
  values (p_shift_assignment_id, auth.uid(), p_reason, p_substitute_employee_id)
  returning * into v_row;

  return v_row;
end;
$$;

create function approve_replacement_request(p_request_id uuid, p_substitute_employee_id uuid)
returns replacement_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row replacement_requests;
  v_assignment_id uuid;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only shift managers can approve replacement requests';
  end if;

  select shift_assignment_id into v_assignment_id
  from replacement_requests where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'pending replacement request % not found', p_request_id;
  end if;

  update shift_assignments set employee_id = p_substitute_employee_id where id = v_assignment_id;

  update replacement_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id
  returning * into v_row;

  return v_row;
end;
$$;

create function reject_replacement_request(p_request_id uuid, p_review_note text default null)
returns replacement_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row replacement_requests;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only shift managers can reject replacement requests';
  end if;

  update replacement_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
  where id = p_request_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'pending replacement request % not found', p_request_id;
  end if;

  return v_row;
end;
$$;
