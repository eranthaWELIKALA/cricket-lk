# Cricket.lk

Ball-by-ball cricket scorer. Installable PWA, single HTML file, no
framework, no build step.

Tracks a full two-innings limited-overs match: runs, wickets, extras
(wides, no-balls, byes, leg-byes), free hits, overs, run rate, required
run rate on the chase, batting/bowling figures, fall of wickets, and the
final result. Beyond a single match, it also supports:

- **Match & tournament presets** — reusable playing conditions (balls
  per over, overs, players per side, wide/no-ball run values and
  on/off toggles, whether a no-ball gives a free hit, whether a catch/
  run-out taker is required) and tournament-level rules (points for a
  win/tie/loss, NRR ranking).
  Three match presets and one tournament preset ship built in; add,
  edit, or delete your own from the Presets screen.
- **Teams & players** — persistent, editable rosters with name
  autocomplete (typing an existing name anywhere suggests it; typing a
  new one adds it to the shared player list). Swapping a player between
  teams doesn't rewrite history — an archived match keeps whichever
  team a player played for at the time.
- **Tournaments** — pick teams and a tournament preset, then start
  matches from the tournament dashboard, which tracks a standings table
  (points, NRR) and per-tournament stats.
- **Fielder credit** — optionally (or, per preset, mandatorily) name who
  took a catch or effected a run-out.
- **Forfeits** — end a match at any point (before it even starts, mid-
  innings, at the break) and declare the other team the winner. Counts
  toward tournament standings (points, not NRR) and archived stats.
- **Stats & MVP** — all-time and per-tournament batting/bowling/fielding
  leaderboards, plus an auto-computed Man-of-the-Match (per match) and
  MVP (per tournament) from a fixed point formula, overridable on the
  result screen.
- **Share & export** — save/share the scorecard as a PNG image, or
  export it as a PDF via the browser's print dialog. Both are
  dependency-free (no external libraries).
- **Sound effects** — short synthesized tones (no audio files) for
  runs, boundaries, wickets, and match completion, via the Web Audio
  API. On by default; mute anytime with the speaker icon in the corner.

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

## Known simplifications

- **Rosters are optional, not enforced.** Teams have persistent player
  lists with autocomplete, but the crease/bowling-end name fields are
  still free text — there's no "yet to bat" list, and nothing stops you
  from typing a name that isn't in either team's roster.
- **A wicket is always modelled as happening on a legal delivery.** A
  run-out off a wide or no-ball is a real (if rare) part of cricket that
  isn't captured here — score it as a normal-ball run-out and adjust by
  hand if it matters to you.
- **Runs on a run-out are credited to whoever was on strike**, not
  apportioned between the batsmen actually seen running. Fine for a
  personal scorer, not fine for an official one.
- **The MVP/Man-of-the-Match point formula is fixed**, not user-tunable
  — runs/boundaries/milestones, wickets/maidens, catches/run-outs each
  have a set weight. You can always override the pick by hand on the
  result screen.
- **Net run rate follows the standard convention** that a team bowled
  all out counts its full overs quota (not the fewer overs it actually
  faced) — the usual real-world rule, applied without exception.
- **Single device, no live sync.** State lives in that browser's
  storage (`localStorage`, or in-memory if storage is unavailable).
  Two phones scoring the same match won't see each other's balls, and a
  tournament's standings/stats only include matches archived on that
  same device.

## Testing

No formal test suite is checked in as policy, but `test.js` (run with
`node test.js`, needs `npm install` for `jsdom` first) exercises the
engine and storage: strike rotation on odd runs vs. boundaries, over
completion and the forced bowler change, wides/no-balls/free-hit,
standard wickets and run-outs, all-out ending an innings mid-over, a
full two-innings match through to the result string, a session
surviving a reload, undo, non-6-ball-over presets, configurable wide/
no-ball run values, fielder credit on catches/run-outs, the MVP point
formula and match/tournament stat aggregation, tournament standings,
and the old-save migration. Extend it rather than starting over when
you touch the engine or storage.
