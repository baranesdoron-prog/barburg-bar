-- Migration 00000000000032 added shifts.week_start but never recreated
-- shifts_with_effective_status, so the view silently lacks it (a view's
-- `s.*` is expanded at CREATE time, not re-expanded when the underlying
-- table gains a column). Drop + recreate the same way migrations
-- 00000000000006, 00000000000025 and 00000000000031 already did for
-- this exact view.

drop view shifts_with_effective_status;

create view shifts_with_effective_status
  with (security_invoker = true) as
select
  s.*,
  case
    when s.status in ('draft', 'cancelled', 'completed', 'reopened') then s.status::text
    when s.status = 'published' and now() < s.start_time then 'published'
    when s.status = 'published' and now() between s.start_time and s.end_time then 'active'
    else 'waiting_for_closure'
  end as effective_status,
  (select count(*) from shift_assignments sa where sa.shift_id = s.id) as assigned_count
from shifts s;
