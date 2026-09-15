-- Cricket.lk cloud schema — Milestone 1: accounts & auth foundation.
-- Run once in your Supabase project's SQL editor (Project -> SQL Editor -> New query).
-- Later milestones (clubs, matches, claims, tournaments) add further files here;
-- run them in order as they're added.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user is created, pulling
-- display_name out of the signup metadata (see options.data.display_name
-- in the client's supabaseClient.auth.signUp call). This runs regardless of
-- whether email confirmation is required, since it's on auth.users insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Single platform-wide admin role (reviews claim requests and phone-number
-- change tickets in later milestones). Deliberately not self-service — add
-- the first admin by hand after signing up once:
--   select id, email from auth.users; -- find your user id
--   insert into public.admin_users (user_id) values ('paste-uuid-here');
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users: read own" on public.admin_users
  for select using (auth.uid() = user_id);
