-- SECURITY FIX: is_admin() could return NULL (instead of false) for any
-- caller who is not an approved app_user, because current_app_role() = 'administrator'
-- is NULL when current_app_role() is NULL. In PL/pgSQL, `if not is_admin() then
-- raise exception` does NOT fire when the condition is NULL (only TRUE enters
-- the branch), so approve_user()'s admin guard silently no-op'd for exactly
-- the population that must never pass it: pending/unapproved callers. This
-- allowed a brand-new, unapproved signup to call approve_user() on themselves
-- and grant themselves 'administrator'. Confirmed and reproduced during
-- Milestone 1 verification against the live project; fixing immediately.

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_app_role() = 'administrator', false);
$$;

-- Defense in depth: guard with `is not true` (NULL-safe) rather than `not (...)`,
-- so this check can never again be bypassed by a NULL-returning helper.
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

  if p_role in ('employee', 'shift_manager', 'bar_manager') and p_employee_id is null then
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
