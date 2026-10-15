-- One-time backfill: every shift that already has a bar manager set
-- (assigned before set_weekly_shift_manager() started mirroring it into
-- shift_assignments) gets its mirror row too, so attendance-taking and
-- future closing reports see them without needing the bar manager to be
-- re-assigned first. Purely additive -- never touches shift_manager_id
-- or shift_manager_assignments. Skips a shift where that same
-- (shift_id, employee_id) pair already has any shift_assignments row
-- (e.g. the bar manager also happened to work that same shift as
-- bartender/area_manager/area_supervisor at some point) -- the table's
-- unique constraint is on the pair regardless of role, so a second row
-- would collide; the bar manager's existing row already makes them
-- visible in attendance either way.
insert into shift_assignments (shift_id, employee_id, assignment_role)
select s.id, s.shift_manager_id, 'bar_manager'
from shifts s
where s.shift_manager_id is not null
  and s.status <> 'cancelled'
  and not exists (
    select 1 from shift_assignments sa
    where sa.shift_id = s.id and sa.employee_id = s.shift_manager_id
  );
