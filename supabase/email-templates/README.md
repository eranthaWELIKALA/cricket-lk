# Auth email templates

Supabase Auth's emails, kept here so they're versioned. The live copy is
whatever is pasted into the dashboard. There's no tooling, the same as the
SQL migrations.

| File | Dashboard template | Subject | Sent by the app? |
|---|---|---|---|
| `confirm-signup.html` | Confirm signup | Confirm your Cricket.lk account | Yes: sign up and "Resend email" |
| `reset-password.html` | Reset password | Reset your Cricket.lk password | Not yet: there's no "Forgot password?" flow |

Emails about claim and merge requests aren't auth emails: they're built and
sent by the database (`supabase/021_request_emails.sql`, `email_html`), in the
same look and under the same rules as these.

**To update:** Supabase → Authentication → Emails → Templates → pick the
template → paste the subject and the whole file → Save. If the editor is
locked, turn on custom SMTP first. Send yourself one (see "Test it" below)
before relying on it.

## Rules these follow

- **Email-safe HTML only:** tables for layout, inline styles, no `<style>`
  block, no JS, no web fonts, no CSS `box-shadow` (most mail apps drop
  them). The button is a table cell, so it shows in Outlook too.
- **A light body** (`color-scheme: light only`). Mail apps recolour dark
  emails unpredictably, while a light card with a navy header comes out the
  same everywhere. The colours are the Sri Lanka theme's (`css/app.css`).
- **Nothing the user typed is printed.** No `{{ .Data.display_name }}`.
  Anyone can sign up with *someone else's* address and any display name,
  so a name in the email would let a stranger put their own text or links
  in front of that person. Only Supabase's own values are used:
  `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`.
- **The logo is `{{ .SiteURL }}/icon-192.png`**, so it only shows once
  Authentication → URL Configuration → Site URL is the deployed app's
  address (not the default `http://localhost:3000`). It has an empty `alt`,
  and the wordmark next to it is text, so a blocked image loses nothing.
- **The link is shown as text too**, for mail apps that break buttons.
- **"Expires soon", not a number.** The expiry is the "Email OTP
  Expiration" setting (Authentication → Sign In / Providers → Email). Name
  a time only if it's kept in step with that setting.

## Test it

Authentication → Users → the user's ⋮ → Send password recovery sends the
reset template. Signing up with a fresh `you+tN@gmail.com` sends the
confirm template. Check it in Gmail (web and phone) and, if you can,
Outlook. Also check that the button opens the deployed site.
