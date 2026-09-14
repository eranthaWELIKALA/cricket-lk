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

1. **`REFERENCE DATA`** — `WICKET_LABELS`, the display strings for each
   dismissal type. The only static data this app has (no catalogue —
   see "No player squads" below).
2. **`ENGINE`** — pure functions, zero DOM access: `createInnings`,
   `createMatch`, `recordBall`, `checkInningsComplete`,
   `startSecondInnings`, `matchResult`, `afterBall`, plus small
   utilities (`oversDisplay`, `runRate`, `requiredRunRate`,
   `swapStrike`, `pendingBatsmanSlot`). This is the block to port if you
   ever build a native app.
3. **`STORAGE`** — a `DB` wrapper: tries `window.storage`, falls back
   to `localStorage`, falls back to an in-memory object. One key,
   `cricket.lk.v1`, storing `{ match, snapshots }`.
4. **`UI`** — render functions per screen (setup, opening modal, live,
   new-batsman/new-bowler/wicket modals, innings break, result), one
   `render()` that picks the screen from `match.status` and layers a
   modal on top when needed, and two delegated listeners (`click` via
   `data-action`, `submit` via form `id`) attached once at boot.

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
session surviving a reload, and undo. Extend it rather than deleting it
when you touch the engine — it's cheap insurance against exactly the
kind of off-by-one that this codebase is full of (over boundaries,
strike rotation parity, free-hit timing).

For UI changes, drive the actual page in a browser (Playwright/
`chromium-cli` against a local `serve .`) rather than trusting the
engine tests alone — the null-slot-driven modal sequencing in `render()`
is the kind of thing that looks right in isolation and breaks in
practice.

## Deployment

See README.md — static hosting, any provider, HTTPS required for the
service worker. No environment variables, no secrets, no backend.
