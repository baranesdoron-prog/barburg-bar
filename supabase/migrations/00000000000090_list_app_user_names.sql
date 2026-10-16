-- app_users_select_own only lets a non-admin read their own row, so the
-- reports list (viewable by any shift_manager/administrator, not just
-- admins) can't resolve shift_reports.generated_by to a name via a
-- plain client select -- same shape as list_employee_roles(), just
-- returning the app_user id -> employee name mapping instead of role.
create function list_app_user_names()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_approved() then
    raise exception 'only approved users can list user names';
  end if;

  return query
    select au.id, e.full_name
    from app_users au
    join employees e on e.id = au.employee_id
    where au.status = 'approved';
end;
$$;

grant execute on function list_app_user_names() to authenticated;
