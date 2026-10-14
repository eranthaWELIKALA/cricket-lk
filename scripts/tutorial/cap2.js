const { setup, BASE } = require('./cap-lib.js');
const SEED = require('./seed.js');
(async () => {
  const { b, p, run, tap, shot, hideBanner } = await setup();
  await p.goto(BASE); await p.waitForTimeout(1600); await hideBanner();
  await run(SEED + `
    var TEAMS = seedTeams(["Colombo Lions","Kandy Tigers","Galle Eagles","Jaffna Kings"]);
    var TP = Object.keys(state.tournamentPresets)[0];
    var T = createTournament({ name: "Lanka Super Cup", tournamentPresetId: TP, teamIds: TEAMS.map(t => t.id) });
    playMatch("Colombo Lions","Kandy Tigers", T.id, 20);
    playMatch("Galle Eagles","Jaffna Kings", T.id, 20, "B");
    playMatch("Colombo Lions","Galle Eagles", T.id, 20);
    playMatch("Kandy Tigers","Jaffna Kings", T.id, 20, "B");
    playMatch("Colombo Lions","Jaffna Kings", null, 10);
    save(); render();`);
  // --- no names ---
  await tap('[data-action="go-match-setup"]');
  await p.fill('[name=teamA]', 'Lions'); await p.fill('[name=teamB]', 'Tigers');
  await p.check('[name=anonymous]');
  await p.evaluate(() => document.querySelector('[name=anonymous]').scrollIntoView({ block: 'center' }));
  await shot('23-no-names-option');
  await tap('#match-setup-form button[type=submit]');
  for (const r of [1, 4, 0, 1, 6]) await tap(`#app [data-action="ball"][data-runs="${r}"]`);
  await tap('#app [data-action="open-wicket"]'); await tap('#modal-root [data-action="pick-wicket"][data-type="bowled"]');
  await tap('#app [data-action="ball"][data-runs="2"]');
  await shot('24-no-names-live');
  await run(`state.match = null; state.snapshots = []; state.view = "home"; ui = defaultUi(); save(); render();`);
  await shot('25-home-with-data');
  // --- teams, players, presets, stats ---
  await run(`state.view = "teams"; render();`); await shot('26-teams');
  await run(`state.view = "players"; render();`); await shot('27-players');
  await run(`state.view = "presets"; render();`); await shot('28-presets');
  await run(`state.view = "stats"; render();`); await shot('29-stats');
  // --- tournaments ---
  await run(`state.view = "tournamentSetup"; render();`); await shot('30-tournament-setup');
  await run(`state.activeTournamentId = Object.keys(state.tournaments)[0]; state.view = "tournamentDashboard"; ui.tournamentTab = null; render();`);
  await shot('31-tournament-overview');
  await run(`ui.tournamentTab = "teams"; ui.expandedTeamId = activeTournament().teamIds[0]; render();`); await shot('32-tournament-teams');
  await run(`ui.tournamentTab = "fixtures"; render();`); await shot('33-tournament-fixtures');
  await tap('#app [data-action="open-result-entry"]');
  await p.selectOption('#result-entry-form [name=teamA]', 'Galle Eagles'); await p.selectOption('#result-entry-form [name=teamB]', 'Kandy Tigers');
  await p.fill('[name=runsA]', '164'); await p.fill('[name=wktsA]', '7'); await p.fill('[name=oversA]', '20');
  await p.fill('[name=runsB]', '158'); await p.fill('[name=wktsB]', '9'); await p.evaluate(() => document.activeElement.blur());
  await shot('34-result-only');
  await tap('#result-entry-form button[type=submit]');
  await run(`ui.tournamentTab = "stats"; render();`); await shot('35-tournament-stats');
  await run(`ui.tournamentTab = "overview"; render(); document.querySelector('[data-action="end-tournament"]').scrollIntoView({block:"center"});`);
  await tap('#app [data-action="end-tournament"]'); await shot('36-end-tournament');
  await tap('#confirm-root [data-action="confirm-ok"]'); await p.evaluate(() => scrollTo(0, 0));
  await shot('37-summary');
  await tap('#app [data-action="share-tournament"]'); await p.waitForTimeout(900); await shot('38-summary-share');
  await tap('#modal-root [data-action="close-share-preview"]');
  // --- settings ---
  await run(`state.view = "settings"; render();`); await shot('39-settings');
  await b.close();
})();
