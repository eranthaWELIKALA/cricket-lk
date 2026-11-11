-- 021: emails about claim and merge requests.
--
-- Until now a claim ("this is me") or a merge request sat in the admin
-- portal until a site admin happened to look, and the player never heard
-- back. Now:
--   - a new claim request emails every site admin (admin_users), and the
--     admins of the club that first added that player (players.origin_club_id):
--     once the claim is approved, that club can no longer edit the profile
--     (009's rule), so it should know. Club admins get a heads-up only; site
--     admins still approve.
--   - a new merge request emails every site admin.
--   - an approved claim or merge emails the player who asked.
-- Nobody is emailed about their own request, and a site admin who is also an
-- admin of that club gets the site admin email only.
--
-- How it sends: Supabase's own mailer only sends auth emails (sign-up,
-- password reset), so these go through an email API, called from Postgres
-- with pg_net (an async HTTP request, sent after the transaction commits; a
-- rolled-back request sends nothing). Resend (resend.com) or Brevo
-- (brevo.com). Nothing here can make a request fail: if email isn't set up,
-- or the call errors, the request is saved as usual and email_log says why.
--
-- Setup (once, after running this file):
--   1. Get an API key: Resend (needs a domain you own, verified in Resend) or
--      Brevo (can send from a single verified address, no domain needed).
--   2. Store it in Vault, never in a table:
--        select vault.create_secret('<api key>', 'email_api_key');
--      (to change it later: select vault.update_secret(id, '<new key>') with
--      the id from vault.secrets where name = 'email_api_key')
--   3. Settings (app_settings, readable by no client):
--        insert into public.app_settings (key, value) values
--          ('email_provider', 'resend'),                       -- or 'brevo'
--          ('email_from_address', 'no-reply@your-domain.com'), -- verified with the provider
--          ('email_from_name', 'Cricket.lk'),
--          ('app_url', 'https://<user>.github.io/cricket-lk/')
--        on conflict (key) do update set value = excluded.value;
--   4. Check: select * from public.email_log order by id desc limit 20;
--      and the provider's reply:
--        select id, status_code, content from net._http_response order by id desc limit 20;
--
-- The emails follow supabase/email-templates' rules: email-safe HTML, a light
-- card, and nothing a user typed except a player's name (escaped). A claim's
-- note and an account's display name are never printed.
--
-- Run after 009 (claims/merges) and 011. Safe to run twice.

create extension if not exists pg_net with schema extensions;

-- Settings that aren't secrets. RLS on, no policies: no client reads or writes.
create table if not exists public.app_settings (
  key text primary key,
  value text
);
alter table public.app_settings enable row level security;

create or replace function public.app_setting(_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$ select nullif(btrim(value), '') from public.app_settings where key = _key $$;

-- One row per email the database tried to send. Site admins can read it.
create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  kind text not null,
  to_email text not null,
  subject text not null,
  status text not null check (status in ('queued', 'skipped', 'error')),
  detail text,
  http_request_id bigint,           -- net._http_response.id once pg_net has sent it
  created_at timestamptz not null default now()
);
alter table public.email_log enable row level security;
drop policy if exists "email_log: admin read" on public.email_log;
create policy "email_log: admin read" on public.email_log
  for select using (public.is_admin());

create or replace function public.email_escape(_t text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(replace(coalesce(_t, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- The app's address with a trailing slash, or null when not set.
create or replace function public.email_app_url()
returns text
language sql
stable
security definer
set search_path = public
as $$ select rtrim(public.app_setting('app_url'), '/') || '/' $$;

-- The email around a message: the same look as the auth templates.
-- _body is HTML (escape anything from the database first); _url may be null.
create or replace function public.email_html(_title text, _body text, _button text, _url text, _why text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _font text := '-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif';
  _app text := public.email_app_url();
  _u text := public.email_escape(_url);
begin
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    || '<meta name="viewport" content="width=device-width, initial-scale=1">'
    || '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">'
    || '<title>' || public.email_escape(_title) || '</title></head>'
    || '<body style="margin:0;padding:0;background:#EEF1F8;-webkit-text-size-adjust:100%;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F8;"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border:2px solid #0A1B4A;border-radius:14px;overflow:hidden;">'
    || '<tr><td style="background:#0A1B4A;padding:18px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
    || case when _app is null then '' else
         '<td style="vertical-align:middle;padding-right:12px;"><img src="' || public.email_escape(_app) || 'icon-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>' end
    || '<td style="vertical-align:middle;font-family:' || _font || ';font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-.3px;">Cricket<span style="color:#FFC20E;">.lk</span></td>'
    || '</tr></table></td></tr>'
    || '<tr><td style="background:#FFC20E;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:28px 24px 8px;font-family:' || _font || ';color:#10183A;">'
    || '<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;color:#0A1B4A;">' || public.email_escape(_title) || '</h1>'
    || '<p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#33405F;">' || _body || '</p>'
    || case when _url is null then '' else
         '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#FFC20E;border:2px solid #1F1702;border-radius:10px;">'
         || '<a href="' || _u || '" style="display:inline-block;padding:13px 26px;font-family:' || _font || ';font-size:16px;font-weight:800;color:#1F1702;text-decoration:none;">' || public.email_escape(_button) || '</a>'
         || '</td></tr></table>'
         || '<p style="margin:22px 0 6px;font-size:13px;line-height:1.5;color:#5B6788;">Button not working? Copy this link into your browser:</p>'
         || '<p style="margin:0 0 22px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="' || _u || '" style="color:#3065A6;">' || _u || '</a></p>' end
    || '</td></tr>'
    || '<tr><td style="border-top:1px solid #E1E6F2;padding:16px 24px;font-family:' || _font || ';font-size:12px;line-height:1.5;color:#8792AE;">'
    || 'Cricket.lk · ball-by-ball cricket scoring · by Erantha Welikala<br>' || public.email_escape(_why)
    || '</td></tr></table></td></tr></table></body></html>';
end;
$$;

-- Sends one email (one recipient: admins never see each other's address).
-- Never raises: a failure is written to email_log instead.
create or replace function public.send_app_email(_kind text, _to text, _subject text, _html text, _text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _key text;
  _provider text := lower(coalesce(public.app_setting('email_provider'), 'resend'));
  _from text := public.app_setting('email_from_address');
  _from_name text := coalesce(public.app_setting('email_from_name'), 'Cricket.lk');
  _req bigint;
begin
  if _to is null or btrim(_to) = '' then return; end if;
  begin
    select decrypted_secret into _key from vault.decrypted_secrets where name = 'email_api_key' limit 1;
  exception when others then _key := null;
  end;
  if _key is null or _from is null then
    insert into public.email_log (kind, to_email, subject, status, detail)
    values (_kind, _to, _subject, 'skipped',
            'Email is not set up: ' || case when _key is null then 'no email_api_key in Vault' else 'no email_from_address in app_settings' end || ' (see 021).');
    return;
  end if;

  begin
    if _provider = 'brevo' then
      _req := net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', _key, 'Content-Type', 'application/json', 'Accept', 'application/json'),
        body := jsonb_build_object(
          'sender', jsonb_build_object('name', _from_name, 'email', _from),
          'to', jsonb_build_array(jsonb_build_object('email', _to)),
          'subject', _subject, 'htmlContent', _html, 'textContent', _text));
    else
      _req := net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || _key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', _from_name || ' <' || _from || '>',
          'to', jsonb_build_array(_to),
          'subject', _subject, 'html', _html, 'text', _text));
    end if;
    insert into public.email_log (kind, to_email, subject, status, http_request_id)
    values (_kind, _to, _subject, 'queued', _req);
  exception when others then
    insert into public.email_log (kind, to_email, subject, status, detail)
    values (_kind, _to, _subject, 'error', sqlerrm);
  end;
end;
$$;

-- Confirmed email addresses of the site admins, and of a club's admins.
create or replace function public.site_admin_emails()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct lower(u.email) from public.admin_users a
  join auth.users u on u.id = a.user_id
  where u.email is not null and u.email_confirmed_at is not null
$$;

create or replace function public.club_admin_emails(_club_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct lower(u.email) from public.club_members m
  join auth.users u on u.id = m.user_id
  where m.club_id = _club_id and m.role in ('owner', 'admin')
    and u.email is not null and u.email_confirmed_at is not null
$$;

create or replace function public.user_email(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(email) from auth.users where id = _user_id and email is not null and email_confirmed_at is not null
$$;

-- The emails themselves.
create or replace function public.email_request_created(_table text, _row jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _by uuid := (_row ->> 'requested_by')::uuid;
  _me text := public.user_email(_by);
  _app text := public.email_app_url();
  _name text;
  _into_name text;
  _club uuid;
  _club_name text;
  _to text;
  _subject text;
  _html text;
  _txt text;
  _admins text[];
begin
  select coalesce(array_agg(e), '{}') into _admins from public.site_admin_emails() e;

  if _table = 'claim_requests' then
    select name, origin_club_id into _name, _club from public.players where id = (_row ->> 'player_id')::uuid;
    if _name is null then return; end if;

    _subject := 'Claim request: ' || _name;
    _html := public.email_html('New claim request',
      'Someone has asked to claim the player profile <strong>' || public.email_escape(_name) || '</strong>. Check it and approve or reject it in the admin portal.',
      'Review claim requests', case when _app is null then null else _app || 'admin.html#claims' end,
      'Sent to you because you are a Cricket.lk site admin.');
    _txt := 'Someone has asked to claim the player profile "' || _name || '". Review it in the admin portal'
      || coalesce(': ' || _app || 'admin.html#claims', '.');
    foreach _to in array _admins loop
      if _to is distinct from _me then perform public.send_app_email('claim_request.admin', _to, _subject, _html, _txt); end if;
    end loop;

    -- The club that added the player loses its edit right once the claim is approved.
    if _club is not null then
      select name into _club_name from public.clubs where id = _club;
      _subject := _name || ' has asked to claim their profile';
      _html := public.email_html('A player is claiming their profile',
        'Someone has asked to claim the profile of <strong>' || public.email_escape(_name) || '</strong>, a player '
          || public.email_escape(coalesce(_club_name, 'your club')) || ' added to Cricket.lk. A Cricket.lk admin will check it. '
          || 'Once it''s approved, the player manages their own profile, and your club can no longer edit it.',
        'Open Cricket.lk', case when _app is null then null else _app || '#/premier/players/' || (_row ->> 'player_id') end,
        'Sent to you because you are an admin of ' || coalesce(_club_name, 'the club') || ' on Cricket.lk.');
      _txt := 'Someone has asked to claim the profile of "' || _name || '", a player ' || coalesce(_club_name, 'your club')
        || ' added to Cricket.lk. A Cricket.lk admin will check it. Once it''s approved, the player manages their own profile, and your club can no longer edit it.';
      for _to in select e from public.club_admin_emails(_club) e loop
        if _to is distinct from _me and not (_to = any(_admins)) then
          perform public.send_app_email('claim_request.club', _to, _subject, _html, _txt);
        end if;
      end loop;
    end if;

  elsif _table = 'merge_requests' then
    select name into _name from public.players where id = (_row ->> 'from_player_id')::uuid;
    select name into _into_name from public.players where id = (_row ->> 'into_player_id')::uuid;
    if _name is null or _into_name is null then return; end if;

    _subject := 'Merge request: ' || _name || ' into ' || _into_name;
    _html := public.email_html('New merge request',
      'The owner of <strong>' || public.email_escape(_into_name) || '</strong> has asked to merge the profile <strong>'
        || public.email_escape(_name) || '</strong> into theirs. Check it and approve or reject it in the admin portal.',
      'Review merge requests', case when _app is null then null else _app || 'admin.html#merges' end,
      'Sent to you because you are a Cricket.lk site admin.');
    _txt := 'The owner of "' || _into_name || '" has asked to merge the profile "' || _name || '" into theirs. Review it in the admin portal'
      || coalesce(': ' || _app || 'admin.html#merges', '.');
    foreach _to in array _admins loop
      if _to is distinct from _me then perform public.send_app_email('merge_request.admin', _to, _subject, _html, _txt); end if;
    end loop;
  end if;
end;
$$;

create or replace function public.email_request_approved(_table text, _row jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _to text := public.user_email((_row ->> 'requested_by')::uuid);
  _app text := public.email_app_url();
  _id text;
  _name text;
  _from_name text;
  _url text;
begin
  if _to is null then return; end if;
  if _table = 'claim_requests' then
    _id := _row ->> 'player_id';
    select name into _name from public.players where id = _id::uuid;
    if _name is null then return; end if;
    _url := case when _app is null then null else _app || '#/premier/players/' || _id end;
    perform public.send_app_email('claim_approved', _to, 'Your claim was approved: ' || _name,
      public.email_html('Your claim was approved',
        'The profile <strong>' || public.email_escape(_name) || '</strong> is now yours. You can edit it, and see your stats and matches from Account → My stats &amp; matches.',
        'Open my profile', _url,
        'Sent to you because you asked to claim this profile on Cricket.lk.'),
      'The profile "' || _name || '" is now yours. You can edit it, and see your stats and matches from Account → My stats & matches.'
        || coalesce(' ' || _url, ''));
  elsif _table = 'merge_requests' then
    _id := _row ->> 'into_player_id';
    select name into _name from public.players where id = _id::uuid;
    -- approve_merge marks the request approved before it deletes the merged profile.
    select name into _from_name from public.players where id = (_row ->> 'from_player_id')::uuid;
    if _name is null then return; end if;
    _url := case when _app is null then null else _app || '#/premier/players/' || _id end;
    perform public.send_app_email('merge_approved', _to, 'Your merge was approved',
      public.email_html('Your merge was approved',
        coalesce('<strong>' || public.email_escape(_from_name) || '</strong>', 'The other profile')
          || ' is now part of your profile <strong>' || public.email_escape(_name) || '</strong>. Its matches count in your stats.',
        'Open my profile', _url,
        'Sent to you because you asked for this merge on Cricket.lk.'),
      coalesce('"' || _from_name || '"', 'The other profile') || ' is now part of your profile "' || _name || '". Its matches count in your stats.'
        || coalesce(' ' || _url, ''));
  end if;
end;
$$;

-- The trigger. Its own errors are swallowed: a request must never fail because of email.
create or replace function public.email_on_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' and new.status = 'pending' then
      perform public.email_request_created(tg_table_name, to_jsonb(new));
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved' then
      perform public.email_request_approved(tg_table_name, to_jsonb(new));
    end if;
  exception when others then
    raise warning 'request email not sent: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists claim_requests_email on public.claim_requests;
create trigger claim_requests_email after insert or update on public.claim_requests
  for each row execute function public.email_on_request();
drop trigger if exists merge_requests_email on public.merge_requests;
create trigger merge_requests_email after insert or update on public.merge_requests
  for each row execute function public.email_on_request();

-- None of these is for clients: send_app_email would let anyone send email
-- with the project's key, and the *_emails functions list addresses.
-- (Supabase grants execute on new functions to anon/authenticated by default.)
revoke all on function public.app_setting(text) from public, anon, authenticated;
revoke all on function public.email_app_url() from public, anon, authenticated;
revoke all on function public.email_html(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.send_app_email(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.site_admin_emails() from public, anon, authenticated;
revoke all on function public.club_admin_emails(uuid) from public, anon, authenticated;
revoke all on function public.user_email(uuid) from public, anon, authenticated;
revoke all on function public.email_request_created(text, jsonb) from public, anon, authenticated;
revoke all on function public.email_request_approved(text, jsonb) from public, anon, authenticated;
revoke all on function public.email_on_request() from public, anon, authenticated;
