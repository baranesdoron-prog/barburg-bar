-- shifts_with_effective_status was created before cancellation_reason
-- existed; "s.*" is expanded to a concrete column list at view-creation
-- time in Postgres, so the view was silently missing the new column.
-- CREATE OR REPLACE VIEW can't reorder columns (cancellation_reason would
-- land before the trailing effective_status column), so drop + recreate.

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
