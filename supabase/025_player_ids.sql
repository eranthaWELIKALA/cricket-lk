-- 025: player ids -- a player is their id, not their name.
--
-- Until now one name was one player: adding a player by name, or a friendly's
-- visitor, reused whoever already had that exact name (the oldest), and every
-- stat counted names. Two different people called Kasun Perera became one
-- profile with both men's runs. From the app version with player ids, every
-- match stores who each name in it is (matches.data.playerIds: { name: id }),
-- and every stat counts ids. This file is the database's half:
--
--   1. Two people may share a name. add_player_to_club and
--      ensure_global_player take _new: true makes a new player even when the
--      name exists (the app asks "Is this him?" first; without _new they
--      still reuse the existing player, so older app versions are unchanged).
--   2. find_players_named(_name, _club_id): the players a name could be --
--      public details only, plus the club that first added them and whether
--      they're on your club's roster -- for that question.
--   3. Matches already in the cloud get their ids: link_match_player_ids()
--      reports, for every match, the names it can tie to exactly one player
--      (that club's roster first, then anyone on the platform; old names
--      through player_aliases; a tournament's visitors as "guest:<name>") and
--      the ones it can't (two players of that name, or nobody). Run it with
--      false first and read the report; true writes the ids. A name it can't
--      tell is left alone: the app still counts it by name, as before.
--   4. A trigger does the same for every match uploaded from now on, so a
--      phone still on an older app version can't add unlinked matches. It
--      only fills names a match has no id for, never changes one, and drops
--      a temporary id (a club player added offline, "tmp:...") if one slips
--      through.
--   5. merging two profiles (011's merge_player_rows) also moves the
--      merged-away profile's id in every match to the survivor; and an id of a
--      player since deleted is dropped (and the name linked again by name).
--   6. player_matches (019) finds a player's matches by id, plus older ones
--      by name or alias where the match hasn't tied that name to anyone and
--      no other player has that name (else it's nobody's: it can't be known).
--   7. rename_player allows a name another player has, unless that player is
--      on the same club roster (a club needs its names to tell them apart).
--   8. For platform admins (the admin portal's Unlinked names): the names no
--      player could be tied to, with who they could be, and a way to tie one
--      name in one match to a player (with a reason, in the audit log).
--
-- Nothing private is exposed: find_players_named returns the public profile
-- columns (players_public), a club's name, and a yes/no for your own roster.
-- The linking functions can't be called from the app.
--
-- Requires 002, 009 (player_aliases), 010 (nickname, jersey_no), 011
-- (admin_log, merge_player_rows), 012, 013 and 019. Take a backup first. Safe to run twice.

-- ------------------------------------------- 1. two people, one name
drop function if exists public.add_player_to_club(uuid, text);
create or replace function public.add_player_to_club(_club_id uuid, _name text, _new boolean default false)
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

  -- _new: someone else with this name -- a new player, whoever has it already.
  if not coalesce(_new, false) then
    select id into _player_id from public.players
      where lower(name) = lower(_clean) order by created_at limit 1;
    if _player_id is null then
      select player_id into _player_id from public.player_aliases where lower(alias) = lower(_clean) limit 1;
    end if;
  end if;

  if _player_id is null then
    insert into public.players (name, created_by, origin_club_id)
    values (_clean, auth.uid(), _club_id)
    returning id into _player_id;
    _created := true;
  end if;

  insert into public.club_rosters (club_id, player_id) values (_club_id, _player_id)
  on conflict do nothing;

  return jsonb_build_object('id', _player_id, 'created', _created);
end;
$$;
revoke all on function public.add_player_to_club(uuid, text, boolean) from public;
grant execute on function public.add_player_to_club(uuid, text, boolean) to authenticated;

drop function if exists public.ensure_global_player(text, uuid);
create or replace function public.ensure_global_player(_name text, _club_id uuid default null, _new boolean default false)
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

  if not coalesce(_new, false) then
    select id into _player_id from public.players
      where lower(name) = lower(_clean) order by created_at limit 1;
    if _player_id is null then
      select player_id into _player_id from public.player_aliases where lower(alias) = lower(_clean) limit 1;
    end if;
  end if;
  if _player_id is null then
    insert into public.players (name, created_by, origin_club_id)
    values (_clean, auth.uid(), _club_id)
    returning id into _player_id;
  end if;
  return _player_id;
end;
$$;
revoke all on function public.ensure_global_player(text, uuid, boolean) from public;
grant execute on function public.ensure_global_player(text, uuid, boolean) to authenticated;

-- ------------------------------------------- 2. "Is this him?"
-- Everyone a typed name could be: that name, or a former one (alias).
create or replace function public.find_players_named(_name text, _club_id uuid default null)
returns table (
  id uuid,
  name text,
  nickname text,
  jersey_no integer,
  city text,
  photo text,
  claimed boolean,
  former_name boolean,
  origin_club text,
  on_roster boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.nickname, p.jersey_no, p.city, p.photo,
         p.claimed_by is not null,
         lower(p.name) <> lower(btrim(_name)),
         c.name,
         _club_id is not null and public.is_club_member(_club_id)
           and exists (select 1 from public.club_rosters r where r.club_id = _club_id and r.player_id = p.id),
         p.created_at
  from public.players p
  left join public.clubs c on c.id = p.origin_club_id
  where btrim(coalesce(_name, '')) <> ''
    and (lower(p.name) = lower(btrim(_name))
         or exists (select 1 from public.player_aliases a where a.player_id = p.id and lower(a.alias) = lower(btrim(_name))))
  order by p.created_at
  limit 20
$$;
revoke all on function public.find_players_named(text, uuid) from public;
grant execute on function public.find_players_named(text, uuid) to anon, authenticated;

-- ------------------------------------------- 3. who each name in a match is
-- An id a match may keep: a tournament visitor's "guest:<name>", or a player
-- who still exists (not a temp id, not a merged-away or deleted player).
create or replace function public._valid_player_ref(_ref text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(_ref, '') <> '' and _ref not like 'tmp:%'
     and (_ref like 'guest:%' or exists (select 1 from public.players p where p.id::text = _ref))
$$;
revoke all on function public._valid_player_ref(text) from public, anon, authenticated;

-- The names in a match (batting, bowling, fielding), not placeholders ("Bat ?1").
create or replace function public._match_labels(_data jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct x.who), '{}')
  from jsonb_array_elements(case when jsonb_typeof(_data -> 'innings') = 'array' then _data -> 'innings' else '[]'::jsonb end) i,
  lateral (
    select jsonb_array_elements_text(case when jsonb_typeof(i -> 'batting' -> 'order') = 'array' then i -> 'batting' -> 'order' else '[]'::jsonb end) as who
    union all
    select jsonb_array_elements_text(case when jsonb_typeof(i -> 'bowling' -> 'order') = 'array' then i -> 'bowling' -> 'order' else '[]'::jsonb end)
    union all
    select jsonb_array_elements_text(case when jsonb_typeof(i -> 'fielding' -> 'order') = 'array' then i -> 'fielding' -> 'order' else '[]'::jsonb end)
  ) x
  where btrim(x.who) <> '' and x.who !~* '^(bat|bowl) \?[0-9]+$'
$$;

-- The ids a match doesn't have yet, for every name that can be only one
-- player: { name: id }. That club's roster first (a name, or a former name);
-- else anyone on the platform (a friendly's visitor, a player since removed
-- from the roster); a tournament's visitors are "guest:<name>". Two players
-- for a name, or none: left out.
create or replace function public._match_label_ids(_club_id uuid, _data jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _have jsonb := case when jsonb_typeof(_data -> 'playerIds') = 'object' then _data -> 'playerIds' else '{}'::jsonb end;
  _guests text[];
  _l text;
  _k text;
  _ids uuid[];
  _out jsonb := '{}'::jsonb;
begin
  if _data is null or jsonb_typeof(_data) <> 'object' or coalesce(_data ->> 'anonymous', 'false') = 'true' then
    return _out;
  end if;
  select coalesce(array_agg(lower(btrim(g))), '{}') into _guests
    from jsonb_array_elements_text(case when jsonb_typeof(_data -> 'guestNames') = 'array' then _data -> 'guestNames' else '[]'::jsonb end) g;

  foreach _l in array public._match_labels(_data) loop
    continue when _have ? _l and public._valid_player_ref(_have ->> _l);
    _k := lower(btrim(_l));
    if _k = any(_guests) then
      _out := _out || jsonb_build_object(_l, 'guest:' || _k);
      continue;
    end if;
    _ids := null;
    if _club_id is not null then
      select array_agg(distinct p.id) into _ids
        from public.club_rosters r join public.players p on p.id = r.player_id
        where r.club_id = _club_id
          and (lower(p.name) = _k or exists (select 1 from public.player_aliases a where a.player_id = p.id and lower(a.alias) = _k));
    end if;
    if coalesce(array_length(_ids, 1), 0) = 0 then
      select array_agg(distinct p.id) into _ids
        from public.players p
        where lower(p.name) = _k or exists (select 1 from public.player_aliases a where a.player_id = p.id and lower(a.alias) = _k);
    end if;
    if array_length(_ids, 1) = 1 then
      _out := _out || jsonb_build_object(_l, _ids[1]::text);
    end if;
  end loop;
  return _out;
end;
$$;
revoke all on function public._match_labels(jsonb) from public, anon, authenticated;
revoke all on function public._match_label_ids(uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------- 4. every upload from now on
create or replace function public._matches_link_player_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ids jsonb;
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then return new; end if;
  -- A temp id (a club player added offline whose add hadn't synced), or the
  -- id of a player since merged away or deleted, never stays: that name is
  -- linked again below, by name.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into _ids
    from jsonb_each(case when jsonb_typeof(new.data -> 'playerIds') = 'object' then new.data -> 'playerIds' else '{}'::jsonb end) e
    where jsonb_typeof(e.value) = 'string' and public._valid_player_ref(e.value #>> '{}');
  _ids := _ids || public._match_label_ids(new.club_id, jsonb_set(new.data, '{playerIds}', _ids));
  if _ids <> '{}'::jsonb or new.data ? 'playerIds' then
    new.data := jsonb_set(new.data, '{playerIds}', _ids);
  end if;
  return new;
end;
$$;
revoke all on function public._matches_link_player_ids() from public, anon, authenticated;

drop trigger if exists matches_link_player_ids on public.matches;
create trigger matches_link_player_ids
  before insert or update of data on public.matches
  for each row execute function public._matches_link_player_ids();

-- Every match already in the cloud. Run as  select * from public.link_match_player_ids(false);
-- to see what it would do (nothing changes), then with true to write the ids.
create or replace function public.link_match_player_ids(_apply boolean default false)
returns table (
  match_id text,
  club text,
  played_at timestamptz,
  names_in_match integer,
  had_ids integer,
  newly_linked integer,
  left_unlinked text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  _labels text[];
  _add jsonb;
  _have jsonb;
begin
  for m in select x.id, x.club_id, x.data, x.played_at, c.name as club_name
             from public.matches x left join public.clubs c on c.id = x.club_id
             order by x.played_at nulls last, x.id loop
    -- a "no names" match's Batter 1 / Over 3 aren't people: nothing to link
    _labels := case when coalesce(m.data ->> 'anonymous', 'false') = 'true' then '{}'::text[] else public._match_labels(m.data) end;
    _have := case when jsonb_typeof(m.data -> 'playerIds') = 'object' then m.data -> 'playerIds' else '{}'::jsonb end;
    _add := public._match_label_ids(m.club_id, m.data);
    if _apply and _add <> '{}'::jsonb then
      update public.matches set data = jsonb_set(data, '{playerIds}', _have || _add) where id = m.id;
    end if;
    match_id := m.id;
    club := m.club_name;
    played_at := m.played_at;
    names_in_match := coalesce(array_length(_labels, 1), 0);
    had_ids := (select count(*) from unnest(_labels) l where _have ? l and public._valid_player_ref(_have ->> l));
    newly_linked := (select count(*) from jsonb_object_keys(_add));
    left_unlinked := (select coalesce(array_agg(l order by l), '{}') from unnest(_labels) l
                       where not (_have ? l and public._valid_player_ref(_have ->> l)) and not (_add ? l));
    return next;
  end loop;
end;
$$;
revoke all on function public.link_match_player_ids(boolean) from public, anon, authenticated;

-- ------------------------------------------- 5. a player's matches, by id
create or replace function public.player_matches(_player_id uuid)
returns table (
  id text,
  club_id uuid,
  club_name text,
  level text,
  match_type text,
  data jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with names as (
    select lower(p.name) as n from public.players_public p where p.id = _player_id
    union
    select lower(a.alias) from public.player_aliases a where a.player_id = _player_id
  )
  select m.id, m.club_id, c.name, m.level, m.match_type, m.data, m.created_at
  from public.matches m
  left join public.clubs c on c.id = m.club_id
  where coalesce(m.data ->> 'anonymous', 'false') <> 'true'
    and jsonb_typeof(m.data -> 'innings') = 'array'
    and (
      -- the match says it's them
      exists (
        select 1 from jsonb_each_text(case when jsonb_typeof(m.data -> 'playerIds') = 'object' then m.data -> 'playerIds' else '{}'::jsonb end) e
        where e.value = _player_id::text
      )
      -- before ids: their name (or a former one), where the match hasn't tied
      -- that name to anyone and no other player has it -- otherwise which of
      -- them it was can't be known, and it's nobody's.
      or exists (
        select 1 from unnest(public._match_labels(m.data)) l
        where lower(l) in (select n from names)
          and not (case when jsonb_typeof(m.data -> 'playerIds') = 'object' then m.data -> 'playerIds' else '{}'::jsonb end ? l)
          and not exists (select 1 from public.players_public o where lower(o.name) = lower(l) and o.id <> _player_id)
          and not exists (select 1 from public.player_aliases o where lower(o.alias) = lower(l) and o.player_id <> _player_id)
      )
    )
  order by m.created_at desc
$$;
-- _match_labels is internal, but this (security invoker) function needs it.
grant execute on function public._match_labels(jsonb) to anon, authenticated;
revoke all on function public.player_matches(uuid) from public;
grant execute on function public.player_matches(uuid) to anon, authenticated;

-- ------------------------------------------- 5b. merging keeps matches pointing at the survivor
-- 011's merge_player_rows, plus one step: matches that recorded the merged-away
-- profile's id now say the survivor's (else they'd point at a deleted player).
create or replace function public.merge_player_rows(_from uuid, _into uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _from_name text;
begin
  if _from = _into then raise exception 'cannot merge a profile into itself'; end if;
  select name into _from_name from public.players where id = _from and claimed_by is null;
  if _from_name is null then raise exception 'the profile to merge is gone or has been claimed'; end if;
  if not exists (select 1 from public.players where id = _into) then raise exception 'target profile not found'; end if;

  -- name (and any aliases it had) now point at the surviving profile
  update public.player_aliases set player_id = _into where player_id = _from;
  insert into public.player_aliases (player_id, alias) values (_into, _from_name)
    on conflict do nothing;

  -- club roster entries move over
  insert into public.club_rosters (club_id, player_id)
    select club_id, _into from public.club_rosters where player_id = _from
  on conflict do nothing;

  -- matches: the merged-away profile's id becomes the survivor's
  update public.matches m
     set data = jsonb_set(m.data, '{playerIds}', (
       select coalesce(jsonb_object_agg(e.key, case when e.value #>> '{}' = _from::text then to_jsonb(_into::text) else e.value end), '{}'::jsonb)
       from jsonb_each(m.data -> 'playerIds') e))
   where jsonb_typeof(m.data -> 'playerIds') = 'object'
     and exists (select 1 from jsonb_each_text(m.data -> 'playerIds') e where e.value = _from::text);

  -- fill blanks on the survivor from the merged profile
  update public.players t set
    phone        = coalesce(t.phone, f.phone),
    nic          = coalesce(t.nic, f.nic),
    batting_hand = coalesce(t.batting_hand, f.batting_hand),
    bowling_arm  = coalesce(t.bowling_arm, f.bowling_arm),
    bowling_type = coalesce(t.bowling_type, f.bowling_type),
    is_keeper    = t.is_keeper or f.is_keeper,
    city         = coalesce(t.city, f.city),
    photo        = coalesce(t.photo, f.photo),
    nickname     = coalesce(t.nickname, f.nickname),
    jersey_no    = coalesce(t.jersey_no, f.jersey_no)
  from public.players f
  where t.id = _into and f.id = _from;

  -- other pending requests about the merged profile are now moot
  update public.merge_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where status = 'pending' and from_player_id = _from;

  delete from public.players where id = _from;  -- cascades its roster rows / claim requests
end;
$$;
revoke all on function public.merge_player_rows(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------- 6. renaming to a name someone else has
create or replace function public.rename_player(_player_id uuid, _name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _clean text := regexp_replace(btrim(coalesce(_name, '')), '\s+', ' ', 'g');
  _old text;
  _clash text;
begin
  if not public.can_see_player_contact(_player_id) then
    raise exception 'not allowed to edit this player''s profile';
  end if;
  if char_length(_clean) not between 1 and 24 then
    raise exception 'name must be 1–24 characters';
  end if;

  select name into _old from public.players where id = _player_id for update;
  if _old is null then
    raise exception 'player not found';
  end if;
  if _clean = _old then
    return _old;
  end if;

  -- Serialise renames/creates that target the same name.
  perform pg_advisory_xact_lock(hashtext(lower(_clean)));

  -- Ids tell two players of one name apart, but a club picks players by name:
  -- refused only when someone on a roster this player is on has that name.
  select c.name into _clash
    from public.club_rosters mine
    join public.club_rosters theirs on theirs.club_id = mine.club_id and theirs.player_id <> _player_id
    join public.players p on p.id = theirs.player_id
    join public.clubs c on c.id = mine.club_id
    where mine.player_id = _player_id and lower(p.name) = lower(_clean)
    limit 1;
  if _clash is not null then
    raise exception 'another player in % is already called %', _clash, _clean;
  end if;

  -- Renaming back to an earlier name: it's the real name again, not an alias.
  delete from public.player_aliases where player_id = _player_id and lower(alias) = lower(_clean);
  -- A case/spacing-only fix isn't a different name, so no alias for it. (An
  -- alias another player already has isn't added: one alias, one player.)
  if lower(_old) <> lower(_clean) then
    insert into public.player_aliases (player_id, alias) values (_player_id, _old)
      on conflict do nothing;
  end if;

  update public.players set name = _clean where id = _player_id;

  update public.tournament_teams t
     set players = (
       select coalesce(jsonb_agg(
         case when e->>'id' = _player_id::text then jsonb_set(e, '{name}', to_jsonb(_clean)) else e end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(t.players) with ordinality as x(e, ord))
   where t.players @> jsonb_build_array(jsonb_build_object('id', _player_id::text));

  perform public.admin_log('player_rename', 'player', _player_id::text,
    jsonb_build_object('from', _old, 'to', _clean));

  return _clean;
end;
$$;
revoke all on function public.rename_player(uuid, text) from public;
grant execute on function public.rename_player(uuid, text) to authenticated;

-- ------------------------------------------- 8. the names left: linked by hand
-- Platform admins only (the admin portal's "Unlinked names"). Every name in a
-- match that isn't tied to a player -- two players of that name, or nobody --
-- with the players it could be (that name, or a former one).
create or replace function public.admin_unlinked_match_names()
returns table (match_id text, club text, played_at timestamptz, teams text, name text, candidates jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.id, c.name, m.played_at,
           coalesce(m.data ->> 'teamA', '?') || ' v ' || coalesce(m.data ->> 'teamB', '?'),
           l,
           coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'origin_club', oc.name,
                      'on_roster', exists (select 1 from public.club_rosters r where r.club_id = m.club_id and r.player_id = p.id))
                    order by p.created_at)
             from public.players p left join public.clubs oc on oc.id = p.origin_club_id
             where lower(p.name) = lower(btrim(l))
                or exists (select 1 from public.player_aliases a where a.player_id = p.id and lower(a.alias) = lower(btrim(l)))
           ), '[]'::jsonb)
    from public.matches m
    left join public.clubs c on c.id = m.club_id
    cross join lateral unnest(public._match_labels(m.data)) l
    where coalesce(m.data ->> 'anonymous', 'false') <> 'true'
      and not (case when jsonb_typeof(m.data -> 'playerIds') = 'object' then m.data -> 'playerIds' else '{}'::jsonb end ? l
               and public._valid_player_ref(m.data -> 'playerIds' ->> l))
    order by m.played_at desc nulls last, m.id, l;
end;
$$;
revoke all on function public.admin_unlinked_match_names() from public, anon;
grant execute on function public.admin_unlinked_match_names() to authenticated;

-- Ties `_name` in one match to a player (a reason is required; logged).
create or replace function public.admin_link_match_player(_match_id text, _name text, _player_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _data jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'a reason is required'; end if;
  select data into _data from public.matches where id = _match_id for update;
  if _data is null then raise exception 'match not found'; end if;
  if not (_name = any (public._match_labels(_data))) then raise exception '% doesn''t play in this match', _name; end if;
  if not exists (select 1 from public.players where id = _player_id) then raise exception 'player not found'; end if;
  update public.matches
     set data = jsonb_set(data, '{playerIds}',
       coalesce(case when jsonb_typeof(data -> 'playerIds') = 'object' then data -> 'playerIds' end, '{}'::jsonb)
       || jsonb_build_object(_name, _player_id::text))
   where id = _match_id;
  perform public.admin_log('match_link_player', 'match', _match_id,
    jsonb_build_object('name', _name, 'player_id', _player_id, 'reason', _reason));
end;
$$;
revoke all on function public.admin_link_match_player(text, text, uuid, text) from public, anon;
grant execute on function public.admin_link_match_player(text, text, uuid, text) to authenticated;
