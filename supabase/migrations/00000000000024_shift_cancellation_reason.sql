-- Cancelling a shift (already administrator-only per shifts_update_managers
-- and the ShiftDetail.tsx UI gate) must now record why.

alter table shifts add column cancellation_reason text;

alter table shifts add constraint cancelled_requires_reason
  check (status <> 'cancelled' or cancellation_reason is not null);
