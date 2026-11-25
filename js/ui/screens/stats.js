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
    { key: "best", label: "BB", title: "Best bowling", bar: false, value: t => t.best ? t.best.wickets * 1000 - t.best.runs : null,
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
/* The sorted column carries a thin bar under each figure, the leader's full
   width (a quantity sorted best-first only: not a ratio sorted low-first, not
   best bowling), so a re-sort shows at a glance how far apart they are. */
function leaderboardBars(rows, col){
  if (!col || col.key === "name" || col.bar === false || col.best === "asc") return null;
  const max = Math.max(0, ...rows.map(t => col.value(t) || 0));
  return max > 0 ? t => Math.max(0, Math.round((col.value(t) || 0) / max * 100)) : null;
}
function leaderboardTable(table, totals){
  const cols = LEADERBOARD_COLUMNS[table];
  const self = myPlayerSelf();
  const rows = totals.filter(LEADERBOARD_ROWS[table] || (() => true));
  if (!rows.length) return `<p class="hint">${table === "bowl" ? "Nobody has bowled yet." : "Nobody has batted yet."}</p>`;
  const sort = leaderboardSort(table);
  const ranked = sort.key !== "name";
  const bar = leaderboardBars(rows, cols.find(c => c.key === sort.key));
  const head = cols.map(c => {
    const on = c.key === sort.key;
    return `<th scope="col" class="${c.key === "name" ? "lb-name" : ""}" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" data-action="stats-sort" data-table="${table}" data-key="${c.key}" class="sort-btn${on ? " on" : ""}" title="${c.title}" aria-label="Sort by ${c.title.toLowerCase()}">${c.label}${on ? `<span class="sort-arrow" aria-hidden="true">${sort.dir === "asc" ? "▲" : "▼"}</span>` : ""}</button></th>`;
  }).join("");
  const body = sortLeaderboard(rows, table, sort).map((t, i) => `<tr>${cols.map(c => {
    // The name opens that player's figures over these matches (the player stats sheet).
    if (c.key === "name"){
      const me = isMyTotal(self, t);
      return `<td class="lb-name${me ? " lb-me" : ""}">${ranked ? `<span class="lb-rank${i < 3 ? ` medal m${i + 1}` : ""}">${i + 1}</span>` : ""}<button type="button" data-action="open-player-stats" data-key="${escapeHtml(t.key || "")}" data-name="${escapeHtml(t.name)}" class="name-btn lb-name-btn">${escapeHtml(t.name)}</button>${me ? `<span class="you-tag">You</span>` : ""}</td>`;
    }
    const v = c.text ? c.text(t) : c.value(t);
    const on = c.key === sort.key;
    return `<td class="${on ? "on" : ""}${on && bar ? " bar" : ""}"${on && bar ? ` style="--bar:${bar(t)}%"` : ""}>${c.strong ? `<b>${v}</b>` : v}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-scroll"><table class="lb-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* --- the period filter: all time, a year, a month ---
   ui.statsPeriod = { kind: "all"|"year"|"month", key, near }: key null (or
   one these matches don't have) is the newest period with matches; `near`
   (the period on screen when the kind changed) keeps Monthly in the year
   Yearly was showing, and the other way round. A match's date is its
   tournament's start (ENGINE, statsPeriodKey). Offered only when the matches
   span more than one month -- so never inside one tournament, whose matches
   all share its start. */
const STATS_PERIOD_KINDS = [["all", "All time"], ["year", "Yearly"], ["month", "Monthly"]];
function statsPeriodFor(matches){
  const starts = tournamentStartTimes(matches);
  const months = statsPeriods(matches, "month", starts);
  const want = ui.statsPeriod || {};
  const kind = months.length > 1 && (want.kind === "year" || want.kind === "month") ? want.kind : "all";
  const out = { kind, key: null, label: "", offered: months.length > 1, matches };
  if (kind === "all") return out;
  const list = kind === "month" ? months : statsPeriods(matches, "year", starts);
  let i = list.findIndex(p => p.key === want.key);
  if (i < 0 && want.near) i = list.findIndex(p => p.key.slice(0, 4) === String(want.near).slice(0, 4));
  if (i < 0) i = 0;
  const key = list[i].key;
  return Object.assign(out, { key, label: statsPeriodLabel(kind, key), older: list[i + 1] || null, newer: list[i - 1] || null,
    matches: matchesInPeriod(matches, kind, key, starts) });
}
// 1,284 · 12.9K
function statsCount(n){
  return n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : Number(n).toLocaleString("en-US");
}
/* The top of every leaderboard: the period picker (when offered) and the
   period's headline numbers (statsSummary). */
function statsOverviewHtml(period, totals){
  const sum = statsSummary(period.matches, totals);
  const tile = (n, label) => `<div class="kpi"><span class="kpi-n">${statsCount(n)}</span><span class="kpi-label">${label}</span></div>`;
  const arrow = (p, dir) => `<button type="button" class="period-arrow" data-action="stats-period" data-kind="${period.kind}" data-key="${p ? p.key : ""}" ${p ? "" : "disabled"} aria-label="${dir === "older" ? "Earlier" : "Later"} ${period.kind === "year" ? "year" : "month"}${p ? `: ${statsPeriodLabel(period.kind, p.key)}` : ""}">${dir === "older" ? "‹" : "›"}</button>`;
  return `
    <section class="stats-overview">
      ${period.offered ? `
        <div class="period-kinds" role="tablist" aria-label="Period">${STATS_PERIOD_KINDS.map(([k, label]) =>
          `<button type="button" role="tab" aria-selected="${k === period.kind}" data-action="stats-period" data-kind="${k}" data-near="${period.key || ""}" class="${k === period.kind ? "on" : ""}">${label}</button>`).join("")}</div>
        ${period.kind !== "all" ? `
          <div class="period-step">
            ${arrow(period.older, "older")}
            <div class="period-now" aria-live="polite"><b>${escapeHtml(period.label)}</b></div>
            ${arrow(period.newer, "newer")}
          </div>` : ""}` : ""}
      <div class="kpi-row" data-anim-key="kpi:${period.kind}:${period.key || ""}">
        ${tile(sum.matches, sum.matches === 1 ? "Match" : "Matches")}${tile(sum.runs, "Runs")}${tile(sum.wickets, "Wickets")}${tile(sum.sixes, "Sixes")}
      </div>
    </section>`;
}

/* --- the podium: a table's top three, by the column it's sorted by ---
   Always that column's best-first (flipping the table's order doesn't turn it
   into a bottom three), only players with something in it, equal figures
   sharing a place. #1 stands in the middle, bigger, with their profile photo
   when they have one (playerAvatarHtml). Tapping one opens their stats sheet. */
const PODIUM_LEAD = { mvp: "Most valuable", bat: "Top batters", bowl: "Top bowlers", field: "Top fielders" };
function podiumFor(table, totals){
  const cols = LEADERBOARD_COLUMNS[table], sort = leaderboardSort(table);
  const col = cols.find(c => c.key === (sort.key === "name" ? LEADERBOARD_ORDER[table][0] : sort.key));
  const dir = col.best || "desc";
  const rows = totals.filter(LEADERBOARD_ROWS[table] || (() => true));
  const top = sortLeaderboard(rows, table, { key: col.key, dir })
    .filter(t => { const v = col.value(t); return v != null && (dir === "asc" || v > 0); })
    .slice(0, 3);
  const better = (a, b) => dir === "asc" ? a < b : a > b;
  const places = top.map(t => 1 + top.filter(o => better(col.value(o), col.value(t))).length);
  return { col, top, places, byDefault: col.key === LEADERBOARD_ORDER[table][0] };
}
function podiumSub(table, t, key){
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  const fld = [t.catches ? `${t.catches} ct` : "", t.stumpings ? `${t.stumpings} st` : "", t.runouts ? `${t.runouts} ro` : ""].filter(Boolean).join(", ");
  const sr = t.balls ? (t.runs / t.balls * 100).toFixed(1) : null;
  const econ = t.legalBalls ? (t.runsConceded / (t.legalBalls / 6)).toFixed(2) : null;
  const facts = {
    mvp: [["runs", t.runs ? n(t.runs, "run", "runs") : ""], ["wickets", t.wickets ? n(t.wickets, "wkt", "wkts") : ""],
      ["dismissals", fld]],
    bat: [["runs", n(t.runs, "run", "runs")], ["strikeRate", sr ? `SR ${sr}` : ""],
      ["highScore", t.highScore ? `HS ${t.highScore.runs}${t.highScore.out ? "" : "*"}` : ""]],
    bowl: [["wickets", n(t.wickets, "wkt", "wkts")], ["economy", econ ? `Econ ${econ}` : ""], ["best", t.best ? `BB ${t.best.wickets}/${t.best.runs}` : ""]],
    field: [["catches", t.catches ? `${t.catches} ct` : ""], ["stumpings", t.stumpings ? `${t.stumpings} st` : ""], ["runouts", t.runouts ? `${t.runouts} ro` : ""], ["matches", n(t.matches, "match", "matches")]]
  }[table];
  // Each fact keeps its words together, so a narrow spot wraps only between facts.
  const parts = facts.filter(([k, text]) => k !== key && text).slice(0, 2).map(f => f[1].replace(/ /g, "\u00a0"));
  return parts.length ? parts.join(" · ") : n(t.matches, "match", "matches");
}
const PLACE_WORDS = ["", "first", "second", "third"];
const CROWN_SVG = `<svg class="podium-crown" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 L1 3 L7.5 8 L12 1 L16.5 8 L23 3 L22 14 Z"/></svg>`;
function podiumHtml(table, totals, period, leader){
  const p = podiumFor(table, totals);
  if (!p.top.length) return "";
  const self = myPlayerSelf();
  const title = table === "mvp" && p.byDefault
    ? (period.kind === "month" ? "Player of the month" : period.kind === "year" ? "Player of the year" : leader || PODIUM_LEAD.mvp)
    : PODIUM_LEAD[table];
  const spots = p.top.map((t, i) => {
    const place = p.places[i], me = isMyTotal(self, t);
    const v = p.col.text ? p.col.text(t) : pointsOrValue(p.col.value(t));
    return `<li class="podium-spot s${i + 1} m${Math.min(place, 3)}${me ? " me" : ""}">
      <button type="button" data-action="open-player-stats" data-key="${escapeHtml(t.key || "")}" data-name="${escapeHtml(t.name)}" class="podium-btn" aria-label="${escapeHtml(t.name)}, ${PLACE_WORDS[place]}: ${escapeHtml(String(v))} ${escapeHtml(p.col.title.toLowerCase())}">
        ${place === 1 ? CROWN_SVG : ""}
        ${playerAvatarHtml(t.key, t.name, "podium-avatar")}
        <span class="podium-name">${escapeHtml(t.name)}</span>
        ${me ? `<span class="you-tag">You</span>` : ""}
        <span class="podium-val">${escapeHtml(String(v))}<small>${escapeHtml(p.col.label)}</small></span>
        <span class="podium-sub">${escapeHtml(podiumSub(table, t, p.col.key))}</span>
      </button>
      <span class="podium-step" aria-hidden="true">${place}</span>
    </li>`;
  }).join("");
  return `
    <section class="podium-card" aria-label="${escapeHtml(title)}" data-anim-key="${escapeHtml(["podium", table, period.key || "", p.col.key, ...p.top.map(t => t.key)].join("|"))}">
      <div class="podium-head"><span class="podium-title">${escapeHtml(title)}</span><span class="podium-by">${escapeHtml(p.col.title)}</span></div>
      <ol class="podium n${p.top.length}">${spots}</ol>
    </section>`;
}
function pointsOrValue(v){ return typeof v === "number" && !Number.isInteger(v) ? pointsNum(v) : v; }

/* A player's round badge: their profile photo (club / Premier players with one,
   wantPlayerPhotos) or their initials. `key`: the leaderboard line's key. */
function playerInitials(name){
  const words = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}
function playerAvatarHtml(key, name, cls){
  const photo = playerPhotoFor(key);
  return photo
    ? `<img class="player-avatar ${cls || ""}" src="${photo}" alt="">`
    : `<span class="player-avatar initials ${cls || ""}" aria-hidden="true">${escapeHtml(playerInitials(name))}</span>`;
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
    const bat = !/^(Wd|Nb|B|Lb)/.test(e.display);
    const cls = e.isWicket ? " wicket" : e.runs === 4 && bat ? " four" : e.runs === 6 && bat ? " six" : /^(Wd|Nb)/.test(e.display) ? " extra" : "";
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
  const groups = computeRecords(matches, statsOpts())
    .map(g => Object.assign({}, g, { records: g.records.filter(r => r.entries.length) }))
    .filter(g => g.records.length);
  if (!groups.length) return `<p class="hint">No records yet.</p>`;
  return `<div class="records">
    ${groups.map(g => {
      const tiles = RECORD_TILE_GROUPS.includes(g.key);
      return `<section class="records-group">
        <h3 class="section-label">${g.title}</h3>
        <div class="${tiles ? "records-tiles" : "records-cards"}">${g.records.map(tiles ? recordTileHtml : recordCardHtml).join("")}</div>
      </section>`;
    }).join("")}
    
  </div>`;
}

/* `opts.points`: the points preset `totals` were counted with -- null
   (Premier) leaves the MVP table out; `opts.where` says where it's changed.
   `opts.matches` (the matches `totals` came from) adds the Records tab, and
   lets a name be tapped for that player's figures over them; `opts.title`
   names those matches on that sheet ("Summer Cup", "KICC"). The signed-in
   player's own rows are tagged You; their full figures have a place of their
   own (a tournament's My stats tab, renderMyStatsTab). `opts.leader` names
   the MVP podium when it isn't a month's or a year's ("Tournament MVP").
   With `opts.matches` spanning more than one month, a period picker narrows
   everything below it -- podium, table, records and the player sheet -- to
   one year or month (statsPeriodFor); `totals` is then counted again. */
function renderLeaderboards(totals, opts){
  const o = opts || {};
  const points = o.points || null;
  const period = o.matches ? statsPeriodFor(o.matches) : null;
  if (period && period.kind !== "all") totals = aggregatePlayerStats(period.matches, points, statsOpts());
  const matches = period ? period.matches : null;
  statsScope = { matches: matches || [], points, title: [o.title, period && period.label].filter(Boolean).join(" · ") || "All time" };
  const tabs = [...(points ? [["mvp", "MVP"]] : []), ["bat", "Batting"], ["bowl", "Bowling"], ["field", "Fielding"], ...(matches ? [["records", "Records"]] : [])];
  const tab = tabs.some(([k]) => k === ui.statsTab) ? ui.statsTab : tabs[0][0];
  // Every table's top three in one request, so switching tabs finds their photos there.
  wantPlayerPhotos(tabs.filter(([k]) => LEADERBOARD_COLUMNS[k]).flatMap(([k]) => podiumFor(k, totals).top.map(t => t.key)));
  const top = `${period ? statsOverviewHtml(period, totals) : ""}${tabsHtml("stats-tab", tabs, tab, "stats-tabs")}`;
  if (tab === "records") return `${top}${renderRecords(matches)}`;
  const listed = totals.filter(LEADERBOARD_ROWS[tab] || (() => true)).length;
  return `
    ${top}
    ${podiumHtml(tab, totals, period || { kind: "all" }, o.leader)}
    <div class="leaderboard${tab === "mvp" ? " mvp" : ""}">
      <div class="lb-head"><h3>${LEADERBOARD_TITLES[tab]}</h3>${listed ? `<span class="lb-count">${listed} player${listed === 1 ? "" : "s"}</span>` : ""}</div>
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
      <h1>📊 Stats</h1>
      ${matches.length ? renderLeaderboards(aggregatePlayerStats(matches, points, statsOpts()), { points, where: "Presets → MVP points", matches }) : `<p class="hint">Play and finish a match to see stats here.</p>`}
    </div>
  `;
}

/* --- one player's figures over the matches a screen shows ---
   Tap a name in any leaderboard (a tournament's Stats, a club's, Premier's,
   the guest's) and this sheet shows that player over the same matches:
   batting / bowling / fielding (careerStatsHtml, the profile's tiles), where
   they rank for MVP points, runs and wickets (playerRanks, ENGINE), and every
   match they played, each opening its scorecard. ui.playerStats = { view,
   name, names, self, matches, points, title } -- a snapshot taken when it's
   opened, belonging to the view it was opened on (like ui.matchDetail, which
   can open on top of it). For the signed-in player's own claimed profile
   (myPlayerSelf) every name it has played under counts, and the sheet links
   to the full profile. A tournament shows the same for that player in a tab
   of its own, My stats (renderMyStatsTab). */
let statsScope = null;   // { matches, points, title } of the leaderboards on screen

/* The signed-in viewer's claimed profile: { id, name, names } (names = the
   name plus any merged into it, the spellings matches may hold), or null.
   ui.identity once loaded; until then (and offline) the copy kept in the
   read cache by fetchMyPlayerIdentity. */
function myPlayerSelf(){
  if (!session || !supabaseClient) return null;
  const cache = cacheFor();
  const me = ui.identity ? ui.identity.myPlayer : cache && cache.myPlayer;
  if (!me || !me.id || !me.name) return null;
  return { id: me.id, name: me.name, names: [me.name, ...(me.aliases || [])] };
}
function isMyName(self, name){
  const key = (name || "").trim().toLowerCase();
  return !!self && !!key && self.names.some(n => n.toLowerCase() === key);
}
/* A leaderboard total that's the signed-in player: their id, or -- a line
   counted by name (matches from before ids) -- one of their names. */
function isMyTotal(self, t){
  if (!self || !t) return false;
  if (t.key && !isNameKey(t.key)) return t.key === self.id;
  return (t.names && t.names.length ? t.names : [t.name]).some(n => isMyName(self, n));
}
// Who a player's sheet / My stats is about (statsWho): the signed-in player, or one leaderboard line.
function playerStatsWho(ps){
  if (ps.self) return statsWho(ps.self.id, ps.self.names);
  return statsWho(ps.key && !isNameKey(ps.key) ? ps.key : null, ps.names);
}

/* `key`: the leaderboard line's (a player id, or "name:…" for a name counted
   before ids); its name and every name it was counted under come from the
   totals over the same matches. */
function openPlayerStats(key, scope, name){
  const sc = scope || statsScope;
  if (!sc || (!key && !name)) return;
  const t = aggregatePlayerStats(sc.matches, sc.points, statsOpts()).find(x => key ? x.key === key : x.name === name);
  const self = myPlayerSelf();
  const mine = t ? isMyTotal(self, t) : isMyName(self, name);
  ui.playerStats = { view: state.view, key: t ? t.key : null, name: mine ? self.name : t ? t.name : name,
    names: mine ? self.names : t ? t.names : [name], self: mine ? self : null,
    matches: sc.matches, points: sc.points, title: sc.title };
  render();
}
function closePlayerStats(){
  ui.playerStats = null;
  render();
}

/* Where a player stands: "MVP #2 of 14", "Runs #1 of 12", "Wickets #5 of 9". */
function playerRankPills(ranks, withPoints){
  const pill = (r, label) => r ? `<span class="tag-pill">${label} #${r.place} of ${r.of}</span>` : "";
  return (withPoints ? pill(ranks.points, "MVP") : "") + pill(ranks.runs, "Runs") + pill(ranks.wickets, "Wickets");
}

/* Has the signed-in player (their claimed profile, any name merged into it)
   played in these matches? Then a tournament gets its My stats tab. */
function myStatsIn(matches){
  const self = myPlayerSelf();
  return !!(self && matches && matches.length && playerMatchLines(statsWho(self.id, self.names), matches).length);
}

/* One player's figures over a set of matches: { name, names, self, matches,
   points, title } (ui.playerStats, or the signed-in player's for My stats).
   Who they played for, any merged names counted, the profile's tiles with
   where they rank, and match by match. */
function playerStatsBodyHtml(ps){
  const who = playerStatsWho(ps);
  const career = playerCareer(who, ps.matches, ps.points);
  const lines = playerMatchLines(who, ps.matches);
  const totals = aggregatePlayerStats(ps.matches, ps.points, statsOpts());
  const self = ps.self;
  const ranks = playerRanks(t => self ? isMyTotal(self, t) : t.key === ps.key, totals);
  // Who they played for, when it's one side or two (a club's many practice-day sides would only be noise).
  const sides = [...new Set(lines.filter(l => l.team).map(l => teamName(l.match, l.team)))];
  const where = [ps.title, sides.length && sides.length <= 2 ? `for ${sides.join(" and ")}` : ""].filter(Boolean).join(" · ");
  // Every other name they're counted under here (a former name, a merged profile's).
  const shown = (ps.name || "").trim().toLowerCase();
  const also = [...new Set(lines.flatMap(l => l.labels || []))].filter(n => n.trim().toLowerCase() !== shown);
  return `
    ${where ? `<p class="muted player-stats-where">${escapeHtml(where)}</p>` : ""}
    ${also.length ? `<p class="hint">Also counted: played as ${also.map(escapeHtml).join(", ")}.</p>` : ""}
    ${career ? careerStatsHtml(career, !!ps.points, playerRankPills(ranks, !!ps.points)) : `<p class="hint">No figures for this player here yet.</p>`}
    ${career ? playerMonthsHtml(who, ps) : ""}
    ${lines.length ? `<h3 class="section-label">Match by match</h3><div class="fixtures">${lines.map(l => playerMatchRowHtml(l, matchDateText(l.match))).join("")}</div>` : ""}`;
}
/* Month by month, when these matches span more than one: a bar per month
   (MVP points, or runs where nothing counts points -- Premier), the best month
   in full colour, with matches / runs / wickets under it. Newest first, like
   Match by match; months they didn't play in are left out. */
function playerMonthsHtml(who, ps){
  const starts = tournamentStartTimes(ps.matches);
  if (statsPeriods(ps.matches, "month", starts).length < 2) return "";
  const rows = playerByPeriod(who, ps.matches, "month", ps.points, starts);
  if (!rows.length) return "";
  const pts = !!ps.points;
  const value = c => pts ? c.points : c.runs;
  const max = Math.max(0, ...rows.map(r => value(r.career)));
  const best = rows.reduce((b, r) => value(r.career) > value(b.career) ? r : b, rows[0]);
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return `
    <h3 class="section-label">Month by month <span class="section-sub">${pts ? "MVP points" : "Runs"}</span></h3>
    <ol class="month-bars">${rows.map(r => {
      const c = r.career, v = value(c);
      const w = max > 0 ? Math.max(0, Math.round(v / max * 100)) : 0;
      const facts = [n(c.matches, "match", "matches"), pts ? n(c.runs, "run", "runs") : "", n(c.wickets, "wkt", "wkts")].filter(Boolean).join(" · ");
      return `<li class="month-bar${r === best && max > 0 ? " best" : ""}">
        <span class="month-name">${escapeHtml(statsPeriodLabel("month", r.key, true))}</span>
        <span class="month-track" aria-hidden="true"><span class="month-fill" style="width:${w}%"></span></span>
        <span class="month-val">${pts ? pointsNum(v) : v}</span>
        <span class="month-facts">${escapeHtml(facts)}</span>
      </li>`;
    }).join("")}</ol>`;
}
// The photo / initials badge at the top of a player's sheet or My stats.
function playerStatsAvatarHtml(ps){
  const key = ps.self ? ps.self.id : ps.key;
  wantPlayerPhotos([key]);
  return playerAvatarHtml(key, ps.name, "sheet-avatar");
}
function myProfileButtonHtml(title, cls){
  return `<button type="button" data-action="open-my-profile-from-stats" data-title="${escapeHtml(title || "")}" class="ghost${cls ? " " + cls : ""}">My profile</button>`;
}

/* A tournament's My stats tab (club page and shared link): the signed-in
   player's own figures in it -- the same as their sheet, on a tab of its own
   so the tournament's other tabs stay about everyone. */
function renderMyStatsTab(matches, points, title){
  const self = myPlayerSelf();
  if (!self) return "";
  statsScope = { matches, points, title: title || "" };
  return `
    <div class="my-stats-tab">
      <div class="player-stats-head">${playerStatsAvatarHtml({ self, name: self.name })}<h2 class="my-stats-head">${escapeHtml(self.name)} <span class="you-tag">You</span></h2></div>
      ${playerStatsBodyHtml({ name: self.name, names: self.names, self, matches, points, title })}
      ${myProfileButtonHtml(title, "my-stats-profile")}
    </div>`;
}

function renderPlayerStatsModal(){
  const ps = ui.playerStats;
  return `
    <div class="modal-backdrop">
      <div class="modal player-stats-modal" data-keep-scroll="player-stats" role="dialog" aria-modal="true" aria-label="${escapeHtml(ps.name)}: stats">
        <div class="wicket-modal-head">
          <div class="player-stats-head">${playerStatsAvatarHtml(ps)}<h2>${escapeHtml(ps.name)}${ps.self ? ` <span class="you-tag">You</span>` : ""}</h2></div>
          <button type="button" data-action="close-player-stats" class="sheet-close" aria-label="Close">✕</button>
        </div>
        ${playerStatsBodyHtml(ps)}
        <div class="sheet-actions">
          ${ps.self ? myProfileButtonHtml(ps.title) : ""}
          <button type="button" data-action="close-player-stats" class="ghost">Close</button>
        </div>
      </div>
    </div>`;
}
