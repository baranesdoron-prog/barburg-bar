-- Milestone 8: suppliers + purchase orders. Bar Manager/Administrator
-- territory only — unlike inventory counting, the spec never gives Shift
-- Manager any role here, so both SELECT and write RLS are restricted,
-- not just writes.

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on suppliers
  for each row execute function set_updated_at();

alter table suppliers enable row level security;

create policy suppliers_select_managers on suppliers
  for select
  using (current_app_role() in ('bar_manager', 'administrator'));

create policy suppliers_insert_managers on suppliers
  for insert
  with check (current_app_role() in ('bar_manager', 'administrator'));

create policy suppliers_update_managers on suppliers
  for update
  using (current_app_role() in ('bar_manager', 'administrator'))
  with check (current_app_role() in ('bar_manager', 'administrator'));

-- No delete policy: deactivate instead, matching employees/inventory_items.

create type purchase_order_status as enum ('draft', 'ordered', 'received', 'cancelled');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  status purchase_order_status not null default 'draft',
  notes text,
  created_by uuid not null default auth.uid() references app_users(id),
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function set_purchase_order_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'ordered' and old.status != 'ordered' and new.ordered_at is null then
    new.ordered_at = now();
  end if;
  if new.status = 'received' and old.status != 'received' and new.received_at is null then
    new.received_at = now();
  end if;
  return new;
end;
$$;

create trigger purchase_orders_set_timestamps
  before update on purchase_orders
  for each row execute function set_purchase_order_timestamps();

create trigger purchase_orders_set_updated_at
  before update on purchase_orders
  for each row execute function set_updated_at();

alter table purchase_orders enable row level security;

create policy purchase_orders_select_managers on purchase_orders
  for select
  using (current_app_role() in ('bar_manager', 'administrator'));

create policy purchase_orders_insert_managers on purchase_orders
  for insert
  with check (current_app_role() in ('bar_manager', 'administrator'));

create policy purchase_orders_update_managers on purchase_orders
  for update
  using (current_app_role() in ('bar_manager', 'administrator'))
  with check (current_app_role() in ('bar_manager', 'administrator'));

-- No delete policy.

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  inventory_item_id uuid not null references inventory_items(id),
  quantity numeric not null,
  unit_price numeric,
  created_at timestamptz not null default now()
);

alter table purchase_order_items enable row level security;

create policy purchase_order_items_select_managers on purchase_order_items
  for select
  using (current_app_role() in ('bar_manager', 'administrator'));

create policy purchase_order_items_insert_draft_only on purchase_order_items
  for insert
  with check (
    current_app_role() in ('bar_manager', 'administrator')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );

create policy purchase_order_items_update_draft_only on purchase_order_items
  for update
  using (
    current_app_role() in ('bar_manager', 'administrator')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  )
  with check (
    current_app_role() in ('bar_manager', 'administrator')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );

create policy purchase_order_items_delete_draft_only on purchase_order_items
  for delete
  using (
    current_app_role() in ('bar_manager', 'administrator')
    and exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_id and po.status = 'draft'
    )
  );
