const { setup, BASE } = require('./cap-lib.js');
const SEED = require('./seed.js');
(async () => {
  const { b, p, run, tap, shot, hideBanner } = await setup();
  await p.goto(BASE); await p.waitForTimeout(1600); await hideBanner();
  await run(`supabaseClient = { auth: {} }; state.view = "signIn"; render();`); await shot('40-sign-in'); await run(`supabaseClient = null;`);
  await run(SEED + `
    session = { user: { id: "u1", email: "erantha@example.com" } };
    profile = { display_name: "Erantha Welikala" };
    var NICK = { "Kusal Mendis": ["KM", 13], "Pathum Nissanka": ["Pathu", 18], "Charith Asalanka": ["Chari", 72], "Wanindu Hasaranga": ["Wanni", 49], "Dasun Shanaka": ["Shana", 7], "Angelo Mathews": ["Angie", 69], "Dinesh Chandimal": ["Chandi", 57], "Maheesh Theekshana": ["Mahee", 61] };
    var pid = 0; var ROSTER = [...SQUADS["Colombo Lions"], ...SQUADS["Kandy Tigers"]].map(n => ({ id: "p" + (++pid), name: n, nickname: NICK[n] ? NICK[n][0] : null, jersey_no: NICK[n] ? NICK[n][1] : null }));
    var cm = []; [["Colombo Lions","Kandy Tigers"],["Kandy Tigers","Colombo Lions"],["Colombo Lions","Kandy Tigers"]].forEach(([a,b], i) => { const m = createMatch({ teamA: a, teamB: b, oversLimit: 10, playersPerSide: 11, battingFirst: "A", tournamentId: "t1" }); simulate(m); m.clubId = "c1"; m.matchType = "tournament"; m.id = "cm" + i; m.completedAt = Date.now() - i * 86400000; cm.push({ id: m.id, match_type: "tournament", data: m, played_at: new Date(m.completedAt).toISOString() }); });
    ui.myClubs = [{ id: "c1", name: "Moratuwa CC", role: "owner" }];
    ui.club = { id: "c1", name: "Moratuwa CC", members: [{ userId: "u1", role: "owner", displayName: "Erantha Welikala" }, { userId: "u2", role: "admin", displayName: "Nimal Perera" }],
      roster: ROSTER, matches: cm, tournaments: [{ id: "t1", name: "Saturday Super 10", created_at: new Date().toISOString() }], invites: [{ id: "i1", email: "coach@example.com", created_at: new Date().toISOString() }],
      presets: { match: DEFAULT_MATCH_PRESETS.map(x => Object.assign({}, x)), tournament: [] } };
    state.activeClubId = "c1"; state.view = "account"; render();`);
  await shot('41-account');
  await run(`state.view = "home"; render();`); await shot('42-home-club');
  await run(`ui.currentClubId = "c1"; state.view = "clubAdmins"; render();`); await shot('43-club-admins');
  await run(`state.view = "clubPlayers"; render();`); await shot('44-club-players');
  await run(`ui.playerModal = { kind: "add" }; render();`);
  await p.fill('#modal-root input[name=name]', 'Kamindu Mendis'); await p.evaluate(() => document.activeElement.blur());
  await shot('45-add-player');
  await run(`ui.playerModal = null; render();`);
  await run(`ui.profile = { scope: "club", id: "p1", name: "Kusal Mendis", pending: false, loading: false, error: null, editing: false, message: null, aliases: [], claiming: false, merging: false,
      clubMatches: ui.club.matches.map(x => x.data),
      data: { id: "p1", name: "Kusal Mendis", nickname: "KM", jersey_no: 13, batting_hand: "right", bowling_arm: null, bowling_type: null, is_keeper: true, city: "Moratuwa", phone: "077 123 4567", nic: "199512345678", photo: null, can_see_contact: true, claimed_by: null } };
    ui.identity = { myPlayer: null, pendingClaim: null, pendingMerges: [] };
    ui.premier = { players: ROSTER.map(r => ({ id: r.id, name: r.name, claimed_by: r.id === "p3" ? "u9" : null })), premierMatches: [], pendingClaims: [], pendingMerges: [] };
    state.view = "playerProfile"; render();`);
  await shot('46-profile');
  await run(`ui.profile.tab = "stats"; render(); scrollTo(0,0);`); await shot('47-profile-stats');
  await run(`state.view = "clubPresets"; render(); scrollTo(0,0);`); await shot('48-club-presets');
  await run(`ui.clubTournament = { id: "t1", name: "Saturday Super 10", organizer_club_id: "c1", tournament_preset: { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true },
      matches: ui.club.matches, teams: [
        { id: "ta", name: "Colombo Lions", players: ROSTER.slice(0, 11).map(r => ({ id: r.id, name: r.name })) },
        { id: "tb", name: "Kandy Tigers", players: [...ROSTER.slice(11, 21).map(r => ({ id: r.id, name: r.name })), { id: "guest:ruwan silva", name: "Ruwan Silva", guest: true }] } ] };
    ui.currentTournamentId = "t1"; state.view = "clubTournamentDashboard"; ui.tournamentTab = null; render();`);
  await shot('49-club-tournament');
  await run(`ui.tournamentTab = "teams"; ui.expandedTeamId = "tb"; render();`); await shot('50-club-teams');
  await run(`ui.tournamentTeamEdit = teamEditState("tb", "Kandy Tigers", ui.clubTournament.teams[1].players.map(p => p.id)); ui.tournamentTeamEdit.guests = []; render();`);
  await shot('51-team-builder');
  await p.fill('.team-builder-search', 'Sanath Jayasuriya'); await p.evaluate(() => { const c = document.querySelector('.builder-add'); c.scrollIntoView({ block: 'center' }); });
  await shot('52-builder-add');
  await tap('#modal-root [data-action="team-builder-add-new"]'); await tap('#confirm-root [data-action="confirm-pick"][data-value="guest"]');
  await shot('53-new-member-choice');
  await tap('#confirm-root [data-action="confirm-cancel"]');
  await p.fill('.team-builder-search', 'Kusal'); await p.waitForTimeout(200);
  await tap('#modal-root .pick-row[data-id="p1"]'); await shot('54-move-player');
  await run(`ui.confirm = null; ui.tournamentTeamEdit = null; render();`);
  await run(`ui.clubMatchSetupType = "tournament"; state.view = "matchSetup"; render();`);
  await p.evaluate(() => document.querySelector('.versus-picker').scrollIntoView({ block: 'start' })); await p.evaluate(() => scrollBy(0, -80));
  await shot('55-club-match-setup');
  // sync pill + sheet
  await run(`outbox = [
      { id: "o1", kind: "match", args: { id: "m9", data: { teamA: "Colombo Lions", teamB: "Kandy Tigers" } }, userId: "u1", createdAt: Date.now(), attempts: 0, failed: false },
      { id: "o2", kind: "roster.add", args: { clubId: "c1", name: "Kamindu Mendis" }, userId: "u1", createdAt: Date.now(), attempts: 0, failed: false },
      { id: "o3", kind: "team.save", args: { id: "tb", name: "Kandy Tigers", tournamentId: "t1" }, userId: "u1", createdAt: Date.now(), attempts: 1, failed: true, error: "Waiting for Kamindu Mendis to be added to the club first." } ];
    session.offline = true; state.view = "home"; ui.clubMatchSetupType = null; render();`);
  await shot('56-sync-pill', { clip: { x: 0, y: 0, width: 390, height: 420 } });
  await run(`ui.syncSheet = true; render();`); await shot('57-sync-sheet');
  await run(`ui.syncSheet = false; outbox = []; session.offline = false; render();`);
  // premier
  await run(`state.view = "premier"; render();`); await shot('58-premier');
  await run(`state.view = "premierPlayers"; render();`); await shot('59-premier-players');
  await b.close();
})();
