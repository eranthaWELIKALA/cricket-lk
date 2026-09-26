-- Cricket.lk cloud schema — player profiles: name, contact number, NIC, stats.
--
-- Name and stats are public (players_public + the matches themselves). A
-- contact number and NIC are personal data, so they are NOT in the public
-- view and can only be seen or edited by:
--   * the player themself (players.claimed_by = the caller),
--   * a platform admin, or
--   * a member of any club that has the player on its roster.
-- Everyone else gets NULLs back from get_player_profile. All access goes
-- through the SECURITY DEFINER functions below; the base table's read
-- policy (002) is unchanged, so phone/nic still can't leak via a plain select.
--
-- Run by hand in the Supabase SQL editor, after 006.

alter table public.players add column if not exists nic text;

-- Sri Lankan NIC: old format 9 digits + V/X, new format 12 digits. Stored
-- upper-case, no spaces (update_player_profile normalises before saving).
alter table public.players drop constraint if exists players_nic_format;
alter table public.players add constraint players_nic_format
  check (nic is null or nic ~ '^([0-9]{9}[VX]|[0-9]{12})$');

create or replace function public.can_see_player_contact(_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.players p where p.id = _player_id and p.claimed_by = auth.uid())
    or exists (
      select 1 from public.club_rosters r
      where r.player_id = _player_id and public.is_club_member(r.club_id)
    )
  );
$$;

create or replace function public.get_player_profile(_player_id uuid)
returns table (
  id uuid, name text, claimed_by uuid,
  phone text, nic text, can_see_contact boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  _see boolean := public.can_see_player_contact(_player_id);
begin
  return query
    select p.id, p.name, p.claimed_by,
           case when _see then p.phone end,
           case when _see then p.nic end,
           _see
    from public.players p
    where p.id = _player_id;
end;
$$;

create or replace function public.update_player_profile(_player_id uuid, _phone text, _nic text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _p text := nullif(btrim(_phone), '');
  _n text := upper(nullif(regexp_replace(coalesce(_nic, ''), '\s', '', 'g'), ''));
begin
  if not public.can_see_player_contact(_player_id) then
    raise exception 'not allowed to edit this player''s profile';
  end if;
  if _p is not null and _p !~ '^\+?[0-9 ]{7,15}$' then
    raise exception 'invalid contact number';
  end if;
  if _n is not null and _n !~ '^([0-9]{9}[VX]|[0-9]{12})$' then
    raise exception 'invalid NIC';
  end if;

  update public.players set phone = _p, nic = _n where id = _player_id;
end;
$$;

revoke all on function public.can_see_player_contact(uuid) from public;
revoke all on function public.get_player_profile(uuid) from public;
revoke all on function public.update_player_profile(uuid, text, text) from public;
grant execute on function public.can_see_player_contact(uuid) to authenticated;
grant execute on function public.get_player_profile(uuid) to authenticated;
grant execute on function public.update_player_profile(uuid, text, text) to authenticated;
