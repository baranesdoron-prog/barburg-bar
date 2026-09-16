-- area_manager stops being a holdable account role and becomes a duty
-- like bartender: something an administrator, shift_manager, or
-- bartender account can be assigned to cover on a shift (via the
-- Allocations screen's אחראי/ת מתחם picker, already widened in the
-- frontend to the same eligible set as bartender duty). The two
-- accounts that currently hold the role become bartenders -- they're
-- real staff, not losing access, just no longer carrying a title that
-- no longer exists at the account level.
update app_users set role = 'bartender' where role = 'area_manager';

-- Defense in depth to match the client (SignUp.tsx's role radio is
-- gone, admin-create-user's ALLOWED_ROLES no longer lists it, Users.tsx's
-- role dropdown derives from roleLabels which no longer has an entry
-- for it): reject it here too, so no path -- crafted request included --
-- can still hand someone the area_manager role.
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

  if p_role::text = 'area_manager' then
    raise exception 'area_manager is no longer an assignable role';
  end if;

  if p_role in ('bartender', 'shift_manager', 'bar_manager') and p_employee_id is null then
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

-- Self-join no longer needs any area_manager-specific handling: nobody
-- can hold that role to self-join "as" one, and the old one-area-
-- manager-per-week cap only ever guarded against that.
drop policy shift_assignments_insert_self on shift_assignments;
create policy shift_assignments_insert_self on shift_assignments
  for insert
  with check (
    current_app_role() in ('bartender', 'shift_manager')
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
  );

drop policy shift_assignments_delete_self_future_week on shift_assignments;
create policy shift_assignments_delete_self_future_week on shift_assignments
  for delete
  using (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.week_start > active_week_start()
    )
  );
