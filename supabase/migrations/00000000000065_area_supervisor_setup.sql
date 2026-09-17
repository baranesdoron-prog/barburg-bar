-- Area supervisor ("מפקח/ת מתחם"): unlike bartender/area manager (open to
-- anyone with an account role), only a specific allow-list of employees
-- can hold this duty. A boolean column, same pattern as the senior
-- overrides, rather than a separate table -- it's a flat yes/no per
-- employee, nothing relational about it.
alter table employees add column can_supervise_area boolean not null default false;

update employees set can_supervise_area = true where id in (
  '28b4358b-e6ce-4671-84c1-895213582736', -- אבשי אביטל
  '8ae7727e-1a27-467b-9af8-bd71abe38ead', -- דידי סבר
  '09f9d24d-636f-4a49-9530-6743ff59b0ec', -- דני אורן
  '30168e80-bd0f-41e4-b37d-2c0c3389e16f', -- חלי סלוצקי
  '8ba3e4d8-689a-4e6e-89fb-987e4e22e86d', -- יהל שיין
  'fae8e427-2076-47aa-9727-ef448e2a251a', -- ליאת אורן
  '2bb08747-69d1-441e-9e75-3a7f44ec68ff'  -- מיכאל שטרן
);

-- Self-insert: area supervisor follows the same one-per-shift pattern as
-- the other duties, capped at 1 (not 2, unlike area manager), plus the
-- allow-list check above.
drop policy shift_assignments_insert_self on shift_assignments;
create policy shift_assignments_insert_self on shift_assignments
  for insert
  with check (
    current_app_role() in ('bartender', 'shift_manager')
    and employee_id = (select employee_id from app_users where id = auth.uid())
    and exists (
      select 1 from shifts s
      where s.id = shift_id
        and s.status = 'published'
        and s.week_start >= active_week_start()
        and (
          (
            assignment_role = 'bartender'
            and (
              s.required_staff_count is null
              or (
                select count(*) from shift_assignments sa
                where sa.shift_id = s.id and sa.assignment_role = 'bartender'
              ) < s.required_staff_count
            )
          )
          or (
            assignment_role = 'area_manager'
            and (
              select count(*) from shift_assignments sa
              where sa.shift_id = s.id and sa.assignment_role = 'area_manager'
            ) < 2
          )
          or (
            assignment_role = 'area_supervisor'
            and exists (select 1 from employees e where e.id = employee_id and e.can_supervise_area)
            and (
              select count(*) from shift_assignments sa
              where sa.shift_id = s.id and sa.assignment_role = 'area_supervisor'
            ) < 1
          )
        )
    )
  );

-- list_employee_shift_counts() gains an area_supervisor_count bucket, same
-- treatment as the other three.
drop function if exists list_employee_shift_counts();

create function list_employee_shift_counts()
returns table (
  employee_id uuid,
  bartender_count bigint,
  area_manager_count bigint,
  area_supervisor_count bigint,
  bar_manager_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    employee_id,
    count(*) filter (where duty = 'bartender')::bigint as bartender_count,
    count(*) filter (where duty = 'area_manager')::bigint as area_manager_count,
    count(*) filter (where duty = 'area_supervisor')::bigint as area_supervisor_count,
    count(*) filter (where duty = 'bar_manager')::bigint as bar_manager_count
  from (
    select s.shift_manager_id as employee_id, 'bar_manager' as duty
    from shifts_with_effective_status s
    where s.shift_manager_id is not null
      and s.effective_status in ('completed', 'reopened')
    union all
    select sa.employee_id, sa.assignment_role::text as duty
    from shift_assignments sa
    join shifts_with_effective_status s on s.id = sa.shift_id
    where s.effective_status in ('completed', 'reopened')
  ) counts
  group by employee_id;
$$;
