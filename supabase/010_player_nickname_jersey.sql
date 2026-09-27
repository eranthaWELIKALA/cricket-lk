-- Cricket.lk cloud schema — nickname and jersey number on a player profile.
--
-- Both are PUBLIC (like 008's details): they're added to players_public.
-- Editing uses the same manage rule as every other profile field
-- (can_see_player_contact, as redefined in 009: the claimant, a platform
-- admin, or -- only while unclaimed -- a member of the club that added the
-- player).
--
-- The jersey number lives on the player's (global) profile, not per club,
-- and is not unique: two players on one roster may share a number.
--
-- Removing a player from a club roster needs no new SQL: the existing
-- "club_rosters: members remove" policy (002) already lets any club member
-- (every member is an owner or admin) delete a roster row for their club.
--
-- Run by hand in the Supabase SQL editor, after 009.

alter table public.players
  add column if not exists nickname text
    check (nickname is null or char_length(nickname) between 1 and 24),
  add column if not exists jersey_no smallint
    check (jersey_no is null or jersey_no between 0 and 999);

-- New columns go at the end so this stays a valid CREATE OR REPLACE.
create or replace view public.players_public as
  select id, name, claimed_by, created_at,
         batting_hand, bowling_arm, bowling_type, is_keeper, city, photo,
         nickname, jersey_no
  from public.players;

grant select on public.players_public to anon, authenticated;

create or replace function public.update_player_nickname_jersey(
  _player_id uuid,
  _nickname text,
  _jersey_no integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_see_player_contact(_player_id) then
    raise exception 'not allowed to edit this player''s profile';
  end if;

  update public.players set
    nickname  = nullif(btrim(_nickname), ''),
    jersey_no = _jersey_no          -- range enforced by the column check
  where id = _player_id;
end;
$$;

revoke all on function public.update_player_nickname_jersey(uuid, text, integer) from public;
grant execute on function public.update_player_nickname_jersey(uuid, text, integer) to authenticated;
