-- Cricket.lk cloud schema — Milestone 2 (cont.): Local-tier tournaments.
-- Run once in your Supabase project's SQL editor, after 002_clubs.sql.
--
-- Use case this unlocks: a club that plays regularly (e.g. every Tuesday
-- and Sunday), splits into two ad hoc teams each session, and wants that
-- session's matches grouped and counted as one tournament -- without any
-- external registration, and without a persistent "team" entity (the
-- split can be different every time; see CLAUDE.md's note on why
-- Local-tier matches deliberately have no synced team).

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organizer_club_id uuid not null references public.clubs(id) on delete cascade,
  level text not null default 'local' check (level in ('local', 'premier')),
  tournament_preset jsonb not null default '{}'::jsonb, -- points for win/tie/loss, useNRR -- same shape as the local app's tournamentPresets entries
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.tournaments enable row level security;

create policy "tournaments: public read" on public.tournaments
  for select using (true);

create policy "tournaments: club members create" on public.tournaments
  for insert with check (public.is_club_member(organizer_club_id) and created_by = auth.uid());

create policy "tournaments: club members update" on public.tournaments
  for update using (public.is_club_member(organizer_club_id));

-- matches.tournament_id (added in 002_clubs.sql) had no FK yet since
-- `tournaments` didn't exist then -- add it now.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'matches_tournament_id_fkey'
  ) then
    alter table public.matches
      add constraint matches_tournament_id_fkey foreign key (tournament_id) references public.tournaments(id);
  end if;
end $$;
