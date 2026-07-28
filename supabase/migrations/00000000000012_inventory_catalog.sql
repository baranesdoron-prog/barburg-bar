-- Product catalog: richer fields, low-stock view, and product images.

create type inventory_unit_type as enum ('single', 'box');

alter table inventory_items
  add column category text,
  add column vendor text,
  add column sku text,
  add column supplier_id uuid references suppliers(id),
  add column unit_type inventory_unit_type not null default 'single',
  add column units_per_box integer,
  add column unit_price numeric,
  add column minimum_quantity numeric,
  add column image_url text,
  add constraint units_per_box_required_for_box
    check (unit_type = 'single' or units_per_box is not null);

create view inventory_items_with_latest_count as
select
  ii.*,
  lc.quantity_counted as latest_counted_quantity,
  lc.created_at as latest_counted_at
from inventory_items ii
left join lateral (
  select ic.quantity_counted, ic.created_at
  from inventory_counts ic
  where ic.inventory_item_id = ii.id
  order by ic.created_at desc
  limit 1
) lc on true;

insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', true)
on conflict (id) do nothing;

create policy "inventory images public read" on storage.objects
  for select using (bucket_id = 'inventory-images');

create policy "inventory images managers write" on storage.objects
  for insert with check (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator'));

create policy "inventory images managers update" on storage.objects
  for update using (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator'));

create policy "inventory images managers delete" on storage.objects
  for delete using (bucket_id = 'inventory-images' and current_app_role() in ('bar_manager', 'administrator'));
