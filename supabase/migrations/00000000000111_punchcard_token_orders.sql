-- Punching a number of tokens without choosing from the menu (easier for
-- older customers). Same rules as a menu order: checked against the
-- balance, one minute to cancel, then confirm_punchcard_order() punches
-- the tokens and numbers it; close_punchcard_order() freezes it.

alter table punchcard_orders
  add column kind text not null default 'menu' check (kind in ('menu', 'tokens'));

create function place_punchcard_token_order(p_tokens int)
returns punchcard_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order punchcard_orders;
  v_date date := current_evening_date();
begin
  if not can_use_punchcards() then
    raise exception 'not allowed';
  end if;
  if p_tokens is null or p_tokens < 1 or p_tokens > 20 then
    raise exception 'invalid_order';
  end if;
  if exists (select 1 from punchcard_orders where owner_id = auth.uid() and status = 'pending') then
    raise exception 'pending_order_exists';
  end if;
  if p_tokens > punchcard_balance() then
    raise exception 'not_enough_tokens';
  end if;

  insert into punchcard_orders (owner_id, kind, items, total_tokens, evening_date, night_color)
  values (auth.uid(), 'tokens', '[]'::jsonb, p_tokens, v_date, night_color(v_date))
  returning * into v_order;
  return v_order;
end;
$$;
