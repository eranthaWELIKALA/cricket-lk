-- 017: MVP points for a tournament's public page.
--
-- A club tournament can be shared as a link (#/t/<tournament id>) that anyone
-- can open, signed in or not: the points table, results, scorecards and
-- player stats. Almost all of that is already public -- tournaments, clubs and
-- matches are public read (002/003). The one missing piece is the club's MVP
-- points preset: club_presets is members-only, so a visitor couldn't count
-- MVP points the way the club does.
--
-- Rather than opening club_presets up, this returns just the one preset that
-- counts the tournament's stats -- the organizing club's points preset marked
-- "inUse", else its first (by created_at), the same pick the app makes for
-- members (clubPointsPreset) -- with its row id merged in. NULL when the club
-- has none of its own (the app then uses its built-in default, as it does for
-- members). Points presets are scoring config only: no names, no contact data.
--
-- Run after 016. Safe to run twice. Without it the public page still works,
-- it just leaves the MVP table out.

create or replace function public.tournament_points_preset(_tournament_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select cp.preset || jsonb_build_object('id', cp.id)
  from public.tournaments t
  join public.club_presets cp on cp.club_id = t.organizer_club_id and cp.kind = 'points'
  where t.id = _tournament_id
  order by coalesce(cp.preset -> 'inUse' = 'true'::jsonb, false) desc, cp.created_at
  limit 1
$$;

revoke all on function public.tournament_points_preset(uuid) from public;
grant execute on function public.tournament_points_preset(uuid) to anon, authenticated;
