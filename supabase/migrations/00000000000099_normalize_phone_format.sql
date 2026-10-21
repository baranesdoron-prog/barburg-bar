-- Phone numbers are migrating to a single WhatsApp-compatible format:
-- +972XXYYYYYYY (country code + the national number with its leading 0
-- dropped). Strips every non-digit character, then drops a leading
-- national '0' or an already-present '972' country code, leaving the
-- 9-digit Israeli subscriber number (2-digit network prefix + 7-digit
-- number) to re-prefix with +972.
--
-- Only reformats when the result is plausibly a real Israeli number (9
-- digits) -- anything else is returned UNCHANGED rather than guessed at,
-- so a malformed value stays visibly wrong (and easy to find again)
-- instead of being silently mangled into something that merely looks
-- valid.
create or replace function normalize_il_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
  v_national text;
begin
  if p_phone is null or trim(p_phone) = '' then
    return null;
  end if;

  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

  if v_digits like '972%' then
    v_national := substring(v_digits from 4);
  elsif v_digits like '0%' then
    v_national := substring(v_digits from 2);
  else
    v_national := v_digits;
  end if;

  if length(v_national) <> 9 then
    return p_phone;
  end if;

  return '+972' || v_national;
end;
$$;

-- Apply going forward, at the one place both self-signup (SignUp.tsx) and
-- admin-created accounts (the admin-create-user edge function) actually
-- create the employees row -- whatever a user types (058-422-0980,
-- 0584220980, +972584220980...) is normalized server-side before it's
-- ever stored, so no client can bypass it.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite employee_invites;
  v_full_name text;
  v_phone text;
  v_employee_id uuid;
begin
  select * into v_invite
  from employee_invites
  where lower(email) = lower(new.email) and status = 'pending'
  order by created_at desc
  limit 1;

  if found then
    insert into public.app_users (id, status, role, employee_id, approved_by, approved_at)
    values (new.id, 'approved', v_invite.role, v_invite.employee_id, v_invite.invited_by, now());

    update employee_invites
    set status = 'claimed', claimed_by = new.id, claimed_at = now()
    where id = v_invite.id;

    return new;
  end if;

  v_full_name := nullif(trim(new.raw_user_meta_data->>'full_name'), '');

  if v_full_name is not null then
    v_phone := normalize_il_phone(nullif(trim(new.raw_user_meta_data->>'phone'), ''));

    insert into employees (full_name, phone)
    values (v_full_name, v_phone)
    returning id into v_employee_id;

    insert into public.app_users (id, status, role, employee_id, approved_at)
    values (new.id, 'approved', 'bartender', v_employee_id, now());

    return new;
  end if;

  insert into public.app_users (id, status) values (new.id, 'pending_approval');
  return new;
end;
$$;

-- One-time cleanup of every existing employee's phone number. Lists what
-- it's about to leave untouched (because it isn't a plausible 9-digit
-- Israeli number) before doing the update, so a malformed value is never
-- silently skipped without a trace in the migration output.
do $$
declare
  r record;
begin
  for r in
    select id, full_name, phone
    from employees
    where phone is not null
      and normalize_il_phone(phone) = phone
      and phone !~ '^\+972[0-9]{9}$'
  loop
    raise notice 'Leaving phone unchanged (not a plausible Israeli number) for % (%): %', r.full_name, r.id, r.phone;
  end loop;
end $$;

update employees
set phone = normalize_il_phone(phone)
where phone is not null;
