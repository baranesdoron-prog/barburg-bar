-- Milestone 2: admin approval flow RPCs.
--
-- app_users deliberately doesn't duplicate email (auth.users is the source
-- of truth), but the admin UI needs to show who's pending, so this joins
-- the two behind an admin-only, SECURITY DEFINER function rather than
-- exposing auth.users directly.

create function list_pending_app_users()
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
    select au.id, u.email, au.created_at
    from app_users au
    join auth.users u on u.id = au.id
    where au.status = 'pending_approval'
    order by au.created_at asc;
end;
$$;

-- Reject a pending signup (or suspend anyone), symmetric to approve_user().
-- Re-approving later needs no separate RPC: approve_user() already works
-- regardless of the row's current status.
create function suspend_user(p_user_id uuid)
returns app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row app_users;
begin
  if is_admin() is not true then
    raise exception 'only administrators can suspend users';
  end if;

  update app_users
  set status = 'suspended'
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'app_user % not found', p_user_id;
  end if;

  return v_row;
end;
$$;
