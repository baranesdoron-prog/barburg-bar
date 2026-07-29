-- Pre-invite an employee: an administrator assigns a role/employee ahead
-- of time by email; a matching signup auto-pairs instead of waiting for
-- manual approval. Non-matching signups go through the flow unchanged.

create table employee_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role app_role not null,
  employee_id uuid references employees(id),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'cancelled')),
  invited_by uuid not null default auth.uid() references app_users(id),
  claimed_by uuid references app_users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invite_role_requires_employee check (
    role not in ('bartender', 'shift_manager') or employee_id is not null
  )
);

create unique index employee_invites_pending_email_idx
  on employee_invites (lower(email))
  where status = 'pending';

alter table employee_invites enable row level security;

create policy employee_invites_select_admin on employee_invites
  for select using (is_admin());

create policy employee_invites_insert_admin on employee_invites
  for insert with check (is_admin());

create policy employee_invites_update_admin on employee_invites
  for update using (is_admin()) with check (is_admin());

-- No delete policy: cancelling flips status to 'cancelled', same
-- never-hard-delete convention used elsewhere in this schema.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite employee_invites;
begin
  select * into v_invite
  from employee_invites
  where lower(email) = lower(new.email) and status = 'pending'
  order by created_at desc
  limit 1;

  if found then
    insert into public.app_users (id, status, role, employee_id, approved_by, approved_at)
    values (new.id, 'approved', v_invite.role, v_invite.employee_id, v_invite.invited_by, now());

    update employee_invites
    set status = 'claimed', claimed_by = new.id, claimed_at = now()
    where id = v_invite.id;
  else
    insert into public.app_users (id, status) values (new.id, 'pending_approval');
  end if;

  return new;
end;
$$;
