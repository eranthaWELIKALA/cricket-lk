# cricket-lk-worker

A Cloudflare Worker (free plan) that sends the database's emails through a
Gmail account. These are the claim and merge request emails from
`supabase/021_request_emails.sql`. Gmail needs no domain of your own,
unlike Resend. Supabase's sign-up and password emails don't go through
here: they use the SMTP settings in the Supabase dashboard.

```
Postgres (send_app_email, 022) ──pg_net──▶ Worker POST /emails ──SMTP 465 (TLS)──▶ smtp.gmail.com
```

- **Request:** Resend's format, `POST /emails`, with `Authorization: Bearer
  <EMAIL_WORKER_TOKEN>` and `{ from, to: [one address], subject, html, text }`.
- **Answer:** `200 { id }` once Gmail has accepted the email, or
  `4xx/5xx { error }`. Postgres keeps the answer in `net._http_response`.
- **The From address is always the Gmail account.** Only the display name
  comes from the request, so the Worker can't be used to send as anyone
  else.
- **The request is checked:** exactly one recipient, no line breaks in the
  subject or address (no header injection), size limits, and the token is
  compared in constant time. There's also a per-IP rate limit (30 a minute).
- **Logs** hold an id and an error code only, never an address or any of
  the email's content.
- **Costs:** the free plan allows 100,000 requests a day. Gmail allows about
  500 emails a day, so Gmail is the real limit.

## Set up

You need a Cloudflare account (the same one as Review Desk is fine), and a
Gmail account with 2-Step Verification and an **app password**
(https://myaccount.google.com/apppasswords). Use the project account, not a
personal one.

```bash
cd worker
npm install
npx wrangler login                          # if not signed in already
npx wrangler secret put SMTP_USER           # the Gmail address
npx wrangler secret put SMTP_PASS           # its app password
openssl rand -hex 32                        # → a new token; copy it
npx wrangler secret put EMAIL_WORKER_TOKEN  # paste the token
npx wrangler deploy                         # prints https://cricket-lk-worker.<subdomain>.workers.dev
```

Test it by sending one email to yourself:

```bash
curl -s -X POST https://cricket-lk-worker.<subdomain>.workers.dev/emails \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"to":["you@example.com"],"subject":"Cricket.lk test","text":"It works."}'
# → {"id":"…"}; a 502 {"error":"… 535 …"} means the Gmail address or app password is wrong
```

Then point the database at it. Run `supabase/022_email_worker.sql` after
021, and follow its header: the same token goes in Vault as
`email_api_key`, and `email_provider` = `worker`, `email_worker_url` = the
address above + `/emails`.

## Develop

- `npm test` runs the unit tests (Node, no network): request checks, MIME,
  and the SMTP conversation against a fake server.
- `npx wrangler dev` runs it locally in Cloudflare's runtime. Put the three
  secrets in `.dev.vars` (gitignored) first.

## Rotate the token

`npx wrangler secret put EMAIL_WORKER_TOKEN` with a new value, then
`select vault.update_secret(id, '<new token>') from vault.secrets where name
= 'email_api_key';`. Emails fail with 401 between the two steps.
