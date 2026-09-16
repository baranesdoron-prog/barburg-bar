-- Removing someone from a shift (handleRemoveAssignment, admin/bar-manager
-- only) failed with a foreign key violation the moment that assignment had
-- ANY replacement_requests row pointing at it -- pending, approved, or
-- even already rejected/resolved, since the FK had no ON DELETE behavior
-- at all. Once a replacement request had been reviewed (in either
-- direction), the assignment it was about became permanently undeletable.
-- Cascade instead, matching the precedent already established by
-- suspend_user() (which manually deletes replacement_requests before
-- deleting shift_assignments for the same reason) -- a replacement
-- request about an assignment that no longer exists has nothing left to
-- refer to.
alter table replacement_requests drop constraint replacement_requests_shift_assignment_id_fkey;
alter table replacement_requests add constraint replacement_requests_shift_assignment_id_fkey
  foreign key (shift_assignment_id) references shift_assignments(id) on delete cascade;
