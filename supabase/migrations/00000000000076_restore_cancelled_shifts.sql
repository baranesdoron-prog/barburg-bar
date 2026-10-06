-- Undoing a cancellation ("שחזור משמרת") is administrator-only, unlike
-- cancelling itself which any bar manager/admin can do (shifts_update_
-- managers). The blanket update policy doesn't distinguish this
-- specific transition, so this needs its own gate -- a bar manager
-- could otherwise restore a cancelled shift via the same plain client
-- update the cancel button uses. Restores to 'published' (what every
-- real cancelled shift was before cancellation in practice; draft
-- shifts aren't cancelled through this flow) and clears the reason.
create function restore_cancelled_shifts(p_shift_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() is not true then
    raise exception 'only administrators can restore a cancelled shift';
  end if;

  update shifts
  set status = 'published', cancellation_reason = null
  where id = any(p_shift_ids) and status = 'cancelled';
end;
$$;

grant execute on function restore_cancelled_shifts(uuid[]) to authenticated;
