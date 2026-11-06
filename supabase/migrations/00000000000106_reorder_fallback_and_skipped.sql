-- Automatic purchase orders (run when a shift closing finishes):
--
-- 1. The ideal quantity (how far to top up) couldn't be entered anywhere in
--    the app, so almost every product had none and was silently skipped.
--    Now, without an ideal quantity, order up to the minimum (rounded up
--    to whole boxes) -- the same amount the manual reorder page suggests.
-- 2. Products below their minimum that still can't be ordered because
--    they have no supplier are returned by name, so the closing screen
--    can list them instead of only counting them.

create or replace function generate_reorder_purchase_orders(p_shift_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can generate purchase orders';
  end if;

  create temp table needs_reorder on commit drop as
  select
    ii.id as inventory_item_id,
    ii.name,
    ii.unit_price,
    coalesce(ii.supplier_id, pc.default_supplier_id) as resolved_supplier_id,
    ceil(
      (greatest(coalesce(ii.ideal_quantity, 0), ii.minimum_quantity)
        - ii.current_stock - coalesce(oo.outstanding_qty, 0))
      / (case when ii.unit_type = 'box' then ii.units_per_box else 1 end)::numeric
    ) * (case when ii.unit_type = 'box' then ii.units_per_box else 1 end) as order_quantity
  from inventory_items ii
  left join product_categories pc on pc.id = ii.category_id
  left join (
    select poi.inventory_item_id, sum(poi.quantity) as outstanding_qty
    from purchase_order_items poi
    join purchase_orders po on po.id = poi.purchase_order_id
    where po.status = 'ordered'
    group by poi.inventory_item_id
  ) oo on oo.inventory_item_id = ii.id
  where ii.active
    and ii.minimum_quantity is not null
    and (ii.current_stock + coalesce(oo.outstanding_qty, 0)) < ii.minimum_quantity;

  create temp table new_orders (id uuid, supplier_id uuid) on commit drop;

  with inserted as (
    insert into purchase_orders (supplier_id, status, created_from_shift_id)
    select distinct resolved_supplier_id, 'draft'::purchase_order_status, p_shift_id
    from needs_reorder
    where resolved_supplier_id is not null and order_quantity > 0
    returning id, supplier_id
  )
  insert into new_orders (id, supplier_id)
  select id, supplier_id from inserted;

  insert into purchase_order_items (purchase_order_id, inventory_item_id, quantity, unit_price)
  select no.id, nr.inventory_item_id, nr.order_quantity, nr.unit_price
  from needs_reorder nr
  join new_orders no on no.supplier_id = nr.resolved_supplier_id
  where nr.resolved_supplier_id is not null and nr.order_quantity > 0;

  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplier_name', s.name,
        'order_number', po.order_number,
        'item_count', (
          select count(*) from purchase_order_items poi where poi.purchase_order_id = po.id
        )
      ))
      from new_orders no
      join purchase_orders po on po.id = no.id
      join suppliers s on s.id = no.supplier_id
    ), '[]'::jsonb),
    'skipped_no_supplier', (
      select count(*) from needs_reorder where resolved_supplier_id is null
    ),
    'skipped_names', coalesce((
      select jsonb_agg(nr.name order by nr.name)
      from needs_reorder nr
      where nr.resolved_supplier_id is null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
