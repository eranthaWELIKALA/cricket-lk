/* Cricket.lk — match: match setup.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- match setup --- */
function renderMatchSetup(){
  if (state.match && state.match.status !== "complete"){
    return `
      <div class="screen">
        ${renderBackBar("Home", "home")}
        <h1>Match in progress</h1>
        <p class="hint">Finish or forfeit the live match before starting a new one.</p>
        <button data-action="resume-match" class="primary">Resume live match</button>
      </div>
    `;
  }
  const clubMode = ui.currentClubId && ui.clubMatchSetupType; // set via "go-club-match-setup"
  const presets = matchPresetChoices();
  if (!ui.matchSetupPresetId || !presets.some(p => p.id === ui.matchSetupPresetId)){
    ui.matchSetupPresetId = presets.length ? presets[0].id : null;
  }
  const preset = presets.find(p => p.id === ui.matchSetupPresetId) || {};
  const clubName = clubMode ? currentClubName() : "";
  const inTournament = clubMode && ui.clubMatchSetupType === "tournament";
  const tournamentName = inTournament && ui.clubTournament ? ui.clubTournament.name : "";
  // Two or more saved tournament teams -> pick them instead of typing names.
  const savedTeams = inTournament && ui.clubTournament && ui.clubTournament.id === ui.currentTournamentId ? ui.clubTournament.teams || [] : [];
  const pickTeams = savedTeams.length >= 2;
  const headings = { practice: "🏏 Practice match", friendly: "🤝 Friendly match", tournament: `🏆 Tournament match` };
  const taglines = {
    practice: `${escapeHtml(clubName)} vs itself — an intra-club scrimmage.`,
    friendly: `${escapeHtml(clubName)} vs a visiting team.`,
    tournament: `Counts toward ${escapeHtml(tournamentName)}.`
  };
  return `
    <div class="screen setup">
      ${inTournament ? renderBackBar(tournamentName, "clubTournamentDashboard") : clubMode ? renderBackBar(clubName || "Home", "home") : renderBackBar("Home", "home")}
      <h1>${clubMode ? headings[ui.clubMatchSetupType] : "🏏 New match"}</h1>
      <p class="tagline">${clubMode ? taglines[ui.clubMatchSetupType] : "Pick a preset, tweak anything, start scoring."}</p>
      ${clubMode && !presets.length ? `<p class="hint">${ui.club && ui.club.id === ui.currentClubId ? "This club has no presets yet — add some on the club page. You can still type the conditions below." : "Loading this club's presets…"}</p>` : ""}
      ${presets.length ? `
        <div class="preset-picker">
          ${presets.map(p => `<button type="button" data-action="pick-match-preset" data-id="${p.id}" class="preset-chip ${p.id === ui.matchSetupPresetId ? "active" : ""}">${escapeHtml(p.name)}</button>`).join("")}
        </div>
      ` : ""}
      <form id="match-setup-form">
        <div class="form-error"></div>
        <input type="hidden" name="presetId" value="${preset.id || ""}">
        <h3 class="section-label">Teams</h3>
        ${pickTeams ? `
        <div class="versus-picker">
          ${["A", "B"].map((side, s) => `
            <fieldset class="team-pick-col" data-side="${side}" data-current="${savedTeams[s].id}">
              <legend>${side === "A" ? "Team A" : "Team B"}</legend>
              ${savedTeams.map((t, i) => `
                <label class="team-pick team-c${i % 4}">
                  <input type="radio" name="team${side}Id" value="${t.id}" ${i === s ? "checked" : ""}>
                  <span class="team-badge">${escapeHtml(nameInitials(t.name))}</span>
                  <span class="team-pick-text"><b>${escapeHtml(t.name)}</b><span class="muted">${t.players.length} player${t.players.length === 1 ? "" : "s"}${t.players.length ? ` · ${escapeHtml(t.players.slice(0, 3).map(p => p.name.split(/\s+/)[0]).join(", "))}${t.players.length > 3 ? "…" : ""}` : ""}</span></span>
                </label>`).join("")}
            </fieldset>
            ${side === "A" ? `<div class="vs-badge">VS</div>` : ""}`).join("")}
        </div>
        <p class="hint">From this tournament's teams. Only their players are suggested while scoring. Swap players between the sides for this match from ⋯ Match options once it starts.</p>
        ` : `
        <label>${clubMode && ui.clubMatchSetupType === "friendly" ? "Home team name" : "Team A name"}<input name="teamA" required maxlength="24" value="${clubMode && ui.clubMatchSetupType === "friendly" ? escapeHtml(clubName) : ""}" placeholder="e.g. Lions" list="teams-datalist"></label>
        <label>${clubMode && ui.clubMatchSetupType === "friendly" ? "Visiting team name" : "Team B name"}<input name="teamB" required maxlength="24" placeholder="e.g. Tigers" list="teams-datalist"></label>
        ${inTournament && !pickTeams ? `<p class="hint">Tip: add teams on the tournament page to pick them here.</p>` : ""}
        ${!clubMode && Object.keys(state.teams).length ? `<p class="hint">Type a saved team's name to bring its players along — only they're suggested for that side while scoring, and ⋯ Match options can switch players between sides.</p>` : ""}
        `}
        <h3 class="section-label">Playing conditions</h3>
        <div class="field-row">
          <label>Balls per over<input name="ballsPerOver" type="number" min="1" max="10" value="${preset.ballsPerOver ?? 6}" required></label>
          <label>Overs per innings<input name="overs" type="number" min="1" max="50" value="${limitInputValue(preset.oversLimit, 20)}" placeholder="No limit"></label>
        </div>
        <label>Players per side<input name="players" type="number" min="2" max="11" value="${limitInputValue(preset.playersPerSide, 11)}" placeholder="No limit"></label>
        <label class="check-row"><input type="checkbox" name="lastManStands" ${preset.lastManStands ? "checked" : ""}> Last man stands — the last batter bats alone</label>
        <p class="hint">Leave overs or players blank for no limit. With no overs limit, end each innings by hand from the live screen.</p>
        <fieldset>
          <legend>Extras</legend>
          <label class="check-row"><input type="checkbox" name="wideEnabled" ${preset.wide ? (preset.wide.enabled ? "checked" : "") : "checked"}> Wides count, worth <input name="wideRuns" type="number" min="0" max="6" value="${preset.wide ? preset.wide.runs : 1}" class="inline-num"> run(s)</label>
          <label class="check-row"><input type="checkbox" name="noBallEnabled" ${preset.noBall ? (preset.noBall.enabled ? "checked" : "") : "checked"}> No-balls count, worth <input name="noBallRuns" type="number" min="0" max="6" value="${preset.noBall ? preset.noBall.runs : 1}" class="inline-num"> run(s)</label>
          <label class="check-row"><input type="checkbox" name="freeHitOnNoBall" ${preset.freeHitOnNoBall !== false ? "checked" : ""}> No-ball gives a free hit</label>
        </fieldset>
        <fieldset>
          <legend>Fielder credit</legend>
          <label class="check-row"><input type="checkbox" name="requireFielderOnCatch" ${preset.requireFielderOnCatch ? "checked" : ""}> Require a catch taker</label>
          <label class="check-row"><input type="checkbox" name="requireFielderOnRunout" ${preset.requireFielderOnRunout ? "checked" : ""}> Require a run-out taker</label>
        </fieldset>
        <h3 class="section-label">Batting first</h3>
        <fieldset class="tile-fieldset">
          <legend>Who bats first?</legend>
          <label><input type="radio" name="battingFirst" value="A" checked> <span data-bat-label="A">${pickTeams ? escapeHtml(savedTeams[0].name) : clubMode && ui.clubMatchSetupType === "friendly" && clubName ? escapeHtml(clubName) : "Team A"}</span></label>
          <label><input type="radio" name="battingFirst" value="B"> <span data-bat-label="B">${pickTeams ? escapeHtml(savedTeams[1].name) : "Team B"}</span></label>
        </fieldset>
        <p class="hint">Openers and the first bowler are asked for on the next screen. Got the toss wrong? You can flip it there.</p>
        <button type="submit" class="primary">Start match</button>
      </form>
    </div>
  `;
}

function handleMatchSetupSubmit(e){
  e.preventDefault();
  if (state.match && state.match.status !== "complete") return;
  const f = new FormData(e.target);
  let teamA = (f.get("teamA") || "").trim() || "Team A";
  let teamB = (f.get("teamB") || "").trim() || "Team B";
  let squads = null, guestNames = [];
  if (f.get("teamAId")){
    const saved = (ui.clubTournament && ui.clubTournament.teams) || [];
    const ta = saved.find(t => t.id === f.get("teamAId")), tb = saved.find(t => t.id === f.get("teamBId"));
    if (!ta || !tb || ta.id === tb.id){ showFormError(e.target, "Pick two different teams."); return; }
    teamA = ta.name; teamB = tb.name;
    squads = { A: ta.players.map(p => p.name), B: tb.players.map(p => p.name) };
    guestNames = [...ta.players, ...tb.players].filter(p => p.guest).map(p => p.name);
  } else if (!(ui.currentClubId && ui.clubMatchSetupType)){
    // Guest match: a name that matches a saved guest team brings its players
    // along as that side's squad (same as picking a club tournament team).
    const saved = n => Object.values(state.teams).find(t => t.name.toLowerCase() === n.toLowerCase());
    const ta = saved(teamA), tb = saved(teamB);
    if (ta) teamA = ta.name; if (tb) teamB = tb.name;   // the saved spelling
    const A = guestTeamSquad(ta, state.players), B = guestTeamSquad(tb, state.players);
    if (A.length || B.length) squads = { A, B };
  }
  const oversLimit = parseOptionalLimit(f.get("overs"), 1);
  const playersPerSide = parseOptionalLimit(f.get("players"), 2);
  const lastManStands = f.get("lastManStands") === "on";
  const ballsPerOver = Math.max(1, parseInt(f.get("ballsPerOver"), 10) || 6);
  const battingFirst = f.get("battingFirst") || "A";
  const wideEnabled = f.get("wideEnabled") === "on";
  const noBallEnabled = f.get("noBallEnabled") === "on";
  const wideRuns = Math.max(0, parseInt(f.get("wideRuns"), 10) || 0);
  const noBallRuns = Math.max(0, parseInt(f.get("noBallRuns"), 10) || 0);
  const freeHitOnNoBall = f.get("freeHitOnNoBall") === "on";
  const requireFielderOnCatch = f.get("requireFielderOnCatch") === "on";
  const requireFielderOnRunout = f.get("requireFielderOnRunout") === "on";
  const preset = matchPresetChoices().find(p => p.id === f.get("presetId"));
  const inTournament = ui.currentClubId && ui.clubMatchSetupType === "tournament";
  state.match = createMatch({
    teamA, teamB, oversLimit, playersPerSide, battingFirst, ballsPerOver,
    wideEnabled, noBallEnabled, wideRuns, noBallRuns, freeHitOnNoBall, lastManStands,
    requireFielderOnCatch, requireFielderOnRunout,
    presetId: preset ? preset.id : null, presetName: preset ? preset.name : null,
    tournamentId: inTournament ? ui.currentTournamentId : null
  });
  if (ui.currentClubId && ui.clubMatchSetupType){
    // Extra, UI-only fields on top of the engine's match object (like
    // tournamentId already is) -- recordBall etc. never look at these.
    state.match.clubId = ui.currentClubId;
    state.match.matchType = ui.clubMatchSetupType;
    // Read by playerTeamInMatch (side checks) and the squad datalists.
    if (squads) state.match.squads = squads;
    if (guestNames.length) state.match.guestNames = guestNames;
  } else if (squads) state.match.squads = squads;
  state.snapshots = [];
  save(); render();
}
