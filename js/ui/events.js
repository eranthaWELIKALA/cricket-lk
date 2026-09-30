/* Cricket.lk — delegated click/submit/input/change/keyboard listeners.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-action]");
  if (b) noteTrigger(b);
}, true);
document.addEventListener("submit", (e) => { noteTrigger(e.target); e.target.dataset.submitted = "1"; }, true);
// Editing a form again after a failed submit makes it a draft again (see captureFormDrafts).
["input", "change"].forEach(t => document.addEventListener(t, (e) => {
  const f = e.target.closest && e.target.closest("form");
  if (f) delete f.dataset.submitted;
}, true));
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  // Any nav item tapped inside the side menu closes it -- reuses whatever
  // action the item already dispatches (go-view, go-my-clubs, etc.)
  // rather than needing menu-specific action names.
  if (ui.sideMenuOpen && btn.closest(".side-menu") && action !== "close-side-menu"){
    ui.sideMenuOpen = false;
    // Leaving a match in progress for another view is UI-only (not persisted):
    // render() keeps showing the match until this is cleared, and a reload
    // drops straight back onto it.
    if (state.match && state.match.status !== "complete" && action !== "resume-match") ui.awayFromMatch = true;
  }
  if (action === "confirm-ok"){ runConfirm(); return; }
  if (action === "open-sync-sheet"){ ui.syncSheet = true; render(); return; }
  if (action === "close-sync-sheet"){ ui.syncSheet = false; render(); return; }
  if (action === "sync-now"){ retryFailedOps(myOps().filter(o => o.failed).map(o => o.id)); syncNow(); return; }
  if (action === "sync-retry"){ retryFailedOps([btn.dataset.id]); return; }
  if (action === "sync-discard"){
    const op = myOps().find(o => o.id === btn.dataset.id);
    if (!op) return;
    askConfirm({
      title: "Discard this change?", icon: "🗑",
      body: `<p><b>${escapeHtml(describeOp(op))}</b> will never reach the cloud. It's removed from this device's sync queue${op.kind === "match" ? " (the match stays in this device's history)" : ""}.</p>`,
      confirmLabel: "Discard",
      onConfirm: () => { discardOp(op.id); }
    });
    return;
  }
  if (action === "confirm-cancel"){ cancelConfirm(); return; }
  if (action === "confirm-pick"){ if (ui.confirm && !ui.confirm.busy){ ui.confirm.choice = btn.dataset.value; ui.confirm.error = null; render(); } return; }
  if ((action === "ball" || action === "toggle-extra" || action === "open-wicket") && reopenPick()) return;
  if (action === "ball") handleBallClick(parseInt(btn.dataset.runs, 10));
  else if (action === "dismiss-pick") dismissPick();
  else if (action === "reopen-pick") reopenPick();
  else if (action === "end-innings") handleEndInnings();
  else if (action === "toggle-extra"){ ui.pendingExtra = (ui.pendingExtra === btn.dataset.extra) ? null : btn.dataset.extra; render(); }
  else if (action === "open-wicket"){ ui.wicketFlow = "menu"; render(); }
  else if (action === "close-wicket-modal"){ ui.wicketFlow = null; ui.runoutRuns = 0; ui.runoutEnd = "striker"; render(); }
  else if (action === "pick-runout-end"){ ui.runoutEnd = btn.dataset.end; render(); }
  else if (action === "pick-bowler"){ confirmNewBowler(btn.dataset.name); }
  else if (action === "combo-pick"){
    const combo = btn.closest(".combo"), input = combo && combo.querySelector("input");
    if (input){
      input.value = btn.dataset.name;
      combo.querySelector(".combo-list").hidden = true;
      const form = btn.closest("form"); if (form) showFormError(form, "");
    }
  }  else if (action === "pick-wicket"){
    if (btn.dataset.type === "runout" || btn.dataset.type === "caught"){ ui.wicketFlow = btn.dataset.type; render(); }
    else confirmWicket(btn.dataset.type);
  }
  else if (action === "runout-runs"){ ui.runoutRuns = parseInt(btn.dataset.runs, 10); render(); }
  else if (action === "resume-match"){ ui.awayFromMatch = false; render(); }
  else if (action === "open-forfeit") askForfeit();
  else if (action === "open-match-menu"){ ui.matchMenu = "menu"; ui.squadError = null; render(); }
  else if (action === "match-menu-view"){ ui.matchMenu = btn.dataset.view; ui.squadError = null; render(); }
  else if (action === "close-match-menu"){ ui.matchMenu = null; ui.squadError = null; render(); }
  else if (action === "swap-toss") askSwapToss();
  else if (action === "ask-cancel-match") askCancelMatch();
  else if (action === "move-squad-player"){
    const err = moveSquadPlayer(state.match, btn.dataset.name);
    ui.squadError = err;
    if (!err) save();
    render();
  }
  else if (action === "undo") handleUndo();
  else if (action === "toggle-scorecard"){ ui.showFullScorecard = !ui.showFullScorecard; render(); }
  else if (action === "start-second-innings"){ pushSnapshot(); startSecondInnings(state.match); save(); render(); }
  else if (action === "share-image") shareScorecardImage(state.match);
  else if (action === "export-pdf") window.print();
  else if (action === "finish-match") leaveMatch();
  else if (action === "toggle-sound"){
    state.soundEnabled = !state.soundEnabled;
    save(); render();
    if (state.soundEnabled) SFX.tap();
  }
  else if (action === "go-view"){
    // goToView self-heals ui.club etc. -- "clubHome" can be reached via
    // back-bars without ever going through "open-club" first. The on-screen
    // back bar behaves like the phone's back: asks before dropping typed
    // input, and doesn't add the screen it leaves to the back stack.
    const view = btn.dataset.view;
    if (btn.classList.contains("back-bar")) leaveScreen(() => backBarTo(view));
    else goToView(view);
  }
  else if (action === "go-account"){ state.view = session ? "account" : "signIn"; render(); }
  else if (action === "sign-out"){ handleSignOut(); }
  else if (action === "go-admin-portal"){ location.href = "admin.html"; } // platform admins only; admin.html re-checks server-side
  else if (action === "go-premier"){ state.view = "premier"; render(); } // render() loads it
  else if (action === "open-side-menu"){ ui.sideMenuOpen = true; render(); }
  else if (action === "close-side-menu"){ ui.sideMenuOpen = false; render(); }
  else if (action === "pick-theme"){ state.themeId = btn.dataset.id; applyTheme(); save(); render(); }
  else if (action === "go-match-setup"){ ui.matchSetupPresetId = null; ui.clubMatchSetupType = null; state.view = "matchSetup"; render(); }
  else if (action === "go-my-clubs"){ state.view = "myClubs"; render(); } // render() loads it
  else if (action === "open-club"){
    ui.currentClubId = btn.dataset.id; ui.club = null; state.view = "clubHome"; render(); // render() loads it
  }
  else if (action === "open-player-profile"){
    openPlayerProfile(btn.dataset.scope, btn.dataset.id, btn.dataset.name);
    state.view = "playerProfile"; render(); // render() loads it (loadPlayerProfile)
  }
  else if (action === "clear-photo"){
    const field = btn.closest(".photo-field");
    const preview = field && field.querySelector(".photo-preview");
    if (!field) return;
    field.querySelector('input[name="photo"]').value = "";
    if (preview) preview.outerHTML = `<div class="avatar-badge photo-preview">${escapeHtml(field.dataset.initial || "?")}</div>`;
  }
  else if (action === "edit-player-profile"){ ui.playerModal = { kind: "edit" }; ui.profile.message = null; render(); }
  else if (action === "open-club-add-player"){ ui.playerModal = { kind: "add" }; ui.clubAddMessage = null; render(); }
  else if (action === "close-player-modal"){ ui.playerModal = null; render(); }
  else if (action === "add-existing-club-player"){
    const form = btn.closest("form");
    btn.disabled = true;
    addExistingPlayerToClub(ui.currentClubId, btn.dataset.id, btn.dataset.name).then(r => {
      if (r.error){ btn.disabled = false; if (form) showFormError(form, r.error); return; }
      ui.playerModal = null;
      ui.clubAddMessage = `${btn.dataset.name} added to the club from the platform.`;
      render();
      fetchClubDetail(ui.currentClubId).then(render);
    });
  }
  else if (action === "ask-remove-club-player") askRemoveClubPlayer(btn.dataset.id, btn.dataset.name);
  else if (action === "go-club-view"){
    ui.currentClubId = state.activeClubId; ui.editingClubMatchPreset = null; ui.editingClubTournamentPreset = null;
    state.view = btn.dataset.view; render();
  }
  else if (action === "go-club-match-setup"){
    // Reached from Home's quick-action cards -- ui.currentClubId here
    // always follows the switcher (state.activeClubId), not whatever
    // club page (if any) was last viewed.
    ui.currentClubId = state.activeClubId;
    ui.matchSetupPresetId = null; ui.clubMatchSetupType = btn.dataset.type; state.view = "matchSetup"; render();
  }
  else if (action === "go-club-tournament-setup"){
    ui.currentClubId = state.activeClubId;
    ui.clubTournamentSetupPresetId = null; ui.clubTournamentSetupName = null; state.view = "clubTournamentSetup"; render();
  }
  else if (action === "pick-club-tournament-preset"){
    // Keep whatever is in the name box -- the re-render would otherwise reset it to today's date.
    const nameInput = btn.form && btn.form.elements.namedItem("name");
    if (nameInput) ui.clubTournamentSetupName = nameInput.value;
    ui.clubTournamentSetupPresetId = btn.dataset.id; render();
  }
  else if (action === "open-club-tournament"){
    ui.currentTournamentId = btn.dataset.id; ui.clubTournament = null; ui.tournamentTeamEdit = null; ui.tournamentTeamError = null; state.view = "clubTournamentDashboard"; render(); // render() loads it
  }
  else if (action === "new-tournament-team" && ui.clubTournament){
    const n = ui.clubTournament.teams.length;
    ui.tournamentTeamEdit = teamEditState(null, n < 26 ? `Team ${String.fromCharCode(65 + n)}` : "", []);
    render();
  }
  else if (action === "edit-tournament-team" && ui.clubTournament){
    const team = ui.clubTournament.teams.find(t => t.id === btn.dataset.id);
    if (team){ ui.tournamentTeamEdit = teamEditState(team.id, team.name, team.players.map(p => p.id)); render(); }
  }
  else if (action === "cancel-tournament-team") closeTeamEdit();
  else if (action === "team-builder-toggle" && ui.tournamentTeamEdit){
    const edit = ui.tournamentTeamEdit, id = btn.dataset.id;
    edit.playerIds = edit.playerIds.includes(id) ? edit.playerIds.filter(x => x !== id) : [...edit.playerIds, id];
    edit.notice = null;
    render();
  }
  else if (action === "team-builder-add-free" && ui.tournamentTeamEdit){
    // Adds the free (not-on-another-team) rows the search currently shows.
    const form = btn.closest("form");
    const ids = [...form.querySelectorAll('.pick-row[data-free="1"]:not([hidden])')].map(el => el.dataset.id);
    const edit = ui.tournamentTeamEdit;
    edit.playerIds = [...edit.playerIds, ...ids.filter(id => !edit.playerIds.includes(id))];
    render();
  }
  else if (action === "quick-split-teams") quickSplitTeams();
  else if (action === "team-builder-guest" && ui.tournamentTeamEdit) addBuilderGuest();
  else if (action === "team-builder-new-player" && ui.tournamentTeamEdit) addBuilderClubPlayer();
  else if (action === "delete-tournament-team" && ui.clubTournament) askDeleteTournamentTeam(btn.dataset.id);
  else if (action === "go-club-tournament-match-setup"){
    ui.matchSetupPresetId = null; ui.clubMatchSetupType = "tournament"; state.view = "matchSetup"; render();
  }
  else if (action === "open-claim-form"){ ui.profile.claiming = true; ui.profile.merging = false; ui.profile.message = null; render(); }
  else if (action === "open-merge-form"){ ui.profile.merging = true; ui.profile.claiming = false; ui.profile.message = null; render(); }
  else if (action === "close-ownership-form"){ ui.profile.claiming = false; ui.profile.merging = false; render(); }
  else if (action === "approve-merge" || action === "reject-merge"){
    (action === "approve-merge" ? approveMergeRequest : rejectMergeRequest)(btn.dataset.id).then(result => {
      ui.claimMessage = result && result.error ? result.error : (action === "approve-merge" ? "Merged." : "Rejected.");
      fetchPremierData().then(render);
    });
  }
  else if (action === "approve-claim"){
    approveClaimRequest(btn.dataset.id).then(result => {
      ui.claimMessage = result && result.error ? result.error : "Approved.";
      fetchPremierData().then(render);
    });
  }
  else if (action === "reject-claim"){
    rejectClaimRequest(btn.dataset.id).then(result => {
      ui.claimMessage = result && result.error ? result.error : "Rejected.";
      fetchPremierData().then(render);
    });
  }
  else if (action === "go-tournament-setup"){ ui.tournamentSetupPresetId = null; ui.tournamentSetupTeamIds = []; state.view = "tournamentSetup"; render(); }
  else if (action === "pick-match-preset"){ ui.matchSetupPresetId = btn.dataset.id; render(); }
  else if (action === "pick-tournament-preset"){ ui.tournamentSetupPresetId = btn.dataset.id; render(); }
  else if (action === "open-tournament"){ state.activeTournamentId = btn.dataset.id; state.view = "tournamentDashboard"; ui.tournamentTab = "standings"; render(); }
  else if (action === "switch-tournament-tab"){ ui.tournamentTab = btn.dataset.tab; render(); }
  else if (action === "select-team"){ ui.selectedTeamId = btn.dataset.id; render(); }
  else if (action === "delete-team"){
    const id = btn.dataset.id, team = state.teams[id];
    askConfirm({
      title: `Delete ${team ? team.name : "this team"}?`, icon: "🗑",
      body: `<p>The team is removed from this device. Its players stay in your players list, and past match history is unaffected.</p>`,
      confirmLabel: "Delete team",
      onConfirm: () => { deleteTeam(id); if (ui.selectedTeamId === id) ui.selectedTeamId = null; save(); }
    });
  }
  else if (action === "remove-player"){ removePlayerFromTeam(btn.dataset.team, btn.dataset.player); save(); render(); }
  else if (action === "delete-player"){
    const id = btn.dataset.id, pl = state.players[id];
    askConfirm({
      title: `Delete ${pl ? pl.name : "this player"}?`, icon: "🗑",
      body: `<p>They're removed from every team on this device. Past match history is unaffected.</p>`,
      confirmLabel: "Delete player",
      onConfirm: () => { deletePlayer(id); save(); }
    });
  }
  else if (action === "move-player"){
    const row = btn.closest(".roster-row");
    const toId = row.querySelector('[data-role="move-target"]').value;
    movePlayerToTeam(btn.dataset.player, btn.dataset.from, toId);
    save(); render();
  }
  else if (action === "switch-presets-tab"){ ui.presetsTab = btn.dataset.tab; ui.editingMatchPreset = null; ui.editingTournamentPreset = null; render(); }
  else if (action === "new-match-preset"){ ui.editingMatchPreset = {}; render(); }
  else if (action === "edit-match-preset"){ ui.editingMatchPreset = Object.assign({}, state.matchPresets[btn.dataset.id]); render(); }
  else if (action === "delete-match-preset"){
    const id = btn.dataset.id, pr = state.matchPresets[id];
    askConfirm({
      title: pr ? `Delete the ${pr.name} preset?` : "Delete this preset?", icon: "🗑",
      body: `<p>Matches already played keep their conditions. Tournament presets that use it will need a new match preset.</p>`,
      confirmLabel: "Delete preset",
      onConfirm: () => { deleteMatchPreset(id); save(); }
    });
  }
  else if (action === "new-tournament-preset"){ ui.editingTournamentPreset = {}; render(); }
  else if (action === "edit-tournament-preset"){ ui.editingTournamentPreset = Object.assign({}, state.tournamentPresets[btn.dataset.id]); render(); }
  else if (action === "delete-tournament-preset"){
    const id = btn.dataset.id, pr = state.tournamentPresets[id];
    askConfirm({
      title: pr ? `Delete the ${pr.name} preset?` : "Delete this preset?", icon: "🗑",
      body: `<p>Existing tournaments keep their settings.</p>`,
      confirmLabel: "Delete preset",
      onConfirm: () => { deleteTournamentPreset(id); save(); }
    });
  }
  else if (action === "cancel-preset-edit"){ ui.editingMatchPreset = null; ui.editingTournamentPreset = null; render(); }
  else if (action === "club-new-match-preset"){ ui.editingClubMatchPreset = {}; render(); }
  else if (action === "club-edit-match-preset"){ ui.editingClubMatchPreset = Object.assign({}, clubPresetList("match", ui.currentClubId).find(p => p.id === btn.dataset.id)); render(); }
  else if (action === "club-delete-match-preset" || action === "club-delete-tournament-preset"){
    const clubId = ui.currentClubId, id = btn.dataset.id;
    const pr = clubPresetList(action === "club-delete-match-preset" ? "match" : "tournament", clubId).find(p => p.id === id);
    askConfirm({
      title: pr ? `Delete the ${pr.name} preset?` : "Delete this preset?", icon: "🗑",
      body: `<p>It's removed for everyone in ${escapeHtml(currentClubName() || "this club")}. Matches already played keep their conditions.</p>`,
      confirmLabel: "Delete preset", busyLabel: "Deleting…",
      onConfirm: () => deleteClubPreset(clubId, id).then(r => {
        if (r && r.error) return r;
        fetchClubDetail(clubId).then(render);
      })
    });
  }
  else if (action === "club-new-tournament-preset"){ ui.editingClubTournamentPreset = {}; render(); }
  else if (action === "club-edit-tournament-preset"){ ui.editingClubTournamentPreset = Object.assign({}, clubPresetList("tournament", ui.currentClubId).find(p => p.id === btn.dataset.id)); render(); }
  else if (action === "club-cancel-preset-edit"){ ui.editingClubMatchPreset = null; ui.editingClubTournamentPreset = null; render(); }
});

document.addEventListener("submit", (e) => {
  // getAttribute, not .id: the preset forms contain a hidden <input name="id">,
  // which shadows the form's own `id` property (form.id would be that input),
  // so the dispatch below never matched and the browser did a native GET
  // submit -- reloading the page and saving nothing.
  const id = e.target.getAttribute("id");
  if (id === "match-setup-form") handleMatchSetupSubmit(e);
  else if (id === "opening-form") handleOpeningSubmit(e);
  else if (id === "squad-add-form") handleSquadAddSubmit(e);
  else if (id === "new-batsman-form") handleNewBatsmanSubmit(e);
  else if (id === "new-bowler-form") handleNewBowlerSubmit(e);
  else if (id === "wicket-fielder-form") handleWicketFielderSubmit(e);
  else if (id === "motm-form") handleMotmSubmit(e);
  else if (id === "tournament-setup-form") handleTournamentSetupSubmit(e);
  else if (id === "tournament-start-match-form") handleTournamentStartMatchSubmit(e);
  else if (id === "new-team-form") handleNewTeamSubmit(e);
  else if (id === "add-player-form") handleAddPlayerSubmit(e);
  else if (id === "add-global-player-form") handleAddGlobalPlayerSubmit(e);
  else if (id === "match-preset-form") handleMatchPresetSubmit(e);
  else if (id === "tournament-preset-form") handleTournamentPresetSubmit(e);
  else if (id === "club-match-preset-form") handleClubMatchPresetSubmit(e);
  else if (id === "player-profile-form") handlePlayerProfileSubmit(e);
  else if (id === "club-tournament-preset-form") handleClubTournamentPresetSubmit(e);
  else if (id === "sign-in-form") handleSignInSubmit(e);
  else if (id === "sign-up-form") handleSignUpSubmit(e);
  else if (id === "create-club-form") handleCreateClubSubmit(e);
  else if (id === "club-add-player-form") handleClubAddPlayerSubmit(e);
  else if (id === "club-invite-admin-form") handleClubInviteAdminSubmit(e);
  else if (id === "club-tournament-setup-form") handleClubTournamentSetupSubmit(e);
  else if (id === "tournament-team-form") handleTournamentTeamSubmit(e);
  else if (id === "claim-request-form") handleClaimRequestSubmit(e);
  else if (id === "merge-request-form") handleMergeRequestSubmit(e);
});

/* The only delegated `input` listener: live "already on the platform"
   suggestions for the club add-player sheet's name field. Debounced, needs
   2+ characters, and drops stale responses (suggestSeq) so a slow early
   query can't overwrite a newer one. */
let suggestTimer = null, suggestSeq = 0;
// Search-select open/close. pointerdown on an option is cancelled so the
// input keeps focus (no focusout) and the tap lands as a plain click; the
// focusout close is delayed as a backstop for browsers that move focus anyway.
document.addEventListener("focusin", (e) => {
  if (e.target.matches && e.target.matches(".combo input")) updateCombo(e.target, true);
});
document.addEventListener("focusout", (e) => {
  if (!(e.target.matches && e.target.matches(".combo input"))) return;
  const combo = e.target.closest(".combo");
  setTimeout(() => {
    if (!combo.isConnected || combo.contains(document.activeElement)) return;
    combo.querySelector(".combo-list").hidden = true;
  }, 200);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("team-builder-search")) e.preventDefault();
  if (e.key === "Escape"){
    if (ui.confirm) cancelConfirm();
    else if (ui.tournamentTeamEdit && document.querySelector(".team-modal")) closeTeamEdit();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest && e.target.closest(".combo-opt")) e.preventDefault();
});
document.addEventListener("input", (e) => {
  // Search-select (renderNameCombo): narrow the list as you type.
  if (e.target.closest && e.target.closest(".combo")){ updateCombo(e.target, true); return; }
  // Team builder: keep the name in ui, and filter roster rows without a re-render.
  const builder = e.target.closest && e.target.closest("#tournament-team-form");
  if (builder && ui.tournamentTeamEdit){
    if (e.target.name === "teamName"){
      ui.tournamentTeamEdit.name = e.target.value;
      const badge = builder.querySelector(".team-badge"); if (badge) badge.textContent = nameInitials(e.target.value || "?");
    } else if (e.target.name === "teamSearch"){
      ui.tournamentTeamEdit.search = e.target.value;
      const q = e.target.value.trim().toLowerCase();
      let shown = 0, free = 0;
      builder.querySelectorAll(".pick-row").forEach(row => {
        row.hidden = !!q && !row.dataset.label.includes(q);
        if (!row.hidden){ shown++; if (row.dataset.free === "1") free++; }
      });
      const none = builder.querySelector(".no-results"); if (none) none.hidden = shown > 0;
      const addFree = builder.querySelector('[data-action="team-builder-add-free"]');
      if (addFree){ addFree.disabled = !free; addFree.textContent = `+ All free${free ? ` (${free})` : ""}`; }
      const card = builder.querySelector(".builder-add");
      if (card){
        const typed = e.target.value.trim();
        card.querySelector(".builder-add-title").innerHTML = typed ? `Add “<span class="q">${escapeHtml(typed)}</span>”` : `Someone new? <span class="muted">Type their name in the search box.</span>`;
        card.querySelectorAll(".builder-add-actions button").forEach(b => { b.disabled = !typed || !!ui.tournamentTeamEdit.adding; });
      }
    }
    return;
  }
  // Match setup: "Who bats first?" tiles follow the typed team names.
  if (e.target.closest && e.target.closest("#match-setup-form") && (e.target.name === "teamA" || e.target.name === "teamB")){
    const key = e.target.name === "teamA" ? "A" : "B";
    const lbl = document.querySelector(`#match-setup-form [data-bat-label="${key}"]`);
    if (lbl) lbl.textContent = e.target.value.trim() || `Team ${key}`;
    return;
  }
  const form = e.target.closest && e.target.closest("#club-add-player-form");
  if (!form || e.target.name !== "name" || !supabaseClient) return;
  const box = form.querySelector(".platform-suggest");
  const query = e.target.value;
  clearTimeout(suggestTimer);
  if (query.trim().length < 2){ suggestSeq++; box.hidden = true; box.innerHTML = ""; return; }
  suggestTimer = setTimeout(() => {
    const seq = ++suggestSeq;
    searchPlatformPlayers(query).then(players => {
      if (seq !== suggestSeq || !box.isConnected) return;
      box.innerHTML = platformSuggestHtml(query, players);
      box.hidden = !players.length;
    });
  }, 250);
});

document.addEventListener("change", (e) => {
  // Mirror the tournament-team form into ui so a background re-render (e.g.
  // the roster finishing loading) doesn't drop half-made picks.
  if (e.target.closest && e.target.closest("#tournament-team-form") && ui.tournamentTeamEdit){
    if (e.target.name === "teamName") ui.tournamentTeamEdit.name = e.target.value;
    return;
  }
  if ((e.target.name === "teamAId" || e.target.name === "teamBId") && e.target.closest("#match-setup-form")){
    // Picking the team the other side has swaps the two sides, so the pair
    // can never be one team twice (and two teams can still be flipped).
    const form = e.target.closest("form");
    const col = e.target.closest(".team-pick-col");
    const otherSide = col.dataset.side === "A" ? "B" : "A";
    const otherCol = form.querySelector(`.team-pick-col[data-side="${otherSide}"]`);
    const otherChecked = otherCol.querySelector("input:checked");
    if (otherChecked && otherChecked.value === e.target.value){
      const back = otherCol.querySelector(`input[value="${col.dataset.current}"]`);
      if (back){ back.checked = true; otherCol.dataset.current = back.value; }
    }
    col.dataset.current = e.target.value;
    ["A", "B"].forEach(k => {
      const r = form.querySelector(`input[name="team${k}Id"]:checked`);
      const lbl = form.querySelector(`[data-bat-label="${k}"]`);
      if (r && lbl) lbl.textContent = r.closest("label").querySelector("b").textContent;
    });
    return;
  }
  if (e.target.name === "teamIds"){
    const id = e.target.value;
    if (e.target.checked){ if (!ui.tournamentSetupTeamIds.includes(id)) ui.tournamentSetupTeamIds.push(id); }
    else { ui.tournamentSetupTeamIds = ui.tournamentSetupTeamIds.filter(x => x !== id); }
  }
  else if (e.target.classList.contains("photo-file-input")){
    // DOM-only update (no re-render) so anything already typed in the form survives.
    const file = e.target.files && e.target.files[0];
    const field = e.target.closest(".photo-field");
    if (!file || !field) return;
    const form = field.closest("form");
    resizeImageToDataUrl(file).then(dataUrl => {
      field.querySelector('input[name="photo"]').value = dataUrl;
      const preview = field.querySelector(".photo-preview");
      if (preview) preview.outerHTML = `<img class="profile-photo photo-preview" src="${dataUrl}" alt="">`;
      showFormError(form, "");
    }).catch(err => showFormError(form, err.message));
  }
  else if (e.target.id === "home-club-switcher"){
    const v = e.target.value;
    if (v === "__premier__"){
      state.view = "premier"; save(); render();
      fetchPremierData().then(render);
    } else { state.activeClubId = v || null; save(); render(); }
  }
});
