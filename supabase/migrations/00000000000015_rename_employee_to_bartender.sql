-- Rename the app_role value 'employee' to 'bartender' -- same permissions,
-- clearer name for this bar's actual staff. Existing app_users rows update
-- automatically since it's the same enum value, just relabeled.

alter type app_role rename value 'employee' to 'bartender';

alter table app_users drop constraint employee_role_requires_employee;
alter table app_users add constraint role_requires_employee check (
  role not in ('bartender', 'shift_manager', 'bar_manager') or employee_id is not null
);

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
  if is_admin() is not true then
    raise exception 'only administrators can approve users';
  end if;

  if p_role in ('bartender', 'shift_manager', 'bar_manager') and p_employee_id is null then
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
