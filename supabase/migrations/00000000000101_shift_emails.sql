-- Shift emails: an employee gets an email when they're signed up for an
-- evening (by themselves or by a manager), when they're removed, and a
-- reminder the day before. Every change to shift_assignments queues a row
-- here; the send-shift-emails edge function (called every minute, see the
-- next migration) works through the queue and sends via Resend.
--
-- Queued per (employee, evening, duty), not per shift_assignments row: a
-- whole-evening duty is two rows (opening + closing), so the pending
-- unique index collapses the pair into one email. Whether an email is
-- still worth sending (a sign-up undone a minute later, a bar manager
-- re-set to the same person, a bartender split by a manager) is decided
-- at send time, against the assignments as they are then.

create type shift_email_kind as enum ('assigned', 'removed', 'reminder');
create type shift_email_status as enum ('pending', 'sent', 'skipped', 'failed');

create table shift_email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind shift_email_kind not null,
  employee_id uuid not null references employees (id) on delete cascade,
  week_start date not null,
  assignment_role shift_assignment_role not null,
  -- The manager who made the change, when it wasn't the employee
  -- themselves ("שובצת ע״י ...").
  actor_employee_id uuid references employees (id) on delete set null,
  status shift_email_status not null default 'pending',
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index shift_email_outbox_one_pending
  on shift_email_outbox (employee_id, week_start, assignment_role, kind)
  where status = 'pending';

-- One reminder per person per evening, ever.
create unique index shift_email_outbox_one_reminder
  on shift_email_outbox (employee_id, week_start, assignment_role)
  where kind = 'reminder';

create index shift_email_outbox_pending on shift_email_outbox (created_at) where status = 'pending';

alter table shift_email_outbox enable row level security;

-- Written only by the security-definer functions below and read by the
-- edge function's service role; admins can look at the log.
create policy shift_email_outbox_select_admin on shift_email_outbox
  for select using (is_admin());

-- Explicit, since new tables are no longer exposed to the Data API roles
-- by default (see supabase/config.toml, auto_expose_new_tables).
grant select on shift_email_outbox to authenticated;
grant select, insert, update, delete on shift_email_outbox to service_role;

-- Master switch (off until the sending domain is set up) and the hidden
-- copy list, both on the admin settings card.
alter table app_settings add column shift_emails_enabled boolean not null default false;
alter table app_settings add column shift_email_bcc text[] not null default '{}';

create function enqueue_shift_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row shift_assignments;
  v_kind shift_email_kind;
  v_week date;
  v_start timestamptz;
  v_actor uuid;
begin
  if not coalesce((select shift_emails_enabled from app_settings where id), false) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_row := new;
    v_kind := 'assigned';
  else
    v_row := old;
    v_kind := 'removed';
  end if;

  select week_start, start_time into v_week, v_start from shifts where id = v_row.shift_id;
  -- Only evenings that haven't happened yet -- fixing up an old week's
  -- attendance shouldn't email anyone.
  if v_week is null or v_start < now() - interval '6 hours' then
    return null;
  end if;

  select employee_id into v_actor from app_users where id = auth.uid();
  if v_actor = v_row.employee_id then
    v_actor := null;
  end if;

  insert into shift_email_outbox (kind, employee_id, week_start, assignment_role, actor_employee_id)
  values (v_kind, v_row.employee_id, v_week, v_row.assignment_role, v_actor)
  on conflict do nothing;

  return null;
end;
$$;

create trigger shift_assignments_enqueue_email
  after insert or delete on shift_assignments
  for each row execute function enqueue_shift_email();

-- Reminders for tomorrow's evenings, from 12:00 Israel time the day
-- before. Safe to call often (the cron job calls it every minute): the
-- one-reminder index makes repeats no-ops, and someone signing up later
-- that afternoon still gets theirs on the next run.
create function enqueue_shift_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_local timestamp := now() at time zone 'Asia/Jerusalem';
begin
  if not coalesce((select shift_emails_enabled from app_settings where id), false) then
    return;
  end if;
  if extract(hour from v_now_local) < 12 then
    return;
  end if;

  insert into shift_email_outbox (kind, employee_id, week_start, assignment_role)
  select distinct 'reminder'::shift_email_kind, sa.employee_id, s.week_start, sa.assignment_role
  from shift_assignments sa
  join shifts s on s.id = sa.shift_id
  where s.status <> 'cancelled'
    and (s.start_time at time zone 'Asia/Jerusalem')::date = v_now_local::date + 1
  on conflict do nothing;
end;
$$;
