// npm run store-graphics: the store listing images, from the guest build.
//   store/screenshots/plain/NN-*.jpg   the app's screens, 1080×1920 (both stores)
//   store/screenshots/NN-*.jpg         the same with a caption, 1080×1920
//   store/feature-graphic.jpg          Google Play's 1024×500 feature graphic
// Runs www/ (built fresh) in Chrome at phone size with sample data: made-up
// teams and players, scored through the app's own engine functions (logged,
// like real taps, so "fix any ball" works on them). JPEG: no alpha channel,
// which both stores require. Needs Google Chrome, or `npx playwright install chromium`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WWW = path.join(MOBILE, "www");
const STORE = path.join(MOBILE, "store");
const PLAIN = path.join(STORE, "screenshots", "plain");
fs.rmSync(path.join(STORE, "screenshots"), { recursive: true, force: true });
fs.mkdirSync(PLAIN, { recursive: true });

execFileSync("node", ["scripts/build-web.mjs"], { cwd: MOBILE, stdio: "inherit" });

// --- a static server for www/ ---------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(WWW, path.normalize(p));
  if (!file.startsWith(WWW) || !fs.existsSync(file)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());

// --- sample data, run inside the page --------------------------------------
const SEED = String.raw`
var SEED = SEED_VALUE; function rnd(){ SEED = (SEED * 16807) % 2147483647; return (SEED - 1) / 2147483646; }
var SQUADS = {
  "Colombo Lions": ["Nuwan Perera","Kasun Silva","Dilan Fernando","Sahan Jayasinghe","Ravindu Dias","Chamod Wijesinghe","Tharindu Gamage","Isuru Bandara","Malith Ranasinghe","Hasitha Weerasekara","Pasan Ekanayake"],
  "Kandy Tigers": ["Supun Rathnayake","Gayan Wickramasinghe","Akila Herath","Lasith Abeysekara","Yasiru Kodikara","Dulaj Peiris","Ashan Liyanagama","Shehan Munasinghe","Ramith Hettiarachchi","Kavindu Senaratne","Nipun Jayaweera"],
  "Galle Eagles": ["Ruchira Alwis","Janaka Wanasinghe","Heshan Gunasekara","Pubudu Samarasinghe","Thilina Jayasekara","Ishara Rathnayaka","Madushan Kariyawasam","Chathura Dissanayake","Lahiru Pathirage","Dimuthu Edirisinghe","Sandun Weerakkody"],
  "Matara Sharks": ["Kalana Perera","Nimesh Fonseka","Udara Wijeratne","Sanath Gamlath","Pradeep Hewage","Kosala Amarasinghe","Rumesh Silva","Viraj Kularatne","Anuk Mallawarachchi","Danushka Abeyratne","Lakmal Sumanadasa"]
};
function seedTeams(names){ return names.map(n => { const t = createTeam(n); SQUADS[n].forEach(p => addPlayerToTeam(t.id, p)); return t; }); }
function sideName(m, key){ return key === "A" ? m.teamA : m.teamB; }
function pickBowler(m, inn){
  const bowlers = SQUADS[sideName(m, inn.bowlingTeam)].slice(5), maxBalls = Math.ceil((m.oversLimit || 20) / 5) * inn.ballsPerOver;
  const ok = bowlers.filter(b => b !== inn.lastOverBowler && (!inn.bowling.stats[b] || inn.bowling.stats[b].legalBalls < maxBalls));
  return ok[Math.floor(rnd() * ok.length)] || bowlers.find(b => b !== inn.lastOverBowler);
}
function nextEvent(m, inn, aggr){
  const r = rnd(), field = SQUADS[sideName(m, inn.bowlingTeam)];
  if (r < 0.05 * (aggr || 1)){
    const t = rnd(), wt = t < .5 ? "caught" : t < .75 ? "bowled" : t < .9 ? "lbw" : "stumped";
    return { kind: "wicket", wicketType: wt, fielder: wt === "caught" ? field[Math.floor(rnd() * 11)] : wt === "stumped" ? field[0] : undefined };
  }
  if (r < 0.08) return { kind: "wide", runs: 0 };
  const x = rnd();
  return { kind: "run", runs: x < .32 ? 0 : x < .66 ? 1 : x < .78 ? 2 : x < .81 ? 3 : x < .93 ? 4 : 6 };
}
// One innings through the logged engine calls; stops early when stop(inn) says so.
function simInnings(m, stop, aggr){
  const inn = currentInnings(m), bat = SQUADS[sideName(m, inn.battingTeam)];
  if (!inn.striker && !inn.batting.order.length){ openInnings(inn, bat[0], bat[1], pickBowler(m, inn)); m.status = "live"; }
  let guard = 0;
  while (m.status === "live" && guard++ < 400){
    if (pendingBatsmanSlot(inn)) sendInBatter(inn, bat[inn.batting.order.length]);
    if (!inn.bowler) setBowler(inn, pickBowler(m, inn));
    if (stop && stop(inn)) return;
    recordBall(inn, nextEvent(m, inn, aggr));
    afterBall(m);
  }
}
function playMatch(a, b, opts){
  opts = opts || {};
  const m = createMatch({ teamA: a, teamB: b, oversLimit: 20, playersPerSide: 11, battingFirst: opts.first || "A", tournamentId: opts.tournamentId || null });
  m.squads = { A: SQUADS[a].slice(), B: SQUADS[b].slice() };
  simInnings(m, null, opts.aggr1);
  startSecondInnings(m);
  simInnings(m, null, opts.aggr2);
  maybeArchiveCompletedMatch(m);
  return m;
}
`;

const ctx = await browser.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 8 / 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("page error:", e.message));
const run = js => page.evaluate(js => { const s = document.createElement("script"); s.textContent = js; document.body.appendChild(s); }, js);
const tap = async sel => { await page.evaluate(sel => { const el = document.querySelector(sel); if (!el) throw new Error("no " + sel); el.click(); }, sel); await page.waitForTimeout(300); };
const shots = [];
async function shot(name, caption, opts){
  await page.waitForTimeout(400);
  const file = path.join(PLAIN, name + ".jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 92, animations: "disabled", ...(opts || {}) });
  shots.push({ name, caption, file });
  console.log("shot", name);
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#app .home");
await page.waitForSelector("#splash", { state: "detached", timeout: 8000 });
// Celebrations are timed; the stinger shot below freezes one on purpose.
await page.addStyleTag({ content: ".confetti,.moment{display:none!important}" });

await run(SEED.replace("SEED_VALUE", process.env.SEED || "29") + `
  var TEAMS = seedTeams(["Colombo Lions", "Kandy Tigers", "Galle Eagles", "Matara Sharks"]);
  var T = createTournament({ name: "Colombo Weekend Cup", tournamentPresetId: Object.keys(state.tournamentPresets)[0], teamIds: TEAMS.map(t => t.id) });
  [["Colombo Lions", "Kandy Tigers"], ["Galle Eagles", "Matara Sharks"], ["Colombo Lions", "Galle Eagles"],
   ["Kandy Tigers", "Matara Sharks"], ["Colombo Lions", "Matara Sharks"], ["Kandy Tigers", "Galle Eagles", "B"]]
    .forEach(([a, b, first]) => playMatch(a, b, { tournamentId: T.id, first }));
  // The match on screen: a chase, 15 overs in.
  var M = createMatch({ teamA: "Colombo Lions", teamB: "Kandy Tigers", oversLimit: 20, playersPerSide: 11, battingFirst: "B" });
  M.squads = { A: SQUADS["Colombo Lions"].slice(), B: SQUADS["Kandy Tigers"].slice() };
  M.tossWinner = "A";
  state.match = M; state.snapshots = [];
  simInnings(M, null, 1.1);
  startSecondInnings(M);
  simInnings(M, inn => inn.legalBalls >= 15 * 6 + 3, 0.8);
  pushSnapshot();
  state.view = "home"; ui = defaultUi(); save(); render();`);
await page.waitForSelector('#app [data-action="ball"][data-runs="4"]');

// 1. Live scoring
await shot("01-live", ["Score every ball", "in one tap"]);
// 2. A big moment, frozen mid-animation (no ball recorded)
await page.evaluate(() => {
  document.querySelectorAll("#app .moment.stinger").forEach(e => e.remove());
  const s = document.createElement("script");
  s.textContent = `liveMoment = { kind: "six", label: "SIX", sub: null }; playLiveMoment();`;
  document.body.appendChild(s);
  const el = document.querySelector("#app .moment.stinger");
  el.style.setProperty("display", "block", "important");
  el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 560; });
});
await shot("02-moment", ["Every four, six", "and wicket"], { animations: "allow" });
await run("render();");
// 3. The wicket sheet: caught, with the fielder
await tap('#app [data-action="open-wicket"]');
await tap('#modal-root [data-action="pick-wicket"][data-type="caught"]');
await tap("#modal-root .fielder-row");
await shot("03-wicket", ["Every way out,", "even off a wide"]);
await run("resetWicketUi(); render();");
// 4. Fix an earlier ball
await tap('#app [data-action="open-live-scorecard"]');
await tap('#modal-root [data-action="scorecard-mode"][data-tab="balls"]');
await page.evaluate(() => { const chips = document.querySelectorAll('#modal-root [data-action="edit-ball"]'); chips[Math.min(4, chips.length - 1)].click(); });
await page.waitForTimeout(300);
await shot("04-fix-a-ball", ["Made a mistake?", "Fix any ball"]);
await run("ui.ballEdit = null; ui.liveScorecard = false; render();");
// 5. Result: finish the chase
await run(`simInnings(state.match, null, 0.8); maybeArchiveCompletedMatch(state.match); save(); render();`);
await page.waitForSelector('#app [data-action="share-image"]');
await page.evaluate(() => scrollTo(0, 0));
await shot("05-result", ["Results and", "player of the match"]);
// 6. The share image
await tap('#app [data-action="share-image"]');
await page.waitForSelector("#modal-root .share-preview img");
await page.waitForTimeout(500);
await shot("06-share", ["Share the", "scorecard"]);
await tap('#modal-root [data-action="close-share-preview"]');
await tap('#app [data-action="finish-match"]');
// 7. The tournament
await run(`state.activeTournamentId = Object.keys(state.tournaments)[0]; state.view = "tournamentDashboard"; ui.tournamentTab = "overview"; render(); scrollTo(0, 0);`);
await shot("07-tournament", ["Run a", "tournament"]);
// 8. Stats
await run(`state.view = "stats"; ui.statsTab = null; render(); scrollTo(0, 0);`);
await shot("08-stats", ["Stats and", "MVP points"]);
await ctx.close();

// --- captioned versions -----------------------------------------------------
const SUB = {
  "01-live": "Runs, extras, wickets, run rate and target. Works offline.",
  "02-moment": "Broadcast-style moments as you score",
  "03-wicket": "Caught, run out, stumped, LBW and more",
  "04-fix-a-ball": "Change, add or remove an earlier ball",
  "05-result": "Full scorecards, ball by ball and commentary",
  "06-share": "Send it to WhatsApp, or save it",
  "07-tournament": "Fixtures, points table and net run rate",
  "08-stats": "Leaderboards and records for every player"
};
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`; // single quotes: it goes inside style=""
const BACKDROP = `background:
  repeating-linear-gradient(135deg, rgba(255,255,255,.035) 0 22px, transparent 22px 44px),
  radial-gradient(120% 70% at 85% 0%, rgba(74,155,255,.35), transparent 60%),
  linear-gradient(165deg, #0A1B4A 0%, #030B22 70%);`;
const dataUrl = f => "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");
const art = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const artPage = await art.newPage();
for (const s of shots){
  await artPage.setContent(`<!doctype html><html><body style="margin:0;width:1080px;height:1920px;overflow:hidden;${BACKDROP}font-family:${FONT};color:#fff;">
    <div style="position:absolute;left:0;right:0;top:120px;text-align:center;padding:0 60px;">
      <div style="font-size:82px;font-weight:900;line-height:1.04;letter-spacing:-1.5px;">${s.caption[0]}<br><span style="color:#FFC20E;">${s.caption[1]}</span></div>
      <div style="margin-top:26px;font-size:38px;line-height:1.3;color:#B9C6E4;font-weight:500;">${SUB[s.name]}</div>
    </div>
    <div style="position:absolute;left:50%;top:500px;transform:translateX(-50%);width:738px;height:1312px;padding:16px;border-radius:72px;background:#0d1530;border:3px solid #2a3b70;box-shadow:0 30px 80px rgba(0,0,0,.55);">
      <img src="${dataUrl(s.file)}" style="display:block;width:738px;height:1312px;border-radius:56px;">
    </div>
  </body></html>`);
  await artPage.screenshot({ path: path.join(STORE, "screenshots", s.name + ".jpg"), type: "jpeg", quality: 90 });
}
await art.close();

// --- Google Play feature graphic (1024×500) ---------------------------------
const icon = "data:image/png;base64," + fs.readFileSync(path.join(MOBILE, "..", "icon-512.png")).toString("base64");
const fg = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
const fgPage = await fg.newPage();
await fgPage.setContent(`<!doctype html><html><body style="margin:0;width:1024px;height:500px;overflow:hidden;position:relative;${BACKDROP}font-family:${FONT};color:#fff;">
  <div style="position:absolute;left:64px;top:84px;width:560px;">
    <img src="${icon}" style="width:112px;height:112px;display:block;">
    <div style="margin-top:22px;font-size:84px;font-weight:900;letter-spacing:-2px;line-height:1;">Cricket<span style="color:#FFC20E;">.lk</span></div>
    <div style="margin-top:16px;font-size:34px;font-weight:600;color:#DCE4F7;">Ball-by-ball cricket scorer</div>
    <div style="margin-top:26px;display:flex;gap:12px;">
      ${["Works offline", "No sign-up", "Free"].map(t => `<span style="font-size:22px;font-weight:700;padding:9px 18px;border-radius:999px;border:2px solid rgba(255,194,14,.7);color:#FFC20E;">${t}</span>`).join("")}
    </div>
  </div>
  <div style="position:absolute;right:70px;top:46px;width:300px;height:533px;padding:9px;border-radius:40px;background:#0d1530;border:3px solid #2a3b70;box-shadow:0 20px 50px rgba(0,0,0,.5);">
    <img src="${dataUrl(shots[0].file)}" style="display:block;width:300px;height:533px;border-radius:31px;">
  </div>
</body></html>`);
await fgPage.screenshot({ path: path.join(STORE, "feature-graphic.jpg"), type: "jpeg", quality: 92 });
await fg.close();

await browser.close();
server.close();
console.log(`store-graphics: ${shots.length} screenshots in store/screenshots (+ plain/), store/feature-graphic.jpg`);
