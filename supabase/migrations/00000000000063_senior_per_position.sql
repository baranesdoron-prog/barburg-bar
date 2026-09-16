-- Senior status is per-position, not one blanket flag: someone can be a
-- senior area manager without being a senior bartender, and vice versa.
-- Split the manual override into two columns, preserving the old blanket
-- value into both so nobody's existing bartender-senior status silently
-- disappears -- the two are now maintained independently going forward.
alter table employees add column is_senior_bartender boolean not null default false;
alter table employees add column is_senior_area_manager boolean not null default false;
update employees set is_senior_bartender = is_senior, is_senior_area_manager = is_senior where is_senior;
alter table employees drop column is_senior;

-- Shift counts split the same way: how many shifts someone worked as
-- bartender vs area manager vs bar manager, each counted independently
-- (a shift where someone covered two different duties in the same week
-- still counts once per duty). "Senior" in a given position is 2+ shifts
-- in that position, computed client-side from these counts (kept in sync
-- automatically -- nothing to maintain) OR the matching manual override
-- above, for staff whose history predates this app.
-- Return type changed (was one shift_count column) -- CREATE OR REPLACE
-- can't change a function's return type, so drop first.
drop function if exists list_employee_shift_counts();

create function list_employee_shift_counts()
returns table (employee_id uuid, bartender_count bigint, area_manager_count bigint, bar_manager_count bigint)
language sql
stable
set search_path = public
as $$
  select
    employee_id,
    count(*) filter (where duty = 'bartender')::bigint as bartender_count,
    count(*) filter (where duty = 'area_manager')::bigint as area_manager_count,
    count(*) filter (where duty = 'bar_manager')::bigint as bar_manager_count
  from (
    select s.shift_manager_id as employee_id, 'bar_manager' as duty
    from shifts_with_effective_status s
    where s.shift_manager_id is not null
      and s.effective_status in ('completed', 'reopened')
    union all
    select sa.employee_id, sa.assignment_role::text as duty
    from shift_assignments sa
    join shifts_with_effective_status s on s.id = sa.shift_id
    where s.effective_status in ('completed', 'reopened')
  ) counts
  group by employee_id;
$$;
