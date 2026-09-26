-- Cricket.lk cloud schema — adding a player to a club roster also puts
-- them in the global (Premier) players table when they aren't there yet.
--
-- Why an RPC instead of the client doing insert-then-insert: the base
-- `players` table is deliberately not readable by ordinary users (only the
-- claimant or an admin, so `phone` can't leak — see 002_clubs.sql). The
-- client's `insert(...).select()` reads the new row back, which that read
-- policy blocks, so creating a brand-new global player failed for
-- non-admins. This function runs as its owner, so it can find-or-create
-- the player and add the roster row in one step, and it matches names
-- case-insensitively *exactly* (the old `ilike` treated % and _ in a name
-- as wildcards).
--
-- Run by hand in the Supabase SQL editor, after 004.

create or replace function public.add_player_to_club(_club_id uuid, _name text)
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
  if not public.is_club_member(_club_id) then
    raise exception 'not a member of this club';
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

  insert into public.club_rosters (club_id, player_id)
  values (_club_id, _player_id)
  on conflict do nothing;

  return _player_id;
end;
$$;

revoke all on function public.add_player_to_club(uuid, text) from public;
grant execute on function public.add_player_to_club(uuid, text) to authenticated;
