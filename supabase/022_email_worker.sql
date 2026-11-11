-- 022: send the database's emails through our own Cloudflare Worker (Gmail).
--
-- 021 sends claim/merge emails through Resend (needs a domain you own) or
-- Brevo (rewrites a Gmail sender to its own domain). This adds a third
-- provider, 'worker': worker/ in this repo, a Cloudflare Worker (free
-- plan) that takes the same request as Resend and sends it through a Gmail
-- account's SMTP with an app password. No domain needed; Gmail allows about
-- 500 emails a day.
--
-- Setup (once, after 021 and after deploying the Worker, see
-- worker/README.md):
--   1. The Worker's token goes in Vault as the API key (same secret 021 reads):
--        select vault.create_secret('<EMAIL_WORKER_TOKEN>', 'email_api_key');
--      (already have one? select vault.update_secret(id, '<token>') with the
--       id from vault.secrets where name = 'email_api_key')
--   2. Settings:
--        insert into public.app_settings (key, value) values
--          ('email_provider', 'worker'),
--          ('email_worker_url', 'https://cricket-lk-worker.<subdomain>.workers.dev/emails'),
--          ('email_from_address', '<the Gmail address>'),   -- the Worker always sends from it anyway
--          ('email_from_name', 'Cricket.lk')
--        on conflict (key) do update set value = excluded.value;
--   3. Check: select * from public.email_log order by id desc limit 20;
--      and the Worker's reply ({"id": …} or {"error": …}):
--        select id, status_code, content from net._http_response order by id desc limit 20;
--
-- This redefines send_app_email with 021's body plus the 'worker' branch. If
-- 021's send_app_email changes, change it here too. Safe to run twice.

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
  _worker_url text := public.app_setting('email_worker_url');
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
  -- The token is sent to this address, so it must be https.
  if _provider = 'worker' and (_worker_url is null or _worker_url !~ '^https://') then
    insert into public.email_log (kind, to_email, subject, status, detail)
    values (_kind, _to, _subject, 'skipped', 'Email is not set up: email_worker_url (an https:// address) is missing in app_settings (see 022).');
    return;
  end if;

  begin
    if _provider = 'worker' then
      _req := net.http_post(
        url := _worker_url,
        headers := jsonb_build_object('Authorization', 'Bearer ' || _key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', _from_name || ' <' || _from || '>',
          'to', jsonb_build_array(_to),
          'subject', _subject, 'html', _html, 'text', _text),
        -- The Worker answers once Gmail has accepted the email (a second or two).
        timeout_milliseconds := 20000);
    elsif _provider = 'brevo' then
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
