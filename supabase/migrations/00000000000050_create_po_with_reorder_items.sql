-- Creating a purchase order for a supplier previously always started
-- empty, requiring every line to be added by hand even when the reason
-- for ordering was "these specific items are below threshold" -- exactly
-- what generate_reorder_purchase_orders() already computes at shift
-- close. Reuse the same formula here, scoped to one supplier, so
-- creating an order pre-fills it with what actually needs reordering;
-- quantities stay plain editable rows on purchase_order_items
-- afterward, and other (non-threshold) items can still be added by hand
-- via the existing draft-only insert policy.
create function create_purchase_order_with_reorder_items(p_supplier_id uuid)
returns purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order purchase_orders;
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can create purchase orders';
  end if;

  insert into purchase_orders (supplier_id, status)
  values (p_supplier_id, 'draft')
  returning * into v_order;

  insert into purchase_order_items (purchase_order_id, inventory_item_id, quantity, unit_price)
  select v_order.id, nr.inventory_item_id, nr.order_quantity, nr.unit_price
  from (
    select
      ii.id as inventory_item_id,
      ii.unit_price,
      ceil(
        (ii.ideal_quantity - ii.current_stock)
        / (case when ii.unit_type = 'box' then ii.units_per_box else 1 end)::numeric
      ) * (case when ii.unit_type = 'box' then ii.units_per_box else 1 end) as order_quantity
    from inventory_items ii
    left join product_categories pc on pc.id = ii.category_id
    where ii.active
      and ii.minimum_quantity is not null
      and ii.ideal_quantity is not null
      and ii.current_stock < ii.minimum_quantity
      and coalesce(ii.supplier_id, pc.default_supplier_id) = p_supplier_id
  ) nr
  where nr.order_quantity > 0;

  return v_order;
end;
$$;

grant execute on function create_purchase_order_with_reorder_items(uuid) to authenticated;
