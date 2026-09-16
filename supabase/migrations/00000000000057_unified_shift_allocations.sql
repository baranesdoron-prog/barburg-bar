-- Area manager and bartender are both now filled the same way: directly
-- on shift_assignments, per shift instance (opening/closing
-- independently), from a single unified allocation screen that replaces
-- the old separate shift list + "שיבוצים" year-schedule pages. Area
-- manager used to be a week-level field (shift_manager_assignments.
-- area_manager_id, applied identically to both shifts) -- the new
-- screen needs it per shift-type (capped at 2 each), so it moves onto
-- shift_assignments alongside bartenders, distinguished by a role
-- column. Bar manager stays week-level (shift_manager_assignments.
-- employee_id via set_weekly_shift_manager()) since one person really
-- does cover both shifts for that duty.

create type shift_assignment_role as enum ('bartender', 'area_manager');

alter table shift_assignments
  add column assignment_role shift_assignment_role not null default 'bartender';

-- Backfill: existing area-manager assignments were inserted by the old
-- set_weekly_team() whenever an employee matched that week's
-- shift_manager_assignments.area_manager_id.
update shift_assignments sa
set assignment_role = 'area_manager'
from shifts s, shift_manager_assignments sma
where sa.shift_id = s.id
  and s.week_start = sma.week_start
  and sma.area_manager_id = sa.employee_id;

drop function if exists set_weekly_team(date, uuid, uuid);
alter table shift_manager_assignments drop column area_manager_id;

-- assigned_count used to count every shift_assignments row regardless
-- of role, which meant an area-manager assignment silently inflated
-- the dashboard's bartender X/3 capacity badge. Now that area manager
-- has its own role tag, count bartenders only -- required_staff_count
-- has only ever meant "bartenders needed" (see the migration that set
-- it to 3 on every shift).
create or replace view shifts_with_effective_status
  with (security_invoker = true) as
select
  s.*,
  case
    when s.status in ('draft', 'cancelled', 'completed', 'reopened') then s.status::text
    when s.status = 'published' and now() < s.start_time then 'published'
    when s.status = 'published' and now() between s.start_time and s.end_time then 'active'
    else 'waiting_for_closure'
  end as effective_status,
  (select count(*) from shift_assignments sa
     where sa.shift_id = s.id and sa.assignment_role = 'bartender') as assigned_count
from shifts s;

-- Same fix for bartender self-assignment's capacity check.
drop policy shift_assignments_insert_self on shift_assignments;
create policy shift_assignments_insert_self on shift_assignments
  for insert
  with check (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and assignment_role = 'bartender'
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          s.required_staff_count is null
          or (
            select count(*) from shift_assignments sa
            where sa.shift_id = s.id and sa.assignment_role = 'bartender'
          ) < s.required_staff_count
        )
    )
  );
