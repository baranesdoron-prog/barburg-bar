-- Fixed product categories, each with an assignable default supplier
-- (assigned later via the Suppliers page once real suppliers exist),
-- replacing free-text category on inventory_items.

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_supplier_id uuid references suppliers(id),
  sort_order int not null default 0
);

alter table product_categories enable row level security;

create policy product_categories_select_approved on product_categories
  for select using (is_approved());

create policy product_categories_write_admin on product_categories
  for all using (is_admin()) with check (is_admin());

insert into product_categories (name, sort_order) values
  ('בירות', 1),
  ('יין', 2),
  ('בקבוקי אלכוהול', 3),
  ('משקאות קלים', 4),
  ('אחר', 5);

alter table inventory_items add column category_id uuid references product_categories(id);

-- Best-effort carry over any existing free-text category that happens to
-- match one of the new fixed names; anything else is left uncategorized.
update inventory_items ii
set category_id = pc.id
from product_categories pc
where pc.name = ii.category;

-- inventory_items_with_latest_count expands ii.*, which includes
-- `category` -- drop and recreate it so dropping that column isn't
-- blocked by the dependency.
drop view inventory_items_with_latest_count;

alter table inventory_items drop column category;

create view inventory_items_with_latest_count
as
select
  ii.*,
  lc.quantity_counted as latest_counted_quantity,
  lc.created_at as latest_counted_at,
  (ii.minimum_quantity is not null and ii.current_stock < ii.minimum_quantity) as is_low_stock
from inventory_items ii
left join lateral (
  select ic.quantity_counted, ic.created_at
  from inventory_counts ic
  where ic.inventory_item_id = ii.id
  order by ic.created_at desc
  limit 1
) lc on true;
