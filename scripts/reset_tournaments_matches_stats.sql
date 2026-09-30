-- Cricket.lk: one-off data reset (NOT a numbered migration; run by hand in
-- the Supabase SQL editor as the project owner).
--
-- Empties:  tournaments, tournament_teams (cascade), matches.
-- Player stats have no table of their own; careers, leaderboards and
-- standings are computed from matches.data, so emptying matches resets them.
--
-- Leaves untouched: profiles, admin_users, clubs, club_members, players
-- (incl. phone/NIC/details), club_rosters, club_presets, player_aliases,
-- claim_requests, merge_requests, admin_audit_log.
--
-- Can't be undone. Back up first, for example:
--   create table public.bak_matches     as table public.matches;
--   create table public.bak_tournaments as table public.tournaments;
--   create table public.bak_tournament_teams as table public.tournament_teams;

begin;

-- Counts before the reset, for the record.
select
  (select count(*) from public.matches)          as matches,
  (select count(*) from public.tournaments)      as tournaments,
  (select count(*) from public.tournament_teams) as tournament_teams;

-- Matches first: matches.tournament_id references tournaments (003).
delete from public.matches;
-- tournament_teams rows go with their tournament (on delete cascade, 012).
delete from public.tournaments;

-- Should be all zeros.
select
  (select count(*) from public.matches)          as matches,
  (select count(*) from public.tournaments)      as tournaments,
  (select count(*) from public.tournament_teams) as tournament_teams;

commit;
