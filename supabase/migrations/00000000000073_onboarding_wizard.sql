-- Guided "what do you want to do today?" onboarding wizard: bartenders
-- get redirected to it on login (admin-toggleable on/off, and either
-- every login or only the first ever), letting them self-assign to an
-- open shift directly instead of landing on /shifts cold. Bar
-- managers/admins aren't auto-redirected but can reach the same
-- wizard voluntarily.

-- Singleton settings row -- first table of its kind in this schema,
-- kept deliberately tiny (just what this feature needs).
create table app_settings (
  id boolean primary key default true check (id),
  onboarding_wizard_enabled boolean not null default false,
  onboarding_wizard_frequency text not null default 'first_login'
    check (onboarding_wizard_frequency in ('first_login', 'every_login')),
  updated_at timestamptz not null default now()
);
insert into app_settings (id) values (true);

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

alter table app_settings enable row level security;

create policy app_settings_select_approved on app_settings
  for select using (is_approved());

create policy app_settings_update_admin on app_settings
  for update using (is_admin()) with check (is_admin());

-- Per-user "have they seen the wizard" marker, for first_login mode.
alter table app_users add column onboarding_seen_at timestamptz;

-- Matches the app_users_update_admin_only precedent: self-mutation of
-- app_users goes through a security-definer RPC, never a raw client
-- update policy.
create function mark_onboarding_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update app_users set onboarding_seen_at = now() where id = auth.uid();
end;
$$;

grant execute on function mark_onboarding_seen() to authenticated;

-- Let a bar manager self-assign as area supervisor too, matching "bar
-- manager/admin can register as everything" -- previously only
-- can_supervise_area employees and admins could (migration 66).
alter policy shift_assignments_insert_self on shift_assignments
  with check (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_assignments.shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          (
            shift_assignments.assignment_role = 'bartender'
            and (
              s.required_staff_count is null
              or (select count(*) from shift_assignments sa
                  where sa.shift_id = s.id and sa.assignment_role = 'bartender') < s.required_staff_count
            )
          )
          or (
            shift_assignments.assignment_role = 'area_manager'
            and (select count(*) from shift_assignments sa
                 where sa.shift_id = s.id and sa.assignment_role = 'area_manager') < 2
          )
          or (
            shift_assignments.assignment_role = 'area_supervisor'
            and exists (
              select 1 from employees e
              where e.id = shift_assignments.employee_id
                and (
                  e.can_supervise_area
                  or exists (
                    select 1 from app_users au
                    where au.employee_id = e.id
                      and au.role in ('administrator', 'shift_manager')
                      and au.status = 'approved'
                  )
                )
            )
            and (select count(*) from shift_assignments sa
                 where sa.shift_id = s.id and sa.assignment_role = 'area_supervisor') < 1
          )
        )
    )
  );
