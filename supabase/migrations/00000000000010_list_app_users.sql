-- Users management page: an admin-only listing of ALL app_users (not just
-- pending ones, unlike list_pending_app_users() from Milestone 2). No
-- write-side changes needed - approve_user()/suspend_user() already do
-- everything a role change / suspend / reactivate needs.

create function list_app_users_for_admin()
returns table (
  id uuid,
  email text,
  role app_role,
  status app_user_status,
  employee_id uuid,
  employee_name text,
  created_at timestamptz,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if is_admin() is not true then
    raise exception 'only administrators can list users';
  end if;

  return query
    select au.id, u.email::text, au.role, au.status, au.employee_id, e.full_name, au.created_at, au.approved_at
    from app_users au
    join auth.users u on u.id = au.id
    left join employees e on e.id = au.employee_id
    order by au.created_at desc;
end;
$$;
