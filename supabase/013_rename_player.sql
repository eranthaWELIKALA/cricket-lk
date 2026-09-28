-- 013: rename a player profile.
--
-- Who: the same manage rule as every other profile edit (009's
-- can_see_player_contact) -- a platform admin, the player who claimed the
-- profile, or, only while it's unclaimed, a member of the club that first
-- added the player.
--
-- Matches store players by NAME (matches.data), not id, and are never
-- rewritten -- a scorecard keeps the name it was scored with. So a rename
-- keeps the old name as an alias in player_aliases (009), exactly like a
-- merge does: the profile folds [name, ...aliases] into its stats, and
-- add_player_to_club / ensure_global_player resolve a typed old name to this
-- player instead of creating a new one.
--
-- Requires 009 (player_aliases, can_see_player_contact), 011 (admin_log)
-- and 012 (tournament_teams). Run in the Supabase SQL editor.

create or replace function public.rename_player(_player_id uuid, _name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _clean text := regexp_replace(btrim(coalesce(_name, '')), '\s+', ' ', 'g');
  _old text;
begin
  if not public.can_see_player_contact(_player_id) then
    raise exception 'not allowed to edit this player''s profile';
  end if;
  if char_length(_clean) not between 1 and 24 then
    raise exception 'name must be 1–24 characters';
  end if;

  select name into _old from public.players where id = _player_id for update;
  if _old is null then
    raise exception 'player not found';
  end if;
  if _clean = _old then
    return _old;
  end if;

  -- Serialise renames/creates that target the same name.
  perform pg_advisory_xact_lock(hashtext(lower(_clean)));

  -- Names aren't unique by constraint, but every name lookup (roster add,
  -- visitors, alias resolution) picks one player per name -- so a rename
  -- must not create an ambiguous name.
  if exists (select 1 from public.players where lower(name) = lower(_clean) and id <> _player_id) then
    raise exception 'another player is already called %', _clean;
  end if;
  if exists (select 1 from public.player_aliases where lower(alias) = lower(_clean) and player_id <> _player_id) then
    raise exception '% is a former name of another player', _clean;
  end if;

  -- Renaming back to an earlier name: it's the real name again, not an alias.
  delete from public.player_aliases where player_id = _player_id and lower(alias) = lower(_clean);
  -- A case/spacing-only fix isn't a different name, so no alias for it.
  if lower(_old) <> lower(_clean) then
    insert into public.player_aliases (player_id, alias) values (_player_id, _old)
      on conflict do nothing;
  end if;

  update public.players set name = _clean where id = _player_id;

  -- Saved tournament teams snapshot {id, name}; keep them in step so the
  -- team builder and new matches use the new name.
  update public.tournament_teams t
     set players = (
       select coalesce(jsonb_agg(
         case when e->>'id' = _player_id::text then jsonb_set(e, '{name}', to_jsonb(_clean)) else e end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(t.players) with ordinality as x(e, ord))
   where t.players @> jsonb_build_array(jsonb_build_object('id', _player_id::text));

  -- Audit trail (admin-only read), whoever did it.
  perform public.admin_log('player_rename', 'player', _player_id::text,
    jsonb_build_object('from', _old, 'to', _clean));

  return _clean;
end;
$$;

revoke all on function public.rename_player(uuid, text) from public;
grant execute on function public.rename_player(uuid, text) to authenticated;
