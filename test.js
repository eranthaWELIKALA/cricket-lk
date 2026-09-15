const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
const win = dom.window;

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

let failures = 0;
function assert(cond, msg){
  if (!cond){ failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

async function main(){
  await wait(50); // let boot()/render() run

  const {
    createMatch, currentInnings, recordBall, afterBall, oversDisplay, startSecondInnings, matchResult,
    calcPlayerPoints, aggregatePlayerStats, pickMatchMOTM, computeStandings, forfeitMatch
  } = win;

  // --- 1. known real-world figure: strike rotates on odd runs, not on boundaries ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";

    recordBall(inn, { kind: "run", runs: 1 });
    assert(inn.striker === "A2", "single rotates strike");
    recordBall(inn, { kind: "run", runs: 4 });
    assert(inn.striker === "A2", "boundary does not rotate strike");
    assert(inn.runs === 5, "runs accumulate (1+4=5)");
    assert(inn.batting.stats.A2.runs === 4, "striker credited with the boundary");
  }

  // --- 2. over completion: 6 legal balls end the over, swap strike, force new bowler ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let i = 0; i < 6; i++) recordBall(inn, { kind: "run", runs: 0 });
    assert(inn.legalBalls === 6, "6 legal balls bowled");
    assert(oversDisplay(inn.legalBalls) === "1.0", "overs display rolls to 1.0");
    assert(inn.bowler === null, "bowler must be reselected after an over");
    assert(inn.lastOverBowler === "B1", "last-over bowler remembered to block back-to-back overs");
    assert(inn.striker === "A2", "strike swaps at the end of the over (dot balls, so no mid-over swap)");
  }

  // --- 3. wides and no-balls: extra + don't count toward the over; no-ball sets free hit ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wide", runs: 0 });
    assert(inn.runs === 1 && inn.legalBalls === 0, "wide adds 1 run, doesn't count as a legal ball");
    recordBall(inn, { kind: "noball", runs: 4 });
    assert(inn.runs === 6, "no-ball: 1 extra + 4 off the bat = 5 added (1 prior + 5 = 6)");
    assert(inn.freeHit === true, "no-ball sets up a free hit");
    assert(inn.batting.stats.A1.runs === 4, "runs off a no-ball are credited to the striker");
    recordBall(inn, { kind: "run", runs: 1 });
    assert(inn.freeHit === false, "the next legal ball consumes the free hit");
    assert(inn.legalBalls === 1, "only the legal ball counts toward the over");
  }

  // --- 4. wicket: batsman marked out, striker slot cleared, needs a replacement ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "bowled" });
    assert(inn.striker === null, "striker slot cleared after dismissal");
    assert(inn.batting.stats.A1.out === true, "dismissed batsman flagged out");
    assert(inn.wickets === 1, "wicket tally incremented");
    assert(win.pendingBatsmanSlot(inn) === "striker", "engine reports a new batsman is needed");
  }

  // --- 5. run out: named end vacated, runs credited, other end untouched ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 2, endComingIn: "nonStriker" });
    assert(inn.nonStriker === null, "the named end is vacated");
    assert(inn.striker === "A1", "the other batsman is untouched");
    assert(inn.batting.stats.A2.out === true && inn.batting.stats.A2.howOut === "run out", "correct batsman marked run out");
    assert(inn.runs === 2, "runs completed before the run-out are credited");
  }

  // --- 6. all-out ends the innings even mid-over ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 20, playersPerSide: 2, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "bowled" }); // maxWickets = playersPerSide-1 = 1
    afterBall(m);
    assert(inn.complete === true && inn.completeReason === "allout", "1 wicket down with only 2 players ends the innings");
    assert(m.status === "innings_break", "match moves to the innings break");
  }

  // --- 7. full two-innings match: target chase & result text ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    let inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let i = 0; i < 6; i++){ recordBall(inn, { kind: "run", runs: 1 }); afterBall(m); }
    assert(inn.runs === 6 && inn.complete && m.status === "innings_break", "first innings ends after its 1 over, 6/0");

    startSecondInnings(m);
    inn = currentInnings(m);
    assert(inn.target === 7, "target = first innings runs + 1");
    win.ensureBatsman(inn, "T1"); win.ensureBatsman(inn, "T2"); win.ensureBowler(inn, "B2");
    inn.striker = "T1"; inn.nonStriker = "T2"; inn.bowler = "B2";
    recordBall(inn, { kind: "run", runs: 4 }); afterBall(m);
    recordBall(inn, { kind: "run", runs: 4 }); afterBall(m);
    assert(m.status === "complete", "chasing team passes the target and the match ends immediately");
    assert(m.result === "Tigers won by 10 wickets (0.4 overs left)", `result text correct, got: ${m.result}`);
  }

  // --- 8. a session survives being torn down and rebuilt (simulates a reload) ---
  {
    win.state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    win.state.snapshots = [];
    const inn = currentInnings(win.state.match);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    win.state.match.status = "live";
    recordBall(inn, { kind: "run", runs: 3 });
    win.save();

    // Tear down the in-memory JS state (a page reload discards it) but leave the
    // underlying storage alone, then reload from it — same contract as a real refresh.
    win.state.match = null;
    win.state.snapshots = [];
    win.load();
    const inn2 = currentInnings(win.state.match);
    assert(win.state.match.status === "live", "reloaded match resumes in-progress");
    assert(inn2.runs === 3, "reloaded innings keeps its score");
    assert(inn2.striker === "A2", "reloaded innings keeps strike rotation state");
  }

  // --- 9. undo restores the previous state ---
  {
    win.state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    win.state.snapshots = [];
    const inn = currentInnings(win.state.match);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    win.state.match.status = "live";
    win.pushSnapshot();
    recordBall(inn, { kind: "run", runs: 6 });
    assert(currentInnings(win.state.match).runs === 6, "run recorded before undo");
    win.handleUndo();
    assert(currentInnings(win.state.match).runs === 0, "undo restores the pre-ball state");
  }

  // --- 10. balls-per-over preset: a 4-ball over completes after 4 legal balls ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A", ballsPerOver: 4 });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let i = 0; i < 4; i++) recordBall(inn, { kind: "run", runs: 0 });
    assert(inn.legalBalls === 4, "4-ball preset: over completes after 4 legal balls");
    assert(oversDisplay(inn.legalBalls, inn.ballsPerOver) === "1.0", "oversDisplay respects the preset's ballsPerOver");
    assert(inn.bowler === null, "bowler must be reselected after a 4-ball over");
  }

  // --- 11. configurable wide/no-ball run values ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A", wideRuns: 2, noBallRuns: 2 });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wide", runs: 0 });
    assert(inn.runs === 2 && inn.extras.wides === 2, "a wide is worth the preset's base run value (2), not the hardcoded 1");
    recordBall(inn, { kind: "noball", runs: 3 });
    assert(inn.runs === 7, "no-ball: preset base (2) + 3 off the bat = 5 added (2 prior + 5 = 7)");
    assert(inn.extras.noBalls === 2, "no-ball extras record only the preset base value, not the off-bat runs");
  }

  // --- 12. fielder credit on catches and run-outs feeds fielding stats + howOut text ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "caught", fielder: "F1" });
    assert(inn.batting.stats.A1.howOut === "c F1 b B1", "caught howOut credits the named fielder");
    assert(inn.fielding.stats.F1.catches === 1, "fielder's catch tally increments");

    win.ensureBatsman(inn, "A3");
    inn.striker = "A3";
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 1, endComingIn: "nonStriker", fielder: "F2" });
    assert(inn.batting.stats.A2.howOut === "run out (F2)", "run-out howOut credits the named fielder");
    assert(inn.fielding.stats.F2.runouts === 1, "fielder's run-out tally increments");
  }

  // --- 13. calcPlayerPoints computes the documented, fixed MVP formula ---
  {
    const pts = calcPlayerPoints(
      { runs: 55, fours: 4, sixes: 2, balls: 30, out: false },
      { wickets: 2, maidens: 1 },
      { catches: 1, runouts: 0 }
    );
    // batting: 55 + 4 + (2*2) + fifty(8) + notOut(4) = 75; bowling: (2*25) + (1*8) = 58; fielding: 1*8 = 8
    assert(pts === 141, `calcPlayerPoints matches the documented formula, got ${pts}`);
  }

  // --- 14. aggregatePlayerStats / pickMatchMOTM over a completed match ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    let inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let i = 0; i < 6; i++){ recordBall(inn, { kind: "run", runs: 1 }); afterBall(m); }
    startSecondInnings(m);
    inn = currentInnings(m);
    win.ensureBatsman(inn, "T1"); win.ensureBatsman(inn, "T2"); win.ensureBowler(inn, "B2");
    inn.striker = "T1"; inn.nonStriker = "T2"; inn.bowler = "B2";
    recordBall(inn, { kind: "run", runs: 4 }); afterBall(m);
    recordBall(inn, { kind: "run", runs: 4 }); afterBall(m);
    assert(m.status === "complete", "sanity: match completed for aggregation test");

    const motm = pickMatchMOTM(m);
    assert(motm === "T1", `pickMatchMOTM picks the top points scorer of the match, got ${motm}`);

    const totals = aggregatePlayerStats([m]);
    const a1 = totals.find(t => t.name === "A1");
    assert(a1.runs === 3 && a1.matches === 1, "aggregatePlayerStats folds a player's batting figures across the match");
  }

  // --- 15. computeStandings: points, win/loss, and NRR across a mini round-robin ---
  {
    const tPreset = { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true };

    const m1 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    let inn1 = currentInnings(m1);
    win.ensureBatsman(inn1, "A1"); win.ensureBatsman(inn1, "A2"); win.ensureBowler(inn1, "B1");
    inn1.striker = "A1"; inn1.nonStriker = "A2"; inn1.bowler = "B1";
    for (let i = 0; i < 6; i++){ recordBall(inn1, { kind: "run", runs: 1 }); afterBall(m1); }
    startSecondInnings(m1);
    inn1 = currentInnings(m1);
    win.ensureBatsman(inn1, "T1"); win.ensureBatsman(inn1, "T2"); win.ensureBowler(inn1, "B2");
    inn1.striker = "T1"; inn1.nonStriker = "T2"; inn1.bowler = "B2";
    recordBall(inn1, { kind: "run", runs: 4 }); afterBall(m1);
    recordBall(inn1, { kind: "run", runs: 4 }); afterBall(m1);
    assert(m1.status === "complete", "sanity: match 1 (Lions v Tigers) completed");

    const m2 = createMatch({ teamA: "Lions", teamB: "Eagles", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    let inn2 = currentInnings(m2);
    win.ensureBatsman(inn2, "L1"); win.ensureBatsman(inn2, "L2"); win.ensureBowler(inn2, "E1");
    inn2.striker = "L1"; inn2.nonStriker = "L2"; inn2.bowler = "E1";
    for (let i = 0; i < 6; i++){ recordBall(inn2, { kind: "run", runs: 0 }); afterBall(m2); }
    startSecondInnings(m2);
    inn2 = currentInnings(m2);
    win.ensureBatsman(inn2, "E2"); win.ensureBatsman(inn2, "E3"); win.ensureBowler(inn2, "L3");
    inn2.striker = "E2"; inn2.nonStriker = "E3"; inn2.bowler = "L3";
    recordBall(inn2, { kind: "run", runs: 1 }); afterBall(m2);
    assert(m2.status === "complete", "sanity: match 2 (Lions v Eagles) completed");

    const standings = computeStandings([m1, m2], tPreset);
    const byName = Object.fromEntries(standings.map(t => [t.name, t]));
    assert(byName.Tigers.points === 2 && byName.Tigers.won === 1, "Tigers earn win points for beating Lions");
    assert(byName.Eagles.points === 2 && byName.Eagles.won === 1, "Eagles earn win points for beating Lions");
    assert(byName.Lions.points === 0 && byName.Lions.lost === 2, "Lions lose both matches and score 0 points");
    assert(standings[0].points >= standings[standings.length - 1].points, "standings are sorted by points descending");
  }

  // --- 16. storage migration: a legacy v1 save ({match, snapshots}) upgrades to the v2 schema ---
  {
    win.DB.clear(win.STORAGE_KEY);
    win.DB.clear(win.LEGACY_KEY);
    const legacyMatch = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    legacyMatch.status = "live";
    win.DB.save(win.LEGACY_KEY, { match: legacyMatch, snapshots: [] });

    win.state.match = null; win.state.snapshots = [];
    win.load();
    assert(win.state.match && win.state.match.status === "live", "legacy save resumes as the in-progress match");
    assert(Object.keys(win.state.matchPresets).length > 0, "migration seeds the default match presets");
    assert(win.DB.load(win.STORAGE_KEY) !== null, "migration is persisted under the new v2 storage key");

    win.DB.clear(win.STORAGE_KEY);
    win.DB.clear(win.LEGACY_KEY);
  }

  // --- 17. forfeit before a second innings ever starts ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "run", runs: 2 });
    forfeitMatch(m, "A");
    assert(m.status === "complete", "forfeiting ends the match immediately, even mid-first-innings");
    assert(m.forfeited === true && m.forfeitedBy === "A", "forfeit is recorded with the forfeiting team");
    assert(m.result === "Tigers won — Lions forfeited the match", `forfeit result text correct, got: ${m.result}`);
    assert(m.innings.length === 1, "a first-innings forfeit never creates a second innings");
  }

  // --- 18. forfeit mid-second-innings: counts for standings points but not NRR ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    let inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let i = 0; i < 6; i++){ recordBall(inn, { kind: "run", runs: 1 }); afterBall(m); }
    assert(m.status === "innings_break", "sanity: first innings ends after its 1 over");
    startSecondInnings(m);
    inn = currentInnings(m);
    win.ensureBatsman(inn, "T1"); win.ensureBatsman(inn, "T2"); win.ensureBowler(inn, "B2");
    inn.striker = "T1"; inn.nonStriker = "T2"; inn.bowler = "B2";
    recordBall(inn, { kind: "run", runs: 1 });
    forfeitMatch(m, "B");
    assert(m.status === "complete" && m.forfeited && m.forfeitedBy === "B", "second-innings forfeit is recorded");
    assert(m.result === "Lions won — Tigers forfeited the match", `forfeit result text correct, got: ${m.result}`);

    const tPreset = { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true };
    const standings = computeStandings([m], tPreset);
    const byName = Object.fromEntries(standings.map(t => [t.name, t]));
    assert(byName.Lions.won === 1 && byName.Lions.points === 2, "the non-forfeiting team gets a win and full points");
    assert(byName.Tigers.lost === 1 && byName.Tigers.points === 0, "the forfeiting team gets a loss");
    assert(byName.Lions.nrr === 0 && byName.Tigers.nrr === 0, "a forfeited match doesn't contribute to NRR");
  }

  // --- 19. freeHitOnNoBall toggle: a no-ball only grants a free hit when the preset says so ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A", freeHitOnNoBall: false });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "noball", runs: 0 });
    assert(inn.freeHit === false, "no-ball does not grant a free hit when freeHitOnNoBall is off");
    assert(inn.extras.noBalls === 1, "the no-ball penalty itself is unaffected by the free-hit toggle");

    const m2 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn2 = currentInnings(m2);
    win.ensureBatsman(inn2, "A1"); win.ensureBatsman(inn2, "A2"); win.ensureBowler(inn2, "B1");
    inn2.striker = "A1"; inn2.nonStriker = "A2"; inn2.bowler = "B1";
    recordBall(inn2, { kind: "noball", runs: 0 });
    assert(inn2.freeHit === true, "no-ball grants a free hit by default (freeHitOnNoBall defaults to true)");
  }

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
