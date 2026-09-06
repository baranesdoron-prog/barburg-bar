-- Bar managers (shift_manager, labeled "מנהל/ת בר" throughout the UI)
-- now get the same dashboard and side menu as administrators, except
-- the Users page. Most of the RLS below was written for a 'bar_manager'
-- role from the original 5-role design that no real user has ever held
-- (shift_manager absorbed that identity in the UI over time, but these
-- policies were never updated to match) -- add shift_manager alongside
-- the existing bar_manager/administrator checks everywhere the newly
-- reachable pages need real write access, not just a visible link.

alter policy shifts_insert_managers on shifts
  with check (
    current_app_role() in ('administrator', 'bar_manager', 'shift_manager')
    and week_start >= active_week_start()
  );

alter policy shifts_update_managers on shifts
  using (current_app_role() in ('administrator', 'bar_manager', 'shift_manager'))
  with check (current_app_role() in ('administrator', 'bar_manager', 'shift_manager'));

alter policy inventory_items_insert_managers on inventory_items
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy inventory_items_update_managers on inventory_items
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'))
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy "inventory images managers write" on storage.objects
  with check (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy "inventory images managers update" on storage.objects
  using (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator', 'shift_manager'))
  with check (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy "inventory images managers delete" on storage.objects
  using (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy suppliers_select_managers on suppliers
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy suppliers_insert_managers on suppliers
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy suppliers_update_managers on suppliers
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'))
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy purchase_orders_select_managers on purchase_orders
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy purchase_orders_insert_managers on purchase_orders
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy purchase_orders_update_managers on purchase_orders
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'))
  with check (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy purchase_orders_delete_cancelled on purchase_orders
  using (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and status = 'cancelled'
  );

alter policy purchase_order_items_select_managers on purchase_order_items
  using (current_app_role() in ('bar_manager', 'administrator', 'shift_manager'));

alter policy purchase_order_items_insert_draft_only on purchase_order_items
  with check (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );

alter policy purchase_order_items_update_draft_only on purchase_order_items
  using (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  )
  with check (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );

alter policy purchase_order_items_delete_draft_only on purchase_order_items
  using (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );

alter policy purchase_order_items_delete_cancelled on purchase_order_items
  using (
    current_app_role() in ('bar_manager', 'administrator', 'shift_manager')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'cancelled'
    )
  );

create or replace function list_shift_manager_employees()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only managers can list shift managers';
  end if;

  return query
    select e.id, e.full_name
    from employees e
    join app_users au on au.employee_id = e.id
    where au.role = 'shift_manager' and au.status = 'approved' and e.active
    order by e.full_name;
end;
$$;

create or replace function reopen_shift(p_shift_id uuid)
returns shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only bar managers can reopen a shift';
  end if;

  update shifts
  set status = 'reopened'
  where id = p_shift_id and status = 'completed'
  returning * into v_shift;

  if not found then
    raise exception 'completed shift % not found', p_shift_id;
  end if;

  return v_shift;
end;
$$;

create or replace function receive_purchase_order(p_order_id uuid)
returns purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order purchase_orders;
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only managers can receive purchase orders';
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

create or replace function set_weekly_shift_manager(p_week_start date, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thu_start timestamptz := (p_week_start + 4 + time '19:30') at time zone 'Asia/Jerusalem';
  v_thu_mid   timestamptz := (p_week_start + 4 + time '22:00') at time zone 'Asia/Jerusalem';
  v_thu_end   timestamptz := (p_week_start + 5 + time '00:30') at time zone 'Asia/Jerusalem';
begin
  if (current_app_role() in ('bar_manager', 'administrator', 'shift_manager')) is not true then
    raise exception 'only a manager can assign shift managers';
  end if;

  insert into shift_manager_assignments (week_start, employee_id, assigned_by)
  values (p_week_start, p_employee_id, auth.uid())
  on conflict (week_start) do update
    set employee_id = excluded.employee_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now();

  update shifts
  set shift_manager_id = p_employee_id
  where start_time in (v_thu_start, v_thu_mid) and status <> 'cancelled';

  if not exists (select 1 from shifts where start_time in (v_thu_start, v_thu_mid)) then
    insert into shifts (start_time, end_time, shift_type, shift_manager_id, status, week_start) values
      (v_thu_start, v_thu_mid, 'opening', p_employee_id, 'published', p_week_start),
      (v_thu_mid, v_thu_end, 'closing', p_employee_id, 'published', p_week_start);
  end if;
end;
$$;
