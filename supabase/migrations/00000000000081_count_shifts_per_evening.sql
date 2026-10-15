-- Bartender and area manager are becoming whole-evening duties (one
-- self-service action creates a shift_assignments row for both the
-- opening and closing shift instance, same mechanism area_supervisor
-- already used). Counting "shifts worked" per shift_assignments row
-- would double everyone's count once every assignment is paired like
-- this -- someone working one full evening would already read as
-- "senior" (threshold 2) after a single night. Count distinct
-- (employee_id, assignment_role, week_start) evenings instead, so a
-- paired evening counts once. area_supervisor already had this same
-- latent double-counting (it's been paired since 00000000000065) --
-- fixed here too for consistency, not just the two duties that prompted
-- this change. bar_manager is a different mechanism entirely
-- (shift_manager_assignments, not shift_assignments) and isn't touched.
drop function if exists list_employee_shift_counts();

create function list_employee_shift_counts()
returns table (
  employee_id uuid,
  bartender_count bigint,
  area_manager_count bigint,
  area_supervisor_count bigint,
  bar_manager_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    employee_id,
    count(*) filter (where duty = 'bartender')::bigint as bartender_count,
    count(*) filter (where duty = 'area_manager')::bigint as area_manager_count,
    count(*) filter (where duty = 'area_supervisor')::bigint as area_supervisor_count,
    count(*) filter (where duty = 'bar_manager')::bigint as bar_manager_count
  from (
    select s.shift_manager_id as employee_id, 'bar_manager' as duty
    from shifts_with_effective_status s
    where s.shift_manager_id is not null
      and s.effective_status in ('completed', 'reopened')
    union all
    select employee_id, duty
    from (
      select distinct sa.employee_id, sa.assignment_role::text as duty, s.week_start
      from shift_assignments sa
      join shifts_with_effective_status s on s.id = sa.shift_id
      where s.effective_status in ('completed', 'reopened')
    ) distinct_evenings
  ) counts
  group by employee_id;
$$;
