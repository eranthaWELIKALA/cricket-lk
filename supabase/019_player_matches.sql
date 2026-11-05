-- 019: a player's matches, from every club.
--
-- A player profile's stats and its Matches tab need every match the player
-- played in. Matches are public read (002), but club rosters are members-only,
-- so the app had no way to ask "which clubs is this player in?": a profile
-- opened from Premier only counted the clubs the *viewer* belongs to, and a
-- player who isn't a club member saw no club matches for themselves at all.
--
-- This searches the (already public) match data by name instead, the way the
-- app's playerCareer does: the player's name plus their aliases (renames and
-- merges, 009/013), case-insensitively, anywhere in an innings' batting order,
-- bowling order or fielding list. "No names" matches (data.anonymous) are
-- skipped, like in the app. Newest first.
--
-- Nothing private comes back. It's an ordinary SECURITY INVOKER function over
-- tables everyone can already read (players_public, player_aliases, matches,
-- clubs), so it returns only rows the caller could select themselves; it never
-- touches club_rosters. Like every name-based stat, two different people with
-- the same name are counted together.
--
-- Run after 009. Safe to run twice. Without it the app falls back to the old
-- behaviour (the viewer's own clubs' matches).

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
    and exists (
      select 1
      from jsonb_array_elements(m.data -> 'innings') i,
      lateral (
        select jsonb_array_elements_text(case when jsonb_typeof(i -> 'batting' -> 'order') = 'array' then i -> 'batting' -> 'order' else '[]'::jsonb end) as who
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(i -> 'bowling' -> 'order') = 'array' then i -> 'bowling' -> 'order' else '[]'::jsonb end)
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(i -> 'fielding' -> 'order') = 'array' then i -> 'fielding' -> 'order' else '[]'::jsonb end)
      ) x
      where lower(x.who) in (select n from names)
    )
  order by m.created_at desc
$$;

revoke all on function public.player_matches(uuid) from public;
grant execute on function public.player_matches(uuid) to anon, authenticated;
