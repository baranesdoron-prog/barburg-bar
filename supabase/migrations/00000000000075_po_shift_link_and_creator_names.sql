-- 1. Track which shift's closing auto-generated a purchase order, so the
--    shift report can link back to it and the PO list can show it.
--    Manually-created orders (Reorder.tsx, the "הזמנה חדשה" form) simply
--    leave this null.
alter table purchase_orders add column created_from_shift_id uuid references shifts(id);

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
      select count(*) from needs_reorder where resolved_supplier_id is null and order_quantity > 0
    )
  ) into v_result;

  return v_result;
end;
$$;

-- 2. app_users is select-own-row-only for non-admins (migration 1), so a
--    bar manager viewing the PO list can't resolve who-created-this-order
--    for orders made by someone else via a plain client select. Expose
--    just enough (employee name + role, nothing else) through a managers-
--    only RPC, same shape as list_shift_manager_employees/list_employee_roles.
create function list_app_user_display_info()
returns table (app_user_id uuid, employee_name text, role app_role)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (current_app_role() in ('shift_manager', 'bar_manager', 'administrator')) is not true then
    raise exception 'only managers can list user display info';
  end if;

  return query
    select au.id, e.full_name, au.role
    from app_users au
    left join employees e on e.id = au.employee_id
    where au.status = 'approved';
end;
$$;

grant execute on function list_app_user_display_info() to authenticated;
