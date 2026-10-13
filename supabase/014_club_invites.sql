-- 014: pending club-admin invites.
--
-- invite_club_admin (002) could only add someone who already had an account,
-- so inviting a new person meant: they sign up, wait for the confirmation
-- email (Supabase's built-in mailer only sends a few an hour), then the club
-- tries again. Now an invite for an address with no confirmed account is
-- saved here and applied automatically, by a trigger on auth.users, the
-- moment an account with that email is confirmed. Nothing is emailed by
-- this migration -- the inviter tells the person to sign up with that email.
--
-- Only a CONFIRMED email accepts an invite: otherwise anyone could register
-- someone else's address and be made admin of their club. For the same
-- reason invite_club_admin no longer adds an existing but unconfirmed
-- account straight away; it saves a pending invite for it instead.
-- Invites expire after 30 days and can be cancelled by any club member.

create table if not exists public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, email)
);

create index if not exists club_invites_email_idx on public.club_invites (email);

alter table public.club_invites enable row level security;

drop policy if exists "club_invites: members read" on public.club_invites;
create policy "club_invites: members read" on public.club_invites
  for select using (public.is_club_member(club_id));

drop policy if exists "club_invites: members cancel" on public.club_invites;
create policy "club_invites: members cancel" on public.club_invites
  for delete using (public.is_club_member(club_id));
-- No insert/update policy: invites are only created by invite_club_admin.

-- Redefined from 002. Same signature and return type, so an older client
-- keeps working (it shows its "no account" text for 'invited').
-- Returns 'ok' / 'already_member' / 'invited' / 'already_invited'.
create or replace function public.invite_club_admin(_club_id uuid, _email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _addr text := lower(btrim(coalesce(_email, '')));
  _user_id uuid;
  _confirmed boolean;
begin
  if not public.is_club_member(_club_id) then
    raise exception 'not a member of this club';
  end if;
  if _addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(_addr) > 254 then
    raise exception 'Enter a valid email address.';
  end if;

  select id, email_confirmed_at is not null into _user_id, _confirmed
    from auth.users where lower(email) = _addr limit 1;

  if _user_id is not null
     and exists (select 1 from public.club_members where club_id = _club_id and user_id = _user_id) then
    return 'already_member';
  end if;

  if _user_id is not null and _confirmed then
    insert into public.club_members (club_id, user_id, role) values (_club_id, _user_id, 'admin');
    delete from public.club_invites where club_id = _club_id and email = _addr;
    return 'ok';
  end if;

  delete from public.club_invites
    where club_id = _club_id and created_at < now() - interval '30 days';

  if exists (select 1 from public.club_invites where club_id = _club_id and email = _addr) then
    return 'already_invited';
  end if;
  if (select count(*) from public.club_invites where club_id = _club_id) >= 50 then
    raise exception 'This club already has 50 pending invites. Cancel some first.';
  end if;

  insert into public.club_invites (club_id, email, invited_by) values (_club_id, _addr, auth.uid());
  return 'invited';
end;
$$;

-- Applies pending invites when an account's email is (or becomes) confirmed:
-- sign-up with confirmation off sets email_confirmed_at on insert; with it on,
-- clicking the link updates it; a confirmed email change updates email.
-- Never lets an error here break sign-up or confirmation itself.
create or replace function public.accept_club_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;
  begin
    insert into public.club_members (club_id, user_id, role)
      select i.club_id, new.id, 'admin'
        from public.club_invites i
       where i.email = lower(new.email)
         and i.created_at >= now() - interval '30 days'
      on conflict (club_id, user_id) do nothing;
    delete from public.club_invites where email = lower(new.email);
  exception when others then
    raise warning 'accept_club_invites failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.accept_club_invites() from public, anon, authenticated;

-- Named to sort after 001's on_auth_user_created (triggers fire in name order).
drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.accept_club_invites();
