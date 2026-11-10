-- 020: players can see the clubs they play for, read only.
--
-- A player whose profile is on a club's roster and who has claimed that
-- profile (009: a platform admin approved the claim) now sees the club in the
-- app the way a member does, but can't change anything. Until now only club
-- members (club_members, every one an owner/admin) could read a club's
-- roster, presets and tournament team lists, so a player who wasn't an admin
-- had no club at all.
--
-- What changes, and what doesn't:
--   - is_club_player(club): true when the caller's claimed profile is on that
--     club's roster.
--   - Three extra SELECT policies, for claimed players: club_rosters,
--     club_presets (the club's MVP points and conditions, so stats count the
--     way the club counts them) and tournament_teams (team lists). Policies
--     are permissive, so these only add reads; every INSERT/UPDATE/DELETE
--     policy still checks is_club_member, so a player can't write anything.
--   - club_members and club_invites stay members-only: a player doesn't see
--     who the club's admins are or who has been invited.
--   - my_player_clubs(): the clubs the caller plays for (as a claimed player)
--     but isn't a member of. The app lists them as "player" in My clubs and
--     Home's "Acting as".
-- Clubs, tournaments and matches were already public read (002/003).
-- Roster rows join players_public, so no contact number or NIC is exposed.
--
-- Run after 012 (tournament_teams). Safe to run twice. Without it the app works as before:
-- players see their own profile and matches (019) but no club.

create or replace function public.is_club_player(_club_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.club_rosters r
    join public.players p on p.id = r.player_id
    where r.club_id = _club_id
      and p.claimed_by = auth.uid()
  );
$$;

-- Policies run as the caller, so every role that can query these tables needs
-- to be able to run it (it's just false for anon: auth.uid() is null).
revoke all on function public.is_club_player(uuid) from public;
grant execute on function public.is_club_player(uuid) to anon, authenticated;

drop policy if exists "club_rosters: claimed players read" on public.club_rosters;
create policy "club_rosters: claimed players read" on public.club_rosters
  for select using (public.is_club_player(club_id));

drop policy if exists "club_presets: claimed players read" on public.club_presets;
create policy "club_presets: claimed players read" on public.club_presets
  for select using (public.is_club_player(club_id));

drop policy if exists "tournament_teams: claimed players read" on public.tournament_teams;
create policy "tournament_teams: claimed players read" on public.tournament_teams
  for select using (public.is_club_player(club_id));

create or replace function public.my_player_clubs()
returns table (id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct c.id, c.name
  from public.club_rosters r
  join public.players p on p.id = r.player_id
  join public.clubs c on c.id = r.club_id
  where p.claimed_by = auth.uid()
    and not exists (
      select 1 from public.club_members m
      where m.club_id = c.id and m.user_id = auth.uid()
    )
  order by c.name
$$;

revoke all on function public.my_player_clubs() from public;
grant execute on function public.my_player_clubs() to authenticated;
