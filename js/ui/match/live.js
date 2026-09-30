/* Cricket.lk — match: live scoring screen.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- live screen --- */
function handleBallClick(runs){
  const inn = currentInnings(state.match);
  const kindMap = { wide: "wide", noball: "noball", bye: "bye", legbye: "legbye" };
  const kind = ui.pendingExtra ? kindMap[ui.pendingExtra] : "run";
  pushSnapshot();
  recordBall(inn, { kind, runs });
  afterBall(state.match);
  maybeArchiveCompletedMatch(state.match);
  if (kind === "run") SFX.runs(runs); else SFX.extra();
  ui.pendingExtra = null;
  save(); render();
}

/* Asks first: closing the 1st innings lands on the innings break, which has
   no Undo control, and closing the 2nd ends the match. */
function handleEndInnings(){
  const m = state.match;
  const inn = m && currentInnings(m);
  if (!inn || !canEndInningsByHand(inn)) return;
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
  ui.pickDismissed = null; ui.pendingExtra = null; ui.wicketFlow = null;
  render();
  return true;
}
function renderPickLaterButton(){
  return `<button type="button" data-action="dismiss-pick" class="ghost" style="width:100%;margin-top:10px;">Pick later</button>`;
}

function handleUndo(){
  if (!state.snapshots.length) return;
  state.match = state.snapshots.pop();
  ui.pendingExtra = null; ui.wicketFlow = null; ui.runoutRuns = 0; ui.runoutEnd = "striker"; ui.confirm = null; ui.matchMenu = null;
  save(); render();
}

/* 1-indexed -> "1st"/"2nd"/"3rd"/"4th"... incl. the 11th-13th exception.
   Display-only (over labels), not an engine concern. */
function ordinalSuffix(n){
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10){ case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
}

/* One row of the live-scoring "this over"/previous-over rail: one slot
   per ballsPerOver (padded with dashed empties when the over isn't full
   yet), each tagged for color by what it actually was, plus the row's
   run total on the right. `events` items carry `runs` (added to
   recordBall's currentOverEvents push) so the total doesn't need to
   re-parse `display` strings. */
function renderOverRow(label, events, bpo, dimmed){
  const slotCount = Math.max(bpo, events.length);
  const slots = [];
  for (let i = 0; i < slotCount; i++){
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
      ${slots.join("")}
      <span class="over-row-total">${total}</span>
    </div>
  `;
}

function renderLive(match){
  const inn = currentInnings(match);
  const bpo = inn.ballsPerOver;
  const crr = runRate(inn.runs, inn.legalBalls, bpo).toFixed(2);
  const rrr = requiredRunRate(inn);
  const ballsLeft = inn.oversLimit != null ? Math.max(inn.oversLimit * bpo - inn.legalBalls, 0) : null;
  const alone = battingAlone(inn);
  const strikerStats = inn.striker ? inn.batting.stats[inn.striker] : null;
  const nonStrikerStats = inn.nonStriker ? inn.batting.stats[inn.nonStriker] : null;
  const bowlerStats = inn.bowler ? inn.bowling.stats[inn.bowler] : null;
  const sr = (s) => s.balls ? ((s.runs / s.balls) * 100).toFixed(1) : "0.0";
  const econ = (b) => b.legalBalls ? (b.runs / (b.legalBalls / bpo)).toFixed(2) : "0.00";
  const later = pickSheetDismissed(match);
  const pickBtn = label => `<button type="button" data-action="reopen-pick" class="pick-slot">+ ${label}</button>`;
  const slotName = (name, label) => name ? escapeHtml(name) : later ? pickBtn(label) : "—";

  const overNumber = Math.floor(inn.legalBalls / bpo) + 1;
  const prevOver = inn.overs.length ? inn.overs[inn.overs.length - 1] : null;
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
      <div class="score-bento">
        <div class="score-tile">
          <div class="score-n">${inn.runs}-${inn.wickets}</div>
          <div class="score-sub"><span>${oversDisplay(inn.legalBalls, bpo)} ov</span><span class="crr">CRR ${crr}</span></div>
        </div>
        ${inn.target != null ? `
          <div class="target-tile">
            <div class="eyebrow">TARGET ${inn.target}</div>
            <div class="need-n">${Math.max(inn.target - inn.runs, 0)}</div>
            <div class="need-sub">${ballsLeft != null ? `off ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}` : "no over limit"}</div>
            ${rrr != null ? `<div class="rrr">RRR ${rrr.toFixed(2)}</div>` : ""}
          </div>
        ` : ""}
      </div>

      <div class="matchup-card">
        <div class="matchup-head"><span>BATTER</span><span style="width:34px;">R</span><span style="width:30px;">B</span><span style="width:24px;">4s</span><span style="width:24px;">6s</span><span style="width:46px;">SR</span></div>
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
        ${renderOverRow(`${overNumber}${ordinalSuffix(overNumber)}`, inn.currentOverEvents, bpo, false)}
        ${prevOver ? renderOverRow(`${overNumber - 1}${ordinalSuffix(overNumber - 1)}`, prevOver.events, bpo, true) : ""}
      </div>

      <div class="run-pad small">
        ${[0, 1, 2, 3, 4, 5, 6].map(n => `<button data-action="ball" data-runs="${n}" class="run-btn r${n}">${n}</button>`).join("")}
        <button data-action="undo" class="run-btn undo" ${state.snapshots.length ? "" : "disabled"}>UNDO</button>
      </div>

      <div class="extra-pad" style="grid-template-columns:repeat(${enabledExtras.length}, 1fr);">
        ${enabledExtras.map(e => `<button data-action="toggle-extra" data-extra="${e.extra}" class="${ui.pendingExtra === e.extra ? "active" : ""}">${e.label.toUpperCase()}</button>`).join("")}
      </div>
      ${ui.pendingExtra ? `<div class="extra-hint">Tap the runs for this ${ui.pendingExtra === "noball" ? "no-ball" : ui.pendingExtra}. Tap the button again to cancel.</div>` : ""}

      <button data-action="open-wicket" class="wicket-btn">
        <span class="main">WICKET</span>
        ${inn.freeHit ? `<span class="sub">free hit — run out only</span>` : ""}
      </button>

      <div class="live-links">
        <button data-action="toggle-scorecard" class="link-btn">${ui.showFullScorecard ? "Hide" : "Show"} full scorecard</button>
        ${canEndInningsByHand(inn) ? renderEndInningsButton(match, inn, true) : ""}
      </div>
      ${ui.showFullScorecard ? renderInningsSummary(match, inn) : ""}
    </div>
  `;
}
