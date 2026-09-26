-- Cricket.lk cloud schema — ensure a player exists in the global (Premier)
-- players table WITHOUT putting them on any club's roster.
--
-- Used for a friendly match's visiting team: those players are real,
-- globally-known players (and can later be on their own club's roster, or
-- several clubs' rosters), but they aren't members of the *home* club that
-- happens to be scoring the match. add_player_to_club (005) is for the
-- club's own side; this is for everyone else.
--
-- Same reasoning as 005: the base players table isn't readable by ordinary
-- users, so the client can't do find-or-insert itself. Exact,
-- case-insensitive name match. Run by hand in the Supabase SQL editor,
-- after 005.

create or replace function public.ensure_global_player(_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _clean text := btrim(_name);
  _player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if _clean is null or _clean = '' then
    raise exception 'player name is required';
  end if;

  select id into _player_id
  from public.players
  where lower(name) = lower(_clean)
  order by created_at
  limit 1;

  if _player_id is null then
    insert into public.players (name, created_by)
    values (_clean, auth.uid())
    returning id into _player_id;
  end if;

  return _player_id;
end;
$$;

revoke all on function public.ensure_global_player(text) from public;
grant execute on function public.ensure_global_player(text) to authenticated;
