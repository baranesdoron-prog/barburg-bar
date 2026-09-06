-- Fix: 'draft' as a bare string literal inside `select distinct ...`
-- doesn't get implicitly cast to purchase_order_status the way it
-- would in a plain `insert ... values (...)`, causing
-- "column status is of type purchase_order_status but expression is of type text".
create or replace function generate_reorder_purchase_orders()
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
    ii.unit_price,
    coalesce(ii.supplier_id, pc.default_supplier_id) as resolved_supplier_id,
    ceil(
      (ii.ideal_quantity - ii.current_stock)
      / (case when ii.unit_type = 'box' then ii.units_per_box else 1 end)::numeric
    ) * (case when ii.unit_type = 'box' then ii.units_per_box else 1 end) as order_quantity
  from inventory_items ii
  left join product_categories pc on pc.id = ii.category_id
  where ii.active
    and ii.minimum_quantity is not null
    and ii.ideal_quantity is not null
    and ii.current_stock < ii.minimum_quantity;

  create temp table new_orders (id uuid, supplier_id uuid) on commit drop;

  with inserted as (
    insert into purchase_orders (supplier_id, status)
    select distinct resolved_supplier_id, 'draft'::purchase_order_status
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
      select count(*) from needs_reorder where resolved_supplier_id is null and order_quantity > 0
    )
  ) into v_result;

  return v_result;
end;
$$;
