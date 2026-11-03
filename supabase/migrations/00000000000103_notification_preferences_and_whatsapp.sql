-- Shift notifications, by email and/or WhatsApp, each channel switched on
-- by an administrator (app_settings) and chosen by each user for
-- themselves, with their own consent -- an administrator can never choose
-- for someone else. With both channels off (the default) nothing is
-- queued, nothing is sent, and the app shows no notification choices.
--
-- Builds on migration 101 (shift_email_outbox + its trigger) and adds:
--   * per-user channel choice + consent on employees;
--   * whatsapp_templates / whatsapp_messages (queue + permanent log),
--     sent by the Netlify functions under netlify/functions;
--   * evening cancelled / hours changed notifications (trigger on shifts);
--   * an admin-configurable reminder time (default: the day before, 08:00).

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------

-- shift_emails_enabled (migration 101) is the email channel's switch.
alter table app_settings add column shift_whatsapp_enabled boolean not null default false;
alter table app_settings add column reminder_days_before int not null default 1
  check (reminder_days_before between 0 and 7);
alter table app_settings add column reminder_time time not null default '08:00';
-- Last time Meta's webhook reached us, for the admin status panel.
alter table app_settings add column whatsapp_webhook_last_at timestamptz;

-- ---------------------------------------------------------------------
-- Each user's own choice
-- ---------------------------------------------------------------------

alter table employees add column notify_email boolean not null default false;
alter table employees add column notify_whatsapp boolean not null default false;
alter table employees add column notify_consent_at timestamptz;
-- Set when they turned WhatsApp off by replying "הסר" (the webhook).
alter table employees add column whatsapp_opted_out_at timestamptz;
-- "לא תודה" on the add-the-other-channel suggestion in the sign-up popup.
alter table employees add column notify_nudge_dismissed_at timestamptz;

-- Only the person themselves may change these (through the functions
-- below, which raise this flag for their own update), or the system
-- itself (no signed-in user: signup trigger, WhatsApp opt-out webhook).
-- Managers can otherwise update employees rows, so this is what stops an
-- administrator from opting someone in.
create function guard_notification_prefs()
returns trigger
language plpgsql
as $$
begin
  if (new.notify_email, new.notify_whatsapp, new.notify_consent_at, new.whatsapp_opted_out_at, new.notify_nudge_dismissed_at)
     is distinct from
     (old.notify_email, old.notify_whatsapp, old.notify_consent_at, old.whatsapp_opted_out_at, old.notify_nudge_dismissed_at)
    and auth.uid() is not null
    and coalesce(current_setting('app.own_notification_prefs', true), '') <> 'on'
  then
    raise exception 'notification preferences can only be changed by the user themselves';
  end if;
  return new;
end;
$$;

create trigger employees_guard_notification_prefs
  before update on employees
  for each row execute function guard_notification_prefs();

create function set_my_notification_prefs(p_email boolean, p_whatsapp boolean, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings app_settings;
  v_emp employees;
  v_email boolean;
  v_whatsapp boolean;
begin
  select e.* into v_emp
  from app_users au join employees e on e.id = au.employee_id
  where au.id = auth.uid() and au.status = 'approved';
  if not found then
    raise exception 'your account is not linked to an employee';
  end if;

  select * into v_settings from app_settings where id;

  -- A channel the admin has switched off isn't offered, so its stored
  -- choice is kept as is (turning the channel back on restores it).
  v_email := case when v_settings.shift_emails_enabled then coalesce(p_email, v_emp.notify_email) else v_emp.notify_email end;
  v_whatsapp := case when v_settings.shift_whatsapp_enabled then coalesce(p_whatsapp, v_emp.notify_whatsapp) else v_emp.notify_whatsapp end;

  if ((v_email and not v_emp.notify_email) or (v_whatsapp and not v_emp.notify_whatsapp)) and not coalesce(p_consent, false) then
    raise exception 'consent is required to receive notifications';
  end if;
  if v_whatsapp and not v_emp.notify_whatsapp and coalesce(v_emp.phone, '') !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'a valid phone number is needed for WhatsApp';
  end if;

  perform set_config('app.own_notification_prefs', 'on', true);
  update employees
  set notify_email = v_email,
      notify_whatsapp = v_whatsapp,
      notify_consent_at = case
        when (v_email and not v_emp.notify_email) or (v_whatsapp and not v_emp.notify_whatsapp) then now()
        else notify_consent_at
      end,
      whatsapp_opted_out_at = case when v_whatsapp then null else whatsapp_opted_out_at end,
      notify_nudge_dismissed_at = null
  where id = v_emp.id;
  perform set_config('app.own_notification_prefs', 'off', true);
end;
$$;

create function dismiss_notification_nudge()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.own_notification_prefs', 'on', true);
  update employees
  set notify_nudge_dismissed_at = now()
  where id = (select employee_id from app_users where id = auth.uid() and status = 'approved');
  perform set_config('app.own_notification_prefs', 'off', true);
end;
$$;

grant execute on function set_my_notification_prefs(boolean, boolean, boolean) to authenticated;
grant execute on function dismiss_notification_nudge() to authenticated;

-- Self-signup: the choice made on the sign-up form (only offered while a
-- channel is on, and only with the consent tick) is stored right away.
-- Same as migration 99's version otherwise; admin-created accounts and
-- invites carry no choice, so they start with none.
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
  v_consent boolean := coalesce((new.raw_user_meta_data->>'notify_consent')::boolean, false);
  v_email boolean := v_consent and coalesce((new.raw_user_meta_data->>'notify_email')::boolean, false);
  v_whatsapp boolean := v_consent and coalesce((new.raw_user_meta_data->>'notify_whatsapp')::boolean, false);
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
    if coalesce(v_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then
      v_whatsapp := false;
    end if;

    insert into employees (full_name, phone, notify_email, notify_whatsapp, notify_consent_at)
    values (v_full_name, v_phone, v_email, v_whatsapp, case when v_email or v_whatsapp then now() end)
    returning id into v_employee_id;

    insert into public.app_users (id, status, role, employee_id, approved_at)
    values (new.id, 'approved', 'bartender', v_employee_id, now());

    return new;
  end if;

  insert into public.app_users (id, status) values (new.id, 'pending_approval');
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- WhatsApp templates and messages
-- ---------------------------------------------------------------------

-- The approved Meta templates the app uses, by role in the app. Bodies
-- are drafts until approved by Meta; the admin page shows the status.
create table whatsapp_templates (
  key text primary key check (key in ('registration', 'reminder', 'update')),
  meta_name text not null,
  language text not null default 'he',
  param_count int not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'paused')),
  updated_at timestamptz not null default now()
);

insert into whatsapp_templates (key, meta_name, param_count, body) values
  ('registration', 'shift_registration_he', 3,
   E'שלום {{1}} 👋\n\nנרשמת בהצלחה למשמרת בבר 🍻\n\n📅 תאריך: {{2}}\n🕒 שעות: {{3}}\n\nנתראה בבר!'),
  ('reminder', 'shift_reminder_he', 2,
   E'היי {{1}} 👋\n\nתזכורת למשמרת שלך בבר מחר 🍻\n\n🕒 שעות: {{2}}\n\nמחכים לך!'),
  ('update', 'shift_update_he', 3,
   E'היי {{1}},\n\nחל שינוי במשמרת שלך בתאריך {{2}}.\n\nפרטים מעודכנים: {{3}}');

create trigger whatsapp_templates_set_updated_at
  before update on whatsapp_templates
  for each row execute function set_updated_at();

-- Queue and permanent log in one: automatic notifications are queued by
-- the triggers below and sent by the whatsapp-dispatch function; admin
-- test sends are logged here too (is_test). Never deleted.
create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('registration', 'removal', 'reminder', 'time_change', 'cancellation', 'test', 'optout_confirm')),
  employee_id uuid references employees (id) on delete set null,
  week_start date,
  assignment_role shift_assignment_role,
  actor_employee_id uuid references employees (id) on delete set null,
  to_phone text,
  template_key text,
  params jsonb,
  is_test boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'unknown')),
  wa_message_id text unique,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  error text,
  requested_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One queued message per person+evening+duty+kind: an evening's opening
-- and closing rows collapse into one message.
create unique index whatsapp_messages_one_queued
  on whatsapp_messages (employee_id, week_start, assignment_role, kind)
  where status = 'queued';
-- One reminder per person per evening, ever.
create unique index whatsapp_messages_one_reminder
  on whatsapp_messages (employee_id, week_start, assignment_role)
  where kind = 'reminder';
create index whatsapp_messages_due on whatsapp_messages (next_attempt_at) where status = 'queued';
create index whatsapp_messages_recent on whatsapp_messages (created_at desc);

create trigger whatsapp_messages_set_updated_at
  before update on whatsapp_messages
  for each row execute function set_updated_at();

alter table whatsapp_templates enable row level security;
alter table whatsapp_messages enable row level security;

create policy whatsapp_templates_select_admin on whatsapp_templates for select using (is_admin());
create policy whatsapp_templates_update_admin on whatsapp_templates for update using (is_admin()) with check (is_admin());
create policy whatsapp_messages_select_admin on whatsapp_messages for select using (is_admin());

-- Explicit, since new tables are no longer exposed to the Data API roles
-- by default. Messages are written only by the server (service role).
grant select, update on whatsapp_templates to authenticated;
grant select on whatsapp_messages to authenticated;
grant select, insert, update, delete on whatsapp_templates to service_role;
grant select, insert, update, delete on whatsapp_messages to service_role;

-- Hands out due messages to one dispatcher run at a time (SKIP LOCKED),
-- marking them 'sending' first so two overlapping runs can't both send.
create function claim_whatsapp_messages(p_limit int)
returns setof whatsapp_messages
language sql
security definer
set search_path = public
as $$
  update whatsapp_messages m
  set status = 'sending', attempts = m.attempts + 1
  where m.id in (
    select id from whatsapp_messages
    where status = 'queued' and next_attempt_at <= now() and not is_test
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning m.*;
$$;

revoke execute on function claim_whatsapp_messages(int) from public, anon, authenticated;
grant execute on function claim_whatsapp_messages(int) to service_role;

-- ---------------------------------------------------------------------
-- Queuing: sign-up / removal (replaces migration 101's version)
-- ---------------------------------------------------------------------

alter type shift_email_kind add value if not exists 'changed';
alter type shift_email_kind add value if not exists 'cancelled';

-- Queues a notification on each channel that's switched on and that the
-- person chose. Never lets a notification problem fail the sign-up
-- itself: any error is downgraded to a warning.
create or replace function enqueue_shift_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings app_settings;
  v_row shift_assignments;
  v_assigned boolean := tg_op = 'INSERT';
  v_week date;
  v_start timestamptz;
  v_actor uuid;
  v_emp employees;
begin
  begin
    select * into v_settings from app_settings where id;
    if not (v_settings.shift_emails_enabled or v_settings.shift_whatsapp_enabled) then
      return null;
    end if;

    v_row := case when v_assigned then new else old end;

    select week_start, start_time into v_week, v_start from shifts where id = v_row.shift_id;
    -- Only evenings that haven't happened yet.
    if v_week is null or v_start < now() - interval '6 hours' then
      return null;
    end if;

    select * into v_emp from employees where id = v_row.employee_id;
    select employee_id into v_actor from app_users where id = auth.uid();
    if v_actor = v_row.employee_id then
      v_actor := null;
    end if;

    if v_settings.shift_emails_enabled and v_emp.notify_email then
      insert into shift_email_outbox (kind, employee_id, week_start, assignment_role, actor_employee_id)
      values (case when v_assigned then 'assigned' else 'removed' end::shift_email_kind,
              v_row.employee_id, v_week, v_row.assignment_role, v_actor)
      on conflict do nothing;
    end if;

    if v_settings.shift_whatsapp_enabled and v_emp.notify_whatsapp then
      insert into whatsapp_messages (kind, employee_id, week_start, assignment_role, actor_employee_id)
      values (case when v_assigned then 'registration' else 'removal' end,
              v_row.employee_id, v_week, v_row.assignment_role, v_actor)
      on conflict do nothing;
    end if;
  exception when others then
    raise warning 'shift notification not queued: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Queuing: evening cancelled / hours changed
-- ---------------------------------------------------------------------

create function enqueue_shift_change_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings app_settings;
  v_cancelled boolean;
  v_actor uuid;
  r record;
begin
  begin
    select * into v_settings from app_settings where id;
    if not (v_settings.shift_emails_enabled or v_settings.shift_whatsapp_enabled) then
      return null;
    end if;

    v_cancelled := old.status <> 'cancelled' and new.status = 'cancelled';
    if not v_cancelled and not (
      new.status <> 'cancelled'
      and (new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time)
    ) then
      return null;
    end if;
    if greatest(old.start_time, new.start_time) < now() then
      return null;
    end if;

    select employee_id into v_actor from app_users where id = auth.uid();

    for r in
      select distinct sa.employee_id, sa.assignment_role, e.notify_email, e.notify_whatsapp
      from shift_assignments sa
      join employees e on e.id = sa.employee_id
      where sa.shift_id = new.id
    loop
      if v_settings.shift_emails_enabled and r.notify_email then
        insert into shift_email_outbox (kind, employee_id, week_start, assignment_role, actor_employee_id)
        values (case when v_cancelled then 'cancelled' else 'changed' end::shift_email_kind,
                r.employee_id, new.week_start, r.assignment_role,
                case when v_actor = r.employee_id then null else v_actor end)
        on conflict do nothing;
      end if;
      if v_settings.shift_whatsapp_enabled and r.notify_whatsapp then
        insert into whatsapp_messages (kind, employee_id, week_start, assignment_role, actor_employee_id)
        values (case when v_cancelled then 'cancellation' else 'time_change' end,
                r.employee_id, new.week_start, r.assignment_role,
                case when v_actor = r.employee_id then null else v_actor end)
        on conflict do nothing;
      end if;
    end loop;
  exception when others then
    raise warning 'shift change notification not queued: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger shifts_enqueue_change_notifications
  after update of status, start_time, end_time on shifts
  for each row execute function enqueue_shift_change_notifications();

-- ---------------------------------------------------------------------
-- Reminders, at the admin-configured time (replaces migration 101's)
-- ---------------------------------------------------------------------

-- Due from <evening date - reminder_days_before> at reminder_time (Israel
-- time) until the evening starts. Only people already signed up by that
-- moment get one (someone joining later just got the sign-up message).
-- Safe to call every minute from both schedulers: the one-reminder
-- indexes make repeats no-ops.
create or replace function enqueue_shift_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings app_settings;
begin
  select * into v_settings from app_settings where id;
  if not (v_settings.shift_emails_enabled or v_settings.shift_whatsapp_enabled) then
    return;
  end if;

  create temp table due_reminders on commit drop as
  select sa.employee_id, s.week_start, sa.assignment_role, e.notify_email, e.notify_whatsapp
  from shift_assignments sa
  join shifts s on s.id = sa.shift_id
  join employees e on e.id = sa.employee_id
  where s.status <> 'cancelled'
    and s.start_time > now()
  group by sa.employee_id, s.week_start, sa.assignment_role, e.notify_email, e.notify_whatsapp
  having (
      ((min(s.start_time) at time zone 'Asia/Jerusalem')::date - v_settings.reminder_days_before)
      + v_settings.reminder_time
    ) at time zone 'Asia/Jerusalem' <= now()
    and min(sa.created_at) <= (
      ((min(s.start_time) at time zone 'Asia/Jerusalem')::date - v_settings.reminder_days_before)
      + v_settings.reminder_time
    ) at time zone 'Asia/Jerusalem';

  if v_settings.shift_emails_enabled then
    insert into shift_email_outbox (kind, employee_id, week_start, assignment_role)
    select 'reminder', employee_id, week_start, assignment_role from due_reminders where notify_email
    on conflict do nothing;
  end if;
  if v_settings.shift_whatsapp_enabled then
    insert into whatsapp_messages (kind, employee_id, week_start, assignment_role)
    select 'reminder', employee_id, week_start, assignment_role from due_reminders where notify_whatsapp
    on conflict do nothing;
  end if;

  drop table due_reminders;
end;
$$;

-- These are for the schedulers and triggers only.
revoke execute on function enqueue_shift_reminders() from public, anon, authenticated;
grant execute on function enqueue_shift_reminders() to service_role;

-- Which channels are on, for the sign-up page (not signed in yet, so it
-- can't read app_settings). Exposes nothing else.
create function notification_channels()
returns table (email boolean, whatsapp boolean)
language sql
stable
security definer
set search_path = public
as $$
  select shift_emails_enabled, shift_whatsapp_enabled from app_settings where id;
$$;

grant execute on function notification_channels() to anon, authenticated;
