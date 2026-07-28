-- Sequential, human-readable purchase order numbers (PO-YYYY-NNN).

alter table purchase_orders add column order_number text;

with numbered as (
  select id, 'PO-' || to_char(created_at, 'YYYY') || '-' ||
    lpad(row_number() over (partition by to_char(created_at, 'YYYY') order by created_at)::text, 3, '0') as num
  from purchase_orders
)
update purchase_orders po set order_number = numbered.num
from numbered where numbered.id = po.id;

alter table purchase_orders
  alter column order_number set not null,
  add constraint purchase_orders_order_number_unique unique (order_number);

create function generate_purchase_order_number()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
begin
  select count(*) + 1 into v_seq
  from purchase_orders
  where to_char(created_at, 'YYYY') = v_year;

  new.order_number := 'PO-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;

create trigger purchase_orders_set_order_number
  before insert on purchase_orders
  for each row execute function generate_purchase_order_number();
