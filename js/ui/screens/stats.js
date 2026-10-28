/* Cricket.lk — screens: stats leaderboards.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- stats (all-time leaderboards, shared with the tournament stats tab) ---
   One table at a time behind sub-tabs (ui.statsTab). Every player is listed
   (Batting: everyone who batted, Bowling: everyone who bowled), and tapping a
   column head sorts by it (ui.statsSort, per table: the first tap sorts
   best-first, the next flips it; blanks always go last). Wide tables scroll
   sideways inside their card, with the player column pinned. */
const lbDec = (n, d) => n == null ? "—" : n.toFixed(d);
const lbRatio = (a, b) => b > 0 ? a / b : null;
const LB_PLAYER = { key: "name", label: "Player", title: "Player", value: t => t.name.toLowerCase(), best: "asc" };
const LB_MATCHES = { key: "matches", label: "M", title: "Matches", value: t => t.matches };
const LEADERBOARD_COLUMNS = {
  // The table's key number comes straight after the player, so a phone shows it without swiping.
  mvp: [LB_PLAYER,
    { key: "points", label: "Pts", title: "MVP points", value: t => t.points, text: t => pointsNum(t.points), strong: true },
    LB_MATCHES,
    { key: "runs", label: "Runs", title: "Runs", value: t => t.runs },
    { key: "wickets", label: "Wkt", title: "Wickets", value: t => t.wickets },
    { key: "dismissals", label: "Fld", title: "Catches, stumpings and run-outs", value: t => fieldDismissals(t) }],
  bat: [LB_PLAYER,
    { key: "runs", label: "R", title: "Runs", value: t => t.runs, strong: true },
    LB_MATCHES,
    { key: "innings", label: "Inn", title: "Innings", value: t => t.innings },
    { key: "notOuts", label: "NO", title: "Not outs", value: t => t.notOuts },
    { key: "balls", label: "B", title: "Balls faced", value: t => t.balls },
    { key: "highScore", label: "HS", title: "Highest score", value: t => t.highScore ? t.highScore.runs + (t.highScore.out ? 0 : 0.5) : null,
      text: t => t.highScore ? `${t.highScore.runs}${t.highScore.out ? "" : "*"}` : "—" },
    { key: "average", label: "Avg", title: "Batting average", value: t => lbRatio(t.runs, t.innings - t.notOuts), text: t => lbDec(lbRatio(t.runs, t.innings - t.notOuts), 1) },
    { key: "strikeRate", label: "SR", title: "Strike rate", value: t => t.balls ? t.runs / t.balls * 100 : null, text: t => lbDec(t.balls ? t.runs / t.balls * 100 : null, 1) },
    { key: "fours", label: "4s", title: "Fours", value: t => t.fours },
    { key: "sixes", label: "6s", title: "Sixes", value: t => t.sixes },
    { key: "fifties", label: "50s", title: "Fifties", value: t => t.fifties },
    { key: "hundreds", label: "100s", title: "Hundreds", value: t => t.hundreds },
    { key: "ducks", label: "0s", title: "Ducks", value: t => t.ducks }],
  bowl: [LB_PLAYER,
    { key: "wickets", label: "W", title: "Wickets", value: t => t.wickets, strong: true },
    LB_MATCHES,
    { key: "bowlInnings", label: "Inn", title: "Innings bowled in", value: t => t.bowlInnings },
    { key: "overs", label: "O", title: "Overs", value: t => t.legalBalls, text: t => oversDisplay(t.legalBalls, 6) },
    { key: "maidens", label: "Md", title: "Maidens", value: t => t.maidens },
    { key: "dots", label: "Dots", title: "Dot balls", value: t => t.dots },
    { key: "runsConceded", label: "R", title: "Runs conceded", value: t => t.runsConceded, best: "asc" },
    { key: "best", label: "BB", title: "Best bowling", value: t => t.best ? t.best.wickets * 1000 - t.best.runs : null,
      text: t => t.best ? `${t.best.wickets}/${t.best.runs}` : "—" },
    { key: "bowlAverage", label: "Avg", title: "Bowling average", value: t => lbRatio(t.runsConceded, t.wickets), text: t => lbDec(lbRatio(t.runsConceded, t.wickets), 1), best: "asc" },
    { key: "economy", label: "Econ", title: "Economy (runs per 6 balls)", value: t => lbRatio(t.runsConceded, t.legalBalls / 6), text: t => lbDec(lbRatio(t.runsConceded, t.legalBalls / 6), 2), best: "asc" },
    { key: "bowlStrikeRate", label: "SR", title: "Balls per wicket", value: t => lbRatio(t.legalBalls, t.wickets), text: t => lbDec(lbRatio(t.legalBalls, t.wickets), 1), best: "asc" }],
  field: [LB_PLAYER,
    { key: "dismissals", label: "Total", title: "Dismissals", value: t => fieldDismissals(t), strong: true },
    LB_MATCHES,
    { key: "catches", label: "Ct", title: "Catches", value: t => t.catches },
    { key: "stumpings", label: "St", title: "Stumpings", value: t => t.stumpings || 0 },
    { key: "runouts", label: "RO", title: "Run-outs", value: t => t.runouts }]
};
// Default sort and the tie-breaks after it (then the name).
const LEADERBOARD_ORDER = { mvp: ["points", "runs", "wickets"], bat: ["runs", "average"], bowl: ["wickets", "economy"], field: ["dismissals", "catches"] };
const LEADERBOARD_ROWS = { bat: t => t.innings > 0, bowl: t => t.bowlInnings > 0 };
const LEADERBOARD_TITLES = { mvp: "MVP points", bat: "Batting", bowl: "Bowling", field: "Fielding" };

function leaderboardSort(table){
  const cols = LEADERBOARD_COLUMNS[table], saved = ui.statsSort[table];
  if (saved && cols.some(c => c.key === saved.key)) return saved;
  const key = LEADERBOARD_ORDER[table][0];
  return { key, dir: cols.find(c => c.key === key).best || "desc" };
}
function sortLeaderboard(rows, table, sort){
  const cols = LEADERBOARD_COLUMNS[table];
  const col = k => cols.find(c => c.key === k);
  const chain = [[col(sort.key), sort.dir], ...LEADERBOARD_ORDER[table].map(k => [col(k), col(k).best || "desc"]), [LB_PLAYER, "asc"]];
  const cmp = (c, dir, a, b) => {
    const x = c.value(a), y = c.value(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    const d = typeof x === "string" ? x.localeCompare(y) : x - y;
    return dir === "asc" ? d : -d;
  };
  return [...rows].sort((a, b) => { for (const [c, dir] of chain){ const r = cmp(c, dir, a, b); if (r) return r; } return 0; });
}
function leaderboardTable(table, totals){
  const cols = LEADERBOARD_COLUMNS[table];
  const rows = totals.filter(LEADERBOARD_ROWS[table] || (() => true));
  if (!rows.length) return `<p class="hint">${table === "bowl" ? "Nobody has bowled yet." : "Nobody has batted yet."}</p>`;
  const sort = leaderboardSort(table);
  const ranked = sort.key !== "name";
  const head = cols.map(c => {
    const on = c.key === sort.key;
    return `<th scope="col" class="${c.key === "name" ? "lb-name" : ""}" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" data-action="stats-sort" data-table="${table}" data-key="${c.key}" class="sort-btn${on ? " on" : ""}" title="${c.title}" aria-label="Sort by ${c.title.toLowerCase()}">${c.label}${on ? `<span class="sort-arrow" aria-hidden="true">${sort.dir === "asc" ? "▲" : "▼"}</span>` : ""}</button></th>`;
  }).join("");
  const body = sortLeaderboard(rows, table, sort).map((t, i) => `<tr>${cols.map(c => {
    if (c.key === "name") return `<td class="lb-name">${ranked ? `<span class="lb-rank">${i + 1}</span>` : ""}${escapeHtml(t.name)}</td>`;
    const v = c.text ? c.text(t) : c.value(t);
    return `<td class="${c.key === sort.key ? "on" : ""}">${c.strong ? `<b>${v}</b>` : v}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-scroll"><table class="lb-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="hint">${rows.length} player${rows.length === 1 ? "" : "s"} · tap a column to sort${cols.length > 6 ? " · swipe the table for more" : ""}</p>`;
}

/* --- records (computeRecords) ---
   Career tallies (Batting/Bowling/Fielding) are two-up tiles: the leader's
   number large, the next places a line each. Single-match records (one
   innings, one over, team totals) are full-width rows that open that
   match's scorecard; an over shows its balls. A record nobody has yet is
   left out. */
const RECORDS_SHOWN = 3;
const RECORD_TILE_GROUPS = ["bat", "bowl", "field"];
function recordValue(e){ return escapeHtml(e.text != null ? e.text : String(e.value)); }
function recordMoreHtml(r){
  const more = r.entries.length - RECORDS_SHOWN;
  return more > 0 ? `<p class="record-more">+${more} more level</p>` : "";
}
function recordTileHtml(r){
  const [lead, ...rest] = r.entries.slice(0, RECORDS_SHOWN);
  return `<div class="record-tile">
    <div class="record-label">${r.label}</div>
    <div class="record-lead">
      <span class="record-val">${recordValue(lead)}</span>
      <span class="record-name">${escapeHtml(lead.name)}</span>
      <span class="record-detail">${escapeHtml(lead.detail)}</span>
    </div>
    ${rest.length ? `<ol class="record-rest">${rest.map(e => `<li><span class="record-place">${e.place}</span><span class="record-name">${escapeHtml(e.name)}</span><span class="record-val">${recordValue(e)}</span></li>`).join("")}</ol>` : ""}
    ${recordMoreHtml(r)}
  </div>`;
}
function recordBallsHtml(balls){
  return `<span class="record-balls">${balls.map(e => {
    const cls = e.isWicket ? " wicket" : e.runs === 4 ? " four" : e.runs === 6 ? " six" : /^(Wd|Nb)/.test(e.display) ? " extra" : "";
    return `<span class="chip${cls}">${escapeHtml(e.display)}</span>`;
  }).join("")}</span>`;
}
function recordRowHtml(e){
  const lead = e.place === 1;
  const inner = `<span class="record-place">${e.place}</span>
    <span class="record-who"><span class="record-name">${escapeHtml(e.name)}</span><span class="record-detail">${escapeHtml(e.detail)}</span>${lead && e.balls ? recordBallsHtml(e.balls) : ""}</span>
    <span class="record-val">${recordValue(e)}</span>`;
  return e.matchId
    ? `<li><button type="button" data-action="open-match-detail" data-id="${escapeHtml(e.matchId)}" class="record-row record-open${lead ? " lead" : ""}">${inner}<span class="chevron" aria-hidden="true">›</span></button></li>`
    : `<li class="record-row${lead ? " lead" : ""}">${inner}</li>`;
}
function recordCardHtml(r){
  return `<div class="record-card">
    <div class="record-label">${r.label}</div>
    <ol class="record-rows">${r.entries.slice(0, RECORDS_SHOWN).map(recordRowHtml).join("")}</ol>
    ${recordMoreHtml(r)}
  </div>`;
}
function renderRecords(matches){
  const groups = computeRecords(matches)
    .map(g => Object.assign({}, g, { records: g.records.filter(r => r.entries.length) }))
    .filter(g => g.records.length);
  if (!groups.length) return `<p class="hint">No records yet — they appear once a finished match has some runs on the board.</p>`;
  return `<div class="records">
    ${groups.map(g => {
      const tiles = RECORD_TILE_GROUPS.includes(g.key);
      return `<section class="records-group">
        <h3 class="section-label">${g.title}</h3>
        <div class="${tiles ? "records-tiles" : "records-cards"}">${g.records.map(tiles ? recordTileHtml : recordCardHtml).join("")}</div>
      </section>`;
    }).join("")}
    <p class="hint">Top ${RECORDS_SHOWN} of each, from ${matches.length} match${matches.length === 1 ? "" : "es"}. Wides and no-balls count deliveries. Tap a match record to open its scorecard.</p>
  </div>`;
}

/* `opts.points`: the points preset `totals` were counted with -- null
   (Premier) leaves the MVP table out; `opts.where` says where it's changed.
   `opts.matches` (the matches `totals` came from) adds the Records tab. */
function renderLeaderboards(totals, opts){
  const o = opts || {};
  const points = o.points || null;
  const tabs = [...(points ? [["mvp", "MVP"]] : []), ["bat", "Batting"], ["bowl", "Bowling"], ["field", "Fielding"], ...(o.matches ? [["records", "Records"]] : [])];
  const tab = tabs.some(([k]) => k === ui.statsTab) ? ui.statsTab : tabs[0][0];
  if (tab === "records") return `${tabsHtml("stats-tab", tabs, tab, "stats-tabs")}${renderRecords(o.matches)}`;
  return `
    ${tabsHtml("stats-tab", tabs, tab, "stats-tabs")}
    <div class="leaderboard${tab === "mvp" ? " mvp" : ""}">
      <h3>${LEADERBOARD_TITLES[tab]}</h3>
      ${tab === "mvp" ? `
        <p class="hint points-using">Counted with the <b>${escapeHtml(points.name)}</b> points ${presetInfoButtonHtml("points", points.id, "leaderboard-points", points.name)}${o.where ? ` · change them in ${escapeHtml(o.where)}` : ""}</p>
        ${presetInfoPanelHtml("leaderboard-points")}` : ""}
      ${leaderboardTable(tab, totals)}
    </div>
  `;
}

function renderStatsScreen(){
  const matches = Object.values(state.matchHistory).filter(m => !m.clubId); // guest matches only
  const points = guestPointsPreset();
  return `
    <div class="screen stats">
      ${renderBackBar("Home", "home")}
      <h1>📊 All-time stats</h1>
      ${matches.length ? renderLeaderboards(aggregatePlayerStats(matches, points), { points, where: "Presets → MVP points", matches }) : `<p class="hint">Play and finish a match to see stats here.</p>`}
      ${matches.length ? `<p class="hint">Read from archived matches only — ${matches.length} of them.</p>` : ""}
    </div>
  `;
}
