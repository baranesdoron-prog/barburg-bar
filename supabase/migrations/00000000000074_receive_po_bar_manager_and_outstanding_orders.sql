-- 1. Bar managers (shift_manager), not just administrators, can receive a
--    purchase order -- matches who can create/manage purchase orders
--    elsewhere (ROLES_MANAGING_SHIFTS).
create or replace function receive_purchase_order(p_order_id uuid)
returns purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order purchase_orders;
begin
  if (current_app_role() in ('administrator', 'shift_manager')) is not true then
    raise exception 'only bar managers or administrators can receive purchase orders';
  end if;

  select * into v_order from purchase_orders where id = p_order_id;
  if not found then
    raise exception 'purchase order % not found', p_order_id;
  end if;

  if v_order.status != 'ordered' then
    raise exception 'purchase order must be ordered to mark as received (current status: %)', v_order.status;
  end if;

  update inventory_items ii
  set current_stock = ii.current_stock + poi.quantity
  from purchase_order_items poi
  where poi.purchase_order_id = p_order_id and poi.inventory_item_id = ii.id;

  update purchase_orders
  set status = 'received', received_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- 2. Auto-reorder (run at shift closing) shouldn't suggest ordering stock
--    that's already on its way -- net outstanding quantity from purchase
--    orders already marked 'ordered' (not draft, which might never be
--    sent, and not received/cancelled, which are already reflected in
--    current_stock or moot) against the shortfall before deciding what
--    to order.
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
      (ii.ideal_quantity - ii.current_stock - coalesce(oo.outstanding_qty, 0))
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
    and ii.ideal_quantity is not null
    and (ii.current_stock + coalesce(oo.outstanding_qty, 0)) < ii.minimum_quantity;

  create temp table new_orders (id uuid, supplier_id uuid) on commit drop;

  -- The explicit cast matters: "select distinct x, 'draft' from ..." left
  -- the literal as text instead of purchase_order_status, which Postgres
  -- doesn't implicitly cast for an INSERT fed through a DISTINCT CTE --
  -- this silently broke every real invocation that had a qualifying item
  -- (the caller in ShiftClosing.tsx never checked this RPC's error).
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
