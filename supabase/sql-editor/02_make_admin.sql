-- =============================================================================
-- DSA — 02_make_admin.sql
-- Makes an existing Supabase Auth user an admin of the graph editor.
--
-- 1. Sign up / sign in once in the admin app (or create the user in
--    Authentication → Users) so the account exists.
-- 2. Replace REPLACE_WITH_YOUR_EMAIL below with that account's email.
-- 3. Run this file. Safe to run again.
-- =============================================================================

do $$
declare
  v_email   text := 'beniwinner03@gmail.com';
  v_user_id uuid;
begin
  if v_email = 'REPLACE_WITH_YOUR_EMAIL' then
    raise exception 'Edit 02_make_admin.sql first: replace REPLACE_WITH_YOUR_EMAIL with your email.';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(v_email))
  order by u.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'No user with email % in auth.users. Sign up or sign in once first (Authentication → Users).', v_email;
  end if;

  insert into public.admin_users (user_id, note)
  values (v_user_id, 'added by 02_make_admin.sql for ' || v_email)
  on conflict (user_id) do nothing;

  raise notice 'User % (%) is now an admin.', v_email, v_user_id;
end;
$$;

select a.user_id, u.email, a.created_at
from public.admin_users a
join auth.users u on u.id = a.user_id
order by a.created_at;
