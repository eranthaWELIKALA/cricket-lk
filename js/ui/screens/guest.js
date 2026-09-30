/* Cricket.lk — screens: guest teams, players, presets, tournaments.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- teams & players --- */
function renderTeamsScreen(){
  const teams = Object.values(state.teams);
  const selected = ui.selectedTeamId ? state.teams[ui.selectedTeamId] : null;
  return `
    <div class="screen teams">
      ${renderBackBar("Home", "home")}
      <h1>👥 Teams</h1>
      <p class="hint guest-note">Guest teams and players — kept only on this device, for guest mode. They are never added to a club or the global (Premier) list.</p>
      <form id="new-team-form" class="inline-form">
        <input name="name" required maxlength="30" placeholder="New team name">
        <button type="submit" class="primary small">Add team</button>
      </form>
      <div class="team-list">
        ${teams.map(t => `
          <button data-action="select-team" data-id="${t.id}" class="list-row ${selected && selected.id === t.id ? "active" : ""}">
            <span>${escapeHtml(t.name)}</span><span class="muted">${t.playerIds.length} player${t.playerIds.length === 1 ? "" : "s"}</span>
          </button>
        `).join("") || `<p class="hint">No teams yet — add one above.</p>`}
      </div>
      ${selected ? renderTeamRoster(selected, teams) : ""}
    </div>
  `;
}

function renderTeamRoster(team, allTeams){
  const otherTeams = allTeams.filter(t => t.id !== team.id);
  return `
    <div class="roster-card">
      <div class="roster-header">
        <h3>${escapeHtml(team.name)}</h3>
        <button data-action="delete-team" data-id="${team.id}" class="ghost small">Delete team</button>
      </div>
      <form id="add-player-form" data-team="${team.id}" class="inline-form">
        <input name="name" required maxlength="24" placeholder="Add player" list="players-datalist">
        <button type="submit" class="primary small">Add</button>
      </form>
      ${team.playerIds.map(pid => {
        const p = state.players[pid];
        if (!p) return "";
        return `
          <div class="player-row roster-row">
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="roster-actions">
              ${otherTeams.length ? `
                <select data-role="move-target">${otherTeams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}</select>
                <button data-action="move-player" data-player="${p.id}" data-from="${team.id}" class="ghost small">Move</button>
              ` : ""}
              <button data-action="remove-player" data-player="${p.id}" data-team="${team.id}" class="ghost small">Remove</button>
            </span>
          </div>
        `;
      }).join("") || `<p class="hint">No players yet.</p>`}
    </div>
  `;
}

function handleNewTeamSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const name = (f.get("name") || "").trim();
  if (!name) return;
  const team = createTeam(name);
  ui.selectedTeamId = team.id;
  save(); render();
}

function handleAddPlayerSubmit(e){
  e.preventDefault();
  const teamId = e.target.dataset.team;
  const f = new FormData(e.target);
  const name = (f.get("name") || "").trim();
  if (!name) return;
  addPlayerToTeam(teamId, name);
  save(); render();
}

/* --- players: the full local, global (not per-team) roster --
   state.players itself, split out from Teams (see Home's separate
   Teams/Players tiles). A player can exist here with no team at all
   (e.g. typed into a match's striker/bowler field via the
   players-datalist autocomplete, never assigned to a team). --- */
function renderPlayersScreen(){
  const players = Object.values(state.players).sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>🧑‍🤝‍🧑 Players</h1>
      <p class="hint guest-note">Guest players — kept only on this device, for guest mode. They are never added to a club or the global (Premier) list.</p>
      <form id="add-global-player-form" class="inline-form">
        <input name="name" required maxlength="24" placeholder="New player name">
        <button type="submit" class="primary small">Add</button>
      </form>
      ${players.length ? players.map(p => {
        const teams = Object.values(state.teams).filter(t => t.playerIds.includes(p.id));
        return `
          <div class="list-row">
            <span>${escapeHtml(p.name)} <span class="muted">${teams.length ? escapeHtml(teams.map(t => t.name).join(", ")) : "No team"}</span></span>
            <button data-action="delete-player" data-id="${p.id}" class="ghost small">Delete</button>
          </div>
        `;
      }).join("") : `<p class="hint">No players yet — add one above, or type a new name while scoring a match.</p>`}
    </div>
  `;
}

function handleAddGlobalPlayerSubmit(e){
  e.preventDefault();
  const name = (new FormData(e.target).get("name") || "").trim();
  if (!name) return;
  findOrCreatePlayer(name);
  save(); render();
}

/* --- presets --- */
function renderPresetsScreen(){
  const tab = ui.presetsTab || "match";
  return `
    <div class="screen presets">
      ${renderBackBar("Home", "home")}
      <h1>⚙️ Presets</h1>
      <div class="tab-row">
        <button data-action="switch-presets-tab" data-tab="match" class="tab-btn ${tab === "match" ? "active" : ""}">Match presets</button>
        <button data-action="switch-presets-tab" data-tab="tournament" class="tab-btn ${tab === "tournament" ? "active" : ""}">Tournament presets</button>
      </div>
      ${tab === "match" ? renderMatchPresetsTab() : renderTournamentPresetsTab()}
    </div>
  `;
}

/* Card builders shared by the guest Presets screen and the club page's
   presets section -- markup only; each caller passes its own data and its
   own edit/delete action names, so the two never touch each other's store. */
function matchPresetCardHtml(p, builtIn, editAction, deleteAction){
  const tags = [
    ...conditionTagsFor(p),
    p.wide.enabled ? `wide ${p.wide.runs}` : "wides off",
    p.noBall.enabled ? `no-ball ${p.noBall.runs}` : "no-balls off"
  ];
  const fielderBits = [p.requireFielderOnCatch && "catch", p.requireFielderOnRunout && "run out"].filter(Boolean);
  return `
    <div class="preset-row ${builtIn ? "builtin" : ""}">
      <div class="preset-row-head">
        <b>${escapeHtml(p.name)}</b>
        ${builtIn ? `<span class="required-badge">BUILT IN</span>` : ""}
        <div class="row-actions">
          <button data-action="${editAction}" data-id="${p.id}" class="ghost small">Edit</button>
          <button data-action="${deleteAction}" data-id="${p.id}" class="ghost small">Delete</button>
        </div>
      </div>
      <div class="chips">
        ${tags.map(t => `<span class="n tag-pill">${escapeHtml(t)}</span>`).join("")}
        <span class="n tag-pill${p.freeHitOnNoBall !== false ? " gold" : ""}">free hit ${p.freeHitOnNoBall !== false ? "on" : "off"}</span>
        ${fielderBits.length ? `<span class="n tag-pill">fielder: ${fielderBits.join(" + ")}</span>` : ""}
      </div>
    </div>
  `;
}
function tournamentPresetCardHtml(p, matchPresetName, builtIn, editAction, deleteAction){
  return `
    <div class="preset-row ${builtIn ? "builtin" : ""}">
      <div class="preset-row-head">
        <b>${escapeHtml(p.name)}</b>
        ${builtIn ? `<span class="required-badge">BUILT IN</span>` : ""}
        <div class="row-actions">
          <button data-action="${editAction}" data-id="${p.id}" class="ghost small">Edit</button>
          <button data-action="${deleteAction}" data-id="${p.id}" class="ghost small">Delete</button>
        </div>
      </div>
      <div class="chips">
        ${matchPresetName ? `<span class="n tag-pill">${escapeHtml(matchPresetName)}</span>` : ""}
        <span class="n tag-pill">win ${p.pointsForWin}</span>
        <span class="n tag-pill">tie ${p.pointsForTie}</span>
        <span class="n tag-pill">loss ${p.pointsForLoss}</span>
        <span class="n tag-pill${p.useNRR !== false ? " gold" : ""}">NRR ${p.useNRR !== false ? "on" : "off"}</span>
      </div>
    </div>
  `;
}

/* "BUILT IN" is purely informational (id-matched against
   DEFAULT_MATCH_PRESETS) -- it doesn't gate Edit/Delete. A built-in
   preset is only special in that it's what a fresh install starts with;
   once seeded it's an ordinary preset the user can freely change or
   remove (see CLAUDE.md's "Storage schema & migration"). */
function renderMatchPresetsTab(){
  const editing = ui.editingMatchPreset;
  const builtInIds = new Set(DEFAULT_MATCH_PRESETS.map(p => p.id));
  return `
    <div class="preset-list">
      ${Object.values(state.matchPresets).map(p => matchPresetCardHtml(p, builtInIds.has(p.id), "edit-match-preset", "delete-match-preset")).join("")}
    </div>
    ${editing ? renderMatchPresetForm(editing) : `<button data-action="new-match-preset" class="link-btn">+ New match preset</button>`}
  `;
}

function renderMatchPresetForm(p, clubId){
  return `
    <form id="${clubId ? "club-" : ""}match-preset-form" class="preset-form">
      <input type="hidden" name="id" value="${p.id || ""}">
      ${clubId ? `<div class="form-error"></div>` : ""}
      <label>Name<input name="name" required maxlength="30" value="${escapeHtml(p.name || "")}"></label>
      <div class="field-row">
        <label>Balls/over<input name="ballsPerOver" type="number" min="1" max="10" value="${p.ballsPerOver ?? 6}" required></label>
        <label>Overs<input name="oversLimit" type="number" min="1" max="50" value="${limitInputValue(p.oversLimit, 20)}" placeholder="No limit"></label>
      </div>
      <label>Players/side<input name="playersPerSide" type="number" min="2" max="11" value="${limitInputValue(p.playersPerSide, 11)}" placeholder="No limit"></label>
      <p class="hint">Leave overs or players blank for no limit.</p>
      <label class="check-row"><input type="checkbox" name="lastManStands" ${p.lastManStands ? "checked" : ""}> Last man stands (last batter bats alone)</label>
      <label class="check-row"><input type="checkbox" name="wideEnabled" ${!p.wide || p.wide.enabled ? "checked" : ""}> Wides count, worth <input name="wideRuns" type="number" min="0" max="6" value="${p.wide ? p.wide.runs : 1}" class="inline-num"></label>
      <label class="check-row"><input type="checkbox" name="noBallEnabled" ${!p.noBall || p.noBall.enabled ? "checked" : ""}> No-balls count, worth <input name="noBallRuns" type="number" min="0" max="6" value="${p.noBall ? p.noBall.runs : 1}" class="inline-num"></label>
      <label class="check-row"><input type="checkbox" name="freeHitOnNoBall" ${p.freeHitOnNoBall !== false ? "checked" : ""}> No-ball gives a free hit</label>
      <label class="check-row"><input type="checkbox" name="requireFielderOnCatch" ${p.requireFielderOnCatch ? "checked" : ""}> Require catch taker</label>
      <label class="check-row"><input type="checkbox" name="requireFielderOnRunout" ${p.requireFielderOnRunout ? "checked" : ""}> Require run-out taker</label>
      <div class="action-row">
        <button type="submit" class="primary">Save preset</button>
        <button type="button" data-action="${clubId ? "club-cancel-preset-edit" : "cancel-preset-edit"}" class="ghost">Cancel</button>
      </div>
    </form>
  `;
}

function renderTournamentPresetsTab(){
  const editing = ui.editingTournamentPreset;
  const builtInIds = new Set(DEFAULT_TOURNAMENT_PRESETS.map(p => p.id));
  return `
    <div class="preset-list">
      ${Object.values(state.tournamentPresets).map(p => tournamentPresetCardHtml(p, (state.matchPresets[p.matchPresetId] || {}).name || "—", builtInIds.has(p.id), "edit-tournament-preset", "delete-tournament-preset")).join("")}
    </div>
    ${editing ? renderTournamentPresetForm(editing) : `<button data-action="new-tournament-preset" class="link-btn">+ New tournament preset</button>`}
  `;
}

function renderTournamentPresetForm(p, clubId){
  return `
    <form id="${clubId ? "club-" : ""}tournament-preset-form" class="preset-form">
      <input type="hidden" name="id" value="${p.id || ""}">
      ${clubId ? `<div class="form-error"></div>` : ""}
      <label>Name<input name="name" required maxlength="30" value="${escapeHtml(p.name || "")}"></label>
      ${clubId
        ? `<input type="hidden" name="matchPresetId" value="">`
        : `<label>Match preset<select name="matchPresetId">${Object.values(state.matchPresets).map(mp => `<option value="${mp.id}" ${mp.id === p.matchPresetId ? "selected" : ""}>${escapeHtml(mp.name)}</option>`).join("")}</select></label>`}
      <div class="field-row">
        <label>Win pts<input name="pointsForWin" type="number" min="0" max="10" value="${p.pointsForWin ?? 2}" required></label>
        <label>Tie pts<input name="pointsForTie" type="number" min="0" max="10" value="${p.pointsForTie ?? 1}" required></label>
        <label>Loss pts<input name="pointsForLoss" type="number" min="0" max="10" value="${p.pointsForLoss ?? 0}" required></label>
      </div>
      <label class="check-row"><input type="checkbox" name="useNRR" ${p.useNRR !== false ? "checked" : ""}> Rank ties on NRR</label>
      <div class="action-row">
        <button type="submit" class="primary">Save preset</button>
        <button type="button" data-action="${clubId ? "club-cancel-preset-edit" : "cancel-preset-edit"}" class="ghost">Cancel</button>
      </div>
    </form>
  `;
}

function parseMatchPresetForm(f){
  return {
    id: f.get("id") || undefined,
    name: (f.get("name") || "").trim() || "Untitled preset",
    ballsPerOver: Math.max(1, parseInt(f.get("ballsPerOver"), 10) || 6),
    oversLimit: parseOptionalLimit(f.get("oversLimit"), 1),
    playersPerSide: parseOptionalLimit(f.get("playersPerSide"), 2),
    lastManStands: f.get("lastManStands") === "on",
    wide: { enabled: f.get("wideEnabled") === "on", runs: Math.max(0, parseInt(f.get("wideRuns"), 10) || 0) },
    noBall: { enabled: f.get("noBallEnabled") === "on", runs: Math.max(0, parseInt(f.get("noBallRuns"), 10) || 0) },
    freeHitOnNoBall: f.get("freeHitOnNoBall") === "on",
    requireFielderOnCatch: f.get("requireFielderOnCatch") === "on",
    requireFielderOnRunout: f.get("requireFielderOnRunout") === "on"
  };
}
function parseTournamentPresetForm(f){
  return {
    id: f.get("id") || undefined,
    name: (f.get("name") || "").trim() || "Untitled preset",
    matchPresetId: f.get("matchPresetId"),
    pointsForWin: Math.max(0, parseInt(f.get("pointsForWin"), 10) || 0),
    pointsForTie: Math.max(0, parseInt(f.get("pointsForTie"), 10) || 0),
    pointsForLoss: Math.max(0, parseInt(f.get("pointsForLoss"), 10) || 0),
    useNRR: f.get("useNRR") === "on"
  };
}

function handleMatchPresetSubmit(e){
  e.preventDefault();
  saveMatchPreset(parseMatchPresetForm(new FormData(e.target)));
  ui.editingMatchPreset = null;
  save(); render();
}

function handleTournamentPresetSubmit(e){
  e.preventDefault();
  saveTournamentPreset(parseTournamentPresetForm(new FormData(e.target)));
  ui.editingTournamentPreset = null;
  save(); render();
}

/* Club variants: same forms, but the preset goes to club_presets in the
   cloud for ui.currentClubId -- never into state.matchPresets/
   tournamentPresets (those are the guest's, on this device). */
function saveClubPresetFromForm(e, kind, preset, editingKey){
  e.preventDefault();
  const form = e.target;
  saveClubPreset(ui.currentClubId, kind, preset).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    ui[editingKey] = null;
    fetchClubDetail(ui.currentClubId).then(render);
  });
}
function handleClubMatchPresetSubmit(e){ saveClubPresetFromForm(e, "match", parseMatchPresetForm(new FormData(e.target)), "editingClubMatchPreset"); }
function handleClubTournamentPresetSubmit(e){ saveClubPresetFromForm(e, "tournament", parseTournamentPresetForm(new FormData(e.target)), "editingClubTournamentPreset"); }

/* --- tournament setup & dashboard --- */
function renderTournamentSetup(){
  const presets = Object.values(state.tournamentPresets);
  if (!ui.tournamentSetupPresetId){
    ui.tournamentSetupPresetId = presets.length ? presets[0].id : null;
  }
  const teams = Object.values(state.teams);
  return `
    <div class="screen setup">
      ${renderBackBar("Home", "home")}
      <h1>🏆 New tournament</h1>
      ${teams.length < 2 ? `<p class="hint">You need at least 2 saved teams. <button data-action="go-view" data-view="teams" class="link-btn">Add teams</button></p>` : ""}
      <form id="tournament-setup-form">
        <label>Tournament name<input name="name" required maxlength="40" placeholder="e.g. Sunday League 2026"></label>
        <input type="hidden" name="tournamentPresetId" value="${ui.tournamentSetupPresetId || ""}">
        ${presets.length ? `
          <div class="preset-picker">
            ${presets.map(p => `<button type="button" data-action="pick-tournament-preset" data-id="${p.id}" class="preset-chip ${p.id === ui.tournamentSetupPresetId ? "active" : ""}">${escapeHtml(p.name)}</button>`).join("")}
          </div>
        ` : ""}
        <fieldset>
          <legend>Teams in this tournament</legend>
          ${teams.map(t => `<label class="check-row"><input type="checkbox" name="teamIds" value="${t.id}" ${ui.tournamentSetupTeamIds.includes(t.id) ? "checked" : ""}> ${escapeHtml(t.name)}</label>`).join("") || `<p class="hint">No saved teams yet.</p>`}
        </fieldset>
        <button type="submit" class="primary" ${teams.length < 2 ? "disabled" : ""}>Create tournament</button>
      </form>
    </div>
  `;
}

function handleTournamentSetupSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const name = (f.get("name") || "").trim();
  const tournamentPresetId = f.get("tournamentPresetId") || ui.tournamentSetupPresetId;
  const teamIds = f.getAll("teamIds");
  if (!name || teamIds.length < 2 || !tournamentPresetId) return;
  const tournament = createTournament({ name, tournamentPresetId, teamIds });
  state.activeTournamentId = tournament.id;
  ui.tournamentSetupTeamIds = [];
  ui.tournamentSetupPresetId = null;
  state.view = "tournamentDashboard";
  ui.tournamentTab = "standings";
  save(); render();
}

function renderTournamentDashboard(){
  const t = activeTournament();
  if (!t) return renderHome();
  const preset = state.tournamentPresets[t.tournamentPresetId] || DEFAULT_TOURNAMENT_PRESETS[0];
  const matchPreset = state.matchPresets[preset.matchPresetId] || DEFAULT_MATCH_PRESETS[0];
  const matches = t.matchIds.map(id => state.matchHistory[id]).filter(Boolean);
  const standings = computeStandings(matches, preset);
  const tab = ui.tournamentTab || "standings";
  const teams = t.teamIds.map(id => state.teams[id]).filter(Boolean);

  return `
    <div class="screen tournament">
      ${renderBackBar("Home", "home")}
      <h1>🏆 ${escapeHtml(t.name)}</h1>
      <p class="tagline">${escapeHtml(matchPreset.name)} · ${preset.pointsForWin}/${preset.pointsForTie}/${preset.pointsForLoss} pts${preset.useNRR ? " · NRR" : ""}</p>
      <div class="tab-row">
        <button data-action="switch-tournament-tab" data-tab="standings" class="tab-btn ${tab === "standings" ? "active" : ""}">Standings</button>
        <button data-action="switch-tournament-tab" data-tab="fixtures" class="tab-btn ${tab === "fixtures" ? "active" : ""}">Fixtures</button>
        <button data-action="switch-tournament-tab" data-tab="stats" class="tab-btn ${tab === "stats" ? "active" : ""}">Stats</button>
      </div>
      ${tab === "standings" ? renderStandingsTable(standings, preset.useNRR) : ""}
      ${tab === "fixtures" ? renderTournamentFixtures(matches, teams) : ""}
      ${tab === "stats" ? renderTournamentStats(matches) : ""}
      ${tab !== "fixtures" && !state.match ? `<button data-action="switch-tournament-tab" data-tab="fixtures" class="primary">Start a fixture</button>` : ""}
    </div>
  `;
}

function renderStandingsTable(standings, useNRR){
  if (!standings.length) return `<p class="hint">No completed matches yet.</p>`;
  return `
    <div class="leaderboard">
      <h3>Points table</h3>
      <table class="standings-table">
        <thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th>${useNRR ? "<th>NRR</th>" : ""}</tr></thead>
        <tbody>${standings.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.played}</td><td>${s.won}</td><td>${s.lost}</td><td>${s.tied}</td><td><b>${s.points}</b></td>${useNRR ? `<td>${s.nrr >= 0 ? "+" : ""}${s.nrr.toFixed(3)}</td>` : ""}</tr>`).join("")}</tbody>
      </table>
      <p class="hint" style="margin-top:6px;">Forfeited matches count for points but are excluded from net run rate. An all-out innings counts its full overs quota.</p>
    </div>
  `;
}

function renderTournamentFixtures(matches, teams){
  const results = matches.map(m => `
    <div class="fixture-row">
      <span>${escapeHtml(teamName(m, "A"))} vs ${escapeHtml(teamName(m, "B"))}</span>
      <span class="fixture-result">${escapeHtml(m.result || "")}</span>
    </div>
  `).join("") || `<p class="hint">No matches played yet.</p>`;

  const startForm = state.match ? `<p class="hint">Finish the current match before starting another.</p>` : `
    <form id="tournament-start-match-form">
      <div class="form-error"></div>
      <label>Team A<select name="teamAId" required>${teams.map(tm => `<option value="${tm.id}">${escapeHtml(tm.name)}</option>`).join("")}</select></label>
      <label>Team B<select name="teamBId" required>${teams.map((tm, i) => `<option value="${tm.id}" ${i === 1 ? "selected" : ""}>${escapeHtml(tm.name)}</option>`).join("")}</select></label>
      <h3 class="section-label">Who bats first?</h3>
      <fieldset class="tile-fieldset">
        <legend>Who bats first?</legend>
        <label><input type="radio" name="battingFirst" value="A" checked> Team A</label>
        <label><input type="radio" name="battingFirst" value="B"> Team B</label>
      </fieldset>
      <button type="submit" class="primary" ${teams.length < 2 ? "disabled" : ""}>Start match</button>
    </form>
  `;

  return `<div class="fixtures">${results}</div><h3 class="section-label">Start a match</h3>${startForm}`;
}

function renderTournamentStats(matches){
  const totals = aggregatePlayerStats(matches);
  if (!totals.length) return `<p class="hint">No stats yet.</p>`;
  const mvp = totals[0];
  return `
    <div class="mvp-callout"><span class="mvp-label">Tournament MVP</span><span class="mvp-name">${escapeHtml(mvp.name)}</span><span class="mvp-points">${mvp.points} pts</span></div>
    ${renderLeaderboards(totals)}
  `;
}

function handleTournamentStartMatchSubmit(e){
  e.preventDefault();
  const t = activeTournament();
  if (!t) return;
  const f = new FormData(e.target);
  const teamAId = f.get("teamAId"), teamBId = f.get("teamBId");
  if (!teamAId || !teamBId || teamAId === teamBId){
    showFormError(e.target, "Pick two different teams."); return;
  }
  const preset = state.tournamentPresets[t.tournamentPresetId];
  const matchPreset = state.matchPresets[preset.matchPresetId] || DEFAULT_MATCH_PRESETS[0];
  const battingFirst = f.get("battingFirst") || "A";
  state.match = createMatch({
    teamA: state.teams[teamAId].name,
    teamB: state.teams[teamBId].name,
    oversLimit: matchPreset.oversLimit,
    playersPerSide: matchPreset.playersPerSide,
    ballsPerOver: matchPreset.ballsPerOver,
    wideEnabled: matchPreset.wide.enabled, wideRuns: matchPreset.wide.runs,
    noBallEnabled: matchPreset.noBall.enabled, noBallRuns: matchPreset.noBall.runs,
    freeHitOnNoBall: matchPreset.freeHitOnNoBall,
    lastManStands: matchPreset.lastManStands,
    requireFielderOnCatch: matchPreset.requireFielderOnCatch,
    requireFielderOnRunout: matchPreset.requireFielderOnRunout,
    battingFirst,
    presetId: matchPreset.id, presetName: matchPreset.name,
    tournamentId: t.id
  });
  state.match.squads = { A: guestTeamSquad(state.teams[teamAId], state.players), B: guestTeamSquad(state.teams[teamBId], state.players) };
  state.snapshots = [];
  save(); render();
}
