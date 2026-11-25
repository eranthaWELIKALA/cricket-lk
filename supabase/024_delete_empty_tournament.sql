-- 024: a club admin can delete a club tournament that has no matches.
--
-- A tournament made by mistake (a double tap left two "Tue Nov 10 2026",
-- one of them empty) used to need SQL to remove. Now the tournament
-- dashboard's Overview offers "Delete tournament" to the club's admins while
-- the tournament has no matches; this function is the rule behind it:
--   * only an owner/admin of the organizing club (a player who only plays for
--     the club, supabase/020, can't);
--   * only while no match in the cloud belongs to it -- a tournament with
--     even one match (scored or result only) stays;
--   * its saved teams (tournament_teams, 012) go with it (on delete cascade);
--   * the row and its teams are kept in admin_audit_log (011), like
--     admin_delete_match keeps a deleted match, so it can be put back by hand.
-- Returns 'deleted', or 'not_found' when it's already gone (a retry).
--
-- Requires 002/003 (clubs, tournaments, matches), 011 (admin_log) and 012.
-- Run once in the Supabase SQL editor; safe to run again.

create or replace function public.delete_club_tournament(_tournament_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tournaments;
  n int;
begin
  select * into t from public.tournaments where id = _tournament_id for update;
  if not found then return 'not_found'; end if;

  if not exists (
    select 1 from public.club_members m
    where m.club_id = t.organizer_club_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    raise exception 'Only an admin of this club can delete its tournaments.' using errcode = '42501';
  end if;

  select count(*) into n from public.matches where tournament_id = _tournament_id;
  if n > 0 then
    raise exception 'This tournament has % match%, so it can''t be deleted.', n, case when n = 1 then '' else 'es' end
      using errcode = 'P0001';
  end if;

  perform public.admin_log('tournament_delete', 'tournament', t.id::text, jsonb_build_object(
    'club_id', t.organizer_club_id,
    'row', to_jsonb(t),
    'teams', coalesce((select jsonb_agg(to_jsonb(x)) from public.tournament_teams x where x.tournament_id = t.id), '[]'::jsonb)
  ));

  delete from public.tournaments where id = _tournament_id;   -- its tournament_teams go with it
  return 'deleted';
end;
$$;

revoke all on function public.delete_club_tournament(uuid) from public, anon;
grant execute on function public.delete_club_tournament(uuid) to authenticated;
