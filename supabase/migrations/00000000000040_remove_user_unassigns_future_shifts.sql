-- Removing a user (suspend) now also clears their future commitments:
-- unassign them from any shift that hasn't started yet, and mark their
-- linked employee inactive so they drop out of every employee picker.
-- Any pending/rejected replacement_requests on those assignments are
-- cleared first since replacement_requests has no cascade delete.
create or replace function suspend_user(p_user_id uuid)
returns app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row app_users;
  v_employee_id uuid;
begin
  if is_admin() is not true then
    raise exception 'only administrators can suspend users';
  end if;

  select employee_id into v_employee_id from app_users where id = p_user_id;

  if v_employee_id is not null then
    delete from replacement_requests
    where shift_assignment_id in (
      select sa.id
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      where sa.employee_id = v_employee_id and s.start_time > now()
    );

    delete from shift_assignments sa
    using shifts s
    where sa.shift_id = s.id
      and sa.employee_id = v_employee_id
      and s.start_time > now();

    update employees set active = false where id = v_employee_id;
  end if;

  update app_users
  set status = 'suspended'
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'app_user % not found', p_user_id;
  end if;

  return v_row;
end;
$$;

-- Reactivating (or any role/employee edit) should also restore the
-- linked employee's active flag, mirroring the above.
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

  if p_employee_id is not null then
    update employees set active = true where id = p_employee_id;
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
