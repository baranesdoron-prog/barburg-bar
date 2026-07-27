-- Fix: auth.users.email is character varying(255), not text, so
-- list_pending_app_users() failed at query time with "structure of query
-- does not match function result type". Cast explicitly.

create or replace function list_pending_app_users()
returns table (id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if is_admin() is not true then
    raise exception 'only administrators can list pending users';
  end if;

  return query
    select au.id, u.email::text, au.created_at
    from app_users au
    join auth.users u on u.id = au.id
    where au.status = 'pending_approval'
    order by au.created_at asc;
end;
$$;
