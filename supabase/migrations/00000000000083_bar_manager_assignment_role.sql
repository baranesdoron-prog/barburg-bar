-- New shift_assignments role: bar manager. Added in its own migration
-- since a new enum value can't be used in the same transaction it's
-- added in (same reason area_supervisor got its own migration).
-- shift_manager_id / shift_manager_assignments remain the real source
-- of truth for who's bar manager each week -- this value exists purely
-- so attendance-taking and the closing report snapshot (both driven off
-- shift_assignments, with no awareness of bar manager's separate
-- mechanism) can see the bar manager too, same as every other duty.
alter type shift_assignment_role add value 'bar_manager';
