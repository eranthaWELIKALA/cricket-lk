/* Cricket.lk — engine, part 2: records & history.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   2b. ENGINE: RECORDS & HISTORY -- pure functions, zero DOM access
   ============================================================
   What the Records tab, a player's history (form, badges, milestones,
   ratings, match-ups, over time, year in review), the scorecard's charts
   and Result's "records set" read. All of it is worked out from the
   completed matches whenever it's shown, never stored -- like every other
   figure -- so an edited match moves it too.

   Only what a scorecard really holds is used. Anything that needs to know
   who faced each ball (fastest fifties, a batter's runs off one bowler,
   partnerships, the opening and death overs) reads the over events'
   `batter` (recordBall has kept it since commentary came in), so balls from
   older app versions, and a catch-up's gap, are left out of those figures:
   they're never guessed. Players are counted by key (linkedKeyOf, see "who a
   scorecard name is" in engine.js), and "no names" matches and placeholders
   ("Bat ?1") aren't people, as everywhere else. This section is part of the
   engine to port: it still does zero DOM access. */

// --- walking an innings ball by ball -------------------------------------
// Every over of an innings, the one in progress last (`current`).
function inningsOverList(inn){
  const list = ((inn && inn.overs) || []).slice();
  if (inn && (inn.currentOverEvents || []).length) list.push({ bowler: inn.bowler, events: inn.currentOverEvents, current: true });
  return list;
}
function inningsHasGap(inn){ return !!(inn && (inn.overs || []).some(o => o.gap)); }
/* Can this innings' balls be credited batter by batter? Every ball says who
   faced it, and nothing was caught up (a gap's balls aren't known). */
function inningsBallData(inn){
  if (!inn || !inn.batting || inningsHasGap(inn)) return false;
  const overs = inningsOverList(inn);
  return overs.some(o => (o.events || []).length) && overs.every(o => (o.events || []).every(ev => !!ev.batter));
}
/* Every ball, in order: fn({ ev, c, legal, faced, over, bowler, at }) --
   `over` 0-based from the legal balls before it (after a catch-up gap the
   count carries on from the gap), `at` the ball's place in the innings (as
   inningsEventCount counts, which retirements' `at` uses), `faced` whether
   the striker faced it (everything but a wide). */
function forEachBall(inn, fn){
  const bpo = inn.ballsPerOver || 6;
  let balls = 0, at = 0;
  inningsOverList(inn).forEach(o => {
    if (o.gap){ balls = o.gap.toBalls; return; }
    (o.events || []).forEach(ev => {
      const c = commentaryEvent(ev);
      const legal = c.kind !== "wide" && c.kind !== "noball" && !c.extra;
      const over = Math.floor(balls / bpo);
      if (legal) balls += 1;
      fn({ ev, c, legal, faced: c.kind !== "wide" && c.extra !== "wide", over, bowler: o.bowler || null, at: at++, balls });
    });
  });
}
function ordinalText(n){
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

// --- partnerships ----------------------------------------------------------
/* An innings' partnerships in order: [{ wicket (the wicket it was for),
   batters: [names] (two, or one batting alone), runs (extras included),
   balls (legal), bat: { name: runs off the bat } (when every ball says who
   faced it), unbroken (no wicket ended it: the innings did, or a batter
   retired), out }]. Who was at the crease is worked out the way a scorer
   would: the openers, then the next in the batting order after each wicket,
   and retirements and returns (inn.retirements, between the balls they came
   between) -- each of those starts a new partnership, as the live board's
   counter does (partnershipBase). null when it can't be told for sure: a
   catch-up gap (who fell when isn't known), or a ball whose batter doesn't
   fit (an older or hand-mended innings). */
function inningsPartnerships(inn){
  if (!inn || !inn.batting || inningsHasGap(inn)) return null;
  const order = inn.batting.order, rets = inn.retirements || [], fow = inn.fallOfWickets || [];
  const crease = [], list = [];
  let qi = 0, ri = 0, wickets = 0, cur = null, broken = false, ballData = true;
  const close = how => { if (cur){ cur.unbroken = how !== "wicket"; list.push(cur); cur = null; } };
  const retirements = upTo => {
    for (; ri < rets.length && rets[ri].at <= upTo; ri++){
      const r = rets[ri];
      close("retired");
      if (r.type === "back"){ if (!crease.includes(r.name)) crease.push(r.name); }
      else { const i = crease.indexOf(r.name); if (i >= 0) crease.splice(i, 1); }
    }
  };
  const fill = () => { while (crease.length < 2 && qi < order.length){ const n = order[qi++]; if (!crease.includes(n)) crease.push(n); } };
  forEachBall(inn, b => {
    if (broken) return;
    retirements(b.at); fill();
    if (!crease.length){ broken = true; return; }
    if (!cur) cur = { wicket: wickets + 1, batters: crease.slice(), runs: 0, balls: 0, bat: {}, out: null };
    const ev = b.ev;
    if (ev.batter){
      if (!cur.batters.includes(ev.batter)){ broken = true; return; }
      cur.bat[ev.batter] = (cur.bat[ev.batter] || 0) + eventBatRuns(ev);
    } else ballData = false;
    cur.runs += ev.runs || 0;
    if (b.legal) cur.balls += 1;
    if (ev.isWicket){
      const out = ev.outName || (fow[wickets] && fow[wickets].batsman) || null;
      wickets += 1;
      if (!out || !crease.includes(out)){ broken = true; return; }
      cur.out = out;
      close("wicket");
      crease.splice(crease.indexOf(out), 1);
    }
  });
  if (broken) return null;
  retirements(Infinity);
  close("end");
  if (!ballData) list.forEach(p => { p.bat = null; });
  return list;
}

// --- the phases of an innings: opening, middle and death overs --------------
/* Worked out from the overs limit, so a 5-over club game has phases too:
   the first ~30% of the overs (at most 10) and the last ~25% (at most 10).
   20 overs: 1-6 and 16-20; 6 overs: 1-2 and 5-6; 4 overs: 1 and 4. No overs
   limit, or under 3 overs: no phases. */
function inningsPhases(inn){
  const L = inn && inn.oversLimit;
  if (L == null || L < 3) return null;
  const open = Math.max(1, Math.min(10, Math.round(L * 0.3)));
  const death = Math.max(1, Math.min(10, Math.round(L * 0.25)));
  return open + death > L ? null : { open, death, limit: L };
}
function phaseOf(ph, over){ return !ph ? null : over < ph.open ? "open" : over >= ph.limit - ph.death ? "death" : "middle"; }
const PHASE_LABELS = { open: "Opening overs", middle: "Middle overs", death: "Death overs" };
/* An innings by phase, for the scorecard's charts: [{ key, label, from, to
   (overs, 1-based), runs, wickets, balls, fours, sixes, dots }] -- the
   middle left out when there's none. null without phases or with a gap. */
function inningsPhaseSplits(inn){
  const ph = inningsPhases(inn);
  if (!ph || inningsHasGap(inn)) return null;
  const rows = {
    open: { key: "open", from: 1, to: ph.open },
    middle: { key: "middle", from: ph.open + 1, to: ph.limit - ph.death },
    death: { key: "death", from: ph.limit - ph.death + 1, to: ph.limit }
  };
  Object.values(rows).forEach(r => Object.assign(r, { label: PHASE_LABELS[r.key], runs: 0, wickets: 0, balls: 0, fours: 0, sixes: 0, dots: 0, bowled: false }));
  forEachBall(inn, b => {
    const r = rows[phaseOf(ph, b.over)];
    const ev = b.ev, bat = eventBatRuns(ev);
    r.bowled = true;
    r.runs += ev.runs || 0;
    if (b.legal) r.balls += 1;
    if (ev.isWicket) r.wickets += 1;
    if ((b.c.kind === "run" || b.c.kind === "noball") && bat === 4) r.fours += 1;
    if ((b.c.kind === "run" || b.c.kind === "noball") && bat === 6) r.sixes += 1;
    if (b.legal && !(ev.runs > 0)) r.dots += 1;
  });
  return [rows.open, rows.middle, rows.death].filter(r => r.from <= r.to);
}

// --- dismissals -------------------------------------------------------------
/* A batter's howOut text read back: { type: "bowled"|"caught"|"lbw"|
   "stumped"|"hitwicket", bowler, fielder } (the bowler is one of `bowlers`,
   the longest that fits, so "Kasun" never matches "Kasun Perera"), or null
   for a run-out, a retirement, not out, or text that doesn't fit. */
function howOutParts(howOut, bowlers){
  const h = String(howOut || "");
  if (!h || /^run out/.test(h) || /^retired/.test(h)) return null;
  const bowler = (bowlers || []).filter(n => n && h.endsWith(" b " + n)).sort((a, b) => b.length - a.length)[0];
  if (!bowler) return null;
  const head = h.slice(0, h.length - bowler.length - 3);
  if (/^c /.test(head)) return { type: "caught", bowler, fielder: head.slice(2) };
  if (/^st /.test(head)) return { type: "stumped", bowler, fielder: head.slice(3) };
  const type = { bowled: "bowled", caught: "caught", lbw: "lbw", stumped: "stumped", "hit wicket": "hitwicket" }[head];
  return type ? { type, bowler, fielder: null } : null;
}

// The players counted in `matches` and the name each shows under: { key: name }.
function playerNamesByKey(matches, opts){
  const out = {};
  aggregatePlayerStats(matches, null, opts).forEach(t => { out[t.key] = t.name; });
  return out;
}
function countedMatches(matches){
  return (matches || []).filter(m => m && Array.isArray(m.innings) && !playerStatsExcluded(m));
}

// --- match-ups: batter v bowler ----------------------------------------------
/* Every batter v bowler pairing over `matches`: [{ batter, bowler (keys),
   batterName, bowlerName, runs, balls, dots, fours, sixes, outs, matches }].
   Runs and balls come from the balls that say who faced them; dismissals
   from the scorecard (howOut: bowled, caught, lbw, stumped, hit wicket --
   never a run-out), so a match from before ball-by-ball batters still counts
   its dismissals. opts: aggregatePlayerStats' { keyOf, nameOf }, plus `names`
   ({ key: name }) when the caller has them. */
function computeMatchups(matches, opts){
  const o = opts || {};
  const counted = countedMatches(matches);
  const keyOf = linkedKeyOf(counted, o.keyOf);
  const names = o.names || playerNamesByKey(counted, o);
  const pairs = {};
  const pairFor = (m, bat, bowl) => {
    const bk = keyOf(m, bat), wk = keyOf(m, bowl), id = bk + "\u0001" + wk;
    const p = pairs[id] || (pairs[id] = { batter: bk, bowler: wk, batterName: names[bk] || bat, bowlerName: names[wk] || bowl,
      runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, outs: 0, ids: new Set() });
    p.ids.add(m.id || m);
    return p;
  };
  counted.forEach(m => m.innings.forEach(inn => {
    if (!inn.batting) return;
    forEachBall(inn, b => {
      const ev = b.ev;
      if (!ev.batter || !b.bowler || isUnnamedPlayer(ev.batter) || isUnnamedPlayer(b.bowler)) return;
      const p = pairFor(m, ev.batter, b.bowler), r = eventBatRuns(ev);
      p.runs += r;
      if (b.faced){ p.balls += 1; if (!(ev.runs > 0)) p.dots += 1; }
      if ((b.c.kind === "run" || b.c.kind === "noball") && r === 4) p.fours += 1;
      if ((b.c.kind === "run" || b.c.kind === "noball") && r === 6) p.sixes += 1;
    });
    inn.batting.order.forEach(n => {
      const s = inn.batting.stats[n];
      if (!s || !s.out || isUnnamedPlayer(n)) return;
      const how = howOutParts(s.howOut, inn.bowling.order);
      if (how && !isUnnamedPlayer(how.bowler)) pairFor(m, n, how.bowler).outs += 1;
    });
  }));
  return Object.values(pairs).map(p => { const x = Object.assign({}, p, { matches: p.ids.size }); delete x.ids; return x; });
}

// --- records ---------------------------------------------------------------
/* The Records tab (renderRecords), over a set of completed matches, in
   seven sections: Batting, Bowling, Fielding, Partnerships, Match-ups, Teams
   and Awards. Each record keeps its top RECORDS_TOP places: equal values
   share a place (1, 1, 3), and a record nobody has yet has no entries.
   Records: { key, label, entries, tile (a career tally, shown as a tile),
   dir ("asc": lowest is best), note (who qualifies), bad (not one to
   celebrate: Result's "records set" leaves it out), byWicket (one entry per
   wicket, `wicket` on each) }. A single-match entry carries `matchId` (its
   scorecard opens from it); an over's also its `balls`. The Teams section
   leads with `facts` (batting first v chasing, the toss). Player records
   skip "no names" matches and placeholders; team records count every match,
   result-only ones too. opts: aggregatePlayerStats' { keyOf, nameOf } --
   career tallies are per player key, so two people with one name are two
   entries. */
const RECORDS_TOP = 3;
const RECORD_MIN_SR_BALLS = 10;      // best strike rate in an innings
const RECORD_MIN_PHASE_BALLS = 12;   // a career strike rate in the opening / death overs
const RECORD_MIN_DECIDED = 5;        // lucky charm / tough luck: matches with a winner
const FASTEST_MARKS = [25, 50, 100];
function recordPlaces(entries, dir){
  const sorted = entries.sort((a, b) => (dir === "asc" ? a.value - b.value : b.value - a.value)
    || (b.sub || 0) - (a.sub || 0) || a.name.localeCompare(b.name));
  sorted.forEach((e, i) => { e.place = i && sorted[i - 1].value === e.value ? sorted[i - 1].place : i + 1; });
  return sorted.filter(e => e.place <= RECORDS_TOP);
}
function computeRecords(matches, opts){
  const totals = aggregatePlayerStats(matches, null, opts);
  const counted = countedMatches(matches);
  const keyOf = linkedKeyOf(counted, opts && opts.keyOf);
  const byKey = {}, names = {};
  totals.forEach(t => { byKey[t.key] = t; names[t.key] = t.name; });
  const nameOfKey = k => names[k] || String(k).replace(/^name:/, "");
  // A career tally; `over` says what it was made in, [count, words] (fewer ranks first among equals).
  const most = (value, over) => recordPlaces(totals.map(t => { const [n, detail] = over(t); return { name: t.name, key: t.key, value: value(t), sub: -n, detail }; })
    .filter(e => e.value > 0));
  const batInns = t => [t.innings, plural(t.innings, "innings", "innings")];
  const bowlInns = t => [t.bowlInnings, plural(t.bowlInnings, "innings", "innings")];
  const played = t => [t.matches, plural(t.matches, "match", "matches")];
  // Per-key tallies these records need on top of the totals.
  const tally = {};
  const bump = (k, f, by) => { const x = tally[k] || (tally[k] = {}); x[f] = (x[f] || 0) + (by == null ? 1 : by); };
  const tallied = (f, detail, dir, extra) => recordPlaces(Object.keys(tally).filter(k => (tally[k][f] || 0) > 0)
    .map(k => Object.assign({ name: nameOfKey(k), key: k, value: tally[k][f], detail: detail ? detail(k, byKey[k]) : "" }, extra ? extra(k) : {})), dir);
  const bowled = {}, high = [], low = [], hs = [], bb = [], sixes = [], hit = [], conceded = [];
  const fastest = { 25: [], 50: [], 100: [] }, bestSR = [], openerHS = [], finishes = [], econ = [];
  const catchesMatch = [], dismInnings = [], partHigh = [], byWicket = {}, pairs = {}, combos = {};
  const bigRuns = [], bigWkts = [], bigBalls = [], closeRuns = [], closeBalls = [], chases = [], defended = [], aggregate = [], extras = [];
  const facts = { decided: 0, batFirst: 0, chase: 0, tossDecided: 0, tossWon: 0 };
  const decided = {};
  matches.forEach(m => {
    if (!m || !Array.isArray(m.innings)) return;
    const matchId = m.id || null;
    const [i1, i2] = m.innings;
    // How the match was won (every match, "no names" and result-only too).
    if (i1 && i2 && !m.forfeited && m.status === "complete"){
      const bpo = m.ballsPerOver || i2.ballsPerOver || 6;
      const A = teamName(m, i1.battingTeam), B = teamName(m, i2.battingTeam);
      const score = inn => `${inn.runs}-${inn.wickets}`;
      aggregate.push({ name: `${m.teamA} v ${m.teamB}`, value: i1.runs + i2.runs, detail: `${A} ${score(i1)} · ${B} ${score(i2)}`, matchId });
      if (i2.runs > i1.runs){
        facts.decided += 1; facts.chase += 1;
        const wl = i2.maxWickets != null ? i2.maxWickets - i2.wickets : null;
        const bl = i2.oversLimit != null && i2.legalBalls != null ? i2.oversLimit * bpo - i2.legalBalls : null;
        const detail = `v ${A} · ${score(i2)} chasing ${i1.runs}`;
        if (wl != null) bigWkts.push({ name: B, value: wl, sub: bl || 0, text: plural(wl, "wicket"), detail, matchId });
        if (bl != null){
          bigBalls.push({ name: B, value: bl, sub: wl || 0, text: `${plural(bl, "ball")} left`, detail, matchId });
          closeBalls.push({ name: B, value: bl, sub: -(wl || 0), text: `${plural(bl, "ball")} left`, detail, matchId });
        }
        chases.push({ name: B, value: i2.runs, sub: bl || 0, text: score(i2), detail: `chasing ${i1.runs} v ${A}${bl != null ? ` · ${plural(bl, "ball")} left` : ""}`, matchId });
      } else if (i1.runs > i2.runs){
        facts.decided += 1; facts.batFirst += 1;
        const margin = i1.runs - i2.runs, detail = `v ${B} · ${score(i1)} to ${score(i2)}`;
        bigRuns.push({ name: A, value: margin, text: plural(margin, "run"), detail, matchId });
        closeRuns.push({ name: A, value: margin, text: plural(margin, "run"), detail, matchId });
        defended.push({ name: A, value: i1.runs, text: score(i1), detail: `v ${B}, who made ${score(i2)}`, matchId });
      }
      const w = inningsWinnerKey(m);
      if (w && m.tossWinner){ facts.tossDecided += 1; if (m.tossWinner === w) facts.tossWon += 1; }
    }
    const excluded = playerStatsExcluded(m);
    const catchesHere = {};
    m.innings.forEach((inn, idx) => {
      const team = teamName(m, inn.battingTeam), opp = teamName(m, inn.bowlingTeam), bpo = inn.ballsPerOver || 6;
      const ov = inn.legalBalls != null ? ` · ${oversDisplay(inn.legalBalls, bpo)} ov` : "";
      const total = { name: team, value: inn.runs, text: `${inn.runs}-${inn.wickets}`, detail: `v ${opp}${ov}${inn.completeReason === "allout" ? " · all out" : ""}`, matchId };
      if (inn.runs > 0) high.push(Object.assign({}, total, { sub: -(inn.legalBalls || 0) }));
      if (!m.forfeited && inn.complete && (inn.completeReason === "allout" || inn.completeReason === "overs")) low.push(Object.assign({}, total, { sub: -(inn.legalBalls || 0) }));
      if (!m.resultOnly && inn.extras){
        const e = inn.extras, n = e.wides + e.noBalls + e.byes + e.legByes;
        if (n > 0) extras.push({ name: opp, value: n, detail: `to ${team} · w ${e.wides}, nb ${e.noBalls}, b ${e.byes}, lb ${e.legByes}`, matchId });
      }
      if (excluded || !inn.batting) return;
      // Batting: one innings' bests, and the tallies behind openers, finishers.
      const chaseWon = idx === 1 && i1 && inn.runs > i1.runs && !m.forfeited;
      inn.batting.order.forEach((n, pos) => {
        const b = inn.batting.stats[n];
        if (isUnnamedPlayer(n)) return;
        const k = keyOf(m, n), line = `${b.runs}${b.out ? "" : "*"} (${b.balls})`;
        if (b.runs > 0) hs.push({ name: n, value: b.runs, sub: (b.out ? 0 : 1000) - b.balls, text: `${b.runs}${b.out ? "" : "*"}`, detail: `${plural(b.balls, "ball")} · v ${opp}`, matchId });
        if (b.sixes > 0) sixes.push({ name: n, value: b.sixes, sub: -b.balls, detail: `${line} · v ${opp}`, matchId });
        if (b.balls >= RECORD_MIN_SR_BALLS && b.runs > 0) bestSR.push({ name: n, value: Math.round(b.runs / b.balls * 1000) / 10, sub: b.runs, text: (b.runs / b.balls * 100).toFixed(1), detail: `${line} · v ${opp}`, matchId });
        if (pos < 2){
          bump(k, "openRuns", b.runs); bump(k, "openInns");
          if (b.runs > 0) openerHS.push({ name: n, value: b.runs, sub: (b.out ? 0 : 1000) - b.balls, text: `${b.runs}${b.out ? "" : "*"}`, detail: `${plural(b.balls, "ball")} · v ${opp}`, matchId });
        }
        if (chaseWon && !b.out && !b.retired){
          bump(k, "finished");
          if (b.runs > 0) finishes.push({ name: n, value: b.runs, sub: -b.balls, text: `${b.runs}*`, detail: `${plural(b.balls, "ball")} · chasing ${i1.runs} v ${opp}`, matchId });
        }
      });
      // Ball by ball: the fastest 25 / 50 / 100, and the opening and death overs.
      if (inningsBallData(inn)){
        const ph = inningsPhases(inn);
        const runs = {}, balls = {}, reached = {};
        forEachBall(inn, b => {
          const n = b.ev.batter;
          if (isUnnamedPlayer(n)) return;
          const before = runs[n] || 0, add = eventBatRuns(b.ev);
          runs[n] = before + add;
          if (b.faced) balls[n] = (balls[n] || 0) + 1;
          FASTEST_MARKS.forEach(x => { if (before < x && runs[n] >= x) (reached[n] || (reached[n] = {}))[x] = balls[n] || 0; });
          const p = phaseOf(ph, b.over);
          if (p === "open" || p === "death"){
            const k = keyOf(m, n);
            bump(k, "phase_" + p + "Runs", add);
            if (b.faced) bump(k, "phase_" + p + "Balls");
          }
        });
        Object.keys(reached).forEach(n => {
          const s = inn.batting.stats[n];
          Object.keys(reached[n]).forEach(x => fastest[x].push({ name: n, value: reached[n][x], sub: s.runs, text: plural(reached[n][x], "ball"),
            detail: `${s.runs}${s.out ? "" : "*"} (${s.balls}) · v ${opp}`, matchId }));
        });
      }
      // Bowling: one innings' bests, hat-tricks, how the wickets came.
      const bx = inningsBowlerExtras(inn);
      inn.bowling.order.forEach(n => {
        const b = inn.bowling.stats[n];
        if (isUnnamedPlayer(n)) return;
        const k = keyOf(m, n), figs = `${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}`;
        if (b.wickets) bb.push({ name: n, value: b.wickets * 1000 - b.runs, sub: -b.legalBalls, text: `${b.wickets}/${b.runs}`, detail: `${oversDisplay(b.legalBalls, bpo)} ov · v ${team}`, matchId });
        // One full over is enough (club games are 4-6 overs); among equal economies the longer spell, then more wickets, first.
        if (b.legalBalls >= bpo) econ.push({ name: n, value: Math.round(b.runs / (b.legalBalls / bpo) * 100) / 100, sub: b.legalBalls * 100 + b.wickets, text: (b.runs / (b.legalBalls / bpo)).toFixed(2), detail: `${figs} · v ${team}`, matchId });
        const h = Math.floor((bx[n] && bx[n].hatTricks) || 0);
        if (h) bump(k, "hatTricks", h);
      });
      inn.batting.order.forEach(n => {
        const s = inn.batting.stats[n];
        if (!s || !s.out) return;
        const how = howOutParts(s.howOut, inn.bowling.order);
        if (!how || isUnnamedPlayer(how.bowler)) return;
        const bk = keyOf(m, how.bowler);
        bump(bk, "w_" + how.type);
        if (how.fielder && (how.type === "caught" || how.type === "stumped") && !isUnnamedPlayer(how.fielder)){
          const fk = keyOf(m, how.fielder), id = fk + "\u0001" + bk;
          const c = combos[id] || (combos[id] = { fielder: fk, bowler: bk, caught: 0, stumped: 0, f: how.fielder, b: how.bowler });
          c[how.type] += 1;
        }
      });
      // Fielding: one innings, one match.
      (inn.fielding ? inn.fielding.order : []).forEach(n => {
        const f = inn.fielding.stats[n];
        if (isUnnamedPlayer(n) || !f) return;
        const ct = f.catches || 0, st = f.stumpings || 0, ro = f.runouts || 0;
        if (ct + st + ro > 0) dismInnings.push({ name: n, value: ct + st + ro, sub: ct, detail: `${[ct ? `${ct} ct` : "", st ? `${st} st` : "", ro ? `${ro} ro` : ""].filter(Boolean).join(", ")} · v ${team}`, matchId });
        if (ct) catchesHere[n] = (catchesHere[n] || 0) + ct;
      });
      // Partnerships.
      (inningsPartnerships(inn) || []).forEach(p => {
        if (p.batters.length !== 2 || p.batters.some(isUnnamedPlayer)) return;
        const name = `${p.batters[0]} & ${p.batters[1]}`;
        const e = { name, value: p.runs, sub: -p.balls, text: `${p.runs}${p.unbroken ? "*" : ""}`, wicket: p.wicket,
          detail: `${ordinalText(p.wicket)} wicket · ${plural(p.balls, "ball")} · v ${opp}`, matchId };
        if (p.runs > 0) partHigh.push(e);
        (byWicket[p.wicket] || (byWicket[p.wicket] = [])).push(Object.assign({}, e, { detail: `${plural(p.balls, "ball")} · v ${opp}` }));
        const ks = p.batters.map(n => keyOf(m, n)).sort(), id = ks.join("\u0001");
        const x = pairs[id] || (pairs[id] = { keys: ks, labels: p.batters, runs: 0, count: 0, best: 0 });
        x.runs += p.runs; x.count += 1; x.best = Math.max(x.best, p.runs);
      });
      // Overs, numbered from the legal balls before them (as in inningsCommentary).
      let ballsSoFar = 0;
      inningsOverList(inn).forEach(o => {
        if (o.gap){ ballsSoFar = o.gap.toBalls; return; }
        const evs = o.events || [];
        if (!evs.length) return;
        const over = Math.floor(ballsSoFar / bpo) + 1;
        const bowler = o.bowler && !isUnnamedPlayer(o.bowler) ? o.bowler : null;
        const bumpBowled = f => { const pk = keyOf(m, bowler); const x = bowled[pk] || (bowled[pk] = { wides: 0, noBalls: 0, name: bowler }); x[f] += 1; };
        let runs = 0;
        const byBatter = {};
        evs.forEach(ev => {
          const c = commentaryEvent(ev);
          if (c.kind !== "wide" && c.kind !== "noball" && !c.extra) ballsSoFar += 1;
          if (c.kind !== "bye" && c.kind !== "legbye") runs += ev.runs || 0;
          if (ev.batter && !isUnnamedPlayer(ev.batter)) byBatter[ev.batter] = (byBatter[ev.batter] || 0) + eventBatRuns(ev);
          if (bowler && (c.kind === "wide" || c.extra === "wide")) bumpBowled("wides");
          if (bowler && (c.kind === "noball" || c.extra === "noball")) bumpBowled("noBalls");
        });
        const chips = evs.map(e => ({ display: e.display, runs: e.runs || 0, isWicket: !!e.isWicket }));
        if (bowler && runs > 0) conceded.push({ name: bowler, value: runs, detail: `v ${team} · over ${over}`, matchId, balls: chips });
        Object.keys(byBatter).forEach(n => {
          if (byBatter[n] > 0) hit.push({ name: n, value: byBatter[n], detail: `${bowler ? `off ${bowler}, ` : ""}v ${opp} · over ${over}`, matchId, balls: chips });
        });
      });
    });
    if (excluded) return;
    Object.keys(catchesHere).forEach(n => catchesMatch.push({ name: n, value: catchesHere[n], detail: `v ${teamName(m, playerTeamInMatch(m, n) === "A" ? "B" : "A")}`, matchId }));
    // Awards: player of the match, and who was on the winning side.
    if (m.motm && !isUnnamedPlayer(m.motm)) bump(keyOf(m, m.motm), "pom");
    const winner = m.status === "complete" ? matchWinnerKey(m) : null;
    if (winner){
      const seen = new Set();
      matchPlayerNames(m).forEach(n => {
        if (isUnnamedPlayer(n)) return;
        const k = keyOf(m, n), side = playerTeamInMatch(m, n);
        if (!side || seen.has(k)) return;
        seen.add(k);
        const d = decided[k] || (decided[k] = { n: 0, won: 0 });
        d.n += 1; if (side === winner) d.won += 1;
      });
    }
  });
  const bowledMost = f => recordPlaces(Object.keys(bowled).filter(pk => bowled[pk][f] > 0).map(pk => {
    const t = byKey[pk], inns = t ? t.bowlInnings : 0;
    return { name: t ? t.name : bowled[pk].name, key: pk, value: bowled[pk][f], sub: -inns, detail: plural(inns, "innings", "innings") };
  }));
  const phaseSR = p => recordPlaces(Object.keys(tally).filter(k => (tally[k]["phase_" + p + "Balls"] || 0) >= RECORD_MIN_PHASE_BALLS).map(k => {
    const r = tally[k]["phase_" + p + "Runs"] || 0, b = tally[k]["phase_" + p + "Balls"];
    return { name: nameOfKey(k), key: k, value: Math.round(r / b * 1000) / 10, sub: b, text: (r / b * 100).toFixed(1), detail: `${r} off ${plural(b, "ball")}` };
  }));
  const wicketsBy = type => tallied("w_" + type, (k, t) => t ? plural(t.wickets, "wicket") + " in all" : "");
  const luck = dir => recordPlaces(Object.keys(decided).filter(k => decided[k].n >= RECORD_MIN_DECIDED).map(k => {
    const d = decided[k], pct = Math.round(d.won / d.n * 100);
    return { name: nameOfKey(k), key: k, value: pct, sub: d.n, text: `${pct}%`, detail: `won ${d.won} of ${d.n}` };
  }), dir);
  const walls = Object.keys(byWicket).map(Number).sort((a, b) => a - b).map(w => {
    const best = byWicket[w].filter(e => e.value > 0).sort((a, b) => b.value - a.value || (b.sub || 0) - (a.sub || 0))[0];
    return best ? Object.assign(best, { place: w, wicket: w }) : null;
  }).filter(Boolean);
  const together = recordPlaces(Object.values(pairs).filter(p => p.runs > 0).map(p => ({
    name: p.keys.map((k, i) => names[k] || p.labels[i]).join(" & "), keys: p.keys, value: p.runs, sub: p.count,
    detail: `${plural(p.count, "partnership")} · best ${p.best}` })));
  const fielderPairs = recordPlaces(Object.values(combos).map(c => {
    const fn = names[c.fielder] || c.f, bn = names[c.bowler] || c.b, n = c.caught + c.stumped;
    return { name: c.fielder === c.bowler ? `c & b ${bn}` : `${c.stumped && !c.caught ? "st" : "c"} ${fn} b ${bn}`, value: n,
      detail: [c.caught ? plural(c.caught, "catch", "catches") : "", c.stumped ? plural(c.stumped, "stumping") : ""].filter(Boolean).join(", ") };
  }));
  const ups = computeMatchups(matches, Object.assign({}, opts, { names }));
  const runsOff = recordPlaces(ups.filter(p => p.runs > 0).map(p => ({ name: `${p.batterName} v ${p.bowlerName}`, value: p.runs, sub: -p.balls,
    detail: `${plural(p.balls, "ball")} · ${p.outs ? `out ${p.outs === 1 ? "once" : `${p.outs} times`}` : "never out"}` })));
  const outsOf = recordPlaces(ups.filter(p => p.outs > 0).map(p => ({ name: `${p.bowlerName} v ${p.batterName}`, value: p.outs, sub: -p.runs,
    text: plural(p.outs, "time"), detail: p.balls ? `${p.runs} runs off ${plural(p.balls, "ball")}` : `in ${plural(p.matches, "match", "matches")}` })));
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : "—";
  return [
    { key: "bat", title: "Batting", records: [
      { key: "runs", label: "Most runs", tile: true, entries: most(t => t.runs, batInns) },
      { key: "fours", label: "Most fours", tile: true, entries: most(t => t.fours, batInns) },
      { key: "sixes", label: "Most sixes", tile: true, entries: most(t => t.sixes, batInns) },
      { key: "fifties", label: "Most fifties", tile: true, entries: most(t => t.fifties, batInns) },
      { key: "hundreds", label: "Most hundreds", tile: true, entries: most(t => t.hundreds, batInns) },
      { key: "ducks", label: "Most ducks", tile: true, bad: true, entries: most(t => t.ducks, batInns) },
      { key: "openRuns", label: "Most runs as an opener", tile: true, entries: tallied("openRuns", k => plural(tally[k].openInns || 0, "innings", "innings")) },
      { key: "finished", label: "Most chases finished", tile: true, note: "not out when the chase was won", entries: tallied("finished", (k, t) => t ? plural(t.innings, "innings", "innings") : "") },
      { key: "srOpen", label: "Best strike rate · opening overs", tile: true, note: `${RECORD_MIN_PHASE_BALLS}+ balls`, entries: phaseSR("open") },
      { key: "srDeath", label: "Best strike rate · death overs", tile: true, note: `${RECORD_MIN_PHASE_BALLS}+ balls`, entries: phaseSR("death") },
      { key: "highScore", label: "Highest score", entries: recordPlaces(hs) },
      { key: "fastest25", label: "Fastest 25", dir: "asc", entries: recordPlaces(fastest[25], "asc") },
      { key: "fastest50", label: "Fastest fifty", dir: "asc", entries: recordPlaces(fastest[50], "asc") },
      { key: "fastest100", label: "Fastest hundred", dir: "asc", entries: recordPlaces(fastest[100], "asc") },
      { key: "bestSR", label: "Best strike rate in an innings", note: `${RECORD_MIN_SR_BALLS}+ balls`, entries: recordPlaces(bestSR) },
      { key: "openerHigh", label: "Highest score as an opener", entries: recordPlaces(openerHS) },
      { key: "bestFinish", label: "Best finish", note: "not out, winning the chase", entries: recordPlaces(finishes) },
      { key: "inningsSixes", label: "Most sixes in an innings", entries: recordPlaces(sixes) },
      { key: "overHit", label: "Most runs hit in an over", entries: recordPlaces(hit) }] },
    { key: "bowl", title: "Bowling", records: [
      { key: "wickets", label: "Most wickets", tile: true, entries: most(t => t.wickets, bowlInns) },
      { key: "maidens", label: "Most maidens", tile: true, entries: most(t => t.maidens, bowlInns) },
      { key: "dots", label: "Most dot balls", tile: true, entries: most(t => t.dots, bowlInns) },
      { key: "hatTricks", label: "Most hat-tricks", tile: true, entries: tallied("hatTricks", (k, t) => t ? plural(t.bowlInnings, "innings", "innings") : "") },
      { key: "bowledW", label: "Most bowled", tile: true, entries: wicketsBy("bowled") },
      { key: "lbwW", label: "Most LBWs", tile: true, entries: wicketsBy("lbw") },
      { key: "caughtW", label: "Most wickets caught", tile: true, entries: wicketsBy("caught") },
      { key: "stumpedW", label: "Most stumped", tile: true, entries: wicketsBy("stumped") },
      { key: "wides", label: "Most wides", tile: true, bad: true, entries: bowledMost("wides") },
      { key: "noBalls", label: "Most no-balls", tile: true, bad: true, entries: bowledMost("noBalls") },
      { key: "bestBowling", label: "Best bowling", entries: recordPlaces(bb) },
      { key: "bestEcon", label: "Best economy in an innings", dir: "asc", note: "a full over or more", entries: recordPlaces(econ, "asc") },
      { key: "overConceded", label: "Most runs conceded in an over", bad: true, entries: recordPlaces(conceded) }] },
    { key: "field", title: "Fielding", records: [
      { key: "catches", label: "Most catches", tile: true, entries: most(t => t.catches, played) },
      { key: "runouts", label: "Most run-outs", tile: true, entries: most(t => t.runouts, played) },
      { key: "stumpings", label: "Most stumpings", tile: true, entries: most(t => t.stumpings || 0, played) },
      { key: "catchesMatch", label: "Most catches in a match", entries: recordPlaces(catchesMatch) },
      { key: "dismInnings", label: "Most dismissals in an innings", note: "catches, stumpings, run-outs", entries: recordPlaces(dismInnings) },
      { key: "fielderBowler", label: "Bowler and fielder", note: "caught or stumped off the same bowler", entries: fielderPairs }] },
    { key: "partner", title: "Partnerships", records: [
      { key: "partnership", label: "Highest partnership", entries: recordPlaces(partHigh) },
      { key: "byWicket", label: "Best for each wicket", byWicket: true, entries: walls },
      { key: "together", label: "Most runs together", entries: together }] },
    { key: "matchups", title: "Match-ups", records: [
      { key: "runsOff", label: "Most runs off one bowler", entries: runsOff },
      { key: "outsOf", label: "Most dismissals of one batter", entries: outsOf }] },
    { key: "team", title: "Teams",
      facts: [
        facts.decided ? { key: "batFirst", label: "Batting first", value: pct(facts.batFirst, facts.decided), detail: `won ${facts.batFirst} of ${facts.decided}` } : null,
        facts.decided ? { key: "chase", label: "Chasing", value: pct(facts.chase, facts.decided), detail: `won ${facts.chase} of ${facts.decided}` } : null,
        facts.tossDecided ? { key: "toss", label: "Won the toss", value: pct(facts.tossWon, facts.tossDecided), detail: `won ${facts.tossWon} of ${facts.tossDecided}` } : null
      ].filter(Boolean),
      records: [
      { key: "highTotal", label: "Highest total", entries: recordPlaces(high) },
      { key: "lowTotal", label: "Lowest total", dir: "asc", bad: true, entries: recordPlaces(low, "asc") },
      { key: "bigWinRuns", label: "Biggest win by runs", entries: recordPlaces(bigRuns) },
      { key: "bigWinWickets", label: "Biggest win by wickets", entries: recordPlaces(bigWkts) },
      { key: "bigWinBalls", label: "Most balls to spare", entries: recordPlaces(bigBalls) },
      { key: "closeRuns", label: "Narrowest win by runs", dir: "asc", entries: recordPlaces(closeRuns, "asc") },
      { key: "closeBalls", label: "Closest chase", dir: "asc", note: "fewest balls to spare", entries: recordPlaces(closeBalls, "asc") },
      { key: "highChase", label: "Highest chase", entries: recordPlaces(chases) },
      { key: "lowDefended", label: "Lowest total defended", dir: "asc", entries: recordPlaces(defended, "asc") },
      { key: "aggregate", label: "Most runs in a match", entries: recordPlaces(aggregate) },
      { key: "extras", label: "Most extras in an innings", bad: true, entries: recordPlaces(extras) }] },
    { key: "awards", title: "Awards", records: [
      { key: "pom", label: "Most player of the match", tile: true, entries: tallied("pom", (k, t) => t ? plural(t.matches, "match", "matches") : "") },
      { key: "matches", label: "Most matches", tile: true, entries: recordPlaces(totals.filter(t => t.matches > 0).map(t => ({ name: t.name, key: t.key, value: t.matches, detail: "" }))) },
      { key: "luckyCharm", label: "Lucky charm", tile: true, note: `best win rate · ${RECORD_MIN_DECIDED}+ matches`, entries: luck() },
      { key: "toughLuck", label: "Tough luck", tile: true, dir: "asc", bad: true, note: `fewest wins · ${RECORD_MIN_DECIDED}+ matches`, entries: luck("asc") }] }
  ];
}

// --- the honours board -----------------------------------------------------
/* Every 50 (and 100), every 3-wicket haul and every hat-trick, newest
   first, each with its match: { batting, bowling, hatTricks }, entries
   { name, key, text, detail, matchId, at, big } (`big`: a hundred / a
   five-for). Names are the player's current one where it's known. */
const HONOURS_RUNS = 50, HONOURS_WICKETS = 3;
function computeHonours(matches, opts){
  const o = opts || {};
  const counted = countedMatches(matches);
  const keyOf = linkedKeyOf(counted, o.keyOf);
  const names = o.names || playerNamesByKey(counted, o);
  const batting = [], bowling = [], hatTricks = [];
  counted.forEach(m => m.innings.forEach(inn => {
    if (!inn.batting) return;
    const bat = teamName(m, inn.battingTeam), bowl = teamName(m, inn.bowlingTeam), bpo = inn.ballsPerOver || 6;
    const base = n => { const k = keyOf(m, n); return { name: names[k] || n, key: k, matchId: m.id || null, at: m.completedAt || 0 }; };
    inn.batting.order.forEach(n => {
      const s = inn.batting.stats[n];
      if (isUnnamedPlayer(n) || s.runs < HONOURS_RUNS) return;
      batting.push(Object.assign(base(n), { value: s.runs, text: `${s.runs}${s.out ? "" : "*"}`, big: s.runs >= 100,
        detail: `${plural(s.balls, "ball")} · for ${bat} v ${bowl}` }));
    });
    const bx = inningsBowlerExtras(inn);
    inn.bowling.order.forEach(n => {
      const b = inn.bowling.stats[n];
      if (isUnnamedPlayer(n)) return;
      if (b.wickets >= HONOURS_WICKETS) bowling.push(Object.assign(base(n), { value: b.wickets, text: `${b.wickets}/${b.runs}`, big: b.wickets >= 5,
        detail: `${oversDisplay(b.legalBalls, bpo)} ov · for ${bowl} v ${bat}` }));
      if (bx[n] && bx[n].hatTricks >= 1) hatTricks.push(Object.assign(base(n), { value: 1, text: "Hat-trick", big: true,
        detail: `${b.wickets}/${b.runs} · for ${bowl} v ${bat}` }));
    });
  }));
  const newest = list => list.sort((a, b) => b.at - a.at || b.value - a.value);
  return { batting: newest(batting), bowling: newest(bowling), hatTricks: newest(hatTricks) };
}

// --- ratings ---------------------------------------------------------------
/* A batting and a bowling rating per player over `matches`, that moves with
   form: each innings is scored against these matches' own averages, and the
   rating is their weighted average with recent innings counting most (each
   older one RATING_DECAY as much), so it means the same in a 5-over club
   game and a T20. 500 is an average player here; it builds up over a
   player's first RATING_RAMP innings, so one big score doesn't top it.
   - Batting: runs, scaled by the square root of strike rate against the
     average strike rate here (between half and double).
   - Bowling: each wicket is worth the runs a wicket costs here, plus the
     runs saved (or given away) against the average economy, never below 0.
   { [key]: { bat, bowl, batInns, bowlInns } } (bat/bowl null when they
   haven't batted / bowled). */
const RATING_DECAY = 0.85, RATING_RAMP = 5, RATING_MID = 500;
function playerRatings(matches, opts){
  const counted = countedMatches(matches).filter(m => !m.resultOnly)
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
  const keyOf = linkedKeyOf(counted, opts && opts.keyOf);
  let br = 0, bb = 0, wr = 0, wb = 0, ww = 0;
  const each = fn => counted.forEach(m => m.innings.forEach(inn => {
    if (!inn.batting) return;
    inn.batting.order.forEach(n => { if (!isUnnamedPlayer(n)) fn("bat", m, n, inn.batting.stats[n]); });
    inn.bowling.order.forEach(n => { const b = inn.bowling.stats[n]; if (!isUnnamedPlayer(n) && b.legalBalls > 0) fn("bowl", m, n, b); });
  }));
  each((kind, m, n, s) => { if (kind === "bat"){ br += s.runs; bb += s.balls; } else { wr += s.runs; wb += s.legalBalls; ww += s.wickets; } });
  const rpb = bb ? br / bb : 1, conc = wb ? wr / wb : 1, worth = ww ? wr / ww : 20;
  const perf = (kind, s) => kind === "bat"
    ? s.runs * Math.sqrt(Math.min(2, Math.max(0.5, s.balls && rpb ? (s.runs / s.balls) / rpb : 1)))
    : Math.max(0, s.wickets * worth + (conc * s.legalBalls - s.runs));
  const mean = { bat: [0, 0], bowl: [0, 0] };
  each((kind, m, n, s) => { mean[kind][0] += perf(kind, s); mean[kind][1] += 1; });
  const avg = { bat: mean.bat[1] ? mean.bat[0] / mean.bat[1] : 0, bowl: mean.bowl[1] ? mean.bowl[0] / mean.bowl[1] : 0 };
  const run = {};
  each((kind, m, n, s) => {
    const k = keyOf(m, n), r = run[k] || (run[k] = { bat: [0, 0, 0], bowl: [0, 0, 0] }), x = r[kind];
    x[0] = x[0] * RATING_DECAY + perf(kind, s); x[1] = x[1] * RATING_DECAY + 1; x[2] += 1;
  });
  const out = {};
  Object.keys(run).forEach(k => {
    const rate = kind => { const x = run[k][kind]; return x[2] && avg[kind] > 0 ? Math.round(RATING_MID * (x[0] / x[1]) / avg[kind] * Math.min(1, x[2] / RATING_RAMP)) : null; };
    out[k] = { bat: rate("bat"), bowl: rate("bowl"), batInns: run[k].bat[2], bowlInns: run[k].bowl[2] };
  });
  return out;
}
/* The last `n` innings of each player over `matches` (newest first):
   { [key]: { bat: [{ runs, out, balls }], bowl: [{ wickets, runs }] } }, for
   the leaderboards' "Last 5" columns. */
function playerRecentForm(matches, opts, n){
  const count = n || 5;
  const counted = countedMatches(matches).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const keyOf = linkedKeyOf(counted, opts && opts.keyOf);
  const out = {};
  const slot = k => out[k] || (out[k] = { bat: [], bowl: [] });
  counted.forEach(m => m.innings.forEach(inn => {
    if (!inn.batting) return;
    inn.batting.order.forEach(nm => {
      if (isUnnamedPlayer(nm)) return;
      const s = inn.batting.stats[nm], x = slot(keyOf(m, nm));
      if (x.bat.length < count) x.bat.push({ runs: s.runs, out: !!s.out, balls: s.balls });
    });
    inn.bowling.order.forEach(nm => {
      const b = inn.bowling.stats[nm];
      if (isUnnamedPlayer(nm) || !(b.legalBalls > 0 || b.wickets > 0)) return;
      const x = slot(keyOf(m, nm));
      if (x.bowl.length < count) x.bowl.push({ wickets: b.wickets, runs: b.runs });
    });
  }));
  return out;
}

// --- one player's history --------------------------------------------------
/* `who` everywhere below is as in playerCareer: playerWho(id, names, keyOf),
   a name, names, or a test. */
/* Their last `n` innings with the bat and the ball, newest first: { bat:
   [{ runs, out, balls, matchId }], bowl: [{ wickets, runs, legalBalls,
   ballsPerOver, matchId }] } -- the form guide. */
function playerForm(who, matches, n){
  const count = n || 5;
  const lines = playerMatchLines(who, matches);
  return {
    bat: lines.filter(l => l.bat).slice(0, count).map(l => Object.assign({ matchId: l.match.id || null }, l.bat)),
    bowl: lines.filter(l => l.bowl && (l.bowl.legalBalls > 0 || l.bowl.wickets > 0)).slice(0, count).map(l => Object.assign({ matchId: l.match.id || null }, l.bowl))
  };
}
/* Their career over time, oldest first, one point per match: { n, matchId,
   at, runs, wickets (running totals), average (running batting average, null
   until they're out), score (that match's runs or null), taken }. */
function playerCareerSeries(who, matches){
  const lines = playerMatchLines(who, matches).slice().reverse();
  let runs = 0, wickets = 0, outs = 0;
  return lines.map((l, i) => {
    if (l.bat){ runs += l.bat.runs; if (l.bat.out) outs += 1; }
    if (l.bowl) wickets += l.bowl.wickets;
    return { n: i + 1, matchId: l.match.id || null, at: l.match.completedAt || null, runs, wickets,
      average: outs ? runs / outs : null, score: l.bat ? l.bat.runs : null, taken: l.bowl ? l.bowl.wickets : null };
  });
}
/* Career milestones: the first match, the first 50 / 100, the first 3- and
   5-wicket hauls, every hat-trick, the first player of the match award, and
   the round numbers of runs, wickets and matches (RUN_/WICKET_/MATCH_
   MILESTONES), each with the match it came in. Newest first: [{ kind, text,
   detail, matchId, at, n (their nth match), match, sofar }] --
   `match`: what they did in that match ({ line (playerMatchLineText), team,
   opp, result, won (true/false/null), pom }); `sofar`: their career up to and
   including it ({ matches, innings, notOuts, runs, balls, average,
   strikeRate, highScore, fifties, hundreds, bowlInnings, wickets,
   runsConceded, legalBalls, economy, bowlAverage, best, hauls (3+ wickets),
   catches, pom, won, decided }) -- the summary a milestone opens to. */
const RUN_MILESTONES = [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const WICKET_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
const MATCH_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
function nextMilestone(value, list){ return list.find(x => x > value) || null; }
function crossed(before, after, list){ return list.filter(x => before < x && after >= x); }
function playerMilestones(who, matches){
  const lines = playerMatchLines(who, matches).slice().reverse();
  const out = [], firsts = {};
  const so = { matches: 0, innings: 0, notOuts: 0, runs: 0, balls: 0, highScore: null, fifties: 0, hundreds: 0,
    bowlInnings: 0, wickets: 0, runsConceded: 0, legalBalls: 0, best: null, hauls: 0, catches: 0, pom: 0, won: 0, decided: 0 };
  const snapshot = () => {
    const outs = so.innings - so.notOuts;
    return Object.assign({}, so, {
      highScore: so.highScore && Object.assign({}, so.highScore), best: so.best && Object.assign({}, so.best),
      average: outs > 0 ? so.runs / outs : null, strikeRate: so.balls > 0 ? so.runs / so.balls * 100 : null,
      economy: so.legalBalls > 0 ? so.runsConceded / (so.legalBalls / 6) : null, bowlAverage: so.wickets > 0 ? so.runsConceded / so.wickets : null });
  };
  lines.forEach((l, i) => {
    const m = l.match, n = i + 1;
    const opp = l.team ? teamName(m, l.team === "A" ? "B" : "A") : "";
    const vs = opp ? ` v ${opp}` : "";
    const labels = new Set(l.labels || []);
    const runsBefore = so.runs, wicketsBefore = so.wickets;
    // This match into the running totals first: a milestone reached in it counts it.
    so.matches = n;
    if (l.bat){
      so.innings += 1; so.runs += l.bat.runs; so.balls += l.bat.balls;
      if (!l.bat.out) so.notOuts += 1;
      if (!so.highScore || l.bat.runs > so.highScore.runs || (l.bat.runs === so.highScore.runs && !l.bat.out)) so.highScore = { runs: l.bat.runs, out: l.bat.out };
      if (l.bat.runs >= 100) so.hundreds += 1; else if (l.bat.runs >= 50) so.fifties += 1;
    }
    const bowled = l.bowl && (l.bowl.legalBalls > 0 || l.bowl.wickets > 0);
    if (bowled){
      so.bowlInnings += 1; so.wickets += l.bowl.wickets; so.runsConceded += l.bowl.runs; so.legalBalls += l.bowl.legalBalls;
      if (!so.best || l.bowl.wickets > so.best.wickets || (l.bowl.wickets === so.best.wickets && l.bowl.runs < so.best.runs)) so.best = { wickets: l.bowl.wickets, runs: l.bowl.runs };
      if (l.bowl.wickets >= 3) so.hauls += 1;
    }
    if (l.field) so.catches += l.field.catches || 0;
    const pom = !!(m.motm && labels.has(m.motm));
    if (pom) so.pom += 1;
    const winner = m.status === "complete" ? matchWinnerKey(m) : null;
    const won = winner && l.team ? winner === l.team : null;
    if (won !== null){ so.decided += 1; if (won) so.won += 1; }
    const here = { line: playerMatchLineText(l), team: l.team ? teamName(m, l.team) : "", opp, result: m.result || "", won, pom };
    const add = (kind, text, detail) => out.push({ kind, text, detail, matchId: m.id || null, at: m.completedAt || null, n, match: here, sofar: snapshot() });
    const first = (key, kind, text, detail) => { if (!firsts[key]){ firsts[key] = true; add(kind, text, detail); } };
    if (n === 1) add("debut", "First match", `${l.team ? `for ${teamName(m, l.team)}` : ""}${vs}`.trim());
    if (l.bat){
      const line = `${l.bat.runs}${l.bat.out ? "" : "*"} (${l.bat.balls})${vs}`;
      if (l.bat.runs >= 100) first("hundred", "hundred", "First hundred", line);
      else if (l.bat.runs >= 50) first("fifty", "fifty", "First fifty", line);
      crossed(runsBefore, so.runs, RUN_MILESTONES).forEach(x => add("runs", `${x.toLocaleString("en-US")} runs`, `${line} · match ${n}`));
    }
    if (l.bowl){
      const line = `${l.bowl.wickets}/${l.bowl.runs}${vs}`;
      if (l.bowl.wickets >= 5) first("five", "haul", "First five-for", line);
      else if (l.bowl.wickets >= 3) first("three", "haul", "First 3-wicket haul", line);
      crossed(wicketsBefore, so.wickets, WICKET_MILESTONES).forEach(x => add("wickets", `${x} wickets`, `${line} · match ${n}`));
      m.innings.forEach(inn => {
        const bx = inningsBowlerExtras(inn);
        inn.bowling.order.forEach(b => { if (labels.has(b) && bx[b] && bx[b].hatTricks >= 1) add("hatTrick", "Hat-trick", line); });
      });
    }
    if (pom) first("pom", "pom", "First player of the match", vs.trim());
    if (MATCH_MILESTONES.includes(n)) add("matches", `${n} matches`, vs.trim());
  });
  return out.reverse();
}
/* Badges, from a career (playerCareer) and { hatTricks, pom } counts: one
   per family, the highest step reached. [{ id, icon, label, title }]. */
const PLAYER_BADGES = [
  { id: "runs", icon: "🏏", steps: [250, 500, 1000, 2500, 5000], value: c => c.runs, label: n => `${n.toLocaleString("en-US")} runs`, title: n => `Scored ${n.toLocaleString("en-US")} runs` },
  { id: "wickets", icon: "🎯", steps: [10, 25, 50, 100, 200], value: c => c.wickets, label: n => `${n} wickets`, title: n => `Took ${n} wickets` },
  { id: "matches", icon: "🧢", steps: [10, 25, 50, 100, 200], value: c => c.matches, label: n => `${n} matches`, title: n => `Played ${n} matches` },
  { id: "hundred", icon: "💯", steps: [1], value: c => c.hundreds, label: () => "Century", title: () => "Scored a hundred" },
  { id: "fifty", icon: "⭐", steps: [1], value: c => c.hundreds ? 0 : c.fifties, label: () => "Half-century", title: () => "Scored a fifty" },
  { id: "five", icon: "🖐️", steps: [1], value: c => c.best && c.best.wickets >= 5 ? 1 : 0, label: () => "Five-for", title: () => "Took five wickets in an innings" },
  { id: "three", icon: "🔥", steps: [1], value: c => c.best && c.best.wickets >= 3 && c.best.wickets < 5 ? 1 : 0, label: () => "3-wicket haul", title: () => "Took three wickets in an innings" },
  { id: "hattrick", icon: "🎩", steps: [1], value: (c, x) => x.hatTricks || 0, label: () => "Hat-trick", title: () => "Three wickets in three balls" },
  { id: "sixes", icon: "💥", steps: [10, 25, 50, 100], value: c => c.sixes, label: n => `${n} sixes`, title: n => `Hit ${n} sixes` },
  { id: "catches", icon: "🧤", steps: [5, 10, 25, 50], value: c => c.catches, label: n => `${n} catches`, title: n => `Took ${n} catches` },
  { id: "stumpings", icon: "⚡", steps: [3, 10, 25], value: c => c.stumpings || 0, label: n => `${n} stumpings`, title: n => `Made ${n} stumpings` },
  { id: "maiden", icon: "🔒", steps: [1, 5, 10, 25], value: c => c.maidens, label: n => n === 1 ? "Maiden over" : `${n} maidens`, title: n => n === 1 ? "Bowled a maiden over" : `Bowled ${n} maidens` },
  { id: "allrounder", icon: "⚖️", steps: [1], value: c => c.runs >= 250 && c.wickets >= 15 ? 1 : 0, label: () => "All-rounder", title: () => "250 runs and 15 wickets" },
  { id: "pom", icon: "🏆", steps: [1, 5, 10, 25], value: (c, x) => x.pom || 0, label: n => n === 1 ? "Player of the match" : `${n}× player of the match`, title: n => n === 1 ? "Player of the match" : `Player of the match ${n} times` }
];
function playerBadges(career, extra){
  if (!career) return [];
  const x = extra || {};
  return PLAYER_BADGES.map(b => {
    const v = b.value(career, x) || 0;
    const step = b.steps.filter(s => v >= s).pop();
    return step ? { id: b.id, icon: b.icon, label: b.label(step), title: b.title(step), step } : null;
  }).filter(Boolean);
}
// Hat-tricks and player of the match awards over `matches` (what playerBadges needs beyond a career).
function playerHonourCounts(who, matches){
  let hatTricks = 0, pom = 0;
  playerMatchLines(who, matches).forEach(l => {
    const labels = new Set(l.labels || []);
    if (l.match.motm && labels.has(l.match.motm)) pom += 1;
    if (l.bowl) l.match.innings.forEach(inn => {
      const bx = inningsBowlerExtras(inn);
      inn.bowling.order.forEach(b => { if (labels.has(b) && bx[b]) hatTricks += Math.floor(bx[b].hatTricks || 0); });
    });
  });
  return { hatTricks, pom };
}
/* Their batting against each bowler and bowling against each batter over
   `matches` (computeMatchups): { faced: [pairs], bowledAt: [pairs] }, each
   in its "best" order (sortMatchups). `ups`: computeMatchups' result for
   these matches, when the caller has it already. */
function playerMatchups(who, matches, opts, ups){
  const test = playerTestFor(who, matches);
  const counted = countedMatches(matches);
  const keyOf = linkedKeyOf(counted, opts && opts.keyOf);
  const mine = new Set();
  counted.forEach(m => matchPlayerNames(m).forEach(n => { if (test(m, n)) mine.add(keyOf(m, n)); }));
  const all = ups || computeMatchups(matches, opts);
  return {
    faced: sortMatchups(all.filter(p => mine.has(p.batter) && (p.balls > 0 || p.outs > 0)), "faced", "best"),
    bowledAt: sortMatchups(all.filter(p => mine.has(p.bowler) && (p.balls > 0 || p.outs > 0)), "bowledAt", "best")
  };
}
/* The two ways a player's match-ups are read (a new array):
   - batting against bowlers ("faced"): "best" = most runs off them, then the
     fastest scoring, then out the fewest times; "tough" = out the most times
     by them, then the slowest scoring, then the most balls faced.
   - bowling against batters ("bowledAt"): "best" = got them out the most,
     then the fewest runs a ball given away; "tough" = the most runs they've
     taken off you, then the fastest, then out the fewest times.
   A pairing from before ball-by-ball batters has dismissals but no balls:
   its scoring rate counts as unknown (after every known one). */
const MATCHUP_SORT_TEXT = {
  faced: { best: "most runs first", tough: "most times out, then slowest scoring" },
  bowledAt: { best: "most wickets first", tough: "most runs given away first" }
};
function sortMatchups(list, side, mode){
  const rate = p => p.balls > 0 ? p.runs / p.balls : null;
  // lowest / highest first, an unknown rate always last
  const asc = (x, y) => x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : x - y;
  const desc = (x, y) => x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : y - x;
  const cmp = {
    faced: {
      best: (a, b) => b.runs - a.runs || desc(rate(a), rate(b)) || a.outs - b.outs || b.balls - a.balls,
      tough: (a, b) => b.outs - a.outs || asc(rate(a), rate(b)) || b.balls - a.balls
    },
    bowledAt: {
      best: (a, b) => b.outs - a.outs || asc(rate(a), rate(b)) || b.balls - a.balls,
      tough: (a, b) => b.runs - a.runs || desc(rate(a), rate(b)) || a.outs - b.outs
    }
  }[side][mode === "tough" ? "tough" : "best"];
  return (list || []).slice().sort((a, b) => cmp(a, b) || String(side === "faced" ? a.bowlerName : a.batterName).localeCompare(side === "faced" ? b.bowlerName : b.batterName));
}
/* A year in review for one player: their career that year, best innings and
   figures, player of the match awards, the milestones they reached, the
   months they played -- or null if they didn't play that year. `year`: a
   statsPeriodKey ("2026"); a match's year is its tournament's start (as the
   leaderboards' Yearly). */
function playerYearReview(who, matches, year, preset){
  const starts = tournamentStartTimes(matches);
  const inYear = matchesInPeriod(matches, "year", String(year), starts);
  const career = playerCareer(who, inYear, preset);
  if (!career) return null;
  const lines = playerMatchLines(who, inYear);
  const bat = lines.filter(l => l.bat).sort((a, b) => b.bat.runs - a.bat.runs || a.bat.balls - b.bat.balls)[0] || null;
  const bowl = lines.filter(l => l.bowl && l.bowl.wickets > 0).sort((a, b) => b.bowl.wickets - a.bowl.wickets || a.bowl.runs - b.bowl.runs)[0] || null;
  const opp = l => l.team ? teamName(l.match, l.team === "A" ? "B" : "A") : "";
  const ids = new Set(inYear.map(m => m.id).filter(Boolean));
  return {
    year: String(year), career,
    bestBat: bat ? { runs: bat.bat.runs, balls: bat.bat.balls, out: bat.bat.out, opp: opp(bat), matchId: bat.match.id || null } : null,
    bestBowl: bowl ? { wickets: bowl.bowl.wickets, runs: bowl.bowl.runs, opp: opp(bowl), matchId: bowl.match.id || null } : null,
    pom: playerHonourCounts(who, inYear).pom,
    milestones: playerMilestones(who, matches).filter(x => x.matchId && ids.has(x.matchId) && x.kind !== "debut"),
    months: statsPeriods(lines.map(l => l.match), "month", starts).length,
    teams: [...new Set(lines.filter(l => l.team).map(l => teamName(l.match, l.team)))]
  };
}
// The years (newest first) a player played in over `matches`: ["2026", "2025"].
function playerYears(who, matches){
  const starts = tournamentStartTimes(matches);
  return statsPeriods(playerMatchLines(who, matches).map(l => l.match), "year", starts).map(p => p.key);
}
/* Two players side by side: { a, b } careers, the head-to-head both ways
   (a batting to b, b batting to a, from computeMatchups) and the matches
   they played together / against each other. `whoA`/`whoB` as above. */
function playerComparison(whoA, whoB, matches, preset, opts, ups){
  const a = playerCareer(whoA, matches, preset), b = playerCareer(whoB, matches, preset);
  const la = playerMatchLines(whoA, matches), lb = playerMatchLines(whoB, matches);
  const side = new Map(lb.map(l => [l.match, l.team]));
  let together = 0, against = 0, wonA = 0, wonB = 0;
  la.forEach(l => {
    if (!side.has(l.match)) return;
    const tb = side.get(l.match);
    if (!l.team || !tb) return;
    if (l.team === tb) together += 1;
    else {
      against += 1;
      const w = l.match.status === "complete" ? matchWinnerKey(l.match) : null;
      if (w === l.team) wonA += 1; else if (w === tb) wonB += 1;
    }
  });
  const all = ups || computeMatchups(matches, opts);
  const ua = playerMatchups(whoA, matches, opts, all), ub = playerMatchups(whoB, matches, opts, all);
  const keysB = new Set(ub.faced.map(p => p.batter).concat(ub.bowledAt.map(p => p.bowler)));
  const keysA = new Set(ua.faced.map(p => p.batter).concat(ua.bowledAt.map(p => p.bowler)));
  const sum = list => list.reduce((s, p) => ({ runs: s.runs + p.runs, balls: s.balls + p.balls, outs: s.outs + p.outs, dots: s.dots + p.dots }), { runs: 0, balls: 0, outs: 0, dots: 0 });
  return {
    a, b, together, against, wonA, wonB,
    aToB: sum(ua.faced.filter(p => keysB.has(p.bowler))),
    bToA: sum(ub.faced.filter(p => keysA.has(p.bowler)))
  };
}

// --- one match: charts --------------------------------------------------------
/* An innings over by over, in order: [{ over (1-based), runs, wickets, score,
   wkts (at its end), balls (legal balls by its end), bowler, current }], and
   { gap: true, score, wkts, balls } where a catch-up took the score on. */
function inningsOverSeries(inn){
  const bpo = inn.ballsPerOver || 6;
  const out = [];
  let score = 0, wkts = 0, balls = 0;
  inningsOverList(inn).forEach(o => {
    if (o.gap){
      score = o.gap.toRuns; wkts = o.gap.toWickets; balls = o.gap.toBalls;
      out.push({ gap: true, score, wkts, balls, byHand: !!o.gap.byHand });
      return;
    }
    const start = balls;
    let runs = 0, w = 0;
    (o.events || []).forEach(ev => {
      const c = commentaryEvent(ev);
      if (c.kind !== "wide" && c.kind !== "noball" && !c.extra) balls += 1;
      runs += ev.runs || 0;
      if (ev.isWicket) w += 1;
    });
    score += runs; wkts += w;
    out.push({ over: Math.floor(start / bpo) + 1, runs, wickets: w, score, wkts, balls, bowler: o.bowler || null, current: !!o.current, part: start % bpo !== 0 });
  });
  return out;
}

// --- records set in one match ------------------------------------------------
/* What a just-finished match did to the records of the matches it's counted
   with (a club's, this phone's guest matches): every single-match record it
   now holds outright (better than the best before it, not level), and every
   career record whose leader changed to someone who played in it. Nothing
   until there are RECORDS_MIN_HISTORY matches before it, so a new club's
   first games don't all "set records". Records that aren't one to celebrate
   (`bad`: lowest total, ducks...) are left out. [{ section, label, entry,
   career }]. */
const RECORDS_MIN_HISTORY = 5;
const CAREER_LEAD_KEYS = ["runs", "sixes", "fifties", "hundreds", "wickets", "maidens", "hatTricks", "catches", "stumpings", "runouts", "pom"];
function newRecordsIn(match, history, opts){
  if (!match || !match.id || !Array.isArray(match.innings)) return [];
  const before = (history || []).filter(m => m && m.id !== match.id);
  if (before.length < RECORDS_MIN_HISTORY) return [];
  const flat = groups => { const o = {}; groups.forEach(g => g.records.forEach(r => { o[r.key] = r; })); return o; };
  const was = flat(computeRecords(before, opts));
  const now = computeRecords(before.concat([match]), opts);
  const keysHere = new Set();
  const counted = countedMatches(before.concat([match]));
  const keyOf = linkedKeyOf(counted, opts && opts.keyOf);
  if (!playerStatsExcluded(match)) matchPlayerNames(match).forEach(n => keysHere.add(keyOf(match, n)));
  const out = [];
  now.forEach(g => g.records.forEach(r => {
    if (r.bad || r.byWicket) return;
    const top = r.entries[0], old = was[r.key] && was[r.key].entries[0];
    if (!top) return;
    const better = !old || (r.dir === "asc" ? top.value < old.value : top.value > old.value);
    if (!better) return;
    if (top.matchId){
      if (top.matchId === match.id) out.push({ section: g.title, label: r.label, entry: top, career: false });
    } else if (r.tile && CAREER_LEAD_KEYS.includes(r.key) && old && top.key && top.key !== old.key && keysHere.has(top.key)){
      out.push({ section: g.title, label: r.label, entry: top, career: true });
    }
  }));
  return out;
}
/* The bests a match in progress can beat, from the matches it's counted
   with: { highScore, mostWickets, highTotal, inningsSixes } (null where
   there's none yet), or null with fewer than RECORDS_MIN_HISTORY matches. */
function liveRecordMarks(history){
  const list = (history || []).filter(m => m && Array.isArray(m.innings));
  if (list.length < RECORDS_MIN_HISTORY) return null;
  const marks = { highScore: null, mostWickets: null, highTotal: null, inningsSixes: null };
  const up = (k, v) => { if (v > 0 && (marks[k] == null || v > marks[k])) marks[k] = v; };
  list.forEach(m => m.innings.forEach(inn => {
    up("highTotal", inn.runs || 0);
    if (playerStatsExcluded(m) || !inn.batting) return;
    inn.batting.order.forEach(n => { if (!isUnnamedPlayer(n)){ up("highScore", inn.batting.stats[n].runs); up("inningsSixes", inn.batting.stats[n].sixes); } });
    inn.bowling.order.forEach(n => { if (!isUnnamedPlayer(n)) up("mostWickets", inn.bowling.stats[n].wickets); });
  }));
  return marks;
}
