-- Suppliers previously had one contact_name/phone pair, used in practice
-- to record our own bar's contact person for that supplier (e.g. who at
-- the bar deals with them), not anyone at the supplier itself. Split
-- into two explicit pairs: the existing bar-side contact, and a new
-- supplier-side contact (the actual person to call at the supplier).
alter table suppliers rename column contact_name to bar_contact_name;
alter table suppliers rename column phone to bar_contact_phone;

alter table suppliers add column supplier_contact_name text;
alter table suppliers add column supplier_contact_phone text;
