-- Cricket.lk cloud schema — optional player details: batting hand, bowling
-- arm + style, wicket-keeper, city, photo.
--
-- Unlike contact number / NIC (007) these are NOT sensitive, so they are
-- public: they're added to players_public. Editing uses the same permission
-- as the contact details (the player themself, a platform admin, or a member
-- of a club that has the player on its roster) via can_see_player_contact().
--
-- The photo is stored inline as a small data-URL JPEG (the app resizes to
-- ~240px before saving), which avoids needing a storage bucket. The length
-- check below keeps a row from carrying anything large.
--
-- Run by hand in the Supabase SQL editor, after 007.

alter table public.players
  add column if not exists batting_hand text
    check (batting_hand is null or batting_hand in ('right', 'left')),
  add column if not exists bowling_arm text
    check (bowling_arm is null or bowling_arm in ('right', 'left')),
  add column if not exists bowling_type text
    check (bowling_type is null or bowling_type in ('fast', 'medium', 'off-spin', 'leg-spin', 'orthodox')),
  add column if not exists is_keeper boolean not null default false,
  add column if not exists city text
    check (city is null or char_length(city) <= 40),
  add column if not exists photo text
    check (photo is null or (photo like 'data:image/%' and length(photo) <= 80000));

-- New columns go at the end so this stays a valid CREATE OR REPLACE.
create or replace view public.players_public as
  select id, name, claimed_by, created_at,
         batting_hand, bowling_arm, bowling_type, is_keeper, city, photo
  from public.players;

grant select on public.players_public to anon, authenticated;

create or replace function public.update_player_details(
  _player_id uuid,
  _batting_hand text,
  _bowling_arm text,
  _bowling_type text,
  _is_keeper boolean,
  _city text,
  _photo text
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
    batting_hand = nullif(btrim(_batting_hand), ''),
    bowling_arm  = nullif(btrim(_bowling_arm), ''),
    bowling_type = nullif(btrim(_bowling_type), ''),
    is_keeper    = coalesce(_is_keeper, false),
    city         = nullif(btrim(_city), ''),
    photo        = nullif(_photo, '')
  where id = _player_id;
end;
$$;

revoke all on function public.update_player_details(uuid, text, text, text, boolean, text, text) from public;
grant execute on function public.update_player_details(uuid, text, text, text, boolean, text, text) to authenticated;
