-- "שליחת תזכורת לצוות": when a bar manager last sent the evening's
-- bartenders a reminder (WhatsApp one by one, or one SMS), and who sent it,
-- shown on the evening card. Stored on the evening's shifts (both halves).

alter table shifts
  add column team_reminder_sent_at timestamptz,
  add column team_reminder_sent_by_name text;

-- The view lists its columns explicitly, so the new ones are added to it
-- (at the end, as create or replace view requires). Same definition as live.
create or replace view shifts_with_effective_status
  with (security_invoker = true) as
select
  s.id,
  s.start_time,
  s.end_time,
  s.shift_type,
  s.shift_manager_id,
  s.notes,
  s.status,
  s.created_by,
  s.created_at,
  s.updated_at,
  s.required_staff_count,
  s.cancellation_reason,
  s.week_start,
  case
    when s.status = any (array['draft'::shift_status, 'cancelled'::shift_status, 'completed'::shift_status, 'reopened'::shift_status]) then s.status::text
    when s.status = 'published'::shift_status and now() < s.start_time then 'published'::text
    when s.status = 'published'::shift_status and now() >= s.start_time and now() <= s.end_time then 'active'::text
    else 'waiting_for_closure'::text
  end as effective_status,
  (select count(*) from shift_assignments sa
     where sa.shift_id = s.id and sa.assignment_role = 'bartender'::shift_assignment_role) as assigned_count,
  s.team_reminder_sent_at,
  s.team_reminder_sent_by_name
from shifts s;
