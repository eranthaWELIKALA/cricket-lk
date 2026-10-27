/* Cricket.lk — match: scorecards, innings break, result, share/export.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- scorecards / innings break / result --- */
function renderInningsSummary(match, inn){
  const bpo = inn.ballsPerOver;
  const battingName = teamName(match, inn.battingTeam);
  const battingRows = inn.batting.order.map(name => {
    const s = inn.batting.stats[name];
    const sr = s.balls ? ((s.runs / s.balls) * 100).toFixed(1) : "0.0";
    const status = s.out ? s.howOut : "not out";
    return `<tr><td>${unnamedNameHtml(match, name, liveName(name))}</td><td class="status">${escapeHtml(status)}</td><td>${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${sr}</td></tr>`;
  }).join("");
  const bowlingRows = inn.bowling.order.map(name => {
    const b = inn.bowling.stats[name];
    const econ = b.legalBalls ? (b.runs / (b.legalBalls / bpo)).toFixed(2) : "0.00";
    return `<tr><td>${unnamedNameHtml(match, name, liveName(name))}</td><td>${oversDisplay(b.legalBalls, bpo)}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${econ}</td></tr>`;
  }).join("");
  const extrasTotal = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
  return `
    <div class="innings-summary">
      <h3>${escapeHtml(battingName)} ${inn.runs}/${inn.wickets} <span class="ov">(${oversDisplay(inn.legalBalls, bpo)} ov)</span></h3>
      <table class="bat-table">
        <thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
        <tbody>${battingRows}</tbody>
      </table>
      <div class="extras-line">Extras ${extrasTotal} (w ${inn.extras.wides}, nb ${inn.extras.noBalls}, b ${inn.extras.byes}, lb ${inn.extras.legByes})</div>
      <table class="bowl-table">
        <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
        <tbody>${bowlingRows}</tbody>
      </table>
      ${inn.fallOfWickets.length ? `<div class="fow">FoW: ${inn.fallOfWickets.map(f => f.catchUp
        ? `${f.wicket} ${escapeHtml(liveName(f.batsman))} (by ${f.over})`
        : `${f.score}/${f.wicket} (${f.over})`).join(", ")}</div>` : ""}
      ${renderCatchUpNote(inn)}
    </div>
  `;
}

/* A caught-up innings (applyCatchUp) says where, and what it couldn't
   credit to anyone. Wickets in the gap list who fell "by" the catch-up. */
function renderCatchUpNote(inn){
  const un = catchUpUnattributed(inn);
  if (!un) return "";
  const bpo = inn.ballsPerOver;
  const at = inn.overs.filter(o => o.gap).map(o => oversDisplay(o.gap.toBalls, bpo)).join(", ");
  const parts = [];
  if (un.batRuns > 0) parts.push(`${un.batRuns} run${un.batRuns === 1 ? "" : "s"} not credited to a batter`);
  if (un.bowlBalls > 0) parts.push(`${oversDisplay(un.bowlBalls, bpo)} overs and ${Math.max(un.bowlRuns, 0)} runs not credited to a bowler`);
  else if (un.bowlRuns > 0) parts.push(`${un.bowlRuns} run${un.bowlRuns === 1 ? "" : "s"} not credited to a bowler`);
  const how = inn.overs.some(o => o.gap && o.gap.byHand) ? "Score set by hand" : "Score caught up";
  return `<div class="catch-up-note">${how} at ${at} ov${parts.length ? ` · ${parts.join(" · ")}` : ""}.</div>`;
}

/* The tabbed scorecard: one tab per innings, then Scorecard / Ball by ball.
   Shared by the live scorecard sheet, Result's full scorecard and the
   completed-match sheet (ui.matchDetail). Which tab is showing lives in
   ui.scorecard ({ inn: index | null = the latest innings, mode: "card" |
   "balls" }), reset whenever one of those opens -- only one is ever on
   screen. Every innings' card is rendered (inactive ones `hidden`) so
   Export PDF can print them all (see the print rules). */
function renderScorecard(match){
  const sc = ui.scorecard || {};
  const last = match.innings.length - 1;
  const idx = match.innings[sc.inn] ? sc.inn : last;
  const mode = sc.mode === "balls" || sc.mode === "comms" ? sc.mode : "card";
  if (last < 0) return `<p class="hint">Nothing scored.</p>`;
  return `
    <div class="scorecard-tabs">
      ${match.innings.length > 1 ? tabsHtml("scorecard-inn", match.innings.map((i, n) =>
        [n, `${escapeHtml(teamName(match, i.battingTeam))} <span class="n">${i.runs}-${i.wickets}</span>`]), idx, "sc-inn-tabs") : ""}
      ${tabsHtml("scorecard-mode", [["card", "Scorecard"], ["balls", "Ball by ball"], ["comms", "Commentary"]], mode, "sc-mode-tabs")}
      ${match.innings.map((inn, n) => `<div class="sc-pane" ${n === idx && mode === "card" ? "" : "hidden"}>${renderInningsSummary(match, inn)}</div>`).join("")}
      ${mode === "balls" ? renderBallByBall(match, match.innings[idx]) : ""}
      ${mode === "comms" ? renderCommentary(match, match.innings[idx]) : ""}
    </div>`;
}

/* Commentary: inningsCommentary (ENGINE) newest first -- each over's
   "end of over" row sits above its balls, like a commentary feed. */
function renderCommentary(match, inn){
  const lines = inningsCommentary(inn, { name: liveName, anonymous: !!match.anonymous });
  const ends = commentaryBookends(match, match.innings.indexOf(inn));
  const team = escapeHtml(teamName(match, inn.battingTeam));
  const note = (texts, cls) => texts.length ? `<div class="comm-note ${cls}">${texts.map(t => `<p>${escapeHtml(t)}</p>`).join("")}</div>` : "";
  const rows = lines.slice().reverse().map(l => {
    if (l.type === "gap") return `
      <div class="comm-over comm-gap">
        <div class="comm-over-top"><span>${l.byHand ? "Score set by hand" : "Score caught up"}</span><span class="n">${team} ${escapeHtml(l.to)}</span></div>
        <div class="comm-over-sub n">${l.byHand ? `Was ${escapeHtml(l.from)} · typed in, not scored ball by ball` : `From ${escapeHtml(l.from)} · ${l.runs} run${l.runs === 1 ? "" : "s"}${l.wickets ? ` · ${l.wickets} wkt${l.wickets === 1 ? "" : "s"}` : ""} not scored ball by ball`}</div>
      </div>`;
    if (l.type === "over") return `
      <div class="comm-over">
        <div class="comm-over-top"><span>End of over ${l.over}</span><span class="n">${team} ${l.score}-${l.wkts}</span></div>
        <div class="comm-over-sub n">${l.maiden ? "Maiden" : `${l.runs} run${l.runs === 1 ? "" : "s"}`}${l.wickets ? ` · ${l.wickets} wkt${l.wickets === 1 ? "" : "s"}` : ""}${l.bowler ? ` · ${escapeHtml(l.bowler)} ${l.figures}` : ""}</div>
      </div>`;
    return `
      <div class="comm-ball${l.tone ? " " + l.tone : ""}">
        <div class="comm-left"><span class="n comm-label">${l.label}</span><span class="chip ${l.tone}">${escapeHtml(l.display)}</span></div>
        <div class="comm-text">
          ${l.who ? `<span class="comm-who">${escapeHtml(l.who)},</span> ` : ""}<strong>${escapeHtml(l.text)}</strong>
          ${l.batter ? `<div class="comm-batter n">${escapeHtml(l.batter)}</div>` : ""}
          ${l.detail ? `<div class="comm-detail">${escapeHtml(l.detail)}</div>` : ""}
          ${l.milestone ? `<div class="comm-milestone">${escapeHtml(l.milestone)}</div>` : ""}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="commentary">
      <h3>${team} ${inn.runs}/${inn.wickets} <span class="ov">(${oversDisplay(inn.legalBalls, inn.ballsPerOver)} ov)</span></h3>
      ${note(ends.end, "end")}
      ${rows || `<p class="hint">No balls bowled yet.</p>`}
      ${note(ends.start, "start")}
    </div>`;
}

/* Every over of an innings, newest first: bowler, each ball as a chip
   (same colors as the live over rail), the over's runs/wickets and the
   score at its end. The over in progress (currentOverEvents) leads. */
function renderBallByBall(match, inn){
  const bpo = inn.ballsPerOver;
  // The match being scored (or just finished) on this device: tap a ball to edit it.
  const editable = ballEditAllowed(match) && !!inn.log;
  const idx = match.innings.indexOf(inn);
  const overs = inn.overs.map(o => ({ bowler: o.bowler, events: o.events, gap: o.gap, part: !!o.partial }));
  if (inn.currentOverEvents.length) overs.push({ bowler: inn.bowler, events: inn.currentOverEvents, live: !inn.complete });
  if (!overs.length) return `<p class="hint">No balls bowled yet.</p>`;
  // Over numbers come from the legal balls before each over: after a catch-up
  // gap the next over can start part way through (it shows as "part").
  let score = 0, wkts = 0, balls = 0;
  const rows = overs.map(o => {
    if (o.gap){
      const g = o.gap;
      score = g.toRuns; wkts = g.toWickets; balls = g.toBalls;
      const r = g.toRuns - g.fromRuns, w = g.toWickets - g.fromWickets;
      // A score set by hand can go down as well as up: show from -> to.
      const sum = g.byHand
        ? `${g.fromRuns}-${g.fromWickets} (${oversDisplay(g.fromBalls, bpo)}) → ${g.toRuns}-${g.toWickets} (${oversDisplay(g.toBalls, bpo)})`
        : `${oversDisplay(g.fromBalls, bpo)} → ${oversDisplay(g.toBalls, bpo)} ov · ${r} run${r === 1 ? "" : "s"}${w ? ` · ${w} wkt${w === 1 ? "" : "s"}` : ""}`;
      return `
      <div class="bbb-over bbb-gap">
        <div class="bbb-head">
          <span class="bbb-num">${g.byHand ? "Score set by hand" : "Score caught up"}</span>
          <span class="n bbb-sum">${sum}</span>
        </div>
        <p class="hint" style="margin:2px 0 0;">${g.byHand ? "The final score was typed in, not scored ball by ball." : "Not scored ball by ball."}</p>
        <div class="n bbb-score">${escapeHtml(teamName(match, inn.battingTeam))} ${score}-${wkts}</div>
      </div>`;
    }
    const start = balls, i = Math.floor(start / bpo);
    const legal = o.events.filter(ev => !/^(Wd|Nb)/.test(ev.display)).length;
    balls = start + legal;
    let inOver = start % bpo;
    const part = o.part || start % bpo !== 0;
    const runs = o.events.reduce((s, ev) => s + (ev.runs || 0), 0);
    const w = o.events.filter(ev => ev.isWicket).length;
    score += runs; wkts += w;
    let lastLabel = "";
    const chips = o.events.map(ev => {
      let cls = "chip";
      if (ev.isWicket) cls += " wicket";
      else if (ev.runs === 4 && !/^(Wd|Nb|B|Lb)/.test(ev.display)) cls += " four";
      else if (ev.runs === 6 && !/^(Wd|Nb|B|Lb)/.test(ev.display)) cls += " six";
      else if (/^(Wd|Nb)/.test(ev.display)) cls += " extra";
      // "4.3": a wide/no-ball carries the number of the ball still to come.
      const isLegal = !/^(Wd|Nb)/.test(ev.display);
      if (isLegal) inOver += 1;
      const label = `${i}.${isLegal ? inOver : inOver + 1}`;
      lastLabel = label;
      // Each ball sits over its number ("4.3"), so an over reads as one group.
      const ball = chip => `<span class="bbb-ball">${chip}<span class="bbb-ball-no n">${label}</span></span>`;
      if (editable && ev.seq != null && editableBall(match, idx, ev.seq)){
        return ball(`<button type="button" data-action="edit-ball" data-inn="${idx}" data-seq="${ev.seq}" data-label="${label}" class="${cls} chip-edit" aria-label="Edit ball ${label}: ${escapeHtml(ev.display)}">${escapeHtml(ev.display)}</button>`);
      }
      return ball(`<span class="${cls}">${escapeHtml(ev.display)}</span>`);
    }).join("");
    // A "+" on an over left short that isn't being bowled any more (an
    // innings ended by hand mid-over): add the ball the scorer missed. Overs
    // are counted in legal balls, so a full over can't take another one -- a
    // ball elsewhere is added from its neighbour's sheet (+ Ball before/after).
    const last = o.events[o.events.length - 1];
    const short = !o.live && inOver < bpo && (!inn.complete || inn.completeReason === "closed");
    const addBall = editable && short && last && last.seq != null && editableBall(match, idx, last.seq)
      ? `<span class="bbb-ball"><button type="button" data-action="add-ball" data-inn="${idx}" data-seq="${last.seq}" data-where="after" data-label="${lastLabel}" class="chip chip-add" aria-label="Add a ball after ${lastLabel}">+</button><span class="bbb-ball-no n">add</span></span>` : "";
    return `
      <div class="bbb-over">
        <div class="bbb-head">
          <span class="bbb-num">Over ${i + 1}${part ? " (part)" : ""}${o.live ? " · now" : ""}</span>
          <span class="bbb-bowler">${o.bowler ? escapeHtml(liveName(o.bowler)) : "—"}</span>
          <span class="n bbb-sum">${runs} run${runs === 1 ? "" : "s"}${w ? ` · ${w} wkt${w === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div class="chips bbb-chips">${chips}${addBall}</div>
        <div class="n bbb-score">${escapeHtml(teamName(match, inn.battingTeam))} ${score}-${wkts}</div>
      </div>`;
  });
  return `
    <div class="ball-by-ball">
      <h3>${escapeHtml(teamName(match, inn.battingTeam))} ${inn.runs}/${inn.wickets} <span class="ov">(${oversDisplay(inn.legalBalls, bpo)} ov)</span></h3>
      ${rows.reverse().join("")}
      ${editable ? `<p class="hint bbb-edit-hint">Tap a ball to change it, remove it or add a missed ball next to it: every later ball is worked out again.</p>` : ""}
      ${ballEditAllowed(match) && !inn.log && inn.complete && !inn.overs.some(o => o.gap) ? `<p class="hint">This innings' balls can't be changed one by one any more: only the most recent matches keep what's needed for that. You can still set the final score.</p>` : ""}
      ${ballEditAllowed(match) ? `<button type="button" data-action="open-score-set" class="ghost bbb-score-set">Set the final score instead</button>` : ""}
      <p class="hint">Newest over first. W wicket · Wd wide · Nb no-ball · B bye · Lb leg bye · Ro run out.</p>
    </div>`;
}

/* A completed match's result + scorecard, as a sheet over any screen
   (tournament fixtures, recent matches). ui.matchDetail = { match, view }:
   it only belongs to the view it was opened on. */
function findCompletedMatch(id){
  const hit = x => x && ((x.data && x.data.id === id) || x.id === id);
  const fromRows = rows => { const r = (rows || []).find(hit); return r ? (r.data || r) : null; };
  return state.matchHistory[id]
    || fromRows(ui.clubTournament && ui.clubTournament.matches)
    || fromRows(ui.club && ui.club.matches)
    || fromRows(ui.premier && ui.premier.premierMatches)
    || fromRows(ui.profile && ui.profile.clubMatches)
    || null;
}
function openMatchDetail(id){
  const match = findCompletedMatch(id);
  if (!match || !match.innings) return;
  ui.matchDetail = { match, view: state.view };
  ui.scorecard = { inn: 0, mode: "card" };
  render();
}
function renderMatchDetailModal(){
  const m = ui.matchDetail.match;
  const detail = renderResultDetail(m);
  const motm = m.motm || pickMatchMOTM(m);
  const when = m.completedAt ? new Date(m.completedAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
  return `
    <div class="modal-backdrop">
      <div class="modal scorecard-modal" data-keep-scroll="match-detail" role="dialog" aria-label="Match scorecard">
        <div class="wicket-modal-head">
          <h2>${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}</h2>
          <button type="button" data-action="close-match-detail" class="sheet-close" aria-label="Close scorecard">✕</button>
        </div>
        <div class="result-hero compact">
          <h3>${escapeHtml(m.result || "")}</h3>
          ${detail ? `<div class="n detail">${escapeHtml(detail)}</div>` : ""}
          <div class="muted">${[when, motm ? `Player of the match: ${escapeHtml(motm)}` : ""].filter(Boolean).join(" · ")}</div>
        </div>
        ${m.resultOnly ? renderResultOnlyCard(m) : renderScorecard(m)}
        <div class="share-row">
          <button type="button" data-action="share-match-detail" class="ghost" style="font-weight:800;letter-spacing:.04em;">Share image</button>
          <button type="button" data-action="export-pdf-detail" class="ghost" style="font-weight:800;letter-spacing:.04em;">Export PDF</button>
        </div>
        ${(() => {
          // A match finished on this device can still be put right (see openMatchFromHistory).
          const blocked = historyEditBlocked(m);
          if (blocked === "none") return "";
          return blocked ? `<p class="hint">${escapeHtml(blocked)}</p>`
            : `<button type="button" data-action="edit-archived-match" data-id="${escapeHtml(m.id)}" class="ghost edit-match-btn">✎ Edit match</button>`;
        })()}
        <button type="button" data-action="close-match-detail" class="primary" style="width:100%;">Close</button>
      </div>
    </div>`;
}

/* A result-only fixture (createResultOnlyMatch) has totals and nothing else. */
function renderResultOnlyCard(m){
  return `
    <div class="innings-summary">
      ${m.innings.map(inn => `<h3>${escapeHtml(teamName(m, inn.battingTeam))} ${inn.runs}/${inn.wickets}${inn.legalBalls != null ? ` <span class="ov">(${oversDisplay(inn.legalBalls, inn.ballsPerOver)} ov)</span>` : ""}</h3>`).join("")}
      <p class="hint" style="margin:6px 0 0;">Result entered by hand — no ball-by-ball scorecard.</p>
    </div>`;
}

/* A condensed "highlights" view for the innings break -- top 3 scorers,
   top 2 bowlers, extras inline -- deliberately separate from
   renderInningsSummary()'s full batting/bowling tables, which Live's
   "Show full scorecard" toggle and the Result screen still use as-is.
   Reuses the Live screen's .matchup-head/.matchup-row/.partnership-row
   classes (a plain eyebrow-header + data-row layout, nothing live-screen-
   specific about them) rather than inventing a parallel set. */
function renderInningsHighlights(match, inn){
  const bpo = inn.ballsPerOver;
  const battingName = teamName(match, inn.battingTeam);
  const bowlingName = teamName(match, inn.bowlingTeam);
  const topScorers = [...inn.batting.order].sort((a, b) => inn.batting.stats[b].runs - inn.batting.stats[a].runs).slice(0, 3);
  const bestBowlers = [...inn.bowling.order]
    .filter(name => inn.bowling.stats[name].legalBalls > 0)
    .sort((a, b) => inn.bowling.stats[b].wickets - inn.bowling.stats[a].wickets || inn.bowling.stats[a].runs - inn.bowling.stats[b].runs)
    .slice(0, 2);
  const extrasTotal = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;

  return `
    <div class="innings-summary">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:.9rem;font-weight:800;">${escapeHtml(battingName)}</span>
        <span class="n" style="flex-grow:1;text-align:right;font-size:1.25rem;font-weight:800;">${inn.runs}</span>
        <span class="n" style="color:var(--muted);font-size:.8rem;">(${oversDisplay(inn.legalBalls, bpo)})</span>
      </div>
      <div class="matchup-head bowler-head"><span>Top scorers</span><span style="width:40px;">R</span><span style="width:32px;">B</span><span style="width:46px;">SR</span></div>
      ${topScorers.length ? topScorers.map(name => {
        const s = inn.batting.stats[name];
        const sr = s.balls ? ((s.runs / s.balls) * 100).toFixed(1) : "0.0";
        return `<div class="matchup-row"><span class="name">${escapeHtml(liveName(name))}</span><span class="stat emph" style="width:40px;">${s.runs}</span><span class="stat" style="width:32px;">${s.balls}</span><span class="stat" style="width:46px;">${sr}</span></div>`;
      }).join("") : `<p class="hint">No batting yet.</p>`}
      <div class="partnership-row"><span>Extras</span><span class="val n" style="flex-grow:1;text-align:right;font-size:.78rem;">${extrasTotal} (w ${inn.extras.wides} · nb ${inn.extras.noBalls} · b ${inn.extras.byes} · lb ${inn.extras.legByes})</span></div>
    </div>
    <div class="innings-summary">
      <div class="matchup-head"><span>Best bowling · ${escapeHtml(bowlingName)}</span><span style="width:90px;">O-M-R-W</span></div>
      ${bestBowlers.length ? bestBowlers.map(name => {
        const b = inn.bowling.stats[name];
        return `<div class="matchup-row"><span class="name">${escapeHtml(name)}</span><span class="stat emph" style="width:90px;">${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}</span></div>`;
      }).join("") : `<p class="hint">No overs bowled yet.</p>`}
    </div>
  `;
}

function renderInningsBreak(match){
  const i1 = match.innings[0];
  const battingNext = teamName(match, i1.bowlingTeam);
  const target = i1.runs + 1;
  const rpo = match.oversLimit != null ? target / match.oversLimit : null;
  const conditionTags = [
    ...conditionTagsFor(match),
    match.wideEnabled ? `wide ${i1.wideBaseRuns}` : null,
    match.noBallEnabled ? `no-ball ${i1.noBallBaseRuns}` : null
  ].filter(Boolean);
  return `
    <div class="screen break">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">
        <h2 style="margin:0;">Innings break</h2>
        <span style="flex-grow:1;text-align:right;font-size:.7rem;font-weight:700;color:var(--muted);letter-spacing:.06em;">1ST INNINGS DONE</span>
      </div>
      ${renderInningsHighlights(match, i1)}
      <div class="target-tile" style="width:auto;margin-bottom:10px;">
        <div class="eyebrow">${escapeHtml(battingNext).toUpperCase()} NEED</div>
        <div style="display:flex;align-items:baseline;gap:10px;margin-top:2px;">
          <span class="n" style="font-size:1.6rem;font-weight:800;">${target}</span>
          <span class="n" style="font-size:.8rem;font-weight:700;opacity:.8;">${match.oversLimit != null ? `from ${match.oversLimit} overs` : "no over limit"}</span>
          ${rpo != null ? `<span class="n" style="flex-grow:1;text-align:right;font-size:.8rem;font-weight:800;">${rpo.toFixed(2)} rpo</span>` : ""}
        </div>
      </div>
      <div class="chips">
        ${conditionTags.map(t => `<span class="n tag-pill">${escapeHtml(t)}</span>`).join("")}
        <span class="n tag-pill${i1.freeHitOnNoBall ? " gold" : ""}">free hit ${i1.freeHitOnNoBall ? "on" : "off"}</span>
      </div>
      ${match.presetName ? `<p class="hint">Playing conditions came from the <b style="color:var(--text);">${escapeHtml(match.presetName)}</b> preset and are fixed for the whole match.</p>` : ""}
      <button type="button" data-action="open-edit-balls" class="link-btn">Full scorecard · fix a ball</button>
      ${renderGoBackRow(match)}
      <button data-action="start-second-innings" class="primary">Start 2nd innings</button>
    </div>
  `;
}

/* A score/overs/"chasing N · balls left" line under the result headline
   -- kept separate from `match.result` (the persisted sentence standings/
   fixtures already read verbatim) rather than reparsed from it, since
   this needs the raw innings numbers anyway. No line for a forfeited
   match (there's no real chase to describe) or a first-innings forfeit
   (innings[1] doesn't exist -- same guard renderResult's scorecard
   section already needs). */
function renderResultDetail(match){
  const [i1, i2] = match.innings;
  if (match.forfeited || !i2 || match.resultOnly) return "";
  const bpo = match.ballsPerOver;
  const i2ov = oversDisplay(i2.legalBalls, bpo);
  const i2Score = isAllOut(i2) ? `${i2.runs} all out` : `${i2.runs}-${i2.wickets}`;
  if (i2.runs === i1.runs) return `${i2Score} (${i2ov}) level with ${i1.runs}`;
  if (i2.runs > i1.runs){
    if (i2.oversLimit == null) return `${i2Score} (${i2ov}) chasing ${i1.runs}`;
    const ballsLeft = i2.oversLimit * bpo - i2.legalBalls;
    return `${i2Score} (${i2ov}) chasing ${i1.runs} · ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"} left`;
  }
  return `${i2Score} (${i2ov}) chasing ${i1.runs}`;
}

/* Result's per-innings card is even more condensed than
   renderInningsHighlights (2 batters + 1 bowler, no extras line, one
   combined card) -- different enough in shape (combined vs. two cards,
   fewer rows) that parameterizing renderInningsHighlights would need
   more branches than just writing this separately. The winning team's
   score is picked out in green; ties and forfeits get no highlight
   (there's no single "winner" score to point at). Full detail is never
   actually lost -- toggling "Show full scorecard" swaps these cards for
   renderInningsSummary's complete tables, same flag Live's toggle uses. */
function renderResultInningsCard(match, inn){
  const bpo = inn.ballsPerOver;
  const [i1, i2] = match.innings;
  const isWinner = i2 && !match.forfeited && i2.runs !== i1.runs && (i2.runs > i1.runs ? inn === i2 : inn === i1);
  const scoreStr = isAllOut(inn) ? `${inn.runs}` : `${inn.runs}-${inn.wickets}`;
  const topBatters = [...inn.batting.order].sort((a, b) => inn.batting.stats[b].runs - inn.batting.stats[a].runs).slice(0, 2);
  const topBowler = [...inn.bowling.order]
    .filter(name => inn.bowling.stats[name].legalBalls > 0)
    .sort((a, b) => inn.bowling.stats[b].wickets - inn.bowling.stats[a].wickets || inn.bowling.stats[a].runs - inn.bowling.stats[b].runs)[0];
  const bowlerStats = topBowler ? inn.bowling.stats[topBowler] : null;
  return `
    <div class="innings-summary">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:.85rem;font-weight:800;">${escapeHtml(teamName(match, inn.battingTeam))}</span>
        <span class="n" style="flex-grow:1;text-align:right;font-size:1.05rem;font-weight:800;${isWinner ? "color:var(--accent-2);" : ""}">${scoreStr}</span>
        <span class="n" style="font-size:.7rem;color:var(--muted);">(${oversDisplay(inn.legalBalls, bpo)})</span>
      </div>
      ${topBatters.map(name => {
        const s = inn.batting.stats[name];
        return `<div style="display:flex;gap:6px;margin-top:8px;"><span style="flex-grow:1;font-size:.78rem;color:var(--muted);">${escapeHtml(liveName(name))}</span><span class="n" style="font-size:.78rem;font-weight:700;">${s.runs}${!s.out ? "*" : ""} (${s.balls})</span></div>`;
      }).join("")}
      ${topBowler ? `<div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:2px solid var(--line-strong);"><span style="flex-grow:1;font-size:.78rem;color:var(--muted);">${escapeHtml(liveName(topBowler))}</span><span class="n" style="font-size:.78rem;font-weight:700;">${oversDisplay(bowlerStats.legalBalls, bpo)}-${bowlerStats.maidens}-${bowlerStats.runs}-${bowlerStats.wickets}</span></div>` : ""}
    </div>
  `;
}

function formatMotmLine(match, t){
  if (!t) return "";
  const parts = [];
  if (t.balls > 0) parts.push(`${t.runs}${t.notOuts > 0 ? "*" : ""} (${t.balls})`);
  if (t.catches > 0) parts.push(`${t.catches} ct`);
  if (t.runouts > 0) parts.push(`${t.runouts} ro`);
  if (t.balls > 0) parts.push(`SR ${((t.runs / t.balls) * 100).toFixed(1)}`);
  if (t.legalBalls > 0) parts.push(`${oversDisplay(t.legalBalls, match.ballsPerOver)}-${t.maidens}-${t.runsConceded}-${t.wickets}`);
  return parts.join(" · ");
}

// A one-shot burst inside the result card (CSS .confetti: only when Result
// first appears, never on a re-render). Spread is fixed, not random, so a
// render stays a pure function of state.
function confettiHtml(){
  return `<div class="confetti" aria-hidden="true">${Array.from({ length: 14 }, (_, i) =>
    `<i style="--x:${(i * 37 + 5) % 96}%;--d:${(i % 5) * 0.07}s;--dx:${(i % 2 ? 1 : -1) * (8 + (i * 5) % 22)}px;--rot:${(i % 3 ? 1 : -1) * (200 + i * 37)}deg"></i>`).join("")}</div>`;
}

function renderResult(match){
  const allNames = Array.from(matchPlayerNames(match)).filter(n => !isUnnamedPlayer(n));
  const unnamed = ballEditAllowed(match) ? unnamedPlayers(match) : [];
  const motmName = match.motm || pickMatchMOTM(match);
  const motmTotal = motmName ? aggregatePlayerStats([match]).find(t => t.name === motmName) : null;
  const detail = renderResultDetail(match);
  const won = !match.forfeited && !match.editingFromHistory && / won by /.test(match.result || "");
  return `
    <div class="screen result">
      <div class="result-hero">
        ${won ? confettiHtml() : ""}
        <div class="eyebrow">RESULT</div>
        <h2>${escapeHtml(match.result)}</h2>
        ${detail ? `<div class="n detail">${escapeHtml(detail)}</div>` : ""}
      </div>
      <div class="motm-card">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="motm-label">Player of the match</span>
          ${motmTotal ? `<span class="n" style="flex-grow:1;text-align:right;font-size:.82rem;font-weight:800;color:var(--accent);">${motmTotal.points} pts</span>` : ""}
        </div>
        <span class="motm-name">${escapeHtml(motmName || "—")}</span>
        ${motmTotal ? `<span class="n motm-line">${formatMotmLine(match, motmTotal)}</span>` : ""}
        ${allNames.length ? `
          <form id="motm-form" class="inline-form">
            <select name="motm">${allNames.map(n => `<option value="${escapeHtml(n)}" ${n === motmName ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>
            <button type="submit" class="ghost small">Change</button>
          </form>
        ` : ""}
      </div>
      ${unnamed.length ? `
        <div class="unnamed-card">
          <div class="section-label">Still unnamed</div>
          <p class="hint" style="margin-top:0;">They're left out of stats until you say who they were.</p>
          <div class="unnamed-list">${unnamed.map(u => unnamedNameHtml(match, u.name)).join("")}</div>
        </div>` : ""}
      <button data-action="toggle-scorecard" class="link-btn">${ui.showFullScorecard ? "Show condensed summary" : "Show full scorecard"}</button>
      ${ui.showFullScorecard ? renderScorecard(match) : `
        ${renderResultInningsCard(match, match.innings[0])}
        ${match.innings[1] ? renderResultInningsCard(match, match.innings[1]) : ""}
      `}
      <p class="hint">${match.editingFromHistory
        ? "Editing from match history: each change is saved to it straight away, and stats, MVP and the points table follow."
        : "Archived to match history — this is what stats, MVP and the points table read from."}</p>
      <div class="share-row">
        <button data-action="share-image" class="ghost" style="font-weight:800;letter-spacing:.04em;">Share image</button>
        <button data-action="export-pdf" class="ghost" style="font-weight:800;letter-spacing:.04em;">Export PDF</button>
      </div>
      ${renderGoBackRow(match)}
      <button data-action="finish-match" class="primary">${match.editingFromHistory ? "Done" : match.tournamentId ? "Back to tournament" : match.clubId ? "Back to club" : "New match"}</button>
    </div>
  `;
}

/* The way back from the innings break or Result: "Reopen <team>'s innings"
   for an innings ended by hand (newest first), and Undo for the rest -- the
   last ball that ended it, a forfeit, a ball edit. Undo isn't offered when
   the newest innings can be reopened: that's the same step, said plainly. */
function renderGoBackRow(match){
  if (match !== state.match) return "";
  const reopen = reopenableInnings(match);
  const undo = reopen[0] !== match.innings.length - 1 ? undoLabel(match) : null;
  if (!reopen.length && !undo) return "";
  return `<div class="go-back-row">
    ${reopen.map(i => `<button type="button" data-action="reopen-innings" data-inn="${i}" class="ghost small">↺ Reopen ${escapeHtml(possessive(teamName(match, match.innings[i].battingTeam)))} innings</button>`).join("")}
    ${undo ? `<button type="button" data-action="undo" class="ghost small">↶ ${undo}</button>` : ""}
  </div>`;
}

function handleMotmSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const motm = f.get("motm");
  state.match.motm = motm;
  if (state.match.archivedId && state.matchHistory[state.match.archivedId]){
    state.matchHistory[state.match.archivedId].motm = motm;
  }
  save(); render();
}

/* --- share / export (dependency-free: canvas PNG, print-to-PDF) ---
   Share images are drawn on a <canvas> with a small kit (SHARE_THEMES,
   shareCard/shareText/...): the app logo + name at the top, "by Erantha
   Welikala" at the foot, content as rounded cards. Tapping Share opens a
   preview sheet (ui.sharePreview) where the viewer picks the Night/Day theme
   and then shares (share sheet with the PNG) or saves it -- the Share button
   there is the tap navigator.share needs. Content is drawn onto a tall
   transparent canvas, then copied onto a background cut to its real height. */
const SHARE_THEMES = {
  night: { label: "Night", bg1: "#0F3D2D", bg2: "#06150F", text: "#F3F8F5", muted: "#9DBFAE", faint: "rgba(255,255,255,.06)", panel: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.13)", accent: "#34D399", accentInk: "#06150F", gold: "#F5C542", goldInk: "#1F1600", stripe: "rgba(255,255,255,.025)" },
  day:   { label: "Day",   bg1: "#FBFDFB", bg2: "#E2EFE7", text: "#0C2219", muted: "#557566", faint: "rgba(12,34,25,.05)", panel: "#FFFFFF", line: "rgba(12,34,25,.12)", accent: "#0E9F6E", accentInk: "#FFFFFF", gold: "#E5A800", goldInk: "#241900", stripe: "rgba(12,34,25,.03)" }
};
const SHARE_W = 1080, SHARE_PAD = 56, SHARE_FONT = `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
let shareLogo = null;
function loadShareLogo(){
  if (!shareLogo) shareLogo = new Promise(res => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = "icon-192.png";
  });
  return shareLogo;
}
function shareFont(ctx, size, weight){ ctx.font = `${weight || 400} ${size}px ${SHARE_FONT}`; }
function shareRound(ctx, x, y, w, h, r){
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}
function shareCard(ctx, x, y, w, h, fill, stroke, r){
  shareRound(ctx, x, y, w, h, r == null ? 28 : r);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke){ ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
}
// Text clipped to maxW with an ellipsis; align "left" | "right" | "center".
function shareText(ctx, text, x, y, { size = 26, weight = 400, color, align = "left", maxW, spacing } = {}){
  shareFont(ctx, size, weight);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = spacing ? spacing + "px" : "0px";
  let t = String(text == null ? "" : text);
  if (maxW && ctx.measureText(t).width > maxW){
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    t += "…";
  }
  ctx.fillText(t, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  return ctx.measureText(t).width;
}
function shareLogoImg(ctx, logo, x, y, size){
  if (!logo) return;
  ctx.save(); shareRound(ctx, x, y, size, size, size * 0.24); ctx.clip();
  ctx.drawImage(logo, x, y, size, size); ctx.restore();
}
// Header: logo + app name (left), an optional eyebrow (right). Returns the next y.
function shareHeader(ctx, th, logo, right){
  shareLogoImg(ctx, logo, SHARE_PAD, SHARE_PAD, 76);
  shareText(ctx, "Cricket.lk", SHARE_PAD + 96, SHARE_PAD + 38, { size: 36, weight: 800, color: th.text });
  shareText(ctx, "BALL-BY-BALL SCORER", SHARE_PAD + 97, SHARE_PAD + 68, { size: 17, weight: 800, color: th.muted, spacing: 3 });
  if (right) shareText(ctx, right, SHARE_W - SHARE_PAD, SHARE_PAD + 48, { size: 22, weight: 700, color: th.muted, align: "right", maxW: 420 });
  return SHARE_PAD + 76 + 44;
}
function shareFooter(ctx, th, logo, y){
  ctx.fillStyle = th.line; ctx.fillRect(SHARE_PAD, y, SHARE_W - SHARE_PAD * 2, 2);
  y += 36;
  shareLogoImg(ctx, logo, SHARE_PAD, y, 44);
  shareText(ctx, "Scored with Cricket.lk", SHARE_PAD + 60, y + 30, { size: 24, weight: 800, color: th.text });
  shareText(ctx, "by Erantha Welikala", SHARE_W - SHARE_PAD, y + 30, { size: 24, weight: 600, color: th.muted, align: "right" });
  return y + 44 + SHARE_PAD;
}
// Draws `content(ctx, y) -> endY` on a tall transparent canvas, then onto a
// themed background cut to the real height.
function composeShareImage(th, content){
  const tall = document.createElement("canvas");
  tall.width = SHARE_W; tall.height = 7000;
  const h = Math.min(tall.height, Math.ceil(content(tall.getContext("2d"))));
  const out = document.createElement("canvas");
  out.width = SHARE_W; out.height = h;
  const ctx = out.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, SHARE_W * 0.4, h);
  g.addColorStop(0, th.bg1); g.addColorStop(1, th.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, SHARE_W, h);
  // Mown-pitch stripes + a gold edge, then the content.
  ctx.fillStyle = th.stripe;
  for (let x = -h; x < SHARE_W; x += 120){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 0); ctx.lineTo(x + 60 + h, h); ctx.lineTo(x + h, h); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = th.gold; ctx.fillRect(0, 0, SHARE_W, 10);
  ctx.drawImage(tall, 0, 0);
  return out;
}
// A table: header labels + rows of cells; cols = [{ w, align }], first col
// takes the rest. Row: { cells, sub?, strong?, color? }. Returns the next y.
function shareTable(ctx, th, x, y, w, cols, head, rows){
  const fixed = cols.slice(1).reduce((s, c) => s + c.w, 0);
  const firstW = w - fixed;
  const colX = []; let cx = x + firstW;
  cols.slice(1).forEach(c => { cx += c.w; colX.push(cx); });
  head.forEach((label, i) => shareText(ctx, label, i === 0 ? x : colX[i - 1], y, { size: 17, weight: 800, color: th.muted, align: i === 0 ? "left" : "right", spacing: 2 }));
  y += 18;
  rows.forEach(r => {
    const rh = r.sub ? 66 : 48;
    ctx.fillStyle = th.line; ctx.fillRect(x, y, w, 1);
    const base = y + 34;
    shareText(ctx, r.cells[0], x, base, { size: 26, weight: r.strong ? 800 : 600, color: r.color || th.text, maxW: firstW - 16 });
    if (r.sub) shareText(ctx, r.sub, x, base + 26, { size: 18, color: th.muted, maxW: firstW - 16 });
    r.cells.slice(1).forEach((c, i) => shareText(ctx, c, colX[i], base, { size: 26, weight: i === 0 ? 800 : 500, color: i === 0 ? (r.color || th.text) : th.muted, align: "right" }));
    y += rh;
  });
  return y + 6;
}
function renderScorecardCanvas(match, themeKey, logo){
  const th = SHARE_THEMES[themeKey] || SHARE_THEMES.night;
  const when = match.completedAt ? new Date(match.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const motm = match.motm || pickMatchMOTM(match);
  const motmTotal = motm ? aggregatePlayerStats([match]).find(t => t.name === motm) : null;
  return composeShareImage(th, ctx => {
    const X = SHARE_PAD, W = SHARE_W - SHARE_PAD * 2;
    let y = shareHeader(ctx, th, logo, when);
    shareText(ctx, `${match.teamA} v ${match.teamB}`, X, y + 54, { size: 60, weight: 800, color: th.text, maxW: W });
    y += 84;
    // Result pill.
    shareFont(ctx, 28, 800);
    const rw = Math.min(W, ctx.measureText(match.result || "").width + 56);
    shareCard(ctx, X, y, rw, 60, th.accent, null, 30);
    shareText(ctx, match.result || "", X + 28, y + 40, { size: 28, weight: 800, color: th.accentInk, maxW: rw - 56 });
    y += 92;
    match.innings.forEach(inn => {
      const bpo = inn.ballsPerOver;
      const bat = inn.batting.order.map(n => ({ n, s: inn.batting.stats[n] }));
      const bowl = inn.bowling.order.map(n => ({ n, b: inn.bowling.stats[n] })).filter(r => r.b.legalBalls || r.b.runs || r.b.wickets);
      const topRuns = Math.max(0, ...bat.map(r => r.s.runs));
      const ext = inn.extras, extras = ext.wides + ext.noBalls + ext.byes + ext.legByes;
      const cardTop = y, inner = X + 32, iw = W - 64;
      // Measure: header 104 + batting (18 + rows) + extras 44 + bowling (18 + rows) + padding.
      const h = 112 + (bat.length ? 24 + bat.reduce((s, r) => s + (r.s.out || r.s.balls ? 66 : 48), 0) : 0)
        + 46 + (bowl.length ? 46 + bowl.length * 48 : 0) + 24;
      shareCard(ctx, X, cardTop, W, h, th.panel, th.line);
      shareText(ctx, teamName(match, inn.battingTeam), inner, cardTop + 62, { size: 34, weight: 800, color: th.text, maxW: iw - 360 });
      shareText(ctx, inn.legalBalls != null ? `(${oversDisplay(inn.legalBalls, bpo)} ov)` : "", X + W - 32, cardTop + 62, { size: 24, weight: 600, color: th.muted, align: "right" });
      shareFont(ctx, 24, 600);
      const ovW = inn.legalBalls != null ? ctx.measureText(`(${oversDisplay(inn.legalBalls, bpo)} ov)`).width + 14 : 0;
      shareText(ctx, `${inn.runs}/${inn.wickets}`, X + W - 32 - ovW, cardTop + 66, { size: 52, weight: 800, color: th.accent, align: "right" });
      let yy = cardTop + 112;
      if (bat.length){
        yy = shareTable(ctx, th, inner, yy, iw, [{}, { w: 80 }, { w: 70 }, { w: 60 }, { w: 60 }, { w: 100 }], ["BATTER", "R", "B", "4S", "6S", "SR"],
          bat.map(({ n, s }) => ({
            cells: [n, `${s.runs}${s.out ? "" : "*"}`, s.balls, s.fours, s.sixes, s.balls ? ((s.runs / s.balls) * 100).toFixed(1) : "–"],
            sub: s.out ? s.howOut : (s.balls ? "not out" : null),
            strong: s.runs === topRuns && topRuns > 0, color: s.runs === topRuns && topRuns > 0 ? th.gold : null
          })));
      }
      shareText(ctx, `Extras ${extras}  (w ${ext.wides}, nb ${ext.noBalls}, b ${ext.byes}, lb ${ext.legByes})`, inner, yy + 30, { size: 20, color: th.muted });
      yy += 46;
      if (bowl.length){
        yy = shareTable(ctx, th, inner, yy + 22, iw, [{}, { w: 80 }, { w: 60 }, { w: 70 }, { w: 60 }, { w: 100 }], ["BOWLER", "O", "M", "R", "W", "ECON"],
          bowl.map(({ n, b }) => ({ cells: [n, oversDisplay(b.legalBalls, bpo), b.maidens, b.runs, b.wickets, b.legalBalls ? (b.runs / (b.legalBalls / bpo)).toFixed(2) : "–"], strong: b.wickets >= 3 })));
      }
      y = cardTop + h + 24;
    });
    if (match.resultOnly){
      shareText(ctx, "Result entered by hand — no ball-by-ball scorecard.", X, y + 10, { size: 22, color: th.muted });
      y += 40;
    }
    if (motm){
      shareCard(ctx, X, y, W, 128, th.gold, null);
      shareText(ctx, "🏆", X + 32, y + 84, { size: 56 });
      shareText(ctx, "PLAYER OF THE MATCH", X + 116, y + 46, { size: 18, weight: 800, color: th.goldInk, spacing: 3 });
      shareText(ctx, motm, X + 116, y + 94, { size: 40, weight: 800, color: th.goldInk, maxW: W - 360 });
      if (motmTotal) shareText(ctx, `${motmTotal.points} pts`, X + W - 32, y + 82, { size: 30, weight: 800, color: th.goldInk, align: "right" });
      y += 128 + 28;
    }
    return shareFooter(ctx, th, logo, y + 8);
  });
}

/* Export PDF = the browser's print dialog ("Save as PDF") against the print
   rules: a branded header (logo, app name, what's printed) and footer ("by
   Erantha Welikala", date) that only exist in print. On Result it prints the
   full scorecard (expanded just for the print, then put back), and the PDF's
   file name follows document.title, set for the duration. */
function exportPdf(detailMatch){
  const m = detailMatch || state.match;
  const onResult = !!detailMatch || (navKey() === "result" && m);
  const c = !onResult && /ournamentDashboard$/.test(state.view) ? tournamentContext() : null;
  // A match (Result, or the completed-match sheet) always prints from
  // #print-root, which replaces #app in print -- so nothing on screen has to
  // change for the print and nothing has to be put back afterwards. That
  // matters on Android: window.print() doesn't block there and "afterprint"
  // fires before the print preview has captured the page, so anything undone
  // on afterprint was missing from the PDF.
  const printRoot = document.getElementById("print-root");
  if (printRoot) printRoot.innerHTML = onResult ? renderPrintableMatch(m) : "";
  document.body.classList.toggle("print-detail", !!(onResult && printRoot));
  const title = onResult ? `${m.teamA} v ${m.teamB}` : c ? `${c.name} — results` : "Cricket.lk";
  const brandTitle = document.querySelector("#print-brand .print-brand-title");
  if (brandTitle) brandTitle.textContent = onResult ? `${title} · ${m.result || ""}` : title;
  const footDate = document.querySelector("#print-foot .print-foot-date");
  if (footDate) footDate.textContent = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (!exportPdf.prevTitle) exportPdf.prevTitle = document.title;
  document.title = `${title} — Cricket.lk`;   // names the PDF
  // Tidy up on the scorer's next tap (they're back from the print dialog by
  // then), never on afterprint. Touches only the title and print-only parts.
  setTimeout(() => document.addEventListener("pointerdown", exportPdfCleanup, { once: true, capture: true }), 0);
  window.print();
}
function exportPdfCleanup(){
  if (exportPdf.prevTitle){ document.title = exportPdf.prevTitle; exportPdf.prevTitle = null; }
  document.body.classList.remove("print-detail");
  const printRoot = document.getElementById("print-root");
  if (printRoot) printRoot.innerHTML = "";
}

/* What a completed match prints as from the match sheet: result, player of
   the match and every innings in full. */
function renderPrintableMatch(m){
  const detail = renderResultDetail(m);
  const motm = m.motm || pickMatchMOTM(m);
  return `
    <div class="result-hero"><div class="eyebrow">RESULT</div><h2>${escapeHtml(m.result || "")}</h2>${detail ? `<div class="n detail">${escapeHtml(detail)}</div>` : ""}</div>
    ${motm ? `<div class="motm-card"><span class="motm-label">Player of the match</span><span class="motm-name">${escapeHtml(motm)}</span></div>` : ""}
    ${m.resultOnly ? renderResultOnlyCard(m) : m.innings.map(inn => renderInningsSummary(m, inn)).join("")}`;
}

/* The preview sheet. ui.sharePreview = { kind: "scorecard" | "tournament",
   view, theme, url, busy }; the PNG blob lives outside ui (sharePreviewBlob)
   because it isn't data. */
let sharePreviewBlob = null;
function openSharePreview(kind, match){
  // `match`: a completed match from the match sheet; else the one on Result.
  ui.sharePreview = { kind, match: match || null, view: navKey(), theme: ui.sharePreview ? ui.sharePreview.theme : "night", url: null };
  render();
  buildSharePreview();
}
async function buildSharePreview(){
  const sp = ui.sharePreview;
  if (!sp) return;
  const logo = await loadShareLogo();
  let canvas = null;
  const match = sp.match || state.match;
  if (sp.kind === "scorecard" && match) canvas = renderScorecardCanvas(match, sp.theme, logo);
  else if (sp.kind === "tournament"){ const c = tournamentContext(); if (c) canvas = renderTournamentCanvas(c, sp.theme, logo); }
  if (!canvas || ui.sharePreview !== sp) return;
  canvas.toBlob(blob => {
    if (ui.sharePreview !== sp || !blob) return;
    if (sp.url) URL.revokeObjectURL(sp.url);
    sharePreviewBlob = blob;
    sp.url = URL.createObjectURL(blob);
    render();
  }, "image/png");
}
function closeSharePreview(){
  if (ui.sharePreview && ui.sharePreview.url) URL.revokeObjectURL(ui.sharePreview.url);
  ui.sharePreview = null; sharePreviewBlob = null;
  render();
}
function sharePreviewFile(){
  const sp = ui.sharePreview;
  return new File([sharePreviewBlob], sp.kind === "tournament" ? "cricket-lk-tournament.png" : "cricket-lk-scorecard.png", { type: "image/png" });
}
function sharePreviewText(){
  const sp = ui.sharePreview;
  if (sp.kind === "scorecard"){ const m = sp.match || state.match; return `${m.teamA} v ${m.teamB}: ${m.result || ""}`; }
  const c = tournamentContext(), s = c && tournamentSummary(c.matches, c.preset);
  return c ? `${c.name}${s && s.champion ? ` — champions: ${s.champion.name}` : ""}` : "";
}
async function shareFromPreview(){
  if (!sharePreviewBlob) return;
  const file = sharePreviewFile();
  if (navigator.canShare && navigator.canShare({ files: [file] })){
    try { await navigator.share({ files: [file], title: "Cricket.lk", text: sharePreviewText() + "\n— scored with Cricket.lk" }); return; }
    catch (err){ if (err && err.name === "AbortError") return; }
  }
  saveFromPreview();
}
function saveFromPreview(){
  if (!sharePreviewBlob) return;
  const file = sharePreviewFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function renderSharePreviewModal(){
  const sp = ui.sharePreview;
  const canFiles = !!(navigator.canShare && sharePreviewBlob && navigator.canShare({ files: [sharePreviewFile()] }));
  return `
    <div class="modal-backdrop">
      <div class="modal share-modal" data-keep-scroll="share-preview" role="dialog" aria-modal="true" aria-label="Share image">
        <div class="wicket-modal-head">
          <h2>${sp.kind === "tournament" ? "Share results" : "Share scorecard"}</h2>
          <button type="button" data-action="close-share-preview" class="sheet-close" aria-label="Close">✕</button>
        </div>
        ${tabsHtml("share-theme", Object.entries(SHARE_THEMES).map(([k, t]) => [k, t.label]), sp.theme, "share-theme-tabs")}
        <div class="share-preview">${sp.url ? `<img src="${sp.url}" alt="Share image preview">` : loadingHtml("Drawing the image…")}</div>
        <div class="share-actions${canFiles ? "" : " single"}">
          ${canFiles ? `<button type="button" data-action="share-save" class="ghost" ${sp.url ? "" : "disabled"}>Save image</button>` : ""}
          <button type="button" data-action="${canFiles ? "share-send" : "share-save"}" class="primary" ${sp.url ? "" : "disabled"}>${canFiles ? "Share" : "Save image"}</button>
        </div>
      </div>
    </div>`;
}
