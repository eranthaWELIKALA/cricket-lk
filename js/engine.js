/* Cricket.lk — engine: pure scoring/stats functions, zero DOM access.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   2. ENGINE — pure functions, zero DOM access.
   ============================================================ */
function createInnings(battingTeam, bowlingTeam, target, playersPerSide, oversLimit, config){
  const cfg = config || {};
  return {
    battingTeam, bowlingTeam, target, oversLimit,
    ballsPerOver: cfg.ballsPerOver || 6,
    wideBaseRuns: cfg.wideRuns != null ? cfg.wideRuns : 1,
    noBallBaseRuns: cfg.noBallRuns != null ? cfg.noBallRuns : 1,
    freeHitOnNoBall: cfg.freeHitOnNoBall !== false,
    // playersPerSide/oversLimit may be null ("no limit"): null maxWickets
    // means the side can't be bowled out, null oversLimit means no overs
    // cap (the innings then ends on all out, the target, or endInnings()).
    // Last man stands: the side is only all out once every batter is out,
    // and the last one bats alone (see battingAlone()).
    lastManStands: !!cfg.lastManStands && playersPerSide != null,
    maxWickets: playersPerSide == null ? null : (cfg.lastManStands ? playersPerSide : playersPerSide - 1),
    runs: 0, wickets: 0, legalBalls: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    freeHit: false,
    currentOverEvents: [],
    overs: [],
    batting: { order: [], stats: {} },
    bowling: { order: [], stats: {} },
    fielding: { order: [], stats: {} },
    striker: null, nonStriker: null, bowler: null, lastOverBowler: null,
    fallOfWickets: [],
    complete: false, completeReason: null
  };
}

function ensureBatsman(inn, name){
  if (!inn.batting.stats[name]){
    inn.batting.stats[name] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, howOut: null };
    inn.batting.order.push(name);
  }
}

function ensureBowler(inn, name){
  if (!inn.bowling.stats[name]){
    inn.bowling.stats[name] = { legalBalls: 0, runs: 0, wickets: 0, maidens: 0, curOverRuns: 0, curOverLegal: 0 };
    inn.bowling.order.push(name);
  }
}

function ensureFielder(inn, name){
  if (!inn.fielding.stats[name]){
    inn.fielding.stats[name] = { catches: 0, runouts: 0 };
    inn.fielding.order.push(name);
  }
}

function oversDisplay(legalBalls, ballsPerOver){
  const bpo = ballsPerOver || 6;
  return `${Math.floor(legalBalls / bpo)}.${legalBalls % bpo}`;
}

function runRate(runs, legalBalls, ballsPerOver){
  const bpo = ballsPerOver || 6;
  return legalBalls > 0 ? (runs / (legalBalls / bpo)) : 0;
}

function requiredRunRate(inn){
  if (inn.target == null) return null;
  const bpo = inn.ballsPerOver || 6;
  if (inn.oversLimit == null) return null;
  const ballsLeft = inn.oversLimit * bpo - inn.legalBalls;
  if (ballsLeft <= 0) return null;
  const runsNeeded = inn.target - inn.runs;
  return runsNeeded / (ballsLeft / bpo);
}

function swapStrike(inn){
  const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t;
}

/* Last man stands: one wicket short of all out, the remaining batter
   carries on with no partner. They always hold the striker slot and the
   non-striker slot stays null *without* asking for a new batsman. */
function battingAlone(inn){
  return !!inn.lastManStands && inn.maxWickets != null && inn.wickets === inn.maxWickets - 1;
}

function isAllOut(inn){
  return inn.maxWickets != null && inn.wickets >= inn.maxWickets;
}

function pendingBatsmanSlot(inn){
  if (inn.complete) return null;
  if (battingAlone(inn)) return inn.striker || inn.nonStriker ? null : "striker";
  if (!inn.striker) return "striker";
  if (!inn.nonStriker) return "nonStriker";
  return null;
}

function checkInningsComplete(inn){
  const bpo = inn.ballsPerOver || 6;
  if (inn.target != null && inn.runs >= inn.target){ inn.complete = true; inn.completeReason = "target"; }
  else if (isAllOut(inn)){ inn.complete = true; inn.completeReason = "allout"; }
  else if (inn.oversLimit != null && inn.legalBalls >= inn.oversLimit * bpo){ inn.complete = true; inn.completeReason = "overs"; }
}

/* event: { kind: 'run'|'wide'|'noball'|'bye'|'legbye'|'wicket',
            runs, wicketType, endComingIn, outEnd, fielder }
   A run-out names who is out (`endComingIn`: the slot that batter was in
   when the ball was bowled) and, separately, the end where the wicket was
   broken (`outEnd`: "striker" = keeper's end, "nonStriker" = bowler's end;
   defaults to `endComingIn`). The new batter comes in at `outEnd` and the
   survivor stands at the other end -- the scorer says where everyone is,
   no crossing math. Runs completed don't rotate strike on a run-out.
   A wicket can also fall on a wide or a no-ball: `extra: "wide"|"noball"`
   on a wicket event (see wicketTypesFor for which dismissals). The ball is
   then not a legal delivery: the extra's own run(s) plus any runs completed
   go to wides/no-balls (a no-ball's runs run go to the batter, as on any
   no-ball) and against the bowler, a wide isn't a ball faced, and a no-ball
   still brings a free hit.
   `fielder` is optional on wicketType 'caught'/'runout' and credits a
   fielding-side player with a catch/run-out for stats/MVP purposes.
   Every ball is also written to the innings' action log (logAction) with a
   `seq` id, so an earlier ball can be edited later (replayMatch). */
function recordBall(inn, event){
  if (event.seq == null) event = Object.assign({}, event, { seq: (inn.nextSeq = (inn.nextSeq || 0) + 1) });
  else inn.nextSeq = Math.max(inn.nextSeq || 0, event.seq);
  logAction(inn, { t: "ball", ev: event, striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler });
  const bat = inn.batting.stats;
  const bwl = inn.bowling.stats[inn.bowler];
  const extra = event.kind === "wicket" && (event.extra === "wide" || event.extra === "noball") ? event.extra : null;
  const legal = event.kind !== "wide" && event.kind !== "noball" && !extra;
  let ballRuns = 0, display = "", rotate = false, outName;
  // Who faced and whether it was a free hit, read before anything moves --
  // the commentary (inningsCommentary) needs them, the scoring doesn't.
  const batter = inn.striker, freeHit = !!inn.freeHit;

  if (event.kind === "run"){
    ballRuns = event.runs;
    bat[inn.striker].runs += event.runs;
    bat[inn.striker].balls += 1;
    if (event.runs === 4) bat[inn.striker].fours += 1;
    if (event.runs === 6) bat[inn.striker].sixes += 1;
    rotate = event.runs % 2 === 1;
    display = String(event.runs);
  } else if (event.kind === "wide"){
    ballRuns = inn.wideBaseRuns + (event.runs || 0);
    inn.extras.wides += ballRuns;
    display = event.runs ? `Wd+${event.runs}` : "Wd";
  } else if (event.kind === "noball"){
    const off = event.runs || 0;
    ballRuns = inn.noBallBaseRuns + off;
    inn.extras.noBalls += inn.noBallBaseRuns;
    bat[inn.striker].balls += 1;
    if (off > 0){
      bat[inn.striker].runs += off;
      if (off === 4) bat[inn.striker].fours += 1;
      if (off === 6) bat[inn.striker].sixes += 1;
    }
    rotate = off % 2 === 1;
    display = off ? `Nb+${off}` : "Nb";
  } else if (event.kind === "bye" || event.kind === "legbye"){
    ballRuns = event.runs;
    if (event.kind === "bye") inn.extras.byes += ballRuns; else inn.extras.legByes += ballRuns;
    bat[inn.striker].balls += 1;
    rotate = ballRuns % 2 === 1;
    display = (event.kind === "bye" ? "B" : "Lb") + ballRuns;
  } else if (event.kind === "wicket"){
    const base = extra === "wide" ? inn.wideBaseRuns : extra === "noball" ? inn.noBallBaseRuns : 0;
    const tag = extra === "wide" ? "Wd+" : extra === "noball" ? "Nb+" : "";
    if (event.wicketType === "runout"){
      const ran = event.runs || 0;
      ballRuns = base + ran;
      if (extra === "wide") inn.extras.wides += ballRuns;
      else {
        if (extra === "noball") inn.extras.noBalls += base;
        bat[inn.striker].runs += ran;
        bat[inn.striker].balls += 1;
      }
      outName = inn[event.endComingIn];
      const survivor = event.endComingIn === "striker" ? inn.nonStriker : inn.striker;
      const outEnd = event.outEnd || event.endComingIn;
      bat[outName].out = true;
      bat[outName].howOut = event.fielder ? `run out (${event.fielder})` : "run out";
      inn.wickets += 1;
      inn[outEnd] = null;
      inn[outEnd === "striker" ? "nonStriker" : "striker"] = survivor;
      if (event.fielder){ ensureFielder(inn, event.fielder); inn.fielding.stats[event.fielder].runouts += 1; }
      display = tag + (ran ? `${ran}+Ro` : "Ro");
    } else {
      ballRuns = base;
      if (extra === "wide") inn.extras.wides += base;
      if (extra === "noball") inn.extras.noBalls += base;
      outName = inn.striker;
      if (extra !== "wide") bat[inn.striker].balls += 1;
      bat[inn.striker].out = true;
      bat[inn.striker].howOut = (event.wicketType === "caught" && event.fielder)
        ? `c ${event.fielder} b ${inn.bowler}`
        : `${WICKET_LABELS[event.wicketType]} b ${inn.bowler}`;
      bwl.wickets += 1;
      inn.wickets += 1;
      inn.striker = null;
      if (event.wicketType === "caught" && event.fielder){ ensureFielder(inn, event.fielder); inn.fielding.stats[event.fielder].catches += 1; }
      display = tag + "W";
    }
  }

  inn.runs += ballRuns;
  if (legal){ inn.legalBalls += 1; bwl.legalBalls += 1; bwl.curOverLegal += 1; }
  if (event.kind !== "bye" && event.kind !== "legbye"){ bwl.runs += ballRuns; bwl.curOverRuns += ballRuns; }
  if (event.kind === "wicket"){
    // `balls` (legalBalls at the fall) is what the live-scoring screen's
    // partnership counter subtracts from the current legalBalls total --
    // `over` is only a display string, not reversible back into a count.
    inn.fallOfWickets.push({ score: inn.runs, wicket: inn.wickets, over: oversDisplay(inn.legalBalls, inn.ballsPerOver), balls: inn.legalBalls, batsman: outName });
  }

  // `runs` here is per-ball runs (bat + extras, whatever this event was
  // worth) -- the live-scoring screen's over-total sums this per row.
  // kind/batter/wicket fields only feed the commentary.
  // `seq` ties the chip back to its log entry (ball by ball's edit button).
  const ev = { display, isWicket: event.kind === "wicket", runs: ballRuns, kind: event.kind, batter, seq: event.seq };
  if (freeHit) ev.freeHit = true;
  if (event.kind === "wicket"){
    const o = bat[outName];
    Object.assign(ev, { wicketType: event.wicketType, outName, howOut: o.howOut, outRuns: o.runs, outBalls: o.balls });
    if (event.fielder) ev.fielder = event.fielder;
    if (extra){ ev.extra = extra; ev.off = event.wicketType === "runout" ? (event.runs || 0) : 0; }
  }
  inn.currentOverEvents.push(ev);

  if (legal) inn.freeHit = false;
  if ((event.kind === "noball" || extra === "noball") && inn.freeHitOnNoBall) inn.freeHit = true;
  if (rotate) swapStrike(inn);

  checkInningsComplete(inn);

  const overCompleted = legal && inn.legalBalls % inn.ballsPerOver === 0;
  if (overCompleted){
    // After a catch-up mid-over the over's earlier balls weren't scored one by
    // one, so whether it was a maiden is unknown: never award one then.
    if (bwl.curOverRuns === 0 && !inn.partOverUnknown) bwl.maidens += 1;
    delete inn.partOverUnknown;
    inn.overs.push({ bowler: inn.bowler, events: inn.currentOverEvents });
    inn.currentOverEvents = [];
    bwl.curOverRuns = 0; bwl.curOverLegal = 0;
    if (!inn.complete){
      inn.lastOverBowler = inn.bowler;
      inn.bowler = null;
      swapStrike(inn);
    }
  }

  // Runs after both swaps (which stay unconditional): a lone last batter
  // always ends up back on strike, whichever slot the swaps left them in.
  if (battingAlone(inn) && !inn.complete){
    inn.striker = inn.striker || inn.nonStriker;
    inn.nonStriker = null;
  }
}

/* Closes the current innings by hand (declaration / time called) -- the
   only way an innings with no overs limit ends short of all out or the
   target. afterBall() then moves on exactly as after a completing ball. */
function endInnings(match){
  const inn = currentInnings(match);
  if (inn.complete) return;
  logAction(inn, { t: "end" });
  inn.complete = true;
  inn.completeReason = "closed";
  afterBall(match);
}

/* Which dismissals a delivery allows. On a free hit only a run out (the
   striker can't be bowled, caught, lbw, stumped or out hit wicket); off a
   no-ball the same; off a wide, stumped, hit wicket or run out. */
const WICKET_TYPES = ["bowled", "caught", "lbw", "stumped", "hitwicket", "runout"];
function wicketTypesFor(freeHit, extra){
  if (extra === "noball" || freeHit) return ["runout"];
  if (extra === "wide") return ["stumped", "hitwicket", "runout"];
  return WICKET_TYPES.slice();
}

/* --- the innings action log & editing an earlier ball ---
   Every change to an innings is written to `inn.log`, in order: the openers
   ({t:"open"}), each ball ({t:"ball", ev, striker, nonStriker, bowler}: the
   event recordBall got, with its `seq` id, and who was where), each new
   batter ({t:"bat", name}) and bowler ({t:"bowl", name}), a strike swap by
   hand ({t:"swap"}) and closing the innings ({t:"end"}). `inn.logBase` is
   the innings as it was before the first logged action: a fresh innings,
   or wherever an older match / a catch-up left it (balls before that can't
   be edited). replayMatch rebuilds an innings from its base by running the
   log again with one ball changed or removed. Undo still uses snapshots. */
function logAction(inn, a){
  if (!inn.log){
    const base = Object.assign({}, inn);
    delete base.log; delete base.logBase;
    inn.logBase = JSON.parse(JSON.stringify(base));
    inn.log = [];
  }
  inn.log.push(JSON.parse(JSON.stringify(a)));
}
function openInnings(inn, striker, nonStriker, bowler){
  logAction(inn, { t: "open", striker, nonStriker, bowler });
  ensureBatsman(inn, striker); ensureBatsman(inn, nonStriker); ensureBowler(inn, bowler);
  inn.striker = striker; inn.nonStriker = nonStriker; inn.bowler = bowler;
}
// The batter goes into whichever slot is empty (pendingBatsmanSlot).
function sendInBatter(inn, name){
  const slot = pendingBatsmanSlot(inn);
  if (!slot) return;
  logAction(inn, { t: "bat", name });
  ensureBatsman(inn, name);
  inn[slot] = name;
}
function setBowler(inn, name){
  logAction(inn, { t: "bowl", name });
  ensureBowler(inn, name);
  inn.bowler = name;
}
/* The scorer says the batters are the other way round (a missed single, a
   short run, or the umpire's call). Nothing else changes. */
function canSwapStrike(inn){
  return !!(inn && !inn.complete && inn.striker && inn.nonStriker);
}
function swapStrikeByHand(inn){
  if (!canSwapStrike(inn)) return false;
  logAction(inn, { t: "swap" });
  swapStrike(inn);
  return true;
}

/* "4.3": the over and ball number of the delivery about to be bowled. */
function nextBallLabel(inn){
  const bpo = inn.ballsPerOver || 6;
  return `${Math.floor(inn.legalBalls / bpo)}.${inn.legalBalls % bpo + 1}`;
}
function isLegalEvent(ev){
  return ev.kind !== "wide" && ev.kind !== "noball" && !(ev.kind === "wicket" && ev.extra);
}

/* Is ball `seq` of innings `idx` editable? Only balls in the log (not ones
   from before a catch-up or from an app version without the log), only in
   a match that wasn't forfeited or entered as a result only. */
function editableBall(match, idx, seq){
  const inn = match && !match.forfeited && !match.resultOnly && match.innings[idx];
  if (!inn || !inn.log) return null;
  return inn.log.find(a => a.t === "ball" && a.ev.seq === seq) || null;
}

/* Runs an innings' log again from its base. Batters and bowlers are taken
   in the order they were entered, as the slots open up -- so if the change
   adds a wicket, the next batter comes in earlier (and the last one is
   asked for), and if it removes one, that batter comes in at the next
   wicket instead. Who was on strike for each later ball stays as it was
   recorded. A wide/no-ball that becomes a legal ball (or back) moves every
   later over by one ball. Returns { inn, notes } or { need } (a name that
   isn't in the log: `supply` gives them; with `partial` and `left`, see
   stop()) or { error }. */
function replayInnings(inn, actions, supply, anonymous){
  const r = JSON.parse(JSON.stringify(inn.logBase));
  r.logBase = inn.logBase; r.log = [];
  const bpo = r.ballsPerOver || 6;
  const notes = [];
  const batQ = [], bowlQ = [], used = new Set(), skippedBatters = [];
  let droppedBalls = 0;
  const lc = n => (n || "").toLowerCase();
  const ahead = (i, t) => {
    for (let j = i + 1; j < actions.length; j++){
      if (!used.has(j) && actions[j].t === t){ used.add(j); return actions[j].name; }
    }
    return null;
  };
  const batterError = name => {
    const known = r.batting.order.find(n => lc(n) === lc(name));
    if (known && (r.batting.stats[known].out || known === r.striker || known === r.nonStriker)) return `${known} is already out or batting.`;
    return null;
  };
  // Fill the empty slots from what was entered (in order). `now`: a ball is
  // about to be bowled, so a later entry or a supplied name may be used.
  const fill = (i, now) => {
    let slot;
    while ((slot = pendingBatsmanSlot(r))){
      let name = batQ.length ? batQ.shift() : null;
      if (!name && now) name = anonymous ? `Batter ${r.batting.order.length + 1}` : (ahead(i, "bat") || supply.batters.shift() || null);
      if (!name) break;
      const err = batterError(name);
      if (err) return { error: err };
      sendInBatter(r, name);
    }
    if (!r.bowler && !r.complete && (r.striker || r.nonStriker)){
      let name = bowlQ.length ? bowlQ.shift() : null;
      if (!name && now) name = anonymous ? `Over ${Math.floor(r.legalBalls / bpo) + 1}` : (ahead(i, "bowl") || supply.bowlers.shift() || null);
      if (name){
        if (r.lastOverBowler && lc(name) === lc(r.lastOverBowler)) return { error: `${name} would bowl two overs in a row (from ball ${nextBallLabel(r)}).` };
        setBowler(r, name);
      }
    }
    return null;
  };
  // Stopped for a name: `partial` is the innings up to the ball that needs
  // it, `left` how many logged balls are still to come (shown as "?").
  const stop = (i, need) => ({ need, partial: r,
    left: actions.filter((a, j) => j >= i && a.t === "ball" && !used.has(j)).length });
  for (let i = 0; i < actions.length; i++){
    if (used.has(i)) continue;
    const a = actions[i];
    if (a.t === "open"){
      openInnings(r, a.striker, a.nonStriker, a.bowler);
    } else if (a.t === "bat"){
      if (anonymous) continue;
      if (r.complete){ skippedBatters.push(a.name); continue; }
      batQ.push(a.name);
      const res = fill(i, false); if (res) return res;
    } else if (a.t === "bowl"){
      if (anonymous || r.complete) continue;
      bowlQ.push(a.name);
      const res = fill(i, false); if (res) return res;
    } else if (a.t === "swap"){
      swapStrikeByHand(r);
    } else if (a.t === "end"){
      if (!r.complete){ logAction(r, { t: "end" }); r.complete = true; r.completeReason = "closed"; }
    } else if (a.t === "ball"){
      if (r.complete){ droppedBalls++; continue; }
      const res = fill(i, true); if (res) return res;
      if (pendingBatsmanSlot(r)){
        const fow = r.fallOfWickets[r.fallOfWickets.length - 1];
        return stop(i, { kind: "batter", label: nextBallLabel(r), out: fow ? fow.batsman : null });
      }
      if (!r.bowler) return stop(i, { kind: "bowler", label: nextBallLabel(r), last: r.lastOverBowler });
      // The same two batters, the other way round from what was recorded:
      // keep them where the scorer had them for this ball.
      if (a.striker && a.nonStriker && r.striker === a.nonStriker && r.nonStriker === a.striker) swapStrike(r);
      const ev = a.ev;
      if (ev.kind === "wicket" && ev.wicketType === "runout" && !r[ev.endComingIn]){
        return { error: `Ball ${nextBallLabel(r)} is a run out at a crease nobody is batting at any more.` };
      }
      if (ev.kind === "wicket" && !wicketTypesFor(r.freeHit, ev.extra).includes(ev.wicketType)){
        notes.push(`Ball ${nextBallLabel(r)} is now a free hit, so it couldn't have been ${(DISMISSAL_WORDS[ev.wicketType] || "that dismissal").toLowerCase()}. Check it.`);
      }
      recordBall(r, ev);
    }
  }
  const res = fill(actions.length, false); if (res) return res;
  skippedBatters.push(...batQ);
  r.nextSeq = Math.max(inn.nextSeq || 0, r.nextSeq || 0);
  if (droppedBalls) notes.push(`The innings now ends earlier: ${droppedBalls} later ball${droppedBalls === 1 ? " is" : "s are"} removed.`);
  if (skippedBatters.length) notes.push(`${skippedBatters.join(", ")} no longer come${skippedBatters.length === 1 ? "s" : ""} in to bat.`);
  return { inn: r, notes };
}

/* The match with one ball changed: change = { inn: index, seq, ev } (ev =
   the new recordBall event; null removes the ball). Later innings are run
   again too when the target moves. `supply` = { batters: [], bowlers: [] }:
   names for slots the log can't fill (see replayInnings' `need`). Returns
   { match, notes } -- a new object, the input isn't touched -- or { need }
   / { error }. With { need }, `partial` is the match replayed up to where
   the name is needed (for a preview; never saved) and `left` the balls after
   it that can't be worked out yet. The status follows the innings: an
   innings that is no longer over goes back to live, a chase that now gets
   there ends the match. */
function replayMatch(match, change, supply){
  const changes = Array.isArray(change) ? change : [change];
  const m = JSON.parse(JSON.stringify(match));
  const sup = { batters: [...((supply && supply.batters) || [])], bowlers: [...((supply && supply.bowlers) || [])] };
  const notes = [];
  const first = changes[0] && changes[0].inn;
  if (!changes.length || changes.some(c => c.inn !== first || !editableBall(m, c.inn, c.seq))) return { error: "This ball can't be edited." };
  // Added balls get new ids, after every id this innings has used.
  let next = ballSeqMax(m.innings[first]);
  const plan = changes.map(c => c.insert ? Object.assign({}, c, { newSeq: ++next }) : c);
  const added = plan.filter(c => c.insert).map(c => c.newSeq);
  for (let idx = first; idx < m.innings.length; idx++){
    const inn = m.innings[idx];
    let actions = inn.log || [];
    if (idx === first){
      actions = applyBallChanges(actions, plan);
    } else {
      const target = m.innings[0].runs + 1;
      if (inn.target === target) break;
      notes.push(`${teamName(m, inn.battingTeam)} now need ${target} to win.`);
      if (!inn.log){
        if (inn.batting.order.length || inn.legalBalls) return { error: "The chase was started before balls could be edited, so the target can't change." };
        inn.target = target;
        continue;
      }
      inn.logBase.target = target;
    }
    const res = replayInnings(inn, actions, sup, !!m.anonymous);
    if (res.need){
      m.innings[idx] = res.partial;
      return { need: Object.assign(res.need, { inn: idx }), partial: m, left: res.left, added };
    }
    if (res.error) return { error: res.error };
    if (idx === first){
      const there = new Set(inningsBalls(res.inn).map(b => b.seq));
      if (added.some(q => !there.has(q))) return { error: "The innings is already over before that point, so a ball can't be added there." };
      notes.push(...ballShiftNotes(inn, res.inn, !!m.anonymous));
    }
    m.innings[idx] = res.inn;
    notes.push(...res.notes);
    if (idx === 0 && m.innings.length > 1 && !res.inn.complete){
      const i2 = m.innings[1];
      if (i2.batting.order.length || i2.legalBalls || (i2.log && i2.log.length)) {
        return { error: "That would mean the first innings isn't over, but the chase has already started." };
      }
      m.innings.length = 1;
      notes.push("The first innings isn't over any more, so scoring goes back to it.");
      break;
    }
  }
  settleMatchStatus(m);
  return { match: m, notes, added };
}

/* The log with the changes made: a ball replaced or removed (`ev` null), or
   a new one put in just before / just after a ball (`insert`). An added ball
   has no recorded batters or bowler, so the replay works them out. */
function applyBallChanges(actions, plan){
  const out = [];
  const added = c => ({ t: "ball", ev: Object.assign({}, c.ev, { seq: c.newSeq }), striker: null, nonStriker: null, bowler: null });
  actions.forEach(a => {
    if (a.t !== "ball"){ out.push(a); return; }
    const seq = a.ev.seq;
    plan.filter(c => c.insert === "before" && c.seq === seq).forEach(c => out.push(added(c)));
    const c = plan.find(x => !x.insert && x.seq === seq);
    if (!c) out.push(a);
    else if (c.ev) out.push(Object.assign({}, a, { ev: Object.assign({}, c.ev, { seq }) }));
    plan.filter(x => x.insert === "after" && x.seq === seq).forEach(x => out.push(added(x)));
  });
  return out;
}
// The highest ball id this innings has used (a new ball takes the next one).
function ballSeqMax(inn){
  return (inn.log || []).reduce((mx, a) => a.t === "ball" ? Math.max(mx, a.ev.seq || 0) : mx, inn.nextSeq || 0);
}

/* What a change did to the balls around it, in the scorer's terms: balls
   that now have another number ("3.5 is now 3.4") and balls that now count
   in another bowler's over. A legal ball added or taken out moves every
   later ball until another change moves them back. */
function ballShiftNotes(oldInn, newInn, anonymous){
  const now = new Map(inningsBalls(newInn).map(b => [b.seq, b]));
  const common = inningsBalls(oldInn).filter(b => now.has(b.seq));
  const moved = common.filter(b => now.get(b.seq).label !== b.label);
  const notes = [];
  if (moved.length){
    const a = moved[0], z = moved[moved.length - 1];
    const toEnd = z === common[common.length - 1] && common.indexOf(z) - common.indexOf(a) === moved.length - 1;
    const eg = `${a.label} is now ${now.get(a.seq).label}`;
    notes.push(toEnd ? `From ball ${a.label} on, every later over moves (${eg}).`
      : `Balls ${a.label} to ${z.label} move (${eg}); the overs after that stay as they were.`);
  }
  if (!anonymous){
    const lc = n => (n || "").toLowerCase();
    const switched = common.filter(b => b.bowler && now.get(b.seq).bowler && lc(b.bowler) !== lc(now.get(b.seq).bowler));
    if (switched.length){
      const b = switched[0];
      notes.push(`${switched.length} ball${switched.length === 1 ? " now counts" : "s now count"} in another bowler's over (${b.label} was ${b.bowler}'s, now ${now.get(b.seq).bowler}'s).`);
    }
  }
  return notes;
}

// The status (and result) worked out again from the innings as they now are.
function settleMatchStatus(m){
  const last = currentInnings(m);
  if (last.complete){
    if (m.innings.length === 1){ m.status = "innings_break"; m.result = null; }
    else { m.status = "complete"; m.result = matchResult(m); }
  } else {
    m.status = last.batting.order.length ? "live" : "opening";
    m.result = null;
  }
}

/* Every ball of an innings in order, the way ball by ball numbers them:
   { seq, ev, label ("4.3"; a wide/no-ball carries the number of the ball
   still to come), bowler, before/after ({ runs, wickets, balls }), over
   ({ number, bowler, events, at: this ball's index }) }. A catch-up/by-hand
   gap resets the running score. */
function inningsBalls(inn){
  const bpo = inn.ballsPerOver || 6;
  const overs = inn.overs.concat(inn.currentOverEvents.length ? [{ bowler: inn.bowler, events: inn.currentOverEvents }] : []);
  const out = [];
  let runs = 0, wickets = 0, balls = 0;
  for (const o of overs){
    if (o.gap){ runs = o.gap.toRuns; wickets = o.gap.toWickets; balls = o.gap.toBalls; continue; }
    const start = balls;
    let inOver = start % bpo;
    o.events.forEach((ev, k) => {
      const legal = !/^(Wd|Nb)/.test(ev.display);
      const before = { runs, wickets, balls };
      if (legal){ inOver += 1; balls += 1; }
      runs += ev.runs || 0;
      if (ev.isWicket) wickets += 1;
      out.push({
        seq: ev.seq, ev, bowler: o.bowler, before, after: { runs, wickets, balls },
        label: `${Math.floor(start / bpo)}.${legal ? inOver : inOver + 1}`,
        over: { number: Math.floor(start / bpo) + 1, bowler: o.bowler, events: o.events, at: k }
      });
    });
  }
  return out;
}
// One ball of an innings (see inningsBalls), or null if it isn't there.
function ballContext(inn, seq){
  return inningsBalls(inn).find(b => b.seq === seq) || null;
}

/* --- reopening an innings ended by hand ---
   End innings (rain, time, a declaration -- or a mistaken tap) is the one way
   an innings ends with balls still to bowl (completeReason "closed"; a score
   set by hand ends that way too), so it's the one that can be taken back: the
   innings goes back to live from where it stopped, its `end` dropped from the
   log. A later innings is cleared -- it was played against a total that isn't
   final any more. An innings that ended on its own (all out, overs, target)
   needs a ball edited instead. Returns { match, notes } (a copy) or { error }. */
function reopenInningsError(match, idx){
  const inn = match && match.innings[idx];
  if (!inn || match.forfeited || match.resultOnly) return "This innings can't be reopened.";
  if (!inn.complete) return "This innings isn't over.";
  const why = { allout: "they were all out", overs: "the overs ran out", target: "the target was reached" }[inn.completeReason];
  if (why) return `${possessive(teamName(match, inn.battingTeam))} innings ended because ${why}. To change that, edit a ball.`;
  return null;
}
function reopenInnings(match, idx){
  const err = reopenInningsError(match, idx);
  if (err) return { error: err };
  const m = JSON.parse(JSON.stringify(match));
  const notes = [];
  const later = m.innings[idx + 1];
  if (later){
    if (later.batting.order.length || later.legalBalls) notes.push(`${possessive(teamName(m, later.battingTeam))} innings so far (${later.runs}-${later.wickets}, ${oversDisplay(later.legalBalls || 0, later.ballsPerOver)} ov) is cleared. They bat again once this innings is over.`);
    m.innings.length = idx + 1;
  }
  const inn = m.innings[idx];
  if (inn.log && inn.log.length && inn.log[inn.log.length - 1].t === "end") inn.log.pop();
  inn.complete = false; inn.completeReason = null;
  checkInningsComplete(inn);
  if (inn.complete) return { error: reopenInningsError(m, idx) };
  settleMatchStatus(m);
  return { match: m, notes };
}

/* --- the final score, set by hand ---
   For a scorer who'd rather type the score than fix it ball by ball.
   scores[i] = { runs, wickets, balls } for innings i, or null to leave it;
   scores[1] for a chase that hasn't started starts it. An innings given a
   score is over at that score. If the score is what it already was, it just
   ends there (like End innings, its balls stay editable); otherwise the balls
   already scored stay and a "set by hand" gap (the same shape as a
   catch-up's, `gap.byHand`) takes it to the new total, and its log goes. The
   chase's target follows the first innings, and a chase left alone is
   replayed against the new one. A changed total isn't credited to anyone
   (players keep only what they were credited with), and like a catch-up the
   match is marked match.caughtUp. Returns
   { match, notes } -- a copy, the input isn't touched -- or { error }. */
function scoreByHandError(match, scores){
  if (match.forfeited || match.resultOnly) return "This match's score can't be set here.";
  const i0 = match.innings[0];
  if (!scores[0] && !scores[1]) return "Nothing has changed yet.";
  if (scores[1] && !scores[0] && !i0.complete) return `Set ${teamName(match, i0.battingTeam)}'s score first: their innings isn't over.`;
  const firstRuns = scores[0] ? scores[0].runs : i0.runs;
  const bpo = match.ballsPerOver || i0.ballsPerOver || 6;
  for (let i = 0; i < 2; i++){
    const s = scores[i];
    if (!s) continue;
    const who = teamName(match, i === 0 ? i0.battingTeam : i0.bowlingTeam);
    const maxW = i0.maxWickets;
    if (!Number.isInteger(s.runs) || s.runs < 0 || s.runs > 9999) return `Enter ${who}'s runs.`;
    if (!Number.isInteger(s.wickets) || s.wickets < 0 || s.wickets > 99) return `Enter ${who}'s wickets.`;
    if (maxW != null && s.wickets > maxW) return `${who} can lose at most ${maxW} wicket${maxW === 1 ? "" : "s"}.`;
    if (!Number.isInteger(s.balls) || s.balls < 0) return `Enter ${who}'s overs, like 19.4.`;
    if (i0.oversLimit != null && s.balls > i0.oversLimit * bpo) return `${who} can face at most ${i0.oversLimit} over${i0.oversLimit === 1 ? "" : "s"}.`;
    if (i === 1 && s.runs > firstRuns + 6) return `${who} needed ${firstRuns + 1}, so the chase can't end past ${firstRuns + 6}.`;
    if (i === 1 && s.runs > firstRuns && maxW != null && s.wickets >= maxW) return `${who} can't both reach the target and be all out.`;
  }
  return null;
}
function applyScoreByHand(inn, s){
  const same = inn.runs === s.runs && inn.wickets === s.wickets && inn.legalBalls === s.balls;
  if (same){
    if (!inn.complete){ logAction(inn, { t: "end" }); inn.complete = true; inn.completeReason = "closed"; }
    return false;
  }
  if (inn.currentOverEvents.length) inn.overs.push({ bowler: inn.bowler, events: inn.currentOverEvents, partial: true });
  inn.currentOverEvents = [];
  const batters = {}, bowlers = {};
  inn.batting.order.forEach(n => { const b = inn.batting.stats[n]; batters[n] = { runs: b.runs, balls: b.balls }; });
  inn.bowling.order.forEach(n => { const b = inn.bowling.stats[n]; bowlers[n] = { balls: b.legalBalls, runs: b.runs, wickets: b.wickets, maidens: b.maidens }; });
  inn.overs.push({ bowler: null, events: [], gap: {
    fromBalls: inn.legalBalls || 0, fromRuns: inn.runs, fromWickets: inn.wickets,
    toBalls: s.balls, toRuns: s.runs, toWickets: s.wickets, byHand: true, batters, bowlers } });
  inn.runs = s.runs; inn.wickets = s.wickets; inn.legalBalls = s.balls;
  if (inn.fallOfWickets.length > s.wickets) inn.fallOfWickets.length = s.wickets;
  inn.striker = null; inn.nonStriker = null; inn.bowler = null; inn.freeHit = false;
  delete inn.partOverUnknown;
  inn.complete = false; inn.completeReason = null;
  checkInningsComplete(inn);
  if (!inn.complete){ inn.complete = true; inn.completeReason = "closed"; }
  delete inn.log; delete inn.logBase;
  return true;
}
function setScoresByHand(match, scores){
  const err = scoreByHandError(match, scores);
  if (err) return { error: err };
  const m = JSON.parse(JSON.stringify(match));
  const notes = [];
  const i0 = m.innings[0];
  let changed = false;
  if (scores[0]) changed = applyScoreByHand(i0, scores[0]) || changed;
  if (scores[1] || m.innings[1]){
    if (!m.innings[1]) startSecondInnings(m);
    const i2 = m.innings[1], target = i0.runs + 1;
    const chaser = teamName(m, i2.battingTeam);
    if (i2.target !== target){
      notes.push(`${chaser} now need ${target} to win.`);
      if (scores[1] || !i2.log){
        i2.target = target;
        if (i2.logBase) i2.logBase.target = target;
        // only reaching the target depends on it
        if (!i2.complete || i2.completeReason === "target"){ i2.complete = false; i2.completeReason = null; checkInningsComplete(i2); }
      } else {
        i2.logBase.target = target;
        const res = replayInnings(i2, i2.log, { batters: [], bowlers: [] }, !!m.anonymous);
        if (!res.inn) return { error: `${chaser}'s chase can't be worked out against the new target. Set their score too.` };
        m.innings[1] = res.inn;
        notes.push(...res.notes);
      }
    }
    if (scores[1]) changed = applyScoreByHand(m.innings[1], scores[1]) || changed;
  }
  settleMatchStatus(m);
  if (match.status === "complete" && m.status !== "complete"){
    return { error: `With that score ${teamName(m, m.innings[1].battingTeam)}'s chase wouldn't be over. Set their score too.` };
  }
  if (changed) m.caughtUp = true;
  return { match: m, notes };
}

function createMatch({ teamA, teamB, oversLimit, playersPerSide, battingFirst, ballsPerOver, wideRuns, noBallRuns, wideEnabled, noBallEnabled, freeHitOnNoBall, lastManStands, requireFielderOnCatch, requireFielderOnRunout, presetId, presetName, tournamentId, tossWinner }){
  // null/undefined overs or players = no limit (see createInnings).
  oversLimit = oversLimit || null;
  playersPerSide = playersPerSide || null;
  const cfg = {
    ballsPerOver: ballsPerOver || 6,
    wideRuns: wideRuns != null ? wideRuns : 1,
    noBallRuns: noBallRuns != null ? noBallRuns : 1,
    freeHitOnNoBall: freeHitOnNoBall !== false,
    lastManStands: !!lastManStands && playersPerSide != null
  };
  return {
    teamA, teamB, oversLimit, playersPerSide, battingFirst,
    lastManStands: cfg.lastManStands,
    ballsPerOver: cfg.ballsPerOver,
    wideEnabled: wideEnabled !== false,
    noBallEnabled: noBallEnabled !== false,
    freeHitOnNoBall: cfg.freeHitOnNoBall,
    requireFielderOnCatch: !!requireFielderOnCatch,
    requireFielderOnRunout: !!requireFielderOnRunout,
    presetId: presetId || null,
    presetName: presetName || null,
    tournamentId: tournamentId || null,
    // Optional "A"/"B": only the commentary reads it (with battingFirst it
    // tells whether the winner chose to bat or to field).
    tossWinner: tossWinner === "A" || tossWinner === "B" ? tossWinner : null,
    innings: [createInnings(battingFirst, battingFirst === "A" ? "B" : "A", null, playersPerSide, oversLimit, cfg)],
    status: "opening",
    result: null,
    motm: null
  };
}

function currentInnings(match){ return match.innings[match.innings.length - 1]; }

function teamName(match, key){ return key === "A" ? match.teamA : match.teamB; }
// "Lions'" / "Sri Lanka's": a name's possessive, for sentences about a side.
function possessive(name){ return /s$/i.test(name || "") ? `${name}'` : `${name}'s`; }

/* A match doesn't store rosters (names are typed freely), so a name's side
   is inferred from where it's already been used: batters belong to that
   innings' batting team, bowlers and fielders to its bowling team.
   Case-insensitive. Returns "A"/"B", or null if the name hasn't appeared.
   A club-tournament match started from saved teams also carries
   `match.squads` ({ A: [names], B: [names] }), which wins over usage: a
   squad player is on their squad's side before they've even batted. Names
   in neither squad (a late sub) fall back to the usage rule. */
function playerTeamInMatch(match, name){
  const key = (name || "").trim().toLowerCase();
  if (!key) return null;
  const has = list => list.some(n => n.toLowerCase() === key);
  if (match.squads){
    if (has(match.squads.A || [])) return "A";
    if (has(match.squads.B || [])) return "B";
  }
  for (const inn of match.innings){
    if (has(inn.batting.order)) return inn.battingTeam;
    if (has(inn.bowling.order) || has(inn.fielding.order)) return inn.bowlingTeam;
  }
  return null;
}

/* --- player profile field rules (mirror supabase/007's checks) ---
   NIC: Sri Lankan old format (9 digits + V/X) or new format (12 digits),
   stored upper-case without spaces. Contact: 7-15 digits/spaces, optional
   leading +. Both are optional; blank means "not set". */
function normalizeNic(v){ return (v || "").replace(/\s+/g, "").toUpperCase(); }
function isValidNic(v){ const n = normalizeNic(v); return n === "" || /^([0-9]{9}[VX]|[0-9]{12})$/.test(n); }
function isValidPhone(v){ const t = (v || "").trim(); return t === "" || /^\+?[0-9 ]{7,15}$/.test(t); }
// Player names: trimmed, inner whitespace collapsed, 1-24 characters --
// mirrored by rename_player (supabase/013).
function normalizePlayerName(v){ return (v || "").trim().replace(/\s+/g, " "); }
function playerNameError(v){
  const n = normalizePlayerName(v);
  if (!n) return "Enter the player's name.";
  if (n.length > 24) return "Name can be at most 24 characters.";
  return null;
}

/* Optional profile details: "Right-hand bat", "Right-arm fast", etc. Empty
   string when nothing is set, so callers can just filter falsy. */
function formatBatting(hand){ return hand === "right" ? "Right-hand bat" : hand === "left" ? "Left-hand bat" : ""; }
function formatBowling(arm, type){
  const a = arm === "right" ? "Right-arm" : arm === "left" ? "Left-arm" : "";
  const t = BOWLING_TYPES[type] ? BOWLING_TYPES[type].toLowerCase() : "";
  const words = [a, t].filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}
/* A photo is rendered straight into <img src>, so only ever a base64
   raster data URL (never svg or anything else) is accepted. */
function safePhoto(v){ return typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length <= 80000 ? v : ""; }
function playerDetailsError(d){
  if (d.batting_hand && !["right", "left"].includes(d.batting_hand)) return "Pick a valid batting hand.";
  if (d.bowling_arm && !["right", "left"].includes(d.bowling_arm)) return "Pick a valid bowling arm.";
  if (d.bowling_type && !BOWLING_TYPES[d.bowling_type]) return "Pick a valid bowling style.";
  if ((d.city || "").trim().length > 40) return "City can be at most 40 characters.";
  if (d.photo && !safePhoto(d.photo)) return "That photo couldn't be used — try another image.";
  if ((d.nickname || "").trim().length > 24) return "Nickname can be at most 24 characters.";
  if (parseJerseyNo(d.jersey_no) === undefined) return "Jersey no should be a whole number from 0 to 999.";
  return null;
}
/* Jersey no (supabase/010): blank -> null, "07" -> 7, anything that isn't a
   whole number 0-999 -> undefined (invalid). */
function parseJerseyNo(v){
  const t = v == null ? "" : String(v).trim();
  if (t === "") return null;
  return /^[0-9]{1,3}$/.test(t) ? parseInt(t, 10) : undefined;
}
/* Optional overs/players fields: blank -> null ("no limit"), otherwise a
   whole number clamped to at least `min`. */
function parseOptionalLimit(v, min){
  const t = v == null ? "" : String(v).trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return isNaN(n) ? null : Math.max(min, n);
}
/* What an optional-limit <input> should start with: `def` for a brand-new
   form (field absent), blank for a saved "no limit" (null). */
function limitInputValue(v, def){ return v === undefined ? def : (v == null ? "" : v); }
/* Playing-condition tags shared by preset cards and the innings break. */
function conditionTagsFor(c){
  return [
    c.oversLimit != null ? `${c.oversLimit} overs` : "no over limit",
    `${c.ballsPerOver}-ball`,
    c.playersPerSide != null ? `${c.playersPerSide} a side` : "any number a side",
    c.lastManStands && c.playersPerSide != null ? "last man stands" : null
  ].filter(Boolean);
}

/* Plain-language [label, text] rows for a preset's ⓘ panel (presetInfoHtml). */
function describeMatchPreset(p){
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const wide = p.wide || {}, noBall = p.noBall || {};
  const players = p.playersPerSide == null
    ? "Any number. A side can't be bowled out."
    : `${p.playersPerSide} a side. All out at ${p.lastManStands ? p.playersPerSide : p.playersPerSide - 1} wickets${p.lastManStands ? " (last man stands: the last batter bats alone)" : ""}.`;
  const rows = [
    ["Overs", p.oversLimit == null ? "No limit. The scorer ends the innings by hand." : `${plural(p.oversLimit, "over")} per innings.`],
    ["Over length", `${plural(p.ballsPerOver, "ball")} per over.`],
    ["Players", players],
    ["Wides", wide.enabled === false ? "Not called." : `${plural(wide.runs ?? 1, "run")}, and the ball is bowled again.`],
    ["No-balls", noBall.enabled === false ? "Not called." : `${plural(noBall.runs ?? 1, "run")}, and the ball is bowled again. ${p.freeHitOnNoBall !== false ? "The next ball is a free hit." : "No free hit."}`]
  ];
  const fielder = [p.requireFielderOnCatch && "catches", p.requireFielderOnRunout && "run-outs"].filter(Boolean);
  if (fielder.length) rows.push(["Fielder", `Must be named for ${fielder.join(" and ")}.`]);
  return rows;
}
/* `matchPresetName` is null for a club tournament preset, whose match
   conditions are picked at each match's setup instead. */
function describeTournamentPreset(t, matchPresetName){
  return [
    ["Matches", matchPresetName ? `Played as ${matchPresetName}.` : "Conditions are picked when each match is set up."],
    ["Points", `Win ${t.pointsForWin} · Tie ${t.pointsForTie} · Loss ${t.pointsForLoss}`],
    ["Level on points", t.useNRR !== false ? "Ranked by net run rate (NRR)." : "Stay level. NRR isn't used."]
  ];
}

/* Escape a user's text for a PostgREST ilike pattern, so a typed % or _
   matches literally instead of acting as a wildcard. */
function escapeLike(v){ return String(v || "").replace(/[\\%_]/g, c => "\\" + c); }
/* "#7 Kusal Mendis (KM)" -- the roster/profile label; the name alone when
   neither is set. */
function playerLabel(p){
  const jersey = p.jersey_no == null ? "" : `#${p.jersey_no} `;
  return `${jersey}${p.name}${p.nickname ? ` (${p.nickname})` : ""}`;
}

/* One player's career line, folded from whatever matches the caller passes
   (a club's matches for a club profile, Premier matches for Premier) --
   matched by name, case-insensitive, since matches store names not ids.
   `nameOrNames` may be an array: a profile's own name plus the aliases left
   behind by approved merges (supabase/009), so stats recorded under an old
   spelling still count. */
function playerCareer(nameOrNames, matches){
  matches = matches.filter(m => !playerStatsExcluded(m));
  const names = (Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames]);
  const seen = new Set();
  const careers = [];
  names.forEach(n => {
    const key = (n || "").trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const c = singleNameCareer(key, matches);
    if (c) careers.push(c);
  });
  return careers.length ? mergeCareers(careers) : null;
}

function singleNameCareer(key, matches){
  const t = aggregatePlayerStats(matches).find(x => x.name.toLowerCase() === key);
  if (!t) return null;
  // Per-innings extras aggregatePlayerStats doesn't keep: highest score,
  // 50s/100s/ducks, bowling innings and best bowling.
  let highScore = null, fifties = 0, hundreds = 0, ducks = 0, bowlInnings = 0, best = null;
  matches.forEach(m => m.innings.forEach(inn => {
    const bn = inn.batting.order.find(n => n.toLowerCase() === key);
    if (bn){
      const b = inn.batting.stats[bn];
      if (!highScore || b.runs > highScore.runs || (b.runs === highScore.runs && !b.out && highScore.out)) highScore = { runs: b.runs, out: !!b.out };
      if (b.runs >= 100) hundreds++; else if (b.runs >= 50) fifties++;
      if (b.out && b.runs === 0) ducks++;
    }
    const wn = inn.bowling.order.find(n => n.toLowerCase() === key);
    if (wn){
      const w = inn.bowling.stats[wn];
      if (w.legalBalls > 0 || w.wickets > 0){
        bowlInnings++;
        if (!best || w.wickets > best.wickets || (w.wickets === best.wickets && w.runs < best.runs)) best = { wickets: w.wickets, runs: w.runs };
      }
    }
  }));
  return {
    matches: t.matches, points: t.points,
    innings: t.innings, notOuts: t.notOuts, runs: t.runs, balls: t.balls, fours: t.fours, sixes: t.sixes,
    highScore, fifties, hundreds, ducks,
    bowlInnings, wickets: t.wickets, legalBalls: t.legalBalls, runsConceded: t.runsConceded, maidens: t.maidens, best,
    catches: t.catches, runouts: t.runouts
  };
}

/* Sums the additive fields and re-derives every ratio, so a merged profile's
   average/strike rate/economy are computed over the combined totals rather
   than averaged from the parts. */
function mergeCareers(list){
  const sum = k => list.reduce((a, c) => a + c[k], 0);
  const c = {};
  ["matches", "points", "innings", "notOuts", "runs", "balls", "fours", "sixes", "fifties", "hundreds", "ducks",
   "bowlInnings", "wickets", "legalBalls", "runsConceded", "maidens", "catches", "runouts"].forEach(k => { c[k] = sum(k); });
  c.highScore = null; c.best = null;
  list.forEach(x => {
    const h = x.highScore;
    if (h && (!c.highScore || h.runs > c.highScore.runs || (h.runs === c.highScore.runs && !h.out && c.highScore.out))) c.highScore = { runs: h.runs, out: h.out };
    const b = x.best;
    if (b && (!c.best || b.wickets > c.best.wickets || (b.wickets === c.best.wickets && b.runs < c.best.runs))) c.best = { wickets: b.wickets, runs: b.runs };
  });
  const dismissals = c.innings - c.notOuts;
  c.average = dismissals > 0 ? c.runs / dismissals : null;
  c.strikeRate = c.balls > 0 ? (c.runs / c.balls) * 100 : null;
  c.economy = c.legalBalls > 0 ? c.runsConceded / (c.legalBalls / 6) : null;
  c.bowlAverage = c.wickets > 0 ? c.runsConceded / c.wickets : null;
  c.bowlStrikeRate = c.wickets > 0 ? c.legalBalls / c.wickets : null;
  c.fieldDismissals = c.catches + c.runouts;
  return c;
}

/* Error text if `name` has already played for the *other* side in this
   match (a player can't be on both teams), else null. */
function playerSideConflict(match, name, teamKey){
  const owner = playerTeamInMatch(match, name);
  if (owner && owner !== teamKey) return `${name} already plays for ${teamName(match, owner)} in this match.`;
  return null;
}

/* Which of `pool` (a squad, the club roster, the guest players list) can be
   offered as a one-tap pick for the current innings, in `role`:
   - "batter": the batting side, minus anyone out or already at the crease;
   - "bowler": the bowling side, minus anyone who has already bowled (they
     have their own rows with figures) and the previous over's bowler;
   - "fielder": the bowling side.
   Anyone already on the other side is dropped; duplicates (any case) too.
   `inn` defaults to the innings in play (naming an unnamed player later
   passes the innings they played in). */
function pickCandidates(match, pool, role, inn){
  inn = inn || currentInnings(match);
  const side = role === "batter" ? inn.battingTeam : inn.bowlingTeam;
  const lc = n => n.toLowerCase();
  const skip = new Set();
  if (role === "batter"){
    inn.batting.order.forEach(n => { if (inn.batting.stats[n].out) skip.add(lc(n)); });
    [inn.striker, inn.nonStriker].forEach(n => { if (n) skip.add(lc(n)); });
  } else if (role === "bowler"){
    inn.bowling.order.forEach(n => skip.add(lc(n)));
    if (inn.lastOverBowler) skip.add(lc(inn.lastOverBowler));
  }
  const out = [];
  (pool || []).forEach(raw => {
    const n = (raw || "").trim();
    if (!n || skip.has(lc(n)) || playerSideConflict(match, n, side)) return;
    skip.add(lc(n));
    out.push(n);
  });
  return out;
}

function startSecondInnings(match){
  const i1 = match.innings[0];
  const target = i1.runs + 1;
  const cfg = { ballsPerOver: match.ballsPerOver, wideRuns: i1.wideBaseRuns, noBallRuns: i1.noBallBaseRuns, freeHitOnNoBall: i1.freeHitOnNoBall, lastManStands: i1.lastManStands };
  match.innings.push(createInnings(i1.bowlingTeam, i1.battingTeam, target, match.playersPerSide, match.oversLimit, cfg));
  match.status = "opening";
}

function matchResult(match){
  const [i1, i2] = match.innings;
  const bpo = match.ballsPerOver || 6;
  if (i2.runs >= i2.target){
    // No players limit -> no wickets margin; no overs limit -> no "overs left".
    const wl = i2.maxWickets != null ? i2.maxWickets - i2.wickets : null;
    const left = i2.oversLimit != null && i2.legalBalls != null ? ` (${oversDisplay(i2.oversLimit * bpo - i2.legalBalls, bpo)} overs left)` : "";
    const margin = wl != null ? ` by ${wl} wicket${wl === 1 ? "" : "s"}` : "";
    return `${teamName(match, i2.battingTeam)} won${margin}${left}`;
  }
  if (i2.runs === i1.runs) return "Match tied";
  const margin = i1.runs - i2.runs;
  return `${teamName(match, i1.battingTeam)} won by ${margin} run${margin === 1 ? "" : "s"}`;
}

function afterBall(match){
  const inn = currentInnings(match);
  if (inn.complete){
    if (match.innings.length === 1) match.status = "innings_break";
    else { match.status = "complete"; match.result = matchResult(match); }
  }
}

/* Ends the match immediately, at any point (before openers are even
   named, mid-innings, at the break — wherever), with the other team
   declared the winner. Deliberately separate from matchResult/afterBall:
   there's no runs margin or chase to compute, and match.innings[1] may
   not exist yet. */
function forfeitMatch(match, forfeitingTeamKey){
  const winnerKey = forfeitingTeamKey === "A" ? "B" : "A";
  match.forfeited = true;
  match.forfeitedBy = forfeitingTeamKey;
  match.status = "complete";
  match.result = `${teamName(match, winnerKey)} won — ${teamName(match, forfeitingTeamKey)} forfeited the match`;
}

/* True once anything at all has been recorded -- a delivery, an extra, or
   a completed innings. Before that, changing who bats first loses nothing. */
function matchHasStarted(match){
  return match.innings.length > 1 || match.innings.some(inn =>
    inn.complete || inn.legalBalls > 0 || inn.runs > 0 || inn.wickets > 0 || inn.currentOverEvents.length || inn.overs.length);
}

/* The same fixture from ball one: every playing condition kept, only
   `battingFirst` (optionally) changed. This is how a reversed toss is
   fixed -- before a ball it just flips the sides; after, it discards what
   was scored (the UI warns and snapshots first, so Undo can bring it back).
   UI-only extras that recordBall never reads (club, match type, squads,
   visitor name) are carried over so the restart is the same fixture. */
const MATCH_CARRY_FIELDS = ["clubId", "matchType", "squads", "guestNames", "opponentName", "anonymous", "reopenedFrom"];
function restartMatch(match, battingFirst){
  const i1 = match.innings[0];
  const fresh = createMatch({
    teamA: match.teamA, teamB: match.teamB,
    oversLimit: match.oversLimit, playersPerSide: match.playersPerSide,
    battingFirst: battingFirst || match.battingFirst,
    ballsPerOver: match.ballsPerOver, wideRuns: i1.wideBaseRuns, noBallRuns: i1.noBallBaseRuns,
    wideEnabled: match.wideEnabled, noBallEnabled: match.noBallEnabled,
    freeHitOnNoBall: match.freeHitOnNoBall, lastManStands: match.lastManStands,
    requireFielderOnCatch: match.requireFielderOnCatch, requireFielderOnRunout: match.requireFielderOnRunout,
    presetId: match.presetId, presetName: match.presetName, tournamentId: match.tournamentId,
    tossWinner: match.tossWinner
  });
  MATCH_CARRY_FIELDS.forEach(k => { if (match[k] !== undefined) fresh[k] = JSON.parse(JSON.stringify(match[k])); });
  return fresh;
}

/* Has this name batted, bowled or fielded in the match yet? */
function playerHasPlayed(match, name){
  const key = (name || "").trim().toLowerCase();
  const has = list => list.some(n => n.toLowerCase() === key);
  return !!key && match.innings.some(inn => has(inn.batting.order) || has(inn.bowling.order) || has(inn.fielding.order));
}

/* Club-tournament squads (match.squads) can change for one match -- a
   player lent to the other side, or a late arrival. Only for players who
   haven't played yet: someone who has already batted or bowled for one
   side would be on both. Saved tournament teams are untouched. Both
   return an error string, or null on success (squads mutated in place). */
function moveSquadPlayer(match, name){
  if (!match.squads) return "This match has no squads.";
  const key = (name || "").trim().toLowerCase();
  const from = ["A", "B"].find(k => (match.squads[k] || []).some(n => n.toLowerCase() === key));
  if (!from) return `${name} isn't in either squad.`;
  if (playerHasPlayed(match, name)) return `${name} has already played for ${teamName(match, from)} in this match.`;
  const to = from === "A" ? "B" : "A";
  const real = match.squads[from].find(n => n.toLowerCase() === key);
  match.squads[from] = match.squads[from].filter(n => n.toLowerCase() !== key);
  match.squads[to] = [...(match.squads[to] || []), real];
  return null;
}
/* A saved guest team (state.teams, { playerIds }) -> squad names, so guest
   matches get the same per-side squads club tournament teams give. Unknown
   ids are skipped; null team -> []. `players` is state.players. */
function guestTeamSquad(team, players){
  if (!team) return [];
  return (team.playerIds || []).map(id => players[id] && players[id].name).filter(Boolean);
}
function addSquadPlayer(match, name, teamKey){
  if (!match.squads) return "This match has no squads.";
  name = (name || "").trim();
  if (!name) return "Type a name.";
  const key = name.toLowerCase();
  const inSquad = ["A", "B"].find(k => (match.squads[k] || []).some(n => n.toLowerCase() === key));
  if (inSquad) return `${name} is already in ${teamName(match, inSquad)}'s squad.`;
  const conflict = playerSideConflict(match, name, teamKey);
  if (conflict) return conflict;
  match.squads[teamKey] = [...(match.squads[teamKey] || []), name];
  return null;
}

/* What a scorer typed in a name box -> the player it means, using the club
   roster's nicknames and jersey numbers (supabase/010). An exact name wins;
   otherwise a nickname or "#7" that matches exactly one roster player gives
   that player's name. Anything else comes back unchanged (a new or guest
   name). `roster` is [{ name, nickname, jersey_no }]. Case-insensitive. */
function resolvePlayerAlias(value, roster){
  const typed = (value || "").trim();
  const key = typed.toLowerCase();
  if (!key) return typed;
  const list = roster || [];
  const byName = list.find(p => p.name && p.name.toLowerCase() === key);
  if (byName) return byName.name;
  const byNick = list.filter(p => p.nickname && p.nickname.trim().toLowerCase() === key);
  if (byNick.length === 1) return byNick[0].name;
  const jersey = /^#\s*(\d{1,3})$/.exec(typed);
  if (jersey){
    const byNo = list.filter(p => p.jersey_no != null && String(p.jersey_no) === String(parseInt(jersey[1], 10)));
    if (byNo.length === 1) return byNo[0].name;
  }
  return typed;
}

/* Guest players (club tournaments): people playing for a side who aren't
   club members. Their names sit in `match.guestNames` (from the saved
   teams, or added in Switch players), and registerMatchPlayer skips them,
   so nothing about a guest is stored on the club roster or the platform's
   players list. Case-insensitive. */
function isGuestInMatch(match, name){
  const key = (name || "").trim().toLowerCase();
  return !!key && (match.guestNames || []).some(n => n.toLowerCase() === key);
}
/* The team-builder key for a guest: tournament_teams.players entries need an
   id, but a guest has no players row -- so it's derived from the name. */
function guestPlayerKey(name){ return "guest:" + (name || "").trim().toLowerCase(); }

/* With no overs limit or no players limit an innings may never end on its
   own, so the scorer can close it by hand (endInnings) -- from the live
   screen and from the new-batsman/new-bowler sheets, which otherwise
   block everything until a name is entered. */
function canEndInningsByHand(inn){
  return !inn.complete && (inn.oversLimit == null || inn.maxWickets == null);
}

/* --- cross-match aggregation: MVP/MOTM, leaderboards, standings ---
   Pure functions over one or more completed matches, kept DOM-free like
   the rest of the engine so they're directly unit-testable. */
function calcPlayerPoints(bat, bowl, field){
  let pts = 0;
  if (bat){
    pts += bat.runs * MVP_POINTS.perRun;
    pts += bat.fours * MVP_POINTS.perFour;
    pts += bat.sixes * MVP_POINTS.perSix;
    if (bat.runs >= 100) pts += MVP_POINTS.century;
    else if (bat.runs >= 50) pts += MVP_POINTS.fifty;
    if (bat.balls > 0 && !bat.out) pts += MVP_POINTS.notOut;
  }
  if (bowl){
    pts += bowl.wickets * MVP_POINTS.perWicket;
    pts += bowl.maidens * MVP_POINTS.perMaiden;
  }
  if (field){
    pts += field.catches * MVP_POINTS.perCatch;
    pts += field.runouts * MVP_POINTS.perRunOut;
  }
  return pts;
}

function emptyPlayerTotal(name){
  return {
    name, runs: 0, balls: 0, fours: 0, sixes: 0, notOuts: 0, innings: 0,
    wickets: 0, legalBalls: 0, runsConceded: 0, maidens: 0,
    catches: 0, runouts: 0, points: 0, matches: 0
  };
}

function foldInningsIntoTotals(totals, inn){
  // Placeholders ("Bat ?1") aren't people until they're named.
  inn.batting.order.forEach(name => {
    if (isUnnamedPlayer(name)) return;
    const s = inn.batting.stats[name];
    const t = totals[name] || (totals[name] = emptyPlayerTotal(name));
    t.runs += s.runs; t.balls += s.balls; t.fours += s.fours; t.sixes += s.sixes;
    t.innings += 1;
    if (!s.out) t.notOuts += 1;
    t.points += calcPlayerPoints(s, null, null);
  });
  inn.bowling.order.forEach(name => {
    if (isUnnamedPlayer(name)) return;
    const b = inn.bowling.stats[name];
    const t = totals[name] || (totals[name] = emptyPlayerTotal(name));
    t.wickets += b.wickets; t.legalBalls += b.legalBalls; t.runsConceded += b.runs; t.maidens += b.maidens;
    t.points += calcPlayerPoints(null, b, null);
  });
  inn.fielding.order.forEach(name => {
    const f = inn.fielding.stats[name];
    const t = totals[name] || (totals[name] = emptyPlayerTotal(name));
    t.catches += f.catches; t.runouts += f.runouts;
    t.points += calcPlayerPoints(null, null, f);
  });
}

function matchPlayerNames(match){
  const names = new Set();
  match.innings.forEach(inn => {
    inn.batting.order.forEach(n => names.add(n));
    inn.bowling.order.forEach(n => names.add(n));
    inn.fielding.order.forEach(n => names.add(n));
  });
  return names;
}

/* Matches left out of every player figure (leaderboards, MVP, MOTM,
   profiles, tournament bests) -- team totals and standings still count:
   a "no names" match, whose Batter 1 / Over 3 aren't people
   (fillAnonymousSlots). A caught-up match or one whose score was set by hand
   (match.caughtUp) still counts: its scorecard lines are what each player
   was credited with, and only the runs nobody was credited with ("not
   attributed") are missing -- so player stats stay the sum of the scorecards. */
function playerStatsExcluded(match){
  return !!(match && match.anonymous);
}

function aggregatePlayerStats(matches){
  const totals = {};
  matches.filter(match => !playerStatsExcluded(match)).forEach(match => {
    match.innings.forEach(inn => foldInningsIntoTotals(totals, inn));
    matchPlayerNames(match).forEach(name => { if (totals[name]) totals[name].matches += 1; });
  });
  return Object.values(totals).sort((a, b) => b.points - a.points);
}

function pickMatchMOTM(match){
  if (playerStatsExcluded(match)) return null;
  const totals = {};
  match.innings.forEach(inn => foldInningsIntoTotals(totals, inn));
  const ranked = Object.values(totals).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.runs !== a.runs) return b.runs - a.runs;
    return b.wickets - a.wickets;
  });
  return ranked.length ? ranked[0].name : null;
}

function computeStandings(matches, tournamentPreset){
  const teams = {};
  function ensureTeam(name){
    return teams[name] || (teams[name] = {
      name, played: 0, won: 0, lost: 0, tied: 0, points: 0,
      runsFor: 0, oversFor: 0, runsAgainst: 0, oversAgainst: 0
    });
  }
  matches.forEach(match => {
    const nameA = teamName(match, "A"), nameB = teamName(match, "B");
    if (match.forfeited){
      // Counts for points, but deliberately excluded from NRR — the
      // innings that were played (if any) weren't played to a finish,
      // so folding their runs/overs in would skew run rate.
      ensureTeam(nameA); ensureTeam(nameB);
      ensureTeam(nameA).played += 1; ensureTeam(nameB).played += 1;
      const winner = teamName(match, match.forfeitedBy === "A" ? "B" : "A");
      const loser = winner === nameA ? nameB : nameA;
      teams[winner].won += 1; teams[loser].lost += 1;
      teams[winner].points += tournamentPreset.pointsForWin;
      teams[loser].points += tournamentPreset.pointsForLoss;
      return;
    }
    const [i1, i2] = match.innings;
    if (!i2 || !i2.complete) return; // only fully-played two-innings matches count
    ensureTeam(nameA); ensureTeam(nameB);
    const bpo = match.ballsPerOver || 6;
    // A result-only match may leave overs blank (legalBalls null): that
    // innings counts its full quota, like all out -- or, with no overs limit,
    // the match stays out of NRR altogether.
    const faced = match.innings.map(inn =>
      inn.oversLimit != null && (inn.completeReason === "allout" || inn.legalBalls == null) ? inn.oversLimit
        : inn.legalBalls == null ? null : inn.legalBalls / bpo);
    if (!faced.includes(null)) match.innings.forEach((inn, n) => {
      const bt = ensureTeam(teamName(match, inn.battingTeam));
      const bwt = ensureTeam(teamName(match, inn.bowlingTeam));
      bt.runsFor += inn.runs; bt.oversFor += faced[n];
      bwt.runsAgainst += inn.runs; bwt.oversAgainst += faced[n];
    });
    ensureTeam(nameA).played += 1; ensureTeam(nameB).played += 1;
    if (i2.runs === i1.runs){
      teams[nameA].tied += 1; teams[nameB].tied += 1;
      teams[nameA].points += tournamentPreset.pointsForTie; teams[nameB].points += tournamentPreset.pointsForTie;
    } else {
      const winner = i2.runs > i1.runs ? teamName(match, i2.battingTeam) : teamName(match, i1.battingTeam);
      const loser = winner === nameA ? nameB : nameA;
      teams[winner].won += 1; teams[loser].lost += 1;
      teams[winner].points += tournamentPreset.pointsForWin;
      teams[loser].points += tournamentPreset.pointsForLoss;
    }
  });
  const standings = Object.values(teams).map(t => ({
    ...t,
    nrr: (t.oversFor > 0 && t.oversAgainst > 0) ? (t.runsFor / t.oversFor) - (t.runsAgainst / t.oversAgainst) : 0
  }));
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (tournamentPreset.useNRR && b.nrr !== a.nrr) return b.nrr - a.nrr;
    return 0;
  });
  return standings;
}

/* --- result-only matches (tournaments) ---
   A tournament fixture can be recorded without ball-by-ball scoring: each
   side's runs and wickets, overs optional. The match is an ordinary match
   object (so standings, fixtures and the archive need nothing new) with
   `resultOnly: true`, both innings complete and no players in them; a blank
   overs field is stored as legalBalls null (see computeStandings). */
// "12.3" -> legal balls; "" -> null; anything else (or a ball part >= the
// over's length) -> NaN.
function parseOversInput(v, ballsPerOver){
  const t = String(v == null ? "" : v).trim();
  if (!t) return null;
  const m = /^(\d{1,3})(?:\.(\d))?$/.exec(t);
  const bpo = ballsPerOver || 6;
  if (!m || (m[2] != null && +m[2] >= bpo)) return NaN;
  return +m[1] * bpo + (m[2] != null ? +m[2] : 0);
}
// scores: [{ runs, wickets, balls }] in batting order. Returns a message or null.
function resultOnlyError(config, scores){
  const probe = createMatch(config);
  const inn = probe.innings[0], bpo = inn.ballsPerOver;
  const quota = inn.oversLimit != null ? inn.oversLimit * bpo : null;
  const team = n => teamName(probe, n === 0 ? probe.battingFirst : (probe.battingFirst === "A" ? "B" : "A"));
  for (let n = 0; n < 2; n++){
    const sc = scores[n] || {};
    if (!Number.isInteger(sc.runs) || sc.runs < 0 || sc.runs > 999) return `Enter ${team(n)}'s runs (0–999).`;
    const maxW = inn.maxWickets != null ? inn.maxWickets : 99;
    if (!Number.isInteger(sc.wickets) || sc.wickets < 0 || sc.wickets > maxW) return `${team(n)}'s wickets must be 0–${maxW}.`;
    if (Number.isNaN(sc.balls)) return `${team(n)}'s overs should look like 18 or 18.3 (up to ${bpo - 1} balls after the dot).`;
    if (sc.balls != null && quota != null && sc.balls > quota) return `${team(n)} can't have faced more than ${inn.oversLimit} overs.`;
  }
  if (scores[1].runs > scores[0].runs + 6) return `${team(1)} needed ${scores[0].runs + 1} — a chase ends once the target is reached, so they can't have more than ${scores[0].runs + 6}.`;
  return null;
}
function createResultOnlyMatch(config, scores){
  const m = createMatch(config);
  const fill = (inn, sc) => {
    inn.runs = sc.runs; inn.wickets = sc.wickets; inn.legalBalls = sc.balls == null ? null : sc.balls;
    const quota = inn.oversLimit != null ? inn.oversLimit * inn.ballsPerOver : null;
    inn.complete = true;
    inn.completeReason = inn.target != null && inn.runs >= inn.target ? "target"
      : isAllOut(inn) ? "allout"
      : quota != null && inn.legalBalls === quota ? "overs" : "closed";
  };
  fill(m.innings[0], scores[0]);
  startSecondInnings(m);
  fill(m.innings[1], scores[1]);
  m.resultOnly = true;
  m.status = "complete";
  m.result = matchResult(m);
  m.motm = null;
  return m;
}

/* --- "no names" scoring ---
   A match started with `anonymous: true` never asks for a name: every empty
   slot is filled with a placeholder -- batters "Batter 1", "Batter 2"... in
   the order they come in, and each over's bowler "Over N" (one per over, so
   the no-consecutive-overs rule can't trip and no figures are made up).
   Called from render() after every change; returns true if it filled
   anything. Placeholders aren't people: these matches are left out of
   player stats, MVP and profiles (aggregatePlayerStats/pickMatchMOTM/
   playerCareer). */
function fillAnonymousSlots(match){
  if (!match || !match.anonymous || (match.status !== "opening" && match.status !== "live")) return false;
  const inn = currentInnings(match);
  if (inn.complete) return false;
  let changed = false;
  if (match.status === "opening"){ match.status = "live"; changed = true; }
  while (pendingBatsmanSlot(inn)){ sendInBatter(inn, `Batter ${inn.batting.order.length + 1}`); changed = true; }
  if (!inn.bowler){ setBowler(inn, `Over ${Math.floor(inn.legalBalls / inn.ballsPerOver) + 1}`); changed = true; }
  return changed;
}

/* --- unnamed players, named later ---
   The scorer doesn't always know who walked out or who's bowling. Instead of
   blocking scoring, the new-batsman / new-bowler sheet can carry on with a
   placeholder ("Bat ?1", "Bowl ?2" -- numbered across the
   whole match, so one name never stands for two people) and the real name is
   filled in later (nameUnnamedPlayer). Each unnamed over gets its own
   placeholder: it might be the same person as another, which naming sorts out
   (two bowler placeholders named the same are merged). Placeholders aren't
   people: they're skipped by every player figure (foldInningsIntoTotals,
   tournament bests) until they're named. */
// Short on purpose (it sits in the board's name column); the "?" keeps it
// apart from a "no names" match's "Batter 1" / "Over 1".
const UNNAMED_LABEL = { batter: "Bat", bowler: "Bowl" };
const UNNAMED_RE = /^(bat|bowl) \?(\d+)$/i;
function isUnnamedPlayer(name){ return UNNAMED_RE.test((name || "").trim()); }
function nextUnnamedName(match, role){
  let max = 0;
  match.innings.forEach(inn => [...inn.batting.order, ...inn.bowling.order].forEach(n => {
    const mt = UNNAMED_RE.exec(n);
    if (mt && mt[1].toLowerCase() === UNNAMED_LABEL[role].toLowerCase()) max = Math.max(max, parseInt(mt[2], 10));
  }));
  return `${UNNAMED_LABEL[role]} ?${max + 1}`;
}
// Every placeholder still in the match: [{ name, inn (index), role }].
function unnamedPlayers(match){
  const out = [];
  match.innings.forEach((inn, idx) => {
    inn.batting.order.forEach(n => { if (isUnnamedPlayer(n)) out.push({ name: n, inn: idx, role: "batter" }); });
    inn.bowling.order.forEach(n => { if (isUnnamedPlayer(n)) out.push({ name: n, inn: idx, role: "bowler" }); });
  });
  return out;
}
// The bowler of each over in order (null for a catch-up gap), plus whoever is
// bowling the over in progress -- for the "no two overs in a row" rule.
function overBowlerSequence(inn){
  const seq = inn.overs.map(o => o.gap ? null : o.bowler);
  // (An innings that ended on an over's last ball keeps that bowler in the
  // slot -- that over is already in inn.overs.)
  if (inn.bowler && (inn.currentOverEvents.length || !inn.complete)) seq.push(inn.bowler);
  return seq;
}
/* Who `to` would be once `from` (a placeholder) is named: the spelling
   already used in this match if there is one, else `to` as typed. */
function unnamedTarget(match, to){
  const key = (to || "").trim().toLowerCase();
  for (const inn of match.innings){
    const hit = [...inn.batting.order, ...inn.bowling.order, ...inn.fielding.order].find(n => n.toLowerCase() === key);
    if (hit) return hit;
  }
  return (to || "").trim();
}
// Error text if placeholder `from` can't become `to`, else null.
function nameUnnamedError(match, from, to){
  const entry = unnamedPlayers(match).find(u => u.name === from);
  if (!entry) return "That player has already been named.";
  const name = unnamedTarget(match, to);
  if (!name) return "Enter a name.";
  if (isUnnamedPlayer(name)) return "Pick a real name.";
  const inn = match.innings[entry.inn];
  const key = name.toLowerCase();
  if (entry.role === "batter"){
    const conflict = playerSideConflict(match, name, inn.battingTeam);
    if (conflict) return conflict;
    if (inn.batting.order.some(n => n.toLowerCase() === key)) return `${name} has already batted in this innings.`;
    return null;
  }
  const conflict = playerSideConflict(match, name, inn.bowlingTeam);
  if (conflict) return conflict;
  const seq = overBowlerSequence(inn).map(n => n === from ? name : n);
  for (let i = 1; i < seq.length; i++){
    if (seq[i] && seq[i - 1] && seq[i].toLowerCase() === key && seq[i - 1].toLowerCase() === key) return `${name} would have bowled two overs in a row.`;
  }
  return null;
}
/* A copy of `match` with placeholder `from` replaced by `to` everywhere: the
   slots, stats, over events, commentary fields, howOut text, fall of wickets
   and the action log (so a later ball edit replays with the real name). A
   bowler placeholder named after someone who already bowled in that innings
   is merged into their figures. Check nameUnnamedError first. */
function nameUnnamedPlayer(match, from, to){
  const entry = unnamedPlayers(match).find(u => u.name === from);
  const name = unnamedTarget(match, to);
  const m = JSON.parse(JSON.stringify(match));
  if (entry && entry.role === "bowler"){
    const inn = m.innings[entry.inn];
    const into = inn.bowling.stats[name], b = inn.bowling.stats[from];
    if (into && b){
      into.legalBalls += b.legalBalls; into.runs += b.runs; into.wickets += b.wickets; into.maidens += b.maidens;
      // The over in progress belongs to whoever is bowling it now.
      if (inn.bowler === from){ into.curOverRuns = b.curOverRuns; into.curOverLegal = b.curOverLegal; }
      delete inn.bowling.stats[from];
      inn.bowling.order = inn.bowling.order.filter(n => n !== from);
    }
  }
  // "Bowl ?1" must not also hit "Bowl ?10".
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)", "g");
  const walk = v => {
    if (typeof v === "string") return v === from ? name : v.replace(re, name);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object"){
      const o = {};
      Object.keys(v).forEach(k => { o[k === from ? name : k] = walk(v[k]); });
      return o;
    }
    return v;
  };
  return walk(m);
}

/* --- catching up the score ---
   A scorer who stopped updating the board can jump to where the game is now
   instead of replaying every ball: the totals, every batter who got out (how,
   the bowler, the fielder), who's batting and bowling now, and optionally
   each player's runs/balls/overs. It's laid on top of what's already
   recorded, which never goes backwards, and leaves one "gap" entry in
   inn.overs ({ gap: { from/to balls, runs, wickets, and every batter's and
   bowler's figures at that point } }) so ball by ball and commentary can say
   where the score was caught up. Whatever isn't credited to a player shows
   as "not attributed" (catchUpUnattributed) and isn't in anyone's player
   stats (match.caughtUp; see playerStatsExcluded). Gap wickets go into fallOfWickets with
   `catchUp: true` and the score/balls of the catch-up (the real moment isn't
   known), so the partnership counter restarts from there.

   data: { runs, wickets, balls (legal), extras: { wides, noBalls, byes, legByes },
           finished,            -- this innings is over (else it ends on its own
                                   only by target / all out / overs)
           batters: [{ name, status: "striker"|"nonStriker"|"out", runs, balls,
                       wicketType, bowler, fielder }]
                                -- every batter not already out (those at the
                                   crease too) plus new ones; runs/balls null =
                                   leave as recorded,
           bowlers: [{ name, balls, runs }],   -- null = leave as recorded
           bowlerNow, lastOver }  -- bowling the over now (needed mid-over);
                                     bowled the last one (needed at x.0)
   A "no names" match uses only the totals and `finished`. */
const CATCH_UP_DISMISSALS = ["bowled", "caught", "lbw", "stumped", "hitwicket", "runout"];
function catchUpWillFinish(inn, data){
  const quota = inn.oversLimit != null ? inn.oversLimit * inn.ballsPerOver : null;
  return !!data.finished
    || (inn.target != null && data.runs >= inn.target)
    || (inn.maxWickets != null && data.wickets >= inn.maxWickets)
    || (quota != null && data.balls >= quota);
}
function catchUpHowOut(wicketType, bowler, fielder){
  if (wicketType === "runout") return fielder ? `run out (${fielder})` : "run out";
  if (wicketType === "caught" && fielder) return `c ${fielder} b ${bowler}`;
  return `${WICKET_LABELS[wicketType]} b ${bowler}`;
}
/* Who's pinned to a point in an over: mid-over the bowler of the over in
   progress has bowled B % bpo balls of it; at x.0 the last over's bowler has
   just finished one (so whole overs, at least one) and the next over's has
   none of theirs yet. With no figures entered, their balls are raised to the
   smallest count >= what's recorded that fits (catchUpRaise) -- a lower
   bound, the rest stays unattributed; figures that were entered must fit. */
function catchUpPins(inn, data){
  const bpo = inn.ballsPerOver, rem = data.balls % bpo, lc = n => (n || "").trim().toLowerCase();
  const pins = [];
  if (rem && lc(data.bowlerNow)) pins.push({ name: data.bowlerNow.trim(), rem, min: rem, why: "now" });
  if (!rem && lc(data.lastOver)) pins.push({ name: data.lastOver.trim(), rem: 0, min: bpo, why: "last" });
  if (!rem && lc(data.bowlerNow)) pins.push({ name: data.bowlerNow.trim(), rem: 0, min: 0, why: "next" });
  return pins;
}
function catchUpRaise(n, pin, bpo){
  let x = Math.max(n, pin.min);
  while (x % bpo !== pin.rem) x++;
  return x;
}
// Error text, or null when `data` can be applied to the innings in play.
function catchUpError(match, data){
  if (!match || (match.status !== "opening" && match.status !== "live")) return "There's no innings in progress to catch up.";
  const inn = currentInnings(match);
  if (inn.complete) return "This innings is already over.";
  const bpo = inn.ballsPerOver;
  const lc = n => (n || "").trim().toLowerCase();
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const ov = n => oversDisplay(n, bpo);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  if (data.balls == null || Number.isNaN(data.balls) || !int(data.balls, 0, 99999)) return `Enter the overs bowled, like 6 or 6.1 (up to ${bpo - 1} balls after the dot).`;
  if (data.balls < inn.legalBalls) return `Overs can't go back: ${ov(inn.legalBalls)} are already scored.`;
  const quota = inn.oversLimit != null ? inn.oversLimit * bpo : null;
  if (quota != null && data.balls > quota) return `It's a ${plural(inn.oversLimit, "over")} innings, so overs can't be more than ${inn.oversLimit}.`;
  if (!int(data.runs, 0, 9999)) return "Enter the team's runs.";
  if (data.runs < inn.runs) return `Runs can't go down: ${inn.runs} are already scored.`;
  const ex = data.extras || {};
  const EX = [["wides", "Wides"], ["noBalls", "No-balls"], ["byes", "Byes"], ["legByes", "Leg byes"]];
  for (const [k, label] of EX){
    if (!int(ex[k], 0, 999)) return `${label} must be a number (0 or more).`;
    if (ex[k] < inn.extras[k]) return `${label} can't go down: ${inn.extras[k]} already scored.`;
  }
  const extrasTotal = EX.reduce((a, [k]) => a + ex[k], 0);
  if (extrasTotal > data.runs) return `Extras (${extrasTotal}) can't be more than the total (${data.runs}).`;
  if (inn.target != null && data.runs > inn.target + 5) return `${teamName(match, inn.battingTeam)} needed ${inn.target}. A chase stops once it's reached, so they can't have more than ${inn.target + 5}.`;
  const maxW = inn.maxWickets != null ? inn.maxWickets : 99;
  if (!int(data.wickets, 0, maxW)) return `Wickets must be 0–${maxW}.`;
  if (data.wickets < inn.wickets) return `Wickets can't go down: ${inn.wickets} already fell.`;
  if (match.anonymous) return catchUpUnchanged(match, data) ? "Nothing has changed yet. Enter the score as it is now." : null;

  const finish = catchUpWillFinish(inn, data);
  const batters = data.batters || [], bowlers = data.bowlers || [];
  const existingOut = new Set(inn.batting.order.filter(n => inn.batting.stats[n].out).map(lc));
  const seen = new Set();
  for (const b of batters){
    if (!lc(b.name)) return "Every batter needs a name.";
    if (seen.has(lc(b.name))) return `${b.name} is listed twice.`;
    seen.add(lc(b.name));
    if (existingOut.has(lc(b.name))) return `${b.name} is already out.`;
    const conflict = playerSideConflict(match, b.name, inn.battingTeam);
    if (conflict) return conflict;
  }
  const missing = inn.batting.order.find(n => !inn.batting.stats[n].out && !seen.has(lc(n)));
  if (missing) return `${missing} has batted. Say whether they're still in or out.`;
  const outs = batters.filter(b => b.status === "out");
  const outCount = inn.wickets + outs.length;
  if (outCount !== data.wickets) return `Wickets say ${data.wickets}, but ${outCount} ${outCount === 1 ? "batter is" : "batters are"} out. Add or fix the batters who got out.`;
  const strikers = batters.filter(b => b.status === "striker").length, others = batters.filter(b => b.status === "nonStriker").length;
  if (strikers > 1 || others > 1) return "Only one batter can be on strike and one at the other end.";
  if (!finish){
    const alone = inn.lastManStands && inn.maxWickets != null && data.wickets === inn.maxWickets - 1;
    if (alone){ if (strikers + others !== 1) return "Last man stands: only one batter is left in."; }
    else if (!strikers || !others) return "Pick who's on strike and who's at the other end.";
  }

  const fieldSide = [];   // every fielding-side name the form mentions
  for (const b of outs){
    if (!CATCH_UP_DISMISSALS.includes(b.wicketType)) return `How was ${b.name} out?`;
    if (b.wicketType !== "runout" && !lc(b.bowler)) return `Who was bowling when ${b.name} got out?`;
    if (b.wicketType === "caught" && match.requireFielderOnCatch && !lc(b.fielder)) return `Who caught ${b.name}?`;
    if (b.wicketType === "runout" && match.requireFielderOnRunout && !lc(b.fielder)) return `Who ran ${b.name} out?`;
    if (b.wicketType !== "runout") fieldSide.push(b.bowler);
    if ((b.wicketType === "caught" || b.wicketType === "runout") && lc(b.fielder)) fieldSide.push(b.fielder);
  }
  const bowlerSeen = new Set();
  for (const b of bowlers){
    if (!lc(b.name)) return "Every bowler needs a name.";
    if (bowlerSeen.has(lc(b.name))) return `${b.name} is listed twice.`;
    bowlerSeen.add(lc(b.name));
    fieldSide.push(b.name);
  }
  if (lc(data.bowlerNow)) fieldSide.push(data.bowlerNow);
  if (lc(data.lastOver)) fieldSide.push(data.lastOver);
  const batNames = new Set([...inn.batting.order, ...batters.map(b => b.name)].map(lc));
  for (const n of fieldSide){
    if (batNames.has(lc(n))) return `${n.trim()} can't bat and bowl or field in the same innings. They'd be on both teams.`;
    const conflict = playerSideConflict(match, n.trim(), inn.bowlingTeam);
    if (conflict) return conflict;
  }
  if (!finish){
    const midOver = data.balls % bpo !== 0;
    if (midOver && !lc(data.bowlerNow)) return `Who's bowling the over in progress (${ov(data.balls)})?`;
    if (!midOver && data.balls > 0 && !lc(data.lastOver)) return `Who bowled the last over (up to ${ov(data.balls)})? They can't bowl the next one.`;
    if (!midOver && lc(data.bowlerNow) && lc(data.bowlerNow) === lc(data.lastOver)) return `${data.bowlerNow.trim()} bowled the last over, so they can't bowl the next one too.`;
  }

  const find = (order, n) => order.find(x => lc(x) === lc(n));
  let batRuns = 0, batBalls = 0;
  inn.batting.order.forEach(n => { const s = inn.batting.stats[n]; if (s.out){ batRuns += s.runs; batBalls += s.balls; } });
  for (const b of batters){
    const k = find(inn.batting.order, b.name), s = k ? inn.batting.stats[k] : null;
    if (b.runs != null && !int(b.runs, 0, 999)) return `${b.name}'s runs must be a number.`;
    if (b.balls != null && !int(b.balls, 0, 999)) return `${b.name}'s balls must be a number.`;
    if (s && b.runs != null && b.runs < s.runs) return `${k} already has ${s.runs} runs, so that can't go down.`;
    if (s && b.balls != null && b.balls < s.balls) return `${k} has already faced ${plural(s.balls, "ball")}.`;
    batRuns += b.runs != null ? b.runs : (s ? s.runs : 0);
    batBalls += b.balls != null ? b.balls : (s ? s.balls : 0);
  }
  const offBat = data.runs - extrasTotal;
  if (batRuns > offBat) return `The batters' runs add up to ${batRuns}, but only ${offBat} came off the bat (${data.runs} minus ${extrasTotal} extras).`;
  // a no-ball is faced too (recordBall counts it in the batter's balls)
  const noBallsBowled = inn.noBallBaseRuns > 0 ? Math.floor(ex.noBalls / inn.noBallBaseRuns) : Infinity;
  if (batBalls > data.balls + noBallsBowled) return `The batters have faced ${batBalls} balls, but only ${plural(data.balls, "ball")} (${ov(data.balls)} overs)${noBallsBowled ? ` and ${plural(noBallsBowled, "no-ball")}` : ""} have been bowled.`;

  const pins = catchUpPins(inn, data);
  const pinOf = n => pins.find(p => lc(p.name) === lc(n));
  for (const p of pins){
    const row = bowlers.find(b => lc(b.name) === lc(p.name));
    if (!row || row.balls == null || Number.isNaN(row.balls)) continue;
    if (p.why === "now" && row.balls % bpo !== p.rem) return `${p.name} is bowling the over in progress (${ov(data.balls)}), so their overs should end in .${p.rem}.`;
    if (p.why !== "now" && (row.balls % bpo !== 0 || row.balls < p.min)) return `${p.name} ${p.why === "last" ? "bowled the last over" : "starts the next over"}, so their overs should be whole (like ${p.why === "last" ? "2" : "0"}).`;
  }
  let bowlBalls = 0, bowlRuns = 0;
  const counted = new Set();
  inn.bowling.order.forEach(n => {
    if (bowlers.some(b => lc(b.name) === lc(n))) return;
    const p = pinOf(n);
    if (p) counted.add(lc(n));
    bowlBalls += p ? catchUpRaise(inn.bowling.stats[n].legalBalls, p, bpo) : inn.bowling.stats[n].legalBalls;
    bowlRuns += inn.bowling.stats[n].runs;
  });
  // a pinned bowler who isn't on the scorecard yet (or listed without overs)
  pins.forEach(p => {
    if (counted.has(lc(p.name)) || bowlers.some(b => lc(b.name) === lc(p.name))) return;
    counted.add(lc(p.name));
    bowlBalls += catchUpRaise(0, p, bpo);
  });
  for (const b of bowlers){
    const k = find(inn.bowling.order, b.name), s = k ? inn.bowling.stats[k] : null;
    if (b.balls != null && (Number.isNaN(b.balls) || !int(b.balls, 0, 99999))) return `${b.name}'s overs should look like 3 or 3.2 (up to ${bpo - 1} balls after the dot).`;
    if (b.runs != null && !int(b.runs, 0, 999)) return `${b.name}'s runs must be a number.`;
    if (s && b.balls != null && b.balls < s.legalBalls) return `${k} has already bowled ${ov(s.legalBalls)} overs.`;
    if (s && b.runs != null && b.runs < s.runs) return `${k} has already conceded ${s.runs} runs.`;
    const p = pinOf(b.name);
    bowlBalls += b.balls != null ? b.balls : p ? catchUpRaise(s ? s.legalBalls : 0, p, bpo) : (s ? s.legalBalls : 0);
    bowlRuns += b.runs != null ? b.runs : (s ? s.runs : 0);
  }
  if (bowlBalls > data.balls) return `The bowlers' overs add up to ${ov(bowlBalls)}, more than the ${ov(data.balls)} bowled.`;
  const offBowler = data.runs - ex.byes - ex.legByes;
  if (bowlRuns > offBowler) return `The bowlers have conceded ${bowlRuns}, but only ${offBowler} runs count against them (byes and leg byes don't).`;
  if (catchUpUnchanged(match, data)) return "Nothing has changed yet. Enter the score as it is now.";
  return null;
}
function catchUpUnchanged(match, data){
  const probe = JSON.parse(JSON.stringify(match));
  applyCatchUp(probe, data);
  const pick = inn => JSON.stringify([inn.runs, inn.wickets, inn.legalBalls, inn.extras, inn.batting, inn.bowling, inn.fielding,
    inn.striker, inn.nonStriker, inn.bowler, inn.lastOverBowler, inn.complete]);
  return pick(currentInnings(match)) === pick(currentInnings(probe));
}
// Mutates `match` (check catchUpError first). The UI snapshots before, so Undo walks it back.
function applyCatchUp(match, data){
  const inn = currentInnings(match);
  const bpo = inn.ballsPerOver;
  const lc = n => (n || "").trim().toLowerCase();
  const from = { balls: inn.legalBalls, runs: inn.runs, wickets: inn.wickets };
  const midOver = data.balls % bpo !== 0;
  // The over in progress keeps the balls it has, as a part over before the gap.
  if (inn.currentOverEvents.length) inn.overs.push({ bowler: inn.bowler, events: inn.currentOverEvents, partial: true });
  inn.currentOverEvents = [];
  const fallen = [];
  if (match.anonymous){
    // No names: the batters at the crease go first, then placeholder batters;
    // fillAnonymousSlots sends in the next ones and names the over's bowler.
    let need = data.wickets - inn.wickets;
    const out = n => { inn.batting.stats[n].out = true; inn.batting.stats[n].howOut = "out"; fallen.push(n); need--; };
    [inn.striker, inn.nonStriker].forEach(n => { if (n && need > 0) out(n); });
    while (need > 0){ const n = `Batter ${inn.batting.order.length + 1}`; ensureBatsman(inn, n); out(n); }
    if (inn.striker && inn.batting.stats[inn.striker].out) inn.striker = null;
    if (inn.nonStriker && inn.batting.stats[inn.nonStriker].out) inn.nonStriker = null;
    if (data.balls !== from.balls) inn.bowler = null;
  } else {
    // A typed name in another case is the same person (case-insensitive, like every name check).
    const keyOf = (order, n) => order.find(x => lc(x) === lc(n)) || n.trim();
    data.batters.forEach(b => {
      const name = keyOf(inn.batting.order, b.name);
      ensureBatsman(inn, name);
      const s = inn.batting.stats[name];
      if (b.runs != null) s.runs = b.runs;
      if (b.balls != null) s.balls = b.balls;
      if (b.status !== "out") return;
      const bowler = b.wicketType === "runout" ? null : keyOf(inn.bowling.order, b.bowler);
      const fielder = (b.wicketType === "caught" || b.wicketType === "runout") && lc(b.fielder)
        ? keyOf([...inn.fielding.order, ...inn.bowling.order], b.fielder) : null;
      s.out = true;
      s.howOut = catchUpHowOut(b.wicketType, bowler, fielder);
      if (bowler){ ensureBowler(inn, bowler); inn.bowling.stats[bowler].wickets += 1; }
      if (fielder){ ensureFielder(inn, fielder); inn.fielding.stats[fielder][b.wicketType === "caught" ? "catches" : "runouts"] += 1; }
      fallen.push(name);
    });
    (data.bowlers || []).forEach(b => {
      const name = keyOf(inn.bowling.order, b.name);
      ensureBowler(inn, name);
      const s = inn.bowling.stats[name];
      if (b.balls != null) s.legalBalls = b.balls;
      if (b.runs != null) s.runs = b.runs;
    });
    const at = status => { const b = data.batters.find(x => x.status === status); return b ? keyOf(inn.batting.order, b.name) : null; };
    inn.striker = at("striker"); inn.nonStriker = at("nonStriker");
    const now = lc(data.bowlerNow) ? keyOf(inn.bowling.order, data.bowlerNow) : null;
    const last = !midOver && lc(data.lastOver) ? keyOf(inn.bowling.order, data.lastOver) : null;
    if (now) ensureBowler(inn, now);
    if (last) ensureBowler(inn, last);
    catchUpPins(inn, data).forEach(p => {
      const row = (data.bowlers || []).find(b => lc(b.name) === lc(p.name));
      if (row && row.balls != null) return;
      const s = inn.bowling.stats[keyOf(inn.bowling.order, p.name)];
      s.legalBalls = catchUpRaise(s.legalBalls, p, bpo);
    });
    const samePlace = data.balls === from.balls && now === inn.bowler;
    if (!samePlace){
      inn.bowling.order.forEach(n => { inn.bowling.stats[n].curOverRuns = 0; inn.bowling.stats[n].curOverLegal = 0; });
      if (now && midOver) inn.bowling.stats[now].curOverLegal = data.balls % bpo;
      inn.lastOverBowler = midOver ? null : last;
    }
    inn.bowler = now;
  }
  inn.runs = data.runs; inn.legalBalls = data.balls; inn.wickets = data.wickets;
  inn.extras = { wides: data.extras.wides, noBalls: data.extras.noBalls, byes: data.extras.byes, legByes: data.extras.legByes };
  fallen.forEach((n, i) => inn.fallOfWickets.push({ score: data.runs, wicket: from.wickets + i + 1, over: oversDisplay(data.balls, bpo), balls: data.balls, batsman: n, catchUp: true }));
  inn.freeHit = false;
  if (midOver) inn.partOverUnknown = true; else delete inn.partOverUnknown;
  const batters = {}, bowlers = {};
  inn.batting.order.forEach(n => { const s = inn.batting.stats[n]; batters[n] = { runs: s.runs, balls: s.balls }; });
  inn.bowling.order.forEach(n => { const s = inn.bowling.stats[n]; bowlers[n] = { balls: s.legalBalls, runs: s.runs, wickets: s.wickets, maidens: s.maidens }; });
  inn.overs.push({ bowler: null, events: [], gap: {
    fromBalls: from.balls, fromRuns: from.runs, fromWickets: from.wickets,
    toBalls: data.balls, toRuns: data.runs, toWickets: data.wickets, batters, bowlers } });
  checkInningsComplete(inn);
  if (!inn.complete && data.finished){ inn.complete = true; inn.completeReason = "closed"; }
  if (!inn.complete && battingAlone(inn)){ inn.striker = inn.striker || inn.nonStriker; inn.nonStriker = null; }
  match.caughtUp = true;
  // Balls before a catch-up can't be edited: the log starts again from here.
  delete inn.log; delete inn.logBase;
  if (match.status === "opening") match.status = "live";
  afterBall(match);
}
/* What a caught-up innings couldn't credit to anyone: runs off the bat no
   batter has, and balls/runs no bowler has. null if it was never caught up. */
function catchUpUnattributed(inn){
  if (!inn.overs.some(o => o.gap)) return null;
  const sum = (side, k) => side.order.reduce((a, n) => a + (side.stats[n][k] || 0), 0);
  const e = inn.extras;
  return {
    batRuns: inn.runs - (e.wides + e.noBalls + e.byes + e.legByes) - sum(inn.batting, "runs"),
    bowlBalls: (inn.legalBalls || 0) - sum(inn.bowling, "legalBalls"),
    bowlRuns: inn.runs - e.byes - e.legByes - sum(inn.bowling, "runs")
  };
}

/* --- ball-by-ball commentary ---
   One line per delivery, oldest first, plus an "end of over" row after each
   completed over (its runs, the score, the bowler's figures). Built from the
   over events recordBall stores; events from before commentary existed have
   no kind/batter, so they're read back from the display string. Factual
   only -- we know the outcome, not the shot, so nothing is invented.
   opts.name maps a stored name for display (nicknames); opts.anonymous
   leaves out the "Over N" placeholder bowlers. */
function commentaryEvent(ev){
  const d = ev.display || "";
  const off = Number((d.match(/^(?:Wd|Nb)\+(\d+)/) || [])[1] || 0);
  if (ev.kind) return { kind: ev.kind, off: ev.extra ? ev.off || 0 : off, wicketType: ev.wicketType, extra: ev.extra };
  if (/Ro$/.test(d)) return { kind: "wicket", wicketType: "runout", off: 0 };
  if (d === "W") return { kind: "wicket", wicketType: null, off: 0 };
  if (/^Wd/.test(d)) return { kind: "wide", off };
  if (/^Nb/.test(d)) return { kind: "noball", off };
  if (/^Lb/.test(d)) return { kind: "legbye", off: 0 };
  if (/^B/.test(d)) return { kind: "bye", off: 0 };
  return { kind: "run", off: 0 };
}
function runsWord(n, unit){
  if (unit) return `${n === 4 ? "FOUR" : n} ${unit}${n === 1 ? "" : "s"}`;
  return n === 0 ? "no run" : n === 4 ? "FOUR" : n === 6 ? "SIX" : `${n} run${n === 1 ? "" : "s"}`;
}
const DISMISSAL_WORDS = { bowled: "Bowled", caught: "Caught", lbw: "LBW", stumped: "Stumped", hitwicket: "Hit wicket", runout: "Run out" };
function inningsCommentary(inn, opts){
  const o = opts || {};
  const nm = n => (o.name ? o.name(n) : n);
  const bpo = inn.ballsPerOver || 6;
  // A part over (the balls scored before a catch-up) has no end-of-over row;
  // a catch-up gap resets the running totals to what was entered.
  const overs = inn.overs.map(x => ({ bowler: x.bowler, events: x.events, done: !x.partial && !x.gap, gap: x.gap }));
  if (inn.currentOverEvents.length) overs.push({ bowler: inn.bowler, events: inn.currentOverEvents, done: false });
  const out = [];
  let batRuns = {}, batBalls = {}, figs = {};
  let score = 0, wkts = 0, balls = 0;
  overs.forEach(ov => {
    if (ov.gap){
      const g = ov.gap;
      score = g.toRuns; wkts = g.toWickets; balls = g.toBalls;
      batRuns = {}; batBalls = {}; figs = {};
      Object.keys(g.batters || {}).forEach(n => { batRuns[n] = g.batters[n].runs; batBalls[n] = g.batters[n].balls; });
      Object.keys(g.bowlers || {}).forEach(n => { const b = g.bowlers[n]; figs[n] = { balls: b.balls, maidens: b.maidens, runs: b.runs, wickets: b.wickets }; });
      out.push({ type: "gap", from: `${g.fromRuns}-${g.fromWickets} (${oversDisplay(g.fromBalls, bpo)})`, to: `${g.toRuns}-${g.toWickets} (${oversDisplay(g.toBalls, bpo)})`,
        runs: g.toRuns - g.fromRuns, wickets: g.toWickets - g.fromWickets, byHand: !!g.byHand });
      return;
    }
    // Over number and ball count from the legal balls before it, not the
    // list position: after a catch-up an over can start part way through.
    const start = balls, i = Math.floor(start / bpo);
    let legal = start % bpo, overRuns = 0, overWkts = 0, bowlerRuns = 0;
    const f = ov.bowler ? (figs[ov.bowler] = figs[ov.bowler] || { balls: 0, maidens: 0, runs: 0, wickets: 0 }) : null;
    ov.events.forEach(ev => {
      const c = commentaryEvent(ev);
      const isLegal = c.kind !== "wide" && c.kind !== "noball" && !c.extra;
      if (isLegal) legal += 1;
      const label = `${i}.${isLegal ? legal : legal + 1}`;
      const runs = ev.runs || 0;
      let text, tone = "";
      if (c.kind === "run"){ text = runsWord(runs); if (runs === 4) tone = "four"; if (runs === 6) tone = "six"; }
      else if (c.kind === "wide"){ text = c.off === 4 ? "wide, and it runs away for FOUR" : c.off ? `wide, ${c.off} more taken` : "wide"; tone = "extra"; }
      else if (c.kind === "noball"){ text = c.off ? `no ball, ${c.off === 4 ? "FOUR" : c.off === 6 ? "SIX" : runsWord(c.off)} off the bat` : "no ball"; tone = "extra"; }
      else if (c.kind === "bye") text = runsWord(runs, "bye");
      else if (c.kind === "legbye") text = runsWord(runs, "leg bye");
      else {
        const how = DISMISSAL_WORDS[c.wicketType] || "Wicket";
        const by = ev.fielder ? (c.wicketType === "caught" ? ` by ${nm(ev.fielder)}` : ` (${nm(ev.fielder)})`) : "";
        const ran = c.extra ? c.off : runs;
        text = `${c.extra === "wide" ? "Wide, and " : c.extra === "noball" ? "No ball, and " : ""}OUT! ${how}${by}${c.wicketType === "runout" && ran ? `, ${runsWord(ran)} completed` : ""}`;
        tone = "wicket";
      }
      if (ev.freeHit) text = `Free hit: ${text}`;
      // milestones, from the bat runs this batter has made so far
      let milestone = "";
      if (ev.batter){
        const before = batRuns[ev.batter] || 0;
        const add = c.kind === "run" || (c.kind === "wicket" && c.wicketType === "runout" && c.extra !== "wide") ? (c.extra ? c.off : runs) : c.kind === "noball" ? c.off : 0;
        batRuns[ev.batter] = before + add;
        if (c.kind !== "wide" && c.extra !== "wide") batBalls[ev.batter] = (batBalls[ev.batter] || 0) + 1;
        const m = [100, 50].find(x => before < x && before + add >= x);
        if (m) milestone = `${m === 100 ? "HUNDRED" : "FIFTY"} for ${nm(ev.batter)}!`;
      }
      const who = [o.anonymous ? null : (ov.bowler ? nm(ov.bowler) : null), ev.batter ? nm(ev.batter) : null].filter(Boolean).join(" to ");
      const detail = ev.isWicket && ev.outName
        ? `${nm(ev.outName)} ${ev.howOut || ""} ${ev.outRuns != null ? `${ev.outRuns} (${ev.outBalls})` : ""}`.replace(/\s+/g, " ").trim()
        : "";
      score += runs; overRuns += runs;
      if (ev.isWicket){ wkts += 1; overWkts += 1; }
      if (c.kind !== "bye" && c.kind !== "legbye") bowlerRuns += runs;
      if (f){
        if (isLegal) f.balls += 1;
        if (c.kind !== "bye" && c.kind !== "legbye") f.runs += runs;
        if (ev.isWicket && c.wicketType !== "runout") f.wickets += 1;
      }
      // the striker's score after this ball (a dismissed striker's is in `detail`)
      const batter = ev.batter && !(ev.isWicket && ev.outName === ev.batter)
        ? `${nm(ev.batter)} ${batRuns[ev.batter]} (${batBalls[ev.batter] || 0})` : "";
      out.push({ type: "ball", over: i, label, who, text, detail, batter, milestone, tone, display: ev.display, runs });
    });
    balls = start - (start % bpo) + legal;
    if (ov.done){
      // only a whole over seen ball by ball can be called a maiden
      const maiden = start % bpo === 0 && legal === bpo && bowlerRuns === 0;
      if (f && maiden) f.maidens += 1;
      out.push({ type: "over", over: i + 1, runs: overRuns, wickets: overWkts, score, wkts, maiden,
        bowler: !o.anonymous && ov.bowler ? nm(ov.bowler) : null,
        figures: f ? `${oversDisplay(f.balls, bpo).replace(/\.0$/, "")}-${f.maidens}-${f.runs}-${f.wickets}` : "" });
    }
  });
  return out;
}

/* The rows around an innings' commentary: how it started (the toss before
   the first innings, the target before a chase) and how it finished (why
   the innings ended and, after the last one, the result). Plain text. */
function commentaryBookends(match, idx){
  const inn = match.innings[idx];
  const bat = teamName(match, inn.battingTeam), bowl = teamName(match, inn.bowlingTeam);
  const bpo = inn.ballsPerOver || 6;
  const start = [];
  if (idx === 0){
    if (match.tossWinner){
      const won = teamName(match, match.tossWinner);
      start.push(`${won} won the toss and chose to ${match.tossWinner === inn.battingTeam ? "bat" : "field"}.`);
    }
    start.push(`${bat} to bat, ${bowl} to bowl.`);
  } else if (inn.target != null){
    const overs = inn.oversLimit != null ? ` from ${inn.oversLimit} over${inn.oversLimit === 1 ? "" : "s"}` : "";
    start.push(`${bat} need ${inn.target} to win${overs}.`);
  }
  const end = [];
  if (inn.complete){
    const why = { allout: "all out", overs: "overs complete", target: "target reached", closed: "innings closed" }[inn.completeReason];
    end.push(`Innings over: ${bat} ${inn.runs}/${inn.wickets} (${oversDisplay(inn.legalBalls, bpo)} ov)${why ? ` — ${why}` : ""}.`);
    if (idx === 0 && !match.forfeited) end.push(`${bowl} need ${inn.runs + 1} to win.`);
  }
  if (match.status === "complete" && idx === match.innings.length - 1 && match.result) end.push(match.result);
  return { start, end };
}

/* --- tournament summary (ended tournaments) ---
   Everything the Summary tab and its share image show, from the completed
   matches: final table, champion/runner-up, totals and the top performers. */
function tournamentSummary(matches, preset){
  const standings = computeStandings(matches, preset);
  const totals = aggregatePlayerStats(matches);
  const top = (key, min) => { const t = [...totals].sort((a, b) => b[key] - a[key])[0]; return t && t[key] >= (min || 1) ? t : null; };
  let highestTotal = null, bestInnings = null, bestBowling = null, runs = 0, wickets = 0, sixes = 0;
  matches.forEach(m => m.innings.forEach(inn => {
    runs += inn.runs; wickets += inn.wickets;
    const team = teamName(m, inn.battingTeam);
    if (!highestTotal || inn.runs > highestTotal.runs) highestTotal = { team, runs: inn.runs, wickets: inn.wickets, against: teamName(m, inn.bowlingTeam) };
    // Sixes are a team total, like runs: a "no names" match's sixes count too.
    inn.batting.order.forEach(n => { sixes += inn.batting.stats[n].sixes; });
    if (playerStatsExcluded(m)) return;
    inn.batting.order.forEach(n => {
      const b = inn.batting.stats[n];
      if (isUnnamedPlayer(n)) return;
      if (!bestInnings || b.runs > bestInnings.runs || (b.runs === bestInnings.runs && b.balls < bestInnings.balls)) bestInnings = { name: n, team, runs: b.runs, balls: b.balls, notOut: !b.out };
    });
    inn.bowling.order.forEach(n => {
      const b = inn.bowling.stats[n];
      if (isUnnamedPlayer(n)) return;
      if (b.wickets && (!bestBowling || b.wickets > bestBowling.wickets || (b.wickets === bestBowling.wickets && b.runs < bestBowling.runs))) bestBowling = { name: n, team: teamName(m, inn.bowlingTeam), wickets: b.wickets, runs: b.runs };
    });
  }));
  return {
    standings, matches: matches.length, runs, wickets, sixes,
    champion: standings[0] || null,
    runnerUp: standings[1] || null,
    // Level on points (and NRR when it's used) at the top -> no outright winner.
    shared: !!(standings[1] && standings[0].points === standings[1].points && (!preset.useNRR || standings[0].nrr === standings[1].nrr)),
    highestTotal, bestInnings: bestInnings && bestInnings.runs > 0 ? bestInnings : null, bestBowling,
    mvp: totals[0] && totals[0].points > 0 ? totals[0] : null,
    topBat: top("runs"), topBowl: top("wickets"), topField: [...totals].sort((a, b) => (b.catches + b.runouts) - (a.catches + a.runouts)).find(t => t.catches + t.runouts > 0) || null
  };
}
