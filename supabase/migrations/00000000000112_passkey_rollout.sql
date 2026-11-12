-- Face ID / fingerprint login (passkeys, handled by Supabase Auth) is
-- rolled out in stages, chosen by an administrator on the profile page:
-- administrators first, then all staff, then everyone (customers too).

alter table app_settings
  add column passkey_audience text not null default 'administrators'
    check (passkey_audience in ('administrators', 'staff', 'everyone'));

-- Whether the signed-in user may turn on Face ID login. Readable by
-- customers too, who can't read app_settings itself.
create function passkey_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case s.passkey_audience
      when 'administrators' then current_app_role()::text = 'administrator'
      when 'staff' then current_app_role()::text in ('administrator', 'shift_manager', 'bartender')
      else current_app_role() is not null
    end
    from app_settings s
    where s.id
  ), false);
$$;
