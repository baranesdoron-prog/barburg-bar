-- The weekly bar-manager picker (ShiftForm.tsx, the dashboard's שיבוץ
-- מנהל בר card, and the year-schedule page) only offered employees whose
-- app_user role is shift_manager. Widen it to also offer administrators
-- who have a linked employee record (an admin without one has no
-- employee to assign here, same as any other role -- shift_manager_id/
-- shift_manager_assignments.employee_id are both employee-scoped).
create or replace function list_shift_manager_employees()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only managers can list shift managers';
  end if;

  return query
    select e.id, e.full_name
    from employees e
    join app_users au on au.employee_id = e.id
    where au.role in ('shift_manager', 'administrator') and au.status = 'approved' and e.active
    order by e.full_name;
end;
$$;
