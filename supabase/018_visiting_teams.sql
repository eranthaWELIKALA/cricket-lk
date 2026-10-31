-- Cricket.lk cloud schema — visiting teams in club tournaments.
-- Run once in your Supabase project's SQL editor, after 017_public_tournament_points.sql.
--
-- A club tournament doesn't have to be the club split in two: visitors can
-- come and play it too. A team saved with `visiting = true` is a visiting
-- team. Its own players are guests (`{ id: "guest:<name>", name, guest: true }`
-- in `players`, never a `players` row, never on the club roster), and it can
-- borrow club players (ordinary `{ id, name }` roster entries) -- these are
-- friendlies, so lending a visiting side a player or two is normal.
--
-- The flag only changes how the app treats the team (the builder adds typed
-- names as visitors, a visitor typed while scoring isn't stored in the club);
-- RLS is 012's, unchanged. Until this is run, the app saves club sides as
-- before and says a visiting team needs this file.

alter table public.tournament_teams
  add column if not exists visiting boolean not null default false;
