-- BARBURG Milestone 1: identity & permission foundation.
--
-- Three separate concepts, on purpose:
--   auth.users   -> authentication only (managed by Supabase Auth)
--   app_users    -> the ONE authoritative source of role/permission/approval
--   employees    -> operational record, may exist without a login

create type app_role as enum (
  'administrator',
  'bar_manager',
  'shift_manager',
  'employee',
  'viewer'
);

create type app_user_status as enum (
  'pending_approval',
  'approved',
  'suspended'
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  role app_role, -- null until approved
  status app_user_status not null default 'pending_approval',
  employee_id uuid references employees (id),
  approved_by uuid references app_users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_role_requires_employee check (
    role not in ('employee', 'shift_manager', 'bar_manager') or employee_id is not null
  )
);

create index app_users_employee_id_idx on app_users (employee_id);

-- Every new auth identity is pending approval, with no role, by default.
create function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, status) values (new.id, 'pending_approval');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- keep updated_at honest on both tables
create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_users_set_updated_at
  before update on app_users
  for each row execute function set_updated_at();

create trigger employees_set_updated_at
  before update on employees
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Permission helper functions (SECURITY DEFINER so they can read app_users
-- regardless of the caller's own RLS visibility). All future RLS policies —
-- for shifts, inventory, everything — should be built on top of these, never
-- re-implemented per table.
-- ---------------------------------------------------------------------------

create function current_app_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from app_users where id = auth.uid() and status = 'approved';
$$;

create function is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users where id = auth.uid() and status = 'approved'
  );
$$;

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_app_role() = 'administrator';
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table app_users enable row level security;
alter table employees enable row level security;

-- app_users: everyone can read their own row (so the frontend can show the
-- pending-approval gate); administrators can read every row.
create policy app_users_select_own on app_users
  for select
  using (id = auth.uid() or is_admin());

-- Nobody can insert directly (the trigger does it via security definer).
-- Only administrators can update rows (role/status/employee_id changes go
-- through the approve_user() RPC below, never a raw client-side update).
create policy app_users_update_admin_only on app_users
  for update
  using (is_admin())
  with check (is_admin());

-- employees: readable by any approved staff member; writes restricted to
-- bar_manager/administrator. The employee-management UI itself ships later,
-- but the server-side rule exists from day one.
create policy employees_select_approved on employees
  for select
  using (is_approved());

create policy employees_write_managers on employees
  for all
  using (current_app_role() in ('administrator', 'bar_manager'))
  with check (current_app_role() in ('administrator', 'bar_manager'));

-- ---------------------------------------------------------------------------
-- approve_user RPC — the only way a pending user becomes approved.
-- Admin-only. Enforces the "roles requiring Employee" rule server-side so it
-- can never be bypassed by a client that skips the (future) approval UI.
-- ---------------------------------------------------------------------------

create function approve_user(
  p_user_id uuid,
  p_role app_role,
  p_employee_id uuid default null
)
returns app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row app_users;
begin
  if not is_admin() then
    raise exception 'only administrators can approve users';
  end if;

  if p_role in ('employee', 'shift_manager', 'bar_manager') and p_employee_id is null then
    raise exception 'role % requires an employee_id', p_role;
  end if;

  update app_users
  set role = p_role,
      status = 'approved',
      employee_id = p_employee_id,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'app_user % not found', p_user_id;
  end if;

  return v_row;
end;
$$;
