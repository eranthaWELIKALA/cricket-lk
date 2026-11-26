const fs = require("fs");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

// index.html loads its code as ordered classic scripts (js/...) and a
// stylesheet; inline them so jsdom runs the same code, in the same order,
// without needing a web server.
const html = fs.readFileSync(__dirname + "/index.html", "utf8")
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
    `<script>${fs.readFileSync(__dirname + "/" + src, "utf8").replace(/<\/script/gi, "<\\/script")}</script>`)
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>${fs.readFileSync(__dirname + "/" + href, "utf8")}</style>`);
// No network: boot's initAuth would load supabase-js from its CDN, and when
// that download lands (whenever the network allows) it sets the session --
// in the middle of whichever later test is running, which then fails at random.
// The tests put in their own stand-in client wherever they need one.
class OfflineLoader extends ResourceLoader {
  fetch(url, options){ return /^https?:\/\/(?!localhost)/.test(url) ? Promise.reject(new Error("offline: " + url)) : super.fetch(url, options); }
}
const quiet = new VirtualConsole();
quiet.sendTo(console, { omitJSDOMErrors: true });
quiet.on("jsdomError", e => { if (!/Could not load script|offline: /.test(e.message)) console.error(e); });
const dom = new JSDOM(html, { runScripts: "dangerously", resources: new OfflineLoader(), url: "http://localhost/", virtualConsole: quiet });
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

  // --- 5a. run out at either end: the new batter comes in where the
  // wicket was broken, the survivor stands at the other end ---
  {
    const setup = () => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      const inn = currentInnings(m);
      win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
      inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
      return inn;
    };
    let inn = setup();
    // striker runs, out short of the bowler's end with no run completed
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 0, endComingIn: "striker", outEnd: "nonStriker" });
    assert(inn.batting.stats.A1.out && inn.nonStriker === null && inn.striker === "A2", "striker out at the bowler's end: non-striker moves to the keeper's end, new batter at the bowler's end");
    inn = setup();
    // non-striker out at the keeper's end after completing one run
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 1, endComingIn: "nonStriker", outEnd: "striker" });
    assert(inn.batting.stats.A2.out && inn.striker === null && inn.nonStriker === "A1", "non-striker out at the keeper's end: new batter faces, striker at the bowler's end");
    assert(inn.batting.stats.A1.runs === 1 && inn.runs === 1, "completed run still credited");
    inn = setup();
    // odd runs completed don't flip strike on a run-out -- the ends say where everyone is
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 1, endComingIn: "striker", outEnd: "striker" });
    assert(inn.striker === null && inn.nonStriker === "A2", "out at the keeper's end: new batter takes strike regardless of runs completed");
    inn = setup();
    // last ball of the over: the end-of-over swap still applies after the ends are set
    for (let i = 0; i < 5; i++) recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: 0, endComingIn: "striker", outEnd: "nonStriker" });
    assert(inn.striker === null && inn.nonStriker === "A2", "run-out at the bowler's end on the last ball: new batter faces the next over");
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

  // --- 5b2. ball-by-ball commentary (inningsCommentary) ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
    inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1";
    recordBall(inn, { kind: "run", runs: 4 });
    recordBall(inn, { kind: "wide", runs: 0 });
    recordBall(inn, { kind: "noball", runs: 6 });
    recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "wicket", wicketType: "caught", fielder: "B2" });
    win.ensureBatsman(inn, "A3"); inn.striker = "A3";
    recordBall(inn, { kind: "legbye", runs: 1 });
    recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "run", runs: 0 });
    const c = win.inningsCommentary(inn);
    const balls = c.filter(l => l.type === "ball");
    assert(balls.map(l => l.label).join(" ") === "0.1 0.2 0.2 0.2 0.3 0.4 0.5 0.6", "commentary labels: extras carry the next ball's number");
    assert(balls[0].who === "B1 to A1" && balls[0].text === "FOUR" && balls[0].tone === "four", "a boundary reads 'B1 to A1, FOUR'");
    assert(balls[2].text === "no ball, SIX off the bat" && balls[3].text === "Free hit: no run", "no ball off the bat, then the free hit is called out");
    assert(balls[4].text === "OUT! Caught by B2" && balls[4].detail === "A1 c B2 b B1 10 (4)", "a catch names the fielder and the batter's line");
    const end = c[c.length - 1];
    assert(end.type === "over" && end.score === 13 && end.wkts === 1 && end.figures === "1-0-12-1", "end of over row: score and bowler figures (leg byes not against the bowler)");
    assert(balls[0].batter === "A1 4 (1)" && balls[1].batter === "A1 4 (1)" && balls[2].batter === "A1 10 (2)", "each ball shows the striker's score after it (a wide isn't a ball faced)");
    assert(balls[4].batter === "" && balls[5].batter === "A3 0 (1)", "a dismissed striker's score is in the detail line, not repeated");
    // toss + how it ended
    const t = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "B", ballsPerOver: 1, tossWinner: "A" });
    let ends = win.commentaryBookends(t, 0);
    assert(ends.start[0] === "Lions won the toss and chose to field." && ends.start[1] === "Tigers to bat, Lions to bowl." && !ends.end.length, "the first innings opens with the toss and who bats");
    assert(win.restartMatch(t, "A").tossWinner === "A" && win.commentaryBookends(win.restartMatch(t, "A"), 0).start[0] === "Lions won the toss and chose to bat.", "flipping who bats first keeps the toss winner, so the choice flips");
    const ti = currentInnings(t);
    win.ensureBatsman(ti, "B1"); win.ensureBatsman(ti, "B2"); win.ensureBowler(ti, "A1");
    ti.striker = "B1"; ti.nonStriker = "B2"; ti.bowler = "A1"; t.status = "live";
    recordBall(ti, { kind: "run", runs: 6 }); afterBall(t);
    ends = win.commentaryBookends(t, 0);
    assert(ends.end[0] === "Innings over: Tigers 6/0 (1.0 ov) — overs complete." && ends.end[1] === "Lions need 7 to win.", "a finished innings says why it ended and sets the target");
    win.startSecondInnings(t);
    assert(win.commentaryBookends(t, 1).start[0] === "Lions need 7 to win from 1 over.", "the chase opens with the target");
    const ci = currentInnings(t);
    win.ensureBatsman(ci, "A1"); win.ensureBatsman(ci, "A2"); win.ensureBowler(ci, "B1");
    ci.striker = "A1"; ci.nonStriker = "A2"; ci.bowler = "B1";
    recordBall(ci, { kind: "run", runs: 1 }); afterBall(t);
    ends = win.commentaryBookends(t, 1);
    assert(t.status === "complete" && ends.end[ends.end.length - 1] === t.result, "the last innings ends with the match result");
    assert(!createMatch({ teamA: "a", teamB: "b", battingFirst: "A" }).tossWinner, "no toss recorded unless picked");
    // events from before commentary existed only have display strings
    const old = { ballsPerOver: 6, overs: [{ bowler: "X", events: [{ display: "Wd+4", runs: 5 }, { display: "W", isWicket: true, runs: 0 }] }], currentOverEvents: [] };
    const oc = win.inningsCommentary(old);
    assert(oc[0].text === "wide, and it runs away for FOUR" && oc[1].text === "OUT! Wicket" && oc[0].who === "X", "older matches still get commentary from the display strings");
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

  // --- 5e2. coming back from a confirmation email (parseAuthReturn) ---
  {
    const p = win.parseAuthReturn;
    assert(p("", "") === null && p("", "#/teams") === null && p("?x=1", "#/") === null, "no auth parameters: nothing to do");
    const a = p("?code=abc123", "");
    assert(a && a.code === "abc123" && !a.error && a.cleanSearch === "" && a.cleanHash === "", "a PKCE code is read and taken out of the URL");
    const b = p("?code=abc&keep=1", "#/clubs/7");
    assert(b.code === "abc" && b.cleanSearch === "?keep=1" && b.cleanHash === "#/clubs/7", "other query parameters and an app route survive, got " + b.cleanSearch + b.cleanHash);
    const c = p("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "");
    assert(c && c.error === "otp_expired" && /expired/.test(c.errorText) && !c.code && c.cleanSearch === "", "an expired link's error (query) is read and removed");
    const d = p("", "#error=access_denied&error_code=otp_expired&error_description=expired");
    assert(d && d.error === "otp_expired" && d.cleanHash === "", "an error in the hash (implicit flow) is read, and the hash dropped");
    const e = p("", "#access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer&type=signup");
    assert(e && e.accessToken === "AT" && e.refreshToken === "RT" && e.cleanHash === "", "an old-style #access_token link is read, and the tokens leave the URL");
    assert(p("", "#access_token=AT") === null, "an access token without a refresh token isn't a sign-in");
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
    assert(both.innings === 4 && both.runs === 63 + 102 + 40 + 30 && both.matches === 2, "career folds every alias's matches and innings together (a match with both names counts once)");
    assert(both.highScore.runs === 102 && both.hundreds === 1, "merged career keeps the best single innings across names");
    assert(both.notOuts === 2 && Math.abs(both.average - (both.runs / 2)) < 1e-9, "merged average is recomputed over combined dismissals, not averaged from the parts");
    assert(win.playerCareer(["Nobody", "Star"], [m2]).runs === 165 && win.playerCareer(["Nobody", "Nope"], [m2]) === null, "unknown aliases are ignored; no appearances under any name is still null");
    assert(win.playerCareer(["Star", "STAR"], [m2]).runs === 165, "a duplicated name isn't counted twice");

    // A profile's Matches tab: the player's own line in each match, newest first.
    m2.id = "m2"; m2.completedAt = 2000; m3.id = "m3"; m3.completedAt = 3000; m.id = "m1"; m.completedAt = 1000;
    const lines = win.playerMatchLines(["star", "S. Star"], [m, m2, m3, m2]);
    assert(lines.map(l => l.match.id).join() === "m3,m2", "Matches: every match the player (any spelling) appears in, newest first, a repeated match once");
    assert(lines[1].bat.runs === 165 && lines[1].bat.balls === 100 && lines[1].bat.out && lines[1].field.catches === 2 && lines[1].field.runouts === 1 && lines[1].team === "A",
      "Matches: both innings' batting and the fielding fold into one line, with the side they played for");
    assert(lines[0].bat.runs === 70 && lines[0].bat.out === true, "Matches: two spellings in one match add up");
    assert(win.playerMatchLineText(lines[1]) === "165 (100) · 2 ct, 1 ro", "Matches: the line in words (no bowling line for a non-bowler)");
    const ace = win.playerMatchLines("Ace", [m2])[0];
    assert(win.playerMatchLineText(ace) === "6/39 (6.0)" && ace.team === "B", "Matches: a bowler's figures, as wickets/runs (overs)");
    assert(win.playerMatchLineText(win.playerMatchLines("A2", [m])[0]) === "0* (0)", "Matches: a not-out batter gets a *");
    assert(win.playerMatchLines("Nobody", [m, m2]).length === 0 && win.playerMatchLines("Star", [Object.assign({}, m2, { anonymous: true })]).length === 0,
      "Matches: none for a name that never played, and \"no names\" matches are left out");
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

  // --- 13. calcPlayerPoints follows a points preset ---
  {
    const preset = id => win.eval("DEFAULT_POINTS_PRESETS").find(p => p.id === id);
    const line = [{ runs: 55, fours: 4, sixes: 2, balls: 30, out: false }, { wickets: 2, maidens: 1 }, { catches: 1, runouts: 0 }];
    const pts = calcPlayerPoints(...line, preset("points-classic"));
    // batting: 55 + 4 + (2*2) + fifty(8) + notOut(4) = 75; bowling: (2*25) + (1*8) = 58; fielding: 1*8 = 8
    assert(pts === 141, `the Classic preset is the old fixed formula, got ${pts}`);
    // Club: 55 + (4*2) + (2*4) + 8 + 2 = 81; (2*15) + 10 = 40; a catch 10
    assert(calcPlayerPoints(...line) === 131 && win.eval("DEFAULT_POINTS_PRESETS[0].id") === win.eval("DEFAULT_POINTS_PRESET_ID"), "with no preset, the default (Club) points");
    // A preset saved before milestones were lists (fixed 30/50/100, 3/4/5
    // wickets) counts exactly as it did: the old Club numbers still give 121.
    const oldClub = { perRun: 1, perFour: 2, perSix: 4, thirty: 4, fifty: 8, century: 16, notOut: 2, duck: 0,
      perWicket: 15, bowledLbw: 0, perMaiden: 5, perDot: 0, threeWickets: 0, fourWickets: 0, fiveWickets: 0,
      perCatch: 5, perStumping: 5, perRunOut: 8, economy: null, strikeRate: null };
    assert(calcPlayerPoints(...line, oldClub) === 121, "an old-shape preset (thirty/fifty/century) gives the points it always did");
    assert(calcPlayerPoints({ runs: 55, balls: 30, out: true, fours: 0, sixes: 0 }, null, null, Object.assign({}, oldClub, { fifty: 0 })) === 55
      && calcPlayerPoints(null, { wickets: 3, maidens: 0, runs: 20, legalBalls: 12 }, null, Object.assign({}, oldClub, { threeWickets: 7 })) === 52
      && calcPlayerPoints(null, { wickets: 4, maidens: 0, runs: 20, legalBalls: 12 }, null, Object.assign({}, oldClub, { threeWickets: 7 })) === 60,
      "...an old 50 or 4-wicket haul worth nothing still caps the one below it");

    const club = preset("points-club"), fantasy = preset("points-fantasy"), ipl = preset("points-ipl");
    const bat = (runs, balls, out, fours = 0, sixes = 0) => calcPlayerPoints({ runs, balls, out, fours, sixes }, null, null, club);
    assert(bat(19, 20, true) === 19 && bat(20, 20, true) === 22 && bat(32, 30, true) === 36 && bat(50, 40, true) === 58 && bat(100, 80, true) === 116, "milestones: 20 +2, 30 +4, 50 +8 (not also 30), 100 +16 (highest only)");
    const own = Object.assign({}, club, { battingMilestones: [{ at: 50, pts: 8 }, { at: 25, pts: 3 }], wicketHauls: [{ at: 2, pts: 5 }, { at: 3, pts: 9 }], economy: null });
    const ownBat = runs => calcPlayerPoints({ runs, balls: runs + 10, out: true, fours: 0, sixes: 0 }, null, null, own);
    const ownBowl = wickets => calcPlayerPoints(null, { wickets, maidens: 0, runs: 20, legalBalls: 12 }, null, own);
    assert(ownBat(24) === 24 && ownBat(25) === 28 && ownBat(60) === 68 && ownBowl(1) === 15 && ownBowl(2) === 35 && ownBowl(4) === 69,
      "a preset's own milestones (25, 50, in any order) and wicket hauls (2, 3): the highest reached only");
    assert(calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 4, legalBalls: 6, ballsPerOver: 6 }, null, club) === 6
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 9, legalBalls: 6, ballsPerOver: 6 }, null, club) === 4
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 14, legalBalls: 6, ballsPerOver: 6 }, null, club) === 2
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 15, legalBalls: 6, ballsPerOver: 6 }, null, club) === 0
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 2, legalBalls: 5, ballsPerOver: 6 }, null, club) === 0,
      "Club: economy under 5 +6, under 10 +4, under 15 +2, after a full over");
    assert(calcPlayerPoints(null, { wickets: 3, maidens: 0, runs: 30, legalBalls: 12, hatTricks: 1 }, null, club) === 65
      && calcPlayerPoints(null, { wickets: 4, maidens: 0, runs: 30, legalBalls: 12, hatTricks: 1.5 }, null, club) === 90,
      "Club: a hat-trick +20, and 4 in 4 (1.5 hat-tricks) +30");
    assert(calcPlayerPoints(null, null, { catches: 2, runouts: 1, stumpings: 1 }, club) === 45, "Club fielding: 10 a catch, 10 a stumping, 15 a run-out (as much as a wicket)");
    assert(bat(10, 8, false) === 12 && bat(0, 0, false) === 0, "not out +2 only after facing a ball");
    assert(calcPlayerPoints({ runs: 0, balls: 3, out: true, fours: 0, sixes: 0 }, null, null, fantasy) === -2, "a duck can take points away");
    const bowl = (wickets, extra = {}) => calcPlayerPoints(null, Object.assign({ wickets, maidens: 0, runs: 30, legalBalls: 6 }, extra), null, fantasy);
    assert(bowl(3) === 79 && bowl(4) === 108 && bowl(5) === 141, "wicket hauls: 3 +4, 4 +8, 5 +16 (highest only)");
    assert(bowl(2, { bowledLbw: 1 }) === 58, "a bowled/lbw wicket gets its bonus");
    assert(calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 18, legalBalls: 24, ballsPerOver: 6 }, null, fantasy) === 6
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 26, legalBalls: 12, ballsPerOver: 6 }, null, fantasy) === -6
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 18, legalBalls: 12, ballsPerOver: 6 }, null, fantasy) === 0
      && calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 30, legalBalls: 11, ballsPerOver: 6 }, null, fantasy) === 0,
      "economy bands: 4.5 an over +6, 13 an over -6, 9 (between bands) and under 2 overs nothing");
    assert(calcPlayerPoints(null, { wickets: 0, maidens: 0, runs: 21, legalBalls: 10, ballsPerOver: 5 }, null, fantasy) === -2, "economy counts the match's own over length (21 off two 5-ball overs is 10.5 an over)");
    assert(calcPlayerPoints({ runs: 20, balls: 10, out: true, fours: 0, sixes: 0 }, null, null, fantasy) === 26
      && calcPlayerPoints({ runs: 20, balls: 9, out: true, fours: 0, sixes: 0 }, null, null, fantasy) === 20,
      "strike-rate bands only after the minimum balls faced (SR 200 off 10 balls +6, off 9 nothing)");
    assert(calcPlayerPoints({ runs: 14, balls: 9, out: true, fours: 2, sixes: 1 }, { wickets: 1, maidens: 0, dots: 7, runs: 20, legalBalls: 24 }, { catches: 1, runouts: 0, stumpings: 1 }, ipl) === 24,
      "IPL MVP: 2.5 a four, 3.5 a six and a wicket, 1 a dot, 2.5 a catch/stumping, no points for runs");
    assert(win.pointsBand(5, [{ from: null, below: 5, pts: 6 }, { from: 5, below: 6, pts: 4 }]) === 4 && win.pointsBand(9, [{ from: null, below: 5, pts: 6 }]) === 0, "a band is from <= x < below; outside every band is 0");

    const rows = Object.fromEntries(win.describePointsPreset(fantasy));
    assert(/25 a wicket/.test(rows.Bowling) && /\+4 at 3, \+8 at 4, \+16 at 5 \(the highest only\) wickets/.test(rows.Bowling) && /−2 for a duck/.test(rows.Batting), "describePointsPreset: plain words, only what it gives points for");
    assert(/After 2 overs/.test(rows.Economy) && /under 5 \+6/.test(rows.Economy) && /170 and over \+6/.test(rows["Strike rate"]), "describePointsPreset: the rate bands");
    assert(Object.fromEntries(win.describePointsPreset(ipl)).Batting === "+2.5 a four · +3.5 a six" && !win.describePointsPreset(preset("points-classic")).some(([k]) => k === "Economy"), "describePointsPreset: no rows for bands it doesn't use");
    const clubRows = Object.fromEntries(win.describePointsPreset(club));
    assert(/\+2 at 20, \+4 at 30, \+8 at 50, \+16 at 100 \(the highest only\) runs/.test(clubRows.Batting)
      && /\+20 a hat-trick \(\+10 for each wicket in a row after it\)/.test(clubRows.Bowling)
      && /After 1 over in an innings, runs an over under 5 \+6 · 5 to under 10 \+4 · 10 to under 15 \+2/.test(clubRows.Economy),
      "describePointsPreset: the milestones a preset lists, the hat-trick and Club's economy");
    assert(/\+4 at 30, \+8 at 50, \+16 at 100/.test(Object.fromEntries(win.describePointsPreset(oldClub)).Batting), "describePointsPreset: an old-shape preset's milestones");
    assert(/Batting milestone 1: fill in the runs/.test(win.pointsPresetError({ battingMilestones: [{ at: null, pts: 2 }] }))
      && /Wicket haul 1: the wickets have to be a whole number/.test(win.pointsPresetError({ wicketHauls: [{ at: 2.5, pts: 2 }] }))
      && /Batting milestones: 25 is in twice/.test(win.pointsPresetError({ battingMilestones: [{ at: 25, pts: 2 }, { at: 25, pts: 3 }] }))
      && win.pointsPresetError(club) === null, "pointsPresetError: a milestone needs a whole number, once");
    assert(win.pointsPresetError(fantasy) === null && /add at least one band/.test(win.pointsPresetError({ economy: { minOvers: 2, bands: [] } }))
      && /band 1: From has to be lower/.test(win.pointsPresetError({ strikeRate: { minBalls: 0, bands: [{ from: 50, below: 40, pts: 2 }] } }))
      && /band 1: fill in/.test(win.pointsPresetError({ economy: { minOvers: 0, bands: [{ from: null, below: null, pts: 2 }] } })), "pointsPresetError: empty or backwards bands are refused");
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

  // --- 14b. points from a real innings: dots, bowled/lbw, stumpings, per-preset MOTM ---
  {
    const preset = id => win.eval("DEFAULT_POINTS_PRESETS").find(p => p.id === id);
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1");
    recordBall(inn, { kind: "run", runs: 0 });                       // dot
    recordBall(inn, { kind: "bye", runs: 1 });                       // dot for the bowler
    recordBall(inn, { kind: "wide", runs: 0 });                      // not a dot (not legal)
    recordBall(inn, { kind: "wicket", wicketType: "lbw" });          // dot + lbw
    win.sendInBatter(inn, "A3");
    recordBall(inn, { kind: "wicket", wicketType: "stumped", fielder: "K1" });  // dot, stumped by K1
    win.sendInBatter(inn, "A4");
    recordBall(inn, { kind: "run", runs: 6 });
    recordBall(inn, { kind: "wicket", wicketType: "bowled" });       // dot + bowled
    const x = win.inningsBowlerExtras(inn).B1;
    assert(x.dots === 5 && x.bowledLbw === 2, `dots and bowled/lbw are read from ball by ball and howOut, got ${JSON.stringify(x)}`);
    const st = inn.batting.stats.A3;
    assert(st.howOut === "st K1 b B1" && inn.fielding.stats.K1.stumpings === 1 && inn.bowling.stats.B1.wickets === 3, "a stumping names the keeper and is still the bowler's wicket");
    assert(/Stumped by K1/.test(win.inningsCommentary(inn).find(c => c.type === "ball" && /Stumped/.test(c.text)).text), "commentary: Stumped by the keeper");

    const totals = Object.fromEntries(win.aggregatePlayerStats([m], preset("points-ipl")).map(t => [t.name, t]));
    assert(totals.B1.dots === 5 && totals.B1.points === 3 * 3.5 + 5 && totals.K1.stumpings === 1 && totals.K1.points === 2.5, "IPL MVP points from a real innings (wickets + dots; the keeper's stumping)");
    assert(totals.A1.highScore.runs === 0 && !totals.A1.highScore.out && totals.A1.ducks === 0 && totals.A2.ducks === 1 && totals.B1.best.wickets === 3 && totals.B1.bowlInnings === 1, "totals keep highest score, ducks (out for 0 only), bowling innings and best bowling");
    assert(win.fieldDismissals(totals.K1) === 1, "fieldDismissals counts stumpings");
    // A bowler's day vs a batter's: which preset decides player of the match.
    assert(win.pickMatchMOTM(m, preset("points-classic")) === "B1", "player of the match follows the preset (Classic: the bowler)");
    const runsOnly = Object.assign({}, preset("points-classic"), { perWicket: 0, perMaiden: 0, perStumping: 0 });
    assert(win.pickMatchMOTM(m, runsOnly) === "A3" || win.pickMatchMOTM(m, runsOnly) === "A4", "...and a preset with no bowling points picks a batter");

    // An innings from before stumpings were counted still matches its rebuilt scorecard.
    const now = JSON.parse(JSON.stringify(inn)); now.fielding.stats.K1 = { catches: 1, runouts: 0, stumpings: 0 };
    const old = JSON.parse(JSON.stringify(now)); delete old.fielding.stats.K1.stumpings;
    assert(win.inningsScorecardKey(old) === win.inningsScorecardKey(now), "inningsScorecardKey: a fielding line without stumpings equals one with 0");
    assert(win.catchUpHowOut("stumped", "B1", "K1") === "st K1 b B1" && win.catchUpHowOut("stumped", "B1", null) === "stumped b B1", "catch-up: a stumping can name the keeper");
  }

  // --- 14c. hat-tricks, from ball by ball ---
  {
    const W = { kind: "wicket", wicketType: "bowled" };
    const C = { kind: "wicket", wicketType: "caught", fielder: "F1" };
    const dot = { kind: "run", runs: 0 };
    // Bowls `balls` (B1 bowls overs 1, 3, 5…; B2 the others), sending in a new batter after each wicket.
    const play = (balls, opts) => {
      const m = createMatch(Object.assign({ teamA: "Lions", teamB: "Tigers", oversLimit: 10, playersPerSide: 11, battingFirst: "A" }, opts));
      const inn = currentInnings(m);
      win.openInnings(inn, "A1", "A2", "B1");
      let next = 3, over = 0;
      balls.forEach(ev => {
        recordBall(inn, Object.assign({}, ev));
        if (inn.striker === null || inn.nonStriker === null) win.sendInBatter(inn, "A" + next++);
        if (inn.bowler === null){ over++; win.setBowler(inn, over % 2 ? "B2" : "B1"); }
      });
      return inn;
    };
    const hats = (inn, who) => (win.inningsBowlerExtras(inn)[who || "B1"] || {}).hatTricks;
    assert(hats(play([dot, W, C, W, dot])) === 1, "three wickets in three balls: a hat-trick");
    assert(hats(play([dot, W, W, dot, W])) === 0, "two in a row, a dot, then a wicket: no hat-trick");
    assert(hats(play([dot, dot, dot, dot, W, W, dot, dot, dot, dot, dot, dot, W])) === 1, "across the bowler's overs (another bowler's over in between)");
    assert(hats(play([W, { kind: "wide", runs: 0 }, W, { kind: "noball", runs: 0 }, W])) === 1, "a wide or no-ball in between doesn't break it");
    assert(hats(play([W, W, { kind: "wicket", wicketType: "runout", runs: 0, endComingIn: "striker" }, W])) === 0, "a run-out isn't the bowler's: it breaks the run");
    assert(hats(play([W, W, { kind: "wicket", wicketType: "stumped", extra: "wide", runs: 0, fielder: "K1" }])) === 1, "a stumping off a wide is the bowler's wicket");
    assert(hats(play([W, W, W, W, dot])) === 1.5 && hats(play([W, W, W, W, W, dot])) === 2 && hats(play([W, W, W, W, W, W])) === 2.5, "each wicket in a row after the third adds half: 4 in 4 is 1.5, 5 in 5 is 2, 6 in 6 is 2.5");
    assert(hats(play([W, W, W, dot, W, W, W], { ballsPerOver: 8 })) === 2, "two separate hat-tricks count twice");
    const split = play([dot, dot, dot, dot, dot, W, W, W, W]);
    assert(hats(split) === 0 && hats(split, "B2") === 1, "each bowler's own deliveries: B1's last-ball wicket doesn't join B2's three");
    // Over events from older app versions (display only): "W" is the bowler's, "Ro" a run-out.
    const old = d => ({ display: d, runs: 0, isWicket: /W|Ro/.test(d) });
    const oldInn = (events, gap) => ({ overs: gap ? [{ bowler: "X", events: events.slice(0, 2) }, { bowler: null, events: [], gap: {} }, { bowler: "X", events: events.slice(2) }] : [{ bowler: "X", events }],
      currentOverEvents: [], bowler: null, batting: { order: [], stats: {} } });
    assert(win.inningsBowlerExtras(oldInn([old("W"), old("W"), old("W")])).X.hatTricks === 1 && win.inningsBowlerExtras(oldInn([old("W"), old("Ro"), old("W"), old("W")])).X.hatTricks === 0, "older over events: W counts, Ro breaks");
    assert(win.inningsBowlerExtras(oldInn([old("W"), old("W"), old("W")], true)).X.hatTricks === 0, "a catch-up gap (balls not known) breaks the run");
    const club = win.eval("DEFAULT_POINTS_PRESETS[0]");
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1");
    [dot, dot, dot, W, W, W].forEach((ev, i) => { recordBall(inn, Object.assign({}, ev)); if (i > 2) win.sendInBatter(inn, "A" + i); });
    const b1 = win.aggregatePlayerStats([m], club).find(t => t.name === "B1");
    // 3 wickets 45 + hat-trick 20 + economy (0 an over) 6 + a maiden 10
    assert(b1.points === 45 + 20 + 6 + 10, `a hat-trick's points reach the leaderboard (3 wickets, hat-trick, economy, maiden), got ${b1.points}`);
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

  // --- 18. forfeit mid-second-innings: counts for standings points, and for NRR as far as it was played ---
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
    recordBall(inn, { kind: "run", runs: 2 });
    forfeitMatch(m, "B");
    assert(m.status === "complete" && m.forfeited && m.forfeitedBy === "B", "second-innings forfeit is recorded");
    assert(m.result === "Lions won — Tigers forfeited the match", `forfeit result text correct, got: ${m.result}`);

    const tPreset = { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true };
    const standings = computeStandings([m], tPreset);
    const byName = Object.fromEntries(standings.map(t => [t.name, t]));
    assert(byName.Lions.won === 1 && byName.Lions.points === 2, "the non-forfeiting team gets a win and full points");
    assert(byName.Tigers.lost === 1 && byName.Tigers.points === 0, "the forfeiting team gets a loss");
    // Lions 6 off 1 over, Tigers 2 off 1 ball (0.1 over) when they forfeited.
    assert(byName.Lions.runsFor === 6 && byName.Lions.oversFor === 1 && byName.Tigers.runsFor === 2 && Math.abs(byName.Tigers.oversFor - 1 / 6) < 1e-9,
      "a forfeited match counts each innings' runs and the overs faced up to the forfeit");
    assert(Math.abs(byName.Lions.nrr - (6 - 12)) < 1e-9 && Math.abs(byName.Tigers.nrr - (12 - 6)) < 1e-9,
      `NRR is worked out from the overs played: ${byName.Lions.nrr}, ${byName.Tigers.nrr}`);

    // Bowled out, then forfeited at the break: the all-out innings counts its full quota.
    const m2 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 2, battingFirst: "A" });
    const i1 = currentInnings(m2);
    win.ensureBatsman(i1, "A1"); win.ensureBatsman(i1, "A2"); win.ensureBowler(i1, "B1");
    i1.striker = "A1"; i1.nonStriker = "A2"; i1.bowler = "B1";
    recordBall(i1, { kind: "run", runs: 4 }); afterBall(m2);
    recordBall(i1, { kind: "wicket", runs: 0, wicketType: "bowled" }); afterBall(m2);
    assert(m2.status === "innings_break" && i1.completeReason === "allout", "(setup) all out after 2 balls");
    forfeitMatch(m2, "B");
    const s2 = Object.fromEntries(computeStandings([m2], tPreset).map(t => [t.name, t]));
    assert(s2.Lions.runsFor === 4 && s2.Lions.oversFor === 5 && s2.Tigers.runsAgainst === 4 && s2.Tigers.oversAgainst === 5 && s2.Tigers.oversFor === 0,
      "forfeited at the break: the all-out innings counts its full 5 overs, the side yet to bat adds nothing");

    // End innings asks about a forfeit only when overs and wickets are left.
    const m3 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A" });
    const i3 = currentInnings(m3);
    assert(win.inningsCutShort(i3), "a fresh innings with an overs limit is cut short if ended");
    i3.legalBalls = 12;
    assert(!win.inningsCutShort(i3), "...but not with every over bowled");
    i3.legalBalls = 3; i3.wickets = 10;
    assert(!win.inningsCutShort(i3), "...nor all out");
    const m4 = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: null, playersPerSide: 11, battingFirst: "A" });
    assert(!win.inningsCutShort(currentInnings(m4)), "no overs limit: ending by hand is how the innings ends, not cut short");
  }

  // --- 18b. a forfeited match can still be edited: the forfeit stays, unless the chase now ends first ---
  {
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const seqs = (m, i) => m.innings[i].log.filter(a => a.t === "ball").map(a => a.ev.seq);
    // Lions 12-0 (2 ov); Tigers 8-0 after 4 balls of the chase (need 13), then forfeit.
    const chase = forfeiter => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 3, battingFirst: "A" });
      win.openInnings(currentInnings(m), "A1", "A2", "B1"); m.status = "live";
      for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 2 });
      win.setBowler(currentInnings(m), "B2");
      for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 0 });
      startSecondInnings(m); win.openInnings(currentInnings(m), "B3", "B4", "A3"); m.status = "live";
      for (let i = 0; i < 4; i++) play(m, { kind: "run", runs: 2 });
      if (forfeiter) forfeitMatch(m, forfeiter);
      return m;
    };
    const m = chase("B");
    assert(win.editableBall(m, 1, seqs(m, 1)[0]) && win.editableBall(m, 0, seqs(m, 0)[0]), "a forfeited match's balls are editable, in both innings");
    let r = win.replayMatch(m, { inn: 1, seq: seqs(m, 1)[0], ev: { kind: "run", runs: 4 } });
    assert(r.match && r.match.status === "complete" && r.match.forfeited && r.match.forfeitedBy === "B" && r.match.result === "Lions won — Tigers forfeited the match"
      && r.match.innings[1].runs === 10 && !r.match.innings[1].complete && m.innings[1].runs === 8,
      "a ball changed in the chase: 10-0 where it stopped, still forfeited, the original untouched");
    r = win.replayMatch(m, [{ inn: 1, seq: seqs(m, 1)[0], ev: { kind: "run", runs: 6 } }, { inn: 1, seq: seqs(m, 1)[1], ev: { kind: "run", runs: 6 } }]);
    assert(r.match && !r.match.forfeited && !r.match.forfeitedBy && r.match.result === "Tigers won by 2 wickets (1.3 overs left)" && r.match.innings[1].legalBalls === 3
      && r.notes.some(t => /reach the target before the forfeit/.test(t) && /Tigers' forfeit no longer counts/.test(t)),
      "the chase now gets there before the forfeit: the forfeit goes, the result comes from the scores, and a note says why");
    r = win.replayMatch(m, [0, 1].map(k => ({ inn: 1, seq: seqs(m, 1)[k], ev: { kind: "wicket", wicketType: "bowled" } })), { batters: ["B5"] });
    assert(r.match && !r.match.forfeited && r.match.result === "Lions won by 12 runs" && r.notes.some(t => /all out before the forfeit/.test(t)),
      "...and so does a chase that's now all out first");
    r = win.replayMatch(m, [0, 1, 2].map(k => ({ inn: 0, seq: seqs(m, 0)[k], ev: { kind: "run", runs: 0 } })));
    assert(r.match && r.match.innings[1].target === 7 && /Tigers won by 2 wickets/.test(r.match.result) && !r.match.forfeited,
      "a first-innings change that brings the target within the chase's reach does too");
    const byA = chase("A");
    r = win.replayMatch(byA, [0, 1].map(k => ({ inn: 1, seq: seqs(byA, 1)[k], ev: { kind: "run", runs: 6 } })));
    assert(r.match && /Tigers won by 2 wickets/.test(r.match.result) && r.notes.some(t => /Lions' forfeit no longer counts/.test(t)), "whichever side forfeited");
    assert(/chase has already started/.test(win.replayMatch(m, { inn: 0, seq: seqs(m, 0)[11], ev: null }).error || ""), "a started chase still needs its first innings over");
    // forfeited at the break, the 2nd innings opened but nothing scored: a first innings that isn't over any more takes the forfeit with it
    const brk = chase(null); brk.innings.length = 1; brk.status = "innings_break"; startSecondInnings(brk); forfeitMatch(brk, "B");
    r = win.replayMatch(brk, { inn: 0, seq: seqs(brk, 0)[11], ev: null });
    assert(r.match && r.match.status === "complete" && r.match.forfeited && r.match.innings.length === 1 && !r.match.innings[0].complete
      && r.notes.includes("The first innings isn't over any more, so the forfeit now comes during it."),
      "at the break: a first innings that isn't over any more stays forfeited, the forfeit now during it");
    // forfeited mid-first-innings: a missed ball added after the last one
    const mid = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A" });
    win.openInnings(currentInnings(mid), "A1", "A2", "B1"); mid.status = "live";
    for (let i = 0; i < 4; i++) play(mid, { kind: "run", runs: 1 });
    forfeitMatch(mid, "A");
    r = win.replayMatch(mid, { inn: 0, seq: seqs(mid, 0)[3], ev: { kind: "run", runs: 4 }, insert: "after" });
    assert(r.match && r.match.status === "complete" && r.match.result === "Tigers won — Lions forfeited the match" && r.match.innings[0].runs === 8 && r.match.innings[0].legalBalls === 5,
      "forfeited mid-innings: a ball added after the last one, still forfeited");
    // the final score set by hand: where each innings stood at the forfeit
    let sh = win.setScoresByHand(m, [null, { runs: 10, wickets: 1, balls: 5 }]);
    assert(sh.match && sh.match.forfeited && sh.match.result === "Lions won — Tigers forfeited the match" && !sh.match.innings[1].complete && sh.match.innings[1].runs === 10,
      "a forfeited chase's score set by hand: still where the forfeit stopped it, not ended");
    sh = win.setScoresByHand(m, [null, { runs: 14, wickets: 1, balls: 5 }]);
    assert(sh.match && !sh.match.forfeited && /Tigers won by 1 wicket/.test(sh.match.result) && sh.notes.some(t => /forfeit no longer counts/.test(t)),
      "...set past the target, the chase was over first: the result comes from the scores");
    assert(/Tigers didn't bat before the forfeit/.test(win.setScoresByHand(brk, [null, { runs: 5, wickets: 0, balls: 3 }]).error || ""), "a side that never batted gets no score");
    sh = win.setScoresByHand(mid, [{ runs: 20, wickets: 1, balls: 10 }, null]);
    assert(sh.match && sh.match.forfeited && !sh.match.innings[0].complete && sh.match.innings[0].runs === 20, "a first innings the forfeit cut short: set, and left in progress");
    // who forfeited, put right
    let c = win.changeForfeit(m, "A");
    assert(c.match && c.match.forfeitedBy === "A" && c.match.status === "complete" && c.match.result === "Tigers won — Lions forfeited the match" && m.forfeitedBy === "B",
      "the other side forfeited instead: only the result changes (on a copy)");
    c = win.changeForfeit(m, null);
    assert(c.match && !c.match.forfeited && c.match.status === "live" && c.match.result === null && c.match.innings[1].runs === 8, "nobody forfeited: live again where it stopped");
    assert(win.changeForfeit(brk, null).match.status === "opening" && win.changeForfeit(chase(null), null).error && win.changeForfeit(m, "B").error,
      "...at the opening of the chase; and it refuses a match that wasn't forfeited, or the same side");
    assert(/take the forfeit back first/.test(win.reopenInningsError(brk, 0) || ""), "reopening waits for the forfeit to be taken back");
    // a player changed in a forfeited match
    const rp = win.replacePick(m, { inn: 1, role: "batter", from: "B3", to: "B9" });
    assert(rp.match && rp.match.innings[1].batting.order.includes("B9") && rp.match.forfeited, "a wrongly picked player can be replaced in a forfeited match");
    // archived without its log: the innings the forfeit cut short is rebuilt, with who was in
    const cut = chase(null);
    const cutInn = currentInnings(cut);
    play(cut, { kind: "wicket", wicketType: "bowled" }); win.sendInBatter(cutInn, "B5");
    forfeitMatch(cut, "B");
    const rb = win.rebuildInningsFromScorecard(win.archivedCopy(cut), 1);
    assert(rb && win.inningsScorecardKey(rb) === win.inningsScorecardKey(cutInn) && rb.striker === cutInn.striker && rb.bowler === cutInn.bowler && rb.batting.order.includes("B5"),
      "an innings a forfeit cut short is rebuilt from its scorecard, the batter who'd just come in included");
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

    // No players limit: the rule stays on, and waits for the scorer to say nobody's left.
    const any = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: null, battingFirst: "A", lastManStands: true });
    const ai = currentInnings(any);
    win.openInnings(ai, "A1", "A2", "B1"); any.status = "live";
    assert(any.lastManStands && ai.lastManStands && ai.maxWickets === null, "last man stands with no players limit is kept (no all out yet)");
    recordBall(ai, { kind: "run", runs: 1 }); afterBall(any); recordBall(ai, { kind: "wicket", wicketType: "bowled" }); afterBall(any);
    assert(win.pendingBatsmanSlot(ai) === "striker" && win.canBatAlone(ai) && win.batAlone(ai) && ai.maxWickets === 2 && ai.striker === "A1" && !win.pendingBatsmanSlot(ai),
      "...a wicket asks for a batter, and Bat alone leaves A1 on strike with nobody asked for");
    recordBall(ai, { kind: "run", runs: 1 }); afterBall(any);
    assert(ai.striker === "A1" && ai.nonStriker === null, "...who keeps the strike after a single");
    recordBall(ai, { kind: "wicket", wicketType: "bowled" }); afterBall(any);
    assert(ai.complete && ai.completeReason === "allout" && any.status === "innings_break", "...and their wicket ends the innings, all out");
    assert(win.conditionTagsFor(any).includes("last man stands")
      && /last batter bats alone/.test(Object.fromEntries(win.describeMatchPreset({ ballsPerOver: 6, oversLimit: 5, playersPerSide: null, lastManStands: true })).Players),
      "...and the presets say so");
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

  // --- auth emails: the built-in mailer's rate limit is queued and retried, never shown raw ---
  {
    assert(win.isAuthRateLimit({ status: 429, message: "x" }) && win.isAuthRateLimit({ code: "over_email_send_rate_limit" }) && win.isAuthRateLimit({ message: "Email rate limit exceeded" }), "a 429 / email rate limit is recognised");
    assert(!win.isAuthRateLimit({ status: 400, message: "Invalid login credentials" }) && !win.isAuthRateLimit(null), "other auth errors aren't");
    assert(win.isEmailNotConfirmed({ code: "email_not_confirmed" }) && win.isEmailNotConfirmed({ message: "Email not confirmed" }), "an unconfirmed email is recognised");
    assert(/Couldn't reach the cricket\.lk server/.test(win.friendlyError("TypeError: Failed to fetch")), "a failed fetch while online says the server is unreachable, not 'offline'");
    Object.defineProperty(win.navigator, "onLine", { value: false, configurable: true });
    assert(/You're offline/.test(win.friendlyError("TypeError: Failed to fetch")), "...and 'offline' only when the device really is");
    Object.defineProperty(win.navigator, "onLine", { value: true, configurable: true });
    assert(win.friendlyError("Invalid login credentials") === "Invalid login credentials", "other errors pass through unchanged");
    assert(win.authMailDelay(1) === 60000 && win.authMailDelay(3) === 300000 && win.authMailDelay(9) === 600000, "retries back off 1m, 2m, 5m, then every 10m");

    // win.eval runs in the page's own global scope, so top-level lets (authMail, supabaseClient) are reachable.
    const runInPage = code => win.eval(code);
    runInPage(`
      window.__calls = [];
      window.__prevClient = supabaseClient;
      supabaseClient = { auth: {
        signUp: async args => { __calls.push(["signUp", args.email, args.password]); return __calls.length === 1 ? { data: {}, error: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" } } : { data: { session: null }, error: null }; },
        resend: async args => { __calls.push(["resend", args.email]); return { data: {}, error: null }; }
      } };
      state.match = null; // earlier tests leave a match on screen
      state.view = "signUp"; render();
      const form = document.getElementById("sign-up-form");
      const field = n => form.querySelector('[name="' + n + '"]');
      field("displayName").value = "Kusal"; field("email").value = "k@example.com"; field("password").value = "secret123";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    `);
    await wait(20);
    win.eval("window.__job = authMail");
    let job = win.__job;
    assert(job && job.kind === "signup" && job.status === "waiting" && job.attempts === 1 && job.nextAt > Date.now(), "a rate-limited sign-up is queued for a retry");
    assert(!/rate limit exceeded/.test(win.document.getElementById("app").textContent) && /Queued: email limit reached/.test(win.document.getElementById("app").textContent), "the screen explains the queue instead of the raw error");
    assert(!win.document.getElementById("sign-up-form"), "the form is hidden while the sign-up waits (no double submit)");
    assert(!JSON.stringify(win.DB.load(win.STORAGE_KEY) || {}).includes("secret123"), "the queued password is never saved to storage");

    runInPage(`sendAuthMail()`);
    await wait(20);
    win.eval("window.__job = authMail; window.__view = state.view");
    job = win.__job;
    assert(win.__calls.length === 2 && job.status === "sent" && job.password === null, "the retry goes through and drops the password");
    assert(win.__view === "signIn" && /Check your inbox/.test(win.document.getElementById("app").textContent), "then it's 'check your inbox' on Sign in, with a resend");

    const resendBtn = () => win.document.querySelector('#app [data-action="auth-mail-send"]');
    assert(job.cooldownUntil - Date.now() > 55000 && resendBtn().disabled && /Resend in 0:(59|60)|Resend in 1:00/.test(resendBtn().textContent), "Resend is off for a minute after the email went out, with a countdown");
    runInPage(`sendAuthMail()`);
    await wait(20);
    assert(win.__calls.length === 2, "...and tapping it meanwhile sends nothing");

    runInPage(`authMail.cooldownUntil = Date.now() + 5000; tickAuthCooldown();`);
    assert(resendBtn().disabled && resendBtn().textContent === "Resend in 0:05", "the countdown ticks in the DOM");
    runInPage(`authMail.cooldownUntil = Date.now() - 1; tickAuthCooldown();`);
    assert(!resendBtn().disabled && resendBtn().textContent === "Resend email", "after the wait Resend is back (no re-render needed)");
    runInPage(`sendAuthMail()`);
    await wait(20);
    assert(win.__calls[2][0] === "resend" && win.__calls[2][1] === "k@example.com", "Resend email re-sends the confirmation (no password needed)");
    win.eval("window.__job = authMail");
    assert(win.__job.sent === 2 && win.__job.cooldownUntil - Date.now() > 115000, "each resend waits longer: 1 min, then 2");

    // The server's "one email a minute per address" is a countdown, not the hourly queue.
    assert(win.authRetryAfter({ status: 429, message: "For security purposes, you can only request this after 42 seconds." }) === 42 && win.authRetryAfter({ message: "Email rate limit exceeded" }) === null, "the seconds to wait are read from the error");
    assert(win.authResendWait(1) === 60000 && win.authResendWait(2) === 120000 && win.authResendWait(7) === 300000, "resend waits 1m, 2m, then 5m");
    runInPage(`
      supabaseClient.auth.resend = async args => { __calls.push(["resend", args.email]); return { data: {}, error: { status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 42 seconds." } }; };
      cancelAuthMail(); queueAuthMail({ kind: "resend", email: "k@example.com", status: "unconfirmed" }); render();
      sendAuthMail();
    `);
    await wait(20);
    win.eval("window.__job = authMail");
    job = win.__job;
    assert(job.status === "unconfirmed" && job.attempts === 0 && Math.abs(job.cooldownUntil - Date.now() - 42000) < 2000, "a resend that's too soon goes back to the card with a 42s countdown");
    assert(resendBtn().disabled && /Resend in 0:4[12]/.test(resendBtn().textContent) && !/email limit reached/.test(win.document.getElementById("app").textContent), "...shown on the button, not as the hourly-limit queue");
    runInPage(`cancelAuthMail(); supabaseClient = window.__prevClient; state.view = "home"; render();`);
  }

  // --- preset ⓘ: plain-language description, and the panel wherever a preset is picked ---
  {
    const rows = Object.fromEntries(win.eval(`describeMatchPreset(DEFAULT_MATCH_PRESETS[0])`));
    assert(rows.Overs === "20 overs per innings." && rows["Over length"] === "6 balls per over." && /11 a side\. All out at 10 wickets/.test(rows.Players), "match preset: overs, over length, players in words");
    assert(/1 run, and the ball is bowled again\. The next ball is a free hit\./.test(rows["No-balls"]) && !rows.Fielder, "match preset: no-ball + free hit; no fielder row when not required");
    const open = Object.fromEntries(win.describeMatchPreset({ ballsPerOver: 5, oversLimit: null, playersPerSide: 6, lastManStands: true, wide: { enabled: false }, noBall: { enabled: true, runs: 2 }, freeHitOnNoBall: false, requireFielderOnCatch: true, requireFielderOnRunout: true }));
    assert(/No limit/.test(open.Overs) && /All out at 6 wickets \(last man stands/.test(open.Players) && open.Wides === "Not called." && /2 runs.*No free hit/.test(open["No-balls"]) && open.Fielder === "Must be named for catches and run-outs.", "match preset: no limit, last man stands, wides off, fielder rule");
    assert(/Any number/.test(Object.fromEntries(win.describeMatchPreset({ ballsPerOver: 6, oversLimit: 1, playersPerSide: null })).Players), "match preset: no players limit, and '1 over' is singular" );
    const tr = Object.fromEntries(win.describeTournamentPreset({ pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true }, "T20 (6-ball overs)"));
    assert(tr.Matches === "Played as T20 (6-ball overs)." && tr.Points === "Win 2 · Tie 1 · Loss 0" && /NRR/.test(tr["Level on points"]), "tournament preset in words");
    assert(/picked when each match is set up/.test(Object.fromEntries(win.describeTournamentPreset({ pointsForWin: 3, pointsForTie: 1, pointsForLoss: 0, useNRR: false }, null)).Matches), "club tournament preset: conditions come from match setup");

    win.eval(`state.match = null; ui.presetInfo = null; ui.matchSetupPresetId = null; state.activeClubId = null; ui.clubMatchSetupType = null; state.view = "matchSetup"; render();`);
    const doc = win.document;
    const infoBtns = doc.querySelectorAll('#app .preset-info-btn');
    assert(infoBtns.length === doc.querySelectorAll('#app .preset-chip').length && infoBtns.length > 0, "match setup: every preset chip has an ⓘ");
    infoBtns[1].click();
    let panel = doc.querySelector("#app .preset-info");
    assert(panel && /T10/.test(panel.textContent) && /10 overs per innings/.test(panel.textContent), "tapping ⓘ shows that preset's rules (not the selected chip's)");
    assert(doc.querySelectorAll('#app .preset-info-btn')[1].getAttribute("aria-expanded") === "true", "the open ⓘ is marked expanded");
    assert(doc.querySelector('#app .preset-chip.active').dataset.id === "preset-t20", "ⓘ doesn't change which preset is picked");
    doc.querySelectorAll('#app .preset-info-btn')[1].click();
    assert(!doc.querySelector("#app .preset-info"), "tapping the same ⓘ again closes it");
    doc.querySelectorAll('#app .preset-info-btn')[0].click();
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(!doc.querySelector("#app .preset-info"), "Esc closes it");

    doc.querySelectorAll('#app .preset-info-btn')[2].click();
    win.eval(`state.view = "tournamentSetup"; render();`);
    assert(!doc.querySelector("#app .preset-info"), "an open panel doesn't follow you to another screen");
    doc.querySelector('#app .preset-info-btn').click();
    panel = doc.querySelector("#app .preset-info");
    assert(panel && /Played as T20/.test(panel.textContent) && /Win 2 · Tie 1 · Loss 0/.test(panel.textContent), "tournament setup: ⓘ explains the points system");
    win.eval(`ui.presetInfo = null; state.view = "home"; render();`);
  }

  // --- batters: never the same at both ends, out/at-crease names not offered, nickname display ---
  {
    const doc = win.document;
    win.eval(`ui = defaultUi(); state.useNicknames = false;
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      state.match.squads = { A: ["Kusal", "Pathum", "Charith"], B: ["Wanindu", "Dushmantha"] };
      state.snapshots = []; render();`);
    const form = () => doc.getElementById("opening-form");
    const rows = () => [...form().querySelectorAll(".opening-list .pick-row-item")].filter(r => !r.hidden).map(r => r.dataset.name);
    const slotTile = k => form().querySelector(`[data-action="opening-slot"][data-slot="${k}"]`);
    const val = k => form().querySelector(`input[type="hidden"][name="${k}"]`).value;
    const tapRow = n => form().querySelector(`.opening-list [data-name="${n}"]`).click();
    const search = () => form().querySelector("[data-pick-filter]");
    const type = v => { search().value = v; search().dispatchEvent(new win.Event("input", { bubbles: true })); };
    const startBtn = () => form().querySelector('button[type="submit"]');
    assert(slotTile("striker").classList.contains("active") && rows().join() === "Kusal,Pathum,Charith" && !(doc.activeElement && doc.activeElement.matches("input")),
      "opening sheet: the striker's slot first, with that side's whole list showing and nothing focused (no keyboard)");
    assert(startBtn().disabled, "Start innings waits for all three");
    slotTile("nonStriker").click();
    tapRow("Pathum");
    assert(val("nonStriker") === "Pathum" && val("striker") === "" && slotTile("striker").classList.contains("active"), "a tapped row fills the slot being picked, then the next empty slot is up");
    assert(rows().join() === "Kusal,Charith", "a name in one slot isn't offered in another");
    tapRow("Kusal");
    assert(slotTile("bowler").classList.contains("active") && rows().join() === "Wanindu,Dushmantha", "then the opening bowler, from the other side");
    type("dush");
    assert(rows().join() === "Dushmantha", "typing narrows the list from the start of a name");
    type("man");
    assert(rows().join() === "" && !form().querySelector(".pick-none").hidden, "...never from the middle of one");
    type("");
    tapRow("Wanindu");
    assert(val("bowler") === "Wanindu" && !form().querySelector(".opening-list") && !startBtn().disabled, "all three picked: the list goes and Start innings is ready");
    slotTile("striker").click();
    assert(slotTile("striker").classList.contains("active") && form().querySelector('.opening-list .active[data-name="Kusal"]'), "tapping a filled slot lists its side again, its pick lit");
    tapRow("Charith");
    assert(val("striker") === "Charith" && val("nonStriker") === "Pathum", "...and a tap changes just that pick");
    // Without squads both sides list the same players: one picked to bat isn't offered as a bowler.
    win.eval(`state.match.squadsSaved = state.match.squads; state.match.squads = null; findOrCreatePlayer("Charith"); findOrCreatePlayer("Wanindu"); render();`);
    slotTile("bowler").click();
    assert(!rows().includes("Charith") && rows().includes("Wanindu"), "a name picked to bat isn't offered as the bowler");
    win.eval(`state.match.squads = state.match.squadsSaved; delete state.match.squadsSaved; render();`);
    // A typed name goes into the slot being picked (Use, or Enter).
    slotTile("striker").click(); type("kusal"); form().querySelector('[data-action="opening-use"]').click();
    slotTile("nonStriker").click(); type("KUSAL");
    search().dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert(val("striker") === "kusal" && val("nonStriker") === "KUSAL", "a typed name fills the slot (Use, or Enter in the box)");
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/must be different players/.test(form().querySelector(".form-error").textContent) && win.eval("currentInnings(state.match).striker") === null, "same name at both ends (any case) is refused");
    slotTile("nonStriker").click(); tapRow("Pathum");
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(win.eval("currentInnings(state.match).striker") === "kusal" || win.eval("currentInnings(state.match).striker") === "Kusal", "different openers start the innings");

    // Kusal out -> new batsman sheet: neither the out batter nor the one at the crease is offered.
    win.eval(`{ const inn = currentInnings(state.match); inn.striker = "Kusal"; inn.batting.order = inn.batting.order.map(n => n.toLowerCase() === "kusal" ? "Kusal" : n);
      if (!inn.batting.stats.Kusal){ inn.batting.stats.Kusal = inn.batting.stats.kusal; delete inn.batting.stats.kusal; }
      recordBall(inn, { kind: "wicket", wicketType: "bowled", runs: 0 }); afterBall(state.match); save(); render(); }`);
    const nb = [...doc.querySelectorAll("#new-batsman-form .pick-row-item")].map(o => o.dataset.name);
    assert(nb.length === 1 && nb[0] === "Charith", "new batsman: out and at-crease players aren't offered");
    const nbInput = doc.querySelector('#new-batsman-form input[name="name"]');
    nbInput.value = "kusal";
    doc.getElementById("new-batsman-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Kusal is already out/.test(doc.querySelector("#new-batsman-form .form-error").textContent), "an out batter typed in another case is still refused");
    nbInput.value = "PATHUM";
    doc.getElementById("new-batsman-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/already at the crease/.test(doc.querySelector("#new-batsman-form .form-error").textContent), "the batter at the other end can't come in again");
    nbInput.value = "Dasun";
    doc.getElementById("new-batsman-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Add Dasun\?/.test(doc.querySelector("#confirm-root").textContent) && win.eval("currentInnings(state.match).striker") === null, "a typed name that isn't in the squad asks before it's added");
    doc.querySelector('#confirm-root [data-action="confirm-cancel"]').click();
    assert(win.eval("currentInnings(state.match).striker") === null && doc.getElementById("new-batsman-form") && !doc.querySelector("#confirm-root .modal"), "Go back records nothing");
    assert(win.eval(`unlistedNames(state.match, [{ name: "charith", teamKey: "A" }, { name: "Kusal", teamKey: "A" }, { name: "Bat ?3", teamKey: "A" }]).length`) === 0, "squad names (any case), players already in the match and placeholders never ask");
    assert(win.eval(`unlistedNames(state.match, [{ name: "Dasun", teamKey: "A" }, { name: "dasun", teamKey: "A" }]).length`) === 1, "one question per name");

    // Nicknames: club match with a roster that has them.
    win.eval(`{ const inn = currentInnings(state.match); inn.striker = "Charith"; ensureBatsman(inn, "Charith");
      state.match.clubId = "club-n"; ui.club = { id: "club-n", name: "N", roster: [{ id: "1", name: "Charith", nickname: "Chari" }, { id: "2", name: "Pathum" }], members: [], matches: [], tournaments: [], presets: { match: [], tournament: [] } };
      render(); }`);
    const toggle = () => doc.querySelector('[data-action="toggle-nicknames"]');
    const names = () => [...doc.querySelectorAll(".matchup-row .name")].map(e => e.textContent.trim());
    assert(!toggle() && names().includes("Charith"), "real names by default; the nickname toggle isn't on the board itself");
    win.eval(`ui.matchMenu = "menu"; render();`);
    assert(toggle() && toggle().getAttribute("role") === "switch" && toggle().getAttribute("aria-checked") === "false", "club match: ⋯ menu has a 'Show nicknames' switch");
    toggle().click();
    assert(toggle() && toggle().getAttribute("aria-checked") === "true" && doc.querySelector(".toggle-pill.on"), "the switch flips on and the menu stays open");
    win.eval(`ui.matchMenu = null; render();`);
    assert(names().includes("Chari") && names().includes("Pathum"), "toggle on: nickname where there is one, name otherwise");
    assert(win.eval("currentInnings(state.match).striker") === "Charith" && win.eval("state.useNicknames") === true, "display only: the match keeps the real name; the choice is saved");

    // Full scorecard: a sheet over the board, not part of the screen.
    const sc = doc.querySelector('#app [data-action="open-live-scorecard"]');
    assert(sc && sc.tagName === "BUTTON" && !sc.classList.contains("link-btn") && !doc.querySelector("#app .innings-summary"), "live screen: 'Full scorecard' is a button and the board has no inline scorecard");
    sc.click();
    const sheet = doc.querySelector("#modal-root .scorecard-modal");
    assert(sheet && sheet.querySelector(".bat-table") && [...sheet.querySelectorAll(".bat-table td:first-child")].some(td => td.textContent === "Chari"), "it opens as a sheet (following the nickname toggle)");
    assert(doc.querySelector("#app .run-pad"), "the board stays underneath");
    doc.querySelector('#modal-root .sheet-close').click();
    assert(!doc.querySelector("#modal-root .scorecard-modal"), "✕ closes it");
    doc.querySelector('#app [data-action="open-live-scorecard"]').click();
    win.eval(`closeTopOverlay();`);
    assert(!doc.querySelector("#modal-root .scorecard-modal"), "back (closeTopOverlay) closes it");
    win.eval(`ui.liveScorecard = true; state.match.status = "innings_break"; render(); state.match.status = "live"; render();`);
    assert(!doc.querySelector("#modal-root .scorecard-modal"), "an innings ending closes it for good");

    win.eval(`state.match.clubId = null; ui.club = null; ui.matchMenu = "menu"; render();`);
    assert(!doc.querySelector('[data-action="toggle-nicknames"]'), "no nickname switch when there are no nicknames (guest match)");

    // Extras ask for their runs in a sheet.
    win.eval(`ui.matchMenu = null; { const inn = currentInnings(state.match); inn.bowler = "Wanindu"; ensureBowler(inn, "Wanindu"); } render();`);
    const extraBtn = x => doc.querySelector(`#app [data-action="toggle-extra"][data-extra="${x}"]`);
    const extraSheet = () => doc.querySelector("#modal-root .extra-runs-modal");
    // Tiles ask for the runs on top of the extra; the big number is that, the small line the total.
    const tile = runs => extraSheet().querySelector(`[data-action="ball"][data-runs="${runs}"]`);
    const runsNow = () => win.eval("currentInnings(state.match).runs");
    let before = runsNow();
    extraBtn("wide").click();
    assert(extraSheet() && /Wide/.test(extraSheet().textContent) && tile(0) && /just the wide/.test(tile(0).textContent) && /Wd · 1 total/.test(tile(0).textContent), "tapping Wide asks for the runs on top; the 0 tile is just the wide (1 total)");
    assert(tile(4).querySelector(".total").textContent === "4" && /Wd\+4 · 5 total/.test(tile(4).textContent), "the 4 tile shows 4 (a boundary) and that the ball is worth 5");
    tile(4).click();
    assert(!extraSheet() && runsNow() === before + 5 && win.eval("currentInnings(state.match).extras.wides") >= 5, "a tile records the wide with that total (Wd+4 = 5) and closes the sheet");
    before = runsNow();
    extraBtn("noball").click();
    tile(4).click();
    assert(runsNow() === before + 5 && win.eval("currentInnings(state.match).freeHit") === true, "no-ball tile 4 = Nb + 4 off the bat (5), and sets the free hit");
    before = runsNow();
    extraBtn("bye").click();
    assert(!tile(0) && tile(1), "byes start at 1");
    doc.querySelector('#modal-root [data-action="close-extra"]').click();
    assert(!extraSheet() && runsNow() === before, "Cancel closes it without recording anything");
    extraBtn("legbye").click();
    win.eval(`closeTopOverlay();`);
    assert(!extraSheet() && runsNow() === before, "back (closeTopOverlay) closes it too");
    win.eval(`ui.matchMenu = null; render();`);
    win.eval(`state.match = null; state.useNicknames = false; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  const doc = win.document;
  // --- result-only fixtures: totals only, overs optional, feed the points table ---
  {
    const cfg = { teamA: "Lions", teamB: "Tigers", battingFirst: "A", oversLimit: 20, playersPerSide: 11, tournamentId: "T" };
    assert(win.parseOversInput("", 6) === null && win.parseOversInput("18.3", 6) === 111 && win.parseOversInput("20", 6) === 120, "overs input: blank, 18.3 and 20");
    assert(Number.isNaN(win.parseOversInput("18.6", 6)) && Number.isNaN(win.parseOversInput("abc", 6)), "overs input: a 6th ball after the dot (6-ball overs) or junk is rejected");
    assert(win.resultOnlyError(cfg, [{ runs: 150, wickets: 11, balls: null }, { runs: 120, wickets: 5, balls: null }]), "more wickets than a side has is refused");
    assert(win.resultOnlyError(cfg, [{ runs: 150, wickets: 5, balls: 126 }, { runs: 120, wickets: 5, balls: null }]), "more overs than the limit is refused");
    assert(win.resultOnlyError(cfg, [{ runs: 150, wickets: 5, balls: null }, { runs: 160, wickets: 5, balls: null }]), "a chase can't go past target + 5");
    assert(win.resultOnlyError(cfg, [{ runs: 150, wickets: 5, balls: null }, { runs: 151, wickets: 3, balls: 100 }]) === null, "a normal result is fine");
    const won = win.createResultOnlyMatch(cfg, [{ runs: 150, wickets: 5, balls: null }, { runs: 151, wickets: 3, balls: 100 }]);
    assert(won.resultOnly && won.status === "complete" && won.result === "Tigers won by 7 wickets (3.2 overs left)", "chasing side wins by wickets, overs left from the overs given: " + won.result);
    const noOvers = win.createResultOnlyMatch(cfg, [{ runs: 150, wickets: 5, balls: null }, { runs: 151, wickets: 3, balls: null }]);
    assert(noOvers.result === "Tigers won by 7 wickets", "no overs given -> no 'overs left': " + noOvers.result);
    const defended = win.createResultOnlyMatch(Object.assign({}, cfg, { battingFirst: "B" }), [{ runs: 140, wickets: 9, balls: null }, { runs: 120, wickets: 10, balls: 110 }]);
    assert(defended.result === "Tigers won by 20 runs" && defended.innings[1].completeReason === "allout", "batting first, defended: " + defended.result);
    const table = win.computeStandings([won, defended], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true });
    const tigers = table.find(t => t.name === "Tigers");
    assert(tigers.played === 2 && tigers.won === 2 && tigers.points === 4 && Number.isFinite(tigers.nrr), "result-only matches count for points, and NRR stays a number with blank overs");
    const noLimit = win.createResultOnlyMatch(Object.assign({}, cfg, { oversLimit: null }), [{ runs: 100, wickets: 2, balls: null }, { runs: 90, wickets: 4, balls: null }]);
    const t2 = win.computeStandings([noLimit], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true });
    assert(t2.every(t => t.played === 1 && t.nrr === 0), "no overs limit + blank overs: points count, NRR left out");
    assert(win.aggregatePlayerStats([won]).length === 0 && win.pickMatchMOTM(won) === null, "no player stats from a result-only match");
  }

  // --- carry on unnamed, name them later ---
  {
    const m = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = win.currentInnings(m);
    const ball = (ev, n) => { for (let i = 0; i < (n || 1); i++) win.recordBall(inn, ev); };
    const dot = { kind: "run", runs: 0 }, one = { kind: "run", runs: 1 }, bowled = { kind: "wicket", wicketType: "bowled" };
    win.openInnings(inn, "Kusal", "Pathum", "Wanindu"); m.status = "live";
    ball(one); ball(bowled);                                            // Pathum out
    assert(win.nextUnnamedName(m, "batter") === "Bat ?1", "the first placeholder is Bat ?1");
    win.sendInBatter(inn, win.nextUnnamedName(m, "batter"));
    ball({ kind: "run", runs: 4 }); ball(dot, 3);                       // over 1 done
    win.setBowler(inn, win.nextUnnamedName(m, "bowler"));
    ball(one); ball(bowled);                                            // Bat ?1 out to Bowl ?1
    win.sendInBatter(inn, "Charith"); ball(dot, 4);                     // over 2
    win.setBowler(inn, "Wanindu"); ball(dot, 6);                        // over 3
    win.setBowler(inn, win.nextUnnamedName(m, "bowler")); ball(one, 6); // over 4
    assert(win.nextUnnamedName(m, "batter") === "Bat ?2" && win.nextUnnamedName(m, "bowler") === "Bowl ?3", "placeholders are numbered across the match");
    assert(win.unnamedPlayers(m).map(u => u.name).join() === "Bat ?1,Bowl ?1,Bowl ?2", "unnamedPlayers lists every placeholder");
    assert(!win.aggregatePlayerStats([m]).some(t => win.isUnnamedPlayer(t.name)), "placeholders stay out of player stats");
    assert(/two overs in a row/.test(win.nameUnnamedError(m, "Bowl ?1", "Wanindu")), "naming can't make someone bowl two overs in a row");
    assert(/already batted/.test(win.nameUnnamedError(m, "Bat ?1", "kusal")), "a batter placeholder can't be someone who already batted");
    assert(/already plays for/.test(win.nameUnnamedError(m, "Bat ?1", "Wanindu")), "or someone from the other side");
    assert(/real name/.test(win.nameUnnamedError(m, "Bat ?1", "Bat ?7")), "or another placeholder");
    const before = JSON.stringify(m);
    const m2 = win.nameUnnamedPlayer(m, "Bowl ?1", "Dushmantha");
    assert(JSON.stringify(m) === before, "naming returns a copy, the input is untouched");
    const i2 = m2.innings[0];
    assert(i2.batting.stats["Bat ?1"].howOut.endsWith("b Dushmantha") && i2.overs[1].bowler === "Dushmantha" && i2.bowling.order.includes("Dushmantha"), "the bowler's name reaches howOut, the over and the order");
    assert(win.nameUnnamedError(m2, "Bowl ?2", "Dushmantha") === null, "overs 2 and 4 by the same bowler are fine");
    const m3 = win.nameUnnamedPlayer(m2, "Bowl ?2", "dushmantha");
    const d = m3.innings[0].bowling.stats.Dushmantha;
    assert(d.legalBalls === 12 && d.runs === 7 && d.wickets === 1 && !m3.innings[0].bowling.order.includes("Bowl ?2") && m3.innings[0].overs[3].bowler === "Dushmantha", "a second placeholder named the same is merged into their figures (any case)");
    const m4 = win.nameUnnamedPlayer(m3, "Bat ?1", "Asitha");
    const i4 = m4.innings[0];
    assert(i4.batting.stats.Asitha.runs === 4 && i4.batting.order[2] === "Asitha" && i4.fallOfWickets[1].batsman === "Asitha", "a batter placeholder becomes the real batter: figures, order, fall of wickets");
    assert(!/(Bat|Bowl) \?\d/.test(JSON.stringify(m4)), "no placeholder is left anywhere -- the action log included");
    assert(win.aggregatePlayerStats([m4]).some(t => t.name === "Asitha" && t.runs === 4), "once named, they count in stats");
    // In the page: the new-batsman sheet lists players, carries on unnamed, and the name is filled in later.
    win.eval(`findOrCreatePlayer("Kusal"); state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" }); ui = defaultUi();
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu"); state.match.status = "live";
      recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); save(); render();`);
    assert(doc.querySelector('#modal-root #new-batsman-form [data-pick-filter]') && !doc.querySelector("#modal-root .combo"), "the new-batsman sheet has a search/type box, no dropdown");
    const unnamedBtn = doc.querySelector('#modal-root [data-action="pick-unnamed"]');
    assert(/Continue without naming/.test(unnamedBtn.textContent) && /“Bat \?1”/.test(unnamedBtn.textContent)
      && (unnamedBtn.compareDocumentPosition(doc.querySelector("#new-batsman-form [data-pick-filter]")) & win.Node.DOCUMENT_POSITION_FOLLOWING),
      "'Continue without naming' is at the top, above the search box, saying the placeholder it scores as");
    unnamedBtn.click();
    assert(win.eval("currentInnings(state.match).striker") === "Bat ?1" && !doc.querySelector("#modal-root #new-batsman-form"), "Continue without naming fills the slot (Bat ?1) and closes the sheet");
    doc.querySelector('#app [data-action="name-later"][data-name="Bat ?1"]').click();
    const nf = doc.getElementById("name-later-form");
    assert(nf, "tapping the placeholder on the board opens 'Who was it?'");
    nf.querySelector('[name="name"]').value = "Asitha";
    nf.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    // Asitha isn't on the players list: asked first, like a typed name on the pick sheets.
    const addOk = doc.querySelector('#confirm-root [data-action="confirm-ok"]');
    assert(addOk && /Add Asitha\?/.test(doc.getElementById("confirm-root").textContent), "naming someone who isn't on the list asks first");
    addOk.click();
    assert(win.eval("currentInnings(state.match).striker") === "Asitha" && !doc.getElementById("name-later-form"), "saving names them on the board");
    win.eval(`handleUndo()`);
    assert(win.eval("currentInnings(state.match).striker") === "Bat ?1", "Undo takes the name back off");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- "no names" scoring: slots fill themselves, and the match stays out of player stats ---
  {
    const m = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 3, battingFirst: "A", ballsPerOver: 6 });
    m.anonymous = true;
    assert(win.fillAnonymousSlots(m) && m.status === "live", "the opening pause is filled straight away");
    let inn = win.currentInnings(m);
    assert(inn.striker === "Batter 1" && inn.nonStriker === "Batter 2" && inn.bowler === "Over 1", "openers Batter 1/2, first bowler Over 1");
    win.recordBall(inn, { kind: "wicket", wicketType: "bowled" }); win.afterBall(m); win.fillAnonymousSlots(m);
    assert(inn.striker === "Batter 3", "the next batter comes in as Batter 3");
    for (let i = 0; i < 5; i++){ win.recordBall(inn, { kind: "run", runs: 1 }); win.afterBall(m); win.fillAnonymousSlots(m); }
    assert(inn.bowler === "Over 2" && inn.lastOverBowler === "Over 1", "each over gets its own bowler, so the consecutive-overs rule never trips");
    assert(win.fillAnonymousSlots(m) === false, "nothing to fill -> false (render doesn't re-save)");
    const fresh = win.restartMatch(m, "B");
    assert(fresh.anonymous === true, "a toss restart keeps the match nameless");
    m.status = "complete";
    assert(win.aggregatePlayerStats([m]).length === 0 && win.pickMatchMOTM(m) === null && win.playerCareer("Batter 1", [m]) === null, "placeholders never reach stats, MVP or profiles");
    // In the page: the setup checkbox starts it, and no name sheet ever opens.
    win.eval(`state.match = null; ui = defaultUi(); state.view = "matchSetup"; render();`);
    const form = doc.getElementById("match-setup-form");
    assert(form.querySelector('[name="anonymous"]') && !form.querySelector('[name="anonymous"]').checked, "match setup offers 'Score without player names', unticked");
    form.querySelector('[name="teamA"]').value = "Lions"; form.querySelector('[name="teamB"]').value = "Tigers";
    form.querySelector('[name="anonymous"]').checked = true;
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(win.eval("state.match.anonymous && state.match.status") === "live" && !doc.querySelector("#modal-root .modal"), "a nameless match goes straight to live scoring");
    win.eval(`state.match = null; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- catch up the score: jump to where the game is now ---
  {
    // 2.3 overs in, 1 run: A1/A2 batting, B1 then B2 then B1 bowling.
    const build = () => {
      const m = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 10, playersPerSide: 11, battingFirst: "A" });
      const inn = win.currentInnings(m);
      win.ensureBatsman(inn, "A1"); win.ensureBatsman(inn, "A2"); win.ensureBowler(inn, "B1");
      inn.striker = "A1"; inn.nonStriker = "A2"; inn.bowler = "B1"; m.status = "live";
      const bowlers = ["B1", "B2", "B1"];
      for (let b = 0; b < 15; b++){
        if (!inn.bowler){ win.ensureBowler(inn, bowlers[Math.floor(b / 6)]); inn.bowler = bowlers[Math.floor(b / 6)]; }
        win.recordBall(inn, { kind: "run", runs: b === 0 ? 1 : 0 });
      }
      return m;
    };
    const m = build(), inn = win.currentInnings(m);
    assert(inn.legalBalls === 15 && inn.runs === 1 && inn.bowler === "B1", "setup: 1-0 after 2.3 overs");
    const out = inn.striker, stays = inn.nonStriker;
    const valid = () => ({
      runs: 40, wickets: 1, balls: 37, extras: { wides: 2, noBalls: 0, byes: 1, legByes: 0 }, finished: false,
      batters: [
        { name: out, status: "out", runs: 10, balls: 12, wicketType: "caught", bowler: "B3", fielder: "B4" },
        { name: stays, status: "striker", runs: 20, balls: 18 },
        { name: "A3", status: "nonStriker", runs: 3, balls: 5 }
      ],
      bowlers: [{ name: "B1", balls: 18, runs: 15 }], bowlerNow: "B3", lastOver: ""
    });
    const err = patch => { const d = Object.assign(valid(), patch); return win.catchUpError(m, d) || ""; };
    assert(err({}) === "", "a consistent catch-up passes the checks");
    assert(/can't go down/.test(err({ runs: 0 })), "runs can't go below what's recorded");
    assert(/Wickets say 2/.test(err({ wickets: 2 })), "the wickets total must match the batters marked out");
    assert(/can't be more than 10/.test(err({ balls: 61 })), "overs can't pass the overs limit");
    assert(/overs bowled/.test(err({ balls: NaN })), "badly typed overs are refused");
    assert(/came off the bat/.test(err({ batters: [valid().batters[0], valid().batters[1], { name: "A3", status: "nonStriker", runs: 30 }] })), "batters' runs can't exceed the runs off the bat");
    assert(/Tigers/.test(err({ batters: [valid().batters[0], valid().batters[1], { name: "B1", status: "nonStriker" }] })), "a bowler can't come in to bat for the other side");
    assert(/Who was bowling/.test(err({ batters: [Object.assign(valid().batters[0], { bowler: "" }), valid().batters[1], valid().batters[2]] })), "a caught batter needs the bowler");
    assert(/over in progress/.test(err({ bowlerNow: "" })), "mid-over, who's bowling it is required");
    assert(/bowled the last over/.test(err({ balls: 36 })), "at the end of an over, the last over's bowler is required");
    assert(/next one too/.test(err({ balls: 36, lastOver: "B3", bowlerNow: "B3" })), "the last over's bowler can't bowl the next one");
    assert(/should end in \.1/.test(err({ bowlers: [{ name: "B3", balls: 6, runs: 0 }] })), "entered overs must fit the over in progress");
    assert(/should be whole/.test(err({ balls: 36, lastOver: "B1", bowlers: [{ name: "B1", balls: 16, runs: 15 }] })), "the last over's bowler has whole overs");
    assert(/more than the/.test(err({ bowlers: [{ name: "B1", balls: 36, runs: 15 }] })), "bowlers' overs (B3's ball included) can't exceed the overs bowled");
    assert(/on strike/.test(err({ batters: [valid().batters[0], valid().batters[1]] })), "two batters must be at the crease");
    assert(/Nothing has changed/.test(win.catchUpError(m, { runs: 1, wickets: 0, balls: 15, extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
      batters: [{ name: "A1", status: inn.striker === "A1" ? "striker" : "nonStriker" }, { name: "A2", status: inn.striker === "A2" ? "striker" : "nonStriker" }],
      bowlers: [], bowlerNow: "B1", lastOver: "" }) || ""), "an unchanged form is refused");

    win.applyCatchUp(m, valid());
    assert(inn.runs === 40 && inn.legalBalls === 37 && inn.wickets === 1 && inn.extras.wides === 2, "the totals are now the ones entered");
    assert(inn.batting.stats[out].howOut === "c B4 b B3" && inn.fielding.stats.B4.catches === 1 && inn.bowling.stats.B3.wickets === 1, "the dismissal credits the bowler and the catcher");
    assert(inn.striker === stays && inn.nonStriker === "A3" && inn.bowler === "B3", "the new batting pair and bowler are in place");
    const fow = inn.fallOfWickets.at(-1);
    assert(fow.catchUp && fow.batsman === out && fow.score === 40 && fow.balls === 37, "a gap wicket falls at the catch-up point (partnership restarts there)");
    assert(inn.overs.length === 4 && inn.overs[2].partial && inn.overs[3].gap && inn.overs[3].gap.fromBalls === 15 && inn.currentOverEvents.length === 0, "the part over is kept, then one gap entry");
    const un = win.catchUpUnattributed(inn);
    assert(inn.bowling.stats.B3.legalBalls === 1, "the bowler of the over in progress is credited with its ball so far (B3 0.1)");
    assert(un.batRuns === 4 && un.bowlBalls === 12 && un.bowlRuns === 24, "runs/balls nobody was credited with are reported");
    const cuTotals = Object.fromEntries(win.aggregatePlayerStats([m]).map(t => [t.name, t]));
    assert(m.caughtUp && cuTotals.B3.wickets === 1 && cuTotals.B4.catches === 1 && win.pickMatchMOTM(m) !== null, "a caught-up match still counts what each player was credited with (stats and MVP)");
    for (let b = 0; b < 5; b++) win.recordBall(inn, { kind: "run", runs: 0 });
    assert(inn.legalBalls === 42 && inn.bowler === null && inn.lastOverBowler === "B3" && inn.bowling.stats.B3.maidens === 0 && !inn.partOverUnknown,
      "scoring carries on: the over ends after the 5 remaining balls, and a part-unknown over is never a maiden");
    const comm = win.inningsCommentary(inn, {});
    const after = comm.slice(comm.findIndex(l => l.type === "gap") + 1);
    assert(comm.some(l => l.type === "gap" && l.to === "40-1 (6.1)") && after[0].label === "6.2" && after.find(l => l.type === "over").over === 7 && !after.find(l => l.type === "over").maiden,
      "commentary marks the gap and numbers the next balls from 6.2");

    // A finished first innings, then a chase caught up past the target.
    const m2 = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const z = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
    const first = { runs: 50, wickets: 2, balls: 26, extras: z, finished: true, bowlers: [], bowlerNow: "", lastOver: "",
      batters: [{ name: "X1", status: "out", wicketType: "bowled", bowler: "Y1" }, { name: "X2", status: "out", wicketType: "runout", fielder: "Y2" },
        { name: "X3", status: "striker" }, { name: "X4", status: "nonStriker" }] };
    assert(win.catchUpError(m2, first) === null, "a whole first innings can be caught up from the opening sheet");
    win.applyCatchUp(m2, first);
    assert(m2.status === "innings_break" && m2.innings[0].completeReason === "closed" && m2.innings[0].batting.stats.X2.howOut === "run out (Y2)", "'innings is over' closes it at that score");
    win.startSecondInnings(m2);
    const chase = { runs: 52, wickets: 1, balls: 20, extras: z, finished: false, bowlers: [], bowlerNow: "", lastOver: "",
      batters: [{ name: "Y1", status: "out", wicketType: "lbw", bowler: "X1" }, { name: "Y2", status: "striker" }, { name: "Y3", status: "nonStriker" }] };
    assert(/more than 56/.test(win.catchUpError(m2, Object.assign({}, chase, { runs: 57 })) || ""), "a chase can't pass the target by more than a six");
    assert(win.catchUpError(m2, chase) === null, "reaching the target needs no next bowler");
    win.applyCatchUp(m2, chase);
    assert(m2.status === "complete" && m2.result === "Tigers won by 9 wickets (1.4 overs left)", "reaching the target finishes the match");

    // No names: totals only; the batters at the crease go first.
    const m3 = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    m3.anonymous = true; win.fillAnonymousSlots(m3);
    const anon = { runs: 20, wickets: 2, balls: 9, extras: z, finished: false };
    assert(win.catchUpError(m3, anon) === null, "a nameless match only needs the totals");
    win.applyCatchUp(m3, anon); win.fillAnonymousSlots(m3);
    const i3 = win.currentInnings(m3);
    assert(i3.batting.stats["Batter 1"].out && i3.batting.stats["Batter 2"].out && i3.striker === "Batter 3" && i3.nonStriker === "Batter 4" && i3.bowler === "Over 2",
      "placeholders fill the new pair and the over's bowler");

    // Last man stands: one batter left bats alone, on strike.
    const m4 = win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 3, battingFirst: "A", lastManStands: true });
    const lms = { runs: 12, wickets: 2, balls: 9, extras: z, finished: false, bowlers: [], bowlerNow: "B2", lastOver: "",
      batters: [{ name: "A1", status: "out", wicketType: "bowled", bowler: "B1" }, { name: "A2", status: "out", wicketType: "bowled", bowler: "B1" }, { name: "A3", status: "nonStriker" }] };
    assert(win.catchUpError(m4, lms) === null, "last man stands: one batter left is enough");
    win.applyCatchUp(m4, lms);
    assert(win.currentInnings(m4).striker === "A3" && win.currentInnings(m4).nonStriker === null, "the lone batter is put on strike");

    // In the page: opening sheet link -> form -> review -> confirm -> Undo.
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 10, playersPerSide: 11, battingFirst: "A" }); state.snapshots = []; ui = defaultUi(); render();`);
    const link = doc.querySelector('#modal-root [data-action="open-catch-up"]');
    assert(link, "the opening sheet offers 'Already under way?'");
    link.click();
    let f = doc.getElementById("catch-up-form");
    assert(f && f.querySelectorAll(".cu-bat").length === 2, "the catch-up sheet opens with two batters to fill in");
    f.querySelector('[name="bat_name_0"]').value = "A1"; f.querySelector('[name="bat_name_1"]').value = "A2";
    doc.querySelector('#modal-root [data-action="catch-up-add"][data-kind="bat"]').click();
    f = doc.getElementById("catch-up-form");
    assert(f.querySelectorAll(".cu-bat").length === 3 && f.querySelector('[name="bat_name_0"]').value === "A1" && f.querySelector('[name="bat_status_2"]').value === "out",
      "adding a row keeps what was typed; with both ends taken it's a batter who got out");
    f.querySelector('[name="runs"]').value = "30"; f.querySelector('[name="wickets"]').value = "1"; f.querySelector('[name="overs"]').value = "4.2";
    f.querySelector('[name="bat_name_2"]').value = "A3"; f.querySelector('[name="bat_how_2"]').value = "bowled"; f.querySelector('[name="bat_bowler_2"]').value = "B1";
    f.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/over in progress/.test(f.querySelector(".form-error").textContent) && !doc.querySelector("#confirm-root .modal"), "a missing bowler is caught before anything is asked");
    f.querySelector('[name="bowlerNow"]').value = "B2";
    f.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Update the score\?/.test(doc.getElementById("confirm-root").textContent) && /30-1 \(4\.2\)/.test(doc.getElementById("confirm-root").textContent), "review asks first and shows the new score");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.eval("state.match.status === 'live' && currentInnings(state.match).runs === 30 && currentInnings(state.match).batting.stats.A3.howOut === 'bowled b B1' && !ui.catchUp"),
      "confirming applies it and goes to live scoring");
    assert(doc.querySelectorAll("#app .over-row .chip.unknown").length === 2, "the over in progress shows its 2 unscored balls as ?");
    doc.querySelector('#app [data-action="undo"]').click();
    assert(win.eval("state.match.status === 'opening' && currentInnings(state.match).runs === 0"), "Undo puts the score back");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- records: career tallies, one-match bests, overs, team totals; the Records tab ---
  {
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 6, battingFirst: "A" });
    m.id = "rec1";
    win.openInnings(currentInnings(m), "A1", "A2", "B1"); m.status = "live";
    // Over 1 (B1): 6 6 Wd 4 1 Nb+2 0 W -- 21 off the over, 17 of them A1's.
    [{ kind: "run", runs: 6 }, { kind: "run", runs: 6 }, { kind: "wide", runs: 0 }, { kind: "run", runs: 4 }, { kind: "run", runs: 1 },
      { kind: "noball", runs: 2 }, { kind: "run", runs: 0 }, { kind: "wicket", wicketType: "bowled" }].forEach(ev => play(m, ev));
    win.sendInBatter(currentInnings(m), "A3"); win.setBowler(currentInnings(m), "B2");
    // Over 2 (B2): a leg bye and five dots -- a maiden; 22-1 off 2 overs.
    [{ kind: "legbye", runs: 1 }, ...Array(5).fill({ kind: "run", runs: 0 })].forEach(ev => play(m, ev));
    startSecondInnings(m);
    win.openInnings(currentInnings(m), "B1", "B2", "A1"); m.status = "live";
    // A1: W, W (c A2), 4, run out (A3), W lbw, W -- Tigers 4 all out, A1 4/4.
    play(m, { kind: "wicket", wicketType: "bowled" }); win.sendInBatter(currentInnings(m), "B3");
    play(m, { kind: "wicket", wicketType: "caught", fielder: "A2" }); win.sendInBatter(currentInnings(m), "B4");
    play(m, { kind: "run", runs: 4 });
    play(m, { kind: "wicket", wicketType: "runout", endComingIn: "striker", runs: 0, fielder: "A3" }); win.sendInBatter(currentInnings(m), "B5");
    play(m, { kind: "wicket", wicketType: "lbw" }); win.sendInBatter(currentInnings(m), "B6");
    play(m, { kind: "wicket", wicketType: "bowled" });
    assert(m.status === "complete" && currentInnings(m).runs === 4 && currentInnings(m).completeReason === "allout", "the records match is played out: " + m.result);

    const recs = win.computeRecords([m]);
    const rec = key => { for (const g of recs) for (const r of g.records) if (r.key === key) return r.entries; return null; };
    const top = key => rec(key).map(e => `${e.place}.${e.name}:${e.text != null ? e.text : e.value}`).join(" ");
    assert(recs.map(g => g.key).join() === "bat,bowl,field,partner,matchups,team,awards", "records come in seven sections: " + recs.map(g => g.key).join());
    assert(top("runs") === "1.A1:17 2.B4:4 3.A2:2" && rec("runs")[0].detail === "1 innings", "most runs, top three: " + top("runs"));
    assert(top("sixes") === "1.A1:2" && top("fours") === "1.A1:1 1.B4:1", "most sixes; equal fours share first place: " + top("fours"));
    assert(top("ducks") === "1.B1:1 1.B3:1 1.B5:1 1.B6:1", "most ducks: everyone out for 0 (not A2, out for 2): " + top("ducks"));
    assert(rec("fifties").length === 0 && rec("hundreds").length === 0, "a record nobody has yet has no entries");
    assert(top("wickets") === "1.A1:4 2.B1:1" && top("maidens") === "1.B2:1", "most wickets (a run-out isn't the bowler's) and maidens");
    assert(top("wides") === "1.B1:1" && top("noBalls") === "1.B1:1", "wides and no-balls are counted as deliveries, per bowler");
    assert(top("catches") === "1.A2:1" && top("runouts") === "1.A3:1" && rec("stumpings").length === 0, "fielding tallies");
    assert(top("highScore") === "1.A1:17* 2.B4:4 3.A2:2" && rec("highScore")[0].detail === "5 balls · v Tigers" && rec("highScore")[0].matchId === "rec1",
      "highest score, not out, with the match to open: " + JSON.stringify(rec("highScore")[0]));
    assert(top("bestBowling") === "1.A1:4/4 2.B1:1/21" && top("inningsSixes") === "1.A1:2", "best bowling and most sixes in an innings: " + top("bestBowling"));
    const hitOver = rec("overHit")[0];
    assert(top("overHit") === "1.A1:17 2.B4:4 3.A2:2", "most runs hit in an over, per batter: " + top("overHit"));
    assert(hitOver.name === "A1" && hitOver.value === 17 && hitOver.detail === "off B1, v Tigers · over 1" && hitOver.balls.map(b => b.display).join(" ") === "6 6 Wd 4 1 Nb+2 0 W",
      "most runs hit in an over: A1's 17 off B1, with the over's balls: " + JSON.stringify(hitOver));
    assert(top("overConceded") === "1.B1:21 2.A1:4" && rec("overConceded")[0].detail === "v Lions · over 1",
      "most runs conceded in an over: wides and no-balls count, the leg bye and B2's maiden don't: " + top("overConceded"));
    assert(top("highTotal") === "1.Lions:22-1 2.Tigers:4-5" && top("lowTotal") === "1.Tigers:4-5 2.Lions:22-1" && rec("lowTotal")[0].detail === "v Lions · 1.0 ov · all out",
      "team totals: highest, and lowest (all out or out of overs): " + top("lowTotal"));
    // The new sections, from the same match.
    assert(top("partnership") === "1.A1 & A2:21 2.B2 & B4:4 3.A1 & A3:1*" && rec("partnership")[0].detail === "1st wicket · 6 balls · v Tigers",
      "partnerships: the highest (extras count; an unbroken one has a *): " + top("partnership"));
    assert(rec("byWicket").map(e => `${e.wicket}:${e.name}:${e.text}`).join(" ") === "1:A1 & A2:21 2:A1 & A3:1* 3:B2 & B4:4",
      "the best partnership for each wicket (none with no runs): " + JSON.stringify(rec("byWicket").map(e => [e.wicket, e.name, e.value])));
    assert(top("together") === "1.A1 & A2:21 2.B2 & B4:4 3.A1 & A3:1", "most runs together, per pair: " + top("together"));
    assert(top("runsOff") === "1.A1 v B1:17 2.B4 v A1:4 3.A2 v B1:2" && rec("runsOff")[0].detail === "4 balls · never out" && rec("runsOff")[2].detail === "3 balls · out once",
      "match-ups: most runs off one bowler (a wide isn't a ball faced; a no-ball is): " + top("runsOff"));
    assert(rec("outsOf").length === 5 && rec("outsOf").every(e => e.place === 1 && e.value === 1) && !rec("outsOf").some(e => /B4/.test(e.name)),
      "match-ups: dismissals from the scorecard, a run-out is nobody's: " + top("outsOf"));
    assert(top("bowledW") === "1.A1:2 2.B1:1" && top("lbwW") === "1.A1:1" && top("caughtW") === "1.A1:1" && rec("stumpedW").length === 0, "wickets by how they came: " + top("bowledW"));
    assert(top("fielderBowler") === "1.c A2 b A1:1" && top("catchesMatch") === "1.A2:1" && top("dismInnings") === "1.A2:1 1.A3:1", "fielding: bowler and fielder, catches in a match, dismissals in an innings");
    assert(top("openerHigh") === "1.A1:17* 2.A2:2" && top("openRuns") === "1.A1:17 2.A2:2", "openers: highest score and most runs");
    assert(rec("fastest25").length === 0 && rec("bestSR").length === 0 && rec("srOpen").length === 0, "fastest 25, best strike rate (10+ balls) and phases (no overs limit under 3) have nobody yet");
    assert(top("bestEcon") === "1.B2:0.00 2.A1:4.00 3.B1:21.00" && rec("bestEcon")[0].detail === "1.0-1-0-0 · v Lions",
      "best economy in an innings: one full over is enough: " + top("bestEcon"));
    const teams = recs.find(g => g.key === "team");
    assert(teams.facts.map(f => `${f.key}:${f.value}`).join() === "batFirst:100%,chase:0%" && top("bigWinRuns") === "1.Lions:18 runs" && top("lowDefended") === "1.Lions:22-1"
      && top("aggregate") === "1.Lions v Tigers:26" && top("extras") === "1.Tigers:3" && rec("bigWinWickets").length === 0,
      "teams: batting first v chasing, the win margin, the lowest total defended, the match's runs and the extras given: " + JSON.stringify(teams.facts));
    assert(top("matches").startsWith("1.") && rec("luckyCharm").length === 0 && rec("pom").length === 0, "awards: nobody has 5 decided matches or a player of the match award yet");
    const hon = win.computeHonours([m]);
    assert(hon.bowling.map(e => `${e.name}:${e.text}`).join() === "A1:4/4" && !hon.batting.length && !hon.hatTricks.length && hon.bowling[0].matchId === "rec1",
      "the honours board: a 3-wicket haul (no fifties or hat-tricks yet)");
    const ups = win.computeMatchups([m]);
    const a3 = ups.find(p => p.batterName === "A3" && p.bowlerName === "B2");
    assert(a3 && a3.balls === 5 && a3.dots === 5 && a3.runs === 0, "A3 v B2: five dot balls");
    const ratings = win.playerRatings([m]);
    assert(ratings["name:a1"].bat > ratings["name:a2"].bat && ratings["name:a1"].bowl > ratings["name:b1"].bowl && ratings["name:a3"].bowl === null && ratings["name:b2"].bowl != null,
      "ratings: 17 off 4 beats 2 off 3, A1's 4/4 beats B1's 1/21, and nobody who didn't bowl has a bowling rating: " + JSON.stringify(ratings["name:a1"]));
    const form = win.playerRecentForm([m]);
    assert(JSON.stringify(form["name:a1"].bat) === JSON.stringify([{ runs: 17, out: false, balls: 5 }]) && form["name:a1"].bowl[0].wickets === 4, "recent form, bat and ball");
    const charts = win.renderMatchCharts(m, 0);
    assert(/Worm/.test(charts) && (charts.match(/class="chart-wkt"/g) || []).length >= 6 && /partnership-bars/.test(charts) && /A1 <b class="n">17<\/b> &amp; A2 <b class="n">2<\/b>/.test(charts),
      "the Charts tab: worm with a mark per wicket, runs per over, and partnerships with each batter's share");
    // A "no names" copy counts for team totals only; a result-only match's totals count too.
    const noNames = Object.assign(JSON.parse(JSON.stringify(m)), { id: "rec2", anonymous: true });
    const ro = win.createResultOnlyMatch({ teamA: "Eagles", teamB: "Hawks", battingFirst: "A", oversLimit: 20, playersPerSide: 11 }, [{ runs: 150, wickets: 5, balls: 120 }, { runs: 151, wickets: 3, balls: null }]);
    const recs2 = win.computeRecords([m, noNames, ro]);
    const rec2 = key => recs2.flatMap(g => g.records).find(r => r.key === key).entries;
    assert(rec2("runs")[0].value === 17 && rec2("overConceded").length === 2, "a no-names match adds nothing to player records");
    assert(rec2("highTotal").map(e => `${e.place}.${e.name}:${e.value}`).join(" ") === "1.Hawks:151 2.Eagles:150 3.Lions:22 3.Lions:22",
      "team totals count every match, and equal totals share a place: " + JSON.stringify(rec2("highTotal")));
    assert(rec2("lowTotal").map(e => `${e.place}.${e.name}`).join(" ") === "1.Tigers 1.Tigers 3.Lions 3.Lions" && !rec2("lowTotal").some(e => e.name === "Hawks"),
      "a chase that got there isn't a lowest total: " + JSON.stringify(rec2("lowTotal").map(e => e.name)));

    // The Records tab: tiles for the career tallies, rows for one-match records.
    const keptHistory = win.eval("JSON.stringify(state.matchHistory)");
    win.eval(`state.match = null; ui = defaultUi(); state.matchHistory = {}; state.view = "home";`);
    win.archiveMatch(m);
    win.eval(`state.view = "stats"; ui.statsTab = "records"; render();`);
    const tabs = [...doc.querySelectorAll('#app [data-action="stats-tab"]')].map(b => b.dataset.tab).join();
    assert(tabs === "mvp,bat,bowl,field,records" && doc.querySelector('#app [data-action="stats-tab"][data-tab="records"]').classList.contains("active"), "Stats has a Records tab: " + tabs);
    const chips = () => [...doc.querySelectorAll('#app [data-action="records-tab"]')].map(b => b.dataset.tab).join();
    assert(chips() === "bat,bowl,field,partner,matchups,team,awards,honours" && doc.querySelector('#app [data-action="records-tab"][data-tab="bat"]').classList.contains("active"),
      "Records shows one section at a time behind its chips, Batting first: " + chips());
    const ducks = [...doc.querySelectorAll("#app .record-card")].find(t => /Most ducks/.test(t.textContent));
    assert(ducks && ducks.querySelectorAll(".record-rows > li").length === 3 && /\+1 more level/.test(ducks.textContent), "four players level on ducks: the first three and \"+1 more\"");
    ducks.querySelector('[data-action="open-record"]').click();
    assert(doc.querySelectorAll("#modal-root .record-sheet .record-rows > li").length === 4, "\"see all\" opens every player level on ducks");
    win.eval("closeTopOverlay()");
    assert(![...doc.querySelectorAll("#app .record-label")].some(l => /fifties|stumpings/i.test(l.textContent)), "records nobody has yet are left out");
    assert(!/Best bowling/.test(doc.querySelector("#app .records").textContent), "...another section's records aren't on screen");
    const overCard = [...doc.querySelectorAll("#app .record-card")].find(c => /hit in an over/.test(c.textContent));
    assert(overCard && overCard.querySelectorAll(".record-row.lead .record-balls .chip").length === 8 && overCard.querySelector(".record-balls .chip.six"), "the over's balls show under its leader");
    overCard.querySelector('[data-action="open-match-detail"]').click();
    assert(doc.querySelector("#modal-root .scorecard-modal"), "tapping a one-match record opens that match's scorecard");
    win.eval(`ui = defaultUi(); state.matchHistory = ${keptHistory}; state.view = "home"; save(); render();`);
  }

  // --- history: partnerships around a retirement, phases, dismissals, milestones, badges, records set ---
  {
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const r = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
    const inn = currentInnings(r);
    win.openInnings(inn, "A1", "A2", "B1"); r.status = "live";
    play(r, { kind: "run", runs: 1 });
    win.retireBatter(inn, "striker", "hurt"); win.sendInBatter(inn, "A3");
    play(r, { kind: "run", runs: 4 });
    play(r, { kind: "wicket", wicketType: "bowled" }); win.sendInBatter(inn, "A2");
    play(r, { kind: "run", runs: 2 });
    const ps = win.inningsPartnerships(inn);
    assert(ps && ps.map(p => `${p.wicket}:${p.batters.join("&")}:${p.runs}:${p.balls}:${p.unbroken ? "*" : p.out}`).join(" ") === "1:A1&A2:1:1:* 1:A1&A3:4:2:A3 2:A1&A2:2:1:*",
      "partnerships: a retirement starts a new one for the same wicket, and the batter coming back joins the next: " + JSON.stringify(ps));
    assert(JSON.stringify(ps.map(p => p.bat)) === JSON.stringify([{ A1: 1 }, { A3: 4 }, { A2: 2 }]), "...each batter's share, from ball by ball");
    const gapped = JSON.parse(JSON.stringify(inn)); gapped.overs.push({ bowler: null, events: [], gap: { toBalls: 6, toRuns: 20, toWickets: 1 } });
    assert(win.inningsPartnerships(gapped) === null, "a caught-up innings has no partnerships (who fell when isn't known)");
    const ph = l => JSON.stringify(win.inningsPhases({ oversLimit: l }));
    assert(ph(20) === '{"open":6,"death":5,"limit":20}' && ph(6) === '{"open":2,"death":2,"limit":6}' && ph(4) === '{"open":1,"death":1,"limit":4}' && ph(2) === "null" && ph(null) === "null",
      "phases from the overs limit: T20 1-6 / 16-20, 6 overs 1-2 / 5-6, none under 3 overs or with no limit");
    const splits = win.inningsPhaseSplits(inn);
    assert(splits.map(x => `${x.key}:${x.from}-${x.to}:${x.runs}/${x.wickets}`).join(" ") === "open:1-2:7/1 middle:3-4:0/0 death:5-5:0/0", "an innings split by phase: " + JSON.stringify(splits));
    const hp = (h, b) => JSON.stringify(win.howOutParts(h, b));
    assert(hp("c Kasun Perera b Nuwan", ["Nuwan"]) === '{"type":"caught","bowler":"Nuwan","fielder":"Kasun Perera"}'
      && hp("bowled b Kasun Perera", ["Kasun", "Kasun Perera"]) === '{"type":"bowled","bowler":"Kasun Perera","fielder":null}'
      && hp("st Kee b Ann", ["Ann"]) === '{"type":"stumped","bowler":"Ann","fielder":"Kee"}' && hp("lbw b Ann", ["Ann"]).includes('"lbw"')
      && hp("hit wicket b Ann", ["Ann"]).includes('"hitwicket"') && hp("run out (Kee)", ["Ann"]) === "null" && hp("retired hurt", ["Ann"]) === "null",
      "howOut read back: caught (with the fielder), the longest bowler name that fits, stumped, lbw, hit wicket; never a run-out");

    // A career, match by match: milestones, badges, form, over time, a year in review.
    const at = (mo, d) => new Date(2026, mo, d, 15).getTime();
    const mk = (id, when, bat, bowl) => {
      const x = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 20, playersPerSide: 11, battingFirst: "A" });
      Object.assign(x, { id, completedAt: when, status: "complete", result: "Lions won" });
      const i = currentInnings(x);
      Object.entries(bat).forEach(([n, [runs, balls, out]]) => { win.ensureBatsman(i, n); Object.assign(i.batting.stats[n], { runs, balls, out: !!out, howOut: out ? "bowled b Bob" : null }); i.runs += runs; });
      Object.entries(bowl).forEach(([n, [w, runs, legal]]) => { win.ensureBowler(i, n); Object.assign(i.bowling.stats[n], { wickets: w, runs, legalBalls: legal }); });
      return x;
    };
    const ms = [mk("h1", at(2, 1), { Ann: [45, 30, 1] }, { Bob: [4, 20, 24] }), mk("h2", at(3, 1), { Ann: [60, 40, 1] }, { Bob: [6, 10, 24] }),
      mk("h3", at(4, 1), { Ann: [120, 70, 0] }, { Bob: [0, 30, 24] }), mk("h4", at(5, 1), { Ann: [30, 20, 1] }, { Bob: [1, 25, 24] })];
    const mls = win.playerMilestones("Ann", ms);
    assert(mls.map(x => x.text).join() === "250 runs,First hundred,100 runs,First fifty,First match" && mls[0].matchId === "h4" && /match 4/.test(mls[0].detail),
      "milestones, newest first, each with its match: " + mls.map(x => x.text).join());
    assert(win.playerMilestones("Bob", ms).map(x => x.text).join() === "10 wickets,First five-for,First 3-wicket haul,First match", "a bowler's: hauls and round numbers of wickets");
    const badges = win.playerBadges(win.playerCareer("Ann", ms), { hatTricks: 0, pom: 0 });
    assert(badges.map(b => b.id + ":" + b.label).join() === "runs:250 runs,hundred:Century", "badges: one per family, the highest step (a hundred, not also a fifty): " + badges.map(b => b.label).join());
    assert(win.playerBadges(win.playerCareer("Bob", ms), { hatTricks: 1, pom: 2 }).map(b => b.label).join() === "10 wickets,Five-for,Hat-trick,Player of the match", "a bowler's badges (2 awards: the first step)");
    assert(win.playerForm("Ann", ms).bat.map(x => x.runs).join() === "30,120,60,45", "form: the last innings, newest first");
    assert(win.playerCareerSeries("Ann", ms).map(p => p.runs).join() === "45,105,225,255" && win.playerCareerSeries("Ann", ms)[3].average === 85, "over time: running totals and average");
    const yr = win.playerYearReview("Ann", ms, "2026");
    assert(yr && yr.career.runs === 255 && yr.bestBat.runs === 120 && yr.milestones.length === 4 && win.playerYears("Ann", ms).join() === "2026", "a year in review: runs, the best innings and the milestones that year");
    // Records set: nothing until there are five matches before it; then a new best, never a tie.
    const five = [...ms, mk("h5", at(6, 1), { Cal: [10, 10, 1] }, {})];
    const best = mk("h6", at(7, 1), { Dee: [130, 60, 0] }, {});
    assert(win.newRecordsIn(best, ms).length === 0, "records set: nothing with fewer than five matches before it");
    const set = win.newRecordsIn(best, five);
    assert(set.some(x => x.label === "Highest score" && x.entry.name === "Dee" && x.entry.text === "130*") && !set.some(x => x.label === "Lowest total"),
      "records set: a new highest score: " + set.map(x => x.label).join());
    assert(!win.newRecordsIn(mk("h7", at(7, 2), { Eve: [120, 80, 1] }, {}), five).some(x => x.label === "Highest score"), "...a score level with the best isn't a new record");
    assert(win.liveRecordMarks(five).highScore === 120 && win.liveRecordMarks(ms) === null, "the live board's marks: the best so far, once there are five matches");
    // A milestone carries what led to it: the career up to then, and that match.
    const m250 = win.playerMilestones("Ann", ms)[0];
    assert(m250.text === "250 runs" && m250.sofar.runs === 255 && m250.sofar.innings === 4 && m250.sofar.matches === 4 && m250.sofar.hundreds === 1 && m250.sofar.fifties === 1
      && Math.round(m250.sofar.average) === 85 && m250.match.line === "30 (20)" && m250.match.opp === "Tigers",
      "250 runs: reached in 4 innings, average 85, with 30 (20) v Tigers: " + JSON.stringify(m250.sofar));
    const w10 = win.playerMilestones("Bob", ms)[0];
    assert(w10.text === "10 wickets" && w10.sofar.wickets === 10 && w10.sofar.bowlInnings === 2 && w10.sofar.best.wickets === 6 && w10.sofar.hauls === 2 && w10.match.line === "6/10 (4.0)",
      "10 wickets: in 2 innings, best 6/10, two 3+ hauls: " + JSON.stringify(w10.sofar));
    // Match-ups both ways.
    const pairs = [{ bowlerName: "A", runs: 30, balls: 20, outs: 0 }, { bowlerName: "B", runs: 10, balls: 12, outs: 2 }, { bowlerName: "C", runs: 30, balls: 15, outs: 1 }, { bowlerName: "D", runs: 0, balls: 0, outs: 2 }];
    assert(win.sortMatchups(pairs, "faced", "best").map(p => p.bowlerName).join("") === "CABD", "batting, best: most runs, then the faster scoring");
    assert(win.sortMatchups(pairs, "faced", "tough").map(p => p.bowlerName).join("") === "BDCA", "batting, toughest: out most, then the slowest scoring (unknown last)");
    const bw = [{ batterName: "P", runs: 40, balls: 20, outs: 1 }, { batterName: "Q", runs: 5, balls: 10, outs: 2 }, { batterName: "R", runs: 12, balls: 6, outs: 2 }];
    assert(win.sortMatchups(bw, "bowledAt", "best").map(p => p.batterName).join("") === "QRP" && win.sortMatchups(bw, "bowledAt", "tough").map(p => p.batterName).join("") === "PRQ",
      "bowling: best = most wickets then cheapest, toughest = most runs given away");
  }

  // --- 7 or more runs off one ball (overthrows) ---
  {
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", wideEnabled: true, noBallEnabled: true });
      state.match.status = "live"; openInnings(currentInnings(state.match), "A1", "A2", "B1"); state.snapshots = []; ui = defaultUi(); state.view = "home"; render();`);
    const more = doc.querySelector('#app [data-action="toggle-extra"][data-extra="more"]');
    assert(more && more.textContent === "7+", "the extras row has 7+");
    more.click();
    assert(/7 or more runs/.test(doc.getElementById("modal-root").textContent) && doc.querySelectorAll('#modal-root [data-action="ball"]').length === 6, "7+ opens a sheet of 7 to 12");
    doc.querySelector('#modal-root [data-action="ball"][data-runs="7"]').click();
    const st = () => win.eval(`(() => { const i = currentInnings(state.match); return [i.runs, i.striker, i.batting.stats.A1.runs, i.currentOverEvents.map(e => e.display).join(" ")].join("|"); })()`);
    assert(st() === "7|A2|7|7" && !doc.querySelector("#modal-root .modal"), "7 off the bat: an ordinary ball, the batters cross: " + st());
    doc.querySelector('#app [data-extra="more"]').click();
    doc.querySelector('#modal-root [data-action="more-runs-kind"][data-tab="bye"]').click();
    doc.querySelector('#modal-root [data-action="ball"][data-runs="8"]').click();
    assert(st() === "15|A2|7|7 B8" && win.eval("currentInnings(state.match).extras.byes") === 8, "8 byes: to the extras, not the batter: " + st());
    doc.querySelector('#app [data-action="undo"]').click();
    assert(st() === "7|A2|7|7", "Undo takes it back");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- the guest backup, and CSV ---
  {
    const g = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
    Object.assign(g, { id: "bk1", status: "complete", completedAt: Date.now() });
    const club = Object.assign(JSON.parse(JSON.stringify(g)), { id: "bk2", clubId: "c1" });
    const backup = { kind: "cricket.lk/guest-backup", version: 1, savedAt: Date.now(), data: {
      matchHistory: { bk1: g, bk2: club, bad: { id: "bad" } }, players: JSON.parse('{"p1":{"id":"p1","name":"Ann"},"__proto__":{"id":"x","name":"Evil"}}'),
      teams: {}, matchPresets: {}, tournamentPresets: {}, pointsPresets: {}, tournaments: { t1: { id: "t1", name: "Cup", matchIds: ["bk1", "nope"] } } } };
    const st = { matchHistory: {}, players: {}, teams: {}, matchPresets: {}, tournamentPresets: {}, pointsPresets: {}, tournaments: {} };
    const plan = win.planGuestRestore(backup, st);
    assert(plan.add.matches === 1 && plan.add.players === 1 && plan.add.tournaments === 1, "restore: a guest match (not a club one, not a broken one), its player and tournament: " + JSON.stringify(plan.add));
    plan.apply(st, {});
    assert(st.matchHistory.bk1 && !st.matchHistory.bk2 && st.players.p1.name === "Ann" && ({}).name === undefined && !Object.prototype.hasOwnProperty.call(st.players, "__proto__")
      && JSON.stringify(st.tournaments.t1.matchIds) === '["bk1"]', "...applied: nothing reaches an object's prototype, a tournament keeps only matches it has");
    const again = win.planGuestRestore(backup, st);
    assert(again.add.matches === 0 && again.add.players === 0, "restoring twice adds nothing (whatever this phone has stays as it is)");
    assert(win.planGuestRestore({ kind: "something else" }, st).error && win.planGuestRestore(Object.assign({}, backup, { version: 99 }), st).error, "a file that isn't a backup, or one from a newer app, is refused");
    assert(win.csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && win.csvCell('a,"b"') === '"a,""b"""' && win.csvCell(12.5) === "12.5" && win.csvCell(null) === "",
      "CSV: formulas stay text (CSV injection), quotes and commas are quoted");
    assert(/^Date,Team batting first,Score/.test(win.matchesCsv([g])), "the matches CSV has its header");
  }

  // --- ended tournaments: summary, Summary tab, guest end/reopen ---
  {
    const cfg = { teamA: "Lions", teamB: "Tigers", battingFirst: "A", oversLimit: 20, playersPerSide: 11 };
    const m1 = win.createResultOnlyMatch(cfg, [{ runs: 150, wickets: 5, balls: null }, { runs: 151, wickets: 3, balls: 100 }]);
    const m2 = win.createResultOnlyMatch(Object.assign({}, cfg, { teamB: "Eagles" }), [{ runs: 180, wickets: 4, balls: 120 }, { runs: 100, wickets: 10, balls: 90 }]);
    const s = win.tournamentSummary([m1, m2], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true });
    assert(s.matches === 2 && s.runs === 581 && s.highestTotal.runs === 180 && s.highestTotal.team === "Lions", "summary totals and highest team total");
    assert(s.champion.name === "Tigers" && s.runnerUp.name === "Lions" && !s.shared, "level on points, NRR decides the champion: " + JSON.stringify(s.standings.map(t => [t.name, t.points, +t.nrr.toFixed(2)])));
    const s2 = win.tournamentSummary([m1, m2], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: false });
    assert(s2.shared, "without NRR, two teams level on points share the top");
    assert(s.mvp === null && s.topBat === null && s.bestInnings === null, "no player highlights from result-only matches");
    // A match whose score was set by hand afterwards still counts each
    // player's figures (a 4-for there is the best bowling); a "no names" copy
    // counts for team totals, sixes too, but not for players.
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const h = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 6, battingFirst: "A" });
    win.openInnings(currentInnings(h), "A1", "A2", "B1"); h.status = "live";
    play(h, { kind: "run", runs: 6 });
    ["A3", "A4", "A5", "A6"].forEach(n => { play(h, { kind: "wicket", wicketType: "bowled" }); win.sendInBatter(currentInnings(h), n); });
    play(h, { kind: "run", runs: 0 });
    const byHand = win.setScoresByHand(h, [{ runs: 20, wickets: 4, balls: 12 }, { runs: 10, wickets: 1, balls: 12 }]).match;
    const noNames = Object.assign(JSON.parse(JSON.stringify(byHand)), { anonymous: true, caughtUp: false });
    const hs = win.tournamentSummary([byHand, noNames], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true });
    assert(byHand.caughtUp && byHand.status === "complete" && hs.bestBowling && hs.bestBowling.name === "B1" && hs.bestBowling.wickets === 4 && hs.bestBowling.runs === 6 && hs.topBowl.wickets === 4,
      "a match set by hand still counts its players' figures (best bowling 4/6); the no-names copy doesn't: " + JSON.stringify(hs.bestBowling));
    assert(hs.sixes === 2 && hs.runs === 60, "sixes and runs are team totals: every match counts, no-names too");
    assert(win.pickMatchMOTM(byHand) === "B1" && win.pickMatchMOTM(noNames) === null, "a match set by hand still gets a player of the match; a no-names one doesn't");
    win.eval(`state.match = null; ui = defaultUi();
      const a = createTeam("Lions"), b = createTeam("Tigers");
      const t = createTournament({ name: "Summer Cup", tournamentPresetId: Object.keys(state.tournamentPresets)[0], teamIds: [a.id, b.id] });
      state.activeTournamentId = t.id; state.view = "tournamentDashboard"; render();`);
    const tabIds = () => [...doc.querySelectorAll('#app [data-action="switch-tournament-tab"][role="tab"]')].map(b => b.dataset.tab);
    assert(!tabIds().includes("summary"), "no Summary tab while the tournament is running");
    doc.querySelector('#app [data-action="open-result-entry"]').click();
    const rf = doc.getElementById("result-entry-form");
    assert(rf, "Enter result only opens the result sheet");
    rf.querySelector('[name="runsA"]').value = "120"; rf.querySelector('[name="wktsA"]').value = "6";
    rf.querySelector('[name="runsB"]').value = "121"; rf.querySelector('[name="wktsB"]').value = "2"; rf.querySelector('[name="oversB"]').value = "15.4";
    rf.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(!doc.getElementById("result-entry-form") && win.eval("activeTournament().matchIds.length") === 1, "saving archives the result into the tournament and closes the sheet");
    assert(/Tigers won by 8 wickets/.test(doc.getElementById("app").textContent), "the result shows on the dashboard");
    doc.querySelector('#app [data-action="end-tournament"]').click();
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.eval("!!activeTournament().endedAt") && tabIds()[0] === "summary" && doc.querySelector('#app [data-action="share-tournament"]'), "ending it adds a Summary tab (first, selected) with a share button");
    assert(/Tigers/.test(doc.querySelector("#app .summary-champ").textContent) && !doc.querySelector('#app [data-action="open-result-entry"]'), "Tigers are champions, and no more results can be entered");
    doc.querySelector('#app [data-action="reopen-tournament"]').click();
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.eval("!activeTournament().endedAt") && !tabIds().includes("summary"), "reopening removes the Summary tab");
    win.eval(`state.view = "home"; ui = defaultUi(); save(); render();`);
  }

  // --- club tournaments: ending one is a queued "tournament.update" ---
  {
    const op = (kind, args) => ({ id: Math.random().toString(36), kind, args, userId: "u1", createdAt: 1, failed: false });
    let q = win.coalesceOp([], op("tournament.update", { id: "T", preset: { pointsForWin: 2, endedAt: 5 } }));
    q = win.coalesceOp(q, op("tournament.update", { id: "T", preset: { pointsForWin: 2 } }));
    assert(q.length === 1 && !q[0].args.preset.endedAt, "only the latest pending tournament update is kept");
    const shown = win.overlayTournamentData({ id: "T", name: "Cup", tournament_preset: { pointsForWin: 2 }, matches: [], teams: [] },
      [op("tournament.update", { id: "T", preset: { pointsForWin: 2, endedAt: 9 } })], [], "T");
    assert(shown.tournament_preset.endedAt === 9, "a pending end shows as ended before it syncs");
  }

  // --- a club admin deletes a tournament with no matches (supabase/024) ---
  {
    const doc = win.document, app = () => doc.querySelector("#app");
    const op = (kind, args, extra) => Object.assign({ id: Math.random().toString(36), kind, args, userId: "u1", createdAt: 1, failed: false }, extra);
    // what can't be deleted, and the queued ops a delete drops
    const t0 = { id: "T", matches: [] };
    assert(win.tournamentDeleteBlock(t0, [], null) === null, "an empty tournament can be deleted");
    assert(/has 2 matches/.test(win.tournamentDeleteBlock({ id: "T", matches: [{}, {}] }, [], null)), "one with matches can't");
    assert(/waiting to sync/.test(win.tournamentDeleteBlock(t0, [op("match", { id: "m", tournamentId: "T" })], null)), "nor one with a match still waiting to sync");
    assert(/being scored/.test(win.tournamentDeleteBlock(t0, [], { tournamentId: "T", status: "live" })) && win.tournamentDeleteBlock(t0, [], { tournamentId: "X", status: "live" }) === null,
      "nor one whose match is being scored here (another tournament's match doesn't count)");
    const q = [op("tournament.create", { id: "T" }), op("tournament.update", { id: "T" }), op("team.save", { id: "tm", tournamentId: "T" }, { failed: true }),
      op("team.save", { id: "tm2", tournamentId: "U" }), op("tournament.update", { id: "T" }, { userId: "u2" }), op("match", { id: "m", tournamentId: "U" })];
    assert(win.dropTournamentOps(q, "T", "u1").map(o => o.args.id).join() === "tm2,T,m", "a delete drops this user's create/update/team ops for it (failed ones too), nothing else");

    // the dashboard: Delete tournament on an empty Overview, for an admin
    win.eval(`window.__prevSession = session; window.__prevClient = supabaseClient; state.match = null; state.snapshots = [];
      session = { user: { id: "u1" } }; ui = defaultUi(); outbox = [];
      window.__rpc = []; window.__rpcResult = { data: "deleted", error: null };
      const chain = () => { const c = { then: (ok, no) => Promise.resolve({ data: [], error: null }).then(ok, no) };
        ["select", "eq", "order", "maybeSingle", "range", "in"].forEach(f => { c[f] = () => c; }); return c; };
      supabaseClient = { from: chain, rpc: async (fn, args) => { __rpc.push([fn, args]); return __rpcResult; } };
      ui.myClubs = [{ id: "c1", name: "KICC", role: "owner" }];
      ui.club = { id: "c1", name: "KICC", members: [], invites: [], roster: [], matches: [], presets: { match: [], tournament: [], points: [] },
        tournaments: [{ id: "kt", name: "Tue Nov 10 2026", created_at: new Date().toISOString() }, { id: "kt2", name: "Tue Nov 10 2026", created_at: new Date().toISOString() }] };
      cacheFor().clubs.c1 = { id: "c1", tournaments: JSON.parse(JSON.stringify(ui.club.tournaments)) }; cacheFor().tournaments.kt = { id: "kt" };
      outbox = [{ id: "o1", kind: "team.save", args: { id: "tm1", tournamentId: "kt", name: "Reds", players: [] }, userId: "u1", createdAt: 1, failed: true }];
      state.activeClubId = "c1"; ui.currentClubId = "c1"; ui.currentTournamentId = "kt";
      ui.clubTournament = { id: "kt", name: "Tue Nov 10 2026", organizer_club_id: "c1", tournament_preset: { pointsForWin: 2 }, matches: [],
        teams: [{ id: "tm1", name: "Reds", players: [] }] };
      ui.tournamentTab = "overview"; state.view = "clubTournamentDashboard"; render();`);
    const delBtn = () => app().querySelector('[data-action="delete-tournament"]');
    assert(delBtn(), "an empty tournament's Overview has Delete tournament for a club admin");
    win.eval(`ui.tournamentTab = "fixtures"; render();`);
    assert(!delBtn(), "...on the Overview only");
    win.eval(`ui.tournamentTab = "overview"; ui.myClubs[0].role = "player"; render();`);
    assert(!delBtn(), "a player who only plays for the club doesn't get it");
    win.eval(`ui.myClubs = [{ id: "other", name: "My XI", role: "owner" }]; render();`);
    assert(!delBtn(), "nor does anyone the club list doesn't have as its admin");
    win.eval(`ui.myClubs = [{ id: "c1", name: "KICC", role: "owner" }]; ui.clubTournament.matches = [{ id: "m1", data: { id: "m1", teamA: "A", teamB: "B", innings: [], completedAt: 1 } }]; render();`);
    assert(!delBtn(), "a tournament with a match has no Delete");
    win.eval(`ui.clubTournament.matches = []; render();`);

    // 024 not run: the sheet stays open and says so
    win.eval(`__rpcResult = { data: null, error: { code: "PGRST202", message: "not found" } };`);
    delBtn().click();
    assert(/Delete Tue Nov 10 2026\?/.test(doc.querySelector("#confirm-root").textContent) && /team goes with it/.test(doc.querySelector("#confirm-root").textContent),
      "it asks first, saying its team goes too");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    await wait(10);
    assert(/024_delete_empty_tournament/.test(doc.querySelector("#confirm-root").textContent) && win.eval("state.view") === "clubTournamentDashboard",
      "without 024 the sheet stays open and says which SQL to run");
    win.eval(`ui.confirm = null; __rpcResult = { data: "deleted", error: null }; __rpc = []; render();`);

    delBtn().click();
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    await wait(10);
    assert(win.eval(`JSON.stringify(__rpc)`) === JSON.stringify([["delete_club_tournament", { _tournament_id: "kt" }]]), "it asks the server to delete it");
    assert(win.eval("state.view") === "home" && win.eval("state.activeClubId") === "c1" && !doc.querySelector("#confirm-root .modal")
      && !app().querySelector('[data-action="open-club-tournament"][data-id="kt"]') && app().querySelector('[data-action="open-club-tournament"][data-id="kt2"]'),
      "then the club's Home, which no longer lists it (the other one stays)");
    assert(win.eval(`outbox.length === 0 && !cacheFor().tournaments.kt && cacheFor().clubs.c1.tournaments.map(x => x.id).join() === "kt2"`),
      "its queued team change and its read-cache copy are gone");

    // made offline, never synced: the delete just drops its queued ops, no server call
    win.eval(`__rpc = []; outbox = [{ id: "o2", kind: "tournament.create", args: { id: "kt3", clubId: "c1", name: "Oops", preset: {} }, userId: "u1", createdAt: 1, failed: false }];`);
    const r3 = await win.eval(`deleteClubTournament({ id: "kt3", name: "Oops", organizer_club_id: "c1", matches: [], teams: [] })`);
    assert(r3.ok && win.eval("outbox.length") === 0 && win.eval("__rpc.length") === 0, "a tournament made offline is deleted by dropping its queued create");
    // offline, a synced one has to wait
    win.eval(`session.offline = true;`);
    const r4 = await win.eval(`deleteClubTournament({ id: "kt2", name: "x", organizer_club_id: "c1", matches: [], teams: [] })`);
    assert(/offline/i.test(r4.error) && win.eval("__rpc.length") === 0, "offline, a synced tournament can't be deleted yet");
    win.eval(`session = window.__prevSession; supabaseClient = window.__prevClient; outbox = []; cloudCache = null; state.activeClubId = null;
      ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- wickets off a wide / no-ball ---
  {
    const fresh = () => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      const inn = currentInnings(m);
      win.openInnings(inn, "A1", "A2", "B1");
      m.status = "live";
      return { m, inn };
    };
    assert(win.wicketTypesFor(false, "wide").join() === "stumped,hitwicket,runout", "off a wide: stumped, hit wicket or run out");
    assert(win.wicketTypesFor(false, "noball").join() === "runout" && win.wicketTypesFor(true, "wide").join() === "runout", "off a no-ball (or on a free hit): run out only");
    assert(win.wicketTypesFor(false).length === 6, "a fair ball allows every dismissal");

    let { inn } = fresh();
    recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "wicket", wicketType: "stumped", extra: "wide" });
    assert(inn.legalBalls === 1 && inn.runs === 1 && inn.extras.wides === 1 && inn.wickets === 1, "stumped off a wide: 1 wide, a wicket, and the ball doesn't count");
    assert(inn.bowling.stats.B1.wickets === 1 && inn.bowling.stats.B1.runs === 1 && inn.bowling.stats.B1.legalBalls === 1, "the bowler gets the wicket and is charged the wide");
    assert(inn.batting.stats.A1.balls === 1 && inn.batting.stats.A1.out && /^stumped b B1$/.test(inn.batting.stats.A1.howOut) && inn.striker === null, "a wide isn't a ball faced; the striker is out stumped");
    assert(inn.currentOverEvents[1].display === "Wd+W" && inn.currentOverEvents[1].extra === "wide", "the chip reads Wd+W");

    ({ inn } = fresh());
    recordBall(inn, { kind: "wicket", wicketType: "runout", extra: "noball", runs: 1, endComingIn: "nonStriker", fielder: "F1" });
    assert(inn.legalBalls === 0 && inn.runs === 2 && inn.extras.noBalls === 1 && inn.batting.stats.A1.runs === 1 && inn.batting.stats.A1.balls === 1, "run out off a no-ball: 1 no-ball + the run completed (to the batter), not a legal ball");
    assert(inn.bowling.stats.B1.wickets === 0 && inn.bowling.stats.B1.runs === 2 && inn.freeHit === true, "no wicket for the bowler, both runs against them, and the next ball is a free hit");
    assert(inn.batting.stats.A2.out && inn.nonStriker === null && inn.currentOverEvents[0].display === "Nb+1+Ro", "the non-striker is out and the chip reads Nb+1+Ro");
    const c = win.inningsCommentary(inn).filter(l => l.type === "ball");
    assert(c[0].label === "0.1" && /^No ball, and OUT! Run out/.test(c[0].text), "commentary: the ball is numbered as the next legal one and says no ball, and out");

    ({ inn } = fresh());
    for (let i = 0; i < 5; i++) recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "wicket", wicketType: "runout", extra: "wide", runs: 0, endComingIn: "striker" });
    assert(inn.legalBalls === 5 && inn.bowler === "B1" && inn.bowling.stats.B1.maidens === 0, "a wicket off a wide on the 6th ball: the over isn't over and it's no maiden");
  }

  // --- runs taken off a wide: an odd number and the batters have crossed ---
  {
    const fresh = () => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      const inn = currentInnings(m);
      win.openInnings(inn, "A1", "A2", "B1");
      m.status = "live";
      return { m, inn };
    };
    const strikeAfter = runs => { const { inn } = fresh(); recordBall(inn, { kind: "wide", runs }); return inn.striker; };
    assert(strikeAfter(0) === "A1" && strikeAfter(2) === "A1" && strikeAfter(4) === "A1", "a wide, Wd+2 or a wide that goes for four: strike stays");
    assert(strikeAfter(1) === "A2" && strikeAfter(3) === "A2", "Wd+1 / Wd+3: they crossed, so the other batter is on strike");
    let { inn } = fresh();
    for (let i = 0; i < 5; i++) recordBall(inn, { kind: "run", runs: 0 });
    recordBall(inn, { kind: "wide", runs: 1 });
    assert(inn.striker === "A2" && inn.bowler === "B1" && inn.extras.wides === 2, "Wd+1 before the 6th ball: 2 wides, and A2 faces the 6th ball");
    recordBall(inn, { kind: "run", runs: 0 });
    assert(inn.striker === "A1" && inn.bowler === null, "...and A1 faces the next over");

    // A match scored before wides changed strike has Wd+1 in its log with
    // nobody moving (or a hand swap after it). Editing another ball, or
    // rebuilding it from its scorecard, keeps each ball with whoever faced it.
    const old = fresh();
    const oldWide = x => { recordBall(x, { kind: "wide", runs: 1 }); win.swapStrike(x); };   // where the old engine left them
    recordBall(old.inn, { kind: "run", runs: 0 });
    oldWide(old.inn);
    recordBall(old.inn, { kind: "run", runs: 4 });                     // A1 hit the four
    oldWide(old.inn); win.swapStrikeByHand(old.inn);                   // the scorer swapped by hand instead
    recordBall(old.inn, { kind: "run", runs: 2 });                     // A2 hit the two
    const seqs = old.inn.log.filter(a => a.t === "ball").map(a => a.ev.seq);
    const r = win.replayMatch(old.m, { inn: 0, seq: seqs[0], ev: { kind: "run", runs: 2 } });
    const ni = r.match && r.match.innings[0];
    assert(ni && ni.runs === 12 && ni.batting.stats.A1.runs === 6 && ni.batting.stats.A2.runs === 2 && ni.striker === "A2", "an old match's Wd+1: an edit elsewhere still gives the 4 to A1 and the 2 to A2");
    const arch = JSON.parse(JSON.stringify(old.m));
    delete arch.innings[0].log; delete arch.innings[0].logBase;
    assert(!!win.rebuildInningsFromScorecard(arch, 0), "...and it still rebuilds from its scorecard");
  }

  // --- swapping strike by hand ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1");
    assert(win.swapStrikeByHand(inn) && inn.striker === "A2" && inn.nonStriker === "A1" && inn.log.at(-1).t === "swap", "swap strike: the batters change ends and it's logged");
    inn.striker = null;
    assert(!win.swapStrikeByHand(inn) && inn.nonStriker === "A1", "no swap with only one batter in");
  }

  // --- editing an earlier ball (replayMatch) ---
  {
    const setup = (opts) => {
      const m = createMatch(Object.assign({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 4, battingFirst: "A" }, opts || {}));
      const inn = currentInnings(m);
      win.openInnings(inn, "A1", "A2", "B1");
      m.status = "live";
      return { m, inn };
    };
    const seqOf = (inn, n) => inn.log.filter(a => a.t === "ball")[n].ev.seq;
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };

    // 0.1 dot, 0.2 single, 0.3 four -- change the single to a three
    let { m, inn } = setup();
    play(m, { kind: "run", runs: 0 }); play(m, { kind: "run", runs: 1 }); play(m, { kind: "run", runs: 4 });
    const beforeJson = JSON.stringify(m);
    let r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 1), ev: { kind: "run", runs: 3 } });
    let ni = r.match && r.match.innings[0];
    assert(JSON.stringify(m) === beforeJson, "replayMatch never touches the match it's given");
    assert(ni.runs === 7 && ni.batting.stats.A1.runs === 3 && ni.batting.stats.A2.runs === 4, "1 -> 3: the total moves by 2 and each later ball stays with the batter who faced it");
    assert(ni.currentOverEvents.map(e => e.display).join() === "0,3,4" && ni.currentOverEvents[1].seq === seqOf(inn, 1), "the over reads 0 3 4 and the ball keeps its id");

    // dot -> wicket: the next batter comes in a ball earlier, and the one after is asked for
    ({ m, inn } = setup());
    play(m, { kind: "run", runs: 0 });
    play(m, { kind: "run", runs: 0 });
    play(m, { kind: "wicket", wicketType: "bowled" });
    win.sendInBatter(inn, "A3");
    play(m, { kind: "run", runs: 2 });
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "wicket", wicketType: "lbw" } });
    assert(r.need && r.need.kind === "batter" && r.need.label === "0.4" && r.need.out === "A3", "a new wicket at 0.1: A3 comes in for 0.2, and after A3 is bowled at 0.3 the app asks who faced 0.4");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "wicket", wicketType: "lbw" } }, { batters: ["A4"] });
    ni = r.match.innings[0];
    assert(ni.wickets === 2 && ni.batting.order.join() === "A1,A2,A3,A4" && ni.batting.stats.A4.runs === 2 && ni.batting.stats.A1.howOut === "lbw b B1" && ni.batting.stats.A3.balls === 2, "with A4 named: A1 lbw, A3 faced 0.2-0.3 and was bowled, A4 scored the 2");
    assert(ni.fallOfWickets.map(f => f.batsman).join() === "A1,A3", "fall of wickets follows the new order");

    // wicket -> dot: the batter who came in now comes in at the next wicket (or not at all)
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: { kind: "run", runs: 0 } });
    ni = r.match.innings[0];
    assert(ni.wickets === 0 && !ni.batting.order.includes("A3") && ni.batting.stats.A1.runs === 2 && r.notes.some(t => /A3 no longer comes in/.test(t)), "removing the wicket: A1 bats on (and gets the 2), A3 no longer comes in");
    // removing a ball altogether
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: null });
    assert(r.match.innings[0].legalBalls === 3 && r.match.innings[0].wickets === 1, "a ball can be removed");

    // legal -> wide moves the over: the next bowler starts a ball later
    ({ m, inn } = setup());
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 0 });
    win.setBowler(inn, "B2");
    play(m, { kind: "run", runs: 1 });
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: { kind: "wide", runs: 0 } });
    ni = r.match.innings[0];
    assert(ni.bowling.stats.B1.legalBalls === 6 && ni.bowling.stats.B1.runs === 2 && ni.legalBalls === 6, "a dot made a wide: B1's over takes the next ball too");
    assert(ni.bowler === "B2" && !ni.bowling.stats.B2.legalBalls && r.notes.some(t => /every later over moves/.test(t)), "and B2 starts the next over instead (the scorer is told the overs moved)");
    // wide -> legal moves it the other way, and the bowler is taken from the log
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: { kind: "run", runs: 0 } });
    assert(r.match && r.match.innings[0].legalBalls === 7, "editing a ball to the same kind of legal ball changes nothing else");

    // the last wicket now falls earlier: the innings ends and later balls go
    ({ m, inn } = setup({ playersPerSide: 2 }));
    play(m, { kind: "run", runs: 4 });
    play(m, { kind: "run", runs: 0 });
    play(m, { kind: "wicket", wicketType: "bowled" });
    assert(m.status === "innings_break", "(setup) all out at 0.3");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 1), ev: { kind: "wicket", wicketType: "caught", fielder: "B9" } });
    assert(r.match.status === "innings_break" && r.match.innings[0].legalBalls === 2 && r.notes.some(t => /1 later ball is removed/.test(t)), "a wicket two balls earlier ends the innings there");
    // and the reverse: un-doing the last wicket goes back to live scoring
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: { kind: "run", runs: 1 } });
    assert(r.match.status === "live" && !r.match.innings[0].complete && r.match.innings[0].runs === 5, "removing the last wicket: the innings isn't over, back to live");

    // editing the first innings during the chase moves the target
    ({ m, inn } = setup({ oversLimit: 1 }));
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 1 });
    startSecondInnings(m);
    const i2 = currentInnings(m);
    win.openInnings(i2, "B1", "B2", "A1"); m.status = "live";
    play(m, { kind: "run", runs: 6 });
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "run", runs: 6 } });
    assert(r.match.innings[0].runs === 11 && r.match.innings[1].target === 12 && r.match.innings[1].runs === 6 && r.match.status === "live" && r.notes.some(t => /need 12/.test(t)), "a first-innings edit mid-chase: target 7 -> 12, the chase replays");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "run", runs: 0 } });
    assert(r.match.innings[1].target === 6 && r.match.status === "complete" && /won/.test(r.match.result), "a lower target the chase has already passed ends the match");

    // a wide made legal: the over ends a ball sooner and the next bowler comes on earlier
    ({ m, inn } = setup());
    for (let i = 0; i < 5; i++) play(m, { kind: "run", runs: 0 });
    play(m, { kind: "wide", runs: 0 });
    play(m, { kind: "run", runs: 0 });
    win.setBowler(inn, "B2");
    play(m, { kind: "run", runs: 0 });
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 5), ev: { kind: "run", runs: 0 } });
    assert(r.match && r.match.innings[0].bowling.stats.B1.legalBalls === 6 && r.match.innings[0].bowling.stats.B2.legalBalls === 2, "a wide made a dot: B2 starts the next over a ball earlier");

    // catch-up: balls before it stay editable; the caught-up score stays and its gap shrinks
    ({ m, inn } = setup());
    play(m, { kind: "run", runs: 1 });
    const firstSeq = seqOf(inn, 0);
    win.applyCatchUp(m, { runs: 10, wickets: 0, balls: 3, extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
      batters: [{ name: "A1", status: "nonStriker", runs: null, balls: null }, { name: "A2", status: "striker", runs: null, balls: null }],
      bowlers: [], bowlerNow: "B1" });
    assert(win.editableBall(m, 0, firstSeq) && m.caughtUp && inn.log.some(a => a.t === "catchup"), "balls before a catch-up stay editable (it's a step in the log; the match is marked caught up)");
    r = win.replayMatch(m, { inn: 0, seq: firstSeq, ev: { kind: "run", runs: 3 } });
    let cg = r.match.innings[0].overs.find(o => o.gap).gap;
    assert(r.match.innings[0].runs === 10 && cg.fromRuns === 3 && r.match.innings[0].batting.stats.A1.runs === 3 && r.notes.some(n => /score caught up \(10-0, 0\.3 ov\) are now 7 runs and 2 balls short/.test(n)),
      "a ball before it changed: the caught-up score stays 10-0, its gap is now 7 runs and 2 balls: " + JSON.stringify(r.notes));
    play(m, { kind: "run", runs: 2 });
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 1), ev: { kind: "run", runs: 4 } });
    assert(r.match && r.match.innings[0].runs === 14, "balls after it can be edited too (counted from the caught-up score)");
    // the two balls it skipped filled in (1 + 4 + 5 = 10 in 0.3): nothing left to catch up
    r = win.replayMatch(m, [{ inn: 0, seq: firstSeq, ev: { kind: "run", runs: 4 }, insert: "after" }, { inn: 0, seq: firstSeq, ev: { kind: "run", runs: 5 }, insert: "after" }]);
    let ri = r.match && r.match.innings[0];
    assert(ri && !ri.overs.some(o => o.gap) && ri.runs === 12 && ri.legalBalls === 4 && ri.batting.stats.A2.runs === 11 && !r.match.caughtUp && r.notes.some(n => /now add up to the score caught up/.test(n)),
      "the skipped balls added: no gap left, not caught up any more, the ball after it still counts (12-0): " + JSON.stringify(r.notes));
    // a batter the catch-up has at the crease, out by then after an edit, is refused
    r = win.replayMatch(m, { inn: 0, seq: firstSeq, ev: { kind: "wicket", wicketType: "bowled" } }, { batters: ["A3"], bowlers: [] });
    assert(r.error && /A1 is out at 0\.1 now, but was still batting when the score was caught up/.test(r.error), "an edit that gets out a batter the catch-up has at the crease says why: " + r.error);

    // "no names": placeholders are made up again
    ({ m, inn } = setup({ anonymous: true }));
    m.anonymous = true; m.innings[0] = win.createInnings("A", "B", null, 4, 2, {}); m.status = "opening";
    win.fillAnonymousSlots(m);
    play(m, { kind: "run", runs: 0 }); play(m, { kind: "run", runs: 0 });
    r = win.replayMatch(m, { inn: 0, seq: currentInnings(m).log.find(a => a.t === "ball").ev.seq, ev: { kind: "wicket", wicketType: "bowled" } });
    assert(r.match && r.match.innings[0].batting.order.join() === "Batter 1,Batter 2,Batter 3" && r.match.innings[0].striker === "Batter 3", "no names: a new wicket brings in the next placeholder");

    // the archive leaves the logs out; a re-synced match replaces the queued copy
    const arch = win.archivedCopy(m);
    assert(!arch.innings[0].log && !arch.innings[0].logBase && m.innings[0].log, "the archived copy has no action log (the live match keeps it)");
    const op = (args) => ({ id: Math.random().toString(36), kind: "match", args, userId: "u1", createdAt: 1, failed: false });
    let q = win.coalesceOp([], op({ id: "M", data: { v: 1 } }));
    q = win.coalesceOp(q, op({ id: "M", data: { v: 2 } }));
    assert(q.length === 1 && q[0].args.data.v === 2, "an edited match replaces its queued upload");
  }

  // --- UI: out on a wide, swap strike, edit a ball from ball by ball ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu");
      state.match.status = "live"; render();`);
    const inn = () => win.eval("currentInnings(state.match)");
    doc.querySelector('#app [data-action="swap-strike"]').click();
    assert(inn().striker === "Pathum" && win.eval("state.snapshots.length") === 1, "⇅ Swap on the live board swaps strike (undoable)");
    doc.querySelector('#app [data-action="undo"]').click();
    assert(inn().striker === "Kusal", "Undo puts them back");

    doc.querySelector('#app [data-action="toggle-extra"][data-extra="wide"]').click();
    doc.querySelector('#modal-root [data-action="wicket-on-extra"]').click();
    const types = [...doc.querySelectorAll('#modal-root [data-action="pick-wicket"]')].map(b => b.dataset.type);
    assert(types.join() === "stumped,hitwicket,runout" && /Off a wide/.test(doc.getElementById("modal-root").textContent), "'Out on this wide?' opens the wicket sheet with stumped / hit wicket / run out");
    doc.querySelector('#modal-root [data-action="close-wicket-modal"]').click();
    assert(doc.querySelector("#modal-root .extra-runs-modal"), "back goes to the wide's runs sheet");
    doc.querySelector('#modal-root [data-action="wicket-on-extra"]').click();
    doc.querySelector('#modal-root [data-action="pick-wicket"][data-type="stumped"]').click();
    assert(inn().wickets === 0 && /KEEPER/.test(doc.querySelector("#modal-root .fielder-box").textContent), "Stumped asks for the keeper (optional) before it's recorded");
    doc.getElementById("wicket-fielder").value = "Keeper K";
    doc.getElementById("wicket-fielder-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(inn().extras.wides === 1 && inn().wickets === 1 && inn().legalBalls === 0 && !doc.querySelector("#modal-root .extra-runs-modal") && doc.querySelector("#modal-root form#new-batsman-form"), "stumped off a wide is recorded; the next sheet asks for the new batter");
    assert(/^st Keeper K b /.test(inn().batting.stats.Kusal.howOut || inn().batting.stats.Pathum.howOut) && inn().fielding.stats["Keeper K"].stumpings === 1, "the keeper is credited with the stumping (st Keeper b Bowler)");
    win.eval(`submitNewBatsman("Charith", null); if (ui.confirm) runConfirm(); for (let i = 0; i < 3; i++) handleBallClick(1);`);
    assert(inn().runs === 4, "(three singles)");

    win.eval(`ui.matchMenu = "menu"; render();`);
    doc.querySelector('#modal-root [data-action="open-edit-balls"]').click();
    const chips = [...doc.querySelectorAll('#modal-root [data-action="edit-ball"]')];
    assert(chips.length === 4 && chips[1].dataset.label === "0.1" && chips[3].dataset.label === "0.3", "Match options → Edit opens ball by ball; every ball is a button labelled with its number");
    chips[2].click();
    const sheet = () => doc.querySelector("#modal-root .ball-edit-modal");
    assert(sheet() && /Edit ball 0.2/.test(sheet().textContent), "tapping a ball opens its edit sheet");
    sheet().querySelector('[data-field="runs"][data-value="4"]').click();
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const confirm = doc.querySelector("#confirm-root");
    assert(/Change ball 0.2/.test(confirm.textContent) && /4-1 \(0\.3\) → 7-1 \(0\.3\)/.test(confirm.textContent), "review shows the old and new score");
    confirm.querySelector('[data-action="confirm-ok"]').click();
    assert(inn().runs === 7 && !sheet() && doc.querySelector("#modal-root .scorecard-modal"), "saved: the score is 7 and the scorecard is back");
    doc.querySelector('#modal-root [data-action="close-live-scorecard"]').click();
    doc.querySelector('#app [data-action="undo"]').click();
    assert(inn().runs === 4, "Undo brings the old ball back");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- UI: a wide they ran changes strike; only runs off the bat look like a four ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu");
      state.match.status = "live"; render();`);
    const extra = (kind, runs) => {
      doc.querySelector(`#app [data-action="toggle-extra"][data-extra="${kind}"]`).click();
      doc.querySelector(`#modal-root [data-action="ball"][data-runs="${runs}"]`).click();
    };
    const striker = () => doc.querySelector("#app .matchup-row .name").textContent.trim();
    extra("wide", 1);
    assert(striker() === "Pathum" && win.eval("currentInnings(state.match).striker") === "Pathum", "Wd+1 (ran 1): Pathum is on strike on the board");
    extra("bye", 4); extra("wide", 3);
    doc.querySelector('#app [data-action="ball"][data-runs="4"]').click();
    const chips = [...doc.querySelectorAll("#app .over-row:not(.dimmed) .chip:not(.empty)")];
    assert(chips.map(c => c.textContent).join() === "Wd+1,B4,Wd+3,4" && !chips[1].matches(".four") && !chips[2].matches(".four") && chips[3].matches(".four"),
      "the over row colours the 4 off the bat as a four, not B4 or Wd+3 (also worth 4)");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- UI: a finished match can be fixed from its Result screen (and stays finished) ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      { const m = state.match;
        openInnings(currentInnings(m), "Kusal", "Pathum", "Wanindu"); m.status = "live";
        for (let i = 0; i < 6; i++) handleBallClick(1);
        startSecondInnings(m); openInnings(currentInnings(m), "Babar", "Rizwan", "Dushmantha"); m.status = "live";
        for (let i = 0; i < 6; i++) handleBallClick(i === 5 ? 0 : 1);
      }
      ui.showFullScorecard = true; ui.scorecard = { inn: 1, mode: "balls" }; render();`);
    const id = win.eval("state.match.archivedId");
    assert(win.eval("state.match.status") === "complete" && /Lions won by 1 run/.test(win.eval("state.match.result")), "(setup) Lions won by 1 run");
    doc.querySelector('#app [data-action="edit-ball"][data-label="0.6"]').click();
    const sheet = () => doc.querySelector("#modal-root .ball-edit-modal");
    sheet().querySelector('[data-field="kind"][data-value="wide"]').click();
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(!doc.querySelector("#confirm-root .modal") && /isn't over any more/.test(sheet().textContent), "a change that would reopen a finished match is refused, with the reason");
    doc.querySelector('#modal-root [data-action="close-ball-edit"]').click();
    doc.querySelector('#app [data-action="edit-ball"][data-label="0.6"]').click();
    doc.querySelector('#modal-root [data-field="runs"][data-value="2"]').click();
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Result: Tigers won/.test(doc.querySelector("#confirm-root").textContent), "a change that keeps it finished goes to review, showing the new result");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.eval("state.match.archivedId") === id && /Tigers won/.test(win.eval(`state.matchHistory["${id}"].result`)) && win.eval(`state.matchHistory["${id}"].innings[1].runs`) === 7, "saved: the archived match (same id) has the new score and result");
    assert(win.eval(`!state.matchHistory["${id}"].innings[0].log`), "the archive still has no action log");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- before/after a ball, "?" while a name is needed, the final score by hand ---
  {
    const setup = (opts) => {
      const m = createMatch(Object.assign({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 4, battingFirst: "A" }, opts || {}));
      win.openInnings(currentInnings(m), "A1", "A2", "B1"); m.status = "live";
      return m;
    };
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const seqOf = (inn, n) => inn.log.filter(a => a.t === "ball")[n].ev.seq;

    let m = setup();
    play(m, { kind: "run", runs: 1 }); play(m, { kind: "wide", runs: 0 }); play(m, { kind: "run", runs: 4 });
    let inn = currentInnings(m);
    let c = win.ballContext(inn, seqOf(inn, 2));
    assert(c && c.label === "0.2" && c.before.runs === 2 && c.before.balls === 1 && c.after.runs === 6 && c.after.balls === 2 && c.over.number === 1 && c.over.at === 2, "ballContext: 0.2 (after a wide) is 2-0 before, 6-0 after, third ball of over 1");
    c = win.ballContext(inn, seqOf(inn, 1));
    assert(c.label === "0.2" && c.after.balls === 1, "a wide carries the number of the ball still to come and adds no ball");

    // a new wicket that needs a name: the partial match comes back, with the balls still unknown
    play(m, { kind: "run", runs: 0 }); play(m, { kind: "wicket", wicketType: "bowled" });
    win.sendInBatter(inn, "A3"); play(m, { kind: "run", runs: 2 });
    let r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "wicket", wicketType: "bowled" } });
    assert(r.need && r.partial && r.left === 1 && win.ballContext(r.partial.innings[0], seqOf(inn, 0)).after.wickets === 1, "replay that needs a name returns how far it got and how many balls are left as ?");

    // the final score by hand: a finished first innings changed mid-chase
    m = setup({ oversLimit: 1 });
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 1 });
    startSecondInnings(m); win.openInnings(currentInnings(m), "B1", "B2", "A1"); m.status = "live";
    play(m, { kind: "run", runs: 4 });
    const before = JSON.stringify(m);
    r = win.setScoresByHand(m, [{ runs: 3, wickets: 1, balls: 6 }, null]);
    assert(JSON.stringify(m) === before, "setScoresByHand never touches the match it's given");
    assert(r.match.innings[0].runs === 3 && r.match.innings[0].wickets === 1 && r.match.innings[1].target === 4 && r.match.status === "complete" && /Tigers won/.test(r.match.result) && r.match.caughtUp, "first innings set to 3: target 4, the chase's 4 off one ball now wins it (marked caught up)");
    assert(r.match.innings[1].legalBalls === 1 && r.match.innings[0].overs.some(o => o.gap && o.gap.byHand) && r.match.innings[0].log.some(a => a.t === "score"), "the chase is replayed and stops at the winning ball; the first innings has a by-hand gap, a step in its log");
    // the chase set too, the match finishes with that result
    r = win.setScoresByHand(m, [null, { runs: 5, wickets: 2, balls: 6 }]);
    assert(r.match.status === "complete" && r.match.result === "Lions won by 1 run" && r.match.innings[1].completeReason === "overs", "chase set to 5-2 off 6: Lions won by 1 run");
    // a first innings still being scored ends there; the same score keeps its balls editable
    m = setup();
    play(m, { kind: "run", runs: 2 });
    r = win.setScoresByHand(m, [{ runs: 2, wickets: 0, balls: 1 }, null]);
    assert(r.match.status === "innings_break" && r.match.innings[0].log && !r.match.caughtUp, "the same score just ends the innings (log kept, stats kept)");
    r = win.setScoresByHand(m, [{ runs: 150, wickets: 2, balls: 12 }, { runs: 151, wickets: 2, balls: 11 }]);
    assert(r.match.status === "complete" && /Tigers won by 1 wicket/.test(r.match.result) && r.match.innings[1].completeReason === "target", "both innings from the first innings in progress: the chase starts and is won");
    assert(win.setScoresByHand(m, [{ runs: 10, wickets: 4, balls: 6 }, null]).error && win.setScoresByHand(m, [{ runs: 10, wickets: 0, balls: 13 }, null]).error, "more wickets or overs than the match allows is refused");
    assert(/can't end past/.test(win.setScoresByHand(m, [{ runs: 10, wickets: 0, balls: 6 }, { runs: 20, wickets: 0, balls: 6 }]).error), "a chase past target + 5 is refused");
    assert(/first/.test(win.setScoresByHand(m, [null, { runs: 1, wickets: 0, balls: 1 }]).error), "a chase can't be set while the first innings isn't over");
    assert(/all out/.test(win.setScoresByHand(m, [{ runs: 10, wickets: 0, balls: 6 }, { runs: 11, wickets: 3, balls: 6 }]).error), "a chase can't reach the target and be all out");

    // balls before a score set by hand stay editable: the score stays, its gap shrinks, and goes once they add up
    m = setup();
    play(m, { kind: "run", runs: 1 }); play(m, { kind: "run", runs: 2 });
    let hm = win.setScoresByHand(m, [{ runs: 9, wickets: 1, balls: 4 }, null]).match, hi = hm.innings[0];
    assert(hm.status === "innings_break" && hi.completeReason === "closed" && hm.caughtUp && win.editableBall(hm, 0, seqOf(hi, 1)) && hi.overs.filter(o => o.gap && o.gap.byHand).length === 1,
      "set by hand at 9-1 (0.4) after 3-0 (0.2): ended there, one by-hand gap, the balls before it still editable");
    r = win.replayMatch(hm, { inn: 0, seq: seqOf(hi, 1), ev: { kind: "wicket", wicketType: "bowled" }, insert: "after" });
    let gi = r.match.innings[0];
    assert(gi.runs === 9 && gi.wickets === 1 && gi.legalBalls === 4 && gi.complete && r.notes.some(n => /set by hand \(9-1, 0\.4 ov\) are now 6 runs and 1 ball short/.test(n)),
      "a missed wicket added before it: still 9-1 (0.4), now 6 runs and 1 ball short: " + JSON.stringify(r.notes));
    r = win.replayMatch(r.match, { inn: 0, seq: r.added[0], ev: { kind: "run", runs: 6 }, insert: "after" }, { batters: ["A3"], bowlers: [] });
    gi = r.match.innings[0];
    assert(!gi.overs.some(o => o.gap) && gi.runs === 9 && gi.batting.stats.A3.runs === 6 && gi.batting.stats.A2.out && !r.match.caughtUp && r.match.status === "innings_break" && r.notes.some(n => /now add up to the score set by hand/.test(n)),
      "...and a six after it: the balls make 9-1 (0.4), so the gap goes and the match isn't marked caught up any more: " + JSON.stringify(r.notes));
    // set again with no ball between: the same gap moves; set back to what the balls say, it goes
    const again = win.setScoresByHand(hm, [{ runs: 12, wickets: 1, balls: 4 }, null]).match.innings[0];
    assert(again.overs.filter(o => o.gap).length === 1 && again.overs.find(o => o.gap).gap.fromRuns === 3 && again.runs === 12, "set again straight after: still one gap, from the balls (3-0) to the new score (12-1)");
    const back = win.setScoresByHand(hm, [{ runs: 3, wickets: 0, balls: 2 }, null]).match;
    assert(!back.innings[0].overs.some(o => o.gap) && back.innings[0].overs.length === 1 && back.innings[0].overs[0].bowler === "B1" && back.innings[0].overs[0].events.length === 2 && back.innings[0].completeReason === "closed" && !back.caughtUp,
      "set back to what the balls say (3-0, 0.2): no gap, the part over keeps its 2 balls and its bowler, not caught up");

    // a chase set by hand: a ball before it that would now reach the target doesn't end it there
    m = setup({ oversLimit: 1 });
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 1 });
    startSecondInnings(m); win.openInnings(currentInnings(m), "B1", "B2", "A1"); m.status = "live";
    play(m, { kind: "run", runs: 1 }); play(m, { kind: "run", runs: 0 });
    hm = win.setScoresByHand(m, [null, { runs: 7, wickets: 0, balls: 4 }]).match; hi = hm.innings[1];
    r = win.replayMatch(hm, { inn: 1, seq: seqOf(hi, 1), ev: { kind: "run", runs: 6 } });
    gi = r.match.innings[1];
    assert(hm.status === "complete" && r.match.status === "complete" && gi.runs === 7 && gi.legalBalls === 4 && gi.completeReason === "target" && r.match.result === hm.result && r.notes.some(n => /2 balls short/.test(n)),
      "chase set by hand at 7-0 (0.4): a ball before it that now reaches the target doesn't end it at 0.2; the score set stands: " + JSON.stringify(r.notes));

    // reopened after a score set by hand and scored on; then a ball before it fixed: the balls after it still count from that score
    m = setup();
    play(m, { kind: "run", runs: 1 }); play(m, { kind: "run", runs: 0 });
    hm = win.reopenInnings(win.setScoresByHand(m, [{ runs: 5, wickets: 0, balls: 3 }, null]).match, 0).match; hi = hm.innings[0];
    win.sendInBatter(hi, "A2"); win.sendInBatter(hi, "A1"); win.setBowler(hi, "B1");
    recordBall(hi, { kind: "run", runs: 4 }); afterBall(hm);
    r = win.replayMatch(hm, { inn: 0, seq: seqOf(hi, 1), ev: { kind: "run", runs: 2 } });
    gi = r.match.innings[0];
    assert(hi.runs === 9 && gi.runs === 9 && gi.legalBalls === 4 && gi.batting.stats.A2.runs === 6 && gi.striker === "A2" && gi.bowler === "B1" && r.notes.some(n => /set by hand \(5-0, 0\.3 ov\) are now 2 runs and 1 ball short/.test(n)),
      "reopened and scored on: a ball before the score set by hand changed, the total after it stays 9-0 and A2 has both: " + JSON.stringify(r.notes));

    // an archived innings (no log) with a score set by hand after its last ball is rebuilt from the scorecard, step and all
    const arch = win.setScoresByHand(m, [{ runs: 5, wickets: 0, balls: 3 }, null]).match;
    arch.innings.forEach(i => { delete i.log; delete i.logBase; });
    const rebuilt = win.rebuildInningsFromScorecard(arch, 0);
    assert(rebuilt && rebuilt.log.some(a => a.t === "score") && win.inningsScorecardKey(rebuilt) === win.inningsScorecardKey(arch.innings[0]), "an archived hand-set innings is rebuilt with its score step, so its balls can be edited");
  }

  // --- UI: the edit sheet's before/after panel and "?", and Set the final score ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu");
      state.match.status = "live";
      handleBallClick(1); handleBallClick(4); handleBallClick(0);
      ui.liveScorecard = "live"; ui.scorecard = { inn: null, mode: "balls" }; render();`);
    doc.querySelector('#modal-root [data-action="edit-ball"][data-label="0.2"]').click();
    const panel = () => doc.querySelector("#modal-root .ball-edit-context");
    assert(/Before this ball\s*1-0/.test(panel().textContent) && /After this ball\s*5-0/.test(panel().textContent), "the edit sheet shows the score before (1-0) and after (5-0) the ball");
    doc.querySelector('#modal-root [data-field="runs"][data-value="6"]').click();
    assert(/After this ball\s*7-0/.test(panel().textContent) && /5-0 \(0\.3\) → 7-0 \(0\.3\)/.test(panel().textContent), "picking 6 previews 7-0 after the ball and the innings total 5-0 → 7-0");
    doc.querySelector('#modal-root [data-field="kind"][data-value="wicket"]').click();
    doc.querySelector('#modal-root [data-field="wicketType"][data-value="bowled"]').click();
    assert(doc.querySelector('#modal-root .ball-edit-need input[name="newName"]') && /→ \?/.test(panel().textContent) && /later ball/.test(panel().textContent), "a new wicket asks at once who came in, and what can't be worked out yet shows as ?");
    doc.querySelector('#modal-root [data-action="close-ball-edit"]').click();
    win.eval(`ui.liveScorecard = false; ui.matchMenu = "menu"; render();`);
    doc.querySelector('#modal-root [data-action="open-score-set"]').click();
    const form = doc.getElementById("score-set-form");
    const f = n => form.elements.namedItem(n);
    assert(form && f("runs0").value === "5" && f("overs0").value === "0.3" && f("runs1").value === "", "Match options → Set the final score: the sheet is filled with the score so far, the chase blank");
    f("runs0").value = "120"; f("wkts0").value = "4"; f("overs0").value = "5";
    f("runs1").value = "100"; f("wkts1").value = "10"; f("overs1").value = "4.2";
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const confirm = doc.querySelector("#confirm-root");
    assert(/Lions won by 20 runs/.test(confirm.textContent) && /5-0 \(0\.3\) → 120-4 \(5\.0\)/.test(confirm.textContent), "review shows the scores and the result");
    confirm.querySelector('[data-action="confirm-ok"]').click();
    assert(win.eval("state.match.status") === "complete" && win.eval("state.match.archivedId") && win.eval("state.match.caughtUp") === true, "saved: the match is finished and archived, marked caught up");
    win.eval(`handleUndo()`);
    assert(win.eval("state.match.status") === "live" && win.eval("currentInnings(state.match).runs") === 5, "Undo brings the ball-by-ball score back");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); save(); render();`);
  }

  // --- UI: one-shot animations only play when their content is new ---
  {
    const doc = win.document;
    const bm = (...a) => JSON.stringify(win.ballMoment(...a));
    assert(bm("run", 4, "A", 10, 14) === JSON.stringify({ kind: "four", label: "FOUR" }) && win.ballMoment("run", 6, "A", 0, 6).kind === "six", "a 4 or 6 off the bat is a moment");
    assert(win.ballMoment("noball", 4, "A", 0, 4).kind === "four" && win.ballMoment("bye", 4, "A", 0, 0) === null && win.ballMoment("wide", 4, "A", 0, 0) === null && win.ballMoment("run", 1, "A", 3, 4) === null, "a no-ball's four counts; byes, wides and singles don't");
    assert(win.ballMoment("run", 4, "A", 48, 52).kind === "fifty" && win.ballMoment("run", 1, "A", 99, 100).kind === "hundred" && win.ballMoment("run", 6, "A", 50, 56).kind === "six", "crossing 50 / 100 beats the boundary; already past 50 is just the six");
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu");
      state.match.status = "live"; render();
      handleBallClick(4);`);
    const moment = () => doc.querySelector("#app .moment.stinger");
    assert(moment() && moment().querySelector(".stinger-glyph").textContent === "4" && /FOUR/.test(moment().textContent) && doc.querySelector("#app .score-tile.moment-four"), "a four plays the 4 stinger over the board (and rings the score tile)");
    win.eval(`render()`);
    assert(!moment() && !doc.querySelector("#app .score-tile[class*=moment-]"), "a re-render never replays the moment");
    win.eval(`handleUndo()`);
    assert(!moment(), "undo doesn't play one either");
    win.eval(`confirmWicket("bowled")`);
    assert(moment() && moment().querySelector(".stinger-glyph").textContent === "W" && /WICKET · Kusal/.test(moment().textContent), "a wicket plays the W stinger, naming the batter who's out");
    // tabs: only a tab that actually changed gets .tab-switched
    win.eval(`state.matchHistory = { m1: Object.assign(JSON.parse(JSON.stringify(state.match)), { id: "m1", status: "complete", completedAt: 1 }) };
      state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "stats"; render(); render();`);
    assert(doc.querySelector(".tab-row.stats-tabs") && !doc.querySelector(".tab-switched"), "re-rendering on the same tab animates nothing");
    win.eval(`ui.statsTab = "bat"; render();`);
    assert(doc.querySelector(".tab-row.stats-tabs.tab-switched"), "switching tab marks that tab row (its content fades in)");
    win.eval(`render();`);
    assert(!doc.querySelector(".tab-switched"), "the next re-render doesn't replay it");
    // the side menu slides in once, not on every render while it's open
    win.eval(`state.view = "home"; ui.sideMenuOpen = true; render();`);
    assert(!doc.querySelector(".side-menu.no-anim"), "the side menu animates when it opens");
    win.eval(`render();`);
    assert(doc.querySelector(".side-menu.no-anim") && doc.querySelector(".side-menu-backdrop.no-anim"), "and stays still on re-renders while open");
    win.eval(`ui = defaultUi(); state.matchHistory = {}; save(); render();`);
  }

  // --- adding a ball, removing one with the missing ball added, reopening an innings ---
  {
    const setup = (opts) => {
      const m = createMatch(Object.assign({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 4, battingFirst: "A" }, opts || {}));
      win.openInnings(currentInnings(m), "A1", "A2", "B1"); m.status = "live";
      return m;
    };
    const play = (m, ev) => { recordBall(currentInnings(m), ev); afterBall(m); };
    const seqOf = (inn, n) => inn.log.filter(a => a.t === "ball")[n].ev.seq;
    const labels = inn => win.inningsBalls(inn).map(b => `${b.label}:${b.bowler}:${b.ev.display}`).join(" ");

    // over 1 by B1 (six dots), over 2 by B2 (a 1 and a 2)
    let m = setup();
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 0 });
    win.setBowler(currentInnings(m), "B2");
    play(m, { kind: "run", runs: 1 }); play(m, { kind: "run", runs: 2 });
    let inn = currentInnings(m);
    // a 4 added after 0.3: the over takes it, B2's first ball moves into B1's over
    let r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: { kind: "run", runs: 4 }, insert: "after" });
    let ni = r.match.innings[0];
    assert(r.added.length === 1 && win.ballContext(ni, r.added[0]).label === "0.4" && ni.runs === 7 && ni.legalBalls === 9, "a ball added after 0.3 is the new 0.4 (+4 runs, one more ball)");
    assert(r.notes.some(t => /every later over moves \(0\.4 is now 0\.5\)/.test(t)) && r.notes.some(t => /1 ball now counts in another bowler's over \(0\.6 was B1's, now B2's\)/.test(t)), "the notes say which balls moved and that B1's last ball is now B2's first");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 0), ev: { kind: "wide", runs: 0 }, insert: "before" });
    assert(win.ballContext(r.match.innings[0], r.added[0]).label === "0.1" && r.match.innings[0].legalBalls === 8 && !r.notes.some(t => /moves/.test(t)), "a wide added before the first ball shifts nothing");

    // remove 0.3 and add the missing ball at the end of that over: every later ball stays where it was
    r = win.replayMatch(m, [{ inn: 0, seq: seqOf(inn, 2), ev: null }, { inn: 0, seq: seqOf(inn, 5), ev: { kind: "run", runs: 6 }, insert: "after" }]);
    ni = r.match.innings[0];
    assert(labels(ni) === "0.1:B1:0 0.2:B1:0 0.3:B1:0 0.4:B1:0 0.5:B1:0 0.6:B1:6 1.1:B2:1 1.2:B2:2" && !r.notes.some(t => /moves|another bowler/.test(t)), "remove 0.3 + add a 6 at the end of over 1: B1 still bowls six, B2's over is untouched");
    // the remove alone pulls B2's first ball into B1's over
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 2), ev: null });
    assert(/^0\.1:B1:0 0\.2:B1:0 0\.3:B1:0 0\.4:B1:0 0\.5:B1:0 0\.6:B1:1 1\.1:B2:2$/.test(labels(r.match.innings[0])), "(a removal on its own moves the next ball into the over)");

    // a finished match: a ball added after the winning ball can't be, a remove + add keeps it finished
    m = setup({ oversLimit: 1 });
    for (let i = 0; i < 6; i++) play(m, { kind: "run", runs: 1 });
    startSecondInnings(m); win.openInnings(currentInnings(m), "B1", "B2", "A1"); m.status = "live";
    play(m, { kind: "run", runs: 4 }); play(m, { kind: "run", runs: 4 });
    assert(m.status === "complete", "(setup) Tigers won off two balls");
    const i2 = m.innings[1];
    r = win.replayMatch(m, { inn: 1, seq: seqOf(i2, 1), ev: { kind: "run", runs: 1 }, insert: "after" });
    assert(/already over/.test(r.error), "a ball added after the winning ball is refused");
    r = win.replayMatch(m, [{ inn: 1, seq: seqOf(i2, 0), ev: null }, { inn: 1, seq: seqOf(i2, 1), ev: { kind: "run", runs: 2 }, insert: "before" }]);
    assert(r.match.status === "live" && r.match.innings[1].runs === 6 && r.match.innings[1].legalBalls === 2, "a remove + add that no longer reaches the target leaves the chase unfinished (the sheet refuses that for a finished match)");

    // reopening an innings ended by hand
    m = setup();
    play(m, { kind: "run", runs: 3 });
    win.endInnings(m);
    assert(m.status === "innings_break" && m.innings[0].completeReason === "closed", "(setup) innings closed at 3-0 (0.1)");
    r = win.reopenInnings(m, 0);
    assert(r.match.status === "live" && !r.match.innings[0].complete && r.match.innings[0].log.slice(-1)[0].t === "ball" && m.status === "innings_break", "reopen: back to live, the end comes off the log, the match given isn't touched");
    play(r.match, { kind: "run", runs: 2 });
    assert(r.match.innings[0].runs === 5 && r.match.innings[0].legalBalls === 2, "scoring carries on from where it stopped");
    startSecondInnings(m); win.openInnings(currentInnings(m), "B1", "B2", "A1"); m.status = "live";
    play(m, { kind: "run", runs: 1 });
    r = win.reopenInnings(m, 0);
    assert(r.match.innings.length === 1 && r.match.status === "live" && r.notes.some(t => /Tigers' innings so far \(1-0, 0\.1 ov\) is cleared/.test(t)), "reopening the first innings mid-chase clears the chase (and says so)");
    m = setup({ playersPerSide: 2 });
    play(m, { kind: "wicket", wicketType: "bowled" });
    assert(/all out/.test(win.reopenInningsError(m, 0)) && win.reopenInnings(m, 0).error, "an all-out innings can't be reopened (edit a ball instead)");
  }

  // --- UI: + adds a ball, remove offers the missing ball, reopen and Undo keep the archive in step ---
  {
    const doc = win.document;
    const submit = id => doc.getElementById(id).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const ok = () => doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      setBowler(currentInnings(state.match), "Dushmantha"); handleBallClick(1); handleBallClick(1);
      ui.liveScorecard = "live"; ui.scorecard = { inn: null, mode: "balls" }; render();`);
    assert(!doc.querySelector('#modal-root [data-action="add-ball"]'), "no + while live: the full over can't take a ball and the short one is still being bowled");
    win.eval(`endInnings(state.match); ui.liveScorecard = "innings_break"; ui.scorecard = { inn: 0, mode: "balls" }; render();`);
    const plus = doc.querySelectorAll('#modal-root [data-action="add-ball"]');
    assert(plus.length === 1 && plus[0].dataset.label === "1.2", "ended by hand at 1.2: the short over ends in a + (after 1.2)");
    plus[0].click();
    const sheet = () => doc.querySelector("#modal-root .ball-edit-modal");
    assert(/Add a ball after 1\.2/.test(sheet().textContent), "+ opens the sheet for a new ball after 1.2");
    sheet().querySelector('[data-field="runs"][data-value="2"]').click();
    assert(/New ball 1\.3/.test(sheet().textContent) && /8-0 \(1\.2\) → 10-0 \(1\.3\)/.test(sheet().textContent), "a 2 after the last ball: previewed as 1.3, total 8-0 (1.2) → 10-0 (1.3)");
    submit("ball-edit-form");
    assert(/Add a ball after 1\.2\?/.test(doc.querySelector("#confirm-root").textContent), "review asks before adding");
    ok();
    assert(win.eval("state.match.innings[0].runs") === 10 && win.eval("state.match.innings[0].legalBalls") === 9 && win.eval("state.match.status") === "innings_break", "saved: 10-0 in 1.3, still ended by hand");

    // remove 0.3 at the break: the over is short, so the ? offers the missing ball; just removing reopens the innings
    win.eval(`ui.liveScorecard = "innings_break"; ui.scorecard = { inn: 0, mode: "balls" }; render();`);
    doc.querySelector('#modal-root [data-action="edit-ball"][data-label="0.3"]').click();
    sheet().querySelector('[data-action="ball-edit-mode"][data-value="remove"]').click();
    assert(/Remove ball 0\.3/.test(sheet().textContent) && /Was a ball missed instead\?/.test(sheet().textContent) && !sheet().querySelector('[data-action="ball-edit-fill"][data-value=""]').disabled, "Remove asks whether a ball was missed; just removing is allowed at the break");
    assert(/Removing a legal ball/.test(sheet().textContent) && /every later over moves/.test(sheet().textContent), "just removing it: the preview says every later over moves");
    sheet().querySelector('[data-action="ball-edit-fill"][data-value="over"]').click();
    sheet().querySelector('[data-field="runs"][data-value="4"]').click();
    assert(/New ball 0\.6/.test(sheet().textContent) && /10-0 \(1\.3\) → 13-0 \(1\.3\)/.test(sheet().textContent) && !/every later over moves/.test(sheet().textContent), "the missing ball (a 4) at the end of over 1: overs as they were, 10 → 13");
    submit("ball-edit-form");
    assert(/Remove ball 0\.3 and add the missing one\?/.test(doc.querySelector("#confirm-root").textContent), "review names both changes");
    ok();
    assert(win.eval("state.match.status") === "innings_break" && win.eval("state.match.innings[0].runs") === 13 && win.eval("state.match.innings[0].legalBalls") === 9, "saved: still at the break, 13-0 in 1.3");

    // End innings → the break offers Reopen; after the chase finishes by hand, Result offers it too
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      state.snapshots = []; ui = defaultUi();
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu"); state.match.status = "live";
      handleBallClick(4); pushSnapshot(); endInnings(state.match); save(); render();`);
    let reopen = doc.querySelector('#app [data-action="reopen-innings"]');
    assert(reopen && /Reopen Lions' innings/.test(reopen.textContent) && !doc.querySelector('#app .go-back-row [data-action="undo"]'), "the innings break offers Reopen for an innings ended by hand");
    reopen.click(); ok();
    assert(win.eval("state.match.status") === "live" && win.eval("currentInnings(state.match).runs") === 4, "reopened: live again at 4-0");
    doc.querySelector('#app [data-action="undo"]').click();
    assert(win.eval("state.match.status") === "innings_break", "Undo takes the reopen back");
    win.eval(`startSecondInnings(state.match); openInnings(currentInnings(state.match), "Babar", "Rizwan", "Dushmantha"); state.match.status = "live";
      handleBallClick(2); pushSnapshot(); endInnings(state.match); maybeArchiveCompletedMatch(state.match); save(); render();`);
    const id = win.eval("state.match.archivedId");
    assert(id && /Lions won by 2 runs/.test(win.eval("state.match.result")), "(setup) chase closed at 2-0: Lions won by 2 runs, archived");
    reopen = doc.querySelector('#app [data-action="reopen-innings"][data-inn="1"]');
    assert(reopen && doc.querySelector('#app [data-action="reopen-innings"][data-inn="0"]'), "Result offers Reopen for both innings ended by hand");
    reopen.click();
    assert(/Match history keeps the old result/.test(doc.querySelector("#confirm-root").textContent), "the confirmation says the old result stays in history until it finishes again");
    ok();
    assert(win.eval("state.match.status") === "live" && win.eval("state.match.reopenedFrom") === id && win.eval(`state.matchHistory["${id}"].result`) === "Lions won by 2 runs", "the chase is live again; the archive keeps the old result meanwhile");
    win.eval(`handleBallClick(4);`);
    assert(win.eval("state.match.status") === "complete" && win.eval("state.match.archivedId") === id && /Tigers won/.test(win.eval(`state.matchHistory["${id}"].result`)) && win.eval("Object.keys(state.matchHistory).length") === 1, "finishing again replaces the same archive entry (no second copy)");
    // Undo on Result: back before the winning ball, then forward again
    const undo = doc.querySelector('#app .go-back-row [data-action="undo"]');
    assert(undo && /Undo last ball/.test(undo.textContent), "Result offers Undo for the ball that ended it");
    undo.click();
    assert(win.eval("state.match.status") === "live" && win.eval("state.match.reopenedFrom") === id && !win.eval("state.match.archivedId"), "Undo on Result: live again, still tied to its archive entry");
    win.eval(`handleBallClick(1);`);
    assert(win.eval("state.match.status") === "live", "(a single isn't enough)");
    win.eval(`handleBallClick(2);`);
    assert(win.eval("state.match.archivedId") === id && win.eval("Object.keys(state.matchHistory).length") === 1 && win.eval(`state.matchHistory["${id}"].innings[1].runs`) === 5, "finishing again still replaces the same entry");
    // a forfeit can be undone from Result too
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      state.snapshots = []; ui = defaultUi();
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu"); state.match.status = "live"; handleBallClick(1);
      pushSnapshot(); forfeitMatch(state.match, "B"); maybeArchiveCompletedMatch(state.match); save(); render();`);
    const fid = win.eval("state.match.archivedId");
    const undoF = doc.querySelector('#app .go-back-row [data-action="undo"]');
    assert(undoF && /Undo forfeit/.test(undoF.textContent) && !doc.querySelector('#app [data-action="reopen-innings"]'), "after a forfeit, Result offers Undo forfeit");
    undoF.click();
    assert(win.eval("state.match.status") === "live" && !win.eval("state.match.forfeited") && win.eval("state.match.reopenedFrom") === fid, "Undo forfeit: scoring carries on, tied to the archive entry");
    win.eval(`ui.matchMenu = null; askCancelMatch();`);
    assert(/match history keeps the result it had/.test(doc.querySelector("#confirm-root").textContent), "cancelling a reopened match says the old result stays in history");
    doc.querySelector('#confirm-root [data-action="confirm-cancel"]').click();
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); save(); render();`);
  }

  // --- rebuilding an innings' log from its scorecard (a match archived without its log) ---
  {
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 3, playersPerSide: 6, battingFirst: "A" });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1"); m.status = "live";
    const play = ev => { recordBall(currentInnings(m), ev); afterBall(m); };
    play({ kind: "run", runs: 1 }); play({ kind: "wide", runs: 2 }); play({ kind: "noball", runs: 4 });
    play({ kind: "bye", runs: 1 }); win.swapStrikeByHand(inn);
    play({ kind: "wicket", wicketType: "caught", fielder: "B7" }); win.sendInBatter(inn, "A3");
    play({ kind: "legbye", runs: 2 }); play({ kind: "run", runs: 0 }); play({ kind: "run", runs: 0 });
    win.setBowler(inn, "B2");
    play({ kind: "wicket", wicketType: "runout", runs: 1, endComingIn: "nonStriker", outEnd: "striker", fielder: "B8" }); win.sendInBatter(inn, "A4");
    play({ kind: "wicket", wicketType: "stumped", extra: "wide" }); win.sendInBatter(inn, "A5");
    play({ kind: "run", runs: 6 }); play({ kind: "wicket", wicketType: "runout", runs: 0, endComingIn: "striker", outEnd: "striker" }); win.sendInBatter(inn, "A6");
    play({ kind: "run", runs: 3 });
    win.endInnings(m);
    assert(m.status === "innings_break" && inn.wickets === 4, "(setup) every kind of ball, two run-outs, a hand swap, ended by hand");
    const archived = win.archivedCopy(m);
    const rebuilt = win.rebuildInningsFromScorecard(archived, 0);
    assert(rebuilt && win.inningsScorecardKey(rebuilt) === win.inningsScorecardKey(inn) && rebuilt.log && rebuilt.logBase, "the rebuilt innings has exactly the same scorecard, with a log");
    const editOf = (mm, n, ev) => win.replayMatch(mm, { inn: 0, seq: mm.innings[0].log.filter(a => a.t === "ball")[n].ev.seq, ev });
    const fromRebuilt = JSON.parse(JSON.stringify(archived)); fromRebuilt.innings[0] = rebuilt;
    [[0, { kind: "run", runs: 4 }], [5, { kind: "run", runs: 2 }], [8, null], [2, { kind: "wicket", wicketType: "bowled" }]].forEach(([n, ev]) => {
      const a = editOf(m, n, ev), b = editOf(fromRebuilt, n, ev);
      const key = r => r.match ? win.inningsScorecardKey(r.match.innings[0]) : JSON.stringify(r.need || r.error);
      assert(key(a) === key(b), `an edit of ball ${n + 1} gives the same innings from the rebuilt log as from the original`);
    });
    // a cloud copy: Postgres jsonb keeps object keys in its own order (shorter first)
    const jsonbOrder = v => Array.isArray(v) ? v.map(jsonbOrder) : v && typeof v === "object"
      ? Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).reduce((o, k) => { o[k] = jsonbOrder(v[k]); return o; }, {}) : v;
    const fromCloud = jsonbOrder(archived);
    assert(Object.keys(fromCloud.innings[0].extras).join() !== Object.keys(archived.innings[0].extras).join(), "(setup) the cloud copy's keys are in another order");
    const rebuiltCloud = win.rebuildInningsFromScorecard(fromCloud, 0);
    assert(rebuiltCloud && win.inningsScorecardKey(rebuiltCloud) === win.inningsScorecardKey(inn), "a cloud copy (keys in jsonb order) rebuilds too");
    assert(win.canonicalJson(fromCloud) === win.canonicalJson(archived), "canonicalJson ignores key order");
    const old = JSON.parse(JSON.stringify(archived));
    old.innings[0].overs[0].events.forEach(ev => { delete ev.batter; });
    assert(win.rebuildInningsFromScorecard(old, 0) === null, "balls that don't say who faced can't be rebuilt");
  }

  // --- UI: a finished match can be edited later, from its scorecard sheet in match history ---
  {
    const doc = win.document;
    const submit = id => doc.getElementById(id).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const ok = () => doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      { const m = state.match;
        openInnings(currentInnings(m), "Kusal", "Pathum", "Wanindu"); m.status = "live";
        for (let i = 0; i < 6; i++) handleBallClick(1);
        startSecondInnings(m); openInnings(currentInnings(m), "Babar", "Rizwan", "Dushmantha"); m.status = "live";
        for (let i = 0; i < 6; i++) handleBallClick(i === 5 ? 0 : 1);
      }
      render();`);
    const id = win.eval("state.match.archivedId");
    doc.querySelector('#app [data-action="finish-match"]').click();
    assert(!win.eval("state.match") && !win.eval(`state.matchHistory["${id}"].innings[0].log`) && win.eval(`!!matchLogStore()["${id}"]`), "(setup) Lions won by 1 run and the match was left; the archive has no log, the log store keeps it");
    win.eval(`openMatchDetail("${id}")`);
    const edit = doc.querySelector('#modal-root [data-action="edit-archived-match"]');
    assert(edit, "its scorecard sheet in match history offers Edit match");
    edit.click();
    assert(win.eval("state.match.editingFromHistory") === true && win.eval("state.match.archivedId") === id && !doc.querySelector("#modal-root .scorecard-modal"), "Edit match brings it back as the match on screen, tied to its archive entry");
    assert(doc.querySelectorAll('#app [data-action="edit-ball"]').length === 6 && /Editing from match history/.test(doc.getElementById("app").textContent) && /Done/.test(doc.querySelector('#app [data-action="finish-match"]').textContent) && !doc.querySelector("#app .confetti"), "Result opens on ball by ball with every ball editable, says it's editing history, exit reads Done, no confetti");
    doc.querySelector('#app [data-action="edit-ball"][data-label="0.6"]').click();
    doc.querySelector('#modal-root [data-field="runs"][data-value="2"]').click();
    submit("ball-edit-form"); ok();
    assert(win.eval(`state.matchHistory["${id}"].innings[1].runs`) === 7 && /Tigers won/.test(win.eval(`state.matchHistory["${id}"].result`)) && win.eval("Object.keys(state.matchHistory).length") === 1 && !win.eval(`state.matchHistory["${id}"].editingFromHistory`), "a ball changed: the archive entry (same id, no second copy) has the new score and result");
    win.eval(`handleUndo()`);
    assert(win.eval(`state.matchHistory["${id}"].innings[1].runs`) === 5 && /Lions won by 1 run/.test(win.eval(`state.matchHistory["${id}"].result`)), "Undo puts the archive entry back too");
    doc.querySelector('#app [data-action="finish-match"]').click();
    assert(!win.eval("state.match") && win.eval("state.view") === "home", "Done leaves it");

    // a match whose log wasn't kept is rebuilt from its scorecard, so its balls can still be edited
    win.eval(`delete matchLogStore()["${id}"]; openMatchDetail("${id}");`);
    doc.querySelector('#modal-root [data-action="edit-archived-match"]').click();
    assert(doc.querySelectorAll('#app [data-action="edit-ball"]').length === 6 && win.eval("!!state.match.innings[0].log && !!state.match.innings[1].log"), "without its kept log: both innings are rebuilt from the scorecard and every ball is editable");
    doc.querySelector('#app [data-action="finish-match"]').click();
    // a club match fixed in the cloud since (a name changed): the cloud copy is the one edited
    win.eval(`state.matchHistory["${id}"].clubId = "club1";
      window.__cloudCopy = JSON.parse(JSON.stringify(state.matchHistory["${id}"]).split("Kusal").join("Kusal Mendis"));
      window.__prevClient = supabaseClient; window.__prevSession = session;
      // A list query (Home loading this user's clubs after finish-match) gets an empty list:
      // without a then, fetchMyClubs threw, unnoticed until a later test waited on a timer.
      supabaseClient = { from: () => ({ select(){ return this; }, eq(){ return this; }, maybeSingle: async () => ({ data: { data: __cloudCopy }, error: null }),
        then: (ok, no) => Promise.resolve({ data: [], error: null }).then(ok, no) }) };
      session = { user: { id: "u1" } };
      outbox = [{ id: "q1", kind: "match", args: { id: "${id}" }, userId: "u1" }];`);
    await win.eval(`openMatchFromHistory("${id}")`);
    assert(win.eval("state.match.innings[0].batting.order.includes('Kusal')"), "with this match's own upload still queued, the local copy is edited");
    doc.querySelector('#app [data-action="finish-match"]').click();
    win.eval(`outbox = [];
      window.__cloudCopy = (function order(v){ return Array.isArray(v) ? v.map(order) : v && typeof v === "object"
        ? Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).reduce((o, k) => { o[k] = order(v[k]); return o; }, {}) : v; })(JSON.parse(JSON.stringify(state.matchHistory["${id}"])));
      keepMatchLogs("${id}", matchWithLogs("${id}"));`);
    await win.eval(`openMatchFromHistory("${id}")`);
    assert(win.eval(`!!matchLogStore()["${id}"]`) && win.eval("state.match.innings[0].batting.order.includes('Kusal')"), "the same match from the cloud, keys in another order: the local copy and its kept log stay");
    doc.querySelector('#app [data-action="finish-match"]').click();
    win.eval(`window.__cloudCopy = JSON.parse(JSON.stringify(state.matchHistory["${id}"]).split("Kusal").join("Kusal Mendis"));`);
    await win.eval(`openMatchFromHistory("${id}")`);
    assert(win.eval("state.match.innings[0].batting.order.includes('Kusal Mendis') && !state.match.innings[0].batting.order.includes('Kusal')") && win.eval(`state.matchHistory["${id}"].innings[0].batting.order[0]`) === "Kusal Mendis" && win.eval("!!state.match.innings[0].log") && doc.querySelectorAll('#app [data-action="edit-ball"]').length === 6, "otherwise the cloud's newer copy replaces the local one, and it's rebuilt for ball edits");
    doc.querySelector('#app [data-action="finish-match"]').click();
    win.eval(`supabaseClient = window.__prevClient; session = window.__prevSession; delete state.matchHistory["${id}"].clubId;`);

    // the sheet says why when it can't offer Edit match; a newer cloud copy is the one shown
    assert(/scored on another phone/.test(win.eval(`historyEditBlocked({ id: "elsewhere", innings: [] })`)) && /entered by hand/.test(win.eval(`historyEditBlocked({ id: "${id}", resultOnly: true })`)), "no Edit match: the sheet says why (another phone, result only)");
    const localName = win.eval(`state.matchHistory["${id}"].innings[0].batting.order[0]`);
    win.eval(`state.matchHistory["${id}"].clubId = "club1";
      ui.club = { id: "club1", matches: [{ id: "${id}", data: JSON.parse(JSON.stringify(state.matchHistory["${id}"]).split(${JSON.stringify(localName)}).join("Renamed In Cloud")) }] };`);
    assert(win.eval(`findCompletedMatch("${id}").innings[0].batting.order[0]`) === "Renamed In Cloud", "a club match's scorecard sheet shows the cloud copy when it differs");
    win.eval(`outbox = [{ id: "q2", kind: "match", args: { id: "${id}" }, userId: "u1" }];`);
    assert(win.eval(`findCompletedMatch("${id}").innings[0].batting.order[0]`) === localName, "...but this phone's own copy while its change is still waiting to upload");
    win.eval(`outbox = []; ui.club = null; delete state.matchHistory["${id}"].clubId;`);

    // one from an older app version (its balls don't say who faced): no ball edits, but the final score can still be set
    win.eval(`state.matchHistory["${id}"].innings.forEach(i => [...i.overs.flatMap(o => o.events), ...i.currentOverEvents].forEach(ev => { delete ev.kind; delete ev.batter; }));
      delete matchLogStore()["${id}"]; openMatchDetail("${id}");`);
    doc.querySelector('#modal-root [data-action="edit-archived-match"]').click();
    assert(!doc.querySelector('#app [data-action="edit-ball"]') && /Scored with an older version of the app/.test(doc.getElementById("app").textContent) && doc.querySelector('#app [data-action="open-score-set"]'), "an older match: no ball edits, a note says why, Set the final score is there");
    doc.querySelector('#app [data-action="finish-match"]').click();

    // not while another match is on screen
    win.eval(`state.match = createMatch({ teamA: "A", teamB: "B", oversLimit: 2, playersPerSide: 11, battingFirst: "A" }); ui.awayFromMatch = true; openMatchDetail("${id}");`);
    assert(!doc.querySelector('#modal-root [data-action="edit-archived-match"]') && /Finish or leave the match on screen first/.test(doc.getElementById("modal-root").textContent), "with a match going, the sheet says to finish it first");
    win.eval(`state.match = null; ui = defaultUi();`);

    // that older match with a score set by hand: its balls before it still can't be changed one by one
    win.eval(`{ const mm = matchWithLogs("${id}"); delete mm.id; delete mm.completedAt;
      state.match = setScoresByHand(mm, [{ runs: 20, wickets: 1, balls: 6 }, null]).match;
      ui = defaultUi(); ui.showFullScorecard = true; ui.scorecard = { inn: 0, mode: "balls" }; render(); }`);
    assert(/Balls before the score was set by hand can't be changed one by one/.test(doc.getElementById("app").textContent) && !doc.querySelector("#app .bbb-gap-add"), "an older hand-set innings: ball by ball says why its balls can't be edited");
    win.eval(`state.match = null; ui = defaultUi(); render();`);

    // a score set by hand now: the balls before it stay tappable, its row says how far they are from it, and a missed ball can be added before it
    win.eval(`{ ui = defaultUi(); state.snapshots = [];
      const mm = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(mm), "Kusal", "Pathum", "Wanindu"); mm.status = "live";
      [1, 2].forEach(n => { recordBall(currentInnings(mm), { kind: "run", runs: n }); afterBall(mm); });
      state.match = setScoresByHand(mm, [{ runs: 9, wickets: 0, balls: 4 }, null]).match;
      ui.liveScorecard = "innings_break"; ui.scorecard = { inn: 0, mode: "balls" }; render(); }`);
    const gapRow = doc.querySelector("#modal-root .bbb-gap");
    assert(doc.querySelectorAll('#modal-root [data-action="edit-ball"]').length === 2 && gapRow && /balls before it are 6 runs and 2 balls short/.test(gapRow.textContent)
      && !/can't be changed one by one/.test(doc.getElementById("modal-root").textContent), "hand-set: both balls before it are tappable and the gap row says 6 runs and 2 balls short");
    gapRow.querySelector('[data-action="add-ball"]').click();
    assert(/Add a ball after 0\.2/.test(doc.querySelector("#modal-root .modal").textContent), "+ Add a missed ball before it opens the add sheet after its last ball (0.2)");
    doc.querySelector('#modal-root [data-field="runs"][data-value="6"]').click();
    assert(/stays the same/.test(doc.querySelector("#modal-root .ball-edit-context").textContent) && /now 1 ball short/.test(doc.querySelector("#modal-root .ball-edit-context").textContent),
      "adding a six before it: the total stays 9-0, the preview says it's now 1 ball short");
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.eval("state.match.innings[0].runs") === 9 && win.eval("state.match.innings[0].overs.find(o => o.gap).gap.fromRuns") === 9 && /1 ball short/.test(doc.querySelector("#modal-root .bbb-gap").textContent),
      "saved: still 9-0, the balls now 9-0 in 0.3, one ball short");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); render();`);

    // a club match deleted in the cloud leaves this device when the club loads (supabase/015)
    win.eval(`{ const mk = () => { const mm = createMatch({ teamA: "Team A", teamB: "Team B", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
        openInnings(currentInnings(mm), "a", "b", "c"); mm.status = "complete"; mm.clubId = "club9"; return archiveMatch(mm).id; };
      window.__gone = mk(); window.__kept = mk();
      outbox = [{ id: "q9", kind: "match", args: { id: __gone }, userId: "u1" }];
      window.__prevClient = supabaseClient; window.__prevSession = session;
      session = { user: { id: "u1" } };
      const rows = { deleted_matches: [{ id: __gone }], clubs: { id: "club9", name: "KICC" } };
      const chain = table => { const c = { then: (ok, no) => Promise.resolve({ data: rows[table] || [], error: null }).then(ok, no) };
        ["select", "eq", "in", "order", "limit", "range", "single"].forEach(f => { c[f] = () => c; }); return c; };
      supabaseClient = { from: chain }; }`);
    await win.eval(`fetchClubDetail("club9")`);
    assert(!win.eval("state.matchHistory[__gone]") && win.eval("!!state.matchHistory[__kept]") && !win.eval("matchLogStore()[__gone]") && win.eval("outbox.length") === 0, "a deleted club match leaves the archive, its kept log and its queued upload; the others stay");
    win.eval(`supabaseClient = window.__prevClient; session = window.__prevSession; ui.club = null; outbox = [];`);

    // every one of a club's cloud matches loads, a page at a time (it used to stop at the newest 50)
    win.eval(`{ window.__prevClient = supabaseClient; window.__prevSession = session; session = { user: { id: "u1" } };
      const n = CLUB_MATCH_PAGE * 2 + 7;
      const all = Array.from({ length: n }, (_, i) => ({ id: "cm" + i, match_type: "practice", played_at: new Date(n - i).toISOString(),
        data: { id: "cm" + i, teamA: "A", teamB: "B", completedAt: n - i, clubId: "club8", innings: [] } }));
      window.__pages = 0;
      const chain = table => { let from = 0, to = Infinity, count = false;
        const c = { then: (ok, no) => Promise.resolve(table === "matches"
          ? (__pages++, { data: all.slice(from, to + 1), count: count ? all.length : null, error: null })
          : { data: table === "clubs" ? { id: "club8", name: "KICC" } : [], error: null }).then(ok, no) };
        ["eq", "in", "order", "limit", "single"].forEach(f => { c[f] = () => c; });
        c.select = (cols, opts) => { count = !!(opts && opts.count); return c; };
        c.range = (a, b) => { from = a; to = b; return c; };
        return c; };
      supabaseClient = { from: chain }; }`);
    await win.eval(`fetchClubDetail("club8")`);
    assert(win.eval("ui.club.matches.length") === win.eval("CLUB_MATCH_PAGE * 2 + 7") && win.eval("new Set(clubMatchesFor('club8').map(m => m.id)).size") === win.eval("CLUB_MATCH_PAGE * 2 + 7")
      && win.eval("__pages") === 3 && win.eval("ui.club.matches[0].id") === "cm0", "a club with more matches than a page loads every one, newest first, in 3 pages");

    // offline it still has every one: the read cache keeps the newest 30, IndexedDB (clubMatchStore) all of them
    win.eval(`{ const data = new Map(), copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
      const tx = () => { const t = {}; const later = (r, f) => { setTimeout(() => { f(); t.oncomplete && t.oncomplete(); }); return r; };
        t.objectStore = () => ({ get: k => { const r = {}; return later(r, () => { r.result = copy(data.get(k)); }); },
          put: (v, k) => { data.set(k, copy(v)); const r = {}; return later(r, () => { r.result = k; }); },
          clear: () => { data.clear(); return later({}, () => {}); } });
        return t; };
      window.indexedDB = { open: () => { const req = {}; setTimeout(() => { req.result = { createObjectStore(){}, transaction: tx }; req.onupgradeneeded(); req.onsuccess(); }); return req; } };
      window.__idb = data; }`);
    await win.eval(`fetchClubDetail("club8")`);
    win.eval(`session = { user: { id: "u1" }, offline: true }; window.__pages = 0;`);
    await win.eval(`fetchClubDetail("club8")`);
    assert(win.eval("cloudCache.clubs.club8.matches.length") === 30 && win.eval("ui.club.fromCache") === true && win.eval("__pages") === 0
      && win.eval("ui.club.matches.length") === win.eval("CLUB_MATCH_PAGE * 2 + 7") && win.eval("ui.club.matches[0].id + ui.club.matches.at(-1).id") === "cm0cm206",
      "offline, a club shows every match from IndexedDB, newest first, while localStorage keeps only the newest 30");
    win.eval(`cloudCache.clubs.club8.deletedMatchIds = ["cm150"];`);
    await win.eval(`fetchClubDetail("club8")`);
    assert(win.eval("ui.club.matches.length") === win.eval("CLUB_MATCH_PAGE * 2 + 6") && !win.eval("ui.club.matches.some(m => m.id === 'cm150')"), "offline, a match the cloud has deleted stays out");
    win.eval(`__idb.get("club8").userId = "someone else";`);
    await win.eval(`fetchClubDetail("club8")`);
    assert(win.eval("ui.club.matches.length") === 30, "another account's stored matches aren't used: just the read cache's 30");
    win.eval(`delete window.indexedDB; delete window.__idb;`);
    win.eval(`supabaseClient = window.__prevClient; session = window.__prevSession; ui.club = null;`);

    // only the newest matches keep their logs
    win.eval(`for (let i = 0; i < MATCH_LOGS_KEEP + 3; i++){ const mm = createMatch({ teamA: "X", teamB: "Y", oversLimit: 1, playersPerSide: 11, battingFirst: "A" }); openInnings(currentInnings(mm), "a", "b", "c"); mm.status = "complete"; archiveMatch(mm); }`);
    assert(win.eval("Object.keys(matchLogStore()).length") === win.eval("MATCH_LOGS_KEEP"), "only MATCH_LOGS_KEEP matches keep their logs");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); save(); render();`);
  }

  // --- MVP points presets on screen; leaderboards list everyone and sort ---
  {
    const doc = win.document;
    // An old save (no pointsPresets) gets the built-ins, with the default in use.
    win.eval(`{ const d = JSON.parse(JSON.stringify(state)); delete d.pointsPresets; delete d.pointsPresetId; DB.save(STORAGE_KEY, d); load(); }`);
    assert(win.eval("Object.keys(state.pointsPresets).join()") === "points-club,points-classic,points-fantasy,points-ipl" && win.eval("guestPointsPreset().id") === "points-club", "an old save gets the built-in points presets, Club in use");

    win.eval(`state.match = null; ui = defaultUi(); state.view = "presets"; ui.presetsTab = "points"; render();`);
    const cards = () => [...doc.querySelectorAll("#app .preset-row")];
    assert(cards().length === 4 && cards()[0].classList.contains("in-use") && /IN USE/.test(cards()[0].textContent) && !cards()[0].querySelector('[data-action="use-points-preset"]'), "Presets → MVP points: the built-ins, Club marked in use");
    doc.querySelector('#app [data-action="use-points-preset"][data-id="points-classic"]').click();
    assert(win.eval("state.pointsPresetId") === "points-classic" && cards()[1].classList.contains("in-use"), "Use switches the preset that counts");
    doc.querySelector('#app [data-action="new-points-preset"]').click();
    const form = () => doc.getElementById("points-preset-form");
    assert(form() && form().querySelector('input[name="perWicket"]').value === "15", "a new points preset starts from the default's numbers");
    form().querySelector('input[name="name"]').value = "Sunday league";
    doc.querySelector('#app [data-action="points-template"][data-id="points-ipl"]').click();
    assert(form().querySelector('input[name="perDot"]').value === "1" && form().querySelector('input[name="name"]').value === "Sunday league", "Fill in from IPL MVP: its numbers, the typed name kept");
    form().querySelector('input[name="perRun"]').value = "0.5";
    form().querySelector('input[name="economyOn"]').checked = true;
    form().querySelector('input[name="economyBelow0"]').value = "6";
    form().querySelector('input[name="economyPts0"]').value = "3";
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const saved = win.eval(`Object.values(state.pointsPresets).find(p => p.name === "Sunday league")`);
    assert(saved && saved.perRun === 0.5 && saved.perDot === 1 && saved.economy.minOvers === 2 && saved.economy.bands.length === 1 && saved.economy.bands[0].below === 6 && saved.economy.bands[0].from === null && saved.economy.bands[0].pts === 3 && saved.strikeRate === null && !form(), "the editor saves every value, decimals and bands included");
    doc.querySelector(`#app [data-action="edit-points-preset"][data-id="${saved.id}"]`).click();
    form().querySelector('input[name="economyBelow0"]').value = "";
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(form() && /fill in From, Below or both/.test(form().querySelector(".form-error").textContent), "a band with no range is refused with a message");
    // Milestone lists: rows added and taken away, what was typed kept through both.
    win.eval(`ui.editingPointsPreset = null; render();`);
    assert(/20 \+2/.test(cards()[0].textContent) && /hat-trick 20/.test(cards()[0].textContent), "Club's card lists its 20 milestone and the hat-trick");
    doc.querySelector('#app [data-action="new-points-preset"]').click();
    const atRows = list => [...form().querySelectorAll(`input[name^="${list}At"]`)].map(i => i.value).join();
    assert(atRows("battingMilestones") === "20,30,50,100" && atRows("wicketHauls") === "" && form().querySelector('input[name="hatTrick"]').value === "20", "a new preset starts with Club's milestones (20, 30, 50, 100) and hat-trick");
    form().querySelector('input[name="name"]').value = "Short games";
    form().querySelector('input[name="perMaiden"]').value = "12";
    form().querySelector('[data-action="points-row-add"][data-list="battingMilestones"]').click();
    form().querySelector('input[name="battingMilestonesAt4"]').value = "25";
    form().querySelector('input[name="battingMilestonesPts4"]').value = "3";
    form().querySelector('[data-action="points-row-remove"][data-list="battingMilestones"][data-i="1"]').click();
    assert(atRows("battingMilestones") === "20,50,100,25" && form().querySelector('input[name="name"]').value === "Short games" && form().querySelector('input[name="perMaiden"]').value === "12",
      "+ Add a milestone and ✕ keep what was typed: " + atRows("battingMilestones"));
    form().querySelector('[data-action="points-row-add"][data-list="wicketHauls"]').click();
    form().querySelector('input[name="wicketHaulsAt0"]').value = "2";
    form().querySelector('input[name="wicketHaulsPts0"]').value = "4";
    form().querySelector('[data-action="points-row-add"][data-list="wicketHauls"]').click();   // left blank: dropped on save
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const short = win.eval(`Object.values(state.pointsPresets).find(p => p.name === "Short games")`);
    assert(short && short.battingMilestones.map(t => t.at + ":" + t.pts).join() === "20:2,25:3,50:8,100:16" && short.wicketHauls.length === 1 && short.wicketHauls[0].at === 2 && short.wicketHauls[0].pts === 4
      && short.perMaiden === 12 && short.hatTrick === 20 && short.economy.minOvers === 1 && short.economy.bands.length === 3 && !("on" in short.economy) && !form(),
      "saved: milestones lowest first, the haul (a blank row left out), Club's hat-trick and economy");
    assert(short.thirty === 0 && short.fifty === 8 && short.century === 16 && short.threeWickets === 0 && short.fourWickets === 0
      && calcPlayerPoints({ runs: 27, balls: 20, out: true, fours: 0, sixes: 0 }, null, null, short) === 30,
      "...with the old fixed 30/50/100 and 3/4/5-wicket values written too, for app versions that only read those (this one reads the lists)");
    doc.querySelector(`#app [data-action="edit-points-preset"][data-id="${short.id}"]`).click();
    form().querySelector('input[name="battingMilestonesPts1"]').value = "";
    form().querySelector('input[name="battingMilestonesAt1"]').value = "";
    form().querySelector('input[name="wicketHaulsAt0"]').value = "";
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(form() && /Wicket haul 1: fill in the wickets/.test(form().querySelector(".form-error").textContent), "a haul with points but no wickets is refused with a message");
    // A preset saved before the lists opens with its fixed milestones as rows.
    win.eval(`ui.editingPointsPreset = null; state.pointsPresets.old1 = { id: "old1", name: "Old one", perRun: 1, thirty: 4, fifty: 8, century: 0, perWicket: 10, threeWickets: 5 }; render();`);
    assert(/30 \+4/.test(cards().find(c => /Old one/.test(c.textContent)).textContent), "an old preset's card shows its milestones");
    doc.querySelector('#app [data-action="edit-points-preset"][data-id="old1"]').click();
    assert(atRows("battingMilestones") === "30,50" && atRows("wicketHauls") === "3", "an old preset opens with its milestones and hauls as rows (the ones worth points)");
    win.eval(`delete state.pointsPresets.old1; delete state.pointsPresets[${JSON.stringify(short.id)}];`);
    win.eval(`ui.editingPointsPreset = null; state.pointsPresetId = "points-club"; render();`);

    // A guest match with 11 batters: everyone is listed, not a top 10.
    win.eval(`{ const mm = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, ballsPerOver: 30, playersPerSide: 11, battingFirst: "A" });
      const inn = currentInnings(mm); openInnings(inn, "Bat01", "Bat02", "Bowler");
      for (let i = 3; i <= 11; i++){ recordBall(inn, { kind: "run", runs: i % 4 }); recordBall(inn, { kind: "wicket", wicketType: "bowled" }); sendInBatter(inn, "Bat" + String(i).padStart(2, "0")); }
      mm.status = "complete"; state.matchHistory = {}; archiveMatch(mm); }
      ui = defaultUi(); state.view = "stats"; ui.statsTab = "bat"; render();`);
    const rows = () => [...doc.querySelectorAll("#app .lb-table tbody tr")].map(tr => tr.querySelector(".lb-name").textContent.replace(/^\d+/, ""));
    assert(rows().length === 11 && doc.querySelectorAll("#app .lb-table thead th").length === 16, "Batting lists all 11 batters with every column (M, Inn, NO, R, B, HS, Avg, SR, 4s, 6s, 50s, 100s, 0s, Last 5, Rtg)");
    const head = key => doc.querySelector(`#app .sort-btn[data-key="${key}"]`);
    assert(head("runs").classList.contains("on") && head("runs").closest("th").getAttribute("aria-sort") === "descending", "sorted by runs, most first, by default");
    head("name").click();
    assert(rows()[0] === "Bat01" && rows()[10] === "Bat11" && head("name").closest("th").getAttribute("aria-sort") === "ascending", "tapping Player sorts A to Z");
    head("name").click();
    assert(rows()[0] === "Bat11" && head("name").closest("th").getAttribute("aria-sort") === "descending", "tapping it again flips it");
    win.eval(`ui.statsTab = "bowl"; render();`);
    assert(rows().join() === "Bowler" && doc.querySelector('#app .sort-btn[data-key="dots"]'), "Bowling lists everyone who bowled, with dot balls");
    head("economy").click();
    assert(head("economy").closest("th").getAttribute("aria-sort") === "ascending", "economy sorts lowest first (best first)");
    win.eval(`ui.statsTab = "mvp"; render();`);
    assert(/Counted with the Club points/.test(doc.querySelector("#app .leaderboard.mvp").textContent) && doc.querySelector('#app .preset-info-btn[data-kind="points"]') && rows().length === 12, "the MVP table says which points count it (with an ⓘ) and lists everyone");
    doc.querySelector('#app .preset-info-btn[data-kind="points"]').click();
    assert(/15 a wicket/.test(doc.querySelector("#app .preset-info").textContent), "the ⓘ spells the points out");
    const premierHtml = win.eval(`renderLeaderboards(aggregatePlayerStats(Object.values(state.matchHistory)), { points: null })`);
    assert(!/data-tab="mvp"/.test(premierHtml) && /data-tab="bat"/.test(premierHtml) && !/Pts/.test(premierHtml), "with no points preset (Premier) there's no MVP table, just stats");

    // A club's points preset: the one marked in use, else its first, else the built-in default.
    win.eval(`ui.club = { id: "c1", presets: { match: [], tournament: [], points: [{ id: "p1", name: "A" }, { id: "p2", name: "B", inUse: true }] } };`);
    assert(win.eval(`clubPointsPreset("c1").id`) === "p2" && win.eval(`pointsPresetFor({ clubId: "c1" }).id`) === "p2", "club: the preset marked in use counts");
    win.eval(`ui.club.presets.points[1].inUse = false;`);
    assert(win.eval(`clubPointsPreset("c1").id`) === "p1", "club: none marked, its first");
    win.eval(`ui.club.presets.points = [];`);
    assert(win.eval(`clubPointsPreset("c1").id`) === "points-club" && win.eval(`clubPointsPreset("other").id`) === "points-club", "club: none of its own, the built-in default");
    const ov = win.overlayClubData({ id: "c1", presets: { match: [], tournament: [] } }, [{ kind: "preset.save", args: { id: "p9", clubId: "c1", kind: "points", preset: { name: "Ours", perRun: 2 } } }]);
    assert(ov.presets.points.length === 1 && ov.presets.points[0].pending && ov.presets.points[0].perRun === 2, "overlay: a points preset saved offline shows (cache from before points presets)");
    win.eval(`ui = defaultUi(); state.matchHistory = {}; state.view = "home"; save(); render();`);
  }

  // --- a club tournament's public page (#/t/<id>, "Share link") ---
  {
    const doc = win.document;
    assert(win.eval(`JSON.stringify(parseRoute("/t/abc-1"))`) === JSON.stringify({ view: "publicTournament", params: { pt: "abc-1" } })
      && win.eval(`buildRoute("publicTournament", { pt: "abc-1" })`) === "/t/abc-1", "#/t/<id> is the public page's route, both ways");
    win.eval(`{ const mm = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
        openInnings(currentInnings(mm), "a", "b", "c"); mm.status = "complete"; mm.result = "Lions won"; mm.clubId = "c1"; mm.id = "pm1";
      window.__pub = { tournaments: { id: "t1", name: "Sunday Cup", organizer_club_id: "c1", tournament_preset: { pointsForWin: 2, endedAt: 1 }, clubs: { name: "KICC" } },
        matches: [{ id: "pm1", data: JSON.parse(JSON.stringify(mm)) }] };
      window.__rpc = { data: { id: "pp1", name: "Ours", perRun: 2 }, error: null };
      window.__prevClient = supabaseClient; window.__prevSession = session; session = null;
      const chain = table => { const c = { then: (ok, no) => Promise.resolve({ data: __pub[table], error: null }).then(ok, no) };
        ["select", "eq", "order", "maybeSingle"].forEach(f => { c[f] = () => c; }); return c; };
      supabaseClient = { from: chain, rpc: async () => __rpc }; }`);
    let pt = await win.eval(`fetchPublicTournament("t1")`);
    assert(pt.name === "Sunday Cup" && pt.clubName === "KICC" && pt.matches.length === 1 && pt.points.id === "pp1", "signed out, it loads the tournament, its club's name, matches and points preset");
    win.eval(`__rpc = { data: null, error: null };`);
    pt = await win.eval(`fetchPublicTournament("t1")`);
    assert(pt.points.id === "points-club", "a club with no points preset of its own: the built-in default, as for members");
    win.eval(`__rpc = { data: null, error: { code: "PGRST202" } };`);
    pt = await win.eval(`fetchPublicTournament("t1")`);
    assert(pt.points === null, "supabase/017 not run: no points preset (so no MVP)");
    win.eval(`__pub.tournaments = null;`);
    assert((await win.eval(`fetchPublicTournament("nope")`)).missing === true, "a wrong id: not found");
    win.eval(`__pub.tournaments = { id: "t1", name: "Sunday Cup", organizer_club_id: "c1", tournament_preset: { endedAt: 1 }, clubs: { name: "KICC" } }; __rpc = { data: null, error: null };`);

    win.eval(`ui = defaultUi(); applyRoute("/t/t1"); render();`);
    await wait(20);
    assert(win.eval("state.view") === "publicTournament" && /Sunday Cup/.test(doc.querySelector("#app h1").textContent)
      && [...doc.querySelectorAll('#app [data-action="switch-tournament-tab"]')].map(b => b.dataset.tab).join() === "summary,overview,fixtures,stats",
      "the link opens the page: Summary (it ended), Overview, Fixtures, Stats — no Teams");
    assert(!doc.querySelector('#app [data-action="reopen-tournament"]') && !doc.querySelector('#app [data-action="manage-public-tournament"]'), "read only: no Reopen, and no Manage for a visitor");
    win.eval(`openMatchDetail("pm1");`);
    assert(doc.querySelector("#modal-root .scorecard-modal") && !/another phone/.test(doc.querySelector("#modal-root .scorecard-modal").textContent), "a result opens its scorecard, with no edit note");
    win.eval(`ui.matchDetail = null; askShareTournamentLink();`);
    assert(doc.querySelector("#confirm-root .share-link-input").value.endsWith("#/t/t1"), "Share link shows the page's own link");
    win.eval(`ui.confirm = null; ui.myClubs = [{ id: "c1", name: "KICC" }]; render();`);
    assert(doc.querySelector('#app [data-action="manage-public-tournament"]'), "a member of the club gets Manage");
    win.eval(`supabaseClient = window.__prevClient; session = window.__prevSession; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- visiting teams in club tournaments (supabase/018), and lending club players to visitors ---
  {
    const doc = win.document;
    const m = createMatch({ teamA: "Reds", teamB: "Visitors", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
    assert(!win.isVisitingSide(m, "B"), "a guest match has no visiting side");
    m.clubId = "c1"; m.matchType = "friendly";
    assert(win.isVisitingSide(m, "B") && !win.isVisitingSide(m, "A"), "a club friendly's team B is the visiting side");
    m.matchType = "tournament"; m.visitingSides = ["B"];
    assert(win.isVisitingSide(m, "B") && !win.isVisitingSide(m, "A"), "a tournament side saved as a visiting team is visiting");
    const r = win.restartMatch(m, "B");
    assert(r.visitingSides && r.visitingSides[0] === "B" && r.visitingSides !== m.visitingSides, "a restart keeps the visiting sides (copied)");

    const save = { id: "x", kind: "team.save", userId: "u1", createdAt: 1, failed: false, args: { id: "v1", tournamentId: "T", name: "Galle", players: [{ id: "guest:amal", name: "Amal", guest: true }], visiting: true } };
    const ov = win.overlayTournamentData({ id: "T", name: "Cup", tournament_preset: {}, matches: [], teams: [] }, [save], [], "T");
    assert(ov.teams[0].visiting === true && ov.teams[0].pending, "overlay: a visiting team saved offline stays a visiting team");
    assert(/Visiting team “Galle”/.test(win.describeOp(save)), "the sync sheet calls it a visiting team");
    assert(win.eval(`visitingColumnMissing({ code: "PGRST204", message: "Could not find the 'visiting' column of 'tournament_teams' in the schema cache" })`)
      && win.eval(`visitingColumnMissing({ code: "42703", message: "column tournament_teams.visiting does not exist" })`)
      && !win.eval(`visitingColumnMissing({ code: "42703", message: "column players.nickname does not exist" })`) && !win.eval(`visitingColumnMissing(null)`),
      "018 not run is recognised from a select or a write, and nothing else is");

    // The builder: "＋ Visiting team", visitors typed (several at once), a club player lent.
    win.eval(`state.match = null; window.__prevSession = session; session = { user: { id: "u1" } };
      window.__saved = []; window.__prevSave = saveTournamentTeam; window.__prevFetch = fetchClubTournamentDetail;
      saveTournamentTeam = async (t, team) => { __saved.push(JSON.parse(JSON.stringify(team))); return { ok: true }; };
      fetchClubTournamentDetail = async () => {};
      ui = defaultUi(); ui.currentClubId = "c1"; ui.currentTournamentId = "T"; ui.tournamentTab = "teams";
      ui.club = { id: "c1", name: "KICC", roster: [{ id: "p1", name: "Kusal" }, { id: "p2", name: "Dasun" }, { id: "p3", name: "Pathum" }], members: [], matches: [], tournaments: [], presets: { match: [], tournament: [] } };
      ui.clubTournament = { id: "T", name: "Cup", organizer_club_id: "c1", tournament_preset: {}, matches: [], teams: [{ id: "t1", name: "Reds", players: [{ id: "p1", name: "Kusal" }] }] };
      state.view = "clubTournamentDashboard"; render();`);
    doc.querySelector('#app [data-action="new-tournament-team"][data-visiting="1"]').click();
    const form = () => doc.getElementById("tournament-team-form");
    assert(form() && form().querySelector('[name="teamName"]').value === "Visitors" && form().querySelector('[name="teamKind"][value="visiting"]').checked
      && /Lend a club player/.test(form().textContent) && !form().querySelector('[data-action="team-builder-add-free"]'),
      "＋ Visiting team opens the builder as a visiting team: named Visitors, a lend list, no '+ All free'");
    const box = form().querySelector(".team-builder-search");
    box.value = "Amal, Nimal Silva, dasun, kusal, amal";
    box.dispatchEvent(new win.Event("input", { bubbles: true }));
    assert(/as visitors/.test(form().querySelector(".builder-add-title").textContent), "the add card follows the box: several names are visitors");
    box.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const edit = win.eval(`JSON.stringify(ui.tournamentTeamEdit)`);
    const e1 = JSON.parse(edit);
    assert(JSON.stringify(e1.playerIds) === JSON.stringify(["guest:amal", "guest:nimal silva", "p2"]), "Enter adds each visitor once, and a roster name is that club player, lent");
    assert(/2 visitors added/.test(e1.notice.text) && /Dasun is on the club roster/.test(e1.notice.text) && /Kusal \(Reds\)/.test(e1.notice.text), "the notice says who was added, lent, or is on another team");
    assert(form().querySelector(".team-builder-search").value === "" && [...form().querySelectorAll(".team-roster.picked .guest-tag.lent")].length === 1,
      "the box is cleared for the next name; the lent club player is tagged 'club'");
    form().querySelector('[name="teamName"]').value = "Galle CC";
    form().querySelector('[name="teamName"]').dispatchEvent(new win.Event("input", { bubbles: true }));
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await wait(20);
    const saved = win.__saved[0];
    assert(saved && saved.visiting === true && saved.name === "Galle CC" && saved.players.length === 3
      && saved.players[0].guest === true && saved.players[2].id === "p2" && !saved.players[2].guest, "Save stores a visiting team: visitors as guests, the lent player by id");

    // An existing team's kind can be switched; a team giving up a player keeps its own kind.
    win.eval(`ui.clubTournament.teams.push({ id: "t2", name: "Galle CC", visiting: true, players: [{ id: "guest:amal", name: "Amal", guest: true }, { id: "p3", name: "Pathum" }] });
      __saved = []; ui.tournamentTeamEdit = teamEditState("t1", "Reds", ["p1", "p3"], false); render();`);
    await win.eval(`handleTournamentTeamSubmit({ preventDefault(){}, target: document.getElementById("tournament-team-form") })`);
    assert(win.__saved.length === 2 && win.__saved[0].id === "t2" && win.__saved[0].visiting === true && win.__saved[1].visiting === false,
      "moving a lent player back saves the visiting team as still visiting");
    win.eval(`ui.tournamentTeamEdit = teamEditState("t1", "Reds", ["p1"], false); render();`);
    const kind = form().querySelector('[name="teamKind"][value="visiting"]');
    kind.checked = true; kind.dispatchEvent(new win.Event("change", { bubbles: true }));
    assert(win.eval(`ui.tournamentTeamEdit.visiting`) === true && win.eval(`teamEditDirty(ui.tournamentTeamEdit)`) && /Add visitors/.test(form().textContent), "a club side can be made a visiting team (and that's an unsaved change)");
    win.eval(`ui.clubTournament.visiting_unavailable = true; render();`);
    form().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/018_visiting_teams\.sql/.test(form().querySelector(".form-error").textContent), "018 not run: a visiting team can't be saved, and says why");
    win.eval(`ui.tournamentTeamEdit = null; render();`);
    assert(/Visitors/.test(doc.querySelector("#app .team-card.visiting .visitors-tag").textContent), "the Teams tab tags a visiting team");

    // Scoring: a visiting team's people are never stored in the club; lending works both ways.
    win.eval(`window.__calls = []; window.__prevClient = supabaseClient; supabaseClient = {};
      window.__prevAdd = addPlayerToClub; window.__prevGlobal = addGlobalPlayer;
      addPlayerToClub = async (c, n) => { __calls.push(["club", n]); return {}; };
      addGlobalPlayer = async (n) => { __calls.push(["global", n]); return {}; };
      state.match = createMatch({ teamA: "Reds", teamB: "Galle CC", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      Object.assign(state.match, { clubId: "c1", matchType: "tournament", tournamentId: "T", squads: { A: ["Kusal"], B: ["Amal", "Dasun"] }, guestNames: ["Amal"], visitingSides: ["B"] });
      registerMatchPlayer("Amal", "B"); registerMatchPlayer("Dasun", "B"); registerMatchPlayer("Late Visitor", "B"); registerMatchPlayer("New Clubber", "A");`);
    assert(JSON.stringify(win.__calls) === JSON.stringify([["club", "New Clubber"]]), "tournament: visitors, lent club players and a visitor typed while scoring aren't stored; a new club-side name joins the roster");
    assert(win.eval(`unlistedNames(state.match, [{ name: "Late Visitor", teamKey: "B" }]).length`) === 1 && !win.eval(`lendOnlySide(state.match, "B")`),
      "a visiting team with a squad still asks about a typed name (a typo check)");
    win.eval(`confirmUnlisted(state.match, [{ name: "Late Visitor", teamKey: "B" }], () => {});`);
    assert(/as a visitor \(not added to the club\)/.test(doc.querySelector("#confirm-root").textContent), "...and says they'll play as a visitor");
    win.eval(`ui.confirm = null; __calls = []; ui.club.roster = ui.club.roster.filter(p => p.id);   // drop "New Clubber", queued above
      state.match = createMatch({ teamA: "KICC", teamB: "Visitors", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      Object.assign(state.match, { clubId: "c1", matchType: "friendly" });
      registerMatchPlayer("Visitor X", "B"); registerMatchPlayer("Dasun", "B");`);
    assert(JSON.stringify(win.__calls) === JSON.stringify([["global", "Visitor X"]]), "friendly: a visitor is recorded on the platform, a lent club player isn't re-added");
    assert(win.eval(`JSON.stringify(pickCandidates(state.match, pickPool("B"), "bowler"))`) === JSON.stringify(["Kusal", "Dasun", "Pathum"])
      && win.eval(`lendOnlySide(state.match, "B")`) && win.eval(`unlistedNames(state.match, [{ name: "Visitor Y", teamKey: "B" }]).length`) === 0,
      "friendly: the visitors can be lent any club player, and typing a visitor's name never asks");
    win.eval(`{ const inn = currentInnings(state.match); openInnings(inn, "Kusal", "Pathum", "Visitor X"); inn.bowler = null; }
      state.match.status = "live"; render();`);
    assert(/Lend a club player/.test(doc.querySelector("#modal-root").textContent) && /Dasun/.test(doc.querySelector("#modal-root").textContent),
      "the visitors' new-bowler sheet lists club players to lend");
    assert(win.eval(`JSON.stringify(pickCandidates(state.match, pickPool("B"), "bowler"))`) === JSON.stringify(["Dasun"]), "...minus anyone batting for the club");
    win.eval(`supabaseClient = window.__prevClient; session = window.__prevSession; addPlayerToClub = __prevAdd; addGlobalPlayer = __prevGlobal;
      saveTournamentTeam = __prevSave; fetchClubTournamentDetail = __prevFetch;
      state.match = null; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- retired hurt: not out, not a wicket, and back in later to carry on ---
  {
    const doc = win.document;
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 4, battingFirst: "A" });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1");
    m.status = "live";
    const play = ev => { recordBall(inn, ev); afterBall(m); };
    play({ kind: "run", runs: 4 }); play({ kind: "run", runs: 1 });   // A1 5 (2), A2 now on strike
    assert(win.retireBatter(inn, "nonStriker", "hurt"), "a batter at the crease can retire");
    const a1 = inn.batting.stats.A1;
    assert(inn.nonStriker === null && inn.striker === "A2" && win.pendingBatsmanSlot(inn) === "nonStriker", "retiring empties their end, and the new batter is asked for there");
    assert(inn.wickets === 0 && inn.fallOfWickets.length === 0 && inn.legalBalls === 2 && inn.runs === 5, "retiring isn't a wicket or a ball");
    assert(!a1.out && a1.retired === "hurt" && a1.howOut === "retired hurt" && win.batterStatusText(a1) === "retired hurt", "the retired batter is not out, retired hurt");
    assert(JSON.stringify(win.retiredBatters(inn, true)) === "[]" && JSON.stringify(win.retiredBatters(inn)) === JSON.stringify(["A1"]),
      "a batter can't come straight back into the gap their own retirement left");
    assert(JSON.stringify(win.pickCandidates(m, ["A1", "A3", "A4"], "batter")) === JSON.stringify(["A3", "A4"]), "a retired batter isn't listed with those yet to bat");
    win.sendInBatter(inn, "A3");
    assert(JSON.stringify(win.partnershipBase(inn)) === JSON.stringify({ score: 5, balls: 2 }), "the partnership starts again from the retirement");
    play({ kind: "run", runs: 0 }); play({ kind: "wicket", wicketType: "bowled" });   // A2 out
    assert(JSON.stringify(win.retiredBatters(inn, true)) === JSON.stringify(["A1"]), "after a wicket the retired batter can come back in");
    win.sendInBatter(inn, "A1");
    play({ kind: "run", runs: 2 });
    assert(inn.striker === "A1" && !a1.retired && a1.howOut === null && a1.runs === 7 && a1.balls === 3, "back in, their innings carries on from where it stopped");
    assert(inn.batting.order.join() === "A1,A2,A3", "...and they bat once on the scorecard");
    assert(JSON.stringify(inn.retirements.map(t => [t.type, t.name, t.at, t.score])) === JSON.stringify([["retire", "A1", 2, 5], ["back", "A1", 4, 5]]),
      "retirements and returns are kept in order, with the ball they came before");
    const comm = win.inningsCommentary(inn);
    const kinds = comm.map(l => l.type === "retire" ? (l.back ? "back" : "ret") : l.type === "ball" ? l.display : l.type).join(" ");
    assert(kinds === "4 1 ret 0 W back 2", `commentary puts the retirement and the return between the right balls, got: ${kinds}`);
    assert(comm.find(l => l.type === "retire").text === "A1 retired hurt" && comm.find(l => l.back).figures === "5 (2)", "...saying who, why and their score");

    // A ball edited before the retirement: the retirement and the return replay.
    const seqOf = n => inn.log.filter(a => a.t === "ball")[n].ev.seq;
    let r = win.replayMatch(m, { inn: 0, seq: seqOf(0), ev: { kind: "run", runs: 6 } });
    let ni = r.match && r.match.innings[0];
    assert(ni && ni.batting.stats.A1.runs === 9 && !ni.batting.stats.A1.retired && ni.retirements[0].runs === 7 && ni.striker === "A1",
      "a ball edited before a retirement replays it, and the return");
    // ... and one that has A1 out before they retired drops the retirement (and the return).
    r = win.replayMatch(m, { inn: 0, seq: seqOf(1), ev: { kind: "wicket", wicketType: "bowled" } });
    assert(r.need && r.need.kind === "batter", "with A1 out before retiring, another batter is needed later");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(1), ev: { kind: "wicket", wicketType: "bowled" } }, { batters: ["A4"] });
    ni = r.match && r.match.innings[0];
    assert(ni && ni.batting.stats.A1.out && !ni.batting.stats.A1.retired && !(ni.retirements || []).length && r.notes.some(t => /A1 isn't batting by ball .* no longer retire hurt.*Check it/.test(t)),
      "...the retirement is dropped with a note to check");

    // Rebuilt from the scorecard (no log kept): the retirement and the return go back in.
    const arch = JSON.parse(JSON.stringify(m));
    delete arch.innings[0].log; delete arch.innings[0].logBase;
    const rebuilt = win.rebuildInningsFromScorecard(arch, 0);
    assert(rebuilt && rebuilt.log.some(a => a.t === "retire") && win.inningsScorecardKey(rebuilt) === win.inningsScorecardKey(inn),
      "an innings with a retirement rebuilds from its scorecard");

    // Retired again and never back: not out on the scorecard and in the stats.
    win.retireBatter(inn, "striker", "notout");
    assert(a1.howOut === "retired not out" && JSON.stringify(win.retiredBatters(inn, true)) === "[]", "retired not out, with no one to replace them yet");
    win.endInnings(m);
    const t = win.aggregatePlayerStats([m]).find(x => x.name === "A1");
    assert(t.innings === 1 && t.notOuts === 1 && t.runs === 7, "a batter who retired and didn't come back counts as not out");
    const card = win.eval(`renderInningsSummary(${JSON.stringify(m)}, ${JSON.stringify(inn)})`);
    assert(/retired not out/.test(card) && /Retired: A1 5 \(2\) retired hurt at 5-0, 0\.2 ov, back in at 5-1; A1 7 \(3\) retired not out/.test(card),
      "the scorecard says retired not out, and lists each retirement");

    // Catch up the score: a retired batter has a status of their own, and can come back in.
    const c = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
    const ci = currentInnings(c);
    win.openInnings(ci, "A1", "A2", "B1"); c.status = "live";
    recordBall(ci, { kind: "run", runs: 1 });
    win.retireBatter(ci, "nonStriker", "hurt"); win.sendInBatter(ci, "A3");
    const draft = win.catchUpDraftFrom(c);
    assert(draft.batters.map(b => b.name + ":" + b.status).join() === "A1:retired,A2:striker,A3:nonStriker", "the catch-up form lists a retired batter as retired");
    const ex = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
    let data = { runs: 4, wickets: 0, balls: 3, extras: ex, batters: [{ name: "A1", status: "retired" }, { name: "A2", status: "striker" }, { name: "A3", status: "nonStriker" }], bowlers: [], bowlerNow: "B1", lastOver: "" };
    assert(win.catchUpError(c, data) === null, "a catch-up with the retired batter still off is fine");
    win.applyCatchUp(c, data);
    assert(ci.batting.stats.A1.retired === "hurt" && ci.runs === 4, "...and leaves them retired");
    data = { runs: 6, wickets: 1, balls: 4, extras: ex, batters: [{ name: "A1", status: "nonStriker" }, { name: "A2", status: "striker" }, { name: "A3", status: "out", wicketType: "bowled", bowler: "B1" }], bowlers: [], bowlerNow: "B1", lastOver: "" };
    assert(win.catchUpError(c, data) === null, "a catch-up can bring a retired batter back in");
    win.applyCatchUp(c, data);
    const back = ci.retirements[ci.retirements.length - 1];
    assert(!ci.batting.stats.A1.retired && ci.nonStriker === "A1" && back.type === "back" && back.catchUp && back.score === 6, "...they're back at the crease, at the caught-up score");
    data = { runs: 8, wickets: 1, balls: 5, extras: ex, batters: [{ name: "A1", status: "nonStriker" }, { name: "A2", status: "retired" }, { name: "A4", status: "striker" }], bowlers: [], bowlerNow: "B1", lastOver: "" };
    assert(win.catchUpError(c, data) === null, "a catch-up can retire a batter too");
    win.applyCatchUp(c, data);
    assert(ci.batting.stats.A2.retired === "hurt" && ci.striker === "A4" && ci.retirements[ci.retirements.length - 1].name === "A2", "...who is then retired hurt, not out");
    assert(win.inningsCommentary(ci).filter(l => l.type === "retire").map(l => l.text).join("|") === "A1 retired hurt|A1 back in|A2 retired hurt",
      "...and the commentary has every retirement and return");

    // The sheets: Wicket -> Retired hurt? -> pick who -> Retire; then the new-batter sheet.
    win.state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 4, battingFirst: "A" });
    win.state.snapshots = [];
    const li = currentInnings(win.state.match);
    win.openInnings(li, "Kusal", "Pathum", "Wanindu"); win.state.match.status = "live";
    recordBall(li, { kind: "run", runs: 4 });
    win.ui = win.defaultUi(); win.eval("ui = window.ui; render();");
    doc.querySelector('#app [data-action="open-wicket"]').click();
    doc.querySelector('#modal-root [data-action="open-retire"]').click();
    assert(/Retire a batter/.test(doc.querySelector("#modal-root").textContent) && /Retire Kusal/.test(doc.querySelector('#modal-root [data-action="confirm-retire"]').textContent),
      "the wicket sheet's Retired hurt? opens the retire sheet, on the striker");
    doc.querySelector('#modal-root [data-action="retire-end"][data-end="nonStriker"]').click();
    assert(/Retire Pathum/.test(doc.querySelector('#modal-root [data-action="confirm-retire"]').textContent), "...and can pick the other batter");
    doc.querySelector('#modal-root [data-action="retire-end"][data-end="striker"]').click();
    doc.querySelector('#modal-root [data-action="confirm-retire"]').click();
    let sheet = doc.querySelector("#modal-root").textContent;
    assert(/New batsman/.test(sheet) && /Kusal/.test(doc.querySelector("#modal-root .dismissal-banner").textContent) && /retired hurt · 4 \(1\)/.test(sheet) && /UNDO RETIRE/.test(sheet),
      "the new-batter sheet says who retired, with their score");
    assert(!/Retired · can bat again/.test(sheet), "...and doesn't offer them straight back");
    doc.querySelector('#modal-root [data-action="undo"]').click();
    assert(currentInnings(win.state.match).striker === "Kusal" && !currentInnings(win.state.match).batting.stats.Kusal.retired, "Undo takes the retirement back");
    win.eval(`retireBatter(currentInnings(state.match), "striker", "hurt"); sendInBatter(currentInnings(state.match), "Dasun");
      recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); render();`);
    sheet = doc.querySelector("#modal-root").textContent;
    assert(/Retired · can bat again/.test(sheet) && doc.querySelector('#modal-root [data-action="pick-batter"][data-name="Kusal"]'), "after a wicket the sheet lists the retired batter to come back");
    doc.querySelector('#modal-root [data-action="pick-batter"][data-name="Kusal"]').click();
    const after = currentInnings(win.state.match);
    assert(after.striker === "Kusal" && after.batting.stats.Kusal.runs === 4 && !doc.querySelector("#modal-root .modal"), "tapping them brings them back in on their score");
    win.eval(`openRetire(); render();`);
    win.eval(`ui.retire = null; ui.matchMenu = "menu"; render();`);
    assert(doc.querySelector('#modal-root [data-action="open-retire"]'), "Match options offers Retire a batter");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- picking players: word-start search, last man stands alone, a wrong pick replaced, fielder chips ---
  {
    const doc = win.document;
    const key = win.nameSearchKey("Kusal Mendis", "Kuse", "#7");
    assert(["ku", "MEN", "kuse", "#7", "7", "ku me", ""].every(q => win.nameSearchHit(key, q)), "search matches the start of any name word, a nickname or the jersey");
    assert(["sal", "endis", "use", "ku x"].every(q => !win.nameSearchHit(key, q)), "...never the middle of a word, and every word typed has to match");
    assert(win.nameSearchHit(win.nameSearchKey("M.S. Dhoni"), "ms") && win.nameSearchHit(win.nameSearchKey("M.S. Dhoni"), "m.s") && win.nameSearchHit(win.nameSearchKey("#7 Kusal Mendis (Kuse)"), "kuse"),
      "punctuation inside a name is optional, and a label's (nickname) is searchable");

    // Last man stands with a short side: nobody left, so the batter still in goes on alone.
    const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", lastManStands: true });
    const inn = currentInnings(m);
    win.openInnings(inn, "A1", "A2", "B1"); m.status = "live";
    const play = ev => { recordBall(inn, ev); afterBall(m); };
    play({ kind: "run", runs: 1 }); play({ kind: "wicket", wicketType: "bowled" });   // A2 out
    win.sendInBatter(inn, "A3");
    play({ kind: "run", runs: 2 }); play({ kind: "wicket", wicketType: "caught", fielder: "B2" });   // A3 out
    assert(inn.maxWickets === 6 && win.pendingBatsmanSlot(inn) === "striker" && win.canBatAlone(inn), "a wicket with players to spare still asks for a batter, but going on alone is allowed");
    assert(win.batAlone(inn) && inn.maxWickets === 3 && inn.striker === "A1" && inn.nonStriker === null && win.battingAlone(inn) && !win.pendingBatsmanSlot(inn),
      "batting on alone: the side is now 3, A1 takes strike and nobody is asked for");
    play({ kind: "run", runs: 1 });
    assert(inn.striker === "A1" && inn.nonStriker === null, "...and keeps the strike after a single");
    play({ kind: "wicket", wicketType: "bowled" });
    assert(inn.complete && inn.completeReason === "allout" && inn.wickets === 3, "the next wicket is all out");
    const seqA = n => inn.log.filter(a => a.t === "ball")[n].ev.seq;
    let r = win.replayMatch(m, { inn: 0, seq: seqA(2), ev: { kind: "run", runs: 4 } });
    assert(r.match && r.match.innings[0].maxWickets === 3 && r.match.innings[0].completeReason === "allout" && r.match.innings[0].runs === 6, "an edited ball replays the batting alone");
    r = win.replayMatch(m, { inn: 0, seq: seqA(0), ev: { kind: "wicket", wicketType: "bowled" } });
    const ri = r.match && r.match.innings[0];
    assert(ri && ri.wickets === 3 && ri.complete && ri.batting.order.join() === "A1,A2,A3" && r.notes.some(t => /ends earlier/.test(t)),
      "a wicket added earlier brings the batting alone forward (no batter is asked for), and the innings ends sooner");

    // No last man stands, a short side: that was the last man, so they're all out.
    const s = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
    const si = currentInnings(s);
    win.openInnings(si, "A1", "A2", "B1"); s.status = "live";
    const sp = ev => { recordBall(si, ev); afterBall(s); };
    assert(!win.canDeclareAllOut(si) && !win.canDeclareAllOut(inn), "all out needs a wicket and a batter to be asked for (and isn't for last man stands)");
    sp({ kind: "run", runs: 1 }); sp({ kind: "wicket", wicketType: "bowled" });   // A2 out
    win.sendInBatter(si, "A3");
    sp({ kind: "run", runs: 2 }); sp({ kind: "wicket", wicketType: "caught", fielder: "B2" });   // A3 out
    assert(si.maxWickets === 5 && win.canDeclareAllOut(si) && win.declareAllOut(si) && si.complete && si.completeReason === "allout" && si.maxWickets === 2
      && win.isAllOut(si) && si.allOutByHand.maxWickets === 5, "declared all out: the side is the wickets so far, and the innings ends all out");
    afterBall(s);
    assert(s.status === "innings_break", "...on to the innings break");
    const sseq = n => si.log.filter(a => a.t === "ball")[n].ev.seq;
    let q = win.replayMatch(s, { inn: 0, seq: sseq(2), ev: { kind: "run", runs: 4 } });
    assert(q.match && q.match.innings[0].completeReason === "allout" && q.match.innings[0].maxWickets === 2 && q.match.innings[0].runs === 5, "an edited ball replays the all out");
    q = win.replayMatch(s, { inn: 0, seq: sseq(0), ev: { kind: "wicket", wicketType: "bowled" } });
    let qi = q.match && q.match.innings[0];
    assert(qi && qi.wickets === 2 && qi.complete && qi.completeReason === "allout" && qi.batting.order.join() === "A1,A2,A3" && q.notes.some(t => /ends earlier/.test(t)),
      "a wicket added earlier brings the all out forward, and the innings ends sooner");
    q = win.replayMatch(s, { inn: 0, seq: sseq(3), ev: { kind: "run", runs: 0 } });
    qi = q.match && q.match.innings[0];
    assert(qi && !qi.complete && qi.maxWickets === 5 && !qi.allOutByHand && q.match.status === "live" && q.notes.some(t => /isn't all out/.test(t)),
      "the last wicket taken out: not all out any more, the innings is live again and the note says so");
    q = win.reopenInnings(s, 0);
    qi = q.match && q.match.innings[0];
    assert(qi && !qi.complete && qi.maxWickets === 5 && !qi.allOutByHand && win.pendingBatsmanSlot(qi) === "striker" && qi.log[qi.log.length - 1].t !== "allout"
      && q.match.status === "live", "all out by hand can be reopened: the side's size is back and a batter is asked for");
    const rebuilt = win.rebuildInningsFromScorecard(JSON.parse(JSON.stringify(s)), 0);
    assert(rebuilt && rebuilt.completeReason === "allout" && rebuilt.allOutByHand && rebuilt.allOutByHand.maxWickets === 5 && rebuilt.log.some(a => a.t === "allout"),
      "an archived innings without its log is rebuilt with the all out");
    // In the chase it ends the match.
    win.startSecondInnings(s);
    const ci = currentInnings(s);
    win.openInnings(ci, "B1", "B2", "A1"); s.status = "live";
    recordBall(ci, { kind: "run", runs: 1 }); afterBall(s); recordBall(ci, { kind: "wicket", wicketType: "lbw" }); afterBall(s);
    assert(win.declareAllOut(ci), "the chasing side can be all out too");
    afterBall(s);
    assert(s.status === "complete" && /Lions won by 2 runs/.test(s.result), "...which ends the match: " + s.result);

    // A wrong pick, replaced: a batter for their innings, a bowler for chosen overs.
    const w = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", ballsPerOver: 2 });
    const wi = currentInnings(w);
    win.openInnings(wi, "A1", "A2", "B1"); w.status = "live";
    const wp = ev => { recordBall(wi, ev); afterBall(w); };
    wp({ kind: "run", runs: 4 }); wp({ kind: "wicket", wicketType: "caught", fielder: "B3" });   // over 1, B1: A1 c B3 b B1
    win.sendInBatter(wi, "A3"); win.setBowler(wi, "B2");
    wp({ kind: "run", runs: 1 }); wp({ kind: "run", runs: 2 });                                   // over 2, B2: A3 2 (1)
    win.setBowler(wi, "B1");
    wp({ kind: "wicket", wicketType: "bowled" }); win.sendInBatter(wi, "A4"); wp({ kind: "run", runs: 1 });   // over 3, B1: A2 b B1
    win.setBowler(wi, "B3"); wp({ kind: "run", runs: 0 });                                        // over 4 (now), B3
    let x = win.replacePick(w, { inn: 0, role: "batter", from: "A3", to: "A5" });
    let xi = x.match && x.match.innings[0];
    assert(xi && !xi.batting.stats.A3 && xi.batting.stats.A5.runs === 2 && xi.batting.stats.A5.balls === 1 && xi.batting.order.join() === "A1,A2,A5,A4"
      && JSON.stringify(xi).indexOf('"A3"') < 0 && xi.runs === wi.runs && xi.bowler === "B3", "a batter replaced: their runs and balls move over, every trace of the wrong name goes, the score stays");
    assert(win.replacePickError(w, { inn: 0, role: "batter", from: "A3", to: "a1" }) === "A1 has already batted in this innings." && /already plays for Tigers/.test(win.replacePickError(w, { inn: 0, role: "batter", from: "A3", to: "B2" })),
      "...not with someone who has batted, or plays for the other side");
    const spells = win.bowlerSpells(wi, "B1");
    assert(spells.map(sp => sp.number).join() === "1,3" && win.bowlerSpells(wi, "B3")[0].now, "a bowler's overs are listed one by one (and the one going on)");
    x = win.replacePick(w, { inn: 0, role: "bowler", from: "B1", to: "B4", overs: [spells[1].key] });
    xi = x.match && x.match.innings[0];
    assert(xi && xi.bowling.stats.B1.legalBalls === 2 && xi.bowling.stats.B1.wickets === 1 && xi.bowling.stats.B4.legalBalls === 2 && xi.bowling.stats.B4.wickets === 1
      && xi.batting.stats.A2.howOut === "bowled b B4" && xi.batting.stats.A1.howOut === "c B3 b B1" && xi.overs[2].bowler === "B4", "a bowler replaced for one over: just that over's figures and wickets move");
    x = win.replacePick(w, { inn: 0, role: "bowler", from: "B1", to: "B4", overs: null });
    xi = x.match && x.match.innings[0];
    assert(xi && !xi.bowling.stats.B1 && xi.batting.stats.A1.howOut === "c B3 b B4" && xi.fielding.stats.B3.catches === 1, "...or for all their overs; a catch by the fielder stays theirs");
    assert(/two overs in a row/.test(win.replacePickError(w, { inn: 0, role: "bowler", from: "B1", to: "B2", overs: [spells[1].key] }))
      && /two overs in a row/.test(win.replacePickError(w, { inn: 0, role: "bowler", from: "B1", to: "B3", overs: [spells[1].key] })), "a bowler can't be swapped in next to their own over");

    // In the page: tap a name on the board -> Wrong batter? -> pick -> confirm.
    win.state.match = JSON.parse(JSON.stringify(w)); win.state.snapshots = [];
    win.eval(`ui = defaultUi(); state.match.squads = { A: ["A1", "A2", "A3", "A4", "A5"], B: ["B1", "B2", "B3", "B4"] }; render();`);
    const live = () => currentInnings(win.state.match);
    const nameBtn = (role, n) => doc.querySelector(`#app [data-action="replace-pick"][data-role="${role}"][data-name="${n}"]`);
    assert(nameBtn("batter", live().striker) && nameBtn("bowler", "B3"), "the board's batter and bowler names can be tapped");
    nameBtn("batter", "A4").click();
    assert(/Wrong batter\?/.test(doc.querySelector("#modal-root").textContent) && doc.querySelector('#modal-root [data-action="replace-pick-to"][data-name="A5"]')
      && !doc.querySelector('#modal-root [data-action="replace-pick-to"][data-name="A3"]'), "it lists who it could have been (not anyone who batted)");
    doc.querySelector('#modal-root [data-action="replace-pick-to"][data-name="A5"]').click();
    assert(/A4 → A5\?/.test(doc.querySelector("#confirm-root").textContent) && live().batting.stats.A4, "it asks first, saying what moves");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(!live().batting.stats.A4 && live().batting.stats.A5 && !doc.querySelector("#modal-root .modal"), "confirmed: A5 is in, the sheet closes");
    doc.querySelector('#app [data-action="undo"]').click();
    assert(live().batting.stats.A4 && !live().batting.stats.A5, "Undo takes it back");
    nameBtn("bowler", "B3").click();
    assert(/Wrong bowler\?/.test(doc.querySelector("#modal-root").textContent), "the bowler's name opens Wrong bowler?");
    win.eval(`ui.replacePick = null; ui.matchMenu = "menu"; render();`);
    doc.querySelector('#modal-root [data-action="open-replace-chooser"]').click();
    doc.querySelector('#modal-root [data-action="replace-pick"][data-role="bowler"][data-name="B1"]').click();
    assert(/Which overs/.test(doc.querySelector("#modal-root").textContent) && doc.querySelectorAll('#modal-root .over-chip.active').length === 2,
      "Match options → Change a player lists everyone; a bowler not on now has all their overs picked");
    win.eval(`closeTopOverlay()`);
    assert(/Change a player/.test(doc.querySelector("#modal-root").textContent), "back goes back to that list");
    win.eval(`ui.replacePick = null; render();`);

    // Fielder chips: tap one, Confirm credits them; typing a name drops the chip.
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", lastManStands: true });
      state.match.squads = { A: ["A1", "A2", "A3"], B: ["B1", "B2", "B3"] }; state.snapshots = []; ui = defaultUi();
      openInnings(currentInnings(state.match), "A1", "A2", "B1"); state.match.status = "live"; render();`);
    doc.querySelector('#app [data-action="open-wicket"]').click();
    doc.querySelector('#modal-root [data-action="pick-wicket"][data-type="caught"]').click();
    const chips = () => [...doc.querySelectorAll("#modal-root .fielder-list")[0].querySelectorAll(".fielder-row")].map(c => c.dataset.name);
    assert(chips().join() === "B1,B2,B3" && !(doc.activeElement && doc.activeElement.matches("input")), "Caught lists the fielding side as rows, nothing focused");
    const otherFielders = doc.querySelectorAll("#modal-root .fielder-list")[1];
    assert(otherFielders && otherFielders.previousElementSibling.textContent === "Other players" && otherFielders.querySelector(".fielder-row")
      && ![...otherFielders.querySelectorAll(".fielder-row")].some(c => /^[AB][123]$/.test(c.dataset.name)),
      "...then everyone else on the players list, outside both squads, as 'Other players' (a sub fielder)");
    doc.querySelector('#modal-root .fielder-row[data-name="B3"]').click();
    assert(doc.querySelector('#modal-root .fielder-row.active[data-name="B3"]'), "a tapped row is ticked");
    const fbox = doc.getElementById("wicket-fielder");
    fbox.value = "B"; fbox.dispatchEvent(new win.Event("input", { bubbles: true }));
    assert(!doc.querySelector("#modal-root .fielder-row.active") && win.eval("ui.wicketFielder") === null, "typing drops the tapped row");
    fbox.value = "";
    doc.querySelector('#modal-root .fielder-row[data-name="B2"]').click();
    doc.getElementById("wicket-fielder-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(live().wickets === 1 && live().batting.stats.A1.howOut === "c B2 b B1" && live().fielding.stats.B2.catches === 1, "Confirm credits the tapped fielder");
    const listAlone = doc.querySelector('#modal-root #new-batsman-form [data-action="bat-alone"]');
    assert(listAlone && listAlone.classList.contains("ghost") && !listAlone.nextElementSibling && doc.querySelectorAll('#modal-root [data-action="bat-alone"]').length === 1
      && !doc.querySelector('#modal-root .sheet-actions [data-action="bat-alone"]') && !doc.querySelector('#modal-root [data-action="all-out"]'),
      "last man stands, someone still listed: '… bats alone' is under the list, not in the button bar");

    // The new-batter sheet: with the squad used up, going on alone comes first.
    win.eval(`sendInBatter(currentInnings(state.match), "A3"); recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    const alone = doc.querySelector('#modal-root [data-action="bat-alone"]');
    assert(alone && alone.classList.contains("primary") && alone.textContent.replace(/\s+/g, " ").trim() === "A2 bats alone No one else to bat", "nobody left in the squad: 'A2 bats alone' is the first thing on the sheet");
    alone.click();
    assert(win.eval("battingAlone(currentInnings(state.match))") && live().striker === "A2" && !doc.querySelector("#modal-root #new-batsman-form")
      && doc.querySelector("#app .matchup-row.empty") && doc.querySelector("#app .matchup-row.empty").textContent.trim() === "" && !/alone/i.test(doc.querySelector("#app .matchup-card").textContent),
      "one tap: A2 bats alone, and the board's other batter row shows nothing");

    // No last man stands: the new-batter sheet has All out, which asks first.
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
      state.snapshots = []; ui = defaultUi();
      openInnings(currentInnings(state.match), "A1", "A2", "B1"); state.match.status = "live";
      recordBall(currentInnings(state.match), { kind: "run", runs: 3 }); afterBall(state.match);
      pushSnapshot(); recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    const listAllOut = doc.querySelector('#modal-root #new-batsman-form [data-action="all-out"]');
    assert(listAllOut && listAllOut.classList.contains("ghost") && !doc.querySelector('#modal-root .sheet-actions [data-action="all-out"]')
      && !doc.querySelector('#modal-root [data-action="end-innings"]') && doc.querySelectorAll("#modal-root .sheet-actions button").length === 2,
      "after a wicket the new-batter sheet offers All out under the list (the button bar is just Undo · Pick later)");
    listAllOut.click();
    assert(/Lions all out\?/.test(doc.querySelector("#confirm-root").textContent) && /Tigers will need 4 to win/.test(doc.querySelector("#confirm-root").textContent)
      && !live().complete, "it asks first, saying the target");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.state.match.status === "innings_break" && live().completeReason === "allout" && !doc.querySelector("#modal-root #new-batsman-form"),
      "confirmed: all out, on to the innings break");
    assert(doc.querySelector('#app [data-action="reopen-innings"]'), "the innings break offers to reopen it");
    win.eval(`handleUndo(); render();`);
    assert(win.state.match.status === "live" && win.pendingBatsmanSlot(live()) === "striker" && !live().complete, "Undo takes it back to the new-batter sheet");
    // A squad with nobody left: All out comes first.
    win.eval(`state.match.squads = { A: ["A1", "A2"], B: ["B1", "B2"] }; render();`);
    const topAllOut = doc.querySelector('#modal-root .modal > [data-action="all-out"]');
    assert(topAllOut && topAllOut.classList.contains("primary") && /All out\s+No one else to bat/.test(topAllOut.textContent)
      && doc.querySelectorAll('#modal-root [data-action="all-out"]').length === 1, "nobody left in the squad: 'all out' is the first thing on the sheet");
    // No squad: the guest player list used up does the same.
    win.eval(`window.__players = state.players; delete state.match.squads;
      state.players = { p1: { id: "p1", name: "A1" }, p2: { id: "p2", name: "A2" } }; render();`);
    assert(doc.querySelector('#modal-root .modal > [data-action="all-out"].primary'), "no squad, but every guest player on the list has batted: it comes first too");
    win.eval(`state.players.p3 = { id: "p3", name: "A3" }; render();`);
    assert(!doc.querySelector('#modal-root .modal > [data-action="all-out"]') && doc.querySelector('#modal-root #new-batsman-form [data-action="all-out"].ghost'),
      "...and goes back under the list while someone's left to pick");
    win.eval(`state.players = window.__players;`);

    // Last man stands, but a "Bat ?1" was sent in as a stand-in and the strike swapped by hand: put it right.
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", lastManStands: true });
      state.snapshots = []; ui = defaultUi();
      { const inn = currentInnings(state.match); openInnings(inn, "A1", "A2", "B1"); state.match.status = "live";
        recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(state.match);   // A1 out, A2 at the other end
        sendInBatter(inn, "Bat ?1");                                                          // the stand-in, on strike
        recordBall(inn, { kind: "run", runs: 2 }); afterBall(state.match);                    // forgot to swap: Bat ?1 2 (1)
        swapStrikeByHand(inn); recordBall(inn, { kind: "run", runs: 1 }); afterBall(state.match);
        swapStrikeByHand(inn); recordBall(inn, { kind: "run", runs: 4 }); afterBall(state.match); }
      render();`);
    assert(win.batAloneInsteadName(win.state.match) === "Bat ?1" && win.batAloneInsteadError(win.state.match, "A2") && /isn't last man stands/.test(win.batAloneInsteadError(Object.assign({}, win.state.match, { innings: [Object.assign({}, live(), { lastManStands: false })] }), "Bat ?1")),
      "the stand-in can be taken off (not the real batter, and only with last man stands)");
    const bi = win.batAloneInstead(win.state.match, "Bat ?1");
    const biInn = bi.match && bi.match.innings[0];
    assert(biInn && !biInn.batting.stats["Bat ?1"] && biInn.batting.stats.A2.runs === 7 && biInn.batting.stats.A2.balls === 3 && biInn.striker === "A2" && biInn.nonStriker === null
      && win.battingAlone(biInn) && biInn.maxWickets === 2 && biInn.runs === 7 && bi.notes.some(t => /Bat \?1's 2 \(1\) now count for A2/.test(t)),
      "A2 has batted alone since: every ball is theirs (the 2 Bat ?1 'faced' too), the swaps are gone, A2 on strike");
    doc.querySelector('#app [data-action="name-later"][data-name="Bat ?1"]').click();
    const nobody = doc.querySelector('#modal-root [data-action="bat-alone-instead"][data-name="Bat ?1"]');
    assert(nobody && /Nobody · A2 bats alone/.test(nobody.textContent), "'Who was it?' on Bat ?1 offers 'Nobody · A2 bats alone'");
    nobody.click();
    assert(/A2 bats alone\?/.test(doc.querySelector("#confirm-root").textContent) && live().batting.stats["Bat ?1"], "it asks first");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(!live().batting.stats["Bat ?1"] && live().striker === "A2" && !doc.querySelector("#modal-root .modal")
      && doc.querySelector("#app .matchup-row.empty"), "confirmed: Bat ?1 is gone and A2 bats alone (the other row blank)");
    win.eval(`recordBall(currentInnings(state.match), { kind: "run", runs: 1 }); afterBall(state.match); render();`);
    assert(live().striker === "A2" && live().nonStriker === null, "...who keeps the strike after a single");
    win.eval(`handleUndo(); handleUndo(); render();`);
    assert(live().batting.stats["Bat ?1"] && live().nonStriker === "Bat ?1", "Undo puts the stand-in back");
    win.eval(`ui.matchMenu = "menu"; render();`);
    assert(doc.querySelector('#modal-root [data-action="bat-alone-instead"][data-name="Bat ?1"]') && /A2 bats alone/.test(doc.querySelector("#modal-root").textContent),
      "⋯ Match options offers it too");
    win.eval(`ui.matchMenu = null; render();`);

    // "No names", last man stands: the batter who came in is a button that takes them off again.
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: null, battingFirst: "A", lastManStands: true });
      state.match.anonymous = true; state.snapshots = []; ui = defaultUi(); render();
      recordBall(currentInnings(state.match), { kind: "run", runs: 1 }); afterBall(state.match);
      recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    assert(live().nonStriker === "Batter 1" && live().striker === "Batter 3" && live().batting.stats["Batter 2"].out, "a 'no names' match fills the gap with Batter 3 at once");
    const anonBtn = doc.querySelector('#app [data-action="bat-alone-instead"][data-name="Batter 3"]');
    assert(anonBtn && !doc.querySelector('#app [data-action="bat-alone-instead"][data-name="Batter 1"]'), "Batter 3's name on the board is a button (Batter 1's isn't)");
    anonBtn.click();
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(!live().batting.stats["Batter 3"] && live().striker === "Batter 1" && live().nonStriker === null && win.battingAlone(live()), "confirmed: Batter 1 bats alone");
    win.eval(`render(); recordBall(currentInnings(state.match), { kind: "run", runs: 2 }); afterBall(state.match); render();`);
    assert(live().nonStriker === null && !live().batting.stats["Batter 3"], "and no Batter 3 comes in after the next ball");
    const anonSeq = live().log.find(a => a.t === "ball").ev.seq;
    const anonEdit = win.replayMatch(win.state.match, { inn: 0, seq: anonSeq, ev: { kind: "run", runs: 4 } });
    assert(anonEdit.match && win.battingAlone(anonEdit.match.innings[0]) && anonEdit.match.innings[0].runs === 6 && !anonEdit.match.innings[0].batting.stats["Batter 3"],
      "an edited ball replays the batting alone in a 'no names' match");
    win.eval(`recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    assert(live().complete && live().completeReason === "allout" && win.state.match.status === "innings_break", "the lone batter's wicket ends the innings");

    // The new-bowler sheet lists both groups; the match preset says which comes first.
    const mf = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", freshBowlersFirst: true });
    assert(mf.freshBowlersFirst === true && win.restartMatch(mf, "B").freshBowlersFirst === true && createMatch({ teamA: "L", teamB: "T", battingFirst: "A" }).freshBowlersFirst === false,
      "freshBowlersFirst is kept on the match (and through a toss restart); off by default");
    assert(Object.fromEntries(win.describeMatchPreset({ ballsPerOver: 6, oversLimit: 5, playersPerSide: 6, freshBowlersFirst: true }))["New bowler"] === "Players yet to bowl are listed first."
      && Object.fromEntries(win.describeMatchPreset({ ballsPerOver: 6, oversLimit: 5, playersPerSide: 6 }))["New bowler"] === "Players who've bowled are listed first.",
      "the preset's ⓘ says which comes first");
    const pf = doc.createElement("div");
    pf.innerHTML = win.renderMatchPresetForm({ name: "Club", freshBowlersFirst: true });
    assert(win.parseMatchPresetForm(new win.FormData(pf.querySelector("form"))).freshBowlersFirst === true
      && !win.parseMatchPresetForm(new win.FormData((pf.innerHTML = win.renderMatchPresetForm({ name: "Club" }), pf.querySelector("form")))).freshBowlersFirst,
      "the match preset form has the setting (guest and club presets share it)");
    const bowlerSheet = fresh => {
      win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A", ballsPerOver: 1, freshBowlersFirst: ${fresh} });
        state.match.squads = { A: ["A1", "A2"], B: ["B1", "B2", "B3"] }; state.snapshots = []; ui = defaultUi();
        { const inn = currentInnings(state.match); openInnings(inn, "A1", "A2", "B1"); state.match.status = "live";
          recordBall(inn, { kind: "run", runs: 0 }); afterBall(state.match); setBowler(inn, "B2");
          recordBall(inn, { kind: "run", runs: 0 }); afterBall(state.match); }
        render();`);
      return [...doc.querySelectorAll("#modal-root #new-bowler-form .section-label")].map(l => l.textContent.trim());
    };
    const byDefault = bowlerSheet(false);
    assert(byDefault[0] === "Already bowled" && byDefault[1] === "Yet to bowl" && byDefault[2] === "Other players"
      && doc.querySelector('#modal-root [data-action="pick-bowler"][data-name="B3"]') && doc.querySelector('#modal-root [data-action="pick-bowler"][data-name="B1"]'),
      "new bowler: Already bowled, then Yet to bowl (B3), then players outside the squads: " + byDefault.join(" · "));
    const freshFirst = bowlerSheet(true);
    assert(freshFirst[0] === "Yet to bowl" && freshFirst[1] === "Other players" && freshFirst[2] === "Already bowled", "...or yet to bowl first when the preset says so: " + freshFirst.join(" · "));

    // Players left out of a squad are still listed (they used to be reachable only by typing the exact name).
    win.eval(`state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
      state.match.squads = { A: ["A1", "A2", "A3"], B: ["B1", "B2"] }; state.snapshots = []; ui = defaultUi();
      window.__players = state.players; state.players = { x1: { id: "x1", name: "Late Comer" }, x2: { id: "x2", name: "B1" } };
      { const inn = currentInnings(state.match); openInnings(inn, "A1", "A2", "B1"); state.match.status = "live";
        recordBall(inn, { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); sendInBatter(inn, "A3"); recordBall(inn, { kind: "run", runs: 1 }); afterBall(state.match); }
      render();`);
    win.eval(`recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    assert(doc.querySelector('#modal-root #new-batsman-form [data-action="pick-batter"][data-name="Late Comer"]')
      && [...doc.querySelectorAll("#modal-root .section-label")].some(l => l.textContent === "Other players")
      && doc.querySelector('#modal-root .modal > [data-action="all-out"]'),
      "new batter: the squad is used up (All out comes first), but Late Comer, outside the squads, is still listed");
    win.eval(`ui.pickDismissed = pendingPickKey(state.match); ui.replacePick = { inn: 0, role: "batter", name: "A3" }; render();`);
    assert(doc.querySelector('#modal-root [data-action="replace-pick-to"][data-name="Late Comer"]') && !doc.querySelector('#modal-root [data-action="replace-pick-to"][data-name="B1"]'),
      "Wrong batter? lists Late Comer too (never a player from the other side)");
    win.eval(`ui.replacePick = null; state.players = window.__players; state.match = null; state.snapshots = []; ui = defaultUi(); save(); render();`);
  }

  // --- Players who aren't club members: find, view (read only), claim ---
  {
    const tick = () => new Promise(r => setTimeout(r, 0));
    win.eval(`state.match = null; state.snapshots = []; window.__prevSession = session; window.__prevClient = supabaseClient;
      window.__lpp = loadPlayerProfile; window.__fmi = fetchMyPlayerIdentity; window.__rpa = refreshProfileAndAdmin;
      loadPlayerProfile = () => { ui.profile.pending = false; };   // no network: the test fills the profile in
      session = null; ui = defaultUi();
      ui.premier = { premierMatches: [], pendingClaims: [], pendingMerges: [],
        players: Array.from({ length: 150 }, (_, i) => ({ id: "p" + i, name: "Player " + String(i).padStart(3, "0"), claimed_by: null }))
          .concat([{ id: "k1", name: "Kusal Mendis", nickname: "KM", jersey_no: 7, claimed_by: null }])
          .map(p => Object.assign(p, { searchKey: nameSearchKey(p.name, p.nickname, p.jersey_no != null ? "#" + p.jersey_no : "") })) };
      state.view = "premierPlayers"; render();`);
    const rows = () => doc.querySelectorAll("#app .premier-player-list .list-row");
    const search = () => doc.querySelector("#app [data-premier-search]");
    assert(rows().length === 100 && /Showing 100 of 151/.test(doc.querySelector("#app .premier-player-list").textContent),
      "Premier → Players lists at most 100 rows and says how many there are");
    const type = v => { search().value = v; search().dispatchEvent(new win.Event("input", { bubbles: true })); };
    type("ku me");
    assert(rows().length === 1 && /#7 Kusal Mendis \(KM\)/.test(rows()[0].textContent), "the search box finds a player by the start of each word");
    type("#7"); const byJersey = rows().length; type("km");
    assert(byJersey === 1 && rows().length === 1, "...or by jersey no or nickname");
    type("zzz");
    assert(rows().length === 0 && /No player matches/.test(doc.querySelector("#app .premier-player-list").textContent), "no match says so");
    type("kus"); search().focus(); win.eval("render()");
    assert(doc.activeElement === search() && search().value === "kus" && rows().length === 1, "a re-render keeps the search box's text, rows and focus");

    // A profile's Matches tab, opened by someone who isn't in the club.
    win.eval(`(function(){
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 11, battingFirst: "A" });
      const inn = currentInnings(m);
      ensureBatsman(inn, "Kusal Mendis"); ensureBatsman(inn, "A2"); ensureBowler(inn, "B1");
      Object.assign(inn.batting.stats["Kusal Mendis"], { runs: 45, balls: 30, out: true, howOut: "bowled b B1" });
      Object.assign(m, { id: "pm1", completedAt: Date.now(), status: "complete", result: "Lions won by 5 runs", clubId: "c9" });
      state.matchHistory.pm1 = m;   // even archived on this phone, a profile's scorecard is view only
      openPlayerProfile("premier", "k1", "Kusal Mendis");
      Object.assign(ui.profile, { pending: false, loading: false, tab: "matches", clubScope: "all", clubNames: { pm1: "Colombo CC" }, clubMatches: [m],
        data: { id: "k1", name: "Kusal Mendis", claimed_by: null, can_see_contact: false, details_unavailable: true, kit_unavailable: true } });
      state.view = "playerProfile"; render();
    })()`);
    const tab = doc.querySelector("#app .fixtures");
    assert(tab && /For Lions · 45 \(30\)/.test(tab.textContent) && /Colombo CC/.test(tab.textContent), "the Matches tab lists the player's matches with their own line and the club");
    tab.querySelector('[data-action="open-match-detail"]').click();
    const sheet = doc.querySelector("#modal-root .scorecard-modal");
    assert(sheet && !sheet.querySelector('[data-action="edit-archived-match"]') && !/another phone/.test(sheet.textContent) && !sheet.querySelector('[data-action="edit-ball"]'),
      "a scorecard opened from a profile is view only: no Edit match, no ball edits");
    win.eval(`ui.matchDetail = null; ui.profile.tab = "stats"; render();`);
    assert(/Club matches · all clubs/.test(doc.querySelector("#app").textContent), "Stats: a Premier-opened profile counts every club's matches (019)");
    win.eval(`ui.profile.tab = "profile"; render();`);
    assert(!doc.querySelector('#app [data-action="edit-player-profile"]') && !doc.querySelector('#app [data-action="ask-remove-club-player"]'),
      "someone who can't manage the profile gets no edit or remove buttons");
    doc.querySelector('#app [data-action="share-player-link"]').click();
    assert(doc.querySelector("#confirm-root .share-link-input").value.endsWith("#/premier/players/k1") && /claim it/.test(doc.querySelector("#confirm-root").textContent),
      "Share profile link gives the Premier profile URL, and says an unclaimed player can claim it");
    win.eval("cancelConfirm()");
    // Signed out: "Sign in to claim", and back to this profile once signed in.
    doc.querySelector('#app [data-action="sign-in-to-claim"]').click();
    assert(win.eval("state.view") === "signIn" && win.eval("ui.afterSignIn.id") === "k1", "Sign in to claim goes to sign in and remembers the profile");
    win.eval(`refreshProfileAndAdmin = async () => {};`);
    await win.eval(`completeSignIn({ user: { id: "u9" } })`);
    assert(win.eval("state.view") === "playerProfile" && win.eval("ui.profile.id") === "k1" && win.eval("ui.afterSignIn") === null, "...and signing in lands back on that profile");

    // Account → Player profile: find it, or open the one already claimed.
    win.eval(`supabaseClient = {}; window.__who = { myPlayer: null, pendingClaim: null, pendingMerges: [] };
      fetchMyPlayerIdentity = async () => { ui.identity = JSON.parse(JSON.stringify(__who)); };
      state.view = "account"; ui.identity = null; render();`);
    await tick();
    const findBtn = doc.querySelector('#app [data-action="find-my-profile"]');
    assert(findBtn && /Play for a club/.test(doc.querySelector("#app .my-player-card").textContent), "Account offers Find my profile to someone with no profile yet");
    findBtn.click();
    assert(win.eval("state.view") === "premierPlayers" && search().value === "", "Find my profile opens Premier → Players with an empty search");
    win.eval(`__who.pendingClaim = { id: "c1", player_id: "k1", name: "Kusal Mendis" };`);
    win.eval(`state.view = "account"; ui.identity = null; render();`);
    await tick();
    assert(/Kusal Mendis\s*Claim waiting/.test(doc.querySelector("#app .my-player-card").textContent), "a claim waiting for approval is named on Account");
    // Withdraw it (023): asks first, then the RPC with the request's id, and the card reloads.
    win.eval(`window.__rpc = []; supabaseClient = { rpc: async (fn, args) => { __rpc.push([fn, args]); if (fn === "withdraw_my_request") __who.pendingClaim = null; return { error: null }; } };`);
    doc.querySelector('#app .my-player-card [data-action="withdraw-request"][data-kind="claim"]').click();
    assert(/Withdraw your claim/.test(doc.querySelector("#confirm-root").textContent) && win.eval("__rpc.length") === 0, "Withdraw asks first");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    await tick(); await tick();
    assert(win.eval(`JSON.stringify(__rpc)`) === JSON.stringify([["withdraw_my_request", { _kind: "claim", _request_id: "c1" }]])
      && !doc.querySelector("#confirm-root .confirm-modal") && doc.querySelector('#app [data-action="find-my-profile"]'),
      "...then withdraws that claim, and Account offers Find my profile again");
    // Claimed, with a name merged in and a merge still waiting: all listed, each with its way out.
    win.eval(`__rpc.length = 0; __who.myPlayer = { id: "k1", name: "Kusal Mendis", aliases: ["K. Mendis"] };
      __who.pendingMerges = [{ id: "m1", from_player_id: "k2", name: "Kusal M" }];
      state.view = "account"; ui.identity = null; ui.myClubs = [{ id: "c9", name: "KICC", role: "player" }]; render();`);
    await tick();
    const card = doc.querySelector("#app .my-player-card");
    assert(/Kusal Mendis\s*Claimed/.test(card.textContent) && /Also played as K\. Mendis/.test(card.textContent)
      && /Kusal M\s*Merge waiting/.test(card.textContent) && card.querySelector('[data-action="withdraw-request"][data-kind="merge"][data-id="m1"]')
      && card.querySelector('[data-action="open-player-profile"][data-id="k2"]') && card.querySelector('[data-action="unclaim-profile"]'),
      "Account lists the claimed profile (with its merged names) and the merge waiting, with Withdraw and Unclaim");
    card.querySelector('[data-action="unclaim-profile"]').click();
    const unclaim = doc.querySelector("#confirm-root");
    assert(/Unclaim Kusal Mendis\?/.test(unclaim.textContent) && /merge request into it is withdrawn/.test(unclaim.textContent)
      && unclaim.querySelector('[data-action="confirm-pick"][data-value="remove"].active'),
      "Unclaim asks first, says the waiting merge goes too, and removing the contact no & NIC is picked");
    unclaim.querySelector('[data-action="confirm-pick"][data-value="keep"]').click();
    win.eval(`supabaseClient.rpc = async (fn, args) => { __rpc.push([fn, args]); __who.myPlayer = null; __who.pendingMerges = []; return { error: null }; };`);
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    await tick(); await tick();
    assert(win.eval(`JSON.stringify(__rpc)`) === JSON.stringify([["release_my_claim", { _remove_contact: false }]])
      && win.eval("ui.myClubs") === null && doc.querySelector('#app [data-action="find-my-profile"]'),
      "...then releases it as picked, reloads My clubs (020's read-only clubs go) and Account offers Find my profile");
    win.eval(`supabaseClient = {}; __who.myPlayer = { id: "k1", name: "Kusal Mendis" }; state.view = "account"; ui.identity = null; render();`);
    await tick();
    win.eval(`__who.pendingClaim = null; __who.myPlayer = { id: "k1", name: "Kusal Mendis" }; state.view = "account"; ui.identity = null; render();`);
    await tick();
    doc.querySelector('#app [data-action="open-my-profile"]').click();
    assert(win.eval("state.view") === "playerProfile" && win.eval("ui.profile.id") === "k1" && /Account/.test(doc.querySelector("#app .back-bar").textContent),
      "a claimed player opens their own profile from Account, and its back bar returns there");
    win.eval(`Object.assign(ui.profile, { pending: false, loading: false, data: { id: "k1", name: "Kusal Mendis", claimed_by: session.user.id, can_see_contact: true, details_unavailable: true, kit_unavailable: true } }); render();`);
    assert(doc.querySelector('#app [data-action="unclaim-profile"]') && /This is your profile/.test(doc.querySelector("#app").textContent),
      "your own profile's Ownership box offers Unclaim");

    win.eval(`session = window.__prevSession; supabaseClient = window.__prevClient; loadPlayerProfile = window.__lpp;
      fetchMyPlayerIdentity = window.__fmi; refreshProfileAndAdmin = window.__rpa; delete state.matchHistory.pm1;
      ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- super over: a tie settled by one, in results, standings and stats ---
  {
    // A one-over match, each ball a single; `runs` = how many of the 6 score.
    const tie = (opts) => {
      const m = createMatch(Object.assign({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" }, opts));
      win.openInnings(currentInnings(m), "Kusal", "Pathum", "Shaheen"); m.status = "live";
      for (let i = 0; i < 6; i++){ recordBall(currentInnings(m), { kind: "run", runs: 1 }); afterBall(m); }
      startSecondInnings(m);
      win.openInnings(currentInnings(m), "Babar", "Rizwan", "Wanindu"); m.status = "live";
      for (let i = 0; i < 6; i++){ recordBall(currentInnings(m), { kind: "run", runs: 1 }); afterBall(m); }
      return m;
    };
    const m = tie({ superOver: true });
    assert(m.status === "complete" && m.result === "Match tied" && m.superOver === true, "a preset's super-over flag is kept on the match; a tie reads Match tied");
    assert(win.superOverError(m) === null, "a finished tie can go to a super over");
    const so = win.createSuperOver(JSON.parse(JSON.stringify(m)), "m1");
    const si = currentInnings(so);
    assert(so.battingFirst === "B" && si.oversLimit === 1 && si.maxWickets === 2 && si.lastManStands === false,
      "the super over: the side that batted second bats first, one over, two wickets");
    assert(JSON.stringify(so.superOverOf) === JSON.stringify({ id: "m1", n: 1, tiedOn: 6 }) && so.status === "opening", "it's linked to the tie (id, which one, the tied score)");
    assert(so.squads && so.squads.A.includes("Kusal") && so.squads.A.includes("Wanindu") && so.squads.B.includes("Babar") && so.squads.B.includes("Shaheen"),
      "each side's squad is everyone who played for it (batters, bowlers)");
    assert(win.playerSideConflict(so, "Kusal", "B"), "so nobody can turn out for the other side");
    assert(win.restartMatch(so, "A").superOverOf.n === 1, "a toss swap keeps it a super over");
    assert(win.commentaryBookends(so, 0).start[0] === "Super over: the match was tied on 6.", "its commentary opens with the tie");
    // Tigers 8, Lions chase 9 with a six and a four.
    win.openInnings(si, "Babar", "Rizwan", "Wanindu"); so.status = "live";
    [4, 4, 0, 0, 0, 0].forEach(r => { recordBall(currentInnings(so), { kind: "run", runs: r }); afterBall(so); });
    startSecondInnings(so);
    win.openInnings(currentInnings(so), "Kusal", "Pathum", "Shaheen"); so.status = "live";
    [6, 4].forEach(r => { recordBall(currentInnings(so), { kind: "run", runs: r }); afterBall(so); });
    assert(so.status === "complete" && so.result === "Lions won the super over", "the super over's own result: Lions won the super over");
    const rec = win.superOverRecord(so);
    assert(rec.winner === "A" && rec.n === 1 && !rec.innings[0].log && !rec.squads, "its record: winner, number, innings without logs");
    const settled = win.withSuperOvers(m, [rec]);
    assert(settled.result === "Match tied · Lions won the super over" && win.matchWinnerKey(settled) === "A", "the tie's result names the super-over winner");
    assert(/played/.test(win.superOverError(settled)), "a settled tie can't go to another super over");
    const tp = { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true };
    const table = Object.fromEntries(computeStandings([settled], tp).map(t => [t.name, t]));
    assert(table.Lions.won === 1 && table.Lions.points === 2 && table.Tigers.lost === 1 && table.Tigers.tied === 0, "standings count the super-over winner as a win");
    assert(table.Lions.runsFor === 6 && table.Tigers.runsFor === 6, "super-over runs stay out of NRR");
    const plain = Object.fromEntries(computeStandings([m], tp).map(t => [t.name, t]));
    assert(plain.Lions.tied === 1 && plain.Lions.points === 1, "without one it's a tie, tie points each");
    const kusal = aggregatePlayerStats([settled], win.eval("DEFAULT_POINTS_PRESETS[0]")).find(t => t.name === "Kusal");
    assert(kusal && kusal.runs === 3, "super-over runs stay out of player stats (Kusal: 3 in the match, 6 in the super over)");
    // A super over that ties too: another one, the other side batting first.
    const so2 = win.createSuperOver(JSON.parse(JSON.stringify(m)), "m1");
    win.openInnings(currentInnings(so2), "Babar", "Rizwan", "Wanindu"); so2.status = "live";
    for (let i = 0; i < 6; i++){ recordBall(currentInnings(so2), { kind: "run", runs: 1 }); afterBall(so2); }
    startSecondInnings(so2);
    win.openInnings(currentInnings(so2), "Kusal", "Pathum", "Shaheen"); so2.status = "live";
    for (let i = 0; i < 6; i++){ recordBall(currentInnings(so2), { kind: "run", runs: 1 }); afterBall(so2); }
    assert(so2.result === "Super over tied" && win.superOverError(so2) === null, "a tied super over: Super over tied, and another can follow");
    const level = win.withSuperOvers(m, [win.superOverRecord(so2)]);
    assert(level.result === "Match tied · super over tied" && win.superOverError(level) === null && win.matchWinnerKey(level) === null, "the tie stays level, and can go again");
    const next = win.createSuperOver(level, "m1");
    assert(next.superOverOf.n === 2 && next.battingFirst === "A", "the 2nd super over: the side that batted second in the 1st bats first");
    assert(win.commentaryBookends(next, 0).start[0] === "2nd super over: the last one was tied too.", "...and its commentary says so");
    // An edit that breaks the tie drops the super over.
    const broken = JSON.parse(JSON.stringify(settled));
    broken.innings[1].runs = 7; win.settleMatchStatus(broken);
    assert(!broken.superOvers && /^Tigers won/.test(broken.result), "a match that's no longer tied loses its super over");
    // Forfeiting a super over, and the preset words.
    const f = win.createSuperOver(JSON.parse(JSON.stringify(m)), "m1");
    forfeitMatch(f, "B");
    assert(f.result === "Lions won — Tigers forfeited the super over" && win.superOverRecord(f).winner === "A", "a forfeited super over is won by the other side");
    assert(win.describeMatchPreset(Object.assign({}, win.eval("DEFAULT_MATCH_PRESETS[0]"), { superOver: true })).some(([k, v]) => k === "If tied" && /super over/.test(v))
      && win.describeMatchPreset(win.eval("DEFAULT_MATCH_PRESETS[0]")).some(([k, v]) => k === "If tied" && v === "It stays a tie."), "a match preset's ⓘ says what a tie does");
    assert(win.describeTournamentPreset(Object.assign({}, win.eval("DEFAULT_TOURNAMENT_PRESETS[0]"), { superOver: true }), "T20").some(([k, v]) => k === "Ties" && /super over/.test(v)), "...and a tournament preset's");
    assert(win.conditionTagsFor({ oversLimit: 20, ballsPerOver: 6, playersPerSide: 11, superOver: true }).includes("super over"), "the preset card tags it");
  }

  // --- UI: a tie goes to a super over from Result, its result goes back into the tie ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {}; state.view = "home";
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A", superOver: true });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      startSecondInnings(state.match); openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      render();`);
    const tieId = win.eval("state.match.archivedId");
    const card = () => doc.querySelector("#app .super-over-card");
    assert(win.eval("state.match.result") === "Match tied" && card() && card().classList.contains("main")
      && /Tigers bat first/.test(card().textContent) && doc.querySelector('#app [data-action="finish-match"]').classList.contains("ghost"),
      "a tied match whose preset sends ties to a super over leads with it on Result (Tigers bat first), the exit button second");
    card().querySelector('[data-action="start-super-over"]').click();
    assert(win.eval("state.match.superOverOf.id") === tieId && win.eval("state.match.status") === "opening" && win.eval("state.match.battingFirst") === "B",
      "Start super over: a new match, linked to the tie, Tigers to bat");
    assert(/Super over · Lions v Tigers/.test(doc.querySelector(".topbar").textContent) && /Super over · Tigers/.test(doc.querySelector("#modal-root h2").textContent),
      "the top bar and the opening sheet say it's the super over");
    assert(/Babar/.test(doc.querySelector("#modal-root .bowler-pick-list").textContent) && !/Kusal/.test(doc.querySelector("#modal-root .bowler-pick-list").textContent),
      "the opening list offers the side's own players from the match");
    win.eval(`openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      [4, 4, 0, 0, 0, 0].forEach(r => handleBallClick(r));
      startSecondInnings(state.match); openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      handleBallClick(6); handleBallClick(4); render();`);
    assert(win.eval("state.match.result") === "Lions won the super over" && /SUPER OVER/.test(doc.querySelector("#app .result-hero .eyebrow").textContent)
      && /tied on 6/.test(doc.querySelector("#app .result-hero").textContent) && !doc.querySelector("#app .motm-card") && !card(),
      "the super over's Result: who won it, the tied score, no player of the match, no other super over");
    assert(win.eval(`state.matchHistory["${tieId}"].result`) === "Match tied · Lions won the super over" && win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === 1
      && win.eval("Object.keys(state.matchHistory).length") === 1, "it went into the tie's archive entry (no entry of its own)");
    win.eval(`handleUndo()`);
    assert(win.eval("state.match.status") === "live" && win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === 1, "Undo the winning ball: the tie keeps the result until it finishes again");
    win.eval(`handleBallClick(1); handleBallClick(2);`);
    assert(win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === 1 && win.eval(`state.matchHistory["${tieId}"].superOvers[0].innings[1].runs`) === 9, "...and finishing again replaces it in place");
    win.eval(`while (state.match.superOverOf) handleUndo(); render();`);
    assert(win.eval("state.match.archivedId") === tieId && win.eval("state.match.result") === "Match tied" && !win.eval(`state.matchHistory["${tieId}"].superOvers`)
      && win.eval(`state.matchHistory["${tieId}"].result`) === "Match tied" && card(), "Undo all the way out of it: back on the tie's Result, the super over gone from history");
    // From history: a tie archived on this phone can start its super over from the scorecard sheet.
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); render(); openMatchDetail("${tieId}");`);
    const sheetBtn = () => doc.querySelector('#modal-root .super-over-card [data-action="start-super-over"]');
    assert(sheetBtn() && sheetBtn().dataset.id === tieId, "the tie's scorecard sheet offers a super over");
    sheetBtn().click();
    assert(win.eval("state.match && state.match.superOverOf.id") === tieId && !win.eval("ui.matchDetail") && win.eval("state.snapshots.length") === 0, "...which starts it from history");
    win.eval(`askCancelMatch()`);
    assert(/Cancel this super over/.test(doc.querySelector("#confirm-root").textContent) && /keeps its result/.test(doc.querySelector("#confirm-root").textContent), "cancelling a super over says the match keeps its result");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(!win.eval("state.match") && win.eval(`state.matchHistory["${tieId}"].result`) === "Match tied", "...and leaves the tie as it was");
    // A settled tie's sheet shows the super over, and offers no other.
    win.eval(`state.matchHistory["${tieId}"] = withSuperOvers(state.matchHistory["${tieId}"], [{ n: 1, battingFirst: "B", winner: "A", result: "Lions won the super over",
      innings: JSON.parse(JSON.stringify(state.matchHistory["${tieId}"].innings)) }]); ui = defaultUi(); render(); openMatchDetail("${tieId}");`);
    assert(doc.querySelector("#modal-root .super-over-block") && /Lions won the super over/.test(doc.querySelector("#modal-root .super-over-block").textContent) && !sheetBtn(),
      "a settled tie's sheet shows its super over and offers no other");
    // The presets: a match preset and a tournament preset can send ties to a super over.
    win.eval(`ui = defaultUi(); state.view = "presets"; ui.editingMatchPreset = Object.assign({}, state.matchPresets[Object.keys(state.matchPresets)[0]]); render();`);
    const pf = doc.getElementById("match-preset-form");
    assert(pf && pf.elements.namedItem("superOver") && pf.elements.namedItem("superOver").type === "checkbox", "the match preset form has the super-over switch");
    pf.elements.namedItem("superOver").checked = true;
    assert(win.parseMatchPresetForm(new win.FormData(pf)).superOver === true, "...and saves it");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- super over: no limit -- tied ones are followed by another until one has a winner ---
  {
    const tie = () => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      win.openInnings(currentInnings(m), "Kusal", "Pathum", "Shaheen"); m.status = "live";
      for (let i = 0; i < 6; i++){ recordBall(currentInnings(m), { kind: "run", runs: 1 }); afterBall(m); }
      startSecondInnings(m);
      win.openInnings(currentInnings(m), "Babar", "Rizwan", "Wanindu"); m.status = "live";
      for (let i = 0; i < 6; i++){ recordBall(currentInnings(m), { kind: "run", runs: 1 }); afterBall(m); }
      return m;
    };
    // One super over: the first side scores `first`, the chase `second` (one ball each, then dots).
    const play = (so, first, second) => {
      const names = { A: ["Kusal", "Pathum", "Shaheen"], B: ["Babar", "Rizwan", "Wanindu"] };
      win.openInnings(currentInnings(so), ...names[so.battingFirst]); so.status = "live";
      [first, 0, 0, 0, 0, 0].forEach(r => { recordBall(currentInnings(so), { kind: "run", runs: r }); afterBall(so); });
      startSecondInnings(so);
      win.openInnings(currentInnings(so), ...names[so.battingFirst === "A" ? "B" : "A"]); so.status = "live";
      [second, 0, 0, 0, 0, 0].forEach(r => { if (so.status === "live"){ recordBall(currentInnings(so), { kind: "run", runs: r }); afterBall(so); } });
      return so;
    };
    let entry = tie();
    const firsts = [], results = [];
    for (let n = 1; n <= 4; n++){
      const so = win.createSuperOver(entry, "m1");
      firsts.push(so.battingFirst);
      play(so, 4, 4);
      results.push(so.result);
      assert(so.superOverOf.n === n && win.superOverError(so) === null, `super over ${n} tied: it's number ${n}, and another can follow`);
      entry = win.withSuperOvers(entry, [...(entry.superOvers || []), win.superOverRecord(so)]);
      assert(win.superOverError(entry) === null && win.matchWinnerKey(entry) === null, `after ${n} tied super over${n > 1 ? "s" : ""} the match can still go again`);
    }
    assert(JSON.stringify(results) === JSON.stringify(["Super over tied", "2nd super over tied", "3rd super over tied", "4th super over tied"]), "tied super overs are numbered from the 2nd: " + results.join(", "));
    assert(entry.result === "Match tied · 4th super over tied", "the tie's result names the last one");
    const fifth = play(win.createSuperOver(entry, "m1"), 6, 1);
    firsts.push(fifth.battingFirst);
    assert(JSON.stringify(firsts) === JSON.stringify(["B", "A", "B", "A", "B"]), "the side batting first swaps every super over (the one that batted second last time)");
    assert(fifth.superOverOf.n === 5 && fifth.result === "Tigers won the 5th super over", "the 5th decides it: Tigers won the 5th super over");
    entry = win.withSuperOvers(entry, [...entry.superOvers, win.superOverRecord(fifth)]);
    assert(entry.result === "Match tied · Tigers won the 5th super over" && win.matchWinnerKey(entry) === "B" && /played/.test(win.superOverError(entry)),
      "the tie names the winner and which super over; no 6th");
    const t = Object.fromEntries(computeStandings([entry], { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true }).map(x => [x.name, x]));
    assert(t.Tigers.won === 1 && t.Tigers.points === 2 && t.Lions.lost === 1 && t.Lions.points === 0 && t.Lions.runsFor === 6, "standings: one win for Tigers however many super overs it took, NRR from the match only");
    assert(win.superOverName(1) === "super over" && win.superOverName(1, true) === "1st super over" && win.superOverName(11) === "11th super over" && win.superOverName(22) === "22nd super over",
      "super overs are named 1st/2nd/3rd/4th…11th/22nd");
    const html = win.renderSuperOverSection(Object.assign({ id: "m1" }, entry));
    assert((html.match(/class="super-over-block"/g) || []).length === 5 && /1st super over/.test(html) && /5th super over/.test(html), "the scorecard lists all five, numbered");
  }

  // --- UI: a chain of tied super overs from Result, Undo out of the last one ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {}; state.view = "home";
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      startSecondInnings(state.match); openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      window.__soPlay = (first, second) => {
        const names = { A: ["Kusal", "Pathum", "Shaheen"], B: ["Babar", "Rizwan", "Wanindu"] };
        openInnings(currentInnings(state.match), ...names[state.match.battingFirst]); state.match.status = "live";
        [first, 0, 0, 0, 0, 0].forEach(r => handleBallClick(r));
        startSecondInnings(state.match); openInnings(currentInnings(state.match), ...names[state.match.battingFirst === "A" ? "B" : "A"]); state.match.status = "live";
        [second, 0, 0, 0, 0, 0].forEach(r => { if (state.match.status === "live") handleBallClick(r); });
        render();
      };
      render();`);
    const tieId = win.eval("state.match.archivedId");
    const startBtn = () => doc.querySelector('#app .super-over-card [data-action="start-super-over"]');
    assert(startBtn() && !doc.querySelector("#app .super-over-card.main") && doc.querySelector('#app [data-action="finish-match"]').classList.contains("primary"),
      "a tie with no super-over preset still offers one, second to the exit button");
    startBtn().click();
    for (let n = 1; n <= 3; n++){
      win.eval(`__soPlay(4, 4)`);
      const head = doc.querySelector("#app .super-over-card .super-over-head");
      assert(win.eval("state.match.result") === (n === 1 ? "Super over tied" : `${n}${["", "st", "nd", "rd"][n]} super over tied`)
        && doc.querySelector("#app .super-over-card.main") && head && head.textContent.includes(`${n + 1}${["", "st", "nd", "rd", "th"][n + 1]} super over`),
        `super over ${n} tied: Result leads with the ${n + 1}${["", "st", "nd", "rd", "th"][n + 1]}`);
      assert(win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === n, `...and the tie's history entry holds all ${n} so far`);
      startBtn().click();
      assert(win.eval("state.match.superOverOf.n") === n + 1 && win.eval("state.match.status") === "opening", `the ${n + 1}${["", "st", "nd", "rd", "th"][n + 1]} super over starts`);
    }
    assert(/4th super over · Lions v Tigers/.test(doc.querySelector(".topbar").textContent) && /4th super over · /.test(doc.querySelector("#modal-root h2").textContent), "the top bar and opening sheet number it");
    win.eval(`handleUndo(); render();`);
    assert(win.eval("state.match.superOverOf.n") === 3 && win.eval("state.match.status") === "complete" && win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === 3,
      "Undo on the 4th's opening sheet: back on the 3rd's Result, the three tied ones kept");
    startBtn().click();
    win.eval(`__soPlay(1, 6)`);
    assert(win.eval("state.match.result") === "Tigers won the 4th super over" && /4TH SUPER OVER/.test(doc.querySelector("#app .result-hero .eyebrow").textContent) && !startBtn(),
      "the 4th has a winner: no 5th offered");
    assert(win.eval(`state.matchHistory["${tieId}"].result`) === "Match tied · Tigers won the 4th super over" && win.eval(`state.matchHistory["${tieId}"].superOvers.length`) === 4
      && win.eval("Object.keys(state.matchHistory).length") === 1, "the tie's entry: all four super overs, Tigers won the 4th, still one match in history");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- UI: a guest tournament whose presets don't use super overs still gives a super-over winner the win points ---
  {
    const doc = win.document;
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {}; state.match = null;
      state.matchPresets["so-test"] = { id: "so-test", name: "One over", ballsPerOver: 6, oversLimit: 1, playersPerSide: 11,
        wide: { enabled: true, runs: 1 }, noBall: { enabled: true, runs: 1 }, freeHitOnNoBall: true, requireFielderOnCatch: false, requireFielderOnRunout: false, superOver: false };
      state.tournamentPresets["so-test-t"] = { id: "so-test-t", name: "League", matchPresetId: "so-test", pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true, superOver: false };
      state.teams["so-ta"] = { id: "so-ta", name: "Lions", playerIds: [] }; state.teams["so-tb"] = { id: "so-tb", name: "Tigers", playerIds: [] };
      const t = createTournament({ name: "Cup", tournamentPresetId: "so-test-t", teamIds: ["so-ta", "so-tb"] });
      state.activeTournamentId = t.id; state.view = "tournamentDashboard"; ui.tournamentTab = "fixtures"; render();`);
    const form = doc.getElementById("tournament-start-match-form");
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(win.eval("state.match && state.match.superOver") === false && win.eval("state.match.tournamentId") === win.eval("state.activeTournamentId"),
      "a tournament match started from presets without super overs has the flag off");
    win.eval(`
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      startSecondInnings(state.match); openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      for (let i = 0; i < 6; i++) handleBallClick(1);
      render();`);
    const tid = win.eval("state.activeTournamentId");
    const table = () => Object.fromEntries(win.eval(`JSON.stringify(computeStandings(state.tournaments["${tid}"].matchIds.map(id => state.matchHistory[id]), state.tournamentPresets["so-test-t"]))`)
      && JSON.parse(win.eval(`JSON.stringify(computeStandings(state.tournaments["${tid}"].matchIds.map(id => state.matchHistory[id]), state.tournamentPresets["so-test-t"]))`)).map(x => [x.name, x]));
    assert(table().Lions.tied === 1 && table().Lions.points === 1 && table().Tigers.points === 1, "tied, no super over yet: tie points each");
    doc.querySelector('#app .super-over-card [data-action="start-super-over"]').click();
    win.eval(`
      openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      [4, 0, 0, 0, 0, 0].forEach(r => handleBallClick(r));
      startSecondInnings(state.match); openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      [6].forEach(r => handleBallClick(r)); render();`);
    assert(win.eval(`state.tournaments["${tid}"].matchIds.length`) === 1, "the super over isn't a second tournament match");
    const t2 = table();
    assert(t2.Lions.won === 1 && t2.Lions.points === 2 && t2.Lions.tied === 0 && t2.Tigers.lost === 1 && t2.Tigers.points === 0,
      "super over played though the presets don't use them: Lions get the win points, Tigers the loss points");
    doc.querySelector('#app [data-action="finish-match"]').click();
    const rows = [...doc.querySelectorAll("#app .standings-table tbody tr")].map(r => [...r.cells].map(c => c.textContent.trim()).join(" "));
    assert(win.eval("state.view") === "tournamentDashboard" && /^Lions 1 1 0 0 2/.test(rows[0] || "") && /^Tigers 1 0 1 0 0/.test(rows[1] || "")
      && /Match tied · Lions won the super over/.test(doc.querySelector("#app .fixtures").textContent),
      "the tournament's points table and results show it: " + rows.join(" | "));
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; state.tournaments = {}; delete state.matchPresets["so-test"]; delete state.tournamentPresets["so-test-t"];
      delete state.teams["so-ta"]; delete state.teams["so-tb"]; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- a club tournament is its organizer's: back bar, Acting as and its matches follow it, not the last club screen ---
  {
    const doc = win.document;
    const tick = () => new Promise(r => setTimeout(r, 0));
    win.eval(`state.match = null; state.snapshots = [];
      window.__ctPrev = { session, client: supabaseClient, fetchT: fetchClubTournamentDetail, fetchC: fetchClubDetail, myClubs: fetchMyClubs };
      session = { user: { id: "u1" } }; supabaseClient = {};
      window.__clubs = {
        wc: { id: "wc", name: "Weekend Cricket", roster: [], members: [], matches: [], tournaments: [{ id: "WT", name: "Weekend Cup" }], presets: { match: [], tournament: [] }, invites: [], deletedMatchIds: [] },
        kc: { id: "kc", name: "KICC", roster: [], members: [], matches: [], tournaments: [{ id: "KT", name: "KICC Cup" }], presets: { match: [], tournament: [] }, invites: [], deletedMatchIds: [] } };
      fetchClubDetail = async id => { ui.club = __clubs[id]; };
      fetchMyClubs = async () => {};
      fetchClubTournamentDetail = async id => { ui.clubTournament = { id, name: id === "WT" ? "Weekend Cup" : "KICC Cup", organizer_club_id: id === "WT" ? "wc" : "kc", tournament_preset: {}, matches: [], teams: [] }; };
      ui = defaultUi(); ui.myClubs = [{ id: "kc", name: "KICC", role: "owner" }, { id: "wc", name: "Weekend Cricket", role: "owner" }];
      ui.currentClubId = "kc";                       // a KICC screen was open last...
      state.activeClubId = "wc"; ui.club = __clubs.wc; // ...then "Acting as" switched to Weekend Cricket
      state.view = "home"; render();`);
    doc.querySelector('#app [data-action="open-club-tournament"][data-id="WT"]').click();
    await tick(); await tick();
    const back = () => (doc.querySelector("#app .back-bar") || {}).textContent || "";
    assert(/Weekend Cricket/.test(back()) && win.eval("state.activeClubId") === "wc" && win.eval("ui.currentClubId") === "wc" && win.location.hash === "#/clubs/wc/tournaments/WT",
      "a Weekend Cricket tournament opened from Home: its back bar is Weekend Cricket's and Acting as stays on it: " + back().trim() + " " + win.location.hash);
    // However it was reached (a link, back, a stale club id), the loaded tournament's organizer wins.
    win.eval(`ui.currentClubId = "kc"; ui.currentTournamentId = "WT"; ui.clubTournament = null; state.view = "clubTournamentDashboard"; render();`);
    await tick(); await tick();
    assert(/Weekend Cricket/.test(back()) && win.eval("state.activeClubId") === "wc" && win.eval("ui.currentClubId") === "wc",
      "a stale club id is put right once the tournament loads: " + back().trim());
    doc.querySelector('#app .back-bar').click();
    assert(win.eval("state.view") === "home" && win.eval("state.activeClubId") === "wc", "...and back lands on Weekend Cricket's Home");
    // A match started from it is the organizer's, even if a stale club id slipped through.
    win.eval(`ui.currentTournamentId = "WT"; ui.clubTournament = null; state.view = "clubTournamentDashboard"; render();`);
    await tick(); await tick();
    doc.querySelector('#app [data-action="go-club-tournament-match-setup"]').click();
    const setupForm = doc.getElementById("match-setup-form");
    setupForm.querySelector('[name="teamA"]').value = "Reds"; setupForm.querySelector('[name="teamB"]').value = "Blues";
    win.eval(`ui.currentClubId = "kc";`);
    setupForm.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(win.eval("state.match && state.match.clubId") === "wc" && win.eval("state.match.tournamentId") === "WT",
      "a match started from Weekend Cricket's tournament is Weekend Cricket's, never the last club screen's: " + win.eval("state.match && state.match.clubId"));
    win.eval(`({ session, client: supabaseClient, fetchT: fetchClubTournamentDetail, fetchC: fetchClubDetail, myClubs: fetchMyClubs } = window.__ctPrev);
      state.match = null; state.snapshots = []; state.activeClubId = null; state.viewClubId = null; state.viewTournamentId = null; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- Opening the app: Home, not the screen it was last left on (a URL that names a screen still opens it) ---
  {
    const saved = (view, extra) => w => w.localStorage.setItem("cricket.lk.v2", JSON.stringify(Object.assign({
      view, activeTournamentId: "t1", viewClubId: "c1", viewTournamentId: "ct1",
      tournaments: { t1: { id: "t1", name: "Summer Cup", tournamentPresetId: null, teamIds: [], matchIds: [] } }
    }, extra || {})));
    const open = async (url, view, extra) => {
      const d = new JSDOM(html, { runScripts: "dangerously", url, beforeParse: saved(view, extra) });
      await wait(50);
      return d.window;
    };
    let w = await open("http://localhost/", "tournamentDashboard");
    assert(w.eval("state.view") === "home" && w.location.hash === "#/" && w.document.querySelector('#app [data-action="go-match-setup"]'),
      "launched from the icon (no screen in the URL), the app opens on Home, not the guest tournament it was last on: " + w.location.hash);
    w.close();
    w = await open("http://localhost/index.html", "clubTournamentDashboard");
    assert(w.eval("state.view") === "home" && w.location.hash === "#/", "...nor the club tournament it was last on");
    w.close();
    w = await open("http://localhost/#/tournaments/t1", "home");
    assert(w.eval("state.view") === "tournamentDashboard" && /Summer Cup/.test(w.document.querySelector("#app").textContent),
      "a URL that names a screen (a reload, a link) still opens it");
    w.close();
    const live = JSON.parse(JSON.stringify(win.createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" })));
    w = await open("http://localhost/", "tournamentDashboard", { match: live });
    assert(w.location.hash === "#/live" && w.document.querySelector("#opening-form"), "a match in progress still comes back when the app opens: " + w.location.hash);
    w.close();
  }

  // --- Guest edition (the Android app, mobile/): the same page with the flag set, no cloud ---
  {
    const guestHtml = html.replace("<script>", '<script>window.CRICKET_LK_EDITION = "guest";</script><script>');
    const gdom = new JSDOM(guestHtml, { runScripts: "dangerously", url: "http://localhost/#/premier/players" });
    const gw = gdom.window, gd = gw.document;
    await wait(50);
    assert(gw.GUEST_EDITION === true && win.GUEST_EDITION === false, "the guest edition flag is on only when the page sets it");
    assert(gw.eval("state.view") === "home" && gw.eval("supabaseClient") === null,
      "guest edition: opened on a Premier link it lands on Home, with no cloud client");
    assert(!gd.querySelector('#app [data-action="go-account"]') && !gd.getElementById("home-club-switcher")
      && gd.querySelector('#app [data-action="go-match-setup"]'),
      "guest edition: no Sign in in the top bar, no Acting as switcher, New match still there");
    gd.querySelector('#app [data-action="open-side-menu"]').click();
    const menu = [...gd.querySelectorAll(".side-menu .side-menu-item")].map(b => b.textContent.trim().replace(/\s+/g, " "));
    assert(!menu.some(t => /Premier|Sign in|Account|How to use/.test(t)) && ["Teams", "Players", "Presets", "Stats", "Settings"].every(x => menu.some(t => t.includes(x))),
      "guest edition: the side menu lists only on-device screens: " + menu.join(", "));
    const cloudRoutes = ["/premier", "/premier/players/p1", "/clubs", "/clubs/c1/players", "/clubs/c1/tournaments/t1", "/sign-in", "/account", "/t/abc"];
    assert(cloudRoutes.every(r => gw.eval(`parseRoute(${JSON.stringify(r)}).view`) === "home"), "guest edition: every cloud route goes to Home");
    assert(gw.eval('parseRoute("/stats").view') === "stats" && gw.eval('parseRoute("/tournaments/t1").view') === "tournamentDashboard"
      && gw.eval('parseRoute("/live").view') === "match" && gw.eval('parseRoute("/new-match").view') === "matchSetup",
      "guest edition: on-device routes still work");
    gw.eval('ui.sideMenuOpen = false; state.view = "premierPlayers"; state.activeClubId = "c1"; render();');
    assert(gw.eval("state.view") === "home" && gw.eval("state.activeClubId") === null, "guest edition: a saved cloud view or club falls back to guest Home");
    assert(win.eval('parseRoute("/premier").view') === "premier" && win.eval('parseRoute("/clubs/c1/players").view') === "clubPlayers",
      "web edition: cloud routes unchanged");
    gw.close();
  }

  // --- A claimed player sees the clubs they play for, read only (supabase/020) ---
  {
    win.eval(`state.match = null; state.snapshots = []; window.__prevSession = session; window.__prevClient = supabaseClient;
      session = { user: { id: "u7" } }; ui = defaultUi();
      supabaseClient = {
        from(){ const q = { select(){ return q; }, eq(){ return q; },
          then: (ok, no) => Promise.resolve({ data: [{ role: "owner", clubs: { id: "own", name: "My XI" } }], error: null }).then(ok, no) }; return q; },
        rpc: async (fn) => fn === "my_player_clubs" ? { data: [{ id: "kicc", name: "KICC" }, { id: "own", name: "My XI" }], error: null } : { data: null, error: { code: "PGRST202" } }
      };`);
    await win.eval(`fetchMyClubs()`);
    assert(win.eval(`JSON.stringify(ui.myClubs.map(c => c.id + ":" + c.role))`) === JSON.stringify(["own:owner", "kicc:player"]),
      "My clubs: clubs the user plays for come in as 'player' (a club they're a member of keeps its own role)");
    assert(win.eval(`clubCanEdit("kicc")`) === false && win.eval(`clubCanEdit("own")`) === true && win.eval(`clubCanEdit("unknown")`) === true && win.eval(`isClubAdmin("kicc")`) === false,
      "a player can't edit or administer the club; a member can; an unknown club isn't locked");
    win.eval(`supabaseClient = window.__prevClient; state.view = "myClubs"; render();`);
    assert(/player · view only/.test(doc.querySelector("#app").textContent), "My clubs labels a club the user plays for 'player · view only'");

    win.eval(`ui.club = { id: "kicc", name: "KICC", members: [], invites: [], roster: [{ id: "d1", name: "Dulanjana" }, { id: "d2", name: "Kasun" }], matches: [],
        tournaments: [{ id: "kt", name: "KICC Cup", created_at: new Date().toISOString() }], presets: { match: [], tournament: [], points: [] } };
      state.activeClubId = "kicc"; state.view = "home"; render();`);
    const app = () => doc.querySelector("#app");
    assert(!app().querySelector('[data-action="go-club-match-setup"]') && !app().querySelector('[data-action="go-club-tournament-setup"]')
      && !app().querySelector('[data-view="clubPresets"]') && !app().querySelector('[data-view="clubAdmins"]'),
      "Home acting as a club you play for: no new match / tournament, Presets or Admins");
    assert(app().querySelector('.primary-card[data-view="clubStats"]') && app().querySelector('[data-view="clubPlayers"]')
      && app().querySelector('[data-action="open-club-tournament"][data-id="kt"]') && /You play for KICC: view only/.test(app().textContent),
      "...but Stats, Players and the club's tournaments, and it says it's view only");
    win.eval(`ui.sideMenuOpen = true; render();`);
    assert(!doc.querySelector('.side-menu [data-view="clubPresets"]') && doc.querySelector('.side-menu [data-view="clubStats"]'), "the side menu leaves out Presets too");
    win.eval(`ui.sideMenuOpen = false; ui.currentClubId = "kicc"; state.view = "clubPlayers"; render();`);
    assert(app().querySelectorAll(".roster-row").length === 2 && !app().querySelector(".roster-remove") && !doc.querySelector('[data-action="open-club-add-player"]'),
      "Players: the roster, with no add or remove");
    // A write reached anyway is refused.
    const fake = doc.createElement("button"); fake.dataset.action = "open-club-add-player"; app().appendChild(fake); fake.click();
    assert(win.eval("ui.playerModal") === null, "a club write action is refused for a player even if a button for it is tapped");
    win.eval(`ui.clubMatchSetupType = "practice"; state.view = "matchSetup"; render();`);
    assert(win.eval("state.view") === "home", "club match setup sends a player back Home (a link or a reload can't open it)");
    win.eval(`ui.currentClubId = "kicc"; state.view = "clubPresets"; render();`);
    assert(win.eval("state.view") === "home", "...and so does the club's Presets screen");

    win.eval(`ui.currentClubId = "kicc"; ui.currentTournamentId = "kt"; ui.clubMatchSetupType = null;
      ui.clubTournament = { id: "kt", name: "KICC Cup", organizer_club_id: "kicc", tournament_preset: { pointsForWin: 2 }, matches: [],
        teams: [{ id: "tm1", name: "Reds", players: [{ id: "d1", name: "Dulanjana" }] }] };
      ui.tournamentTab = "overview"; state.view = "clubTournamentDashboard"; render();`);
    assert(!app().querySelector('[data-action="go-club-tournament-match-setup"]') && !app().querySelector('[data-action="open-result-entry"]')
      && !app().querySelector('[data-action="end-tournament"]'), "a club tournament: no Start match, Enter result or End tournament for a player");
    win.eval(`ui.tournamentTab = "teams"; render();`);
    assert(app().querySelector(".team-card") && !app().querySelector('[data-action="edit-tournament-team"]') && !app().querySelector('[data-action="new-tournament-team"]'),
      "its Teams tab shows the teams with no edit, delete or add");
    win.eval(`ui.clubTournament.tournament_preset.endedAt = Date.now(); ui.tournamentTab = "summary"; render();`);
    assert(!app().querySelector('[data-action="reopen-tournament"]') && app().querySelector('[data-action="share-tournament"]'), "an ended tournament's Summary: share it, but no Reopen");

    // A member of the same kind of club still gets everything.
    win.eval(`ui.myClubs = [{ id: "kicc", name: "KICC", role: "owner" }]; delete ui.clubTournament.tournament_preset.endedAt; ui.tournamentTab = "overview"; render();`);
    assert(app().querySelector('[data-action="go-club-tournament-match-setup"]') && app().querySelector('[data-action="open-result-entry"]'), "a member's dashboard keeps Start match and Enter result");
    win.eval(`state.view = "home"; render();`);
    assert(app().querySelector('[data-action="go-club-match-setup"]') && app().querySelector('[data-view="clubPresets"]') && !/view only/.test(app().textContent), "a member's Home keeps the match tiles and Presets");

    win.eval(`session = window.__prevSession; supabaseClient = window.__prevClient; state.activeClubId = null;
      ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- UI: ending the chase with overs and wickets left asks whether a team forfeited; the first innings just ends ---
  {
    const doc = win.document;
    const sheet = () => doc.querySelector("#confirm-root .confirm-modal");
    const ok = () => doc.querySelector('#confirm-root [data-action="confirm-ok"]');
    const pick = v => doc.querySelector(`#confirm-root [data-action="confirm-pick"][data-value="${v}"]`).click();
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A" });
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Wanindu"); state.match.status = "live";
      for (let i = 0; i < 3; i++) handleBallClick(1);
      handleEndInnings();`);
    assert(sheet() && !doc.querySelector('#confirm-root [data-action="confirm-pick"]') && !/forfeit/i.test(sheet().textContent)
      && /End this innings\?/.test(sheet().textContent) && /Tigers will need 4 to win/.test(sheet().textContent) && !ok().disabled && ok().textContent.trim() === "End innings",
      "the first innings cut short (0.3 of 2 overs) just asks to end it, as before: no forfeit question");
    ok().click();
    assert(win.eval("state.match.status") === "innings_break" && !win.eval("state.match.forfeited") && win.eval("state.match.innings[0].completeReason") === "closed",
      "...and it's the innings break, Tigers needing 4");

    // The chase cut short (0.2 of 2 overs): it asks whether a team forfeited.
    win.eval(`{ const m = state.match; startSecondInnings(m); openInnings(currentInnings(m), "Babar", "Rizwan", "Dushmantha"); m.status = "live";
      handleBallClick(1); handleBallClick(1); }
      handleEndInnings();`);
    const values = [...doc.querySelectorAll('#confirm-root [data-action="confirm-pick"]')].map(b => b.dataset.value);
    assert(values.join() === "end,B,A" && /Did a team forfeit\?/.test(sheet().textContent) && /1\.4 overs and 10 wickets left/.test(sheet().textContent),
      "the chase cut short at 0.2 of 2 overs asks: no forfeit, Tigers or Lions forfeited");
    assert(/Lions won by 1 run/.test(sheet().textContent) && ok().disabled && ok().textContent.trim() === "End match",
      "'No forfeit' shows the result the scores give; nothing happens until one is picked");
    pick("end");
    assert(!ok().disabled, "No forfeit → End match");
    ok().click();
    assert(win.eval("state.match.status") === "complete" && !win.eval("state.match.forfeited") && win.eval("state.match.result") === "Lions won by 1 run",
      "No forfeit ends the match on the scores");
    win.eval(`handleUndo();`);
    assert(win.eval("state.match.status") === "live", "(Undo brings it back)");
    win.eval(`handleEndInnings();`);
    pick("B");
    assert(ok().textContent.trim() === "End match", "a team picked → End match");
    ok().click();
    const id = win.eval("state.match.archivedId");
    assert(win.eval("state.match.forfeited") && win.eval("state.match.forfeitedBy") === "B" && win.eval("state.match.status") === "complete"
      && win.eval("state.match.result") === "Lions won — Tigers forfeited the match" && id && win.eval(`!!state.matchHistory["${id}"]`),
      "Tigers forfeited: the match ends as a forfeit and is archived");
    const table = Object.fromEntries(win.eval(`computeStandings(Object.values(state.matchHistory), { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true })`).map(t => [t.name, t]));
    assert(table.Lions.points === 2 && table.Tigers.runsFor === 2 && Math.abs(table.Tigers.oversFor - 2 / 6) < 1e-9 && table.Lions.runsFor === 3,
      "its standings: Lions get the win, and Tigers' 2 off 0.2 overs count for NRR");
    win.eval(`ui.confirm = null;`);

    // A super over's first innings: no question either.
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 3, battingFirst: "B" });
      state.match.superOverOf = { id: "x", n: 1, tiedOn: 6 };
      openInnings(currentInnings(state.match), "Babar", "Rizwan", "Wanindu"); state.match.status = "live";
      handleBallClick(4); handleEndInnings();`);
    assert(!doc.querySelector('#confirm-root [data-action="confirm-pick"]') && /End this innings\?/.test(sheet().textContent), "a super over's first innings just ends too");
    win.eval(`ui.confirm = null;`);

    // No overs limit: closing the chase by hand is how it normally ends, so it only confirms.
    win.eval(`
      ui = defaultUi(); state.snapshots = [];
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: null, playersPerSide: 11, battingFirst: "A" });
      { const m = state.match; openInnings(currentInnings(m), "Kusal", "Pathum", "Wanindu"); m.status = "live";
        handleBallClick(1); endInnings(m); startSecondInnings(m); openInnings(currentInnings(m), "Babar", "Rizwan", "Dushmantha"); m.status = "live"; }
      handleBallClick(1); handleEndInnings();`);
    assert(!doc.querySelector('#confirm-root [data-action="confirm-pick"]') && !ok().disabled && /End the match now\?/.test(sheet().textContent)
      && /worked out from the scores/.test(sheet().textContent), "no overs limit: ending the chase asks only to confirm");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); save(); render();`);
  }

  // --- UI: a forfeited match can be edited (on Result, and later from match history), and its forfeit changed ---
  {
    const doc = win.document;
    const submit = id => doc.getElementById(id).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const sheet = () => doc.querySelector("#confirm-root .confirm-modal");
    const ok = () => doc.querySelector('#confirm-root [data-action="confirm-ok"]');
    const pick = v => doc.querySelector(`#confirm-root [data-action="confirm-pick"][data-value="${v}"]`).click();
    const app = () => doc.getElementById("app");
    // Lions 6-0 (1 ov); Tigers 3-0 after 0.3 of the chase (need 7), then Tigers forfeit.
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      { const m = state.match;
        openInnings(currentInnings(m), "Kusal", "Pathum", "Wanindu"); m.status = "live";
        for (let i = 0; i < 6; i++) handleBallClick(1);
        startSecondInnings(m); openInnings(currentInnings(m), "Babar", "Rizwan", "Dushmantha"); m.status = "live";
        for (let i = 0; i < 3; i++) handleBallClick(1); }
      askForfeit();`);
    pick("B"); ok().click();
    const id = win.eval("state.match.archivedId");
    const entry = () => win.eval(`state.matchHistory["${id}"]`);
    assert(id && entry().forfeited && entry().result === "Lions won — Tigers forfeited the match", "(setup) Tigers forfeited the chase at 3-0, archived");
    assert(/Undo forfeit/.test(app().querySelector(".go-back-row").textContent) && !app().querySelector('[data-action="change-forfeit"]'),
      "right after it, Result offers Undo forfeit (not Change the forfeit)");
    doc.querySelector('#app [data-action="toggle-scorecard"]').click();
    win.eval(`ui.scorecard = { inn: null, mode: "balls" }; render();`);
    assert(doc.querySelectorAll('#app [data-action="edit-ball"]').length === 3, "Result: the forfeited chase's balls can be tapped to edit");
    doc.querySelector('#app [data-action="finish-match"]').click();

    // later, from match history
    win.eval(`openMatchDetail("${id}")`);
    assert(doc.querySelector('#modal-root [data-action="edit-archived-match"]') && !/can't be edited/.test(doc.getElementById("modal-root").textContent),
      "its scorecard sheet in match history offers Edit match");
    doc.querySelector('#modal-root [data-action="edit-archived-match"]').click();
    assert(win.eval("state.match.forfeited && state.match.editingFromHistory && state.match.status === 'complete'") && doc.querySelectorAll('#app [data-action="edit-ball"]').length === 3,
      "Edit match: Result, forfeited, every ball of the chase editable");
    const plus = doc.querySelector('#app [data-action="add-ball"]');
    assert(plus && plus.dataset.label === "0.3" && !/· now/.test(app().querySelector(".ball-by-ball").textContent),
      "the over the forfeit cut short isn't 'now', and ends in a + for a missed ball");
    assert(app().querySelector('[data-action="change-forfeit"]') && !app().querySelector('.go-back-row [data-action="undo"]'), "from history: Change the forfeit, no Undo yet");

    // a ball changed: still forfeited, the archive entry follows
    doc.querySelector('#app [data-action="edit-ball"][data-label="0.1"]').click();
    doc.querySelector('#modal-root [data-field="runs"][data-value="2"]').click();
    submit("ball-edit-form");
    assert(/3-0 \(0\.3\) → 4-0 \(0\.3\)/.test(sheet().textContent) && !/Result:/.test(sheet().textContent), "review: Tigers 3-0 → 4-0, the result stays");
    ok().click();
    assert(entry().innings[1].runs === 4 && entry().forfeited && entry().result === "Lions won — Tigers forfeited the match" && Object.keys(win.eval("state.matchHistory")).length === 1,
      "saved: the archive entry (same id) has 4-0 and is still forfeited");

    // a ball that takes them past the target: the forfeit goes
    doc.querySelector('#app [data-action="edit-ball"][data-label="0.2"]').click();
    doc.querySelector('#modal-root [data-field="runs"][data-value="4"]').click();
    assert(/Tigers won by 10 wickets/.test(doc.querySelector("#modal-root .ball-edit-modal").textContent) && /forfeit no longer counts/.test(doc.querySelector("#modal-root .ball-edit-modal").textContent),
      "the preview says Tigers now win, and why the forfeit goes");
    submit("ball-edit-form"); ok().click();
    assert(!entry().forfeited && /Tigers won by 10 wickets/.test(entry().result) && !app().querySelector('[data-action="change-forfeit"]'), "saved: the result comes from the scores");
    const undo = app().querySelector('.go-back-row [data-action="undo"]');
    assert(undo && /Undo last change/.test(undo.textContent), "Undo is offered for it");
    undo.click();
    assert(entry().forfeited && entry().innings[1].runs === 4, "Undo: forfeited again, in the archive too");

    // the other side forfeited instead
    app().querySelector('[data-action="change-forfeit"]').click();
    assert(/Who forfeited\?/.test(sheet().textContent) && ok().disabled && [...doc.querySelectorAll('#confirm-root [data-action="confirm-pick"]')].map(b => b.dataset.value).join() === "none,A",
      "Change the forfeit: nobody, or Lions instead");
    assert(/Tigers bat on from 4-0 \(0\.3\)/.test(sheet().textContent), "'nobody' says where the match picks up");
    pick("A");
    assert(ok().textContent.trim() === "Change result", "Lions picked → Change result");
    ok().click();
    assert(entry().forfeitedBy === "A" && entry().result === "Tigers won — Lions forfeited the match" && win.eval("state.match.status") === "complete" && Object.keys(win.eval("state.matchHistory")).length === 1,
      "Lions forfeited instead: the same archive entry, the result changed");
    win.eval("handleUndo()");
    assert(entry().forfeitedBy === "B", "(Undo puts Tigers' forfeit back)");

    // nobody forfeited: the chase carries on, and finishing it replaces the same entry
    app().querySelector('[data-action="change-forfeit"]').click();
    assert(/match history keeps the forfeit/.test(sheet().textContent), "the sheet says history keeps the forfeit until it finishes again");
    pick("none");
    assert(ok().textContent.trim() === "Carry on the match", "nobody → Carry on the match");
    ok().click();
    assert(win.eval("state.match.status") === "live" && !win.eval("state.match.forfeited") && win.eval("state.match.reopenedFrom") === id && entry().forfeited,
      "live again from 4-0 (0.3), tied to its archive entry, which keeps the forfeit meanwhile");
    win.eval("handleUndo()");
    assert(win.eval("state.match.forfeited") && win.eval("state.match.archivedId") === id && win.eval("state.match.status") === "complete", "Undo: back to the forfeit");
    app().querySelector('[data-action="change-forfeit"]').click(); pick("none"); ok().click();
    win.eval(`handleBallClick(1); handleBallClick(0); handleBallClick(0);`);
    assert(win.eval("state.match.status") === "complete" && win.eval("state.match.archivedId") === id && entry().result === "Lions won by 1 run" && !entry().forfeited
      && Object.keys(win.eval("state.matchHistory")).length === 1, "finished on the scores: Lions won by 1 run, in the same archive entry");
    doc.querySelector('#app [data-action="finish-match"]').click();

    // Set the final score, forfeited at the break (Tigers never batted)
    win.eval(`
      ui = defaultUi(); state.snapshots = []; state.matchHistory = {};
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      { const m = state.match; openInnings(currentInnings(m), "Kusal", "Pathum", "Wanindu"); m.status = "live";
        for (let i = 0; i < 4; i++) handleBallClick(1); }
      pushSnapshot(); forfeitMatch(state.match, "A"); maybeArchiveCompletedMatch(state.match); save();
      ui.scoreSet = { error: null }; render();`);
    const ss = doc.querySelector("#modal-root .score-set-modal");
    assert(ss && /At the forfeit/.test(ss.textContent) && !ss.querySelector('input[name^="goon"]') && /Didn't bat: the match was forfeited first/.test(ss.textContent) && !ss.querySelector('input[name="runs1"]'),
      "Set the final score: Lions 'at the forfeit' (no carry-on box), Tigers didn't bat (no boxes)");
    ss.querySelector('input[name="runs0"]').value = "9";
    submit("score-set-form"); ok().click();
    assert(win.eval("state.match.forfeited") && win.eval("state.match.innings[0].runs") === 9 && !win.eval("state.match.innings[0].complete")
      && win.eval(`state.matchHistory[state.match.archivedId].innings[0].runs`) === 9, "set to 9: still forfeited mid-innings, archive replaced");
    win.eval(`state.match = null; state.snapshots = []; state.matchHistory = {}; ui = defaultUi(); save(); render();`);
  }

  // --- a player's performance over a screen's matches: tap a name in a leaderboard; a tournament's My stats tab ---
  {
    const totals = [
      { name: "Kusal", points: 10, runs: 30, innings: 2, wickets: 0, bowlInnings: 0 },
      { name: "Babar", points: 20, runs: 10, innings: 1, wickets: 3, bowlInnings: 2 },
      { name: "kusal mendis", points: 15, runs: 5, innings: 1, wickets: 1, bowlInnings: 1 },
      { name: "Shaheen", points: 4, runs: 0, innings: 0, wickets: 1, bowlInnings: 2 }];
    let r = win.playerRanks(["Kusal Mendis", "Kusal"], totals);
    assert(JSON.stringify(r) === JSON.stringify({ points: { place: 1, of: 3 }, runs: { place: 1, of: 2 }, wickets: { place: 2, of: 3 } }),
      "playerRanks folds every name (any case): 25 pts 1st of 3, 35 runs 1st of 2 batters, 1 wicket 2nd of 3 bowlers");
    r = win.playerRanks("Shaheen", totals);
    assert(r.points.place === 4 && r.points.of === 4 && r.runs === null && r.wickets.place === 2 && r.wickets.of === 3,
      "last for points; one wicket, level with Kusal Mendis's, shares 2nd place; no runs, no runs rank");
    assert(JSON.stringify(win.playerRanks("Nobody", totals)) === JSON.stringify({ points: null, runs: null, wickets: null }), "someone not in the table has no ranks");

    const doc = win.document;
    const sheet = () => doc.querySelector("#modal-root .player-stats-modal");
    win.eval(`
      window.__prev = { client: supabaseClient, session, cache: cloudCache, fetchPlayerProfile, fetchPlayerAliases, fetchPlayerMatches, fetchMyPlayerIdentity };
      { const mk = (id, opener, when) => {
          const mm = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
          openInnings(currentInnings(mm), opener, "Pathum", "Shaheen"); mm.status = "live";
          [4, 1, 1, 6, 0, 1].forEach(r => { recordBall(currentInnings(mm), { kind: "run", runs: r }); afterBall(mm); });
          startSecondInnings(mm); openInnings(currentInnings(mm), "Babar", "Rizwan", "Wanindu"); mm.status = "live";
          [1, 0, { kind: "wicket", wicketType: "caught", fielder: opener }, 1, 0, 0].forEach(r => { recordBall(currentInnings(mm), typeof r === "number" ? { kind: "run", runs: r } : r);
            if (pendingBatsmanSlot(currentInnings(mm))) sendInBatter(currentInnings(mm), "Fakhar"); afterBall(mm); });
          mm.id = id; mm.completedAt = when; mm.clubId = "c1"; mm.tournamentId = "t1";
          return { id, data: JSON.parse(JSON.stringify(archivedCopy(mm))) }; };
        // Kusal Mendis opens in one match, and plays as "Kusal" (a name merged into his profile) in the other.
        window.__rows = [mk("pm1", "Kusal Mendis", 1000), mk("pm2", "Kusal", 2000)]; }
      ui = defaultUi(); state.match = null; state.view = "publicTournament"; ui.publicTournamentId = "t1"; ui.myClubs = [];
      ui.publicTournament = { id: "t1", name: "Summer Cup", clubName: "KICC", clubId: "c1", preset: { pointsForWin: 2 }, matches: __rows, points: DEFAULT_POINTS_PRESETS[0], loadedAt: Date.now() };
      session = { user: { id: "u1" } }; supabaseClient = {};
      ui.identity = { myPlayer: { id: "k1", name: "Kusal Mendis", aliases: ["Kusal"] }, pendingClaim: null, pendingMerges: [] };
      render();`);
    const tabIds = () => [...doc.querySelectorAll('#app [data-action="switch-tournament-tab"]')].map(b => b.dataset.tab).join();
    assert(tabIds() === "overview,fixtures,stats,me" && doc.querySelector('#app [data-tab="me"]').textContent.trim() === "My stats"
      && !doc.querySelector("#app .tab-row.main-tabs.many"), "a signed-in player who played in the tournament gets a My stats tab of their own, last (four tabs still share the width)");
    assert(!doc.querySelector("#app .my-stats-tab") && !doc.querySelector("#app .you-tag"), "Overview stays about everyone: nothing personal on it");
    win.eval(`ui.tournamentTab = "stats"; render();`);
    const meRows = [...doc.querySelectorAll("#app td.lb-me")].map(td => td.querySelector(".lb-name-btn").textContent);
    assert(!doc.querySelector("#app .my-stats-tab") && meRows.sort().join() === "Kusal,Kusal Mendis" && doc.querySelectorAll("#app td.lb-me .you-tag").length === 2,
      "Stats: no personal section, just both of his names' rows tagged You");
    doc.querySelector('#app [data-tab="me"]').click();
    const tabEl = () => doc.querySelector("#app .my-stats-tab");
    const runs = win.eval(`playerCareer(["Kusal Mendis", "Kusal"], ui.publicTournament.matches.map(r => r.data), DEFAULT_POINTS_PRESETS[0]).runs`);
    assert(tabEl() && /Kusal Mendis/.test(tabEl().querySelector("h2").textContent) && tabEl().querySelector("h2 .you-tag") && /Summer Cup · for Lions/.test(tabEl().textContent)
      && /Also counted: played as Kusal/.test(tabEl().textContent),
      "My stats: his name tagged You, the tournament and his side, and the merged name it counted");
    const runTile = [...tabEl().querySelectorAll(".stat-tile")].find(t => t.querySelector(".stat-label").textContent === "Runs");
    assert(runTile && runTile.querySelector(".stat-num").textContent === String(runs) && /2 matches/.test(tabEl().textContent) && /MVP #\d+ of \d+/.test(tabEl().textContent)
      && /Catches/.test(tabEl().textContent), `batting, bowling and fielding over both matches (${runs} runs), with where he ranks`);
    const rows = tabEl().querySelectorAll('.fixtures [data-action="open-match-detail"]');
    assert(rows.length === 2 && rows[0].dataset.id === "pm2" && /For Lions/.test(rows[0].textContent) && tabEl().querySelector('[data-action="open-my-profile-from-stats"]'),
      "match by match, newest first, each his own line; and a way to his full profile");
    rows[0].click();
    assert(doc.querySelector("#modal-root .scorecard-modal"), "a match opens its scorecard");
    win.eval("closeTopOverlay()");
    // His own name in the table opens the same figures as a sheet.
    win.eval(`ui.tournamentTab = "stats"; render();`);
    doc.querySelector('#app td.lb-me .lb-name-btn[data-name="Kusal Mendis"]').click();
    assert(sheet() && sheet().querySelector("h2 .you-tag") && /Also counted: played as Kusal/.test(sheet().textContent) && sheet().querySelectorAll('.fixtures [data-action="open-match-detail"]').length === 2,
      "his own row's name opens his sheet, every name of his counted");
    sheet().querySelectorAll('.fixtures [data-action="open-match-detail"]')[0].click();
    assert(doc.querySelector("#modal-root .scorecard-modal") && !sheet(), "a match opens its scorecard over the sheet");
    win.eval("closeTopOverlay()");
    assert(sheet() && !doc.querySelector("#modal-root .scorecard-modal"), "closing (or back) returns to the sheet");
    win.eval("closeTopOverlay()");
    win.eval(`fetchPlayerProfile = async () => ({ data: { id: "k1", name: "Kusal Mendis", claimed_by: "u1" } });
      fetchPlayerAliases = async () => ["Kusal"]; fetchPlayerMatches = async () => ({ rows: [] }); fetchMyPlayerIdentity = async () => {}; ui.premier = { premierMatches: [] };
      ui.tournamentTab = "me"; render();`);
    tabEl().querySelector('[data-action="open-my-profile-from-stats"]').click();
    const back = doc.querySelector("#app .back-bar");
    assert(win.eval("state.view") === "playerProfile" && win.eval("ui.profile.id") === "k1" && back && /Summer Cup/.test(back.textContent) && back.dataset.view === "publicTournament",
      "My profile opens his full profile, its back bar returning to the tournament");
    await wait(10);
    // (this test page's history is wherever earlier tests left it, so go to the bar's target directly)
    win.eval(`goToView("publicTournament")`);
    assert(win.eval("state.view") === "publicTournament" && tabEl(), "...and back on the tournament, on his My stats tab");

    // Any name can be tapped: another player's sheet, no You and no profile link.
    win.eval(`ui.tournamentTab = "stats"; render();`);
    doc.querySelector('#app .lb-name-btn[data-name="Babar"]').click();
    assert(sheet() && /Babar/.test(sheet().querySelector("h2").textContent) && !sheet().querySelector(".you-tag") && !sheet().querySelector('[data-action="open-my-profile-from-stats"]')
      && sheet().querySelectorAll('.fixtures [data-action="open-match-detail"]').length === 2 && /for Tigers/.test(sheet().textContent),
      "another player's name opens their own figures in this tournament");
    win.eval("closeTopOverlay()");
    assert(!sheet(), "back closes it");

    // Not signed in (or no claimed profile): no My stats tab (a chosen one falls back to Overview), no You -- names still open.
    win.eval(`ui.tournamentTab = "me"; ui.identity = { myPlayer: null, pendingClaim: null, pendingMerges: [] }; render();`);
    assert(tabIds() === "overview,fixtures,stats" && doc.querySelector('#app [data-tab="overview"].active') && !tabEl(), "without a claimed profile: no My stats tab, and it falls back to Overview");
    win.eval(`ui.tournamentTab = "stats"; render();`);
    assert(!doc.querySelector("#app td.lb-me") && doc.querySelector("#app .lb-name-btn"), "...no You row, names still tappable");
    // A claimed profile that didn't play in it: no tab either.
    win.eval(`ui.identity = { myPlayer: { id: "z1", name: "Someone Else", aliases: [] }, pendingClaim: null, pendingMerges: [] }; render();`);
    assert(!tabIds().includes("me"), "a claimed player who didn't play in it gets no My stats tab");
    // Offline before the identity loaded: the copy kept in the read cache.
    win.eval(`cloudCache = null; cacheFor().myPlayer = { id: "k1", name: "Kusal Mendis", aliases: ["Kusal"] }; ui.identity = null; ui.identityLoading = true; render();`);
    assert(tabIds().endsWith(",me"), "offline, the claimed profile kept in the read cache still gives My stats");

    // The guest's own stats: the same sheet, nobody signed in.
    win.eval(`supabaseClient = __prev.client; session = __prev.session; cloudCache = __prev.cache; ui = defaultUi();
      state.matchHistory = {}; __rows.forEach(r => { const a = JSON.parse(JSON.stringify(r.data)); delete a.clubId; state.matchHistory[a.id] = a; });
      state.view = "stats"; render();`);
    doc.querySelector('#app .lb-name-btn[data-name="Pathum"]').click();
    assert(sheet() && /All time/.test(sheet().textContent) && sheet().querySelectorAll('.fixtures [data-action="open-match-detail"]').length === 2, "guest Stats: a name opens that player's all-time figures");
    win.eval(`fetchPlayerProfile = __prev.fetchPlayerProfile; fetchPlayerAliases = __prev.fetchPlayerAliases; fetchPlayerMatches = __prev.fetchPlayerMatches; fetchMyPlayerIdentity = __prev.fetchMyPlayerIdentity;
      state.matchHistory = {}; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- a ball edit can say who faced it and who bowled its over ---
  {
    const doc = win.document;
    // Over 1 (K1): Dilo 1, Sajith 2, Sajith 1, Dilo 0, Dilo 0, Dilo 1 -> Dilo on strike for over 2.
    const start = () => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" });
      const inn = currentInnings(m);
      win.openInnings(inn, "Dilo", "Sajith", "K1"); m.status = "live";
      const play = ev => { recordBall(inn, ev); afterBall(m); };
      [1, 2, 1, 0, 0, 1].forEach(r => play({ kind: "run", runs: r }));
      win.setBowler(inn, "K2");
      return { m, inn, play };
    };
    const seqOf = (inn, n) => inn.log.filter(a => a.t === "ball")[n].ev.seq;

    // Sajith really faced 1.1-1.3 (0, 6, out caught); the app had Dilo there, then
    // gave Dilo's later runs to Sajith.
    const { m, inn, play } = start();
    play({ kind: "run", runs: 0 }); play({ kind: "run", runs: 6 }); play({ kind: "wicket", wicketType: "caught", fielder: "K1" });
    win.sendInBatter(inn, "Nuwan");
    play({ kind: "run", runs: 1 }); play({ kind: "run", runs: 4 }); play({ kind: "run", runs: 0 });
    win.setBowler(inn, "K1"); play({ kind: "run", runs: 2 });
    assert(inn.batting.stats.Dilo.runs === 8 && inn.batting.stats.Dilo.out && inn.batting.stats.Sajith.runs === 7, "(as scored: Dilo out for 8, Sajith 7 not out)");
    let r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 6), ev: { kind: "run", runs: 0 }, swapEnds: true });
    let ri = r.match && r.match.innings[0];
    assert(ri && ri.batting.stats.Sajith.runs === 9 && ri.batting.stats.Sajith.balls === 5 && ri.batting.stats.Sajith.howOut === "c K1 b K2"
      && ri.batting.stats.Dilo.runs === 6 && ri.batting.stats.Dilo.balls === 6 && !ri.batting.stats.Dilo.out
      && ri.fallOfWickets[0].batsman === "Sajith" && ri.runs === inn.runs && ri.wickets === 1 && ri.striker === "Nuwan" && ri.nonStriker === "Dilo",
      "the other batter faced it: from that ball on the two swap -- Sajith faced the 0 and the 6 and was caught, Dilo is not out with the runs after it");
    assert(r.notes.some(t => /^From ball 1\.1 on, Sajith and Dilo swap places/.test(t)) && !r.notes.some(t => /another bowler/.test(t)), "...and a note says so");
    assert(win.swapEndsSpan(inn.log, seqOf(inn, 0)).until === "end" && win.swapEndsSpan(inn.log, seqOf(inn, 9)) && !win.swapEndsSpan(inn.log, 999),
      "swapEndsSpan finds the ball, and covers the rest of the innings");

    // The same with the over's bowler put right too (K3, not K2), in one change.
    assert(!win.overBowlerLocked(m, 0, seqOf(inn, 6)) && /two overs in a row/.test(win.overBowlerError(m, 0, seqOf(inn, 6), "K1"))
      && /already plays for Lions/.test(win.overBowlerError(m, 0, seqOf(inn, 6), "Nuwan")) && win.overBowlerError(m, 0, seqOf(inn, 6), "K2") === null,
      "an over's bowler: not someone who bowled the over before or after it, nor a batter");
    r = win.replayMatch(m, { inn: 0, seq: seqOf(inn, 6), ev: { kind: "run", runs: 0 }, swapEnds: true, bowler: "K3" });
    ri = r.match && r.match.innings[0];
    assert(ri && !ri.bowling.stats.K2 && ri.bowling.stats.K3.legalBalls === 6 && ri.bowling.stats.K3.runs === 11 && ri.bowling.stats.K3.wickets === 1
      && ri.batting.stats.Sajith.howOut === "c K1 b K3" && ri.overs[1].bowler === "K3" && ri.bowling.stats.K1.legalBalls === 7,
      "...and another bowler for that over: the over's figures and wicket move to K3");
    assert(r.notes.includes("Over 2 is now K3's, not K2's.") && !r.notes.some(t => /another bowler's over/.test(t)), "...said once, not as balls moving between overs");

    // Noticed mid-over and swapped by hand: the fix stops there.
    const s2 = start();
    s2.play({ kind: "run", runs: 0 }); s2.play({ kind: "run", runs: 0 });
    win.swapStrikeByHand(s2.inn);
    s2.play({ kind: "run", runs: 4 });
    const span = win.swapEndsSpan(s2.inn.log, seqOf(s2.inn, 6));
    assert(span.until === "swap" && span.last === seqOf(s2.inn, 7), "a strike swap by hand while the same two are in ends the swap");
    r = win.replayMatch(s2.m, { inn: 0, seq: seqOf(s2.inn, 6), ev: { kind: "run", runs: 0 }, swapEnds: true });
    ri = r.match && r.match.innings[0];
    assert(ri && ri.batting.stats.Sajith.balls === 5 && ri.batting.stats.Sajith.runs === 7 && ri.batting.stats.Dilo.balls === 4 && ri.batting.stats.Dilo.runs === 2
      && r.notes.some(t => /^From ball 1\.1 to 1\.2, .*swapped back by hand/.test(t)), "...so Sajith faced 1.1-1.3 and the balls after the swap stay as they were");

    // The sheet: Who faced it? + Over 2 bowled by, previewed, saved, undone.
    win.state.match = JSON.parse(JSON.stringify(m)); win.state.snapshots = [];
    win.eval(`ui = defaultUi(); state.match.squads = { A: ["Dilo", "Sajith", "Nuwan", "A4"], B: ["K1", "K2", "K3", "K4"] }; render();`);
    win.openBallEdit(0, seqOf(inn, 6), "1.1");
    const sheet = () => doc.querySelector("#modal-root .ball-edit-modal");
    const tileFor = (field, value) => sheet().querySelector(`[data-action="ball-edit-set"][data-field="${field}"][data-value="${value}"]`);
    assert(tileFor("faced", "striker").classList.contains("active") && /Dilo/.test(tileFor("faced", "striker").textContent) && /Sajith/.test(tileFor("faced", "nonStriker").textContent),
      "the edit sheet asks who faced it: the batter recorded on strike, or the one at the other end");
    assert(/Over 2 bowled by/.test(sheet().textContent) && tileFor("bowler", "K2").classList.contains("active") && !tileFor("bowler", "K1") && !tileFor("bowler", "K3") && tileFor("bowlerOther", "1"),
      "...and who bowled the over: its bowler, this innings' others who could have (not K1, who bowled either side of it), or someone else");
    tileFor("faced", "nonStriker").click();
    assert(/swap places/.test(sheet().querySelector(".ball-edit-context").textContent) && /Sajith/.test(sheet().querySelector(".ball-edit-context").textContent)
      && /9 \(5\) c K1 b K2/.test(sheet().querySelector(".ball-edit-context").textContent), "picking the other batter previews it: the note and each batter's new line");
    tileFor("bowlerOther", "1").click();
    const opts = [...sheet().querySelectorAll('.combo-opt')].map(o => o.dataset.name).join();
    assert(/^K3,K4(,|$)/.test(opts) && !/K1|K2|Sajith/.test(opts), "Someone else: a box listing the rest of the bowling side first, then players outside the squads (" + opts + ")");
    doc.querySelector('#ball-edit-form input[name="bowlerName"]').value = "K4";
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Over 2 is now K4's/.test(doc.querySelector("#confirm-root").textContent) && /Sajith/.test(doc.querySelector("#confirm-root").textContent), "Review asks first, with the bowler typed in");
    doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    const li = currentInnings(win.state.match);
    assert(li.batting.stats.Sajith.howOut === "c K1 b K4" && !li.batting.stats.Dilo.out && li.bowling.stats.K4.wickets === 1 && !win.eval("ui.ballEdit"), "saved: the scorecard follows");
    win.eval("handleUndo()");
    assert(currentInnings(win.state.match).batting.stats.Dilo.out, "Undo brings the old version back");
    win.openBallEdit(0, seqOf(inn, 6), "1.1");
    doc.getElementById("ball-edit-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Nothing has changed yet/.test(sheet().textContent), "with nothing changed, it still says so");
    win.eval(`ui = defaultUi(); state.match = null; state.snapshots = []; save(); render();`);
  }

  // --- player ids: the key every cross-match figure counts by; old matches still count, and add up with new ones ---
  {
    const quick = (batA, batB, bowlA, bowlB, ids, when, extra) => {
      const mm = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 1, playersPerSide: 11, battingFirst: "A" });
      win.openInnings(currentInnings(mm), batA[0], batA[1], bowlB); mm.status = "live";
      [4, 1, 6, { kind: "wide", runs: 0 }, { kind: "wicket", wicketType: "caught", fielder: batB[0] }, 2, 1].forEach(r => {
        const inn = currentInnings(mm);
        if (inn.complete) return;
        recordBall(inn, typeof r === "number" ? { kind: "run", runs: r } : r);
        if (win.pendingBatsmanSlot(inn)) win.sendInBatter(inn, batA[2]);
        afterBall(mm);
      });
      win.startSecondInnings(mm); win.openInnings(currentInnings(mm), batB[0], batB[1], bowlA); mm.status = "live";
      [1, 1, 0, 2].forEach(r => { recordBall(currentInnings(mm), { kind: "run", runs: r }); afterBall(mm); });
      win.endInnings(mm);
      mm.id = "pid" + when; mm.completedAt = when;
      if (ids) mm.playerIds = ids;
      return Object.assign(mm, extra || {});
    };
    const doc = win.document;
    const PTS = win.eval("DEFAULT_POINTS_PRESETS[0]");
    const FIELDS = ["runs", "balls", "fours", "sixes", "innings", "notOuts", "wickets", "legalBalls", "runsConceded", "maidens", "dots", "catches", "runouts", "stumpings"];
    const byLabel = ms => win.aggregatePlayerStats(ms, PTS, { keyOf: (m, l) => "L:" + l, link: false });

    // 1. No ids anywhere (every match before this change): the same figures as before, name for name.
    const plain = [quick(["Kusal", "Pathum", "Charith"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", null, 1),
      quick(["Kusal", "Charith", "Dasun"], ["Babar", "Fakhar"], "Maheesh", "Shaheen", null, 2)];
    const before = byLabel(plain), after = win.aggregatePlayerStats(plain, PTS);
    assert(after.length === before.length && before.every(o => {
      const n = after.find(t => t.key === win.nameKey(o.name));
      return n && n.name === o.name && n.matches === o.matches && n.points === o.points && FIELDS.every(f => n[f] === o[f]);
    }), "matches without ids: every player's figures are exactly what they were, counted by name");

    // 2. Two people called Kasun Perera, two ids: never added up. Old unlinked matches: joined only when one player has the name.
    const A = "p-aaaa", B = "p-bbbb", D = "p-dddd", K = "p-kkkk";
    const ms = [
      quick(["Kasun Perera", "Pathum", "Dilshan"], ["Babar", "Rizwan"], "K. Mendis", "Shaheen", { "Kasun Perera": A, Dilshan: D, "K. Mendis": K }, 10),
      quick(["Kasun Perera", "Charith", "Dasun"], ["Babar", "Fakhar"], "Kusal Mendis", "Shaheen", { "Kasun Perera": B, "Kusal Mendis": K }, 11),
      quick(["Kasun Perera", "Dilshan", "Dasun"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", null, 12),   // before ids: Kasun is A or B? Dilshan can only be D
      quick(["Dilshan", "Pathum", "Charith"], ["Babar", "Rizwan"], "Kusal Mendis", "Shaheen", null, 13)];
    const opts = { nameOf: id => ({ [K]: "Kusal Mendis" })[id] || null };
    const totals = win.aggregatePlayerStats(ms, PTS, opts);
    const tA = totals.find(t => t.key === A), tB = totals.find(t => t.key === B), tName = totals.find(t => t.key === win.nameKey("Kasun Perera"));
    const one = label => byLabel([ms[["pid10", "pid11", "pid12", "pid13"].indexOf(label.m)]]).find(t => t.name === label.n);
    assert(tA && tB && tA.runs === one({ m: "pid10", n: "Kasun Perera" }).runs && tB.runs === one({ m: "pid11", n: "Kasun Perera" }).runs && tA.matches === 1 && tB.matches === 1,
      "two Kasun Pereras with their own ids are two players, each with only their own runs");
    assert(tName && tName.runs === one({ m: "pid12", n: "Kasun Perera" }).runs && tName.names.join() === "Kasun Perera",
      "a Kasun Perera from before ids, with two players of that name about, stays on its own line (counted by name, as before)");
    const tD = totals.find(t => t.key === D);
    assert(tD && tD.matches === 3 && tD.runs === ["pid10", "pid12", "pid13"].reduce((s, id) => s + (one({ m: id, n: "Dilshan" }) || { runs: 0 }).runs, 0) && !totals.some(t => t.key === win.nameKey("Dilshan")),
      "Dilshan's old matches (no ids) join his id: one player of that name, so old and new add up");
    const tK = totals.find(t => t.key === K);
    assert(tK && tK.name === "Kusal Mendis" && tK.names.sort().join() === "K. Mendis,Kusal Mendis" && tK.matches === 3,
      "a renamed player is one line under their current name, every name they played under counted");

    // The proof: the new totals are the old per-name totals, regrouped -- nothing lost, nothing counted twice.
    const keyOf = win.linkedKeyOf(ms);
    const sums = {};
    ms.forEach(m => byLabel([m]).forEach(o => {
      const k = keyOf(m, o.name);
      const s = sums[k] || (sums[k] = Object.assign({ points: 0, ids: new Set() }, Object.fromEntries(FIELDS.map(f => [f, 0]))));
      FIELDS.forEach(f => { s[f] += o[f]; });
      s.points += o.points; s.ids.add(m.id);
    }));
    assert(Object.keys(sums).length === totals.length && totals.every(t => {
      const s = sums[t.key];
      return s && FIELDS.every(f => s[f] === t[f]) && Math.abs(s.points - t.points) < 1e-9 && s.ids.size === t.matches;
    }), "every player's totals are exactly the sum of the per-name figures counted into them");

    // One player's career and matches (a profile, a player's sheet): by id, and old matches by name only when it's unambiguous.
    const cA = win.playerCareer(win.playerWho(A, ["Kasun Perera"]), ms), cD = win.playerCareer(win.playerWho(D, ["Dilshan"]), ms);
    assert(cA.runs === tA.runs && cA.matches === 1 && cD.runs === tD.runs && cD.matches === 3,
      "a profile counts its own id's matches, plus old ones by name when nobody else has the name");
    assert(win.playerMatchLines(win.playerWho(B, ["Kasun Perera"]), ms).map(l => l.match.id).join() === "pid11"
      && win.playerMatchLines(win.playerWho(K, ["Kusal Mendis", "K. Mendis"]), ms).map(l => l.labels.join()).sort().join("|") === "K. Mendis|Kusal Mendis|Kusal Mendis",
      "match by match follows the id too, and says which name each match has");
    assert(win.playerCareer("Dilshan", plain.concat(ms)) && win.playerCareer(["Kusal", "kusal"], plain).matches === 2, "a name or names still work as before ids");
    const rec = win.computeRecords(ms, opts).find(g => g.key === "bat").records.find(r => r.key === "runs");
    assert(rec.entries.length && rec.entries.every(e => e.key && totals.find(t => t.key === e.key).runs === e.value)
      && new Set(rec.entries.map(e => e.key)).size === rec.entries.length && rec.entries[0].key === D && rec.entries[0].value === tD.runs,
      "records count per player (key): Dilshan's old and new matches make his most runs");

    // In the app: names entered in a match record their ids.
    win.eval(`window.__players = state.players; state.players = { g1: { id: "g1", name: "Kusal" } };
      state.match = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 5, playersPerSide: 6, battingFirst: "A" }); state.snapshots = []; ui = defaultUi();
      openInnings(currentInnings(state.match), "Kusal", "Pathum", "Shaheen"); state.match.status = "live";
      ["Kusal", "Pathum", "Shaheen"].forEach((n, i) => registerMatchPlayer(n, i < 2 ? "A" : "B"));`);
    const ids = win.state.match.playerIds;
    const pathum = Object.values(win.state.players).find(p => p.name === "Pathum");
    assert(ids.Kusal === "g1" && pathum && ids.Pathum === pathum.id && ids.Shaheen && ids.Shaheen !== ids.Pathum,
      "a guest match records each name's guest player id (a new name gets a new guest player)");
    assert(win.restartMatch(win.state.match, "B").playerIds.Kusal === "g1", "a toss restart keeps the ids");
    win.eval(`ui.club = { id: "c1", roster: [{ id: "p-11", name: "Kusal Mendis" }] };
      state.match = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 6, battingFirst: "A" }); state.match.clubId = "c1"; state.match.guestNames = ["Amal"];
      openInnings(currentInnings(state.match), "Kusal Mendis", "Amal", "Bowler X"); state.match.status = "live";
      registerMatchPlayer("Kusal Mendis", "A"); registerMatchPlayer("Amal", "A");`);
    assert(win.state.match.playerIds["Kusal Mendis"] === "p-11" && win.state.match.playerIds.Amal === "guest:amal",
      "a club match records the roster player's id, and a tournament visitor's guest key");
    win.eval(`state.match.playerIds["Bowler X"] = "tmp:123"; state.matchHistory.__x = { id: "__x", innings: [], playerIds: { Z: "tmp:123" } }; remapTempId("tmp:123", "p-99");`);
    assert(win.state.match.playerIds["Bowler X"] === "p-99" && win.state.matchHistory.__x.playerIds.Z === "p-99", "a temp id (a club player added offline) is swapped for the real one in matches too, once the add syncs");
    assert(JSON.stringify(win.withoutTempIds({ a: "p-1", b: "tmp:9", c: "guest:x" })) === JSON.stringify({ a: "p-1", c: "guest:x" }), "a temp id never goes to the cloud");
    win.eval(`delete state.matchHistory.__x; ui.club = null;`);

    // Leaderboards: two guest players with one name are two rows, each opening their own figures.
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi();
      state.players = { g1: { id: "g1", name: "Kasun Perera" }, g2: { id: "g2", name: "Kasun Perera" } };
      window.__history = state.matchHistory; state.matchHistory = {}; state.view = "stats";`);
    const g10 = quick(["Kasun Perera", "Pathum", "Dilshan"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", { "Kasun Perera": "g1" }, 20);
    const g11 = quick(["Kasun Perera", "Charith", "Dasun"], ["Babar", "Fakhar"], "Wanindu", "Shaheen", { "Kasun Perera": "g2" }, 21);
    win.state.matchHistory = { [g10.id]: g10, [g11.id]: g11 };
    win.eval(`ui.statsTab = "bat"; render();`);
    const kRows = [...doc.querySelectorAll('#app [data-action="open-player-stats"]')].filter(b => b.textContent === "Kasun Perera");
    assert(kRows.length === 2 && kRows.map(b => b.dataset.key).sort().join() === "g1,g2", "the batting table has two Kasun Perera rows, one per player");
    kRows.find(b => b.dataset.key === "g2").click();
    const want = byLabel([g11]).find(t => t.name === "Kasun Perera");
    assert(win.state.view === "stats" && win.eval("ui.playerStats.key") === "g2" && new RegExp(`\\b${want.runs}\\b`).test(doc.querySelector("#modal-root .player-stats-modal").textContent)
      && win.playerCareer(win.eval("playerStatsWho(ui.playerStats)"), [g10, g11]).runs === want.runs, "tapping the second opens that player's own figures");
    win.eval(`ui.playerStats = null; state.players = window.__players; state.matchHistory = window.__history; state.view = "home"; save(); render();`);

    // Two Ravis on the list, only one of whom played in the linked match: an old unlinked "Ravi" is neither's.
    win.eval(`window.__players = state.players; state.players = { r1: { id: "r1", name: "Ravi" }, r2: { id: "r2", name: "Ravi" } };`);
    win.__amb = [quick(["Ravi", "Pathum", "Charith"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", { Ravi: "r2" }, 40),
      quick(["Ravi", "Dasun", "Charith"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", null, 41)];
    const ravis = JSON.parse(win.eval(`JSON.stringify(aggregatePlayerStats(window.__amb, null, statsOpts()).filter(t => t.names.includes("Ravi")).map(t => [t.key, t.matches]).sort())`));
    assert(JSON.stringify(ravis) === JSON.stringify([["name:ravi", 1], ["r2", 1]]) && win.eval(`playerCareer(statsWho("r2", ["Ravi"]), window.__amb).matches`) === 1
      && win.eval(`playerCareer(statsWho("r1", ["Ravi"]), window.__amb)`) === null,
      "with two Ravis on the list, an old unlinked Ravi joins neither (it stays on its own line), even when only one of them played elsewhere");
    win.eval(`state.players = window.__players; delete window.__amb;`);

    // Guest matches from before ids get them stored once, on load (only names that are one guest player).
    const old = quick(["Dasun", "Kasun Perera", "Pathum"], ["Babar", "Rizwan"], "Wanindu", "Shaheen", null, 30);
    win.eval(`window.__keep = JSON.stringify(state);`);
    const saved = JSON.parse(win.eval("window.__keep"));
    Object.assign(saved, { guestIdsLinked: false, matchHistory: { [old.id]: old },
      players: { g7: { id: "g7", name: "Dasun" }, g8: { id: "g8", name: "Kasun Perera" }, g9: { id: "g9", name: "kasun perera" }, g10: { id: "g10", name: "Wanindu" } } });
    win.DB.save(win.STORAGE_KEY, saved);
    win.eval("load()");
    const linked = win.state.matchHistory[old.id].playerIds || {};
    assert(win.state.guestIdsLinked === true && linked.Dasun === "g7" && linked.Wanindu === "g10" && !linked["Kasun Perera"] && !linked.Babar,
      "on load, an old guest match gets each name's guest player id; two players of a name, or none, stay unlinked");
    win.eval(`state = JSON.parse(window.__keep); save(); render();`);
  }

  // --- player ids, phase 2: "Which Kasun Perera?", and two players of one name in a match ---
  {
    const doc = win.document;
    const tick = () => new Promise(r => setTimeout(r, 0));
    const confirm = () => doc.querySelector("#confirm-root");
    const pickChoice = v => doc.querySelector(`#confirm-root [data-action="confirm-pick"][data-value="${v}"]`).click();
    const ok = () => doc.querySelector('#confirm-root [data-action="confirm-ok"]').click();
    assert(win.labelledPlayers([{ name: "Kasun" }, { name: "Ravi" }, { name: "kasun" }]).map(p => p.label).join() === "Kasun,Ravi,kasun (2)",
      "a second player of a name is labelled 'Name (2)' in a match (a list without shared names is unchanged)");
    const sq = win.squadsWithIds([{ id: "a", name: "Kasun Perera" }, { id: "g", name: "Amal", guest: true }], [{ id: "b", name: "Kasun Perera" }, { id: "a", name: "Kasun Perera" }]);
    assert(sq.A.join() === "Kasun Perera,Amal" && sq.B.join() === "Kasun Perera (2)" && sq.playerIds["Kasun Perera"] === "a" && sq.playerIds["Kasun Perera (2)"] === "b"
      && sq.guestNames.join() === "Amal", "two squads: each player a label of their own and their id; a guest is marked by label; nobody twice");
    const q = win.coalesceOp([{ kind: "roster.add", userId: "u", args: { clubId: "c", name: "Kasun" } }], { kind: "roster.add", userId: "u", args: { clubId: "c", name: "kasun" } });
    const q2 = win.coalesceOp(q, { kind: "roster.add", userId: "u", args: { clubId: "c", name: "Kasun", someoneNew: true } });
    assert(q.length === 1 && q2.length === 2, "a repeat offline add of a name is dropped, but 'someone new' with that name is kept");

    // A guest team with two Kasun Pereras: both in the match, each with their own id.
    win.eval(`window.__keepGuest = JSON.stringify({ players: state.players, teams: state.teams });
      state.players = { k1: { id: "k1", name: "Kasun Perera" }, k2: { id: "k2", name: "Kasun Perera" }, p1: { id: "p1", name: "Pathum" }, s1: { id: "s1", name: "Shaheen" } };
      state.teams = { ta: { id: "ta", name: "Lions", playerIds: ["k1", "k2", "p1"] }, tb: { id: "tb", name: "Tigers", playerIds: ["s1"] } };
      state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "matchSetup"; render();`);
    const setup = doc.getElementById("match-setup-form");
    setup.querySelector('[name="teamA"]').value = "Lions"; setup.querySelector('[name="teamB"]').value = "Tigers";
    setup.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(win.state.match.squads.A.join() === "Kasun Perera,Kasun Perera (2),Pathum" && win.state.match.playerIds["Kasun Perera (2)"] === "k2" && win.state.match.playerIds["Kasun Perera"] === "k1",
      "match setup: the second Kasun Perera is 'Kasun Perera (2)' in this match, and each label is tied to its player");
    const pickOpen = n => doc.querySelector(`#modal-root [data-action="opening-pick"][data-name="${n}"]`).click();
    pickOpen("Kasun Perera (2)"); pickOpen("Kasun Perera"); pickOpen("Shaheen");
    doc.getElementById("opening-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    const live1 = currentInnings(win.state.match);
    assert(live1.striker === "Kasun Perera (2)" && live1.nonStriker === "Kasun Perera" && win.state.match.playerIds["Kasun Perera (2)"] === "k2" && win.state.match.playerIds["Kasun Perera"] === "k1",
      "both Kasun Pereras open the batting, each counted as themselves");
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "players"; render();`);

    // The guest Players screen: a name already on the list asks first; 'someone new' makes a second player.
    const addForm = () => doc.getElementById("add-global-player-form");
    addForm().querySelector('[name="name"]').value = "Pathum";
    addForm().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    assert(/Which Pathum\?/.test(confirm().textContent) && /Someone new/.test(confirm().textContent), "adding a name already on the list asks: the same player, or someone new");
    pickChoice("__new"); ok();
    assert(Object.values(win.state.players).filter(p => p.name === "Pathum").length === 2, "someone new: a second Pathum, with an id of his own");
    win.eval(`{ const k = JSON.parse(window.__keepGuest); state.players = k.players; state.teams = k.teams; } state.view = "home"; save(); render();`);

    // A club: the add-player sheet asks when the platform already has the name.
    win.eval(`window.__calls = []; window.__keepFns = { findPlayersNamed, addPlayerToClub, addExistingPlayerToClub, fetchClubDetail, client: supabaseClient };
      findPlayersNamed = async () => [{ id: "x1", name: "Kasun Perera", origin_club: "Club2", on_roster: false, city: "Kandy" }];
      addPlayerToClub = async (c, n, ex) => { __calls.push(["new", n, !!(ex && ex.someoneNew)]); return { ok: true, id: "x9", created: true }; };
      addExistingPlayerToClub = async (c, id, n) => { __calls.push(["existing", id, n]); return { ok: true }; };
      fetchClubDetail = async () => {};
      ui = defaultUi(); ui.currentClubId = "c1"; ui.club = { id: "c1", name: "KICC", roster: [{ id: "d1", name: "Dilshan" }], matches: [], presets: { match: [], tournament: [] } };`);
    const clubAdd = name => {
      const f = doc.createElement("form");
      f.innerHTML = `<input name="name" value="${name}"><button type="submit">Add</button>`;
      win.handleClubAddPlayerSubmit({ preventDefault(){}, target: f });
    };
    clubAdd("Kasun Perera"); await tick(); await tick();
    assert(/Which Kasun Perera\?/.test(confirm().textContent) && /Added by Club2/.test(confirm().textContent) && /Kandy/.test(confirm().textContent),
      "club add: the platform's Kasun Perera is shown with what tells him apart (the club that added him, his city)");
    pickChoice("x1"); ok(); await tick(); await tick();
    assert(JSON.stringify(win.__calls) === JSON.stringify([["existing", "x1", "Kasun Perera"]]), "'same player': that player joins the roster as they are -- nobody new is made");
    clubAdd("Kasun Perera"); await tick(); await tick();
    pickChoice("__new"); ok(); await tick(); await tick();
    assert(JSON.stringify(win.__calls[1]) === JSON.stringify(["new", "Kasun Perera", true]), "'someone new': a new player with the same name (add_player_to_club _new)");

    // A club match: a typed name the roster doesn't have, but the platform does, asks too -- and the match records who it was.
    win.eval(`supabaseClient = {}; ui.club.roster = [{ id: "d1", name: "Dilshan" }, { id: "p1", name: "Pathum" }];
      state.match = createMatch({ teamA: "Reds", teamB: "Blues", oversLimit: 5, playersPerSide: 6, battingFirst: "A" }); state.match.clubId = "c1"; state.match.matchType = "practice";
      state.snapshots = []; openInnings(currentInnings(state.match), "Dilshan", "Pathum", "Bowler B"); state.match.status = "live";
      recordBall(currentInnings(state.match), { kind: "wicket", wicketType: "bowled" }); afterBall(state.match); render();`);
    const bf = doc.getElementById("new-batsman-form");
    win.submitNewBatsman("Kasun Perera", bf); await tick(); await tick();
    assert(/Which Kasun Perera\?/.test(confirm().textContent) && /For Reds/.test(confirm().textContent), "a club match: typing a name the platform has asks which player it is");
    pickChoice("x1"); ok(); await tick();
    const li = currentInnings(win.state.match);
    assert(li.striker === "Kasun Perera" && win.state.match.playerIds["Kasun Perera"] === "x1" && win.eval(`ui.club.roster.some(p => p.id === "x1")`),
      "picked: he comes in, the match records his id, and he joins the club's roster");
    win.eval(`({ findPlayersNamed, addPlayerToClub, addExistingPlayerToClub, fetchClubDetail } = window.__keepFns); supabaseClient = window.__keepFns.client;
      state.match = null; state.snapshots = []; ui = defaultUi(); state.view = "home"; save(); render();`);
  }

  // --- stats by month / year: a tournament's matches count on its start, a night game on the day before ---
  {
    const doc = win.document;
    const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi || 0).getTime();
    const pk = (ts, kind) => win.statsPeriodKey(ts, kind || "month");
    assert(pk(at(2026, 10, 15, 17)) === "2026-11" && pk(at(2026, 10, 1, 0, 40)) === "2026-10" && pk(at(2026, 10, 1, 5)) === "2026-11",
      "stats dates: a match that finished before 5am counts on the day before (00:40 on 1 Nov is October's)");
    assert(pk(at(2026, 0, 1, 3), "year") === "2025" && pk(at(2026, 0, 1, 3)) === "2025-12" && pk(null) === null, "...across a year end too; no time, no period");
    assert(win.statsPeriodLabel("month", "2026-11") === "November 2026" && win.statsPeriodLabel("month", "2026-11", true) === "Nov 2026"
      && win.statsPeriodLabel("year", "2026") === "2026" && win.statsPeriodLabel("all") === "All time", "period labels");

    // Ann bats one ball for Lions in each; Bob bowls it.
    const quick = (id, runs, when, tid) => {
      const m = createMatch({ teamA: "Lions", teamB: "Tigers", oversLimit: 2, playersPerSide: 11, battingFirst: "A", tournamentId: tid || null });
      win.openInnings(currentInnings(m), "Ann", "Cat", "Bob"); m.status = "live";
      recordBall(currentInnings(m), { kind: "run", runs });
      return Object.assign(m, { id, completedAt: when, status: "complete", result: "Lions won" });
    };
    const all = [
      quick("a", 4, at(2026, 9, 18, 17)),
      quick("b", 6, at(2026, 10, 1, 0, 40)),          // a night game: October's
      quick("c", 2, at(2026, 10, 30, 21), "T"),       // the tournament starts on 30 Nov...
      quick("d", 1, at(2026, 11, 1, 1, 10), "T"),     // ...runs past midnight...
      quick("e", 3, at(2026, 11, 15, 15), "T"),       // ...and on into December: all November's
      quick("f", 4, at(2026, 11, 20, 16)),
      quick("g", 5, undefined)                         // no time: only in All time
    ];
    const starts = win.tournamentStartTimes(all);
    assert(starts.T === at(2026, 10, 30, 21), "a tournament starts when its first match finished");
    const periods = kind => win.statsPeriods(all, kind, starts).map(p => `${p.key}:${p.count}`).join(" ");
    assert(periods("month") === "2026-12:1 2026-11:3 2026-10:2" && periods("year") === "2026:6", "periods, newest first, with their matches: " + periods("month"));
    const ids = (kind, key) => win.matchesInPeriod(all, kind, key, starts).map(m => m.id).join("");
    assert(ids("month", "2026-11") === "cde" && ids("month", "2026-12") === "f" && ids("month", "2026-10") === "ab" && ids("all") === "abcdefg",
      "every match of a tournament is in the month it started, even one played weeks later; a 00:40 finish is the day before's");
    const byMonth = win.playerByPeriod(["Ann"], all, "month", null, starts);
    assert(byMonth.map(r => `${r.key}:${r.career.runs}`).join(" ") === "2026-12:4 2026-11:6 2026-10:10", "a player month by month: " + byMonth.map(r => r.key + ":" + r.career.runs).join(" "));
    assert(byMonth.reduce((s, r) => s + r.career.runs, 0) + 5 === win.playerCareer(["Ann"], all, null).runs, "the months add up to the career (less the match with no time)");
    const oct = win.matchesInPeriod(all, "month", "2026-10", starts);
    const sum = win.statsSummary(oct, win.aggregatePlayerStats(oct, null));
    assert(sum.matches === 2 && sum.runs === 10 && sum.wickets === 0 && sum.sixes === 1, "a period's headline numbers: " + JSON.stringify(sum));

    // The Stats screen: the picker, the headline numbers, the podium.
    const kept = win.eval(`({ client: supabaseClient })`);
    win.eval(`state.match = null; state.snapshots = []; ui = defaultUi(); state.matchHistory = {}; state.view = "stats";`);
    all.forEach(m => { win.state.matchHistory[m.id] = JSON.parse(JSON.stringify(m)); });
    win.eval(`ui.statsTab = "bat"; render();`);
    const q = sel => doc.querySelector("#app " + sel);
    const txt = sel => (q(sel) || {}).textContent;
    const kpis = () => [...doc.querySelectorAll("#app .kpi")].map(k => k.textContent.replace(/\s+/g, "")).join(" ");
    const tap = sel => { q(sel).click(); };
    assert([...doc.querySelectorAll('#app .period-kinds [data-action="stats-period"]')].map(b => b.textContent).join() === "All time,Yearly,Monthly"
      && q('.period-kinds .on').textContent === "All time" && !q(".period-step"), "Stats offers All time / Yearly / Monthly, All time first");
    assert(kpis() === "7Matches 25Runs 0Wickets 1Sixes", "all time: every match counts: " + kpis());
    assert(txt(".podium-spot.s1 .podium-name") === "Ann" && q(".podium-crown") && txt(".podium-by") === "Runs" && txt(".podium-title") === "Top batters",
      "the podium crowns the leader of the table, by its sort column");
    tap('[data-action="stats-period"][data-kind="month"]');
    assert(txt(".period-now") === "December 2026" && kpis() === "1Match 4Runs 0Wickets 0Sixes" && q(".period-arrow[aria-label^='Later']").disabled,
      "Monthly opens on the newest month: " + txt(".period-now"));
    tap(".period-arrow[aria-label^='Earlier']");
    assert(txt(".period-now") === "November 2026" && kpis() === "3Matches 6Runs 0Wickets 0Sixes", "‹ steps back a month: the tournament's three matches");
    assert(q("td.on b") && q("td.on b").textContent === "6" && q(".kpi-row.anim-new") && q(".podium-card.anim-new"), "the table counts that month only, and the new month animates in");
    win.eval(`ui.statsSort.bat = { key: "sixes", dir: "desc" }; render();`);
    assert(!q(".podium-card"), "a podium only shows players with something in its column (no sixes in November)");
    tap(".period-arrow[aria-label^='Earlier']");
    assert(txt(".period-now") === "October 2026" && txt(".podium-by") === "Sixes" && txt(".podium-spot.s1 .podium-val") === "16s", "sorted by sixes, October's podium: " + txt(".podium-spot.s1 .podium-val"));
    win.eval(`ui.statsSort = {}; render();`);
    tap('[data-action="stats-period"][data-kind="year"]');
    assert(txt(".period-now") === "2026" && kpis() === "6Matches 20Runs 0Wickets 1Sixes", "Yearly stays in the year Monthly was showing");
    tap('[data-action="stats-tab"][data-tab="mvp"]');
    assert(txt(".podium-title") === "Player of the year", "a year's MVP podium is its player of the year");
    tap('[data-action="stats-period"][data-kind="month"]');
    assert(txt(".period-now") === "December 2026" && txt(".podium-title") === "Player of the month", "...a month's, its player of the month");
    // A player's sheet over a period that spans months: month by month.
    tap('[data-action="stats-period"][data-kind="all"]');
    tap('.podium-spot.s1 .podium-btn');
    const sheet = doc.querySelector("#modal-root .player-stats-modal");
    const months = sheet ? [...sheet.querySelectorAll(".month-bar .month-name")].map(e => e.textContent).join() : "";
    assert(months === "Dec 2026,Nov 2026,Oct 2026" && sheet.querySelector(".month-bar.best .month-name").textContent === "Oct 2026"
      && sheet.querySelector(".player-stats-head .player-avatar.initials").textContent === "A", "the sheet shows month by month (best month marked) and the player's badge: " + months);
    assert(/All time/.test(sheet.querySelector(".player-stats-where").textContent), "...over all time");
    win.eval(`closePlayerStats()`);
    tap('[data-action="stats-period"][data-kind="month"]');
    tap('.podium-spot.s1 .podium-btn');
    const sheet2 = doc.querySelector("#modal-root .player-stats-modal");
    assert(!sheet2.querySelector(".month-bars") && /December 2026/.test(sheet2.querySelector(".player-stats-where").textContent), "a month's sheet is that month's, with no month by month");
    win.eval(`closePlayerStats()`);
    // Inside one tournament there's nothing to pick: its matches share its start.
    const tHtml = win.eval(`renderTournamentStats(${JSON.stringify(all.filter(m => m.tournamentId))}, "Cup")`);
    assert(!/period-kinds/.test(tHtml) && /kpi-row/.test(tHtml) && /Tournament MVP/.test(tHtml), "a tournament's Stats: no period picker, and the podium names the Tournament MVP");

    // Photos: the leader's from players_public (memory only), else initials.
    const uuid = "11111111-2222-4333-8444-555555555555", png = "data:image/png;base64,iVBORw0KGgo=";
    assert(/initials[^>]*>AL</.test(win.playerAvatarHtml("name:ann lee", "Ann Lee")) && /initials[^>]*>K</.test(win.playerAvatarHtml(null, "Kusal (KM)")), "no photo: initials");
    win.eval(`window.__photoCalls = []; supabaseClient = { from: () => ({ select: () => ({ in: (col, ids) => { window.__photoCalls.push(ids); return Promise.resolve({ data: ids.map(id => ({ id, photo: id === "${uuid}" ? "${png}" : null })) }); } }) }) };`);
    win.wantPlayerPhotos([uuid, "name:ann", "guest:bob", uuid, "22222222-2222-4333-8444-555555555555"]);
    win.wantPlayerPhotos([uuid]);
    await wait(0);
    assert(JSON.stringify(win.__photoCalls) === JSON.stringify([[uuid, "22222222-2222-4333-8444-555555555555"]]), "photos load once, for real player ids only: " + JSON.stringify(win.__photoCalls));
    assert(new RegExp(`<img class="player-avatar podium-avatar" src="${png.replace(/[+/=.]/g, "\\$&")}"`).test(win.playerAvatarHtml(uuid, "Ann", "podium-avatar")), "a photo shows when the player has one");
    win.eval(`playerPhotos["33333333-2222-4333-8444-555555555555"] = "data:image/svg+xml;base64,PHN2Zz4=";`);
    assert(!/<img/.test(win.playerAvatarHtml("33333333-2222-4333-8444-555555555555", "Ann")), "only a safe image data URL is ever shown (safePhoto)");
    win.eval(`supabaseClient = null; state.matchHistory = {}; ui = defaultUi(); state.view = "home"; save(); render();`);
    win.__keepStatsClient = kept.client;
    win.eval(`supabaseClient = window.__keepStatsClient;`);
  }

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
