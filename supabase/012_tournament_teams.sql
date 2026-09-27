-- Cricket.lk cloud schema — tournament teams for club tournaments.
-- Run once in your Supabase project's SQL editor, after 011_admin_portal.sql.
--
-- A club tournament is usually the club splitting into two sides for a
-- day. Each side is saved here: a name plus the roster players picked for
-- it. Matches still store plain names (see CLAUDE.md); a team only pre-fills
-- match setup and tells the scorer which side a player is on.
--
-- Team lists say which of a club's players are playing, and club rosters are
-- members-only (002), so this table is members-only too, unlike the publicly
-- readable `tournaments` row it hangs off.

create table if not exists public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- Denormalized from tournaments.organizer_club_id so RLS is a single
  -- is_club_member() call; the policies below check it matches.
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  -- [{ "id": "<players.id>", "name": "<name at the time>" }, ...] -- the name
  -- is a snapshot so a team still reads right if someone leaves the roster.
  players jsonb not null default '[]'::jsonb check (jsonb_typeof(players) = 'array'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tournament_teams_tournament_idx on public.tournament_teams (tournament_id);
-- One name per tournament (standings group matches by team name).
create unique index if not exists tournament_teams_name_uniq on public.tournament_teams (tournament_id, lower(btrim(name)));

alter table public.tournament_teams enable row level security;

create policy "tournament_teams: members read" on public.tournament_teams
  for select using (public.is_club_member(club_id));

create policy "tournament_teams: members create" on public.tournament_teams
  for insert with check (
    public.is_club_member(club_id)
    and created_by = auth.uid()
    and exists (select 1 from public.tournaments t where t.id = tournament_id and t.organizer_club_id = club_id)
  );

create policy "tournament_teams: members update" on public.tournament_teams
  for update using (public.is_club_member(club_id))
  with check (
    public.is_club_member(club_id)
    and exists (select 1 from public.tournaments t where t.id = tournament_id and t.organizer_club_id = club_id)
  );

create policy "tournament_teams: members delete" on public.tournament_teams
  for delete using (public.is_club_member(club_id));

create or replace function public.tournament_teams_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tournament_teams_touch on public.tournament_teams;
create trigger tournament_teams_touch before update on public.tournament_teams
  for each row execute function public.tournament_teams_touch();
