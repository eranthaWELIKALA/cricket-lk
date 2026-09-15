-- Cricket.lk cloud schema — Milestone 2: clubs, global players, club
-- rosters/presets, and Local-tier matches (practice/friendly; Local
-- tournaments reuse the same `matches` rows, `level = 'local'`).
-- Run once in your Supabase project's SQL editor, after 001_accounts.sql.
--
-- Ordering note: tables are created before any `language sql` function
-- that queries them (Postgres validates a SQL-language function body at
-- CREATE FUNCTION time, unlike plpgsql, so e.g. is_club_member() must
-- come after club_members exists) -- and policies come after the helper
-- functions they call.

create extension if not exists pgcrypto; -- gen_random_uuid(); no-op if already available

-- ---------------------------------------------------------------------
-- clubs + club_members (shared owner/admin management, not single-owner)
-- Tables first, RLS/policies added further below once the helper
-- functions that check membership exist.
-- ---------------------------------------------------------------------

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- ---------------------------------------------------------------------
-- Helper functions (security definer so RLS policies that need to check
-- "am I a member of this club" don't recurse into club_members' own RLS).
-- ---------------------------------------------------------------------

create or replace function public.is_club_member(_club_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.club_members
    where club_id = _club_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_club_owner(_club_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.club_members
    where club_id = _club_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Club member lists need to show a fellow member's display name, but
-- `profiles` (Milestone 1) is self-read-only. Same pattern as
-- players_public below: a view exposing only the non-sensitive column,
-- running as its owner so it bypasses the base table's RLS on purpose.
create or replace view public.profiles_public as
  select id, display_name from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- clubs + club_members RLS (now that the helper functions exist)
-- ---------------------------------------------------------------------

alter table public.clubs enable row level security;

create policy "clubs: public read" on public.clubs
  for select using (true);

create policy "clubs: authenticated create" on public.clubs
  for insert with check (created_by = auth.uid());

create policy "clubs: members update" on public.clubs
  for update using (public.is_club_member(id));

create policy "clubs: owner delete" on public.clubs
  for delete using (public.is_club_owner(id));

alter table public.club_members enable row level security;

create policy "club_members: members read" on public.club_members
  for select using (public.is_club_member(club_id));

-- Bootstrap: creating a club's very first member row (the owner) can't
-- go through the "existing member adds one" policy below, since no
-- member exists yet to satisfy it.
create policy "club_members: bootstrap owner insert" on public.club_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (select 1 from public.club_members m where m.club_id = club_members.club_id)
  );

create policy "club_members: existing member adds another" on public.club_members
  for insert
  with check (public.is_club_member(club_id));

create policy "club_members: leave or owner removes" on public.club_members
  for delete
  using (user_id = auth.uid() or public.is_club_owner(club_id));

-- Adding another admin by email needs to resolve email -> user id, which
-- the client can't do directly (auth.users isn't exposed, and profiles is
-- self-read-only). This RPC does the lookup server-side and inserts the
-- membership row in one step; returns 'ok' / 'not_found' / 'already_member'
-- so the UI can show a clear message either way.
create or replace function public.invite_club_admin(_club_id uuid, _email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid;
begin
  if not public.is_club_member(_club_id) then
    raise exception 'not a member of this club';
  end if;

  select id into _user_id from auth.users where email = _email limit 1;
  if _user_id is null then
    return 'not_found';
  end if;

  if exists (select 1 from public.club_members where club_id = _club_id and user_id = _user_id) then
    return 'already_member';
  end if;

  insert into public.club_members (club_id, user_id, role) values (_club_id, _user_id, 'admin');
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------
-- players — global, not per-club (mirrors the local app's flat, global,
-- name-deduplicated state.players table, so a player's stats naturally
-- fold across every club/match they appear in without special-casing).
-- ---------------------------------------------------------------------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  claimed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

-- Base table is NOT publicly readable -- phone must never leak. Only the
-- claiming user or a platform admin can read the raw row (incl. phone).
create policy "players: claimant or admin read" on public.players
  for select using (claimed_by = auth.uid() or public.is_admin());

create policy "players: authenticated create" on public.players
  for insert with check (created_by = auth.uid());

-- No UPDATE policy yet: phone/claimed_by are only ever set via the
-- SECURITY DEFINER claim/admin RPCs added in Milestone 3, and plain
-- renames aren't supported from the client at this milestone either.

-- Public, non-sensitive view every roster/leaderboard screen should read
-- from instead of the base table. Views run as their owner (not the
-- caller) by default in Postgres, so this intentionally bypasses the
-- base table's RLS to expose name/claimed_by (but never phone) broadly.
create or replace view public.players_public as
  select id, name, claimed_by, created_at from public.players;

grant select on public.players_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- club_rosters — many-to-many join, the cloud equivalent of today's
-- local state.teams[x].playerIds. Lets a club build up "our players"
-- before anyone's played a match yet.
-- ---------------------------------------------------------------------

create table if not exists public.club_rosters (
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (club_id, player_id)
);

alter table public.club_rosters enable row level security;

create policy "club_rosters: members read" on public.club_rosters
  for select using (public.is_club_member(club_id));

create policy "club_rosters: members manage" on public.club_rosters
  for insert with check (public.is_club_member(club_id));

create policy "club_rosters: members remove" on public.club_rosters
  for delete using (public.is_club_member(club_id));

-- ---------------------------------------------------------------------
-- club_presets — saved match/tournament presets, scoped per club.
-- ---------------------------------------------------------------------

create table if not exists public.club_presets (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('match', 'tournament')),
  preset jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.club_presets enable row level security;

create policy "club_presets: members read" on public.club_presets
  for select using (public.is_club_member(club_id));

create policy "club_presets: members manage" on public.club_presets
  for all using (public.is_club_member(club_id)) with check (public.is_club_member(club_id));

-- ---------------------------------------------------------------------
-- matches — one row per archived match, `data` is the full archived
-- match object exactly as produced by the local app's archiveMatch().
-- No synced "team" entity at this milestone; see CLAUDE.md.
-- ---------------------------------------------------------------------

create table if not exists public.matches (
  id text primary key, -- client-generated via the local app's genId("match"), e.g. "match-l8x2k3-a1b2c3" -- NOT a uuid, so this column must stay `text`
  club_id uuid not null references public.clubs(id) on delete cascade,
  match_type text not null check (match_type in ('practice', 'friendly', 'tournament', 'personal_tournament')),
  level text not null default 'local' check (level in ('local', 'premier')),
  opponent_club_id uuid references public.clubs(id),
  opponent_name text,
  tournament_id uuid, -- populated in Milestone 4
  created_by uuid not null references auth.users(id),
  data jsonb not null,
  played_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.matches enable row level security;

create policy "matches: public read" on public.matches
  for select using (true);

create policy "matches: members create" on public.matches
  for insert with check (public.is_club_member(club_id) and created_by = auth.uid());

create policy "matches: members update" on public.matches
  for update using (public.is_club_member(club_id)) with check (public.is_club_member(club_id));
