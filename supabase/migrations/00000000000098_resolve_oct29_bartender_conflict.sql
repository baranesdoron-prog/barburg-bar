-- Resolves the one conflict migration 97 intentionally left alone: Oct 29
-- (week 2026-10-25) bartender duty had 4 distinct real people against a
-- max of 3 (לינדה דברת, אבשלום אביטל, יובל לייכט on opening only; גלעד
-- ברייט on closing only). Per explicit instruction, remove גלעד's single
-- booking, then pair the remaining three to the full evening like every
-- other pre-unification gap already fixed in migration 97.
delete from shift_assignments where id = '50c957c1-9b75-47d0-9cd3-51ef39db173e';

insert into shift_assignments (shift_id, employee_id, assignment_role) values
  ('9b0ab0ce-1f75-4496-9805-7291b02e7c78', '9a4628b6-13cf-442b-8d90-e00be33ff716', 'bartender'), -- לינדה דברת
  ('9b0ab0ce-1f75-4496-9805-7291b02e7c78', 'c305a92e-80db-4146-9d59-efaca3736ebe', 'bartender'), -- אבשלום אביטל
  ('9b0ab0ce-1f75-4496-9805-7291b02e7c78', 'd12def5e-e815-46ac-a4c1-81e89470ebfb', 'bartender')  -- יובל לייכט
on conflict (shift_id, employee_id) do nothing;
