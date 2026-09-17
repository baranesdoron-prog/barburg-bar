-- New duty: area supervisor ("מפקח/ת מתחם"), one per shift (opening/closing
-- independently, like area manager), but restricted to a specific allow-
-- list of employees rather than everyone with an account role. Added in
-- its own migration since a new enum value can't be used in the same
-- transaction it's added in.
alter type shift_assignment_role add value 'area_supervisor';
