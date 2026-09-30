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
   below), `DEFAULT_MATCH_PRESETS`/`DEFAULT_TOURNAMENT_PRESETS`, the
   built-in presets seeded into storage on first run, and `THEME_PRESETS`
   (the Settings screen's theme gallery — see "Theme & sound" below).
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
   a modal on top when needed, and four delegated listeners (`click`
   via `data-action`, `submit` via form `id`, `change` for the
   tournament team-checkbox list and photo pickers, `input` for the club
   add-player sheet's platform suggestions) attached once at boot.

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
- Either sheet can be closed with **Pick later** (or the back button) so the
  scorer can use the menu, match options or scorecard meanwhile:
  `ui.pickDismissed` holds `pendingPickKey(match)` (innings/balls/wickets/
  slot), so the sheet stays closed only for *that* pause, and the live
  screen shows a `+ Pick batsman/bowler` chip (`reopen-pick`) in the empty
  slot. Any run/extra/Wicket tap calls `reopenPick()` first and records
  nothing — scoring still can't happen with a null slot.
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

**Both `inn.currentOverEvents` entries and `inn.fallOfWickets` entries
carry a raw number (or name) alongside their display string**: each
`currentOverEvents` push includes `runs` (that ball's `ballRuns`, bat +
extras, whatever it was worth), and each `fallOfWickets` push includes
`balls` (`inn.legalBalls` at the moment of the wicket) and `batsman`
(the name of whoever was actually given out — `outName`, a local set in
both branches of `recordBall`'s wicket handling *before* the slot gets
nulled, since the null slot only says which end is vacant, not who was
there). None of these are used by `display`/`over`/`howOut` (the
pre-existing display strings) — they exist so the live-scoring screen
can compute an over's run total and the current partnership's
runs/balls (`inn.runs`/`inn.legalBalls` minus the last `fallOfWickets`
entry's `score`/`balls`, or minus zero if none have fallen yet) without
re-parsing a display string, and so the new-batsman modal's dismissal
banner (`c NAME b BOWLER · runs (balls)`) can look up
`inn.batting.stats[fallOfWickets.at(-1).batsman]` directly instead of
guessing from batting order. If you add a new event kind, give it a
`runs` value too, even if it's 0 — don't leave it `undefined`, since the
over-total is a plain sum.

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

**Optional limits & last man stands.** `oversLimit` and `playersPerSide`
may be `null` ("no limit" — a blank field in the preset/match-setup forms,
parsed by `parseOptionalLimit`, re-filled by `limitInputValue`). A null
`playersPerSide` gives `inn.maxWickets = null` (can't be bowled out); a
null `oversLimit` means no overs cap, so the live screen shows an "End
innings" link (asks first via `askConfirm`, see "Confirmations" below) that calls `endInnings()`
(`completeReason: "closed"`). The same button (`renderEndInningsButton`,
gated by `canEndInningsByHand(inn)` — no overs limit *or* no players limit)
also sits at the bottom of the new-batsman and new-bowler sheets, which
otherwise block everything until a name is entered; in the 2nd innings it
reads "finish match" and `afterBall` produces the result as usual. Never compare against these directly — use
`isAllOut(inn)` / check `oversLimit != null` (`x >= null` is `true` in JS).
`lastManStands` (preset + match flag, copied onto each innings) makes
`maxWickets = playersPerSide`; one wicket short of that, `battingAlone(inn)`
is true, `pendingBatsmanSlot` asks for nobody, and the end of `recordBall`
puts the lone batter back in `striker` with `nonStriker = null` — this runs
*after* both unconditional swaps, it doesn't replace them. The run-out end
picker hides the non-striker tile when that slot is empty. `matchResult`
omits the wickets margin with no players limit and "overs left" with no
overs limit.

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

## A player can't be on both teams in one match

A match stores no rosters (names are typed freely), so a name's side is
*inferred* by `playerTeamInMatch(match, name)` from where it has already
been used: batters belong to that innings' batting team, bowlers and
fielders to its bowling team (case-insensitive). `playerSideConflict(match,
name, teamKey)` turns that into an error string, and every place a name is
entered calls it before recording anything: openers and the first bowler
(`handleOpeningSubmit`, which also rejects one name typed as both batter
and bowler in the same form), `handleNewBatsmanSubmit`,
`handleNewBowlerSubmit`, and the catch/run-out taker in
`handleWicketFielderSubmit` (checked against the *bowling* team). Both
helpers live in ENGINE and are covered in `test.js`. If you add another
place a name can be typed, run it through `playerSideConflict` too — and
note the quick-pick bowler rows (`confirmNewBowler`) skip it only because
they list this innings' own bowlers by construction.

Not covered: the saved Teams screen (`state.teams[x].playerIds`) still
lets one player sit on two saved teams, and `#players-datalist` still
suggests everyone regardless of side — the check fires on submit, not while
typing.

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
directly. The UI trigger (`askForfeit()` → the shared confirmation sheet,
`ui.confirm`) is checked *before* every other modal branch in `render()`,
so it can interrupt any of them at any time. Two consequences worth remembering if you touch this:
- `renderResult` guards `match.innings[1]` before rendering its
  scorecard (`match.innings[1] ? renderInningsSummary(...) : ""`) — a
  first-innings forfeit means it doesn't exist. Don't remove that guard.
- `computeStandings` handles `match.forfeited` matches in a completely
  separate branch: they count for played/won/lost/points, but are
  **excluded** from the NRR accumulation (partial, forcibly-ended
  innings would skew it). If you change how standings fold in normal
  matches, check the forfeited branch still makes sense alongside it.

`askForfeit()` passes the two teams as the confirmation's `choices`, so
picking a team and confirming are deliberately two separate taps rather
than firing on the first tap — unlike the wicket modal's simple types,
a forfeit has no working undo path in practice: `pushSnapshot()` does
run first, but the Result screen it lands on has no Undo control, so
there's no way to actually walk it back once it lands. `forfeitTeamLine()`
(next to it) reports each team as `"Batting · R-W"` (the current,
in-progress innings), `"Bowling · R-W[ all out]"` (a team that has a
past, completed innings — including at the break, where they're
prospectively bowling next), or `"Yet to bat"` (no `innings` entry for
that team key at all) — this one function covers every point
`forfeitMatch` can fire from, so don't special-case "at the break"
separately from "mid-second-innings."

## Navigation: `state.view` vs `match.status`

Screen selection in `render()` checks `state.match` *first*: if a match
is in progress (`status !== "complete"`) you get the live/innings-break
screen — **unless `ui.awayFromMatch` is set**, in which case the normal
`state.view` chain runs instead. The menu (☰) stays in the top bar during
a live match; tapping any side-menu item sets `ui.awayFromMatch` (in the
`click` handler, next to the code that closes the drawer), and the match
is resumed via the top bar's green "Live · A v B" pill, a "Live match"
side-menu item, or Home's "Resume live match" card (all `resume-match`).
`awayFromMatch` lives in `ui`, deliberately **not** persisted: a reload
always lands back on the match (whatever the URL said — see "Page navigation"), so a scorer can never be stranded on
another screen with a match silently running underneath. While away,
`render()` suppresses every match modal (opening/batsman/bowler/wicket/
forfeit/match options), the ⋯ match-options icon is hidden, and match creation is blocked —
`renderMatchSetup` shows a "Match in progress" card and
`handleMatchSetupSubmit` returns early, so nothing can overwrite
`state.match`. Result (`status === "complete"`) is unchanged: it still
has no menu and exits only through its own "New match"/"Back to…" button.
If you add another path that calls `createMatch`, guard it the same way.

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

## Live scoring screen

**It is one fixed viewport — no page scroll.** `render()` toggles a
`live-mode` class on `#app` (in-progress, not away, not innings break):
`#app` becomes a `100dvh` flex column, the top bar and cards keep their
natural height, and the run pad (the only flexible child,
`flex:1 0 100px` with `grid-auto-rows:1fr`) stretches to fill what's
left. Two `max-height` media queries (760px, 700px, scoped under
`#app.live-mode` so they beat the later component rules) drop the
previous-over row and partnership row and shrink paddings so it still
fits on 640–667px phones; the "Show full scorecard" expansion is the one
thing allowed to outgrow the screen, so `.screen.live` scrolls
internally. The top bar is `position:relative` in live mode — `sticky`
inside an `overflow:hidden` container offsets by the container's padding
and overlaps the first card. If you add content to this screen, re-check
it at 360×640 and 375×667, not just a tall phone.

`renderLive()`'s run pad is `[0,1,2,3,4,5,6]` plus an `UNDO` tile, laid
out as a 4-column `.run-pad.small` grid (8 tiles, 2 rows) — `5` was
added and the old separate "Wicket + Undo" `.action-row` pair was
folded into this one grid (`UNDO` is just another tile now, styled with
`.run-btn.undo`). **There is deliberately no "7+" custom-runs tile yet**
— a Design-canvas mockup for this screen included one, but entering an
arbitrary run count needs a small input flow the app doesn't have at
all today (no way to record, say, "8 off the bat" from an overthrow);
don't wire a `data-runs="7"` button to `handleBallClick` as a
stand-in, that would silently record the wrong number. Build a real
custom-runs input first if this is ever added.

`renderOverRow()` (next to `ordinalSuffix()`, just above `renderLive`)
draws one row of the ball-by-over rail — the *current* over from
`inn.currentOverEvents`, and the *previous* one (dimmed) from
`inn.overs[inn.overs.length - 1].events` when it exists. It always pads
to `inn.ballsPerOver` slots (dashed placeholders past whatever's been
bowled), so an 8-ball preset renders 8 slots with no other change. The
extras row (`Wide`/`No ball`/`Bye`/`Leg bye`) also adapts its own
column count to however many are enabled for the match (`match.wideEnabled`/
`noBallEnabled`; bye/leg-bye are always offered), rather than a fixed
4-up grid with a gap when one's disabled.

## Match options: cancel, reversed toss, switching players

The top bar's ⋯ (and a link on the opening sheet) opens `renderMatchMenuModal`
— one sheet whose content follows `ui.matchMenu` (`"menu"`/`"squads"`),
checked in `render()` *before* the opening/batsman/bowler sheets so it can
interrupt any of them (`handleUndo` resets it). Its risky rows — toss
restart (`askSwapToss`), forfeit (`askForfeit`), cancel (`askCancelMatch`) —
close the menu and open the shared confirmation sheet.
- **Change who bats first** → `swapToss()` → `restartMatch(match, other)`
  (ENGINE): the same fixture from ball one, every playing condition kept, and
  the UI-only extras in `MATCH_CARRY_FIELDS` (`clubId`, `matchType`,
  `squads`, `guestNames`, `opponentName`) copied over — add a field there if you add
  another UI-only match field that must survive a restart. Before anything
  is recorded (`matchHasStarted` false) it flips at once (the opening sheet's
  "Wrong toss?" link); after, the sheet asks first. Either way it
  `pushSnapshot()`s, and the opening sheet now shows Undo whenever snapshots
  exist, so a restart can be walked back.
- **Cancel match** → `cancelMatch()` → `leaveMatch()` (shared with Result's
  exit button): just drops `state.match`. Nothing is archived or synced,
  because archiving only happens on completion. No undo. Players already
  registered to a club roster during the match stay there.
- **Switch players** (only when `match.squads` exists) → `moveSquadPlayer` /
  `addSquadPlayer` (ENGINE, tested): change this match's squads only, never
  the saved tournament teams, and refuse anyone who has already batted,
  bowled or fielded (`playerHasPlayed`) — they'd end up on both sides.
- **Forfeit** opens the existing forfeit sheet.

## Loading indicators ("activity")

Outside live scoring, every network wait shows up automatically — nothing
per screen. `initAuth` passes `global: { fetch: trackedFetch }` to
`createClient`, so every Supabase request (data, RPC, auth) bumps one
in-flight counter (`activityStart`/`activityEnd`). After a 150ms grace (fast
calls don't flash):
- `body.is-busy` shows the thin `#top-progress` bar (static element outside
  `#app`, `pointer-events:none`), and `#busy-status` announces "Loading…" to
  screen readers;
- the button that started it gets `.is-loading` (spinner, label hidden, no
  second tap). The tap is captured in a capture-phase click/submit listener
  as a *descriptor* (`data-action` + `data-id`, or the form id), and
  `applyActivity()` re-finds it after every `render()`, so the spinner
  survives the screen re-rendering. A tap only owns the activity if a request
  starts within 400ms, so background sync never spins an unrelated button.
- `loadingHtml(text)` is the spinner placeholder for "nothing to show yet"
  (it replaced the plain "Loading…" hints).
`render()` sets `body.live-scoring` whenever a match is on screen (in
progress, not away), which switches all of this off: scoring stays instant.
The animations only run while something is loading (never on an idle,
always-visible control — see "Theme & sound"), and slow down under
`prefers-reduced-motion`. Don't add a new cloud call that bypasses
`supabaseClient`, or it won't be tracked.

## Confirmations: one shared sheet

Every "are you sure?" goes through `askConfirm({...})` (UI, next to
`renderSideMenu`), which sets `ui.confirm` and renders `renderConfirmModal()`
into its own `#confirm-root` layer **above every other sheet** — the sheet
underneath stays in the DOM (typed input included) while it asks. Options: `title`, `body` (trusted
HTML — escape names), `confirmLabel`/`cancelLabel`/`busyLabel`, `icon`,
`tone` (`"danger"` default, `"primary"`), optional `choices` (a required pick
before confirm is enabled — forfeit's team), `onConfirm(choice)` (return
nothing to close, `{ error }` to stay open with a message, or a Promise of
either — the sheet shows `busyLabel` meanwhile) and `onCancel`. Esc cancels.
It currently covers: end innings, toss restart, forfeit, cancel match,
remove club player, delete tournament team, discard unsaved team edits,
delete guest team/player, delete match/tournament/club presets. **Don't add
`window.confirm()` or "tap again to confirm" buttons** — use `askConfirm`.
The wicket sheet's Confirm button is data entry, not a confirmation, and
stays as it is. `admin.html` keeps its own typed-confirmation prompts (it's
a separate page).

Re-rendering a sheet that carries `data-keep-scroll="<key>"` (the confirm
sheet, the team builder, and every in-match sheet: opening, new batsman/
bowler, wicket, match options) keeps its scroll position and adds `.no-anim`, so a
tap inside doesn't jump to the top or replay the slide-up animation. **Give
any new sheet a `data-keep-scroll` key**, or taps inside it will flicker.
`render()` also skips the backdrop fade when a sheet was already open
(sheet → sheet), the `.screen` settle on a same-screen re-render
(`#app[data-screen-key]`), the score pulse when the score didn't change,
and the pop on over-row chips already shown (`data-chip`).

## Page navigation: URL routes & the back button

Every screen has a hash route (`ROUTES`, UI section: `#/`, `#/teams`,
`#/clubs/<id>`, `#/clubs/<id>/players/<pid>`, `#/clubs/<id>/tournaments/<tid>`,
`#/premier/players/<pid>`, `#/live`, `#/result`, …), so back, forward, reload
and a pasted link go through the browser's own history. **Existing code
doesn't change:** it still sets `state.view` (plus `ui.currentClubId` /
`currentTournamentId`, `state.activeTournamentId`, `ui.profile`) and calls
`render()`; `syncRoute()` at the end of `render()` builds the URL
(`routeFor()` → `buildRoute`) and records it. `popstate` goes the other way:
`applyRoute()` parses the URL (`parseRoute`) and sets that state, then
`render()` lazy-loads whatever the screen needs (club, tournament, Premier data,
a profile via `ui.profile.pending` → `loadPlayerProfile`). **Adding a screen:
add a `ROUTES` row** (and a lazy load in `render()` if it fetches) — nothing
else. `navKey()` gives `"match"` (in progress, not away), `"result"`, or
`state.view`; going to any non-live route mid-match sets `ui.awayFromMatch`,
and history-navigating off Result finishes that (already archived) match.

History rules — these are what make it work on phones:
- **Chrome skips history entries added without a user gesture** (back jumps
  straight out of the app). So an entry is only *pushed* while
  `navigator.userActivation.isActive` (a tap/key); redirects and async results
  *replace*. Nothing is pushed at boot or while handling a back/forward press
  (`navApplying`). The old one-entry "trap" was armed on `pointerdown`, which
  isn't a gesture for touch — that's why back didn't work on phones.
- **Opened straight onto a screen** (reload, relaunch, a link), the first tap
  runs `ensureNavBase()`: that entry becomes Home and the screen is pushed on
  top, so back lands on Home instead of closing the app (matters mid-match).
- **Replaced, never returned to:** setup screens and Result (`NAV_TRANSIENT`),
  Live → Result, sign-in/up once signed in, and whatever `leaveMatch()` leaves
  (`navReplaceNext`). Home is the first entry, so back at Home exits the app.
- **Sheets get their own entry** (same URL, `overlay: true`) when opened by a
  tap (`overlayOpen()`: confirm, side menu, sync sheet, player modal, team
  builder, match options, wicket sheet), so back closes them even on the first
  entry; closing one by tap pops its entry again. The auto-opened pick sheets
  aren't overlays — `interceptNav` handles them.
- **Intercepted moves** (`interceptNav`, most specific first): close the top
  sheet (`closeTopOverlay`) → the live match's pending extra / pick sheet
  ("Pick later") / expanded scorecard → **"Leave live scoring?"** → in-screen
  sub-forms (preset editors, claim/merge) → unsaved input ("Discard your
  changes?", `formIsDirty`). The move is undone with `history.go(-delta)`
  (`navSettling` swallows the resulting popstate) and, on confirm, redone with
  `navBypass`. While it's being undone the URL isn't the screen's, so
  `syncRoute()` does nothing (`navHold`/`navSettling`) — writing then would
  overwrite the wrong entry.
- **On-screen back bars** (`go-view` on `.back-bar` → `backBarTo`) really go
  back when the previous entry is their target, otherwise replace this entry;
  both ask first about unsaved input (`leaveScreen`).
- **Typed input survives re-renders**: `captureFormDrafts`/`restoreFormDrafts`
  carry edited fields of each `form[id]` in `#app`/`#modal-root` across the
  `innerHTML` swap — only when the re-render left that field's default alone
  (so a preset pick still re-fills overs), and never for a just-submitted form
  (`data-submitted`, cleared on the next edit). Mark a control or container
  `data-nav-ignore` if it shouldn't count as unsaved input.
- Playwright's `goBack()` doesn't apply Chrome's skip rule, so it can't prove
  the gesture rule — test with `devices["Pixel 5"]` + `tap()` for the logic,
  and on a real phone for the rule itself.

## Innings break screen

`renderInningsHighlights(match, inn)` (next to `renderInningsSummary`)
is a **separate, condensed** view — top 3 scorers, top 2 bowlers,
extras inline — just for `renderInningsBreak`. It is not a replacement
for `renderInningsSummary`'s full batting/bowling tables, which Live's
"Show full scorecard" toggle still shows exactly as before. It reuses
the Live screen's `.matchup-head`/`.matchup-row`/`.partnership-row`
classes, since those are just a plain eyebrow-header-plus-data-rows
layout with nothing live-scoring-specific about them.

## Result screen

`renderResult()` defaults to condensed too, via a **third**, even
smaller view — `renderResultInningsCard(match, inn)`, one combined card
per innings (2 top batters + 1 top bowler, no extras line) — reusing
the same `ui.showFullScorecard` flag Live's toggle already uses, not a
new one. Toggling it swaps both innings between this condensed pair and
`renderInningsSummary`'s full tables, so nothing is ever permanently
lost — this matters because "Export PDF" is just `window.print()` on
whatever's currently in the DOM (see "Share & export" above): printing
without expanding first prints the condensed cards, which is a real,
visible consequence of this default, not a hidden one. `renderResultInningsCard`
is its own function rather than a parameterized `renderInningsHighlights`
call — its shape (one combined card, 2 batters/1 bowler, no extras) differs
enough from the innings-break version (two cards, 3/2, extras line) that
sharing one function would need more branching than just writing both.

`renderResultDetail(match)` (the "186-5 (19.1) chasing 185 · 5 balls
left" line under the result headline) is computed fresh from the raw
innings numbers, not reparsed from `match.result` — `match.result`
stays exactly the sentence `matchResult()`/`forfeitMatch()` produced,
since standings/fixtures read that string verbatim. It renders nothing
for a forfeited match (no real chase to describe) or when
`match.innings[1]` doesn't exist (a first-innings forfeit — same guard
the scorecard section already needs). `renderResultInningsCard` picks
the *winning* team's score to highlight in green the same way: compare
`i1.runs`/`i2.runs` directly, and show no highlight at all for a tie or
a forfeit.

## Match Setup, Presets & Tournament Dashboard

**Match Setup and the tournament Fixtures tab's "start a match" form stay
fully editable, on purpose** — a Design-canvas mockup for Match Setup
showed a chosen preset's conditions as a read-only confirmation card,
with a separate "Custom…" chip needed to unlock editing. That was
deliberately not adopted: picking a preset still just pre-fills every
field (`ballsPerOver`/`overs`/`players`/wide/no-ball/free-hit/fielder
checkboxes), and every field stays directly editable inline, same as
before this pass. Don't reintroduce a locked/read-only conditions panel
without discussing scope — it would remove the "start from T20 but tweak
overs to 15 just this once" flow, which today needs no saved preset at
all. `.tile-fieldset` (both screens' "Who bats first?" fieldset) is
purely a CSS reskin of that same idea, not a step toward locking
anything — it's still a real, submittable `<input type=radio>` group,
just styled as two tiles instead of native bullets via `label:has(input:checked)`.

`renderMatchPresetsTab()`/`renderTournamentPresetsTab()`'s "BUILT IN"
badge is informational only (id-matched against `DEFAULT_MATCH_PRESETS`/
`DEFAULT_TOURNAMENT_PRESETS`) — it does not gate Edit/Delete. Once
seeded, a built-in preset is an ordinary preset the user can freely
change or remove (see "Storage schema & migration" above); don't wire
the badge into any permission check.

**The Tournament Dashboard has no "next scheduled fixture" card**, even
though its Design-canvas mockup showed one (`"Sinhalese SC v Moors SC ·
Round 7 · not started"`). There's no data to draw it from: a tournament
(`createTournament`) only ever holds `teamIds` and `matchIds` (matches
already played) — there's no generated round-robin schedule, no concept
of "rounds," and fixtures are created ad hoc by picking any two teams
whenever a scorer wants (see `renderTournamentFixtures`'s own
team-picker form). Fabricating a "next up" fixture would mean guessing
at a schedule that doesn't exist. The dashboard's persistent "Start a
fixture" button (visible on every tab except Fixtures itself, and only
when `!state.match`) just jumps to the Fixtures tab, where that existing
ad hoc form already lives — it doesn't relocate the form itself.

## Home, Teams & Stats vs. their Design-canvas mockups

Home gained a "Recent matches" section (latest 3 of `state.matchHistory`
by `completedAt`) and a "stored on this device" footnote — both need
only existing data. Stats now leads with the MVP leaderboard
(`.leaderboard.mvp`, gold-tinted, with M/Runs/Wkt/Pts columns) and ends
with an "archived matches only" footnote. `renderLeaderboards` is shared
with the tournament Stats tab and club home, so they pick this up too.

Deliberately **not** adopted from those mockups, each because it needs
something the app doesn't have (or would remove working behavior):
- Home dropping Players / the club switcher to four cards — those are
  real entry points. (Settings *was* removed from Home on request: it's
  reachable only from the side menu, `view: "settings"`. Don't re-add it.) (My clubs *was* removed from Home and the
  side menu on request: it is now reachable **only** through Account's
  "My clubs" button, `go-my-clubs`. Don't re-add it to either.)
- A combined "Teams & players" screen with an expandable team card and
  an all-players search box — Teams and Players are separate screens,
  and a live search field there would need its own handling — the one
  delegated `input` listener is scoped to the club add-player sheet's name
  field (see "Nickname, jersey no…" below), not a general search hook.
- Highest-score ("HS") and best-bowling ("BEST") columns, and the
  All-time/tournament scope chips on Stats — `aggregatePlayerStats`
  doesn't track per-innings bests, and Stats has no scope state.

## Theme & sound

The visual theme lives entirely in `:root` CSS custom properties at the
top of `<style>` (`--bg`, `--panel`, `--accent`, `--accent-2`, radii,
shadow tokens) — retheme by changing those, not by hunting through
component rules. `THEME_PRESETS` (REFERENCE DATA) only overrides the
*color* variables (`--bg`/`--panel`/`--text`/status colors, applied by
`applyTheme()`); the *structural* tokens below it (`--radius-*`,
`--shadow-card`, `--shadow-btn`) are shared by every preset, which is
why a redesign of the shape language doesn't need to touch
`THEME_PRESETS` at all.

The current visual language is flat, not glass: panels are a solid/
translucent fill with **no `backdrop-filter`**, 2px borders, and hard,
unblurred offset shadows (`--shadow-card`/`--shadow-btn`, e.g.
`3px 3px 0 rgba(0,0,0,.35)`) instead of the soft blurred glow this app
used to have. The one deliberate exception is `.modal-backdrop`, whose
blur is a scrim behind the bottom-sheet modals, not a panel surface —
don't add `backdrop-filter` back to card/panel classes without a reason,
and don't remove it from `.modal-backdrop` by "consistency" reflex.
`.modal` itself (the sheet, not the scrim) got the same 1px→2px border
bump as everything else once modal content started actually using the
flat-design language (`.modal.danger` — the forfeit sheet — needed a
colored 2px border to read as a variant, which a 1px border couldn't
carry as clearly).

**Home's bento grid is one CSS rule, not per-screen markup:**
`.home-card.primary-card { grid-column: 1 / -1 }` makes whichever card
carries `primary-card` span the full row as a hero tile, in *any*
`.home-grid` — Home, the Premier dashboard, club home all reuse the same
two classes and get the hero treatment for free. Don't hand-roll a
different hero layout per screen; give the card `primary-card` instead.
Similarly, `.home-card-icon`'s rotating accent-color badge (gold → blue
→ green → red) is assigned purely by CSS `:nth-of-type` position on
`.home-grid button.home-card:not(.primary-card)` — there's no per-card
color field in the data or markup, so reordering or adding cards just
re-cycles the same four colors rather than needing a color choice per
card. `.brand-highlight` (the rotated sticker behind the Home wordmark)
is likewise pure decorative CSS with no JS behind it.

**Shared plain-screen primitives — reuse these instead of ad hoc markup
when a screen needs a section divider, a lone form, or a settings-style
row:**
- `.section-label` — the uppercase-eyebrow-with-bullet look (same as
  `.home-section h3`) for a bare in-page section heading, e.g. `<h3
  class="section-label">Roster</h3>` in club home or Settings. Don't
  leave a section heading as a plain unstyled `<h3>`.
- `.auth-card` — wraps a standalone form/profile block (sign in, sign
  up, account) in the same bordered-panel language every other screen
  uses, instead of a form floating directly on the page background.
- `.settings-row` — a bordered row for one labelled setting + its
  control (see the Sound row in Settings); pairs with `.settings-row-label`/
  `.settings-row-sub` for the two-line label.
- `.avatar-badge` — a circular initial badge (Account screen); purely
  decorative, computed from `profile.display_name` or the session email.
- `.tab-row`/`.tab-btn` (tournament dashboard tabs, presets tabs) render
  as solid chip toggles now, not underlined text tabs — same visual
  family as `.preset-chip`.
- `.leaderboard` (used by `renderLeaderboards`, shared across Stats, the
  tournament dashboard's Stats tab, and club home) is a bordered card per
  table now, not a bare table with a heading — and `tbody tr:nth-child(even)`
  zebra-striping is a global `table` rule, so any new table picks it up
  automatically.

`renderTopBar(canNavigate, onAuthScreen)` (next to `renderBackBar`, in
`UI`) is the **single sticky nav row** — hamburger-menu button (left,
only when `canNavigate`), sign-in button and sound toggle (right) — that
`render()` prepends before every screen's own html. The account slot on
the right is a "Sign in" button when signed out and a 👤 icon button
(→ Account) when signed in — hidden on the auth screens themselves and
during a live match. Account is deliberately **not** a Home card: it's
reachable only from that top-bar slot and the side menu, so don't add it
back to `renderHome`. It replaced three
independently `position:fixed` buttons that used to stack at top-right
(sound/sign-in/menu, each floating on its own); if you add a new
always-visible nav control, add it inside `renderTopBar()` rather than
introducing another fixed-position floating button, or it'll drift back
into the same stacking mess this replaced. While a match is actually in
progress (`state.match && state.match.status !== "complete"`), the left
side swaps the hamburger for a pulsing `.live-dot` + `"TeamA v TeamB"`,
and a ⋯ "Match options" icon joins the right cluster (see "Match options"
below; forfeit is one of its rows) — this is also why the old
per-screen "Forfeit match" link was removed from the bottom of both the
live-scoring and innings-break screens, so don't re-add it there.
The hamburger shows whenever there is no match or one is in progress
(see "Navigation" above); it stays hidden only on the Result screen,
whose own "New match"/"Back to..." button is the way out — a side-menu
tap there would only set `state.view`, and `render()` would keep showing
Result until `state.match` is cleared.

`SFX` (next to `escapeHtml`, in `UI`) is a tiny synthesized sound
engine — plain Web Audio oscillators, no audio files, so it stays
inside the single-file/offline constraints. It's muted by
`state.soundEnabled` (persisted, default on) and toggled by the sound
button inside `renderTopBar()`. **Don't add an infinite CSS animation to
`.topbar-icon-btn`/`.topbar-signin`** (or any other always-on-screen,
always-clickable element) — one was tried on the old sound toggle and
reverted because it never lets the element's layout "settle," which
breaks Playwright/automation click-stability checks and is a mild UX
annoyance besides. A static or short, non-repeating animation is fine;
`infinite` on a persistent control is not.

## Editing dismissal types

`WICKET_LABELS` and the wicket modal's button list (the `types` array
at the top of `renderWicketModal`) are the two places a new dismissal
type needs to be added (e.g. "handled the ball", "obstructing the
field" — currently omitted as too rare to bother with). Both must
agree, and `recordBall`'s wicket branch needs to know whether the new
type behaves like a normal dismissal (clears `inn.striker`, always the
facing batsman) or like a run-out (clears whichever end the UI names).

`renderWicketModal()` is **one sheet**, not a menu screen that swaps to
a separate detail screen for caught/run-out — `ui.wicketFlow` doubles as
both "is the modal open" and "which type is currently selected"
(`"menu"` when open with nothing selected yet, or the type string once
one is). Tapping Bowled/LBW/Stumped/Hit wicket still calls
`confirmWicket(type)` immediately, same one-tap speed as always — there
being nothing to enter for those, a second confirm tap would only slow
down the common case. Only Caught and Run out set `ui.wicketFlow` to
themselves and grow the sheet (fielder box, and for run-out the
`ui.runoutEnd` end-picker + `ui.runoutRuns` picker) below the same type
grid, ending in a Confirm button — still exactly two taps for those two,
just without a full-screen swap. If you add a type that needs its own
extra input, follow this pattern (extend the sheet, don't add a new
screen) and remember to reset any new `ui.*` field everywhere
`runoutEnd`/`runoutRuns` already get reset (`close-wicket-modal`,
`handleUndo`, and the runout success path in
`handleWicketFielderSubmit`) or it'll leak into the next wicket.

`renderNewBowlerModal()` lists every bowler in `inn.bowling.order` as a
**one-tap row** (name + figures) via `confirmNewBowler(name)` — shared
by both that click path and `handleNewBowlerSubmit`'s form path, so the
"can't bowl two in a row" check only needs to live in one place
(`handleNewBowlerSubmit` still re-checks it for the typed-name path;
`confirmNewBowler` itself also guards it, so a stray `pick-bowler` call
can't bypass it either). The previous over's bowler
(`inn.lastOverBowler`) is filtered out of that tappable list and shown
separately, struck through and disabled — don't just disable their row
with the same styling as the others, the mockup (and the current CSS)
deliberately makes it read as "not an option" rather than "option,
temporarily off."

**In-match name boxes are a search-select, not a `<datalist>`.** Native
datalist popups proved unreliable on phones (options showed but couldn't be
tapped inside the bottom sheet), so the opening, new-batsman, new-bowler and
fielder inputs have no `list` attribute; `renderNameCombo()` puts our own
`.combo-list` under each, hidden until the input is focused, narrowed by the
delegated `input` listener, closed on `focusout` (delayed; `pointerdown` on
an option is cancelled so the input keeps focus). A tap (`combo-pick`) only
fills the input — the form's own button still submits, so every check in
`handleOpeningSubmit`/`submitNewBatsman`/`submitNewBowler`/
`handleWicketFielderSubmit` applies. All DOM-only, never `render()`. Options
come from `pickPool(teamKey)` (the side's squad → else the club roster /
guest list → nothing for a friendly's visitors) filtered by the pure
`pickCandidates(match, pool, role)` in ENGINE (tested): batters drop anyone
out/at the crease, bowlers drop anyone who's already bowled (they keep their
figure rows) and the last-over bowler, every role drops names already on the
other side. Other forms (setup team names, guest Teams) still use datalists.
In a club match each option also carries the roster's nickname and `#jersey`
(`rosterEntryFor` → `data-search`), so typing either narrows the list, and
every in-match submit (openers, new batsman/bowler, fielder, Switch players)
passes the typed text through `resolveTypedName` → the pure
`resolvePlayerAlias(value, roster)` (ENGINE, tested): an exact name wins,
else a nickname or `#7` matching exactly **one** roster player becomes that
player's name; an ambiguous or unknown value stays as typed. This keeps a
typed nickname from being recorded as a brand-new player. Guest mode has no
nicknames, so nothing changes there.

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

Adding a player to a club roster goes through the
`add_player_to_club(_club_id, _name)` RPC (`supabase/005`, redefined in `009`
to return `{ id, created }`), which finds the player in the global `players`
table by exact, case-insensitive name (or a merge alias), **creates them there
if they aren't** (so they appear on the Premier screens too, with the adding
club recorded as `origin_club_id`), and adds the `club_rosters` row — all
in one server-side step. `created` matters: only a *new* player's profile is
editable by the adding club (see "Ownership, claiming & merging" below). It has to be an RPC: the base `players` table is
only readable by the claimant or an admin (so `phone` can't leak), which
means a client-side `insert(...).select()` of a brand-new global player is
rejected by RLS for ordinary users. Don't put the two-step
find-or-insert back in the client, and don't go back to `ilike` for the
name match (it treats `%`/`_` in a name as wildcards). If the migration
hasn't been run, `addPlayerToClub` surfaces a "run 005" message instead of
failing silently.

**Guest data and club data are kept apart.** `state.players`/`state.teams`
are the guest (on-device) lists and are only ever offered in guest matches.
In a club match (`match.clubId`), `registerMatchPlayer(name, teamKey)` — the
one function match-time name entry goes through (openers, new batsman/
bowler, catch/run-out taker) — never touches them: the club's own side is
added to that club's roster and the global players table via
`addPlayerToClub` (005), and a **friendly's visiting side (team B) goes to
the global table only** via `addGlobalPlayer` → `ensure_global_player`
(`supabase/006_ensure_global_player.sql`), because visitors aren't members
of the home club. Practice and club-tournament matches are the club's own
people on both sides. Because both RPCs match the global table by exact
case-insensitive name, one person is one global row and can be on any number
of clubs' rosters. `suggestionPlayerNames()`/`suggestionTeamNames()` feed the
two datalists: guest lists normally, the club roster / the club's own name
in a club match or club match-setup, so guest names never surface inside a
club and vice versa. `render()` lazily loads `ui.club` for a club match (once,
guarded by `ui.clubRosterLoading` — it survives a reload, `ui` doesn't).
**Guest players are strictly local.** They live only in `state.players` /
`state.teams` on the device, are only used in guest mode, and are never sent
to the cloud, added to any club, or added to the global (Premier) list —
nothing in the guest path calls Supabase. To keep that boundary visible:
while "Acting as" a club, Home swaps the guest Teams/Players tiles for a
"Club roster" tile (→ that club's cloud roster), and the guest Teams and
Players screens carry a "guest only" note. `purgeLeakedClubPlayers(st)` runs
once per device (`state.guestPlayersCleaned`, on `load()`) to remove the club
names that used to leak into `state.players`: a name is removed only if it
appears in a club match and nowhere guest (no guest match, not on a saved
local team). It's a name-based heuristic — a guest player who shares a name
with a club player and was never used anywhere else goes too; guest players
are temporary, so that's re-created by typing the name.
`purgeLocalClubMatches(st)` is a second one-time, per-device purge
(`state.clubDataReset202609`), added when the cloud's clubs, players and
matches were wiped: it drops every `matchHistory` entry with a `clubId` and
clears `activeClubId`, leaving guest matches and a match in progress alone.
Fresh and legacy installs get the flag set to `true` in `load()` (nothing to
purge), so it can never eat club matches scored after the wipe. Don't reset
the flag for a future wipe; add a new one.

**"Recent matches" and guest Stats are role-scoped too, never mixed.**
`state.matchHistory` holds every match archived on this device, guest and
club alike (club ones carry `clubId`), so each view filters it:
- **Guest** (Home, no club selected): `!m.clubId` only — and the guest Stats
  screen and Home's Stats-tile count use the same filter.
- **Club** (Home, "Acting as" a club): that club's matches only —
  `matchHistory` entries with `clubId === activeClub.id` merged by id with
  the cloud `ui.club.matches` (so a match scored on another device shows
  up); `render()` lazily loads `ui.club` for the selected club, guarded by
  `ui.clubRosterLoading`.
- **Premier** (its own screen, reached via the same switcher): the
  `level: "premier"` matches in `ui.premier.premierMatches`, under "Recent
  Premier matches".
`recentMatchesFor()`/`renderRecentMatches()` do the dedupe-sort-render for
all three; pass them an already-filtered list, don't widen the filter.

Known gaps: names entered in a club match while **signed out** aren't synced
(offline is fine now — see "Offline-first sync" below); outside a club tournament
there is no persistent club *team* entity (practice/friendly teams are just
the names typed at match setup) — see "Club tournament teams" below.

## Offline-first sync (outbox + read cache)

Everything a scorer does with club data works offline and syncs when the app
is next online. Three pieces, all in the CLOUD section:

- **Outbox** (`outbox`, storage key `cricket.lk.outbox.v1`, *not* inside
  `state`). Every club write goes through `submitCloudOp(kind, args)`: online
  with an empty queue it runs at once (so a form still shows e.g. "team name
  taken"); offline, on an offline session, or behind earlier unsynced ops it's
  queued. `syncNow()` replays this user's ops **in order** (re-reading the
  queue each step), stops at the first network failure, and marks a real
  database error `failed` (it waits in the sync sheet for Retry / Discard —
  failed ops are never retried or folded automatically). Triggers: boot,
  the `online` event, returning to the tab, a 60s heartbeat while anything
  is pending, and right after queueing. Kinds and their handlers live in
  `OP_HANDLERS`: `match`, `club.create`, `tournament.create`, `team.save`,
  `team.delete`, `preset.save`, `preset.delete`, `roster.add`,
  `roster.addExisting`, `roster.remove`, `global.add`. **To add a new club
  write, add a kind there and call `submitCloudOp` — never call
  `supabaseClient` directly for a write.**
- **Idempotent replays.** Creates carry client uuids (`newUuid()`; every such
  table's `id` is a defaulted uuid, `matches.id` is client text already), so a
  retry after a lost response hits a duplicate-*pkey* error, which `dupId()`
  treats as done. An update that matches no row (its create never made it)
  falls back to insert. `coalesceOp()` folds a second save of a team/preset
  into the pending one (keeping `isNew`), cancels create+delete of something
  never synced, and drops repeat roster/global adds of a name.
- **Temp player ids.** A roster add queued offline gets `tmp:<uuid>` so it can
  be picked into a team right away; when `add_player_to_club` returns the real
  id, `remapTempId()` rewrites every reference **in place** (queued ops,
  caches, the open team editor). `team.save` refuses to send a `tmp:` id (it
  fails with "waiting for X"), so a temp id can never reach the database.
- **Read cache** (`cloudCache`, key `cricket.lk.cloudcache.v1`, per user):
  the last server copy of `myClubs`, each club (`fetchClubDetail`, recent 30
  matches) and each tournament (`fetchClubTournamentDetail`), plus
  profile/isAdmin. Separate key on purpose — running out of storage there can
  never cost the scorer's `state`. Offline (or on a network error) the
  fetchers fall back to it; either way `overlayClubData` /
  `overlayTournamentData` (pure, tested) lay this user's pending ops on top,
  and the tournament overlay also folds this device's archived matches for
  it, so standings count a match scored offline. Pending items render with
  a "not synced" tag.
- **Offline sign-in.** `sw.js` (cache `cricket-lk-v7`) precaches the
  supabase-js CDN script and serves it stale-while-revalidate — keep its URL
  in step with `SUPABASE_JS_CDN_URL`. Offline, `supabase.auth.getSession()`
  can hang retrying a token refresh, so `initAuth` doesn't wait on it: it uses
  `storedOfflineSession()` (the user object from supabase-js' storage key),
  flagged `session.offline = true`; no request is ever made with it.
  `handleBackOnline()` (and a throttled check in `syncNow`) swaps in the real
  session. `onAuthStateChange` ignores a null session unless the event is
  `SIGNED_OUT`.
- **Online-only on purpose** (`needsInternet()`): sign in/up, inviting an
  admin, platform player search, profile contact/NIC and detail edits,
  claims/merges, Premier and player profiles, and the admin portal. The
  server has to look something up or check a rule there and then.
  `friendlyError()` (via `showFormError`) turns a raw "Failed to fetch" into
  an offline message.
- **Personal data.** Contact number / NIC are **never queued**: an offline add
  with either filled in is refused with a message (add without them, fill in
  later). Sign-out (`doSignOut`, which clears local state *before* calling
  supabase-js, since that can hang offline) wipes the read cache, because it
  holds members-only rosters and teams. Queued ops stay on the device, tagged
  with their `userId`, and only sync for that user; sign-out warns via
  `askConfirm` if any are pending.
- **UI:** `renderSyncPill()` in the top bar (offline / N to sync / syncing /
  N not synced — static, no infinite animation) opens `renderSyncSheet()`
  (`ui.syncSheet`), which lists each queued change (`describeOp`) with Retry
  and Discard (confirmed) for failed ones.
- **Conflicts** are last-write-wins per row. Two devices editing the same
  team offline: the later sync wins. A unique-name clash surfaces as a failed
  op.

## Roles: guest, club, Premier — separate data, nothing shared

Every kind of data belongs to exactly one role and each role's screens read
only its own:

| | Guest (this device) | Club (cloud, per club) | Premier (cloud, global) |
|---|---|---|---|
| Players | `state.players` | `club_rosters` → `players` (via `addPlayerToClub`) | `players_public` (everyone, incl. friendly visitors) |
| Teams | `state.teams` | `tournament_teams` per club tournament (012); otherwise names typed at match setup | derived from `level:"premier"` matches |
| Presets | `state.matchPresets` / `tournamentPresets` | `club_presets` → `ui.club.presets` | none (`PREMIER_STANDINGS_DISPLAY_PRESET` is fixed display config) |
| Matches | `matchHistory` where `!clubId` | `matches` where `club_id` (+ local archive with that `clubId`) | `matches` where `level = "premier"` |
| Tournaments | `state.tournaments` | `tournaments` where `organizer_club_id` | — |

The role is `state.activeClubId` (Home's "Acting as"); Premier is its own
screen. Rules that keep it clean: club setup screens read
`matchPresetChoices()` / `clubPresetList(kind, clubId)`, **never**
`state.matchPresets`; Home's tiles, its Tournaments list and the side menu
swap the guest Teams/Players/Presets/Stats entries for the club's own
**Players / Presets / Stats** (`clubPlayers` / `clubPresets` / `clubStats`
views, opened by `go-club-view` from `state.activeClubId`; each renders
through `renderClubScreen` and shows only that club's cloud data, with
`clubMatchesFor(clubId)` merging the local archive and cloud matches by id)
while a club is selected; `renderClubHome` (My clubs → a club) is now just
that club's admins, tournaments and match list. Club presets are edited on
`clubPresets` with the *same* forms (`renderMatchPresetForm(p, clubId)` etc.)
but their own actions (`club-*-preset`) and ui fields
(`editingClub*Preset`), and saved with `saveClubPreset` (a club's tournament
presets carry points config only — `matchPresetId` is unused there, match
presets are chosen at match setup). `matchPresetCardHtml`/`tournamentPresetCardHtml`
are markup-only and shared; pass each role its own list and action names.
`fetchClubDetail` is the single loader for a club's cloud data and `render()`
lazy-loads it for whichever screen needs it (one guarded block,
`ui.clubRosterLoading` — the fetch *in flight*, cleared when it lands, so a
club whose `ui.club` was dropped loads again). Club tournaments work the same
way (`ui.clubTournamentLoading`; a tournament that no longer exists falls back
to its club). Entry actions (`open-club`, `open-club-tournament`,
`leaveMatch`, `goToView`) just set the ids and render — don't add a second,
explicit fetch there. **Club screens survive a reload** through
`state.viewClubId`/`viewTournamentId`, which `render()` keeps in step with
`ui.currentClubId`/`currentTournamentId` on every club view (those `ui` ids
aren't persisted). Without them, a saved `view: "clubHome"` came back with no
id to load and spun on "Loading…" forever. With nothing to restore, `render()`
falls back to My clubs / Home rather than a spinner. Sign-out clears both. If you add a new kind of per-role data, add a row to
this table and don't fall back to the guest store for club/Premier.

**Player profiles (club + Premier).** Tapping a player on the club Players
screen or the Premier Players screen opens the `playerProfile` view
(`renderPlayerProfile`, state in `ui.profile`, not persisted): name, contact
number, NIC, and a career stats grid. Name and stats are public; **contact
number and NIC are personal data and are only ever returned by the database
to whoever may *manage* the profile (the claimant, platform admins, or — only
while unclaimed — members of the club that first added the player; see
"Ownership, claiming & merging")** — `supabase/007_player_profiles.sql`
adds `players.nic` and three SECURITY DEFINER functions
(`can_see_player_contact`, `get_player_profile`, `update_player_profile`);
everyone else gets nulls + `can_see_contact = false`, which the screen shows
as "Private". Never select `phone`/`nic` from the base table or add them to
`players_public`, and never gate visibility in the client alone — the client
just renders what the RPC returned (a signed-out visitor gets the public row
only). Editing contact details uses the same permission, and so does renaming
(see "Renaming a player" below). Field rules live in `normalizeNic` /
`isValidNic` / `isValidPhone` (Sri Lankan NIC: 9 digits + V/X or 12 digits;
contact: 7–15 digits, optional +), mirrored by the SQL checks, and are
tested in `test.js`. The club add-player form takes the name plus every optional
detail (contact, NIC, city, batting/bowling, keeper, photo — saved with follow-up
RPCs after `add_player_to_club`, and only when `created` is true). **Optional player details** (`supabase/008_player_details.sql`): batting hand,
bowling arm + style (`BOWLING_TYPES`), wicket-keeper, city and a photo. Unlike
contact/NIC these are **public** — they're columns on `players_public`, read
with `fetchPlayerDetails` — but editing uses the same permission
(`can_see_player_contact`, redefined in 009 — see below) via `update_player_details`, and all of it is one edit form on the
profile (`handlePlayerProfileSubmit` saves contact then details). Everything
is optional and displays as "Not set" when empty. If 008 hasn't been run the
select just fails and the profile shows a "run 008" hint to editors instead of
breaking (`details_unavailable`). The photo is stored inline as a small base64
JPEG in `players.photo` (no storage bucket): `resizeImageToDataUrl` centre-crops
to 240px and steps quality down to fit the 80,000-character column check, and
the file-input `change` handler updates the DOM directly (no re-render) so
half-typed fields survive. Anything read back for display goes through
`safePhoto()` — only base64 jpeg/png/webp data URLs ever reach `<img src>`, never
svg or remote URLs — keep it that way. The photo picker is a generic
`.photo-field` (`photoFieldHtml`: hidden `photo` input + `.photo-preview` +
`.photo-file-input`), shared by the profile editor and the club add form and
handled by `closest(".photo-field")` — no ids, so both forms can use it;
`playerDetailFieldsHtml`/`readPlayerDetails` are the shared fields/reader.
Labels/validation
(`formatBatting`, `formatBowling`, `playerDetailsError`, `safePhoto`) are pure
and tested.

Stats come from
`playerCareer(nameOrNames, matches)`, matched by **name** (matches store names,
not ids; pass `[name, ...aliases]` and it folds every spelling — see merging), and **every profile shows two separate tiers — "Club matches" and
"Premier matches" — never a combined total**, whichever screen opened it (the
order flips: club-opened shows club first). **Inside each tier, batting,
bowling and fielding are separate sections** (a small "matches / MVP pts" line
on top, then Batting, Bowling, Fielding, each with its own tiles or a "hasn't
batted/bowled yet" line): batting = innings, runs, balls, highest (`*` if not
out), average, strike rate, not outs, ducks, 4s, 6s, 50s, 100s; bowling =
innings, overs, maidens, runs, wickets, best, average, economy, strike rate;
fielding = catches, run-outs, dismissals. `playerCareer` computes the
per-innings ones (highest, 50s/100s/ducks, best bowling) by walking the
matches itself, since `aggregatePlayerStats` only keeps totals — a 100 counts
as a hundred, not also a fifty, matching `calcPlayerPoints`. Premier = only the
`level:"premier"` matches (`ui.premier.premierMatches`, loaded on demand).
Club = a club-opened profile folds `clubMatchesFor(ui.currentClubId)`; a
Premier-opened profile folds the *viewer's own clubs'* matches
(`fetchViewerClubMatches`: `matches` where `level = "local"` and `club_id` in
`ui.myClubs`, merged by id with the local archive). That asymmetry is
deliberate, not a gap to "fix" client-side: matches are publicly readable, but
club rosters are members-only, so there's no way to ask which clubs an
arbitrary player belongs to; a signed-out visitor gets a "sign in" hint for
the club block. If you want true per-player club stats across every club,
it needs a server-side query (e.g. an RPC over `matches.data`), not more
client fetching. Economy uses 6-ball overs (like the
leaderboards); highest score/best bowling aren't tracked.

**Gotcha (fixed):** the submit dispatcher reads `e.target.getAttribute("id")`,
not `e.target.id` — the preset forms contain a hidden `<input name="id">`,
which shadows the form's `id` property, so `form.id` was an input element,
nothing matched, and saving *any* preset did a native GET submit (page
reload, nothing saved). Never name a form control `id`/`name`/`action` on a
form the delegated handlers dispatch by id without using `getAttribute`.

**Nickname, jersey no, roster removal & player modals** (`supabase/010_player_nickname_jersey.sql`).
`players.nickname` (≤24) and `players.jersey_no` (0–999, not unique) are
public profile fields on `players_public`, edited under the same manage rule
via `update_player_nickname_jersey` — called from `updatePlayerDetails` after
008's RPC. They're read with a fallback (`fetchPlayerDetails`/`fetchRosterRows`
retry without them) so nothing breaks before 010 is run (`kit_unavailable`).
`playerLabel()` renders `#7 Name (Nick)`; `parseJerseyNo` is the validator.
The club Players screen adds via a floating `+` (`.fab`, rendered *outside*
`.screen`, whose transform animation would otherwise capture a fixed child)
and opens add / edit as bottom-sheet modals from `ui.playerModal`
(`{kind:"add"|"edit"}`), layered in `render()` only off the live
screen. `render()` keeps an open player modal's DOM when its `modalKey`
hasn't changed, so background fetches can't wipe typed input — change the key
if the sheet itself needs to re-render. "Remove from club" (roster row ✕ or
the club-scope profile) asks first (`askRemoveClubPlayer` → shared
confirmation sheet) and deletes the `club_rosters`
row only (002's "members remove" policy; every member is owner/admin). The
global player, their stats and `origin_club_id` are untouched — so the club
that added an unclaimed player can still edit them after removing them (it's
also what lets clubs edit friendly visitors, who are never on a roster).

**"Already on the platform" suggestions in the add sheet.** Typing 2+
characters in the add-player name field runs `searchPlatformPlayers`
(`players_public` `ilike`, input escaped with `escapeLike`, public columns
only — never phone/NIC) from the app's single delegated `input` listener
(debounced, stale responses dropped via `suggestSeq`), and fills
`.platform-suggest` straight into the DOM (no `render()`, so typed fields
survive). "Add to club" inserts that exact player's `club_rosters` row **by
id** (`addExistingPlayerToClub`) — names aren't unique, so this is the way to
pick the right one of two same-named players; it never creates a player or
changes `origin_club_id`. Submitting the form still goes through
`add_player_to_club` by name, which joins an exact-name match instead of
creating one — the sheet's hint says so. Merge aliases aren't searched.

## Renaming a player (`supabase/013_rename_player.sql`)

The profile's Edit sheet has a Name field for anyone who may manage the
profile (009's rule: platform admin, the claimant, or the adding club while
unclaimed — the sheet only opens for them, and `rename_player` re-checks
server-side). Because matches store **names** and are never rewritten, a
rename keeps the old name in `player_aliases` — the same mechanism merges use
— so the profile's stats (`playerCareer([name, ...aliases])`) and
`add_player_to_club`'s alias lookup keep finding this player. Renaming back to
a former name removes that alias; a case/spacing-only change adds none. The
RPC refuses a name held by another player or used as another player's alias
(every name lookup picks one player per name), updates the `{id, name}`
snapshots in `tournament_teams`, and writes `player_rename` to
`admin_audit_log`. Client: `normalizePlayerName`/`playerNameError` (pure,
tested, 1–24 chars), `renamePlayer`, `applyPlayerRename`; the rename runs
before the other saves in `handlePlayerProfileSubmit`. Online-only, like the
other profile edits. Known limits: leaderboards still list old and new names
separately (same as merges), and a match in progress keeps the name it
started with.

## Club tournament teams (`supabase/012_tournament_teams.sql`)

A club tournament (usually the club split into two sides for a day) can
hold saved teams: `tournament_teams` rows (name + `players` jsonb of
`[{id, name}]` roster snapshots), **members-only** via RLS on a denormalized
`club_id` that the policies check matches `tournaments.organizer_club_id`
(the tournament row itself is public; team lists reveal roster membership,
which isn't). Managed from the tournament dashboard as colored team cards
(`team-c0..3`, position-based like Home's badges) plus a tap-to-pick team
builder (`renderTournamentTeamForm`: picks, name and search live in
`ui.tournamentTeamEdit`; search filters in the DOM only; picking someone on
another team shows "move" and `handleTournamentTeamSubmit` saves the donor
team first). With no teams yet, "Split the roster into 2 random teams"
(`quickSplitTeams`) creates two. Match setup picks teams from two tile columns
(picking the other side's team swaps the sides). (`renderTournamentTeams`,
`ui.tournamentTeamEdit`; the builder is a bottom sheet,
`renderTournamentTeamModal`, and closing it with unsaved changes asks
first; delete — from a card or the sheet — goes through
`askDeleteTournamentTeam`); a
player can be on only one team per tournament (client-side check on save);
names are unique per tournament (index). With 2+ teams, tournament match
setup swaps the typed name boxes for two team selects and stores
`match.squads = { A: [names], B: [names] }`. `playerTeamInMatch` checks squads
*before* usage, so the side-conflict rule fires before a squad player has
even batted; a name in neither squad (a late sub) falls back to usage.
**Guest matches get squads too** (`guestTeamSquad`, ENGINE, tested): a
guest tournament match takes both saved teams' `playerIds`, and guest match
setup does the same when a typed team name matches a saved guest team
(case-insensitive; the other side may be `[]`). So side-scoped suggestions,
the side-conflict check and ⋯ → Switch players work the same as in a club
match; the sheet just hides the club/guest choice (`!match.clubId`). A side
whose squad is empty falls back to the normal suggestion list in `pickPool`.
Squads also scope the in-match search-select options to each side (see "In-match
name boxes are a search-select" above).
**Adding people who aren't on the roster.** The builder's search box doubles
as an "add" box (`renderBuilderAddCard`): **New club player** goes through
`addPlayerToClub` (roster + platform, same RPC as the Players screen) and is
picked by its real id; **Guest** is stored only inside that team's
`players` jsonb as `{ id: guestPlayerKey(name), name, guest: true }` — a
synthetic `guest:<lower name>` id, never a `players` row, so no migration was
needed. A typed name that matches the roster picks the roster player
instead. Match setup copies the guests' names to `match.guestNames` (carried
by `restartMatch`), Switch players can add a guest too, and
`registerMatchPlayer` returns early for any `isGuestInMatch` name — so a
guest is never added to the club roster or the global players list, only
to the scorecard. Anything that reads `tournament_teams.players[].id` must
allow for that synthetic id (don't treat it as a `players.id`). Guests still
appear by name in that match's scorecard, and so in name-based leaderboards.
`syncMatchToCloud` strips `squads` from the public `matches.data` blob. Played
matches keep their own names, so editing/deleting a team never changes
history or standings (which still group by name). If 012 isn't run, the
dashboard shows a "run 012" hint (`teams_unavailable`) and setup falls back
to typed names.

## Ownership, claiming & merging (`supabase/009_ownership_claims_merges.sql`)

**Who may manage (edit) a player profile** — one rule, in
`can_see_player_contact(_player_id)`, which the contact/NIC reads
(`get_player_profile`) and every edit RPC all go through, so visibility and
editability can't drift apart (the client just renders `can_see_contact`):

1. a platform admin, or
2. the player who **claimed** it (`players.claimed_by`), or
3. **only while the profile is unclaimed**, a member of the club that first
   added the player (`players.origin_club_id`, stamped by `add_player_to_club`
   when it *creates* the row, and by `ensure_global_player(_name, _club_id)`
   for a friendly's visitors).

Adding an already-existing platform player to a roster (`created: false`)
gives **no** edit rights, and the club's edit right **ends the moment the
player claims the profile** — a deliberate reading of "players have to claim
the profile and edit"; if you'd rather clubs keep editing after a claim, that's
the one clause to change in the SQL function. The client shows a message when a
roster add didn't create a new player and doesn't send the typed details.

**One person, one claimed profile.** `players_one_claim_per_user` is a partial
unique index on `claimed_by`; `request_claim` refuses if you already own a
profile ("request a merge instead"), if the player is claimed, or if you
already have a claim pending. Claims are no longer inserted directly
(the old insert policy is dropped) — always `request_claim` → admin
`approve_claim`/`reject_claim`. The client wraps these in `ownershipRpc`
(friendly "run 009" error if the function is missing) and learns who the viewer
already is from `fetchMyPlayerIdentity()` → `ui.identity`
(`{ myPlayer, pendingClaim, pendingMerges }`), which `renderOwnershipBlock`
turns into the right action: "This is me — claim" (no claim yet), "request
merge" (already own one), or just a status line. Profile-only: the Premier list
shows Claimed/Unclaimed and the admin queues, not per-row claim buttons.

**Merging duplicates.** If a second profile is also you, `request_merge(from)`
asks to fold it into the profile you own; `approve_merge` (admin only) keeps the
**survivor's id**, adds the merged name (and its own aliases) to
`player_aliases` (public read, unique on `lower(alias)`), moves roster rows,
fills only the survivor's *blank* fields from the duplicate (keeper is OR-ed),
marks the request approved, and deletes the duplicate row. Only an *unclaimed*
profile can be merged away. Because matches store **names**, stats survive the
merge by name-folding: the profile loads `player_aliases` and passes
`[name, ...aliases]` to `playerCareer` (`mergeCareers` sums counts, keeps the
best single innings/figures and re-derives averages from the combined totals).
`add_player_to_club` resolves a typed old name through the alias table to the
survivor. **Known limits:** the leaderboards (`aggregatePlayerStats`) still list
names separately — only profiles fold aliases; and a match where *both* names
appeared would count that match twice in the "matches" tally. `merge_requests.
from_player_id` deliberately has no FK (the row is deleted on approval); the
`into_player_id` FK cascades.

**Verifying SQL changes:** the logic lives in Postgres, so it's worth running
it for real — a throwaway `postgres:16-alpine` with a stub `auth` schema
(`auth.users(id, email, raw_user_meta_data)`, `auth.uid()` reading a session
setting, `authenticated`/`anon` roles) applies 001–009 cleanly, and you can
impersonate users with `set role authenticated` to check the rules above
(remember the base `players` table is RLS-hidden from ordinary users, so
capture ids as superuser first). The 009 scenarios (46 checks: manage rule per
actor, claimed-club lockout, one-claim-per-user, direct-write blocks, merge
alias/roster/blank-fill/deletion, alias resolution, no contact leak) all passed
this way.

## Install prompt (phones only)

A static `#install-banner` (outside `#app`, DOM-only, never through
`render()`; the `INSTALL PROMPT` block at the end of the script) asks phone
visitors to install. **A page can't install itself or launch an installed
PWA**, so this is as far as it goes:
- Android/Chromium: `beforeinstallprompt` is held (`preventDefault`) and
  `prompt()` runs only from the banner's Install button (needs a user tap).
  If it never fires, `getInstalledRelatedApps()` (manifest
  `related_applications` webapp entry) or the `cricket.lk.installed` flag
  (set whenever the app runs standalone) shows "open it from your home
  screen" instead.
- iOS: no install API; the banner explains Share → Add to Home Screen.
  Home-screen apps on iOS don't share storage with Safari, so the flag
  can't be read there — and a match scored in Safari won't be in the app.
Hidden when standalone, on desktop, on the live scoring screen
(`body.live-scoring`) and in print; ✕ or declining snoozes it for 7 days.

## Deployment

See README.md — static hosting, any provider, HTTPS required for the
service worker. No secrets: the Supabase anon/public key embedded for
cloud features is meant to be public (all access control is enforced
server-side by Postgres Row Level Security policies, not by keeping
that key secret) — don't confuse it with a service-role key, which must
never appear in this client-side file. Still no environment variables
and no application server of our own — Supabase is a hosted backend we
call directly from the client, not a backend we run.

## Platform admin portal (`admin.html`, `supabase/011_admin_portal.sql`)

A **separate page**, not a screen in `index.html`: desktop-first, online-only,
for **platform** admins (`admin_users`) — club admins keep managing their clubs
in the scorer. Same origin and supabase-js' default localStorage key as the
scorer, so one sign-in covers both (and signing out of either signs out both).
Reached from Account's "Open admin portal" (shown when `isAdmin`) or directly
at `/admin.html`. It isn't in `sw.js`' cache list on purpose: offline, a
navigation falls back to `index.html`, which is fine since the portal is useless
without the database.

**The security boundary is Postgres, never the page.** Every private read is
either RLS that already allows admins (`players` base table incl. phone/NIC,
`claim_requests`, `merge_requests`, `admin_audit_log`) or an admin-only
SECURITY DEFINER RPC from 011 that starts with `if not public.is_admin()`.
The page's `admin_users` check only picks which screen to show. If you add an
admin feature, add an RPC that checks `is_admin()` and calls `admin_log(...)` —
don't add a broad RLS policy for admins on a new table.

Sections: Overview (counts), Claim requests, Merge requests (both show each
profile side by side with a match record folded by name + aliases, and
auto-flags: claimant already owns a profile, contact number match/mismatch,
different NICs, and **both names in the same scorecard** — usually two
different people), Players (search, edit contact/NIC via 007's
`update_player_profile`, release a claim, direct merge, delete unclaimed),
Clubs (+ members), Matches (delete), Users & admins (grant/revoke platform
admin; you can't remove yourself), Audit log.

011 details worth knowing:
- `admin_audit_log` is append-only (admin read, no write policies). Claim/merge
  reviews are logged by triggers on the request tables, so 009's approve/reject
  RPCs didn't need changing for that. Deletes store the deleted row in
  `detail` (a match row can be restored by hand; a player row keeps phone/NIC
  but not the photo — the log is admin-only, but it is PII retention).
- The merge body now lives in one internal function, `merge_player_rows`
  (not executable by clients); `approve_merge` is redefined to call it and
  `admin_merge_players` (direct admin merge, reason required) reuses it. It
  also blank-fills 010's `nickname`/`jersey_no`, which 009's version predated.
  Only an unclaimed profile can be merged away or deleted.
- Destructive actions require a reason (stored in the log); delete-player
  and delete-match also need a typed confirmation in the UI.

The portal's stats (`careerFor` in admin.html) are a review aid that walks
every match row client-side (paged, cached per visit). It uses the same
name matching as `playerCareer` but no MVP points; if the match count grows
large, move it to an RPC over `matches.data` rather than fetching more.
All 011 rules were checked against a throwaway Postgres (see "Verifying SQL
changes"); the page was driven in Playwright against a mocked client.
