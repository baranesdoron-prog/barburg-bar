-- 1. area_manager needs an employee record, same as bartender/shift_manager.
alter table app_users drop constraint role_requires_employee;
alter table app_users add constraint role_requires_employee check (
  role not in ('bartender', 'shift_manager', 'bar_manager', 'area_manager')
  or employee_id is not null
);

alter table employee_invites drop constraint invite_role_requires_employee;
alter table employee_invites add constraint invite_role_requires_employee check (
  role not in ('bartender', 'shift_manager', 'area_manager') or employee_id is not null
);

-- 2. approve_user() must also require an employee_id for area_manager.
create or replace function approve_user(
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

  if p_role in ('bartender', 'shift_manager', 'bar_manager', 'area_manager') and p_employee_id is null then
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

-- 3. Extend the self-service shift RLS policies to also cover area_manager,
-- and cap area_manager assignments at one per week (they cover the whole
-- evening, opening+closing together, so a second one can't join once one is on it).
drop policy shift_assignments_insert_self on shift_assignments;
create policy shift_assignments_insert_self on shift_assignments
  for insert
  with check (
    current_app_role() in ('bartender', 'shift_manager', 'area_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          s.required_staff_count is null
          or (select count(*) from shift_assignments sa where sa.shift_id = s.id) < s.required_staff_count
        )
    )
    and (
      current_app_role() <> 'area_manager'
      or not exists (
        select 1
        from shift_assignments sa
        join shifts s2 on s2.id = sa.shift_id
        join app_users au on au.employee_id = sa.employee_id
        where au.role = 'area_manager'
          and s2.week_start = (select week_start from shifts s3 where s3.id = shift_id)
      )
    )
  );

drop policy shift_assignments_delete_self_future_week on shift_assignments;
create policy shift_assignments_delete_self_future_week on shift_assignments
  for delete
  using (
    current_app_role() in ('bartender', 'shift_manager', 'area_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.week_start > active_week_start()
    )
  );

-- 4. Self-service signup: new middle branch between the existing
-- invite-claim path and the pending-approval fallback. Client-selectable
-- role is whitelisted to bartender/area_manager only, regardless of what
-- a crafted request sends - never administrator/shift_manager/bar_manager.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite employee_invites;
  v_role app_role;
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
    v_role := case new.raw_user_meta_data->>'role'
      when 'area_manager' then 'area_manager'::app_role
      else 'bartender'::app_role
    end;
    v_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');

    insert into employees (full_name, phone)
    values (v_full_name, v_phone)
    returning id into v_employee_id;

    insert into public.app_users (id, status, role, employee_id, approved_at)
    values (new.id, 'approved', v_role, v_employee_id, now());

    return new;
  end if;

  insert into public.app_users (id, status) values (new.id, 'pending_approval');
  return new;
end;
$$;
