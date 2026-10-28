-- 015: a deleted match stays deleted.
--
-- A match deleted in the cloud (the admin portal's Delete, or by hand in the
-- SQL editor) was still in the archive of the phone that scored it, and club
-- lists merge that archive in -- so it kept showing, and counting, there, and
-- editing it could even upload it again. Now every deleted match leaves its id
-- here (a trigger, so however it's deleted), and:
-- - the scorer drops a club's deleted matches from its own archive whenever it
--   loads the club (fetchClubDetail -> forgetDeletedMatches);
-- - a trigger skips any insert of a deleted id, so a stale queued upload can't
--   bring it back (the client sees success and moves on).
-- Ids and the club only. Public read, like matches themselves; no write
-- policies -- rows only come from the trigger (or the SQL editor).

create table if not exists public.deleted_matches (
  id text primary key,
  club_id uuid,
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_matches_club_idx on public.deleted_matches (club_id);

alter table public.deleted_matches enable row level security;
drop policy if exists "deleted_matches: public read" on public.deleted_matches;
create policy "deleted_matches: public read" on public.deleted_matches
  for select using (true);

-- Every delete of a match is recorded, however it's done.
create or replace function public.matches_note_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deleted_matches (id, club_id) values (old.id, old.club_id)
  on conflict (id) do nothing;
  return old;
end;
$$;
drop trigger if exists matches_note_deleted on public.matches;
create trigger matches_note_deleted after delete on public.matches
  for each row execute function public.matches_note_deleted();

-- A deleted match can't come back: inserting its id again is skipped.
create or replace function public.matches_block_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.deleted_matches where id = new.id) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists matches_block_deleted on public.matches;
create trigger matches_block_deleted before insert on public.matches
  for each row execute function public.matches_block_deleted();

revoke all on function public.matches_note_deleted() from public;
revoke all on function public.matches_block_deleted() from public;
