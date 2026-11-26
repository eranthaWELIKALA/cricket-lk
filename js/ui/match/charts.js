/* Cricket.lk — match: the scorecard's Charts tab, and the small line charts a player's history uses.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- charts ---
   Plain inline SVG, no library (the app stays dependency-free and offline).
   Each team keeps its own colour on every chart -- side A --chart-a (blue),
   side B --chart-b (orange), set by applyTheme for a light or dark theme and
   checked for colour-blind separation on every theme's surface -- whichever
   batted first. Lines are 2px, bars at most 24px with a rounded top, wicket
   marks are the app's wicket red with a ring in the card colour. Every chart
   has its legend (two teams) or its title (one), the numbers it's drawn from
   are in the scorecard and ball by ball next to it, and each mark carries a
   <title> (hover / long-press) with its figures. */
const CHART_W = 320;
const CHART_PAD = { l: 30, r: 12, t: 12, b: 22 };
function chartColor(teamKey){ return teamKey === "B" ? "var(--chart-b)" : "var(--chart-a)"; }
// Round axis steps: 0 / 25 / 50 / 75 / 100 …
function niceStep(max, ticks){
  const raw = Math.max(1, max) / (ticks || 4);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function chartFrame(h, xMax, yMax, xTicks, opts){
  const o = opts || {};
  const W = CHART_W, P = CHART_PAD;
  const iw = W - P.l - P.r, ih = h - P.t - P.b;
  const ys = niceStep(yMax, o.yTicks || 4), top = Math.max(ys, Math.ceil(yMax / ys) * ys);
  const x = v => P.l + (xMax ? v / xMax * iw : 0);
  const y = v => P.t + ih - (top ? v / top * ih : 0);
  let grid = "";
  for (let v = 0; v <= top + 1e-9; v += ys){
    const yy = y(v).toFixed(1);
    grid += `<line class="chart-grid" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}"/><text class="chart-tick" x="${P.l - 5}" y="${(+yy + 3).toFixed(1)}" text-anchor="end">${o.yFormat ? o.yFormat(v) : Math.round(v * 10) / 10}</text>`;
  }
  (xTicks || []).forEach(t => { grid += `<text class="chart-tick" x="${x(t.v).toFixed(1)}" y="${h - 6}" text-anchor="middle">${escapeHtml(t.label)}</text>`; });
  return { x, y, top, grid, iw, ih, W, h };
}
function overTicks(maxOvers){
  const step = maxOvers <= 6 ? 1 : maxOvers <= 12 ? 2 : maxOvers <= 30 ? 5 : 10;
  const out = [];
  for (let v = step; v <= maxOvers; v += step) out.push({ v, label: String(v) });
  return out;
}
function chartLegend(items){
  return items.length > 1 ? `<div class="chart-legend">${items.map(i => `<span><i style="background:${i.color}"></i>${escapeHtml(i.label)}</span>`).join("")}</div>` : "";
}
function chartSvg(h, label, body){
  return `<svg class="chart-svg" viewBox="0 0 ${CHART_W} ${h}" role="img" aria-label="${escapeHtml(label)}">${body}</svg>`;
}
const linePath = pts => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");

/* --- the scorecard's Charts tab: the whole match (worm, runs per over, the
   chase's run rate) then the innings the tab is on (partnerships, phases). */
function renderMatchCharts(match, idx){
  const inns = match.innings.filter(i => i && i.batting);
  if (!inns.some(i => inningsOverList(i).some(o => (o.events || []).length || o.gap))) return `<p class="hint">No balls bowled yet.</p>`;
  const inn = match.innings[idx];
  return `
    <div class="match-charts">
      ${chartCard("Worm", "Runs, over by over", wormChart(match))}
      ${chartCard("Runs per over", "", manhattanChart(match))}
      ${runRateChart(match) ? chartCard("Run rate", `${escapeHtml(possessive(teamName(match, match.innings[1].battingTeam)))} chase`, runRateChart(match)) : ""}
      ${inn ? chartCard(`Partnerships · ${escapeHtml(teamName(match, inn.battingTeam))}`, "", partnershipBars(match, inn)) : ""}
      ${inn && inningsPhaseSplits(inn) ? chartCard(`Phases · ${escapeHtml(teamName(match, inn.battingTeam))}`, "", phaseTable(inn)) : ""}
    </div>`;
}
function chartCard(title, sub, body){
  return body ? `<section class="chart-card"><div class="chart-head"><h4>${title}</h4>${sub ? `<span class="chart-sub">${sub}</span>` : ""}</div>${body}</section>` : "";
}
function matchMaxOvers(match){
  const bpo = match.ballsPerOver || 6;
  const played = Math.max(1, ...match.innings.map(i => Math.ceil((i.legalBalls || 0) / (i.ballsPerOver || bpo))));
  const limit = match.innings[0] && match.innings[0].oversLimit;
  return limit != null ? Math.max(limit, played) : played;
}
// The worm: each innings' score against overs, a ringed red dot at each wicket.
function wormChart(match){
  const xMax = matchMaxOvers(match);
  const series = match.innings.filter(i => i && i.batting).map(inn => {
    const bpo = inn.ballsPerOver || 6;
    const pts = [[0, 0], ...inningsOverSeries(inn).map(s => [s.balls / bpo, s.score])];
    return { inn, bpo, pts, color: chartColor(inn.battingTeam), label: teamName(match, inn.battingTeam) };
  });
  const yMax = Math.max(10, ...series.map(s => s.inn.runs));
  const f = chartFrame(170, xMax, yMax, overTicks(xMax));
  let body = f.grid;
  series.forEach(s => {
    body += `<path class="chart-line" d="${linePath(s.pts.map(p => [f.x(p[0]), f.y(p[1])]))}" style="stroke:${s.color}"/>`;
  });
  series.forEach(s => {
    s.inn.fallOfWickets.forEach(w => {
      body += `<circle class="chart-wkt" cx="${f.x((w.balls || 0) / s.bpo).toFixed(1)}" cy="${f.y(w.score).toFixed(1)}" r="4"><title>${escapeHtml(`${w.batsman ? liveName(w.batsman) + " out · " : ""}${s.label} ${w.score}-${w.wicket} (${w.over})`)}</title></circle>`;
    });
    const end = s.pts[s.pts.length - 1];
    body += `<circle cx="${f.x(end[0]).toFixed(1)}" cy="${f.y(end[1]).toFixed(1)}" r="4" class="chart-end" style="fill:${s.color}"><title>${escapeHtml(`${s.label} ${s.inn.runs}-${s.inn.wickets} (${oversDisplay(s.inn.legalBalls, s.bpo)} ov)`)}</title></circle>`;
  });
  return chartLegend(series.map(s => ({ label: `${s.label} ${s.inn.runs}-${s.inn.wickets}`, color: s.color })))
    + chartSvg(170, `Worm: ${series.map(s => `${s.label} ${s.inn.runs}-${s.inn.wickets}`).join(", ")}`, body);
}
// Runs per over, the two innings side by side; a red dot over each over with a wicket.
function manhattanChart(match){
  const xMax = matchMaxOvers(match);
  const sides = match.innings.filter(i => i && i.batting).map(inn => ({ inn, overs: inningsOverSeries(inn).filter(s => !s.gap), color: chartColor(inn.battingTeam), label: teamName(match, inn.battingTeam) }));
  const yMax = Math.max(6, ...sides.flatMap(s => s.overs.map(o => o.runs)));
  const f = chartFrame(160, xMax, yMax, []);
  const slot = f.iw / xMax, n = sides.length;
  const bw = Math.max(2, Math.min(24, (slot - 2) / n - 2));
  let body = f.grid;
  const ticks = overTicks(xMax).map(t => t.v);
  for (let o = 1; o <= xMax; o++){
    if (ticks.includes(o) || xMax <= 12) body += `<text class="chart-tick" x="${(CHART_PAD.l + (o - 0.5) * slot).toFixed(1)}" y="${f.h - 6}" text-anchor="middle">${o}</text>`;
  }
  sides.forEach((s, k) => s.overs.forEach(ov => {
    const cx = CHART_PAD.l + (ov.over - 0.5) * slot + (k - (n - 1) / 2) * (bw + 2);
    const x0 = cx - bw / 2, y0 = f.y(ov.runs), base = f.y(0), hgt = base - y0;
    const r = Math.min(4, bw / 2, hgt);
    const d = hgt > 0 ? `M${x0.toFixed(1)} ${base.toFixed(1)}V${(y0 + r).toFixed(1)}Q${x0.toFixed(1)} ${y0.toFixed(1)} ${(x0 + r).toFixed(1)} ${y0.toFixed(1)}H${(x0 + bw - r).toFixed(1)}Q${(x0 + bw).toFixed(1)} ${y0.toFixed(1)} ${(x0 + bw).toFixed(1)} ${(y0 + r).toFixed(1)}V${base.toFixed(1)}Z` : "";
    const tip = `${s.label} · over ${ov.over}${ov.current ? " (so far)" : ""}: ${plural(ov.runs, "run")}${ov.wickets ? `, ${plural(ov.wickets, "wicket")}` : ""}${ov.bowler ? ` · ${liveName(ov.bowler)}` : ""}`;
    body += `<g class="chart-bar">${d ? `<path d="${d}" style="fill:${s.color}"/>` : ""}<rect x="${x0.toFixed(1)}" y="${CHART_PAD.t}" width="${bw.toFixed(1)}" height="${(base - CHART_PAD.t).toFixed(1)}" fill="transparent"><title>${escapeHtml(tip)}</title></rect></g>`;
    for (let w = 0; w < ov.wickets; w++) body += `<circle class="chart-wkt" cx="${cx.toFixed(1)}" cy="${(y0 - 6 - w * 9).toFixed(1)}" r="3.5"/>`;
  }));
  return chartLegend(sides.map(s => ({ label: s.label, color: s.color }))) + chartSvg(160, `Runs per over`, body);
}
// The chase: its run rate at the end of each over against the rate it needed from there.
function runRateChart(match){
  const inn = match.innings[1];
  if (!inn || !inn.batting || inn.target == null || inn.oversLimit == null || !inn.legalBalls) return "";
  const bpo = inn.ballsPerOver || 6, limit = inn.oversLimit * bpo;
  const pts = inningsOverSeries(inn).filter(s => s.balls > 0);
  if (pts.length < 2) return "";
  const rr = pts.map(s => [s.balls / bpo, s.score / (s.balls / bpo)]);
  const req = pts.filter(s => s.balls < limit && s.score < inn.target).map(s => [s.balls / bpo, (inn.target - s.score) / ((limit - s.balls) / bpo)]);
  const start = [0, inn.target / inn.oversLimit];
  const yMax = Math.max(6, ...rr.map(p => p[1]), ...req.map(p => p[1]), start[1]);
  const f = chartFrame(150, inn.oversLimit, Math.min(yMax, 36), overTicks(inn.oversLimit));
  const clampY = v => f.y(Math.min(v, f.top));
  const color = chartColor(inn.battingTeam);
  let body = f.grid;
  body += `<path class="chart-line ref" d="${linePath([start, ...req].map(p => [f.x(p[0]), clampY(p[1])]))}"/>`;
  body += `<path class="chart-line" d="${linePath(rr.map(p => [f.x(p[0]), clampY(p[1])]))}" style="stroke:${color}"/>`;
  rr.forEach((p, i) => { body += `<circle cx="${f.x(p[0]).toFixed(1)}" cy="${clampY(p[1]).toFixed(1)}" r="6" fill="transparent"><title>${escapeHtml(`After ${oversDisplay(pts[i].balls, bpo)} ov: ${p[1].toFixed(2)} an over${req[i] ? `, needed ${req[i][1].toFixed(2)}` : ""}`)}</title></circle>`; });
  return chartLegend([{ label: "Run rate", color }, { label: "Needed", color: "var(--muted)" }]) + chartSvg(150, "Run rate against the rate needed", body);
}
/* Partnerships, a bar each (as long as its runs, the innings' best the full
   width), with each batter's share when ball by ball says who scored what. */
function partnershipBars(match, inn){
  const list = inningsPartnerships(inn);
  if (list === null) return `<p class="hint">Not worked out for this innings: part of it was caught up, or scored with an older version of the app.</p>`;
  const shown = list.filter(p => p.balls > 0 || p.runs > 0);
  if (!shown.length) return `<p class="hint">No partnerships yet.</p>`;
  const max = Math.max(1, ...shown.map(p => p.runs));
  const color = chartColor(inn.battingTeam);
  return `<ol class="partnership-bars">${shown.map(p => {
    const who = p.batters.map(n => `${escapeHtml(liveName(n))}${p.bat ? ` <b class="n">${p.bat[n] || 0}</b>` : ""}`).join(" &amp; ");
    return `<li>
      <span class="pb-wkt">${ordinalText(p.wicket)}</span>
      <span class="pb-main">
        <span class="pb-who">${who}${p.batters.length === 1 ? " <span class=\"muted\">(alone)</span>" : ""}</span>
        <span class="pb-track"><span class="pb-fill" style="width:${Math.max(2, Math.round(p.runs / max * 100))}%;background:${color}"></span></span>
      </span>
      <span class="pb-val n">${p.runs}${p.unbroken ? "*" : ""} <small>(${p.balls})</small></span>
    </li>`;
  }).join("")}</ol>`;
}
// Opening / middle / death overs (inningsPhaseSplits): runs, wickets, rate, boundaries, dots.
function phaseTable(inn){
  const rows = inningsPhaseSplits(inn);
  if (!rows) return "";
  const bpo = inn.ballsPerOver || 6;
  return `<table class="phase-table">
    <thead><tr><th>Overs</th><th>R</th><th>W</th><th>RR</th><th>4s</th><th>6s</th><th>Dots</th></tr></thead>
    <tbody>${rows.map(r => `<tr${r.bowled ? "" : ` class="muted"`}>
      <td><b>${r.label.replace(" overs", "")}</b> <span class="muted n">${r.from === r.to ? r.from : `${r.from}–${r.to}`}</span></td>
      <td class="n">${r.bowled ? r.runs : "—"}</td><td class="n">${r.bowled ? r.wickets : "—"}</td>
      <td class="n">${r.balls ? (r.runs / (r.balls / bpo)).toFixed(2) : "—"}</td>
      <td class="n">${r.bowled ? r.fours : "—"}</td><td class="n">${r.bowled ? r.sixes : "—"}</td><td class="n">${r.bowled ? r.dots : "—"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

/* --- a small line chart: one series over matches (a player's runs,
   wickets, average). points: [{ x, y, tip }] in order; the last value is
   labelled at the line's end. */
function sparkLineChart(points, opts){
  const o = opts || {};
  if (!points || points.length < 2) return "";
  const h = 96, W = CHART_W, P = { l: 30, r: 40, t: 10, b: 18 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y).filter(v => v != null);
  if (!ys.length) return "";
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const ystep = niceStep(Math.max(...ys), 3), top = Math.max(ystep, Math.ceil(Math.max(...ys) / ystep) * ystep);
  const x = v => P.l + (xMax > xMin ? (v - xMin) / (xMax - xMin) : 0.5) * (W - P.l - P.r);
  const y = v => P.t + (h - P.t - P.b) - v / top * (h - P.t - P.b);
  let body = "";
  for (let v = 0; v <= top + 1e-9; v += ystep) body += `<line class="chart-grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="chart-tick" x="${P.l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${o.format ? o.format(v) : Math.round(v)}</text>`;
  const pts = points.filter(p => p.y != null);
  const color = o.color || "var(--chart-a)";
  body += `<path class="chart-line" d="${linePath(pts.map(p => [x(p.x), y(p.y)]))}" style="stroke:${color}"/>`;
  if (pts.length <= 60) pts.forEach(p => { body += `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="5" fill="transparent"><title>${escapeHtml(p.tip || "")}</title></circle>`; });
  const last = pts[pts.length - 1];
  body += `<circle class="chart-end" cx="${x(last.x).toFixed(1)}" cy="${y(last.y).toFixed(1)}" r="4" style="fill:${color}"/>`;
  body += `<text class="chart-end-label" x="${(x(last.x) + 7).toFixed(1)}" y="${(y(last.y) + 4).toFixed(1)}">${escapeHtml(o.endLabel != null ? o.endLabel : String(last.y))}</text>`;
  body += `<text class="chart-tick" x="${P.l}" y="${h - 4}">${escapeHtml(o.from || "")}</text><text class="chart-tick" x="${W - P.r}" y="${h - 4}" text-anchor="end">${escapeHtml(o.to || "")}</text>`;
  return chartSvg(h, o.label || "", body);
}
