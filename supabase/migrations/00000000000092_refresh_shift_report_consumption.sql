-- Recomputes a report's inventory_counts snapshot entries (quantity
-- counted, previous count, used quantity, cost) from the live
-- inventory_counts table, using the exact same "most recent prior
-- count" logic finish_shift_closing() uses at close time. A report's
-- snapshot is frozen once and never recomputed afterward, so if the
-- previous-count lookup picked up stale/wrong data at close time (or a
-- correction since has changed what "the count before this one" should
-- be), this is the only way to bring an already-generated report back
-- in line with reality. Same tracking as correct_shift_inventory_count:
-- stamps updated_at/updated_by so the report shows it was corrected.
create or replace function refresh_shift_report_consumption(p_shift_id uuid)
returns shift_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report shift_reports;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can refresh a report';
  end if;

  if not exists (select 1 from shift_reports where shift_id = p_shift_id) then
    raise exception 'shift % has no closing report to refresh', p_shift_id;
  end if;

  update shift_reports
  set snapshot = jsonb_set(
        snapshot,
        '{inventory_counts}',
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'item_name', ii.name,
            'unit', ii.unit,
            'quantity_counted', ic.quantity_counted,
            'previous_quantity', prev.quantity_counted,
            'unit_price', ii.unit_price,
            'used_quantity', case
              when prev.quantity_counted is not null then prev.quantity_counted - ic.quantity_counted
              else null
            end,
            'cost', case
              when prev.quantity_counted is not null and ii.unit_price is not null
                then (prev.quantity_counted - ic.quantity_counted) * ii.unit_price
              else null
            end
          ))
          from inventory_counts ic
          join inventory_items ii on ii.id = ic.inventory_item_id
          left join lateral (
            select ic2.quantity_counted
            from inventory_counts ic2
            where ic2.inventory_item_id = ic.inventory_item_id
              and ic2.created_at < ic.created_at
            order by ic2.created_at desc
            limit 1
          ) prev on true
          where ic.shift_id = p_shift_id
        ), '[]'::jsonb)
      ),
      updated_at = now(),
      updated_by = auth.uid()
  where shift_id = p_shift_id
  returning * into v_report;

  return v_report;
end;
$$;
