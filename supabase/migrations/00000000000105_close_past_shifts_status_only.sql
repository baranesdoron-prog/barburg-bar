-- One-off cleanup, asked for by the admin: every shift whose time has
-- passed and that was never closed is marked closed ('completed').
--
-- Status only. This deliberately does NOT go through finish_shift_closing():
-- no shift report, no inventory snapshot, no consumption, no purchase
-- orders -- stock is left exactly as it is. Such a shift simply has no
-- report; it can still be reopened and closed properly if ever needed.
--
-- Safe for notifications: the shift-change trigger only reacts to
-- cancellations and time changes on upcoming evenings, not to this.

update shifts
set status = 'completed'
where status in ('published', 'reopened')
  and end_time < now();
