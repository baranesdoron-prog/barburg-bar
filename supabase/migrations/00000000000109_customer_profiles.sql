-- Customers' own details (name, phone), edited on their profile page.
-- Staff details stay in employees; customers have no employee record.

create table customer_profiles (
  id uuid primary key references app_users (id) on delete cascade,
  full_name text,
  phone text,
  updated_at timestamptz not null default now()
);

create function customer_profiles_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.full_name := nullif(trim(new.full_name), '');
  new.phone := normalize_il_phone(nullif(trim(new.phone), ''));
  new.updated_at := now();
  return new;
end;
$$;

create trigger customer_profiles_normalize
  before insert or update on customer_profiles
  for each row execute function customer_profiles_normalize();

alter table customer_profiles enable row level security;

create policy customer_profiles_select on customer_profiles for select using (id = auth.uid() or is_admin());
create policy customer_profiles_insert_own on customer_profiles for insert with check (id = auth.uid());
create policy customer_profiles_update_own on customer_profiles for update using (id = auth.uid()) with check (id = auth.uid());
