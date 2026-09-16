-- Self-registration no longer offers a role choice (the UI's
-- bartender/area_manager radio is gone) -- every self-signup becomes
-- a bartender, full stop. area_manager is now admin-assigned only
-- (via approve_user / Users.tsx), same as shift_manager already was.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite employee_invites;
  v_full_name text;
  v_phone text;
  v_employee_id uuid;
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

    return new;
  end if;

  v_full_name := nullif(trim(new.raw_user_meta_data->>'full_name'), '');

  if v_full_name is not null then
    v_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');

    insert into employees (full_name, phone)
    values (v_full_name, v_phone)
    returning id into v_employee_id;

    insert into public.app_users (id, status, role, employee_id, approved_at)
    values (new.id, 'approved', 'bartender', v_employee_id, now());

    return new;
  end if;

  insert into public.app_users (id, status) values (new.id, 'pending_approval');
  return new;
end;
$$;
