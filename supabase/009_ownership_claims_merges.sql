-- Cricket.lk cloud schema — who may manage a player, one claim per person,
-- and merging duplicate profiles (all through platform-admin approval).
--
-- RULES
--   * A player profile is managed (contact number, NIC, details) by:
--       - the player themself once they have claimed it (players.claimed_by),
--       - a platform admin, or
--       - while it is still UNCLAIMED, members of the club that added the
--         player to the platform (players.origin_club_id).
--     Adding an existing platform player to your club roster does NOT give
--     you management of them; they claim their profile and edit it
--     themselves. Once claimed, the club no longer edits it.
--   * A person can claim only ONE profile. A second profile that is also
--     them is a MERGE request into the one they already own. Both claims and
--     merges are requests a platform admin approves or rejects.
--   * A merge keeps the surviving profile's id; the merged profile's name
--     becomes an alias (matches store names, not ids, so stats fold across
--     name + aliases), its club roster entries move over, and any blank
--     fields on the survivor are filled from it. The merged row is deleted.
--
-- Run by hand in the Supabase SQL editor, after 008.
-- NOTE: the unique index below fails if a user already has two claimed
-- profiles; resolve those (or merge them by hand) before running.

-- ---------------------------------------------------------------- origin
alter table public.players
  add column if not exists origin_club_id uuid references public.clubs(id) on delete set null;

-- Backfill: the earliest club that rostered an existing player.
update public.players p
set origin_club_id = (
  select r.club_id from public.club_rosters r
  where r.player_id = p.id order by r.added_at limit 1
)
where p.origin_club_id is null;

-- ------------------------------------------------------ one claim per user
create unique index if not exists players_one_claim_per_user
  on public.players (claimed_by) where claimed_by is not null;

-- ---------------------------------------------------------- manage rule
-- (Name kept from 007 so 007/008's functions pick up the new rule.)
create or replace function public.can_see_player_contact(_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.players p where p.id = _player_id and p.claimed_by = auth.uid())
    or exists (
      select 1 from public.players p
      where p.id = _player_id and p.claimed_by is null
        and p.origin_club_id is not null and public.is_club_member(p.origin_club_id)
    )
  );
$$;

-- --------------------------------------------------------------- aliases
create table if not exists public.player_aliases (
  player_id uuid not null references public.players(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists player_aliases_alias_uniq on public.player_aliases (lower(alias));

alter table public.player_aliases enable row level security;
drop policy if exists "player_aliases: public read" on public.player_aliases;
create policy "player_aliases: public read" on public.player_aliases for select using (true);
grant select on public.player_aliases to anon, authenticated;
-- No write policies: aliases are only ever created by approve_merge below.

-- ---------------------------------------- add_player_to_club (now jsonb)
drop function if exists public.add_player_to_club(uuid, text);
create function public.add_player_to_club(_club_id uuid, _name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _clean text := btrim(_name);
  _player_id uuid;
  _created boolean := false;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_club_member(_club_id) then raise exception 'not a member of this club'; end if;
  if _clean is null or _clean = '' then raise exception 'player name is required'; end if;

  select id into _player_id from public.players
    where lower(name) = lower(_clean) order by created_at limit 1;
  if _player_id is null then
    select player_id into _player_id from public.player_aliases where lower(alias) = lower(_clean) limit 1;
  end if;

  if _player_id is null then
    insert into public.players (name, created_by, origin_club_id)
    values (_clean, auth.uid(), _club_id)
    returning id into _player_id;
    _created := true;
  end if;

  insert into public.club_rosters (club_id, player_id) values (_club_id, _player_id)
  on conflict do nothing;

  -- created = this call added them to the platform (so this club manages
  -- the profile until they claim it); false = they already existed.
  return jsonb_build_object('id', _player_id, 'created', _created);
end;
$$;
revoke all on function public.add_player_to_club(uuid, text) from public;
grant execute on function public.add_player_to_club(uuid, text) to authenticated;

-- ----------------------------------- ensure_global_player (+ origin club)
drop function if exists public.ensure_global_player(text);
create function public.ensure_global_player(_name text, _club_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _clean text := btrim(_name);
  _player_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if _clean is null or _clean = '' then raise exception 'player name is required'; end if;
  if _club_id is not null and not public.is_club_member(_club_id) then
    raise exception 'not a member of this club';
  end if;

  select id into _player_id from public.players
    where lower(name) = lower(_clean) order by created_at limit 1;
  if _player_id is null then
    select player_id into _player_id from public.player_aliases where lower(alias) = lower(_clean) limit 1;
  end if;
  if _player_id is null then
    insert into public.players (name, created_by, origin_club_id)
    values (_clean, auth.uid(), _club_id)
    returning id into _player_id;
  end if;
  return _player_id;
end;
$$;
revoke all on function public.ensure_global_player(text, uuid) from public;
grant execute on function public.ensure_global_player(text, uuid) to authenticated;

-- ---------------------------------------------------------------- claims
-- Claims are created only through request_claim (direct inserts removed),
-- so the one-profile-per-person rule can't be bypassed.
drop policy if exists "claim_requests: authenticated create" on public.claim_requests;

create or replace function public.request_claim(_player_id uuid, _phone text, _note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _p text := nullif(btrim(_phone), '');
begin
  if _uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.players where claimed_by = _uid) then
    raise exception 'You already have a claimed profile — request a merge instead.';
  end if;
  if not exists (select 1 from public.players where id = _player_id and claimed_by is null) then
    raise exception 'That profile is already claimed.';
  end if;
  if exists (select 1 from public.claim_requests where requested_by = _uid and status = 'pending') then
    raise exception 'You already have a claim waiting for approval.';
  end if;
  if _p is not null and _p !~ '^\+?[0-9 ]{7,15}$' then raise exception 'invalid contact number'; end if;

  insert into public.claim_requests (player_id, requested_by, claimed_phone, note)
  values (_player_id, _uid, _p, nullif(btrim(_note), ''));
end;
$$;

create or replace function public.approve_claim(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _player_id uuid;
  _requested_by uuid;
  _phone text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select player_id, requested_by, claimed_phone
    into _player_id, _requested_by, _phone
    from public.claim_requests where id = _request_id and status = 'pending';
  if _player_id is null then raise exception 'no such pending request'; end if;

  if exists (select 1 from public.players where claimed_by = _requested_by) then
    raise exception 'requester already has a claimed profile — this should be a merge';
  end if;
  if not exists (select 1 from public.players where id = _player_id and claimed_by is null) then
    raise exception 'profile is already claimed';
  end if;

  update public.players
    set claimed_by = _requested_by, phone = coalesce(_phone, phone)
    where id = _player_id;

  update public.claim_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id;
end;
$$;

-- ---------------------------------------------------------------- merges
create table if not exists public.merge_requests (
  id uuid primary key default gen_random_uuid(),
  from_player_id uuid not null,  -- the duplicate; deleted on approval, so no FK
  into_player_id uuid not null references public.players(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.merge_requests enable row level security;
drop policy if exists "merge_requests: own or admin read" on public.merge_requests;
create policy "merge_requests: own or admin read" on public.merge_requests
  for select using (requested_by = auth.uid() or public.is_admin());
-- No insert/update policies: only the RPCs below write.

create or replace function public.request_merge(_from_player_id uuid, _note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _into uuid;
begin
  if _uid is null then raise exception 'not signed in'; end if;
  select id into _into from public.players where claimed_by = _uid;
  if _into is null then raise exception 'Claim your own profile first, then request the merge.'; end if;
  if _from_player_id = _into then raise exception 'That is already your profile.'; end if;
  if not exists (select 1 from public.players where id = _from_player_id and claimed_by is null) then
    raise exception 'Only an unclaimed profile can be merged into yours.';
  end if;
  if exists (select 1 from public.merge_requests
             where requested_by = _uid and from_player_id = _from_player_id and status = 'pending') then
    raise exception 'That merge is already waiting for approval.';
  end if;

  insert into public.merge_requests (from_player_id, into_player_id, requested_by, note)
  values (_from_player_id, _into, _uid, nullif(btrim(_note), ''));
end;
$$;

create or replace function public.approve_merge(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _from uuid;
  _into uuid;
  _by uuid;
  _from_name text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select from_player_id, into_player_id, requested_by
    into _from, _into, _by
    from public.merge_requests where id = _request_id and status = 'pending';
  if _from is null then raise exception 'no such pending request'; end if;

  if not exists (select 1 from public.players where id = _into and claimed_by = _by) then
    raise exception 'the requester no longer owns the target profile';
  end if;
  select name into _from_name from public.players where id = _from and claimed_by is null;
  if _from_name is null then raise exception 'the profile to merge is gone or has been claimed'; end if;

  -- name (and any aliases it had) now point at the surviving profile
  update public.player_aliases set player_id = _into where player_id = _from;
  insert into public.player_aliases (player_id, alias) values (_into, _from_name)
    on conflict do nothing;

  -- club roster entries move over
  insert into public.club_rosters (club_id, player_id)
    select club_id, _into from public.club_rosters where player_id = _from
  on conflict do nothing;

  -- fill blanks on the survivor from the merged profile
  update public.players t set
    phone        = coalesce(t.phone, f.phone),
    nic          = coalesce(t.nic, f.nic),
    batting_hand = coalesce(t.batting_hand, f.batting_hand),
    bowling_arm  = coalesce(t.bowling_arm, f.bowling_arm),
    bowling_type = coalesce(t.bowling_type, f.bowling_type),
    is_keeper    = t.is_keeper or f.is_keeper,
    city         = coalesce(t.city, f.city),
    photo        = coalesce(t.photo, f.photo)
  from public.players f
  where t.id = _into and f.id = _from;

  update public.merge_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id;

  -- other pending requests about the merged profile are now moot
  update public.merge_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where status = 'pending' and from_player_id = _from and id <> _request_id;

  delete from public.players where id = _from;  -- cascades its roster rows / claim requests
end;
$$;

create or replace function public.reject_merge(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.merge_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id and status = 'pending';
end;
$$;

revoke all on function public.request_claim(uuid, text, text) from public;
revoke all on function public.approve_claim(uuid) from public;
revoke all on function public.request_merge(uuid, text) from public;
revoke all on function public.approve_merge(uuid) from public;
revoke all on function public.reject_merge(uuid) from public;
grant execute on function public.request_claim(uuid, text, text) to authenticated;
grant execute on function public.approve_claim(uuid) to authenticated;
grant execute on function public.request_merge(uuid, text) to authenticated;
grant execute on function public.approve_merge(uuid) to authenticated;
grant execute on function public.reject_merge(uuid) to authenticated;
