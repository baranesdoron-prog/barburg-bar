-- app_users RLS only lets a user read their own row, so the client has no
-- way to learn which OTHER employees hold which role (needed to show the
-- one-area-manager-per-week "full" state proactively, same as the
-- required_staff_count hint already does). Expose only employee_id+role,
-- not the rest of app_users' fields.
create function list_employee_roles()
returns table (employee_id uuid, role app_role)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_approved() then
    raise exception 'only approved users can list employee roles';
  end if;

  return query
    select au.employee_id, au.role
    from app_users au
    where au.status = 'approved' and au.employee_id is not null;
end;
$$;

grant execute on function list_employee_roles() to authenticated;
