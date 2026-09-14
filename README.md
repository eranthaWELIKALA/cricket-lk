# Cricket.lk

Ball-by-ball cricket scorer. Installable PWA, single HTML file, no
framework, no build step.

Tracks a full two-innings limited-overs match: runs, wickets, extras
(wides, no-balls, byes, leg-byes), free hits, overs, run rate, required
run rate on the chase, batting/bowling figures, fall of wickets, and the
final result.

## Run it

```bash
npx serve .          # or: python3 -m http.server 8080
```

Open the printed localhost URL. The service worker requires **HTTPS or
localhost** — opening `index.html` directly from the filesystem
(`file://`) gives you the scorer but no install prompt and no offline
cache.

There is no build step and no package.json dependency for the app
itself — `index.html` is the entire product. `package.json` only exists
for the dev-time test dependency (`jsdom`).

## Deploying

Any static host works — GitHub Pages, Netlify, Vercel, Cloudflare
Pages. HTTPS is required for the install prompt and offline cache.
Example (GitHub Pages via `gh`):

```bash
gh repo create <name> --public --source=. --remote=origin --push
gh api repos/<owner>/<name>/pages -X POST -f "source[branch]=master" -f "source[path]=/"
```

`manifest.webmanifest` and the service worker registration in
`index.html` both use relative paths, so the app works from a subpath
(e.g. `https://<user>.github.io/cricket-lk/`) without edits.

## Installing on a phone

- **Android/Chrome**: open the deployed URL, tap "Install app" (or menu
  → "Add to Home screen").
- **iOS/Safari**: Share → "Add to Home Screen". No Apple developer
  account needed — that's only required for native App Store
  distribution, not a home-screen PWA install.

## Files

| File | Purpose |
|---|---|
| `index.html` | Everything — markup, CSS, and JS in one file. See below for internal structure. |
| `manifest.webmanifest` | Home-screen install metadata. |
| `sw.js` | Service worker: offline cache only (no notifications in this app). |
| `icon-*.png` | App icons (192, 512, 512 maskable) — a plain cricket ball. |

## Known simplifications (v1)

- **No player squads.** Batsmen and bowlers are entered by name as they
  come to the crease/bowl, not picked from a pre-set XI. There's no
  "yet to bat" list.
- **A wicket is always modelled as happening on a legal delivery.** A
  run-out off a wide or no-ball is a real (if rare) part of cricket that
  isn't captured here — score it as a normal-ball run-out and adjust by
  hand if it matters to you.
- **Runs on a run-out are credited to whoever was on strike**, not
  apportioned between the batsmen actually seen running. Fine for a
  personal scorer, not fine for an official one.
- **Single device, no live sync.** State lives in that browser's
  storage (`localStorage`, or in-memory if storage is unavailable).
  Two phones scoring the same match won't see each other's balls.

## Testing

No formal test suite is checked in as policy, but `test.js` (run with
`node test.js`, needs `npm install` for `jsdom` first) exercises the
engine: strike rotation on odd runs vs. boundaries, over completion and
the forced bowler change, wides/no-balls/free-hit, standard wickets and
run-outs, all-out ending an innings mid-over, a full two-innings match
through to the result string, a session surviving a reload, and undo.
Write a new one at `test.js` when you touch the engine — it's fine to
extend the existing checks rather than starting over.
