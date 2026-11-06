-- Customers, the bar menu, punchcards and news.
--
-- For now the app shows all of this to administrators only (and to the demo
-- customer an administrator creates); the database rules are already the
-- final ones: menu and news are managed by administrators and bar managers
-- (shift_manager), punchcards are used by customers and administrators.

-- ---------------------------------------------------------------------
-- Customers never see staff data
-- ---------------------------------------------------------------------

-- Customers are approved app users too, but every existing "approved"
-- policy (shifts, inventory, employees...) is meant for staff. So
-- is_approved() now means approved *staff*.
create or replace function is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and status = 'approved' and coalesce(role::text, '') <> 'customer'
  );
$$;

-- Any approved user, staff or customer.
create or replace function is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_users where id = auth.uid() and status = 'approved');
$$;

create or replace function is_menu_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_app_role()::text in ('administrator', 'shift_manager'), false);
$$;

create or replace function can_use_punchcards()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_app_role()::text in ('administrator', 'customer'), false);
$$;

-- ---------------------------------------------------------------------
-- Bar menu
-- ---------------------------------------------------------------------

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_tokens int,
  -- Serving instructions for the whole category: staff only.
  staff_notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references menu_categories (id),
  name text not null,
  -- What's in it: customers see this.
  description text,
  -- How to make it: staff only.
  staff_notes text,
  tokens int not null check (tokens between 1 and 100),
  sort_order int not null default 0,
  -- Added for one shift only: should be marked expired after it.
  one_shift boolean not null default false,
  expired_at timestamptz,
  created_by uuid references app_users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_category_idx on menu_items (category_id, sort_order);

create trigger menu_items_set_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

alter table menu_categories enable row level security;
alter table menu_items enable row level security;

create policy menu_categories_select_staff on menu_categories for select using (is_approved());
create policy menu_categories_write_managers on menu_categories for all
  using (is_menu_manager()) with check (is_menu_manager());

create policy menu_items_select_staff on menu_items for select using (is_approved());
create policy menu_items_write_managers on menu_items for all
  using (is_menu_manager()) with check (is_menu_manager());

-- Customers read the menu through this, without the staff-only notes.
create function customer_menu()
returns table (
  category_id uuid,
  category_name text,
  category_sort int,
  default_tokens int,
  item_id uuid,
  name text,
  description text,
  tokens int,
  item_sort int
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.sort_order, c.default_tokens, i.id, i.name, i.description, i.tokens, i.sort_order
  from menu_items i
  join menu_categories c on c.id = i.category_id
  where i.expired_at is null
    and is_approved_user()
  order by c.sort_order, i.sort_order, i.name;
$$;

-- The menu from the bartender procedures.
with cats as (
  insert into menu_categories (name, default_tokens, staff_notes, sort_order) values
    ('בירה', 2, 'מוגש בלי כוס', 1),
    ('בירות בוטיק', 3, 'מוגש בלי כוס', 2),
    ('יין', 4, 'כוס יין, מזיגה עד הקו המסומן בבר', 3),
    ('קוקטיילים', 4, 'כוס הייבול, קרח מלא ¾ כוס, מנה אלכוהול ותוספת עד הסוף', 4),
    ('אלכוהול איכותי', 4, 'כוס לואו בול, כמות קרח לבקשת הלקוח ומנה של אלכוהול', 5),
    ('צ׳ייסרים', null, null, 6),
    ('שתייה קלה', 1, 'היי בול, מלא קרח', 7)
  returning id, name
)
insert into menu_items (category_id, name, description, staff_notes, tokens, sort_order)
select cats.id, v.name, v.description, v.staff_notes, v.tokens, v.sort_order
from (values
  ('בירה', 'גולדסטאר', 'הקלאסית הישראלית, גוף מלא ומריר מאוזן', null, 2, 1),
  ('בירה', 'גולדסטאר לא מסוננת', 'לא מסוננת, עכורה ורעננה עם טעם מלטי בולט', null, 2, 2),
  ('בירה', 'הייניקן LUMA', 'בהירה קלה, פריכה וקלילה לשתייה', null, 2, 3),
  ('בירות בוטיק', 'מלכה אדמונית', 'אמבר ישראלית, מתיקות קרמל עדינה וגוף עשיר', null, 3, 1),
  ('בירות בוטיק', 'אלכסנדר חיטה', 'בירת חיטה בלגית, עכורה עם ניחוחות ציטרוס ותבלינים', null, 3, 2),
  ('יין', 'Heart to Heart Riesling 2023', 'ריזלינג גרמני יבש, רענן ופירותי עם ניחוחות הדרים ואפרסק', null, 4, 1),
  ('יין', 'Libares Rioja Blanco 2023', 'יין לבן ספרדי יבש, אלגנטי עם טעמי הדרים, אגס ופרחים', null, 4, 2),
  ('יין', 'Libares Rioja Tinto 2023', 'יין אדום ספרדי צעיר, פירותי ומאוזן עם נגיעות דובדבן ותבלינים', null, 4, 3),
  ('יין', 'Bon Ju 2023', 'יין אדום צרפתי טבעי, קליל, עסיסי ורענן עם פירות אדומים', null, 4, 4),
  ('יין', 'קאווה', null, null, 4, 5),
  ('קוקטיילים', 'ערק לימונענע / אשכוליות', 'ערק עם לימונענע או אשכוליות וקרח', null, 4, 1),
  ('קוקטיילים', 'ג׳ין & טוניק', 'ג׳ין קלאסי עם טוניק וקרח', null, 4, 2),
  ('קוקטיילים', 'אפרול שפריץ', 'אפרול, קאווה וסודה', 'אפרול: מנה, קאווה: 2 מנות, סודה: סוגר עד הסוף', 4, 3),
  ('קוקטיילים', 'קמפרי תפוזים', 'קמפרי עם מיץ תפוזים', null, 4, 4),
  ('קוקטיילים', 'רום / ויסקי קולה', 'רום או ויסקי עם קולה', null, 4, 5),
  ('קוקטיילים', 'וודקה XL', 'וודקה עם משקה אנרגיה או כל תוספת אחרת', null, 4, 6),
  ('אלכוהול איכותי', 'הנסי VS', 'קוניאק צרפתי, עגול ועשיר עם נגיעות פרי יבש', null, 4, 1),
  ('אלכוהול איכותי', 'ואן גוך אסאי', 'וודקה בטעם אסאי, פירותית ומרעננת', null, 4, 2),
  ('אלכוהול איכותי', 'אוזו 7', 'ליקר אניס יווני, ארומטי ומסורתי', null, 4, 3),
  ('אלכוהול איכותי', 'קאוורבו גולד', 'טקילה זהובה, חלקה עם נגיעות עץ אלון', null, 4, 4),
  ('אלכוהול איכותי', 'גריי גוס', 'וודקה צרפתית פרימיום, נקייה וחלקה', null, 4, 5),
  ('אלכוהול איכותי', 'היבסקי', 'ויסקי יפני עדין ומאוזן', null, 4, 6),
  ('אלכוהול איכותי', 'ג׳ק דניאלס דבש', 'ויסקי בורבון עם ציפוי דבש, מתוק וקליל', null, 4, 7),
  ('צ׳ייסרים', 'צ׳ייסר אלכוהול סטנדרטי', null, null, 1, 1),
  ('צ׳ייסרים', 'צ׳ייסר אלכוהול איכותי', null, null, 2, 2),
  ('שתייה קלה', 'שתייה קלה', 'עם קרח', null, 1, 1)
) as v (cat, name, description, staff_notes, tokens, sort_order)
join cats on cats.name = v.cat;

-- ---------------------------------------------------------------------
-- Punchcards and orders
-- ---------------------------------------------------------------------

create table punchcards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_users (id) on delete cascade,
  amount int not null check (amount in (25, 50, 100)),
  tokens_total int not null,
  tokens_used int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  constraint punchcards_tokens_range check (tokens_used between 0 and tokens_total)
);

create index punchcards_owner_idx on punchcards (owner_id, expires_at);

create table punchcard_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_users (id) on delete cascade,
  -- Snapshot: [{item_id, name, qty, tokens}] at the prices of the moment.
  items jsonb not null,
  total_tokens int not null check (total_tokens > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  -- The bar evening this order belongs to (before noon = the previous one).
  evening_date date not null,
  night_color text not null,
  order_number int,
  -- [{punchcard_id, tokens}]: which cards paid for it.
  allocations jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

create index punchcard_orders_owner_idx on punchcard_orders (owner_id, created_at desc);
create index punchcard_orders_evening_idx on punchcard_orders (evening_date, status);

alter table punchcards enable row level security;
alter table punchcard_orders enable row level security;

-- Read-only from the client; every change goes through the functions below.
create policy punchcards_select_own on punchcards for select using (owner_id = auth.uid() or is_admin());
create policy punchcard_orders_select_own on punchcard_orders for select
  using (owner_id = auth.uid() or is_menu_manager());

create function current_evening_date()
returns date
language sql
stable
as $$
  select ((now() at time zone 'Asia/Jerusalem') - interval '12 hours')::date;
$$;

-- One colour per evening, different from the evening before and from the
-- same weekday a week earlier. All dark enough for white text.
create function night_color(p_date date)
returns text
language sql
immutable
as $$
  select (array[
    '#5B2C83', '#0E6E6E', '#B4462B', '#1F4E9C', '#8A3B12', '#2F6B2F',
    '#9C1F5A', '#4B4E9E', '#7A5A00', '#105E7A', '#6B2E2E', '#3F5A1E'
  ])[((p_date - date '2024-01-01') % 12) + 1];
$$;

create function punchcard_balance()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(tokens_total - tokens_used), 0)::int
  from punchcards
  where owner_id = auth.uid() and expires_at > now();
$$;

-- No payment yet: the card is added straight away.
create function buy_punchcard(p_amount int)
returns punchcards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card punchcards;
begin
  if not can_use_punchcards() then
    raise exception 'not allowed';
  end if;
  if p_amount not in (25, 50, 100) then
    raise exception 'invalid amount';
  end if;
  insert into punchcards (owner_id, amount, tokens_total)
  values (auth.uid(), p_amount, p_amount / 5)
  returning * into v_card;
  return v_card;
end;
$$;

-- p_items: [{item_id, qty}]. Prices come from the menu, not the client.
create function place_punchcard_order(p_items jsonb)
returns punchcard_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_total int;
  v_requested int;
  v_found int;
  v_order punchcard_orders;
  v_date date := current_evening_date();
begin
  if not can_use_punchcards() then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from punchcard_orders where owner_id = auth.uid() and status = 'pending') then
    raise exception 'pending_order_exists';
  end if;

  with req as (
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  )
  select
    (select count(*) from req where qty > 0),
    count(*),
    jsonb_agg(jsonb_build_object('item_id', mi.id, 'name', mi.name, 'qty', req.qty, 'tokens', mi.tokens)
              order by mc.sort_order, mi.sort_order),
    sum(req.qty * mi.tokens)
  into v_requested, v_found, v_items, v_total
  from req
  join menu_items mi on mi.id = req.item_id and mi.expired_at is null
  join menu_categories mc on mc.id = mi.category_id
  where req.qty between 1 and 20;

  if coalesce(v_total, 0) <= 0 or v_found <> v_requested then
    raise exception 'invalid_order';
  end if;
  if v_total > punchcard_balance() then
    raise exception 'not_enough_tokens';
  end if;

  insert into punchcard_orders (owner_id, items, total_tokens, evening_date, night_color)
  values (auth.uid(), v_items, v_total, v_date, night_color(v_date))
  returning * into v_order;
  return v_order;
end;
$$;

-- After the minute, or when the customer confirms: punch the tokens (the
-- card that expires first goes first) and number the order for the night.
-- If the tokens are no longer there, the order is cancelled instead.
create function confirm_punchcard_order(p_order_id uuid)
returns punchcard_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order punchcard_orders;
  v_card punchcards;
  v_need int;
  v_take int;
  v_alloc jsonb := '[]'::jsonb;
  v_number int;
begin
  select * into v_order from punchcard_orders
  where id = p_order_id and owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  if v_order.status <> 'pending' then
    return v_order;
  end if;

  perform 1 from punchcards where owner_id = auth.uid() for update;
  if punchcard_balance() < v_order.total_tokens then
    update punchcard_orders set status = 'cancelled', cancelled_at = now()
    where id = p_order_id returning * into v_order;
    return v_order;
  end if;

  v_need := v_order.total_tokens;
  for v_card in
    select * from punchcards
    where owner_id = auth.uid() and expires_at > now() and tokens_used < tokens_total
    order by expires_at, created_at
  loop
    v_take := least(v_need, v_card.tokens_total - v_card.tokens_used);
    update punchcards set tokens_used = tokens_used + v_take where id = v_card.id;
    v_alloc := v_alloc || jsonb_build_object('punchcard_id', v_card.id, 'tokens', v_take);
    v_need := v_need - v_take;
    exit when v_need = 0;
  end loop;

  perform pg_advisory_xact_lock(hashtext('punchcard_orders:' || v_order.evening_date::text));
  select coalesce(max(order_number), 0) + 1 into v_number
  from punchcard_orders
  where evening_date = v_order.evening_date and status = 'confirmed';

  update punchcard_orders
  set status = 'confirmed', confirmed_at = now(), order_number = v_number, allocations = v_alloc
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

-- Only within the first minute.
create function cancel_punchcard_order(p_order_id uuid)
returns punchcard_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order punchcard_orders;
begin
  update punchcard_orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id
    and owner_id = auth.uid()
    and status = 'pending'
    and now() < created_at + interval '60 seconds'
  returning * into v_order;
  if not found then
    raise exception 'cancel_window_passed';
  end if;
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- News and highlights for customers
-- ---------------------------------------------------------------------

create table news_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'news' check (kind in ('news', 'highlight')),
  title text,
  body text,
  image_url text,
  -- Shown to customers up to and including this day; none = until deleted.
  show_until date,
  author_name text,
  created_by uuid references app_users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint news_posts_has_content check (
    coalesce(title, '') <> '' or coalesce(body, '') <> '' or image_url is not null
  )
);

create index news_posts_created_idx on news_posts (created_at desc);

create function news_posts_set_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_name := (
    select e.full_name from app_users au join employees e on e.id = au.employee_id where au.id = auth.uid()
  );
  return new;
end;
$$;

create trigger news_posts_author
  before insert on news_posts
  for each row execute function news_posts_set_author();

alter table news_posts enable row level security;

create policy news_posts_select on news_posts for select using (
  is_menu_manager()
  or (
    is_approved_user()
    and (show_until is null or show_until >= (now() at time zone 'Asia/Jerusalem')::date)
  )
);
create policy news_posts_write_managers on news_posts for all
  using (is_menu_manager()) with check (is_menu_manager());

insert into storage.buckets (id, name, public)
values ('news-images', 'news-images', true)
on conflict (id) do nothing;

create policy news_images_read on storage.objects
  for select using (bucket_id = 'news-images');
create policy news_images_insert on storage.objects
  for insert with check (bucket_id = 'news-images' and is_menu_manager());
create policy news_images_delete on storage.objects
  for delete using (bucket_id = 'news-images' and is_menu_manager());
