-- Cricket.lk cloud schema — Premier screen support + player claiming.
-- Run once in your Supabase project's SQL editor, after 003_local_tournaments.sql.
--
-- Two things:
-- 1. "PREMIER" is reserved as a dropdown entry in the Home club switcher
--    (navigates to a cross-club players/stats screen, not a club), so a
--    real club can never be named that -- enforced here, not just in the
--    client, so it holds even against a direct API call.
-- 2. claim_requests + approve/reject RPCs: the minimal, real half of
--    Milestone 3 (player identity/claiming) -- a player can request "this
--    is me", a platform admin (admin_users, from 001_accounts.sql)
--    approves or rejects it. Phone-number-change tickets are not part of
--    this file; they can reuse the same request/approve shape later.

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'clubs_name_not_reserved'
  ) then
    alter table public.clubs
      add constraint clubs_name_not_reserved check (lower(trim(name)) <> 'premier');
  end if;
end $$;

create table if not exists public.claim_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  claimed_phone text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.claim_requests enable row level security;

create policy "claim_requests: own or admin read" on public.claim_requests
  for select using (requested_by = auth.uid() or public.is_admin());

create policy "claim_requests: authenticated create" on public.claim_requests
  for insert with check (requested_by = auth.uid());

-- No direct UPDATE policy -- approval/rejection only through the RPCs
-- below, which enforce public.is_admin() server-side.

create or replace function public.approve_claim(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _player_id uuid;
  _requested_by uuid;
  _phone text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select player_id, requested_by, claimed_phone
    into _player_id, _requested_by, _phone
    from public.claim_requests where id = _request_id and status = 'pending';

  if _player_id is null then
    raise exception 'no such pending request';
  end if;

  update public.players
    set claimed_by = _requested_by, phone = coalesce(_phone, phone)
    where id = _player_id;

  update public.claim_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id;
end;
$$;

create or replace function public.reject_claim(_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  update public.claim_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = _request_id and status = 'pending';
end;
$$;
