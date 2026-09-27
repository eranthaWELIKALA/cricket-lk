-- Cricket.lk cloud schema — platform admin portal (admin.html).
--
-- Everything here is for PLATFORM admins (public.admin_users, 001), not club
-- admins. Every function checks public.is_admin() server-side; the portal's
-- own "are you an admin" check is only for showing the right screen.
--
-- What it adds:
--   * admin_audit_log — an append-only record of every admin action. Claim
--     and merge approvals/rejections (009's RPCs) are logged by triggers, so
--     those RPCs don't need redefining; the new admin RPCs below log directly.
--   * Read helpers the portal needs but ordinary RLS doesn't allow:
--     overview counts, user list (auth.users isn't exposed), user lookup by
--     id (for "who requested this claim"), club list with member counts
--     (club_members is members-only), platform admin list.
--   * Admin actions: grant/revoke platform admin, release a wrongly approved
--     claim, merge two profiles directly (no request needed — for de-duping
--     unclaimed profiles), delete an unclaimed profile, delete a match.
--     Deletes keep a copy of the deleted row in the audit log's `detail`.
--
-- The merge body is shared: merge_player_rows() is the one implementation,
-- and approve_merge (009) is redefined here to call it, so a direct admin
-- merge and an approved merge request can't drift apart.
--
-- Run by hand in the Supabase SQL editor, after 010.

-- ------------------------------------------------------------- audit log
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists "admin_audit_log: admin read" on public.admin_audit_log;
create policy "admin_audit_log: admin read" on public.admin_audit_log
  for select using (public.is_admin());
-- No insert/update/delete policies: rows are only written by the
-- SECURITY DEFINER functions below, and never edited or removed.

create or replace function public.admin_log(_action text, _target_type text, _target_id text, _detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), _action, _target_type, _target_id, coalesce(_detail, '{}'::jsonb));
$$;
revoke all on function public.admin_log(text, text, text, jsonb) from public, anon, authenticated;

-- Claim/merge reviews go through 009's RPCs; log their status changes here.
create or replace function public.log_request_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.admin_log(
      (case when tg_table_name = 'claim_requests' then 'claim_' else 'merge_' end) || new.status,
      tg_table_name, new.id::text,
      case when tg_table_name = 'claim_requests'
        then jsonb_build_object('player_id', to_jsonb(new) ->> 'player_id', 'requested_by', new.requested_by)
        else jsonb_build_object('from_player_id', to_jsonb(new) ->> 'from_player_id',
                                'into_player_id', to_jsonb(new) ->> 'into_player_id', 'requested_by', new.requested_by)
      end);
  end if;
  return new;
end;
$$;

drop trigger if exists claim_requests_review_log on public.claim_requests;
create trigger claim_requests_review_log after update on public.claim_requests
  for each row execute function public.log_request_review();
drop trigger if exists merge_requests_review_log on public.merge_requests;
create trigger merge_requests_review_log after update on public.merge_requests
  for each row execute function public.log_request_review();

-- ------------------------------------------------------------ overview
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'users',           (select count(*) from auth.users),
    'players',         (select count(*) from public.players),
    'claimed',         (select count(*) from public.players where claimed_by is not null),
    'clubs',           (select count(*) from public.clubs),
    'matches',         (select count(*) from public.matches),
    'premier_matches', (select count(*) from public.matches where level = 'premier'),
    'pending_claims',  (select count(*) from public.claim_requests where status = 'pending'),
    'pending_merges',  (select count(*) from public.merge_requests where status = 'pending'),
    'admins',          (select count(*) from public.admin_users)
  );
end;
$$;

-- --------------------------------------------------------------- users
-- Email is personal data: only ever returned to platform admins.
create or replace function public.admin_list_users(_search text default null, _limit integer default 200)
returns table (
  id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
  is_admin boolean, claimed_player_id uuid, claimed_player_name text, club_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  _q text := nullif(btrim(_search), '');
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select u.id, u.email::text, pr.display_name, u.created_at, u.last_sign_in_at,
           exists (select 1 from public.admin_users a where a.user_id = u.id),
           pl.id, pl.name,
           (select count(*) from public.club_members m where m.user_id = u.id)
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.players pl on pl.claimed_by = u.id
    where _q is null
       or position(lower(_q) in lower(coalesce(u.email, ''))) > 0
       or position(lower(_q) in lower(coalesce(pr.display_name, ''))) > 0
    order by u.created_at desc
    limit least(greatest(coalesce(_limit, 200), 1), 1000);
end;
$$;

-- Who requested a claim/merge: resolve a handful of user ids at once.
create or replace function public.admin_lookup_users(_ids uuid[])
returns table (id uuid, email text, display_name text, claimed_player_id uuid, claimed_player_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select u.id, u.email::text, pr.display_name, pl.id, pl.name
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.players pl on pl.claimed_by = u.id
    where u.id = any(_ids);
end;
$$;

-- -------------------------------------------------------------- admins
create or replace function public.admin_list_admins()
returns table (user_id uuid, email text, display_name text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select a.user_id, u.email::text, pr.display_name, a.created_at
    from public.admin_users a
    join auth.users u on u.id = a.user_id
    left join public.profiles pr on pr.id = a.user_id
    order by a.created_at;
end;
$$;

-- Returns 'ok' / 'not_found' / 'already_admin' / 'not_admin'. Refuses to
-- remove yourself (so an admin can't lock the platform out by accident);
-- another admin has to do it.
create or replace function public.admin_set_platform_admin(_email text, _grant boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select id into _uid from auth.users where lower(email) = lower(btrim(_email)) limit 1;
  if _uid is null then return 'not_found'; end if;

  if _grant then
    if exists (select 1 from public.admin_users where user_id = _uid) then return 'already_admin'; end if;
    insert into public.admin_users (user_id) values (_uid);
  else
    if _uid = auth.uid() then raise exception 'you cannot remove your own admin access'; end if;
    if not exists (select 1 from public.admin_users where user_id = _uid) then return 'not_admin'; end if;
    delete from public.admin_users where user_id = _uid;
  end if;

  perform public.admin_log(case when _grant then 'admin_grant' else 'admin_revoke' end,
                           'user', _uid::text, jsonb_build_object('email', btrim(_email)));
  return 'ok';
end;
$$;

-- --------------------------------------------------------------- clubs
create or replace function public.admin_list_clubs()
returns table (
  id uuid, name text, created_at timestamptz, created_by_email text,
  member_count bigint, roster_count bigint, match_count bigint, origin_player_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select c.id, c.name, c.created_at, u.email::text,
           (select count(*) from public.club_members m where m.club_id = c.id),
           (select count(*) from public.club_rosters r where r.club_id = c.id),
           (select count(*) from public.matches x where x.club_id = c.id),
           (select count(*) from public.players p where p.origin_club_id = c.id)
    from public.clubs c
    left join auth.users u on u.id = c.created_by
    order by c.name;
end;
$$;

create or replace function public.admin_club_members(_club_id uuid)
returns table (user_id uuid, email text, display_name text, role text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select m.user_id, u.email::text, pr.display_name, m.role, m.created_at
    from public.club_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles pr on pr.id = m.user_id
    where m.club_id = _club_id
    order by m.role desc, m.created_at;
end;
$$;

-- ------------------------------------------------------------- players
-- Undo a wrong claim approval: the profile goes back to unclaimed (and so
-- back under its origin club's management, per 009's rule). Contact/NIC are
-- left as they are; edit them separately if the claimant supplied them.
create or replace function public.admin_release_claim(_player_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _was uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'a reason is required'; end if;
  select claimed_by into _was from public.players where id = _player_id;
  if _was is null then raise exception 'that profile is not claimed'; end if;

  update public.players set claimed_by = null where id = _player_id;
  perform public.admin_log('claim_released', 'player', _player_id::text,
                           jsonb_build_object('was_claimed_by', _was, 'reason', btrim(_reason)));
end;
$$;

-- The one implementation of "fold profile _from into _into" (see header).
-- Not callable by clients; only approve_merge and admin_merge_players use it.
create or replace function public.merge_player_rows(_from uuid, _into uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _from_name text;
begin
  if _from = _into then raise exception 'cannot merge a profile into itself'; end if;
  select name into _from_name from public.players where id = _from and claimed_by is null;
  if _from_name is null then raise exception 'the profile to merge is gone or has been claimed'; end if;
  if not exists (select 1 from public.players where id = _into) then raise exception 'target profile not found'; end if;

  -- name (and any aliases it had) now point at the surviving profile
  update public.player_aliases set player_id = _into where player_id = _from;
  insert into public.player_aliases (player_id, alias) values (_into, _from_name)
    on conflict do nothing;

  -- club roster entries move over
  insert into public.club_rosters (club_id, player_id)
    select club_id, _into from public.club_rosters where player_id = _from
  on conflict do nothing;

  -- fill blanks on the survivor from the merged profile
  update public.players t set
    phone        = coalesce(t.phone, f.phone),
    nic          = coalesce(t.nic, f.nic),
    batting_hand = coalesce(t.batting_hand, f.batting_hand),
    bowling_arm  = coalesce(t.bowling_arm, f.bowling_arm),
    bowling_type = coalesce(t.bowling_type, f.bowling_type),
    is_keeper    = t.is_keeper or f.is_keeper,
    city         = coalesce(t.city, f.city),
    photo        = coalesce(t.photo, f.photo),
    nickname     = coalesce(t.nickname, f.nickname),
    jersey_no    = coalesce(t.jersey_no, f.jersey_no)
  from public.players f
  where t.id = _into and f.id = _from;

  -- other pending requests about the merged profile are now moot
  update public.merge_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where status = 'pending' and from_player_id = _from;

  delete from public.players where id = _from;  -- cascades its roster rows / claim requests
end;
$$;
revoke all on function public.merge_player_rows(uuid, uuid) from public, anon, authenticated;

-- Same signature and checks as 009; the body now lives in merge_player_rows.
create or replace function public.approve_merge(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _from uuid;
  _into uuid;
  _by uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select from_player_id, into_player_id, requested_by
    into _from, _into, _by
    from public.merge_requests where id = _request_id and status = 'pending';
  if _from is null then raise exception 'no such pending request'; end if;

  if not exists (select 1 from public.players where id = _into and claimed_by = _by) then
    raise exception 'the requester no longer owns the target profile';
  end if;

  -- mark approved first, so merge_player_rows' "reject the other pending
  -- requests about this profile" step doesn't also catch this one
  update public.merge_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id;

  perform public.merge_player_rows(_from, _into);
end;
$$;

-- Admin-initiated merge (e.g. two unclaimed spellings of one person). The
-- merged-away profile must be unclaimed; the survivor may be either.
create or replace function public.admin_merge_players(_from uuid, _into uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _names jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'a reason is required'; end if;
  select jsonb_build_object('from_name', (select name from public.players where id = _from),
                            'into_name', (select name from public.players where id = _into))
    into _names;

  perform public.merge_player_rows(_from, _into);
  perform public.admin_log('merge_direct', 'player', _into::text,
                           _names || jsonb_build_object('from_player_id', _from, 'reason', btrim(_reason)));
end;
$$;

-- Delete a junk/duplicate UNCLAIMED profile. Matches store names, not ids,
-- so no match stats are lost. The row (minus the photo) is kept in the
-- audit log -- note that includes contact/NIC if set; the log is admin-only.
create or replace function public.admin_delete_player(_player_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _row jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'a reason is required'; end if;
  select to_jsonb(p) - 'photo' into _row from public.players p where id = _player_id;
  if _row is null then raise exception 'player not found'; end if;
  if _row ->> 'claimed_by' is not null then
    raise exception 'that profile is claimed — release the claim first';
  end if;

  delete from public.players where id = _player_id;
  perform public.admin_log('player_deleted', 'player', _player_id::text,
                           jsonb_build_object('reason', btrim(_reason), 'row', _row));
end;
$$;

-- ------------------------------------------------------------- matches
-- The full match row is kept in the audit log so a mistaken delete can be
-- restored by hand (insert the logged row back into public.matches).
create or replace function public.admin_delete_match(_match_id text, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _row jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'a reason is required'; end if;
  select to_jsonb(m) into _row from public.matches m where id = _match_id;
  if _row is null then raise exception 'match not found'; end if;

  delete from public.matches where id = _match_id;
  perform public.admin_log('match_deleted', 'match', _match_id,
                           jsonb_build_object('reason', btrim(_reason), 'row', _row));
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.admin_overview() from public;
revoke all on function public.admin_list_users(text, integer) from public;
revoke all on function public.admin_lookup_users(uuid[]) from public;
revoke all on function public.admin_list_admins() from public;
revoke all on function public.admin_set_platform_admin(text, boolean) from public;
revoke all on function public.admin_list_clubs() from public;
revoke all on function public.admin_club_members(uuid) from public;
revoke all on function public.admin_release_claim(uuid, text) from public;
revoke all on function public.approve_merge(uuid) from public;
revoke all on function public.admin_merge_players(uuid, uuid, text) from public;
revoke all on function public.admin_delete_player(uuid, text) from public;
revoke all on function public.admin_delete_match(text, text) from public;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_users(text, integer) to authenticated;
grant execute on function public.admin_lookup_users(uuid[]) to authenticated;
grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_set_platform_admin(text, boolean) to authenticated;
grant execute on function public.admin_list_clubs() to authenticated;
grant execute on function public.admin_club_members(uuid) to authenticated;
grant execute on function public.admin_release_claim(uuid, text) to authenticated;
grant execute on function public.approve_merge(uuid) to authenticated;
grant execute on function public.admin_merge_players(uuid, uuid, text) to authenticated;
grant execute on function public.admin_delete_player(uuid, text) to authenticated;
grant execute on function public.admin_delete_match(text, text) to authenticated;
