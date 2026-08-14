-- Temporary role delegation: an admin can grant a user a different role
-- for a bounded date range (e.g. covering as administrator for a week
-- while the real manager is away), without making it a permanent second
-- role. current_app_role() is the single choke point every RLS policy in
-- this schema goes through, so extending just this one function is enough
-- for every existing policy to respect an active delegation automatically.

create table role_delegations (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references app_users(id),
  delegated_role app_role not null,
  starts_on date not null,
  ends_on date not null,
  granted_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint ends_after_starts check (ends_on >= starts_on)
);

alter table role_delegations enable row level security;

create policy role_delegations_select_approved on role_delegations
  for select using (is_approved());

create policy role_delegations_write_admin on role_delegations
  for all using (is_admin()) with check (is_admin());

create or replace function current_app_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select rd.delegated_role
      from role_delegations rd
      join app_users au on au.id = rd.app_user_id
      where rd.app_user_id = auth.uid()
        and au.status = 'approved'
        and (now() at time zone 'Asia/Jerusalem')::date between rd.starts_on and rd.ends_on
      order by rd.starts_on desc
      limit 1
    ),
    (select role from app_users where id = auth.uid() and status = 'approved')
  );
$$;
