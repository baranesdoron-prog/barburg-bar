-- Corrects a count that's already been superseded by a newer one --
-- for reporting/historical accuracy only. correct_shift_inventory_count
-- refuses this case outright (its staleness guard), because updating
-- inventory_counts unconditionally re-syncs inventory_items.current_stock
-- via the trigger, which would roll live stock back to a stale value.
-- This function allows the same correction but immediately re-syncs
-- current_stock from whatever count is actually the most recent for
-- that item afterward, so live stock is never affected by a historical
-- edit. It also cascades the fix forward one step: whichever later
-- shift's report used this count as its "previous_quantity" gets its
-- before/used/cost recomputed too, since that's the only other place
-- this number was baked in.
create function correct_historical_inventory_count(
  p_shift_id uuid,
  p_inventory_item_id uuid,
  p_new_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count_id uuid;
  v_count_created_at timestamptz;
  v_item_name text;
  v_unit_price numeric;
  v_next_shift_id uuid;
  v_next_quantity_counted numeric;
  v_latest_quantity numeric;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can correct an inventory count';
  end if;

  if not exists (select 1 from shift_reports where shift_id = p_shift_id) then
    raise exception 'shift % has no closing report to correct', p_shift_id;
  end if;

  select id, created_at into v_count_id, v_count_created_at
  from inventory_counts
  where shift_id = p_shift_id and inventory_item_id = p_inventory_item_id;

  if v_count_id is null then
    raise exception 'no inventory count recorded for this item on this shift';
  end if;

  if not exists (
    select 1 from inventory_counts
    where inventory_item_id = p_inventory_item_id and created_at > v_count_created_at
  ) then
    raise exception 'this is the most recent count for this item -- use correct_shift_inventory_count instead';
  end if;

  update inventory_counts set quantity_counted = p_new_quantity where id = v_count_id;

  select quantity_counted into v_latest_quantity
  from inventory_counts
  where inventory_item_id = p_inventory_item_id
  order by created_at desc
  limit 1;

  update inventory_items set current_stock = v_latest_quantity where id = p_inventory_item_id;

  select name, unit_price into v_item_name, v_unit_price from inventory_items where id = p_inventory_item_id;

  -- Re-freeze this shift's own report: its quantity_counted for this
  -- item changed, so its used_quantity/cost (against its own unchanged
  -- previous_quantity) need recomputing too.
  update shift_reports
  set snapshot = jsonb_set(
        snapshot,
        '{inventory_counts}',
        (
          select jsonb_agg(
            case when elem->>'item_name' = v_item_name then
              jsonb_build_object(
                'item_name', v_item_name,
                'unit', elem->'unit',
                'quantity_counted', p_new_quantity,
                'previous_quantity', elem->'previous_quantity',
                'unit_price', v_unit_price,
                'used_quantity', case
                  when jsonb_typeof(elem->'previous_quantity') = 'number'
                    then (elem->>'previous_quantity')::numeric - p_new_quantity
                  else null
                end,
                'cost', case
                  when jsonb_typeof(elem->'previous_quantity') = 'number' and v_unit_price is not null
                    then ((elem->>'previous_quantity')::numeric - p_new_quantity) * v_unit_price
                  else null
                end
              )
            else elem
            end
          )
          from jsonb_array_elements(snapshot->'inventory_counts') elem
        )
      ),
      updated_at = now(),
      updated_by = auth.uid()
  where shift_id = p_shift_id;

  -- The immediately-next count for this item used this row as its
  -- "previous" -- cascade one step forward so that report's
  -- before/used/cost line up too. Nothing further needed: a count
  -- two steps ahead references its own immediate predecessor, not
  -- this one.
  select ic.shift_id, ic.quantity_counted into v_next_shift_id, v_next_quantity_counted
  from inventory_counts ic
  where ic.inventory_item_id = p_inventory_item_id and ic.created_at > v_count_created_at
  order by ic.created_at asc
  limit 1;

  if v_next_shift_id is not null and exists (select 1 from shift_reports where shift_id = v_next_shift_id) then
    update shift_reports
    set snapshot = jsonb_set(
          snapshot,
          '{inventory_counts}',
          (
            select jsonb_agg(
              case when elem->>'item_name' = v_item_name then
                jsonb_build_object(
                  'item_name', v_item_name,
                  'unit', elem->'unit',
                  'quantity_counted', elem->'quantity_counted',
                  'previous_quantity', p_new_quantity,
                  'unit_price', v_unit_price,
                  'used_quantity', p_new_quantity - v_next_quantity_counted,
                  'cost', case
                    when v_unit_price is not null then (p_new_quantity - v_next_quantity_counted) * v_unit_price
                    else null
                  end
                )
              else elem
              end
            )
            from jsonb_array_elements(snapshot->'inventory_counts') elem
          )
        ),
        updated_at = now(),
        updated_by = auth.uid()
    where shift_id = v_next_shift_id;
  end if;

  return jsonb_build_object(
    'item_name', v_item_name,
    'new_quantity', p_new_quantity,
    'cascaded_to_shift_id', v_next_shift_id
  );
end;
$$;
