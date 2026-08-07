-- Employee photos, mirroring the existing product-image setup
-- (inventory-images bucket + policies in 00000000000012_inventory_catalog.sql).

alter table employees add column photo_url text;

insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

create policy "employee photos public read" on storage.objects
  for select using (bucket_id = 'employee-photos');

create policy "employee photos managers write" on storage.objects
  for insert with check (bucket_id = 'employee-photos' and current_app_role() in ('bar_manager', 'administrator'));

create policy "employee photos managers update" on storage.objects
  for update using (bucket_id = 'employee-photos' and current_app_role() in ('bar_manager', 'administrator'));

create policy "employee photos managers delete" on storage.objects
  for delete using (bucket_id = 'employee-photos' and current_app_role() in ('bar_manager', 'administrator'));
