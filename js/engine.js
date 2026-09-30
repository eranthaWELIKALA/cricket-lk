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
            runs, wicketType, endComingIn, fielder }
   A wicket is always recorded as happening on a legal delivery — run-outs
   off a wide/no-ball are a known simplification, not modelled here.
   `fielder` is optional on wicketType 'caught'/'runout' and credits a
   fielding-side player with a catch/run-out for stats/MVP purposes. */
function recordBall(inn, event){
  const bat = inn.batting.stats;
  const bwl = inn.bowling.stats[inn.bowler];
  const legal = event.kind !== "wide" && event.kind !== "noball";
  let ballRuns = 0, display = "", rotate = false, outName;

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
    if (event.wicketType === "runout"){
      ballRuns = event.runs || 0;
      bat[inn.striker].runs += ballRuns;
      bat[inn.striker].balls += 1;
      outName = inn[event.endComingIn];
      bat[outName].out = true;
      bat[outName].howOut = event.fielder ? `run out (${event.fielder})` : "run out";
      inn.wickets += 1;
      inn[event.endComingIn] = null;
      if (event.fielder){ ensureFielder(inn, event.fielder); inn.fielding.stats[event.fielder].runouts += 1; }
      display = ballRuns ? `${ballRuns}+Ro` : "Ro";
    } else {
      outName = inn.striker;
      bat[inn.striker].balls += 1;
      bat[inn.striker].out = true;
      bat[inn.striker].howOut = (event.wicketType === "caught" && event.fielder)
        ? `c ${event.fielder} b ${inn.bowler}`
        : `${WICKET_LABELS[event.wicketType]} b ${inn.bowler}`;
      bwl.wickets += 1;
      inn.wickets += 1;
      inn.striker = null;
      if (event.wicketType === "caught" && event.fielder){ ensureFielder(inn, event.fielder); inn.fielding.stats[event.fielder].catches += 1; }
      display = "W";
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
  inn.currentOverEvents.push({ display, isWicket: event.kind === "wicket", runs: ballRuns });

  if (legal) inn.freeHit = false;
  if (event.kind === "noball" && inn.freeHitOnNoBall) inn.freeHit = true;
  if (rotate) swapStrike(inn);

  checkInningsComplete(inn);

  const overCompleted = legal && inn.legalBalls % inn.ballsPerOver === 0;
  if (overCompleted){
    if (bwl.curOverRuns === 0) bwl.maidens += 1;
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
  inn.complete = true;
  inn.completeReason = "closed";
  afterBall(match);
}

function createMatch({ teamA, teamB, oversLimit, playersPerSide, battingFirst, ballsPerOver, wideRuns, noBallRuns, wideEnabled, noBallEnabled, freeHitOnNoBall, lastManStands, requireFielderOnCatch, requireFielderOnRunout, presetId, presetName, tournamentId }){
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
    innings: [createInnings(battingFirst, battingFirst === "A" ? "B" : "A", null, playersPerSide, oversLimit, cfg)],
    status: "opening",
    result: null,
    motm: null
  };
}

function currentInnings(match){ return match.innings[match.innings.length - 1]; }

function teamName(match, key){ return key === "A" ? match.teamA : match.teamB; }

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
   Anyone already on the other side is dropped; duplicates (any case) too. */
function pickCandidates(match, pool, role){
  const inn = currentInnings(match);
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
    const left = i2.oversLimit != null ? ` (${oversDisplay(i2.oversLimit * bpo - i2.legalBalls, bpo)} overs left)` : "";
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
const MATCH_CARRY_FIELDS = ["clubId", "matchType", "squads", "guestNames", "opponentName"];
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
    presetId: match.presetId, presetName: match.presetName, tournamentId: match.tournamentId
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
  inn.batting.order.forEach(name => {
    const s = inn.batting.stats[name];
    const t = totals[name] || (totals[name] = emptyPlayerTotal(name));
    t.runs += s.runs; t.balls += s.balls; t.fours += s.fours; t.sixes += s.sixes;
    t.innings += 1;
    if (!s.out) t.notOuts += 1;
    t.points += calcPlayerPoints(s, null, null);
  });
  inn.bowling.order.forEach(name => {
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

function aggregatePlayerStats(matches){
  const totals = {};
  matches.forEach(match => {
    match.innings.forEach(inn => foldInningsIntoTotals(totals, inn));
    matchPlayerNames(match).forEach(name => { if (totals[name]) totals[name].matches += 1; });
  });
  return Object.values(totals).sort((a, b) => b.points - a.points);
}

function pickMatchMOTM(match){
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
    match.innings.forEach(inn => {
      const bt = ensureTeam(teamName(match, inn.battingTeam));
      const bwt = ensureTeam(teamName(match, inn.bowlingTeam));
      const oversFaced = inn.completeReason === "allout" && inn.oversLimit != null ? inn.oversLimit : inn.legalBalls / bpo;
      bt.runsFor += inn.runs; bt.oversFor += oversFaced;
      bwt.runsAgainst += inn.runs; bwt.oversAgainst += oversFaced;
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
