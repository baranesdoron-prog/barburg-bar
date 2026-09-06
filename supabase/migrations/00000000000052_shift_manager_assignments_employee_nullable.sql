-- set_weekly_team() lets an admin pick the area manager or bartenders
-- for a week before ever picking a shift manager (each field saves
-- independently on selection, no confirm step) -- but employee_id was
-- still not-null, so that order threw a raw constraint violation
-- ("null value in column employee_id ... violates not-null constraint")
-- straight to the UI. area_manager_id is already nullable; match it.
alter table shift_manager_assignments alter column employee_id drop not null;
