const fs = require("fs");
const { JSDOM } = require("jsdom");

// index.html loads its code as ordered classic scripts (js/...) and a
// stylesheet; inline them so jsdom runs the same code, in the same order,
// without needing a web server.
const html = fs.readFileSync(__dirname + "/index.html", "utf8")
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
    `<script>${fs.readFileSync(__dirname + "/" + src, "utf8").replace(/<\/script/gi, "<\\/script")}</script>`)
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>${fs.readFileSync(__dirname + "/" + href, "utf8")}</style>`);
const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
const win = dom.window;

// sw.js must precache exactly the code index.html loads, or the app breaks
// offline the first time a file is added (see CLAUDE.md "Code layout").
{
  const page = fs.readFileSync(__dirname + "/index.html", "utf8");
  const loaded = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"><\/script>/g)].map(m => "./" + (m[1] || m[2]));
  const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
  const listed = [...sw.match(/const APP_CODE = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (JSON.stringify(loaded) !== JSON.stringify(listed)){
    console.error("FAIL: sw.js APP_CODE doesn't match the files index.html loads:\n  page: " + loaded.join(" ") + "\n  sw:   " + listed.join(" "));
    process.exitCode = 1;
  } else console.log("ok: sw.js precaches every file index.html loads (" + listed.length + ")");
}

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

  // --- 5b. currentOverEvents/fallOfWickets carry the raw numbers the live
  // scoring screen's over-totals and partnership counter need, not just
  // display strings ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "run", runs: 4 });
    recordBall(inn, { kind: "bye", runs: 2 });
    assert(inn.currentOverEvents[0].runs === 4, "a run event's raw runs are on the event, not just its display string");
    assert(inn.currentOverEvents[1].runs === 2, "a bye event's raw runs are on the event too");
    recordBall(inn, { kind: "wicket", wicketType: "bowled" });
    assert(inn.fallOfWickets[0].balls === inn.legalBalls, "a fall-of-wickets entry records legalBalls at the fall, for the partnership-balls counter");
    assert(inn.fallOfWickets[0].batsman === "A1", "a normal dismissal's fall-of-wickets entry names the striker who was out, for the new-batsman modal's dismissal banner");
  }

  // --- 5c. same, for a run-out (the other branch that sets `outName`) ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 1, endComingIn: "nonStriker" });
    assert(inn.fallOfWickets[0].batsman === "A2", "a run-out's fall-of-wickets entry names the batsman at the vacated end, not the striker");
  }

  // --- 5d. a player can't be on both teams in one match ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    assert(win.playerTeamInMatch(m, "a1") === "A", "a batter belongs to the batting team (case-insensitive)");
    assert(win.playerTeamInMatch(m, "B1") === "B", "a bowler belongs to the bowling team");
    assert(win.playerTeamInMatch(m, "Nobody") === null, "an unseen name has no side yet");
    assert(win.playerSideConflict(m, "B1", "A") !== null, "a bowler can't then bat for the other team");
    assert(win.playerSideConflict(m, "A1", "B") !== null, "a batter can't then bowl for the other team");
    assert(win.playerSideConflict(m, "A1", "A") === null, "the same name on their own team is fine");
    inn.fielding.order.push("B2"); inn.fielding.stats["B2"] = { catches: 1, runouts: 0 };
    assert(win.playerTeamInMatch(m, "B2") === "B", "a fielder belongs to the bowling team");
    // after the innings swap the same person may bowl for their own team but not switch sides
    startSecondInnings(m);
    assert(win.playerSideConflict(m, "A1", "A") === null, "a first-innings batter can bowl in the 2nd innings for the same team");
    assert(win.playerSideConflict(m, "A1", "B") !== null, "...but can't bat for the other team in the 2nd innings");
    assert(win.playerSideConflict(m, "B1", "B") === null, "a first-innings bowler can bat in the 2nd innings for the same team");
  }

  // --- 5e. leaked club names are purged from the guest player table, guest data is kept ---
  {
    const mk = (clubId, names) => { const m = createMatch({ teamA: "X", teamB: "Y", oversLimit: 1, playersPerSide: 4, battingFirst: "A" }); if (clubId) m.clubId = clubId;
      const inn = currentInnings(m); names.forEach(n => win.ensureBatsman(inn, n)); return m; };
    const pl = n => ({ id: "p_" + n, name: n });
    const st = {
      players: { p_Leak: pl("Leak"), p_Both: pl("Both"), p_Guest: pl("Guest"), p_Roster: pl("Rostered"), p_Typed: pl("TypedOnly") },
      teams: { t1: { id: "t1", name: "T", playerIds: ["p_Roster"] } },
      matchHistory: { a: Object.assign(mk("club-1", ["Leak", "both", "Rostered"]), { id: "a" }), b: Object.assign(mk(null, ["Both", "Guest"]), { id: "b" }) },
      match: null
    };
    const hist = { a: { id: "a", clubId: "c1" }, b: { id: "b" }, c: { id: "c", clubId: "c2" } };
    const st2 = { matchHistory: hist, activeClubId: "c1" };
    assert(win.purgeLocalClubMatches(st2) === 2 && Object.keys(st2.matchHistory).join() === "b" && st2.activeClubId === null,
      "purgeLocalClubMatches drops only club matches and clears the selected club");
    const st3 = { matchHistory: { a: { id: "a", clubId: "c1" }, b: { id: "b" } }, activeClubId: "c1", viewTournamentId: "t1" };
    const ops3 = [{ kind: "match" }, { kind: "roster.add" }, { kind: "tournament.create" }, { kind: "team.save" }, { kind: "preset.save" }];
    const cache3 = { clubs: { c1: { roster: [1], matches: [1], tournaments: [1] } }, tournaments: { t1: {} } };
    const r3 = win.purgeClubResults(st3, ops3, cache3);
    assert(r3.matches === 1 && r3.ops === 3 && Object.keys(st3.matchHistory).join() === "b" && st3.activeClubId === "c1" && st3.viewTournamentId === null
      && r3.keptOps.map(o => o.kind).join() === "roster.add,preset.save"
      && !cache3.clubs.c1.matches.length && !cache3.clubs.c1.tournaments.length && cache3.clubs.c1.roster.length === 1 && !Object.keys(cache3.tournaments).length,
      "purgeClubResults drops club matches/tournament ops and caches, keeps roster, presets and the selected club");
    const removed = win.purgeLeakedClubPlayers(st);
    assert(removed.join() === "Leak", "only a name seen solely in club matches is purged, got: " + removed.join());
    assert(!st.players.p_Leak, "the leaked club player is gone from the guest table");
    assert(st.players.p_Both && st.players.p_Guest, "names also used in a guest match are kept (case-insensitive)");
    assert(st.players.p_Roster, "a player on a saved local team is kept");
    assert(st.players.p_Typed, "a guest player never seen in any club match is untouched");
  }

  // --- 5f. player profile field rules + career fold ---
  {
    assert(win.isValidNic("") && win.isValidNic("  "), "a blank NIC is allowed (optional)");
    assert(win.isValidNic("901234567v") && win.isValidNic("901234567X"), "old-format NIC (9 digits + V/X, any case) is valid");
    assert(win.isValidNic("199012345678") && win.isValidNic("1990 1234 5678"), "new-format NIC (12 digits, spaces ignored) is valid");
    assert(!win.isValidNic("12345") && !win.isValidNic("9012345678") && !win.isValidNic("90123456Z"), "malformed NICs are rejected");
    assert(win.normalizeNic(" 90 1234567 v ") === "901234567V", "NIC is normalised to upper-case without spaces");
    assert(win.isValidPhone("") && win.isValidPhone("0771234567") && win.isValidPhone("+94 77 123 4567"), "blank, local and +94 contact numbers are valid");
    assert(!win.isValidPhone("123") && !win.isValidPhone("07x1234567") && !win.isValidPhone("+94-77-1234567"), "too-short or non-numeric contact numbers are rejected");
    assert(win.normalizePlayerName("  Kumar   Sangakkara ") === "Kumar Sangakkara", "player names are trimmed with inner spaces collapsed");
    assert(win.playerNameError("   ") && win.playerNameError("x".repeat(25)), "a blank or 25+ character name is rejected");
    assert(win.playerNameError("x".repeat(24)) === null && win.playerNameError(" Mahela ") === null, "a 1–24 character name is accepted");
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "run", runs: 4 }); recordBall(inn, { kind: "run", runs: 2 }); recordBall(inn, { kind: "wicket", wicketType: "bowled" });
    const c = win.playerCareer("a1", [m]);
    assert(c && c.runs === 6 && c.balls === 3 && c.innings === 1, "career folds a player's batting across the given matches (case-insensitive name)");
    assert(c.average === 6 && Math.round(c.strikeRate) === 200, "career average is runs per dismissal and strike rate is runs per 100 balls");
    assert(win.playerCareer("B1", [m]).wickets === 1, "career folds bowling too");
    assert(win.playerCareer("Nobody", [m]) === null, "a player with no appearances has no career line");
    // a richer two-innings fixture for the per-discipline numbers
    const m2 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const i1 = currentInnings(m2);
    win.ensureBatsman(i1, "Star"); win.ensureBatsman(i1, "Duck"); win.ensureBowler(i1, "Ace"); win.ensureBowler(i1, "Ace2");
    i1.batting.stats.Star = { runs: 63, balls: 40, fours: 5, sixes: 2, out: false, howOut: null };
    i1.batting.stats.Duck = { runs: 0, balls: 2, fours: 0, sixes: 0, out: true, howOut: "bowled b Ace" };
    i1.bowling.stats.Ace = { legalBalls: 24, runs: 30, wickets: 3, maidens: 1, curOverRuns: 0, curOverLegal: 0 };
    i1.fielding.order.push("Star"); i1.fielding.stats.Star = { catches: 2, runouts: 1 };
    const i2 = win.createInnings("B", "A", 60, 11, 5, {});
    m2.innings.push(i2);
    win.ensureBatsman(i2, "Star"); i2.batting.stats.Star = { runs: 102, balls: 60, fours: 9, sixes: 4, out: true, howOut: "c X b Y" };
    win.ensureBowler(i2, "Ace"); i2.bowling.stats.Ace = { legalBalls: 12, runs: 9, wickets: 3, maidens: 0, curOverRuns: 0, curOverLegal: 0 };
    const s1 = win.playerCareer("Star", [m2]);
    assert(s1.highScore.runs === 102 && s1.highScore.out === true && s1.hundreds === 1 && s1.fifties === 1, "batting: highest score, one 100 and one 50 (a 100 isn't also counted as a 50)");
    assert(win.playerCareer("Duck", [m2]).ducks === 1, "batting: a dismissal for 0 is a duck");
    assert(s1.fieldDismissals === 3 && s1.catches === 2 && s1.runouts === 1, "fielding: catches + run-outs total");
    const a1 = win.playerCareer("Ace", [m2]);
    assert(a1.bowlInnings === 2 && a1.best.wickets === 3 && a1.best.runs === 9, "bowling: best figures pick the most wickets, then fewest runs");
    assert(a1.wickets === 6 && a1.bowlAverage === 6.5 && a1.bowlStrikeRate === 6, "bowling: average is runs per wicket, strike rate is balls per wicket");
    assert(win.playerCareer("Ace2", [m2]).bowlInnings === 0, "a bowler who was listed but never bowled a ball has no bowling innings");
    // merged profiles: stats recorded under an alias fold into the survivor's career
    const m3 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const j1 = currentInnings(m3);
    win.ensureBatsman(j1, "Star"); win.ensureBatsman(j1, "S. Star"); win.ensureBowler(j1, "Ace");
    j1.batting.stats.Star = { runs: 40, balls: 30, fours: 4, sixes: 0, out: true, howOut: "bowled b Ace" };
    j1.batting.stats["S. Star"] = { runs: 30, balls: 20, fours: 2, sixes: 1, out: false, howOut: null };
    const both = win.playerCareer(["Star", "s. star"], [m2, m3]);
    assert(both.innings === 4 && both.runs === 63 + 102 + 40 + 30 && both.matches === 3, "career folds every alias's matches and innings together");
    assert(both.highScore.runs === 102 && both.hundreds === 1, "merged career keeps the best single innings across names");
    assert(both.notOuts === 2 && Math.abs(both.average - (both.runs / 2)) < 1e-9, "merged average is recomputed over combined dismissals, not averaged from the parts");
    assert(win.playerCareer(["Nobody", "Star"], [m2]).runs === 165 && win.playerCareer(["Nobody", "Nope"], [m2]) === null, "unknown aliases are ignored; no appearances under any name is still null");
    assert(win.playerCareer(["Star", "STAR"], [m2]).runs === 165, "a duplicated name isn't counted twice");
  }

  // --- 5g. optional player details: labels, validation, safe photo ---
  {
    assert(win.formatBatting("right") === "Right-hand bat" && win.formatBatting("left") === "Left-hand bat" && win.formatBatting("") === "", "batting hand labels (blank when unset)");
    assert(win.formatBowling("right", "fast") === "Right-arm fast", "bowling: arm + style");
    assert(win.formatBowling("left", "orthodox") === "Left-arm orthodox spin", "bowling: multi-word style");
    assert(win.formatBowling("", "medium") === "Medium" && win.formatBowling("left", "") === "Left-arm" && win.formatBowling("", "") === "", "bowling: either half alone, or nothing");
    assert(win.playerDetailsError({ batting_hand: "right", bowling_arm: "left", bowling_type: "fast", city: "Kandy" }) === null, "valid details pass");
    assert(win.playerDetailsError({ batting_hand: "both" }) !== null && win.playerDetailsError({ bowling_type: "yorker" }) !== null, "unknown hand/style values are rejected");
    assert(win.playerDetailsError({ city: "x".repeat(41) }) !== null, "a city over 40 characters is rejected");
    assert(win.playerDetailsError({ nickname: "Mahi", jersey_no: "07" }) === null, "a nickname and jersey no pass");
    assert(win.playerDetailsError({ nickname: "x".repeat(25) }) !== null, "a nickname over 24 characters is rejected");
    assert(["1000", "-1", "7.5", "abc"].every(j => win.playerDetailsError({ jersey_no: j }) !== null), "jersey no outside 0-999 whole numbers is rejected");
    assert(win.parseJerseyNo("") === null && win.parseJerseyNo(" ") === null && win.parseJerseyNo("07") === 7 && win.parseJerseyNo("0") === 0 && win.parseJerseyNo("1000") === undefined, "parseJerseyNo: blank -> null, digits -> number, invalid -> undefined");
    assert(win.escapeLike("50%_a\\b") === "50\\%\\_a\\\\b" && win.escapeLike("Kusal") === "Kusal", "escapeLike escapes %, _ and \\ for an ilike search");
    assert(win.playerLabel({ name: "Kusal", jersey_no: 0, nickname: "KM" }) === "#0 Kusal (KM)" && win.playerLabel({ name: "Kusal" }) === "Kusal", "playerLabel shows jersey (incl. 0) and nickname only when set");
    const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    assert(win.safePhoto(ok) === ok, "a base64 jpeg data URL is accepted");
    assert(win.safePhoto("data:image/svg+xml;base64,PHN2Zz4=") === "" && win.safePhoto("https://evil.example/x.png") === "" && win.safePhoto('data:image/png;base64,AA" onerror="x') === "", "svg, remote and attribute-breaking values are refused");
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

  // --- 20. last man stands: the last batter bats alone, always on strike ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 3, battingFirst: "A", lastManStands: true });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    assert(inn.maxWickets === 3, "last man stands: all out only when every batter (3) is out");
    recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(m);
    assert(win.pendingBatsmanSlot(inn) === "striker", "first wicket still asks for a new batsman");
    win.ensureBatsman(inn, "A3"); inn.striker = "A3";
    recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(m);
    assert(!inn.complete && win.battingAlone(inn), "2 down of 3: innings continues with the last man alone");
    assert(inn.striker === "A2" && inn.nonStriker === null, "the not-out batter moves to strike, no partner");
    assert(win.pendingBatsmanSlot(inn) === null, "batting alone doesn't ask for a new batsman");
    recordBall(inn, { kind: "run", runs: 1 });
    assert(inn.striker === "A2" && inn.nonStriker === null, "a single keeps the lone batter on strike");
    recordBall(inn, { kind: "run", runs: 2 }); recordBall(inn, { kind: "run", runs: 0 }); recordBall(inn, { kind: "run", runs: 1 });
    assert(inn.legalBalls === 6 && inn.striker === "A2" && inn.bowler === null, "end of over keeps the lone batter on strike");
    inn.bowler = "B2"; win.ensureBowler(inn, "B2");
    recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(m);
    assert(inn.complete && inn.completeReason === "allout" && m.status === "innings_break", "the last man out ends the innings");

    const off = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 3, battingFirst: "A" });
    assert(currentInnings(off).maxWickets === 2 && off.lastManStands === false, "without the rule, all out is players - 1");
  }

  // --- 21. no overs limit / no players limit ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: null, playersPerSide: null, battingFirst: "A" });
    let inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    for (let w = 0; w < 15; w++){
      recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(m);
      win.ensureBatsman(inn, "X" + w); inn[win.pendingBatsmanSlot(inn)] = "X" + w;
      if (inn.bowler === null){ inn.bowler = w % 2 ? "B1" : "B2"; win.ensureBowler(inn, inn.bowler); }
    }
    for (let i = 0; i < 60; i++){
      recordBall(inn, { kind: "run", runs: 0 }); afterBall(m);
      if (inn.bowler === null){ inn.bowler = inn.lastOverBowler === "B1" ? "B2" : "B1"; win.ensureBowler(inn, inn.bowler); }
    }
    assert(!inn.complete && inn.wickets === 15 && inn.legalBalls === 75, "no limits: neither wickets nor overs end the innings");
    assert(win.requiredRunRate(inn) === null, "no RRR without a target / overs limit");
    recordBall(inn, { kind: "run", runs: 4 }); afterBall(m);
    win.endInnings(m);
    assert(inn.complete && inn.completeReason === "closed" && m.status === "innings_break", "endInnings closes the innings by hand");
    startSecondInnings(m);
    inn = currentInnings(m);
    assert(inn.oversLimit === null && inn.maxWickets === null && inn.target === 5, "second innings keeps the no-limit conditions");
    win.ensureBatsman(inn, "B1"); win.ensureBatsman(inn, "B2"); win.ensureBowler(inn, "A1");
    inn.striker = "B1"; inn.nonStriker = "B2"; inn.bowler = "A1";
    recordBall(inn, { kind: "run", runs: 6 }); afterBall(m);
    assert(m.status === "complete" && m.result === "Tigers won", "chase with no limits: no wickets/overs margin in the result");

    const m2 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: null, playersPerSide: 11, battingFirst: "A" });
    const i2 = currentInnings(m2);
    assert(i2.maxWickets === 10 && i2.oversLimit === null, "overs can be unlimited while players are fixed");
    assert(win.parseOptionalLimit("", 1) === null && win.parseOptionalLimit(" 0 ", 1) === 1 && win.parseOptionalLimit("15", 1) === 15, "blank limit field means no limit; numbers clamp to the minimum");
    assert(win.limitInputValue(undefined, 20) === 20 && win.limitInputValue(null, 20) === "" && win.limitInputValue(8, 20) === 8, "limit inputs default for new forms, blank for saved no-limit");
  }

  // --- 22. tournament squads decide a player's side before they've played ---
  {
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    m.squads = { A: ["Kusal", "Dinesh"], B: ["Wanindu", "Maheesh"] };
    assert(win.playerTeamInMatch(m, "wanindu") === "B", "squad membership gives the side, case-insensitive, before any ball");
    assert(win.playerSideConflict(m, "Wanindu", "A") !== null, "a Blues squad player can't open for Reds");
    assert(win.playerSideConflict(m, "Kusal", "A") === null, "a Reds squad player can bat for Reds");
    assert(win.playerTeamInMatch(m, "Sub Fielder") === null, "a name in neither squad falls back to the usage rule");
  }

  // --- 23. one-tap pick lists only offer players who can actually be picked ---
  {
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "wicket", wicketType: "bowled" }); // A1 out
    const pool = ["A1", "a2", "A3", "B1", "B2", "a3"];
    assert(JSON.stringify(win.pickCandidates(m, pool, "batter")) === JSON.stringify(["A3", "B2"]), "batter picks drop the out batter, the one at the crease, the bowling side and duplicates");
    const bowl = win.pickCandidates(m, pool, "bowler");
    assert(!bowl.includes("A1") && !bowl.includes("a2") && !bowl.includes("B1") && bowl.includes("B2"), "bowler picks: no batters from this innings, no one who has already bowled");
    m.squads = { A: ["A1", "A2", "A3"], B: ["B1", "B2"] };
    assert(JSON.stringify(win.pickCandidates(m, m.squads.B, "fielder")) === JSON.stringify(["B1", "B2"]), "fielder picks are the bowling squad");
    assert(!win.pickCandidates(m, pool, "bowler").includes("A3"), "with squads, a batting-squad player is never offered to bowl");
  }

  // --- 24. reversed toss: restart the same fixture with the other side batting ---
  {
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: null, playersPerSide: 8, battingFirst: "A", ballsPerOver: 8, wideRuns: 2, noBallRuns: 2, wideEnabled: false, lastManStands: true, presetName: "Club day" });
    m.clubId = "c1"; m.matchType = "tournament"; m.tournamentId = "t1"; m.squads = { A: ["A1"], B: ["B1"] };
    assert(!win.matchHasStarted(m), "a match with openers not yet named hasn't started");
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1"; m.status = "live";
    assert(!win.matchHasStarted(m), "naming openers alone doesn't count as started");
    recordBall(inn, { kind: "wide", runs: 0 });
    assert(win.matchHasStarted(m), "a wide counts as started (runs on the board)");
    const r = win.restartMatch(m, "B");
    const ri = currentInnings(r);
    assert(r.battingFirst === "B" && ri.battingTeam === "B" && ri.bowlingTeam === "A", "restart flips who bats first");
    assert(r.status === "opening" && ri.runs === 0 && ri.striker === null && r.innings.length === 1, "restart is a clean first innings");
    assert(ri.ballsPerOver === 8 && ri.wideBaseRuns === 2 && ri.noBallBaseRuns === 2 && ri.oversLimit === null && ri.lastManStands && ri.maxWickets === 8, "restart keeps every playing condition");
    assert(r.wideEnabled === false && r.presetName === "Club day" && r.tournamentId === "t1", "restart keeps match-level settings");
    assert(r.clubId === "c1" && r.matchType === "tournament" && r.squads.A[0] === "A1" && r.squads !== m.squads, "restart carries club extras, with squads copied");
  }

  // --- 25. squads can change for one match, but not for anyone who has played ---
  {
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    m.squads = { A: ["Kusal", "Dinesh", "Charith"], B: ["Wanindu", "Maheesh"] };
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "Kusal"); win.ensureBatsman(inn, "Dinesh"); win.ensureBowler(inn, "Wanindu");
    assert(win.moveSquadPlayer(m, "charith") === null && m.squads.B.includes("Charith") && !m.squads.A.includes("Charith"), "an unplayed player moves to the other squad (case-insensitive)");
    assert(win.playerTeamInMatch(m, "Charith") === "B", "...and now counts for that side");
    assert(win.moveSquadPlayer(m, "Kusal") !== null && m.squads.A.includes("Kusal"), "a player who has batted can't switch sides");
    assert(win.moveSquadPlayer(m, "Wanindu") !== null, "a player who has bowled can't switch sides");
    assert(win.moveSquadPlayer(m, "Nobody") !== null, "a name in neither squad can't be moved");
    assert(win.addSquadPlayer(m, "Pathum", "A") === null && m.squads.A.includes("Pathum"), "a late arrival can join a squad");
    assert(win.addSquadPlayer(m, "pathum", "B") !== null, "...but not twice");
    assert(win.addSquadPlayer(m, "Maheesh", "A") !== null, "another squad's player can't be added to this one");
    assert(win.addSquadPlayer(m, "  ", "A") !== null, "a blank name is rejected");
  }

  // --- 25b. saved guest teams give guest matches the same squads ---
  {
    const players = { p1: { name: "Kusal" }, p2: { name: "Dinesh" } };
    const got = win.guestTeamSquad({ playerIds: ["p1", "gone", "p2"] }, players);
    assert(JSON.stringify(got) === JSON.stringify(["Kusal", "Dinesh"]), "guest team -> squad names, unknown ids skipped");
    assert(win.guestTeamSquad(null, players).length === 0, "no saved team -> empty squad");
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    m.squads = { A: got, B: [] };
    assert(win.playerSideConflict(m, "Kusal", "B"), "a guest squad player can't be picked for the other side before playing");
    assert(!win.pickCandidates(m, ["Kusal", "Wanindu"], "bowler").includes("Kusal"), "the other side's squad isn't offered to bowl");
  }

  // --- 26. innings with no overs/players limit can be closed by hand ---
  {
    const limited = createMatch({ teamA: "A", teamB: "B", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    assert(!win.canEndInningsByHand(currentInnings(limited)), "fully limited innings can't be ended by hand");
    const noOvers = createMatch({ teamA: "A", teamB: "B", oversLimit: null, playersPerSide: 11, battingFirst: "A" });
    assert(win.canEndInningsByHand(currentInnings(noOvers)), "no overs limit -> can end by hand");
    const noPlayers = createMatch({ teamA: "A", teamB: "B", oversLimit: 5, playersPerSide: null, battingFirst: "A" });
    const np = currentInnings(noPlayers);
    assert(win.canEndInningsByHand(np), "no players limit -> can end by hand");
    // Ending with a batsman slot still empty (the new-batsman sheet is up).
    win.ensureBatsman(np, "A1"); win.ensureBatsman(np, "A2"); win.ensureBowler(np, "B1");
    np.striker = "A1"; np.nonStriker = "A2"; np.bowler = "B1"; noPlayers.status = "live";
    recordBall(np, { kind: "run", runs: 3 });
    recordBall(np, { kind: "wicket", wicketType: "bowled" });
    assert(win.pendingBatsmanSlot(np) !== null, "a batsman is pending after the wicket");
    win.endInnings(noPlayers);
    assert(noPlayers.status === "innings_break" && np.completeReason === "closed" && !win.canEndInningsByHand(np), "endInnings closes the 1st innings with a batsman pending");
    startSecondInnings(noPlayers);
    const i2 = currentInnings(noPlayers);
    win.ensureBatsman(i2, "B1"); win.ensureBatsman(i2, "B2"); win.ensureBowler(i2, "A1");
    i2.striker = "B1"; i2.nonStriker = "B2"; i2.bowler = "A1"; noPlayers.status = "live";
    recordBall(i2, { kind: "run", runs: 1 });
    i2.bowler = null; // new-bowler sheet up
    win.endInnings(noPlayers);
    assert(noPlayers.status === "complete" && /won/.test(noPlayers.result), "ending the 2nd innings by hand finishes the match with a result");
  }

  // --- 27. guest players are flagged per match and survive a restart ---
  {
    const m = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    m.squads = { A: ["Kusal", "Visitor One"], B: ["Wanindu"] }; m.guestNames = ["Visitor One"];
    assert(win.isGuestInMatch(m, "visitor one") && !win.isGuestInMatch(m, "Kusal") && !win.isGuestInMatch(m, ""), "isGuestInMatch is case-insensitive and only true for guests");
    assert(win.guestPlayerKey("  Visitor One ") === "guest:visitor one", "guest key is derived from the trimmed, lower-cased name");
    const r = win.restartMatch(m, "B");
    assert(r.guestNames && r.guestNames[0] === "Visitor One" && r.guestNames !== m.guestNames, "restart keeps guest names (copied)");
  }

  // --- 28. a typed nickname or "#jersey" resolves to the roster player's name ---
  {
    const roster = [
      { name: "Kusal Mendis", nickname: "Kusa", jersey_no: 13 },
      { name: "Wanindu Hasaranga", nickname: "Wanna", jersey_no: 49 },
      { name: "Dasun Shanaka", nickname: "Kusa", jersey_no: 7 },   // shared nickname
      { name: "Charith Asalanka", nickname: null, jersey_no: 7 }   // shared jersey
    ];
    const r = v => win.resolvePlayerAlias(v, roster);
    assert(r("wanna") === "Wanindu Hasaranga", "unique nickname -> real name, case-insensitive");
    assert(r("#49") === "Wanindu Hasaranga" && r("# 49") === "Wanindu Hasaranga", "unique #jersey -> real name");
    assert(r("kusal mendis") === "Kusal Mendis", "an exact name comes back in its roster spelling");
    assert(r("Kusa") === "Kusa", "an ambiguous nickname is left as typed");
    assert(r("#7") === "#7", "an ambiguous jersey is left as typed");
    assert(r("  New Guy ") === "New Guy" && r("") === "", "unknown names are just trimmed");
    assert(win.resolvePlayerAlias("Wanna", null) === "Wanna", "no roster (guest mode) -> unchanged");
  }

  // --- 29. offline sync helpers: queue folding, overlays, temp-id remap ---
  {
    const op = (kind, args, extra) => Object.assign({ id: Math.random().toString(36), kind, args, userId: "u1", createdAt: 1, failed: false }, extra || {});
    let q = [];
    q = win.coalesceOp(q, op("team.save", { id: "t1", isNew: true, name: "Reds", tournamentId: "T" }));
    q = win.coalesceOp(q, op("team.save", { id: "t1", isNew: false, name: "Reds 2", tournamentId: "T" }));
    assert(q.length === 1 && q[0].args.name === "Reds 2" && q[0].args.isNew === true, "a second save of an unsynced team replaces the first and keeps isNew");
    q = win.coalesceOp(q, op("team.delete", { id: "t1", tournamentId: "T" }));
    assert(q.length === 0, "deleting a team that never synced just cancels its create");
    q = win.coalesceOp(q, op("roster.add", { clubId: "c", name: "Kusal", tempId: "tmp:1" }));
    q = win.coalesceOp(q, op("roster.add", { clubId: "c", name: "kusal ", tempId: "tmp:2" }));
    assert(q.length === 1, "repeat roster adds of one name are dropped");
    q = win.coalesceOp(q, op("match", { id: "m1" })); q = win.coalesceOp(q, op("match", { id: "m1" }));
    assert(q.filter(o => o.kind === "match").length === 1, "a match is queued once");
    const failedSave = op("team.save", { id: "t9", isNew: true, name: "X", tournamentId: "T" }, { failed: true });
    q = win.coalesceOp([failedSave], op("team.save", { id: "t9", isNew: false, name: "Y", tournamentId: "T" }));
    assert(q.length === 2, "a failed op is never folded into (it needs a manual retry)");

    const club = { id: "c", roster: [{ id: "p1", name: "Wanindu" }], tournaments: [], presets: { match: [], tournament: [] } };
    const ops = [
      op("roster.add", { clubId: "c", name: "Kusal", tempId: "tmp:1", details: { nickname: "Kusa", jersey_no: "13" } }),
      op("roster.remove", { clubId: "c", playerId: "p1" }),
      op("tournament.create", { id: "T", clubId: "c", name: "Club Day", preset: { pointsForWin: 2 } }),
      op("preset.save", { id: "pr", clubId: "c", kind: "match", preset: { name: "T10" } }),
      op("team.save", { id: "t1", tournamentId: "T", name: "Reds", players: [{ id: "tmp:1", name: "Kusal" }] }),
      op("roster.add", { clubId: "other", name: "Nope", tempId: "tmp:x" }, { failed: false })
    ];
    const c = win.overlayClubData(club, ops);
    assert(c.roster.length === 1 && c.roster[0].name === "Kusal" && c.roster[0].id === "tmp:1" && c.roster[0].nickname === "Kusa" && c.roster[0].jersey_no === 13, "overlay: queued add shows (with temp id + kit), queued removal hides");
    assert(c.tournaments[0].id === "T" && c.tournaments[0].pending && c.presets.match[0].name === "T10", "overlay: offline tournament and preset show");
    assert(club.roster.length === 1 && club.roster[0].id === "p1", "overlay never mutates the cached snapshot");
    const t = win.overlayTournamentData(null, ops, [{ id: "m1", clubId: "c", tournamentId: "T", completedAt: 5 }, { id: "g1", tournamentId: "T" }], "T");
    assert(t && t.name === "Club Day" && t.teams.length === 1 && t.teams[0].pending, "overlay: a tournament created offline exists with its offline team");
    assert(t.matches.length === 1 && t.matches[0].data.id === "m1", "overlay: this device's archived club matches count toward it (guest ones don't)");
    assert(win.overlayTournamentData(null, [], [], "nope") === null, "overlay: an unknown tournament with nothing queued is null");

    const remapped = win.replaceIdDeep({ a: [{ id: "tmp:1" }, "tmp:1"], b: { c: "tmp:12" } }, "tmp:1", "real-1");
    assert(remapped.a[0].id === "real-1" && remapped.a[1] === "real-1" && remapped.b.c === "tmp:12", "temp ids are replaced exactly, not by prefix");
    assert(win.isNetworkError({ message: "TypeError: Failed to fetch" }, true), "a fetch failure is a network error");
    assert(!win.isNetworkError({ message: "duplicate key", code: "23505" }, true), "a database error with a code is not");
    assert(win.isNetworkError({ message: "anything", code: "42501" }, false), "everything counts as network while offline");
    assert(/Kusal/.test(win.describeOp(ops[0])) && /Club Day/.test(win.describeOp(ops[2])), "describeOp names what's queued");
  }

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
