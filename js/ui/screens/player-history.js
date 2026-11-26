/* Cricket.lk — screens: a player's history (form, badges, ratings, milestones, over time, match-ups),
   comparing two players, a year in review, and the live match's records and milestones.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */

/* --- the matches a match is counted with ---
   A club match: that club's matches (this phone's archive and the cloud's,
   clubMatchesFor); a guest match: this phone's guest matches -- the same
   sets the club's and the guest Stats screens show, so "a record" on the
   live board is one there. The match itself (in progress, or archived and
   being looked at) is never in it. */
function historyScopeFor(match){
  if (!match) return [];
  const own = new Set([match.archivedId, match.reopenedFrom, match.id].filter(Boolean));
  const all = match.clubId ? clubMatchesFor(match.clubId) : Object.values(state.matchHistory).filter(m => m && !m.clubId);
  return all.filter(m => m && !own.has(m.id) && !m.superOverOf);
}
/* For the match being scored: each player's career before it ({ key: total })
   and the records it could break (liveRecordMarks), worked out once per match
   and set of earlier matches. null for a "no names" match or a super over. */
let liveHistoryCache = null;
function liveHistory(match){
  if (!match || match.anonymous || match.superOverOf) return null;
  const scope = historyScopeFor(match);
  const sig = `${match.clubId || "guest"}|${scope.length}|${scope.reduce((t, m) => Math.max(t, m.completedAt || 0), 0)}|${Object.keys(state.players || {}).length}|${ui.club && ui.club.roster ? ui.club.roster.length : 0}`;
  if (liveHistoryCache && liveHistoryCache.sig === sig) return liveHistoryCache;
  const opts = statsOpts();
  const keyOf = linkedKeyOf(countedMatches(scope.concat([match])), opts.keyOf);
  const careers = {};
  aggregatePlayerStats(scope, null, { keyOf, nameOf: opts.nameOf, link: false }).forEach(t => { careers[t.key] = t; });
  liveHistoryCache = { sig, keyOf, careers, marks: liveRecordMarks(scope) };
  return liveHistoryCache;
}
/* A pick sheet row's note when the player is close to a career milestone:
   "8 to 500 runs" (within a tenth of it, at most 25 runs), "1 to 50 wickets"
   (within 2). Nothing otherwise, so the rows look as they always did. */
function pickMilestoneNote(name, action){
  const m = state.match;
  if (!m || (action !== "pick-batter" && action !== "pick-bowler") || isUnnamedPlayer(name)) return "";
  const h = liveHistory(m);
  const c = h && h.careers[h.keyOf(m, name)];
  if (!c) return "";
  if (action === "pick-batter"){
    const next = nextMilestone(c.runs, RUN_MILESTONES), left = next ? next - c.runs : 0;
    return next && left <= Math.min(25, next * 0.1) ? `${left} to ${next.toLocaleString("en-US")} runs` : "";
  }
  const inn = currentInnings(m), now = inn && inn.bowling.stats[name] ? inn.bowling.stats[name].wickets : 0;
  const next = nextMilestone(c.wickets + now, WICKET_MILESTONES), left = next ? next - c.wickets - now : 0;
  return next && left <= 2 ? `${left} to ${next} wickets` : "";
}

/* --- records set in a finished match (Result) ---
   newRecordsIn over the matches it counts with: a card listing each record
   it now holds (or a career record it took the lead in). Nothing for a match
   being edited from history, a super over, or when nothing changed. */
function renderRecordsSetCard(match){
  if (!match || match.superOverOf || match.editingFromHistory || !match.archivedId) return "";
  const archived = state.matchHistory[match.archivedId];
  if (!archived) return "";
  const scope = historyScopeFor(match);
  const list = statsMemo("records-set", scope.concat([archived]), archived.id, () => newRecordsIn(archived, scope, statsOpts()));
  if (!list.length) return "";
  const where = match.clubId ? (((ui.myClubs || []).find(c => c.id === match.clubId) || {}).name || "the club") : "your matches";
  return `
    <div class="records-set-card">
      <div class="records-set-head"><span class="section-label">★ ${list.length === 1 ? "A record" : `${list.length} records`} set</span><span class="muted">in ${escapeHtml(where)}</span></div>
      <ol class="records-set">${list.slice(0, 8).map(x => `
        <li><span class="rs-label">${escapeHtml(x.label)}${x.career ? " · now leads" : ""}</span>
          <span class="rs-who">${escapeHtml(x.entry.name)}</span><span class="rs-val n">${recordValue(x.entry)}</span></li>`).join("")}</ol>
    </div>`;
}

/* --- a player's history ---
   Shared by the player stats sheet (over the leaderboard's matches, with
   the career-long parts over every match of that club / tournament / phone,
   not just the period on screen) and a profile's Career tab. */
const MILESTONE_ICONS = { debut: "🧢", fifty: "⭐", hundred: "💯", runs: "🏏", wickets: "🎯", haul: "🔥", hatTrick: "🎩", pom: "🏆", matches: "📅" };
const MILESTONES_SHOWN = 5, MATCHUPS_SHOWN = 5;
function playerFormHtml(form){
  if (!form.bat.length && !form.bowl.length) return "";
  const chip = (text, cls, title) => `<span class="form-chip${cls ? " " + cls : ""}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
  const bat = form.bat.map(x => chip(`${x.runs}${x.out ? "" : "*"}`, x.runs >= 50 ? "big" : x.out && x.runs === 0 ? "duck" : "", `${x.runs}${x.out ? "" : " not out"} off ${plural(x.balls, "ball")}`)).join("");
  const bowl = form.bowl.map(x => chip(`${x.wickets}/${x.runs}`, x.wickets >= 3 ? "big" : "", `${plural(x.wickets, "wicket")} for ${x.runs}`)).join("");
  return `
    <div class="player-form" aria-label="Form, last 5, newest first">
      <span class="form-title">Form <small>newest first</small></span>
      ${bat ? `<div class="form-row"><span class="form-label">Bat</span><span class="form-chips">${bat}</span></div>` : ""}
      ${bowl ? `<div class="form-row"><span class="form-label">Bowl</span><span class="form-chips">${bowl}</span></div>` : ""}
    </div>`;
}
function playerBadgesHtml(badges){
  return badges.length ? `<div class="badge-row">${badges.map(b => `<span class="player-badge" title="${escapeHtml(b.title)}"><span aria-hidden="true">${b.icon}</span>${escapeHtml(b.label)}</span>`).join("")}</div>` : "";
}
// "Bat rating 612 · #3": the leaderboard's ratings (playerRatings) over these matches.
function playerRatingPills(key, matches){
  if (!key || !matches || !matches.length) return "";
  const ratings = statsMemo("ratings", matches, "", () => playerRatings(matches, statsOpts()));
  const mine = ratings[key];
  if (!mine) return "";
  const place = kind => 1 + Object.keys(ratings).filter(k => k !== key && ratings[k][kind] != null && ratings[k][kind] > mine[kind]).length;
  const pill = (kind, label) => mine[kind] != null ? `<span class="tag-pill" title="${label} rating: 500 is an average player here, recent innings count most">${label} rating ${mine[kind]} · #${place(kind)}</span>` : "";
  return pill("bat", "Bat") + pill("bowl", "Bowl");
}
function milestonesHtml(list, all){
  if (!list.length) return "";
  const shown = all ? list : list.slice(0, MILESTONES_SHOWN);
  return `
    <h3 class="section-label">Milestones <span class="section-sub">newest first</span></h3>
    <ol class="milestones">${shown.map(x => {
      const inner = `<span class="ms-icon" aria-hidden="true">${MILESTONE_ICONS[x.kind] || "•"}</span>
        <span class="ms-text"><b>${escapeHtml(x.text)}</b><span class="muted">${escapeHtml([x.detail, x.at ? matchDateText({ completedAt: x.at }) : ""].filter(Boolean).join(" · "))}</span></span>`;
      return x.matchId ? `<li><button type="button" data-action="open-match-detail" data-id="${escapeHtml(x.matchId)}" class="ms-row">${inner}<span class="chevron" aria-hidden="true">›</span></button></li>` : `<li class="ms-row">${inner}</li>`;
    }).join("")}</ol>
    ${shown.length < list.length ? `<button type="button" data-action="history-more" data-what="milestones" class="link-btn">Show all ${list.length}</button>` : ""}`;
}
// Career over time: runs, wickets, batting average -- each its own small chart (never two scales on one).
function overTimeHtml(series){
  if (series.length < 3) return "";
  const first = series[0], last = series[series.length - 1];
  const from = first.at ? matchDateText({ completedAt: first.at }) : "match 1", to = last.at ? matchDateText({ completedAt: last.at }) : `match ${last.n}`;
  const charts = [];
  if (last.runs > 0) charts.push(["Runs", sparkLineChart(series.map(s => ({ x: s.n, y: s.runs, tip: `Match ${s.n}: ${s.score != null ? `${s.score} · ` : ""}${s.runs} in all` })), { label: `Career runs: ${last.runs}`, color: "var(--chart-a)", from, to })]);
  if (series.some(s => s.average != null)) charts.push(["Batting average", sparkLineChart(series.map(s => ({ x: s.n, y: s.average == null ? null : Math.round(s.average * 10) / 10, tip: s.average == null ? "" : `Match ${s.n}: average ${s.average.toFixed(1)}` })), { label: "Batting average over time", color: "var(--chart-a)", endLabel: last.average != null ? last.average.toFixed(1) : "", from, to })]);
  if (last.wickets > 0) charts.push(["Wickets", sparkLineChart(series.map(s => ({ x: s.n, y: s.wickets, tip: `Match ${s.n}: ${s.taken != null ? `${s.taken} · ` : ""}${s.wickets} in all` })), { label: `Career wickets: ${last.wickets}`, color: "var(--chart-b)", from, to })]);
  return charts.filter(c => c[1]).length ? `
    <h3 class="section-label">Over time <span class="section-sub">match by match</span></h3>
    <div class="over-time">${charts.filter(c => c[1]).map(([t, svg]) => `<div class="chart-card mini"><div class="chart-head"><h4>${t}</h4></div>${svg}</div>`).join("")}</div>` : "";
}
function matchupsHtml(mu, all){
  if (!mu.faced.length && !mu.bowledAt.length) return "";
  const fig = p => p.balls ? `${p.runs} (${p.balls})` : "";
  const outs = p => p.outs ? `out ${p.outs === 1 ? "once" : `${p.outs}×`}` : "";
  const list = (rows, line) => `<ol class="matchup-list">${(all ? rows : rows.slice(0, MATCHUPS_SHOWN)).map(p => `<li>${line(p)}</li>`).join("")}</ol>`;
  const more = mu.faced.length > MATCHUPS_SHOWN || mu.bowledAt.length > MATCHUPS_SHOWN;
  return `
    <h3 class="section-label">Match-ups</h3>
    ${mu.faced.length ? `<h4 class="stat-sub">Against bowlers</h4>${list(mu.faced, p => `<span class="mu-name">${escapeHtml(p.bowlerName)}</span><span class="mu-figs n">${[fig(p), outs(p)].filter(Boolean).join(" · ") || "—"}</span>`)}` : ""}
    ${mu.bowledAt.length ? `<h4 class="stat-sub">Against batters</h4>${list(mu.bowledAt, p => `<span class="mu-name">${escapeHtml(p.batterName)}</span><span class="mu-figs n">${[p.outs ? plural(p.outs, "wicket") : "", p.balls ? `${p.runs} off ${p.balls}` : ""].filter(Boolean).join(" · ") || "—"}</span>`)}` : ""}
    ${more && !all ? `<button type="button" data-action="history-more" data-what="matchups" class="link-btn">Show all match-ups</button>` : ""}`;
}
/* The top part (form and badges, next to the figures) and the rest
   (milestones, over time, match-ups). `career`: playerCareer over `all`
   (every match of the club / tournament / phone); `figures`: the matches the
   figures are over (a period's); `show`: { milestones, matchups } shown in
   full. */
// Every batter v bowler pairing of these matches (computeMatchups), statsMemo'd: a sheet re-renders on each tap.
function matchupsFor(matches){ return statsMemo("matchups", matches, "", () => computeMatchups(matches, statsOpts())); }
function playerHistoryTop(who, all){
  const career = playerCareer(who, all, null);
  if (!career) return "";
  return playerFormHtml(playerForm(who, all)) + playerBadgesHtml(playerBadges(career, playerHonourCounts(who, all)));
}
function playerHistoryRest(who, all, figures, show){
  const s = show || {};
  return milestonesHtml(playerMilestones(who, all), s.milestones)
    + overTimeHtml(playerCareerSeries(who, all))
    + matchupsHtml(playerMatchups(who, figures, statsOpts(), matchupsFor(figures)), s.matchups);
}

/* --- the player sheet's tools: compare with someone, a year in review --- */
function playerToolsHtml(ps, who){
  const years = playerYears(who, ps.allMatches || ps.matches);
  return `<div class="player-tools">
    <button type="button" data-action="player-compare" class="ghost small">⇄ Compare</button>
    ${years.length ? `<button type="button" data-action="player-year" data-year="${years[0]}" class="ghost small">★ ${years[0]} in review</button>` : ""}
  </div>`;
}
// Compare: pick someone from the same leaderboard, then side by side (ui.playerStats.compare = { key }).
function openPlayerCompare(){
  if (!ui.playerStats) return;
  ui.playerStats.compare = { key: null };
  render();
}
function pickPlayerCompare(key){
  if (!ui.playerStats || !ui.playerStats.compare) return;
  ui.playerStats.compare = { key };
  render();
}
function closePlayerCompare(){
  if (!ui.playerStats) return;
  ui.playerStats.compare = null;
  render();
}
function renderPlayerCompareBody(ps){
  const totals = aggregatePlayerStats(ps.matches, ps.points, statsOpts());
  const isMe = t => ps.self ? isMyTotal(ps.self, t) : t.key === ps.key;
  const others = totals.filter(t => !isMe(t)).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
  if (!ps.compare.key){
    if (!others.length) return `<p class="hint">Nobody else played in these matches.</p>`;
    return `
      <p class="muted">Compare ${escapeHtml(ps.name)} with…</p>
      <div class="pick-search"><input maxlength="40" placeholder="Search" data-pick-filter autocomplete="off" aria-label="Search players"></div>
      <p class="hint pick-none" hidden>Nobody by that name here.</p>
      <div class="bowler-pick-list">${others.map(t => `<button type="button" data-action="player-compare-pick" data-key="${escapeHtml(t.key)}" data-search="${escapeHtml(nameSearchKey(t.name))}" class="bowler-pick-row pick-row-item"><span class="name">${escapeHtml(t.name)}</span><span class="n figs">${plural(t.matches, "match", "matches")}</span></button>`).join("")}</div>`;
  }
  const other = totals.find(t => t.key === ps.compare.key);
  if (!other) return `<p class="hint">That player isn't in these matches.</p>`;
  const whoA = playerStatsWho(ps), whoB = statsWho(isNameKey(other.key) ? null : other.key, other.names);
  const c = playerComparison(whoA, whoB, ps.matches, ps.points, statsOpts(), matchupsFor(ps.matches));
  const ratings = statsMemo("ratings", ps.matches, "", () => playerRatings(ps.matches, statsOpts()));
  const ra = ratings[ps.self ? ps.self.id : ps.key] || {}, rb = ratings[other.key] || {};
  const f1 = n => n == null ? "—" : n.toFixed(1);
  const hs = x => x && x.highScore ? `${x.highScore.runs}${x.highScore.out ? "" : "*"}` : "—";
  // [label, a, b, which is better: "hi" | "lo" | null, the values compared]
  const rows = [
    ["Matches", c.a ? c.a.matches : 0, c.b ? c.b.matches : 0, null],
    ["Runs", c.a ? c.a.runs : 0, c.b ? c.b.runs : 0, "hi"],
    ["Average", f1(c.a && c.a.average), f1(c.b && c.b.average), "hi", c.a && c.a.average, c.b && c.b.average],
    ["Strike rate", f1(c.a && c.a.strikeRate), f1(c.b && c.b.strikeRate), "hi", c.a && c.a.strikeRate, c.b && c.b.strikeRate],
    ["Highest", hs(c.a), hs(c.b), "hi", c.a && c.a.highScore ? c.a.highScore.runs : null, c.b && c.b.highScore ? c.b.highScore.runs : null],
    ["50s / 100s", c.a ? `${c.a.fifties} / ${c.a.hundreds}` : "—", c.b ? `${c.b.fifties} / ${c.b.hundreds}` : "—", null],
    ["Wickets", c.a ? c.a.wickets : 0, c.b ? c.b.wickets : 0, "hi"],
    ["Economy", f1(c.a && c.a.economy), f1(c.b && c.b.economy), "lo", c.a && c.a.economy, c.b && c.b.economy],
    ["Best", c.a && c.a.best ? `${c.a.best.wickets}/${c.a.best.runs}` : "—", c.b && c.b.best ? `${c.b.best.wickets}/${c.b.best.runs}` : "—", "hi",
      c.a && c.a.best ? c.a.best.wickets * 1000 - c.a.best.runs : null, c.b && c.b.best ? c.b.best.wickets * 1000 - c.b.best.runs : null],
    ["Catches", c.a ? c.a.catches : 0, c.b ? c.b.catches : 0, "hi"],
    ...(ps.points ? [["MVP points", c.a ? pointsNum(c.a.points) : 0, c.b ? pointsNum(c.b.points) : 0, "hi", c.a ? c.a.points : 0, c.b ? c.b.points : 0]] : []),
    ["Bat rating", ra.bat != null ? ra.bat : "—", rb.bat != null ? rb.bat : "—", "hi", ra.bat, rb.bat],
    ["Bowl rating", ra.bowl != null ? ra.bowl : "—", rb.bowl != null ? rb.bowl : "—", "hi", ra.bowl, rb.bowl]
  ];
  const cell = (row, side) => {
    const [, a, b, dir, va = a, vb = b] = row;
    const mine = side === "a" ? va : vb, theirs = side === "a" ? vb : va;
    const win = dir && typeof mine === "number" && typeof theirs === "number" && (dir === "hi" ? mine > theirs : mine < theirs);
    return `<td class="n${win ? " better" : ""}">${escapeHtml(String(side === "a" ? a : b))}</td>`;
  };
  const h2h = (bat, bowl, x) => x.balls || x.outs
    ? `<b>${escapeHtml(bat)}</b> v ${escapeHtml(bowl)}: <span class="n">${x.runs} (${x.balls})</span>${x.outs ? ` · out ${x.outs === 1 ? "once" : `${x.outs} times`}` : " · never out"}`
    : `${escapeHtml(bat)} hasn't faced ${escapeHtml(bowl)}`;
  return `
    <table class="compare-table">
      <thead><tr><th></th><th>${escapeHtml(ps.name)}</th><th>${escapeHtml(other.name)}</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${r[0]}</th>${cell(r, "a")}${cell(r, "b")}</tr>`).join("")}</tbody>
    </table>
    <h3 class="section-label">Head to head</h3>
    <ul class="h2h-list">
      ${c.against || c.aToB.balls || c.aToB.outs ? `<li>${h2h(ps.name, other.name, c.aToB)}</li>` : ""}
      ${c.against || c.bToA.balls || c.bToA.outs ? `<li>${h2h(other.name, ps.name, c.bToA)}</li>` : ""}
      <li>${c.together ? `Played together ${plural(c.together, "time")}` : "Never on the same side"}${c.against ? ` · against each other ${plural(c.against, "time")}: ${escapeHtml(ps.name)} won ${c.wonA}, ${escapeHtml(other.name)} won ${c.wonB}` : ""}</li>
    </ul>`;
}

/* --- a year in review: a share image (the share preview sheet, kind "year") --- */
function openYearReview(year){
  const ps = ui.playerStats;
  if (!ps) return;
  ui.sharePreview = { kind: "year", year: String(year), view: navKey(), theme: ui.sharePreview ? ui.sharePreview.theme : "night", url: null,
    who: { key: ps.key, self: ps.self, names: ps.names }, name: ps.name, matches: ps.allMatches || ps.matches, points: ps.points, title: ps.scopeTitle || "" };
  render();
  buildSharePreview();
}
function yearReviewFor(sp){
  const who = sp.who.self ? statsWho(sp.who.self.id, sp.who.self.names) : statsWho(sp.who.key && !isNameKey(sp.who.key) ? sp.who.key : null, sp.who.names);
  return playerYearReview(who, sp.matches, sp.year, sp.points);
}
function renderYearCanvas(sp, themeKey, logo){
  const th = SHARE_THEMES[themeKey] || SHARE_THEMES.night;
  const r = yearReviewFor(sp);
  if (!r) return null;
  const c = r.career;
  return composeShareImage(th, ctx => {
    const X = SHARE_PAD, W = SHARE_W - SHARE_PAD * 2;
    let y = shareHeader(ctx, th, logo, sp.title || "");
    shareText(ctx, `${r.year} IN REVIEW`, X, y + 30, { size: 24, weight: 800, color: th.gold, spacing: 4 });
    shareText(ctx, sp.name, X, y + 100, { size: 72, weight: 800, color: th.text, maxW: W });
    shareText(ctx, [plural(c.matches, "match", "matches"), r.teams.length && r.teams.length <= 2 ? `for ${r.teams.join(" and ")}` : "", r.months > 1 ? `${r.months} months` : ""].filter(Boolean).join(" · "), X, y + 146, { size: 28, weight: 600, color: th.muted, maxW: W });
    y += 186;
    // The big numbers: two rows of three.
    // Two rows of three, following what they did: batting, bowling, or both.
    const batRow = [[c.runs, "RUNS"], [c.highScore ? `${c.highScore.runs}${c.highScore.out ? "" : "*"}` : "—", "HIGHEST"], [c.strikeRate != null ? c.strikeRate.toFixed(0) : "—", "STRIKE RATE"]];
    const batMore = [[c.fours, "FOURS"], [c.sixes, "SIXES"], [c.average != null ? c.average.toFixed(1) : "—", "AVERAGE"]];
    const bowlRow = [[c.wickets, "WICKETS"], [c.best ? `${c.best.wickets}/${c.best.runs}` : "—", "BEST"], [c.economy != null ? c.economy.toFixed(2) : "—", "ECONOMY"]];
    const bowlMore = [[oversDisplay(c.legalBalls, 6), "OVERS"], [c.maidens, "MAIDENS"], [c.catches + (c.stumpings || 0) + c.runouts, "DISMISSALS"]];
    const bats = c.innings > 0, bowls = c.bowlInnings > 0;
    const tiles = bats && bowls ? [...batRow, ...bowlRow] : bowls ? [...bowlRow, ...bowlMore] : [...batRow, ...batMore];
    const tw = (W - 32) / 3, thh = 150;
    tiles.forEach(([v, label], i) => {
      const tx = X + (i % 3) * (tw + 16), ty = y + Math.floor(i / 3) * (thh + 16);
      shareCard(ctx, tx, ty, tw, thh, th.panel, th.line);
      shareText(ctx, String(v), tx + 28, ty + 86, { size: 64, weight: 800, color: i % 3 === 0 ? th.accent : th.text, maxW: tw - 56 });
      shareText(ctx, label, tx + 28, ty + 124, { size: 18, weight: 800, color: th.muted, spacing: 3 });
    });
    y += thh * 2 + 16 + 32;
    // Best innings and figures, player of the match.
    const best = [];
    if (r.bestBat) best.push(["BEST INNINGS", `${r.bestBat.runs}${r.bestBat.out ? "" : "*"} (${r.bestBat.balls})${r.bestBat.opp ? ` v ${r.bestBat.opp}` : ""}`]);
    if (r.bestBowl) best.push(["BEST BOWLING", `${r.bestBowl.wickets}/${r.bestBowl.runs}${r.bestBowl.opp ? ` v ${r.bestBowl.opp}` : ""}`]);
    if (r.pom) best.push(["PLAYER OF THE MATCH", r.pom === 1 ? "Once" : `${r.pom} times`]);
    best.forEach(([label, text]) => {
      shareCard(ctx, X, y, W, 96, th.panel, th.line);
      shareText(ctx, label, X + 32, y + 40, { size: 18, weight: 800, color: th.muted, spacing: 3 });
      shareText(ctx, text, X + 32, y + 78, { size: 32, weight: 800, color: th.text, maxW: W - 64 });
      y += 96 + 16;
    });
    // Milestones reached that year.
    if (r.milestones.length){
      y += 12;
      shareText(ctx, "MILESTONES", X, y + 20, { size: 20, weight: 800, color: th.gold, spacing: 3 });
      y += 40;
      r.milestones.slice(0, 6).reverse().forEach(x => {
        shareText(ctx, `${MILESTONE_ICONS[x.kind] || "•"}  ${x.text}`, X, y + 34, { size: 30, weight: 700, color: th.text, maxW: W });
        y += 50;
      });
    }
    return shareFooter(ctx, th, logo, y + 24);
  });
}
