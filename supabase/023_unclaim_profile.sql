-- 023: a player can unclaim their own profile, and withdraw a claim or merge
-- request that's still waiting for approval.
--
-- Until now only a platform admin could release a claim (011's
-- admin_release_claim). These let the player do it from the app:
--
--   - release_my_claim(_remove_contact): the caller's claimed profile goes
--     back to unclaimed, so (009's rule) the club that first added the player
--     can manage it again, and 020's read-only club access ends. With
--     _remove_contact the contact number and NIC are cleared first, so the
--     club isn't handed personal data the player gave when claiming. The
--     caller's pending merge requests into it are withdrawn (approve_merge
--     would refuse them now anyway). Aliases stay: they're the profile's
--     names, not the claimant's. Logged as 'claim_released_by_player'.
--   - withdraw_my_request(_kind, _request_id): deletes the caller's own
--     pending claim ('claim') or merge ('merge') request. Logged as
--     'claim_withdrawn' / 'merge_withdrawn'. A deleted row, not a new status:
--     the status check and 011's review log (approved/rejected) stay as they
--     are, and 021 sends no email for a delete.
--
-- Safe to run twice. Without it the app says to run this file when the
-- buttons are used.

create or replace function public.release_my_claim(_remove_contact boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _pid uuid;
begin
  if _uid is null then raise exception 'not signed in'; end if;
  select id into _pid from public.players where claimed_by = _uid;
  if _pid is null then raise exception 'You have no claimed profile.'; end if;

  delete from public.merge_requests
    where requested_by = _uid and into_player_id = _pid and status = 'pending';

  update public.players set
    claimed_by = null,
    phone = case when coalesce(_remove_contact, false) then null else phone end,
    nic   = case when coalesce(_remove_contact, false) then null else nic end
  where id = _pid;

  perform public.admin_log('claim_released_by_player', 'player', _pid::text,
    jsonb_build_object('was_claimed_by', _uid, 'removed_contact', coalesce(_remove_contact, false)));
end;
$$;

create or replace function public.withdraw_my_request(_kind text, _request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _n integer;
begin
  if _uid is null then raise exception 'not signed in'; end if;
  if _kind = 'claim' then
    delete from public.claim_requests
      where id = _request_id and requested_by = _uid and status = 'pending';
  elsif _kind = 'merge' then
    delete from public.merge_requests
      where id = _request_id and requested_by = _uid and status = 'pending';
  else
    raise exception 'unknown request kind';
  end if;
  get diagnostics _n = row_count;
  if _n = 0 then raise exception 'That request is no longer waiting for approval.'; end if;

  perform public.admin_log(_kind || '_withdrawn', _kind || '_requests', _request_id::text,
    jsonb_build_object('requested_by', _uid));
end;
$$;

revoke all on function public.release_my_claim(boolean) from public, anon;
revoke all on function public.withdraw_my_request(text, uuid) from public, anon;
grant execute on function public.release_my_claim(boolean) to authenticated;
grant execute on function public.withdraw_my_request(text, uuid) to authenticated;
