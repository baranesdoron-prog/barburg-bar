-- Lifetime "how many shifts has this person actually worked" count, shown
-- next to their name everywhere they're assigned in the allocations view
-- (bar manager, area manager, or bartender -- combined, not per-role,
-- since the whole point is a fairness/workload indicator). Only shifts
-- that actually happened count: effective_status completed or reopened
-- (reopened was completed, then briefly reopened for a correction -- still
-- a shift that ran). Not security definer: shifts/shift_assignments are
-- already readable by any approved user (shifts_select_approved,
-- shift_assignments_select_approved), so this just aggregates what the
-- caller could already see.
create or replace function list_employee_shift_counts()
returns table (employee_id uuid, shift_count bigint)
language sql
stable
set search_path = public
as $$
  select employee_id, count(*)::bigint as shift_count
  from (
    select s.shift_manager_id as employee_id
    from shifts_with_effective_status s
    where s.shift_manager_id is not null
      and s.effective_status in ('completed', 'reopened')
    union all
    select sa.employee_id
    from shift_assignments sa
    join shifts_with_effective_status s on s.id = sa.shift_id
    where s.effective_status in ('completed', 'reopened')
  ) counts
  group by employee_id;
$$;
