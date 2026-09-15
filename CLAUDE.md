# Cricket.lk

Ball-by-ball cricket scoring PWA. Installable, single HTML file, no
framework, no build step.

## Run it

```bash
npx serve .          # or: python3 -m http.server 8080
```

The service worker requires **HTTPS or localhost** — `file://` gives
you the scorer but no install prompt and no offline cache. Don't "fix"
that; it's a platform restriction, not a bug.

## `index.html` internal structure

Numbered sections, in order, findable by searching for the heading text:

1. **`REFERENCE DATA`** — `WICKET_LABELS` (dismissal display strings),
   `MVP_POINTS` (the fixed MOTM/MVP point formula — see "Stats & MVP"
   below), and `DEFAULT_MATCH_PRESETS`/`DEFAULT_TOURNAMENT_PRESETS`, the
   built-in presets seeded into storage on first run.
2. **`ENGINE`** — pure functions, zero DOM access: `createInnings`,
   `createMatch`, `recordBall`, `checkInningsComplete`,
   `startSecondInnings`, `matchResult`, `afterBall`, small utilities
   (`oversDisplay`, `runRate`, `requiredRunRate`, `swapStrike`,
   `pendingBatsmanSlot`), plus a cross-match aggregation group added for
   stats/MVP/standings: `calcPlayerPoints`, `aggregatePlayerStats`,
   `pickMatchMOTM`, `computeStandings` (see "Stats & MVP" below). This
   whole section is the block to port if you ever build a native app —
   it still does zero DOM access.
3. **`STORAGE`** — a `DB` wrapper: tries `window.storage`, falls back to
   `localStorage`, falls back to an in-memory object; its `load`/`save`/
   `clear` all take an explicit key (not baked in), since the app now
   reads/writes more than one. The current schema is `cricket.lk.v2`,
   holding the whole app: `{ match, snapshots, view, players, teams,
   matchPresets, tournamentPresets, tournaments, matchHistory,
   activeTournamentId }`. A `cricket.lk.v1` save (the old `{ match,
   snapshots }` shape) is migrated in place on load — see "Storage
   schema & migration" below.
4. **`CLOUD`** — the Supabase client and auth session, added on top of
   the originally 100%-local app (see "Cloud accounts & Supabase" below).
   Everything here is additive and optional: with `SUPABASE_URL`/
   `SUPABASE_ANON_KEY` left blank, `supabaseClient` stays `null`,
   `initAuth()` returns immediately without any network request, and
   local guest scoring is completely unaffected.
5. **`UI`** — render functions per screen (home, teams, presets, match
   setup, tournament setup/dashboard, stats, sign-in/sign-up/account,
   live, opening/new-batsman/new-bowler/wicket modals, innings break,
   result), one `render()` that picks the screen (from `match.status`
   when a match is in progress, otherwise from `state.view`) and layers
   a modal on top when needed, and three delegated listeners (`click`
   via `data-action`, `submit` via form `id`, `change` for the
   tournament team-checkbox list) attached once at boot.

## The engine's state model (read this before touching `recordBall`)

An innings is one plain object (`createInnings`) with `striker`,
`nonStriker`, `bowler` as **name-or-null slots**, not fixed identities.
`recordBall` mutates it directly — there's no undo logic inside the
engine; undo is handled entirely by the UI layer snapshotting the whole
`match` object (`pushSnapshot`) before every mutating action and
restoring it (`handleUndo`). Don't build inverse-of-`recordBall` logic;
extend the snapshot approach instead if you add new mutating actions.

**A null slot is how the UI knows what to ask for next** — this is the
one thing this file most needs you to preserve:
- `inn.striker === null` or `inn.nonStriker === null` → new-batsman
  modal, targeting whichever slot is null.
- `inn.bowler === null` → new-bowler modal.
- `render()` checks these in that order every render; it does not use a
  separate "waiting for input" status. If you add a new kind of pause,
  follow the same pattern (a null field the render function notices)
  rather than adding UI-only status strings — the two are easy to let
  drift out of sync.

**The end-of-over strike swap composes with the mid-ball odd-runs swap
by both being unconditional `swapStrike()` calls, in sequence** — this
is also why a wicket that falls on the 6th ball of an over "just
works": nulling `inn.striker` and then running the end-of-over
`swapStrike()` correctly moves the vacant slot to the non-striker's end
for the new over (the not-out batsman takes strike, the incoming
batsman will occupy the other end) with no special-casing. If you touch
either swap, keep them as two independent, unconditional operations —
merging them into one conditional swap will get the vacant-slot case
wrong.

**Run-outs set the vacated end directly (`event.endComingIn`)** rather
than computing which end the batsmen ended up at from the parity of
runs run. The UI asks "who's out — striker or non-striker" and applies
that literally; it does not model batsmen crossing. This is a
deliberate simplification (see README's "Known simplifications"), not
a bug — don't "fix" it by adding crossing math unless you're prepared to
also model run-outs off wides/no-balls, which the engine doesn't
attempt at all right now.

**Wicket events carry an optional `fielder` name**, used for
`wicketType: 'caught'` and `'runout'` only. It changes the persisted
`howOut` text (`c NAME b BOWLER` / `run out (NAME)`) and credits
`inn.fielding.stats[NAME]` (mirrors `ensureBowler`'s
`{order, stats}` shape via `ensureFielder`) — that's the only thing
feeding catches/run-outs into `calcPlayerPoints`. Whether a fielder is
*required* is a match-level flag (`match.requireFielderOnCatch` /
`requireFielderOnRunout`, sourced from whichever preset the match was
started from) enforced by the UI form, not the engine — `recordBall`
accepts a caught/run-out with no `fielder` regardless.

**Byes and leg-byes count as a legal ball and add to the team total,
but never to the bowler's runs conceded.** Wides, no-balls, and runs
scored during a run-out *do* count against the bowler. This split is
easy to get backwards; `recordBall`'s `if (event.kind !== "bye" &&
event.kind !== "legbye")` guard is the one place it's enforced.

**A no-ball sets `inn.freeHit = true`; any legal ball clears it,
regardless of outcome.** A wide neither sets nor clears it (it's not a
legal delivery, so the free hit obligation just carries over to the
next ball). The UI reads `inn.freeHit` to hide every dismissal type
except run-out in the wicket modal — don't add a separate free-hit flag
in the UI layer, it'll drift from this one.

**Innings-completion priority is target → all-out → overs-complete**
(`checkInningsComplete`), checked in that order after every ball. This
matters for the rare case where a boundary that reaches the target and
an over/innings boundary happen on the same ball — reaching the target
always wins and ends the match immediately, even mid-over.

## Playing conditions are per-match config, not hardcoded

`inn.ballsPerOver` (default 6) replaces every hardcoded `6`/`% 6` that
used to be scattered through `oversDisplay`, `requiredRunRate`,
`checkInningsComplete`, and the over-completion check in `recordBall` —
if you're adding a new place that needs "balls in an over," read
`inn.ballsPerOver`, never write a literal `6`. Similarly
`inn.wideBaseRuns`/`noBallBaseRuns` (default 1 each) are what a wide/
no-ball is *worth*, replacing the old hardcoded `1 +`. Whether wides/
no-balls are offered at all (`match.wideEnabled`/`noBallEnabled`) is
UI-only — the live screen just doesn't render that extra-pad button;
`recordBall` has no opinion on it. `inn.freeHitOnNoBall` (default true)
gates whether a no-ball actually sets `inn.freeHit` — unlike the
enabled/disabled toggles above, this one *is* enforced in the engine
(`recordBall`'s `if (event.kind === "noball" && inn.freeHitOnNoBall)`),
since it changes real dismissal-eligibility logic the wicket modal
reads, not just which buttons are shown. All of this is set once, at
`createMatch`, from whatever **match preset** was picked (or hand-typed
on the match-setup screen) and never changes mid-match.

## Storage schema & migration

Schema version is `cricket.lk.v2` (see `STORAGE` above for the shape).
`DB.load`/`save`/`clear` take an explicit key now — don't reintroduce a
baked-in key, the app reads both the current key and the legacy
`cricket.lk.v1` key (only to migrate it once, in `migrateLegacy()`).
When you add a new top-level field to `state`, add it to `defaultState()`
— `load()` does `Object.assign(defaultState(), data)`, so an old save
missing the new field silently gets the default rather than `undefined`.
Don't extend that merge to *deep*-merge nested collections like
`matchPresets`/`tournamentPresets` — those are seeded from
`DEFAULT_MATCH_PRESETS`/`DEFAULT_TOURNAMENT_PRESETS` only on first run
(fresh install or legacy migration); merging defaults back in on every
load would resurrect a preset the user deliberately deleted.

## Teams, players & presets

Players are a flat, global, name-deduplicated table (`state.players`,
case-insensitive match via `findOrCreatePlayer`) — this is what backs
the `#players-datalist` autocomplete on every name field (striker,
non-striker, bowler, new-batsman, new-bowler, fielder). Teams
(`state.teams`) just hold a `playerIds` list; moving a player between
teams (`movePlayerToTeam`) only changes that list, it doesn't touch
`matchHistory`, so past archived matches keep whatever team a player
played for at the time — don't try to make history "follow" a roster
change. A standalone match's `teamA`/`teamB` are still plain display
strings (unchanged from before this feature), only *tournament*
matches resolve real team IDs to names at creation time
(`handleTournamentStartMatchSubmit`) — this is why match setup can
still be a 10-second "type two names and go" flow even with teams
existing as a feature.

Match presets and tournament presets are separate, layered concerns:
a **match preset** is playing conditions (`ballsPerOver`, `oversLimit`,
`playersPerSide`, wide/no-ball config, fielder-required flags); a
**tournament preset** just points at one match preset and adds
points-table config (`pointsForWin/Tie/Loss`, `useNRR`). A tournament's
matches all inherit its preset's match preset — there's no per-match
override once a tournament exists.

## Stats & MVP

`calcPlayerPoints` is a fixed, documented formula (see `MVP_POINTS`) —
it is **not** user-configurable in this version; don't wire a settings
UI for it without discussing scope first. `aggregatePlayerStats` and
`pickMatchMOTM` both fold innings stats through the same helper
(`foldInningsIntoTotals`) so a player's batting/bowling/fielding lines
are summed consistently whether you're looking at one match's MOTM or
an all-time/tournament leaderboard. A completed match is archived into
`state.matchHistory` exactly once (`maybeArchiveCompletedMatch`, guarded
by `match.archivedId`) right after `afterBall()` flips its status to
`"complete"` — that archive is the only source of truth stats/standings
read from; nothing recomputes retroactively if you edit an old match.
`computeStandings`' NRR follows the standard convention that an
all-out innings counts its full overs quota (not the fewer overs it
actually took) — this is a simplification, not a bug, consistent with
the run-out-crossing and run-out-off-extras simplifications above.

## Forfeiting a match

`forfeitMatch(match, forfeitingTeamKey)` is deliberately kept separate
from `matchResult`/`afterBall` — it can fire at *any* point (before
`match.innings[1]` exists at all, mid-first-innings, at the break,
mid-chase), so it doesn't try to compute a runs margin or reuse the
normal completion path; it just sets `match.forfeited`,
`match.forfeitedBy`, `status = "complete"`, and a result string
directly. The UI trigger (`ui.forfeitFlow` → `renderForfeitModal`) is
checked *before* the opening/new-batsman/new-bowler/wicket modal
branches in `render()`'s modal logic, so it can interrupt any of those
at any time. Two consequences worth remembering if you touch this:
- `renderResult` guards `match.innings[1]` before rendering its
  scorecard (`match.innings[1] ? renderInningsSummary(...) : ""`) — a
  first-innings forfeit means it doesn't exist. Don't remove that guard.
- `computeStandings` handles `match.forfeited` matches in a completely
  separate branch: they count for played/won/lost/points, but are
  **excluded** from the NRR accumulation (partial, forcibly-ended
  innings would skew it). If you change how standings fold in normal
  matches, check the forfeited branch still makes sense alongside it.

## Navigation: `state.view` vs `match.status`

Screen selection in `render()` checks `state.match` *first*: if a match
exists and isn't `"complete"`, you always get the live/innings-break
screen, full stop — there is currently no way to navigate to
Home/Teams/Presets/Stats while a match is in progress (same
single-track-at-a-time spirit as the original app, just extended).
Only when there's no in-progress match does `state.view` (`"home"`,
`"teams"`, `"presets"`, `"matchSetup"`, `"tournamentSetup"`,
`"tournamentDashboard"`, `"stats"`) pick the screen. If you add a new
top-level screen, it only needs a `state.view` case — don't try to make
it reachable mid-match unless you also decide what "pause a live match
to go look at stats" should mean (it currently isn't supported).

## Share & export

Both are dependency-free by design (see README) — no CDN libraries.
"Share image" (`shareScorecardImage`) draws the scorecard onto an
offscreen `<canvas>` (`renderScorecardCanvas`) and uses
`navigator.share`/`canShare` with files when available, falling back to
a plain `<a download>` of the PNG blob. "Export PDF" is just
`window.print()` against the `@media print` rules in the stylesheet
(hides modals/buttons/nav, forces light colors) — the browser's own
"Save as PDF" in the print dialog does the rest. If you touch either,
keep them dependency-free; that was a deliberate choice, not an
oversight.

## Theme & sound

The visual theme lives entirely in `:root` CSS custom properties at the
top of `<style>` (`--bg`, `--panel`, `--accent`, `--accent-2`, radii,
shadow tokens) — retheme by changing those, not by hunting through
component rules. Panels are glass (`background:var(--panel)` +
`backdrop-filter:blur(...)`) over a fixed radial-gradient body
background; component selectors are unchanged from before this pass, so
JS never needed to touch class names to pick up the new look.

`SFX` (next to `escapeHtml`, in `UI`) is a tiny synthesized sound
engine — plain Web Audio oscillators, no audio files, so it stays
inside the single-file/offline constraints. It's muted by
`state.soundEnabled` (persisted, default on) and toggled by the
always-visible `.sound-toggle` button that `render()` appends to every
screen. **Don't add an infinite CSS animation to `.sound-toggle`** (or
any other always-on-screen, always-clickable element) — one was tried
here and reverted because it never lets the element's layout "settle,"
which breaks Playwright/automation click-stability checks and is a
mild UX annoyance besides. A static or short, non-repeating animation
is fine; `infinite` on a persistent control is not.

## Editing dismissal types

`WICKET_LABELS` and the wicket modal's button list are the two places a
new dismissal type needs to be added (e.g. "handled the ball",
"obstructing the field" — currently omitted as too rare to bother
with). Both must agree, and `recordBall`'s wicket branch needs to know
whether the new type behaves like a normal dismissal (clears
`inn.striker`, always the facing batsman) or like a run-out (clears
whichever end the UI names).

## Testing

No formal test suite is checked in as project policy, but `test.js`
(requires `npm install` for `jsdom`, run with `node test.js`) covers the
engine end-to-end: strike rotation, over completion forcing a bowler
change (and blocking the same bowler twice in a row), wides/no-balls/
free-hit, standard wickets and run-outs, all-out ending an innings
mid-over, a full two-innings match through to the result string, a
session surviving a reload, undo, non-6-ball presets, configurable
wide/no-ball run values, fielder credit on catches/run-outs,
`calcPlayerPoints`/`aggregatePlayerStats`/`pickMatchMOTM`/
`computeStandings`, and the v1→v2 storage migration. Extend it rather
than deleting it when you touch the engine or storage — it's cheap
insurance against exactly the kind of off-by-one that this codebase is
full of (over boundaries, strike rotation parity, free-hit timing).
Note that `DB`, `STORAGE_KEY`, and `LEGACY_KEY` are declared with `var`
specifically so `test.js` can reach them as `win.DB` etc. — a classic
(non-module) script only exposes top-level `var`/`function` bindings on
`window`, not `const`/`let`, so don't "clean up" those three back to
`const` without checking what breaks.

For UI changes, drive the actual page in a browser (Playwright/
`chromium-cli` against a local `serve .`) rather than trusting the
engine tests alone — the null-slot-driven modal sequencing in `render()`
is the kind of thing that looks right in isolation and breaks in
practice.

## Cloud accounts & Supabase

Cloud features (clubs, tournament organizing, player claiming — see the
implementation plan for the full roadmap) are layered on top of the
originally 100%-local app via Supabase (Postgres + Auth + Row Level
Security), added in the `CLOUD` section of `index.html`. Two constants,
`SUPABASE_URL`/`SUPABASE_ANON_KEY`, gate all of it — left blank (the
default in this repo), `initAuth()` returns immediately, no network
request is made, and every screen behaves exactly as it did before cloud
work started. **Local guest scoring must never be made to depend on
these being set.**

`supabase-js` is loaded dynamically (`loadSupabaseLib()`), not via a
static `<script src>` tag — a static tag blocks the parser on that
fetch, which stalls the whole inline script (including `createMatch` and
friends) until it resolves or times out. This bit `test.js` once already
(a 50ms boot wait isn't enough to wait out a network fetch); don't
reintroduce a static Supabase `<script>` tag.

`session`/`profile`/`isAdmin`/`supabaseClient` are plain top-level `let`
bindings, not fields on `state` or `ui`, and deliberately so:
- `state` is JSON-serialized whole by `DB.save()` — a Supabase session
  object has no business in that blob, since `supabase-js` persists its
  own session separately (see `makeCloudAuthStorage()`, which routes
  that persistence through the same `window.storage` → `localStorage` →
  memory tiers `DB` itself resolves, via `DB.rawBackend`).
- `ui` gets wholesale-reset (`ui = defaultUi()`) at a few points, e.g.
  finishing a match — putting session state there would silently sign
  the UI "out" (until the next auth refresh) every time a match ends.

One consequence worth knowing if you write jsdom-based tests against
this: top-level `let`/`const` bindings (unlike the `var`-declared `DB`/
`STORAGE_KEY`/`LEGACY_KEY`) are **not** reachable as `win.session` etc.
from outside the page's own script realm — that's standard JS behavior
(global `let`/`const` land in the lexical environment record, not on
`window`), not a bug. To poke them from a test, inject and run a script
*inside* the jsdom document (`doc.createElement("script")` with
`textContent`, appended to `doc.body`) so it shares the same global
lexical scope, rather than assigning `win.session = ...` directly.

Schema/RLS migrations for each cloud milestone live in `supabase/`
(`001_accounts.sql` for Milestone 1 — profiles, the platform-wide
`admin_users` table, and the auto-provisioning trigger on
`auth.users`), run by hand in the Supabase SQL editor. There is no
migration tooling/CLI wired up — add new files there in order as later
milestones land, and don't collapse them into one file retroactively.

## Deployment

See README.md — static hosting, any provider, HTTPS required for the
service worker. No secrets: the Supabase anon/public key embedded for
cloud features is meant to be public (all access control is enforced
server-side by Postgres Row Level Security policies, not by keeping
that key secret) — don't confuse it with a service-role key, which must
never appear in this client-side file. Still no environment variables
and no application server of our own — Supabase is a hosted backend we
call directly from the client, not a backend we run.
