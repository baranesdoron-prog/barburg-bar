-- The lifetime shift-count-based "senior" derivation only counts shifts
-- recorded in this app, so long-tenured staff who worked shifts before the
-- app existed would incorrectly show as junior. Add a manual override the
-- product owner can set for specific people whose seniority predates the
-- app's shift history -- combined with the computed count (either one
-- makes someone senior), not a replacement for it.
alter table employees add column is_senior boolean not null default false;
