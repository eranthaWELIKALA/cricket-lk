// In-page seeding helpers (string, injected with run()).
module.exports = `
var SEED = 7; function rnd(){ SEED = (SEED * 16807) % 2147483647; return (SEED - 1) / 2147483646; }
var SQUADS = {
  "Colombo Lions": ["Kusal Mendis","Pathum Nissanka","Charith Asalanka","Dasun Shanaka","Kamindu Mendis","Wanindu Hasaranga","Dunith Wellalage","Maheesh Theekshana","Matheesha Pathirana","Dilshan Madushanka","Nuwan Thushara"],
  "Kandy Tigers": ["Angelo Mathews","Dinesh Chandimal","Sadeera Samarawickrama","Avishka Fernando","Bhanuka Rajapaksa","Chamika Karunaratne","Ramesh Mendis","Lahiru Kumara","Kasun Rajitha","Pramod Madushan","Jeffrey Vandersay"],
  "Galle Eagles": ["Niroshan Dickwella","Oshada Fernando","Lahiru Thirimanne","Janith Liyanage","Sahan Arachchige","Dhananjaya de Silva","Praveen Jayawickrama","Asitha Fernando","Vishwa Fernando","Dushmantha Chameera","Binura Fernando"],
  "Jaffna Kings": ["Thisara Perera","Upul Tharanga","Minod Bhanuka","Nishan Madushka","Akila Dananjaya","Suranga Lakmal","Isuru Udana","Lakshan Sandakan","Ashen Bandara","Chathuranga de Silva","Kevin Koththigoda"]
};
function seedTeams(names){
  return names.map(n => { const t = createTeam(n); SQUADS[n].forEach(p => addPlayerToTeam(t.id, p)); return t; });
}
function simulate(m, aggr){
  const sq = { A: SQUADS[m.teamA], B: SQUADS[m.teamB] };
  for (let k = 0; k < 2; k++){
    let inn = currentInnings(m);
    const bat = sq[inn.battingTeam], bowl = sq[inn.bowlingTeam].slice(5);
    let next = 0;
    const nb = () => { const n = bat[next++]; ensureBatsman(inn, n); return n; };
    inn.striker = nb(); inn.nonStriker = nb(); m.status = "live";
    let guard = 0;
    while (!inn.complete && guard++ < 400){
      const slot = pendingBatsmanSlot(inn); if (slot) inn[slot] = nb();
      if (!inn.bowler){ const opts = bowl.filter(b => b !== inn.lastOverBowler && (!inn.bowling.stats[b] || inn.bowling.stats[b].legalBalls < (m.oversLimit || 20) / 5 * (m.ballsPerOver||6))); const b = opts[Math.floor(rnd() * opts.length)] || bowl.find(b => b !== inn.lastOverBowler); ensureBowler(inn, b); inn.bowler = b; }
      const r = rnd();
      if (r < 0.055 * (aggr || 1)){ const t = rnd(); const wt = t < .45 ? "caught" : t < .7 ? "bowled" : t < .85 ? "lbw" : "stumped"; recordBall(inn, { kind: "wicket", wicketType: wt, fielder: wt === "caught" ? sq[inn.bowlingTeam][Math.floor(rnd() * 11)] : undefined }); }
      else if (r < 0.085) recordBall(inn, { kind: "wide", runs: 0 });
      else { const x = rnd(); recordBall(inn, { kind: "run", runs: x < .33 ? 0 : x < .68 ? 1 : x < .8 ? 2 : x < .83 ? 3 : x < .94 ? 4 : 6 }); }
      afterBall(m);
    }
    if (k === 0){ startSecondInnings(m); }
  }
  m.motm = pickMatchMOTM(m);
  return m;
}
function playMatch(a, b, tournamentId, oversLimit, first){
  const m = createMatch({ teamA: a, teamB: b, oversLimit: oversLimit || 10, playersPerSide: 11, battingFirst: first || "A", tournamentId });
  simulate(m);
  return archiveMatch(m);
}
`;
