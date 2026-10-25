/* Cricket.lk — match: live scoring screen.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- live screen --- */
function handleBallClick(runs){
  // Never record with an empty slot (a batter/bowler still to be picked).
  if (pendingPickKey(state.match)) return;
  const inn = currentInnings(state.match);
  const kindMap = { wide: "wide", noball: "noball", bye: "bye", legbye: "legbye" };
  const kind = ui.pendingExtra ? kindMap[ui.pendingExtra] : "run";
  const batter = inn.striker;
  const runsBefore = inn.batting.stats[batter] ? inn.batting.stats[batter].runs : 0;
  pushSnapshot();
  recordBall(inn, { kind, runs });
  afterBall(state.match);
  maybeArchiveCompletedMatch(state.match);
  if (kind === "run") SFX.runs(runs); else SFX.extra();
  liveMoment = ballMoment(kind, runs, batter, runsBefore, inn.batting.stats[batter] ? inn.batting.stats[batter].runs : 0);
  ui.pendingExtra = null;
  save(); render();
}

/* --- live "moments": a one-shot badge + ring on the score tile for a four,
   a six, a wicket or a batter's fifty/hundred. Set where the ball is
   recorded (next to its sound) and played by render() on the new board, so
   a re-render, an undo or a reload never replays one. --- */
let liveMoment = null;
// Runs off the bat only (a run or a no-ball's runs); a milestone beats the boundary that brought it.
function ballMoment(kind, runs, batter, before, after){
  if (kind !== "run" && kind !== "noball") return null;
  if (batter && before < 100 && after >= 100) return { kind: "hundred", label: "HUNDRED", sub: batter };
  if (batter && before < 50 && after >= 50) return { kind: "fifty", label: "FIFTY", sub: batter };
  if (runs === 6) return { kind: "six", label: "SIX" };
  if (runs === 4) return { kind: "four", label: "FOUR" };
  return null;
}
function wicketMoment(inn){
  const fow = inn.fallOfWickets[inn.fallOfWickets.length - 1];
  return { kind: "wicket", label: "WICKET", sub: fow ? fow.batsman : null };
}
function playLiveMoment(){
  const mo = liveMoment;
  liveMoment = null;
  // Gone if the ball ended the innings or the match (that screen has no board).
  const tile = mo && document.querySelector("#app .screen.live .score-tile");
  if (!tile) return;
  tile.classList.add("moment-" + mo.kind);
  tile.insertAdjacentHTML("beforeend", `<span class="moment" aria-hidden="true"><b>${mo.label}</b>${mo.sub ? `<small>${escapeHtml(liveName(mo.sub))}</small>` : ""}</span>`);
}

/* An extra (wide / no-ball / bye / leg bye) always asks how many runs it was
   worth in its own sheet, so the scorer can't record it without choosing.
   ui.pendingExtra is both "is the sheet open" and which extra; a tap on a
   tile goes through handleBallClick like the run pad used to. For a wide or
   no-ball the question is the runs run or hit *on top of* the extra itself
   (that's what data-runs / event.runs is); each tile spells out the ball's
   total and the chip it leaves in the over row. Byes/leg byes start at 1. */
function renderExtraRunsModal(inn){
  const kind = ui.pendingExtra;
  const plural = n => `${n} run${n === 1 ? "" : "s"}`;
  const cfg = {
    wide:   { title: "Wide", base: inn.wideBaseRuns, from: 0, chip: n => n ? `Wd+${n}` : "Wd",
              ask: "Did they run, or did it go for four?",
              note: `The wide itself is ${plural(inn.wideBaseRuns)} and the ball is bowled again. Pick the runs they ran, or 4 for a boundary.`,
              label: n => n === 0 ? "just the wide" : n === 4 ? "four" : `ran ${n}` },
    noball: { title: "No ball", base: inn.noBallBaseRuns, from: 0, chip: n => n ? `Nb+${n}` : "Nb",
              ask: "How many off the bat (or run)?",
              note: `The no-ball itself is ${plural(inn.noBallBaseRuns)} and the ball is bowled again${inn.freeHitOnNoBall ? "; the next ball is a free hit" : ""}. Pick the runs hit or run — they go to the batter.`,
              label: n => n === 0 ? "just the no-ball" : n === 4 ? "four" : n === 6 ? "six" : plural(n) },
    bye:    { title: "Byes", base: 0, from: 1, chip: n => `B${n}`,
              ask: "How many byes?",
              note: "Runs the batters ran (or a boundary) without the bat touching it. They count as a ball and go on the team total, not against the bowler.",
              label: n => n === 4 ? "four" : plural(n) },
    legbye: { title: "Leg byes", base: 0, from: 1, chip: n => `Lb${n}`,
              ask: "How many leg byes?",
              note: "Runs off the batter's body (not the bat). They count as a ball and go on the team total, not against the bowler.",
              label: n => n === 4 ? "four" : plural(n) }
  }[kind];
  if (!cfg) return "";
  const options = [];
  for (let n = cfg.from; n <= 6; n++) options.push(n);
  return `
    <div class="modal-backdrop">
      <div class="modal extra-runs-modal" data-keep-scroll="extra-runs" role="dialog" aria-modal="true" aria-label="${cfg.title}">
        <div class="wicket-modal-head">
          <h2>${cfg.title}${cfg.base ? ` <span class="extra-base">+${plural(cfg.base)}</span>` : ""}</h2>
        </div>
        <p class="extra-ask">${cfg.ask}</p>
        <p class="hint">${escapeHtml(cfg.note)}</p>
        <div class="run-pad small extra-runs-pad">
          ${options.map(n => `<button type="button" data-action="ball" data-runs="${n}" class="run-btn${n === 4 || (n === 6 && kind === "noball") ? " boundary" : ""}" aria-label="${cfg.label(n)}, ${plural(cfg.base + n)} in total">
            <span class="total">${n}</span>
            <span class="what">${cfg.label(n)}</span>
            <span class="chip-label">${cfg.chip(n)} · ${cfg.base + n} total</span>
          </button>`).join("")}
        </div>
        ${kind === "wide" || kind === "noball" ? `
          <button type="button" data-action="wicket-on-extra" class="extra-wicket-btn">
            <span class="main">Out on this ${kind === "wide" ? "wide" : "no-ball"}?</span>
            <span class="sub">${kind === "wide" && !inn.freeHit ? "Stumped, hit wicket or run out" : "Run out"}</span>
          </button>` : ""}
        <button type="button" data-action="close-extra" class="ghost" style="width:100%;margin-top:6px;">Cancel</button>
      </div>
    </div>
  `;
}

/* Asks first: closing the 1st innings lands on the innings break and closing
   the 2nd ends the match. Either can be taken back (Reopen innings, Undo). */
function handleEndInnings(){
  const m = state.match;
  const inn = m && currentInnings(m);
  // Any match can be closed early from ⋯ Match options (rain, time,
  // a declaration); the on-screen buttons only show with no limit.
  if (!inn || inn.complete) return;
  ui.matchMenu = null;
  const last = m.innings.length === 2;
  const score = `${inn.runs}-${inn.wickets} (${oversDisplay(inn.legalBalls, inn.ballsPerOver)})`;
  askConfirm({
    title: last ? "End the match now?" : "End this innings?", icon: "⏹",
    body: `<p>${escapeHtml(teamName(m, inn.battingTeam))} finish on <b class="n">${score}</b>. ${last
      ? "The result is worked out from the scores as they stand."
      : `${escapeHtml(teamName(m, inn.bowlingTeam))} will need <b class="n">${inn.runs + 1}</b> to win.`}</p>`,
    confirmLabel: last ? "End match" : "End innings",
    onConfirm: () => {
      pushSnapshot();
      endInnings(state.match);
      maybeArchiveCompletedMatch(state.match);
      save();
    }
  });
}

/* The new-batsman / new-bowler sheet can be closed ("Pick later") so the
   scorer can use the rest of the app -- the scorecard, match options, the
   menu -- while the next name isn't known yet. Scoring stays blocked: a
   tap on a run, extra or Wicket just brings the sheet back (reopenPick).
   The dismissal is remembered by a key for *this* pause (innings, balls,
   wickets, which slot), so any change -- a name entered, Undo, a restart --
   makes the next pause ask again on its own. ui-only, never persisted. */
function pendingPickKey(match){
  if (!match || match.status !== "live") return null;
  const inn = currentInnings(match);
  const slot = pendingBatsmanSlot(inn);
  const at = `${match.innings.length}:${inn.legalBalls}:${inn.wickets}`;
  if (slot) return `bat:${at}:${slot}`;
  if (!inn.bowler) return `bowl:${at}`;
  return null;
}
function pickSheetDismissed(match){
  const key = pendingPickKey(match);
  return !!key && ui.pickDismissed === key;
}
function dismissPick(){
  ui.pickDismissed = pendingPickKey(state.match);
  render();
}
/* Returns true (and reopens the sheet) when a scoring tap has to wait for a name. */
function reopenPick(){
  if (!pickSheetDismissed(state.match)) return false;
  ui.pickDismissed = null; ui.pendingExtra = null; resetWicketUi();
  render();
  return true;
}
function renderPickLaterButton(){
  return `<button type="button" data-action="dismiss-pick" class="ghost" style="width:100%;margin-top:10px;">Pick later</button>`;
}

/* The scorer swaps who's on strike by hand (live screen's ⇅, or Match
   options). Logged like any other change, so Undo and ball edits keep it. */
function handleSwapStrike(){
  const m = state.match;
  if (!m || m.status !== "live") return;
  const inn = currentInnings(m);
  if (!canSwapStrike(inn)) return;
  pushSnapshot();
  swapStrikeByHand(inn);
  ui.matchMenu = null;
  save(); render();
}

function handleUndo(){
  if (!state.snapshots.length) return;
  const prev = state.snapshots.pop();
  keepArchiveInStep(state.match, prev);
  state.match = prev;
  ui.pendingExtra = null; resetWicketUi(); ui.confirm = null; ui.matchMenu = null; ui.catchUp = null; ui.liveScorecard = false; ui.ballEdit = null; ui.nameLater = null; ui.scoreSet = null;
  save(); render();
}

/* Undo can step back across the end of a match (Result and the innings break
   have Undo too), so the archive follows: back to a finished version, and
   that version goes into the archive entry; back to before the finish, and
   the entry stays (with the old result) until the match finishes again and
   replaces it (`reopenedFrom`, see maybeArchiveCompletedMatch). */
function keepArchiveInStep(cur, prev){
  const id = cur && (cur.archivedId || cur.reopenedFrom);
  if (!id || !prev || !state.matchHistory[id]) return;
  if (prev.status === "complete"){ delete prev.reopenedFrom; prev.archivedId = id; replaceArchivedMatch(id, prev); }
  else { delete prev.archivedId; prev.reopenedFrom = id; }
}
// What Undo would take back, for its button on the innings break / Result.
function undoLabel(m){
  const prev = state.snapshots[state.snapshots.length - 1];
  if (!prev || !m) return null;
  if (m.forfeited && !prev.forfeited) return "Undo forfeit";
  if (prev.status === m.status) return "Undo last change";
  return "Undo last ball";
}

/* Innings ended by hand (End innings, or a score set by hand) that can be
   taken back, newest first (see reopenInnings, ENGINE). */
function reopenableInnings(m){
  if (!ballEditAllowed(m)) return [];
  return m.innings.map((x, i) => i).filter(i => !reopenInningsError(m, i)).reverse();
}
/* Reopen an innings ended by hand: at the break, during the chase (which is
   cleared) or after the match ended. A finished match keeps its archive entry
   until it finishes again (`reopenedFrom`). Snapshotted, so Undo walks it
   back. */
function askReopenInnings(idx){
  const m = state.match;
  if (!ballEditAllowed(m)) return;
  const res = reopenInnings(m, idx);
  if (res.error) return;
  ui.matchMenu = null;
  const inn = m.innings[idx];
  const team = escapeHtml(teamName(m, inn.battingTeam));
  askConfirm({
    title: `Reopen ${possessive(teamName(m, inn.battingTeam))} innings?`, icon: "↺", tone: "primary",
    body: `<p>${team} carry on batting from <b class="n">${inningsScoreText(inn)}</b>${m.oversLimit != null ? `, with ${oversDisplay(m.oversLimit * inn.ballsPerOver - inn.legalBalls, inn.ballsPerOver)} overs left` : ""}.</p>
      ${res.notes.map(t => `<p>${escapeHtml(t)}</p>`).join("")}
      ${m.status === "complete" ? `<p>The result (${escapeHtml(m.result || "")}) is taken back until the match finishes again. Match history keeps the old result until then.</p>` : ""}
      <p class="hint">Undo puts it back the way it was.</p>`,
    confirmLabel: "Reopen innings",
    onConfirm: () => {
      pushSnapshot();
      const next = res.match;
      if (m.archivedId){ next.reopenedFrom = m.archivedId; delete next.archivedId; }
      state.match = next;
      ui.pickDismissed = null; ui.liveScorecard = false; ui.showFullScorecard = false; ui.pendingExtra = null; resetWicketUi();
      save();
    }
  });
}

/* 1-indexed -> "1st"/"2nd"/"3rd"/"4th"... incl. the 11th-13th exception.
   Display-only (over labels), not an engine concern. */
function ordinalSuffix(n){
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10){ case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
}

/* One row of the live-scoring "this over"/previous-over rail: one slot
   per delivery so far plus a dashed empty for each legal ball still to
   come (a wide/no-ball fills a slot and adds one at the end), each tagged
   for color by what it actually was, plus the row's run total on the
   right. `events` items carry `runs` (added to recordBall's
   currentOverEvents push) so the total doesn't need to re-parse `display`
   strings. The chips sit in a sideways-scrolling strip (.over-balls) that
   focusLatestBalls() keeps on the latest ball. */
function renderOverRow(label, events, bpo, dimmed, unknown){
  // `unknown`: balls of this over bowled before a catch-up (applyCatchUp),
  // never scored one by one -- shown as "?" ahead of the recorded ones.
  const lead = unknown || 0;
  const legal = lead + events.filter(ev => !/^(Wd|Nb)/.test(ev.display)).length;
  const slotCount = events.length + lead + Math.max(0, bpo - legal);
  const slots = [];
  for (let i = 0; i < lead; i++) slots.push(`<span class="chip unknown" data-chip="${escapeHtml(`${label}:u${i}`)}">?</span>`);
  for (let i = 0; i < slotCount - lead; i++){
    const ev = events[i];
    // data-chip: render() only lets a chip that wasn't there before pop in.
    const key = escapeHtml(`${label}:${i}:${ev ? ev.display : ""}`);
    if (!ev){ slots.push(`<span class="chip empty" data-chip="${key}"></span>`); continue; }
    let cls = "chip";
    if (ev.isWicket) cls += " wicket";
    else if (ev.runs === 4) cls += " four";
    else if (ev.runs === 6) cls += " six";
    else if (/^(Wd|Nb)/.test(ev.display)) cls += " extra";
    slots.push(`<span class="${cls}" data-chip="${key}">${escapeHtml(ev.display)}</span>`);
  }
  const total = events.reduce((sum, ev) => sum + (ev.runs || 0), 0);
  return `
    <div class="over-row${dimmed ? " dimmed" : ""}">
      <span class="over-row-label">${label}</span>
      <div class="over-balls">${slots.join("")}</div>
      <span class="over-row-total">${total}</span>
    </div>
  `;
}

/* After every render (and on resize): an over with extras can hold more
   chips than fit, so scroll each strip just far enough to show its latest
   ball and the next empty slot (no scrollbar -- it's swiped), and fade the
   edge that has balls hidden past it. */
function focusLatestBalls(){
  document.querySelectorAll("#app .over-balls").forEach(box => {
    const chips = [...box.children];
    let last = -1;
    chips.forEach((c, i) => { if (!c.classList.contains("empty")) last = i; });
    const show = chips[last + 1] || chips[last];
    // offsetLeft (box is position:relative), not getBoundingClientRect: a
    // new chip is mid-pop (scaled) right now.
    box.scrollLeft = show ? Math.max(0, show.offsetLeft + show.offsetWidth - box.clientWidth) : 0;
    overBallsFade(box);
  });
}
function overBallsFade(box){
  box.classList.toggle("more-left", box.scrollLeft > 1);
  box.classList.toggle("more-right", box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
}
// scroll doesn't bubble: catch the strips' scrolls on the way down.
document.addEventListener("scroll", e => {
  if (e.target.classList && e.target.classList.contains("over-balls")) overBallsFade(e.target);
}, true);

/* The score + target tiles at the top of the live card. The pick/wicket/
   extra sheets reuse it as a banner above the sheet (renderSheetScore), with
   the batting team's name, since the sheet's scrim hides the top bar. */
function renderScoreBento(match, inn, teamLabel){
  const bpo = inn.ballsPerOver;
  const crr = runRate(inn.runs, inn.legalBalls, bpo).toFixed(2);
  const rrr = requiredRunRate(inn);
  const ballsLeft = inn.oversLimit != null ? Math.max(inn.oversLimit * bpo - inn.legalBalls, 0) : null;
  return `
      <div class="score-bento">
        <div class="score-tile">
          ${teamLabel ? `<div class="score-team">${escapeHtml(teamLabel)}</div>` : ""}
          <div class="score-n">${inn.runs}-${inn.wickets}</div>
          <div class="score-sub"><span>${oversDisplay(inn.legalBalls, bpo)}${teamLabel && inn.oversLimit != null ? `/${inn.oversLimit}` : ""} ov</span><span class="crr">CRR ${crr}</span></div>
        </div>
        ${inn.target != null ? `
          <div class="target-tile">
            <div class="eyebrow">TARGET ${inn.target}</div>
            <div class="need-n">${Math.max(inn.target - inn.runs, 0)}</div>
            <div class="need-sub">${ballsLeft != null ? `off ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}` : "no over limit"}</div>
            ${rrr != null ? `<div class="rrr">RRR ${rrr.toFixed(2)}</div>` : ""}
          </div>
        ` : ""}
      </div>`;
}

function renderLive(match){
  const inn = currentInnings(match);
  const bpo = inn.ballsPerOver;
  const alone = battingAlone(inn);
  const strikerStats = inn.striker ? inn.batting.stats[inn.striker] : null;
  const nonStrikerStats = inn.nonStriker ? inn.batting.stats[inn.nonStriker] : null;
  const bowlerStats = inn.bowler ? inn.bowling.stats[inn.bowler] : null;
  const sr = (s) => s.balls ? ((s.runs / s.balls) * 100).toFixed(1) : "0.0";
  const econ = (b) => b.legalBalls ? (b.runs / (b.legalBalls / bpo)).toFixed(2) : "0.00";
  const later = pickSheetDismissed(match);
  const pickBtn = label => `<button type="button" data-action="reopen-pick" class="pick-slot">+ ${label}</button>`;
  const slotName = (name, label) => name ? unnamedNameHtml(match, name, liveName(name)) : later ? pickBtn(label) : "—";

  const overNumber = Math.floor(inn.legalBalls / bpo) + 1;
  // No "previous over" row straight after a catch-up (its last entry is the gap).
  const prevOver = inn.overs.length && !inn.overs[inn.overs.length - 1].gap ? inn.overs[inn.overs.length - 1] : null;
  const unknownBalls = inn.partOverUnknown
    ? Math.max(0, inn.legalBalls % bpo - inn.currentOverEvents.filter(ev => !/^(Wd|Nb)/.test(ev.display)).length) : 0;
  const lastFow = inn.fallOfWickets.length ? inn.fallOfWickets[inn.fallOfWickets.length - 1] : null;
  const partnershipRuns = inn.runs - (lastFow ? lastFow.score : 0);
  const partnershipBalls = inn.legalBalls - (lastFow ? lastFow.balls : 0);

  // Extras row only offers what this match's preset enabled -- the grid
  // itself adapts column count (3-up/4-up) instead of leaving a gap.
  const enabledExtras = [
    match.wideEnabled ? { extra: "wide", label: "Wide" } : null,
    match.noBallEnabled ? { extra: "noball", label: "No ball" } : null,
    { extra: "bye", label: "Bye" },
    { extra: "legbye", label: "Leg bye" }
  ].filter(Boolean);

  return `
    <div class="screen live">
      ${renderScoreBento(match, inn)}

      <div class="matchup-card">
        <div class="matchup-head"><span>BATTER${canSwapStrike(inn) ? ` <button type="button" data-action="swap-strike" class="swap-strike" aria-label="Swap strike: put ${escapeHtml(liveName(inn.nonStriker))} on strike">⇅ Swap</button>` : ""}</span><span style="width:34px;">R</span><span style="width:30px;">B</span><span style="width:24px;">4s</span><span style="width:24px;">6s</span><span style="width:46px;">SR</span></div>
        <div class="matchup-row">
          <span class="matchup-marker striker"></span><span class="name">${slotName(inn.striker, "Pick batsman")}</span>
          <span class="stat emph" style="width:34px;">${strikerStats ? strikerStats.runs + "*" : ""}</span>
          <span class="stat" style="width:30px;">${strikerStats ? strikerStats.balls : ""}</span>
          <span class="stat" style="width:24px;">${strikerStats ? strikerStats.fours : ""}</span>
          <span class="stat" style="width:24px;">${strikerStats ? strikerStats.sixes : ""}</span>
          <span class="stat" style="width:46px;">${strikerStats ? sr(strikerStats) : ""}</span>
        </div>
        <div class="matchup-row muted">
          <span class="matchup-marker nonstriker"></span><span class="name">${alone ? "Batting alone" : slotName(inn.nonStriker, "Pick batsman")}</span>
          <span class="stat emph" style="width:34px;">${nonStrikerStats ? nonStrikerStats.runs + "*" : ""}</span>
          <span class="stat" style="width:30px;">${nonStrikerStats ? nonStrikerStats.balls : ""}</span>
          <span class="stat" style="width:24px;">${nonStrikerStats ? nonStrikerStats.fours : ""}</span>
          <span class="stat" style="width:24px;">${nonStrikerStats ? nonStrikerStats.sixes : ""}</span>
          <span class="stat" style="width:46px;">${nonStrikerStats ? sr(nonStrikerStats) : ""}</span>
        </div>
        <div class="matchup-head bowler-head"><span>BOWLER</span><span style="width:38px;">O</span><span style="width:24px;">M</span><span style="width:28px;">R</span><span style="width:24px;">W</span><span style="width:46px;">ECON</span></div>
        <div class="matchup-row">
          <span class="matchup-marker bowler"></span><span class="name">${slotName(inn.bowler, "Pick bowler")}</span>
          <span class="stat" style="width:38px;">${bowlerStats ? oversDisplay(bowlerStats.legalBalls, bpo) : ""}</span>
          <span class="stat" style="width:24px;">${bowlerStats ? bowlerStats.maidens : ""}</span>
          <span class="stat" style="width:28px;">${bowlerStats ? bowlerStats.runs : ""}</span>
          <span class="stat emph" style="width:24px;">${bowlerStats ? bowlerStats.wickets : ""}</span>
          <span class="stat" style="width:46px;">${bowlerStats ? econ(bowlerStats) : ""}</span>
        </div>
        <div class="partnership-row">
          <span>PARTNERSHIP</span><span class="val" style="flex-grow:1;text-align:right;">${partnershipRuns} (${partnershipBalls})</span>
          <span style="margin-left:12px;">LAST WKT</span><span class="val">${lastFow ? `${lastFow.score}-${lastFow.wicket}` : "—"}</span>
        </div>
      </div>

      <div class="over-card">
        <div class="over-card-header">
          <span>${overNumber}${ordinalSuffix(overNumber)} OVER · ${bpo}-BALL</span>
          ${inn.freeHit ? `<span class="freehit-badge">FREE HIT</span>` : ""}
        </div>
        ${renderOverRow(`${overNumber}${ordinalSuffix(overNumber)}`, inn.currentOverEvents, bpo, false, unknownBalls)}
        ${prevOver ? renderOverRow(`${overNumber - 1}${ordinalSuffix(overNumber - 1)}`, prevOver.events, bpo, true) : ""}
      </div>

      <div class="run-pad small">
        ${[0, 1, 2, 3, 4, 5, 6].map(n => `<button data-action="ball" data-runs="${n}" class="run-btn r${n}">${n}</button>`).join("")}
        <button data-action="undo" class="run-btn undo" ${state.snapshots.length ? "" : "disabled"}>UNDO</button>
      </div>

      <div class="extra-pad" style="grid-template-columns:repeat(${enabledExtras.length}, 1fr);">
        ${enabledExtras.map(e => `<button data-action="toggle-extra" data-extra="${e.extra}" class="${ui.pendingExtra === e.extra ? "active" : ""}">${e.label.toUpperCase()}</button>`).join("")}
      </div>

      <button data-action="open-wicket" class="wicket-btn">
        <span class="main">WICKET</span>
        ${inn.freeHit ? `<span class="sub">free hit — run out only</span>` : ""}
      </button>

      <div class="live-links">
        <button type="button" data-action="open-live-scorecard" class="ghost small">Full scorecard</button>
        ${canEndInningsByHand(inn) ? renderEndInningsButton(match, inn, true) : ""}
      </div>
    </div>
  `;
}
