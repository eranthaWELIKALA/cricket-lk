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
    return `<tr><td>${escapeHtml(name)}</td><td class="status">${escapeHtml(status)}</td><td>${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${sr}</td></tr>`;
  }).join("");
  const bowlingRows = inn.bowling.order.map(name => {
    const b = inn.bowling.stats[name];
    const econ = b.legalBalls ? (b.runs / (b.legalBalls / bpo)).toFixed(2) : "0.00";
    return `<tr><td>${escapeHtml(name)}</td><td>${oversDisplay(b.legalBalls, bpo)}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${econ}</td></tr>`;
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
      ${inn.fallOfWickets.length ? `<div class="fow">FoW: ${inn.fallOfWickets.map(f => `${f.score}/${f.wicket} (${f.over})`).join(", ")}</div>` : ""}
    </div>
  `;
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
        return `<div class="matchup-row"><span class="name">${escapeHtml(name)}</span><span class="stat emph" style="width:40px;">${s.runs}</span><span class="stat" style="width:32px;">${s.balls}</span><span class="stat" style="width:46px;">${sr}</span></div>`;
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
  if (match.forfeited || !i2) return "";
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
        return `<div style="display:flex;gap:6px;margin-top:8px;"><span style="flex-grow:1;font-size:.78rem;color:var(--muted);">${escapeHtml(name)}</span><span class="n" style="font-size:.78rem;font-weight:700;">${s.runs}${!s.out ? "*" : ""} (${s.balls})</span></div>`;
      }).join("")}
      ${topBowler ? `<div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:2px solid var(--line-strong);"><span style="flex-grow:1;font-size:.78rem;color:var(--muted);">${escapeHtml(topBowler)}</span><span class="n" style="font-size:.78rem;font-weight:700;">${oversDisplay(bowlerStats.legalBalls, bpo)}-${bowlerStats.maidens}-${bowlerStats.runs}-${bowlerStats.wickets}</span></div>` : ""}
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

function renderResult(match){
  const allNames = Array.from(matchPlayerNames(match));
  const motmName = match.motm || pickMatchMOTM(match);
  const motmTotal = motmName ? aggregatePlayerStats([match]).find(t => t.name === motmName) : null;
  const detail = renderResultDetail(match);
  return `
    <div class="screen result">
      <div class="result-hero">
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
      <button data-action="toggle-scorecard" class="link-btn">${ui.showFullScorecard ? "Show condensed summary" : "Show full scorecard"}</button>
      ${ui.showFullScorecard ? `
        ${renderInningsSummary(match, match.innings[0])}
        ${match.innings[1] ? renderInningsSummary(match, match.innings[1]) : ""}
      ` : `
        ${renderResultInningsCard(match, match.innings[0])}
        ${match.innings[1] ? renderResultInningsCard(match, match.innings[1]) : ""}
      `}
      <p class="hint">Archived to match history — this is what stats, MVP and the points table read from.</p>
      <div class="share-row">
        <button data-action="share-image" class="ghost" style="font-weight:800;letter-spacing:.04em;">Share image</button>
        <button data-action="export-pdf" class="ghost" style="font-weight:800;letter-spacing:.04em;">Export PDF</button>
      </div>
      <button data-action="finish-match" class="primary">${match.tournamentId ? "Back to tournament" : match.clubId ? "Back to club" : "New match"}</button>
    </div>
  `;
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

/* --- share / export (dependency-free: canvas PNG, print-to-PDF) --- */
function renderScorecardCanvas(match){
  const W = 1080, pad = 48;
  function battingLines(inn){
    return inn.batting.order.map(name => {
      const s = inn.batting.stats[name];
      return `${name}  ${s.runs} (${s.balls})`;
    });
  }
  function bowlingLines(inn){
    return inn.bowling.order.map(name => {
      const b = inn.bowling.stats[name];
      return `${name}  ${oversDisplay(b.legalBalls, inn.ballsPerOver)}-${b.maidens}-${b.runs}-${b.wickets}`;
    });
  }
  const lines = [];
  lines.push({ text: `${match.teamA} vs ${match.teamB}`, size: 44, weight: "800" });
  lines.push({ text: match.result || "", size: 26, weight: "600", color: "#5FB98C" });
  lines.push({ size: 10 });
  match.innings.forEach(inn => {
    lines.push({ text: `${teamName(match, inn.battingTeam)}  ${inn.runs}/${inn.wickets}  (${oversDisplay(inn.legalBalls, inn.ballsPerOver)} ov)`, size: 30, weight: "700" });
    battingLines(inn).forEach(t => lines.push({ text: t, size: 22 }));
    lines.push({ size: 8 });
    bowlingLines(inn).forEach(t => lines.push({ text: t, size: 20, color: "#9FC2AF" }));
    lines.push({ size: 16 });
  });
  if (match.motm) lines.push({ text: `Man of the Match: ${match.motm}`, size: 24, weight: "700", color: "#F2C744" });

  const H = pad * 2 + lines.reduce((sum, l) => sum + (l.size + 14), 0);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0B2E22"; ctx.fillRect(0, 0, W, H);
  let y = pad;
  lines.forEach(l => {
    if (l.text){
      ctx.fillStyle = l.color || "#F1F6F2";
      ctx.font = `${l.weight || "400"} ${l.size}px -apple-system, sans-serif`;
      ctx.fillText(l.text, pad, y + l.size);
    }
    y += l.size + 14;
  });
  return canvas;
}

async function shareScorecardImage(match){
  const canvas = renderScorecardCanvas(match);
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], "cricket-lk-scorecard.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      try { await navigator.share({ files: [file], title: "Cricket.lk scorecard", text: match.result || "" }); return; }
      catch (_){ /* user cancelled, or share failed — fall through to a plain download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "cricket-lk-scorecard.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}
