-- Track when/who last corrected an already-generated report, separate
-- from generated_by/generated_at (who originally closed the shift).
-- Both nullable -- a report nobody has ever corrected has neither.
alter table shift_reports add column updated_at timestamptz;
alter table shift_reports add column updated_by uuid references app_users(id);

-- correct_shift_inventory_count() stamps these whenever it re-freezes a
-- report's snapshot; nothing else writes to shift_reports after its
-- initial insert, so this is the one real "update" case to track.
create or replace function correct_shift_inventory_count(
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
  v_item_name text;
  v_unit_price numeric;
  v_ideal numeric;
  v_min numeric;
  v_unit_type inventory_unit_type;
  v_units_per_box integer;
  v_batch numeric;
  v_count_id uuid;
  v_newer_exists boolean;
  v_outstanding numeric;
  v_new_qty numeric;
  v_flagged jsonb := '[]'::jsonb;
  v_po record;
  v_result jsonb;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can correct an inventory count';
  end if;

  if not exists (select 1 from shift_reports where shift_id = p_shift_id) then
    raise exception 'shift % has no closing report to correct', p_shift_id;
  end if;

  select id into v_count_id
  from inventory_counts
  where shift_id = p_shift_id and inventory_item_id = p_inventory_item_id;

  if v_count_id is null then
    raise exception 'no inventory count recorded for this item on this shift';
  end if;

  select exists (
    select 1 from inventory_counts
    where inventory_item_id = p_inventory_item_id
      and created_at > (select created_at from inventory_counts where id = v_count_id)
  ) into v_newer_exists;

  if v_newer_exists then
    raise exception 'a more recent count already exists for this item -- correct that one instead';
  end if;

  update inventory_counts
  set quantity_counted = p_new_quantity
  where id = v_count_id;

  select name, unit_price, ideal_quantity, minimum_quantity, unit_type, units_per_box
  into v_item_name, v_unit_price, v_ideal, v_min, v_unit_type, v_units_per_box
  from inventory_items
  where id = p_inventory_item_id;

  v_batch := case when v_unit_type = 'box' then v_units_per_box else 1 end;

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

  for v_po in
    select poi.id as item_id, po.status, po.order_number, s.name as supplier_name
    from purchase_order_items poi
    join purchase_orders po on po.id = poi.purchase_order_id
    join suppliers s on s.id = po.supplier_id
    where poi.inventory_item_id = p_inventory_item_id
      and po.created_from_shift_id = p_shift_id
  loop
    if v_po.status = 'draft' then
      select coalesce(sum(poi2.quantity), 0) into v_outstanding
      from purchase_order_items poi2
      join purchase_orders po2 on po2.id = poi2.purchase_order_id
      where poi2.inventory_item_id = p_inventory_item_id and po2.status = 'ordered';

      if v_min is not null and v_ideal is not null and (p_new_quantity + v_outstanding) < v_min then
        v_new_qty := ceil((v_ideal - p_new_quantity - v_outstanding) / v_batch) * v_batch;
      else
        v_new_qty := 0;
      end if;

      if v_new_qty > 0 then
        update purchase_order_items set quantity = v_new_qty where id = v_po.item_id;
      else
        delete from purchase_order_items where id = v_po.item_id;
      end if;
    else
      v_flagged := v_flagged || jsonb_build_object(
        'order_number', v_po.order_number,
        'supplier_name', v_po.supplier_name,
        'status', v_po.status
      );
    end if;
  end loop;

  select jsonb_build_object(
    'item_name', v_item_name,
    'new_quantity', p_new_quantity,
    'flagged_orders', v_flagged
  ) into v_result;

  return v_result;
end;
$$;
