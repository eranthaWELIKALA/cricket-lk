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

  const { createMatch, currentInnings, recordBall, afterBall, oversDisplay, startSecondInnings, matchResult } = win;

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

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
