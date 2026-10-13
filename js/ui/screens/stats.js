/* Cricket.lk — screens: stats leaderboards.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- stats (all-time leaderboards, shared with the tournament stats tab) --- */
function renderLeaderboards(totals){
  const byRuns = [...totals].sort((a, b) => b.runs - a.runs).slice(0, 10);
  const byWickets = [...totals].filter(t => t.legalBalls > 0).sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded).slice(0, 10);
  const byFielding = [...totals].filter(t => (t.catches + t.runouts) > 0).sort((a, b) => (b.catches + b.runouts) - (a.catches + a.runouts)).slice(0, 10);
  const byPoints = totals.slice(0, 10);
  // One table at a time, picked by sub-tabs (ui.statsTab) -- shared by every
  // screen that shows leaderboards.
  const tab = ["mvp", "bat", "bowl", "field"].includes(ui.statsTab) ? ui.statsTab : "mvp";
  const tables = {
    mvp: `
    <div class="leaderboard mvp">
      <h3>MVP points</h3>
      <table><thead><tr><th>Player</th><th>M</th><th>Runs</th><th>Wkt</th><th>Pts</th></tr></thead>
      <tbody>${byPoints.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${t.matches}</td><td>${t.runs}</td><td>${t.wickets}</td><td><b>${t.points}</b></td></tr>`).join("")}</tbody></table>
      <p class="hint">Fixed formula — batting, bowling, catches and run-outs. Not configurable.</p>
    </div>`,
    bat: `
    <div class="leaderboard">
      <h3>Most runs</h3>
      <table><thead><tr><th>Player</th><th>M</th><th>R</th><th>Avg</th></tr></thead>
      <tbody>${byRuns.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${t.matches}</td><td>${t.runs}</td><td>${t.innings ? (t.runs / t.innings).toFixed(1) : "0.0"}</td></tr>`).join("")}</tbody></table>
    </div>`,
    bowl: `
    <div class="leaderboard">
      <h3>Most wickets</h3>
      <table><thead><tr><th>Player</th><th>M</th><th>W</th><th>Econ</th></tr></thead>
      <tbody>${byWickets.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${t.matches}</td><td>${t.wickets}</td><td>${t.legalBalls ? (t.runsConceded / (t.legalBalls / 6)).toFixed(2) : "0.00"}</td></tr>`).join("")}</tbody></table>
    </div>`,
    field: `
    <div class="leaderboard">
      <h3>Most catches / run-outs</h3>
      <table><thead><tr><th>Player</th><th>Ct</th><th>RO</th></tr></thead>
      <tbody>${byFielding.map(t => `<tr><td>${escapeHtml(t.name)}</td><td>${t.catches}</td><td>${t.runouts}</td></tr>`).join("")}</tbody></table>
      ${byFielding.length ? "" : `<p class="hint">No catches or run-outs yet.</p>`}
    </div>`
  };
  return `
    ${tabsHtml("stats-tab", [["mvp", "MVP"], ["bat", "Batting"], ["bowl", "Bowling"], ["field", "Fielding"]], tab, "stats-tabs")}
    ${tables[tab]}
  `;
}

function renderStatsScreen(){
  const matches = Object.values(state.matchHistory).filter(m => !m.clubId); // guest matches only
  return `
    <div class="screen stats">
      ${renderBackBar("Home", "home")}
      <h1>📊 All-time stats</h1>
      ${matches.length ? renderLeaderboards(aggregatePlayerStats(matches)) : `<p class="hint">Play and finish a match to see stats here.</p>`}
      ${matches.length ? `<p class="hint">Read from archived matches only — ${matches.length} of them. Editing an old match does not recompute anything here.</p>` : ""}
    </div>
  `;
}
