/* Cricket.lk — render(): picks the screen and layers sheets.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- render loop & boot --- */
function render(){
  const root = document.getElementById("app");
  const m = state.match;
  // Home's club switcher needs ui.myClubs; fetch it once, lazily, rather
  // than on every screen -- guarded so a pending fetch never re-fires.
  if (!m && (state.view === "home" || state.view === "myClubs") && session && ui.myClubs === null && !ui.myClubsLoading){
    ui.myClubsLoading = true;
    fetchMyClubs().then(() => { ui.myClubsLoading = false; render(); });
  }
  // ui isn't persisted, so a saved profile view has nothing to show after a
  // reload (a profile *URL* reopens it -- see applyRoute).
  if (state.view === "playerProfile" && !ui.profile) state.view = "home";
  // Both wait for the cloud client (it isn't there yet on the first render
  // after a reload) -- unless cloud isn't configured at all.
  const cloudReady = !!supabaseClient || !SUPABASE_URL;
  if (state.view === "playerProfile" && ui.profile.pending && cloudReady) loadPlayerProfile();
  // Premier screens and profiles (both tiers) need ui.premier; load it once.
  if ((state.view.startsWith("premier") || state.view === "playerProfile") && cloudReady && !ui.premier && !ui.premierLoading){
    ui.premierLoading = true;
    fetchPremierData().then(() => { ui.premierLoading = false; render(); });
  }
  // A persisted club view after a reload has no ui.currentClubId /
  // currentTournamentId (ui isn't saved): take them from state.viewClubId /
  // viewTournamentId, and if there's still nothing to show, fall back to a
  // screen that can render instead of an endless spinner.
  const CLUB_VIEWS = ["clubHome", "clubPlayers", "clubPresets", "clubStats", "clubTournamentSetup", "clubTournamentDashboard"];
  if (!m && CLUB_VIEWS.includes(state.view)){
    if (!ui.currentClubId) ui.currentClubId = state.viewClubId || (state.view !== "clubHome" ? state.activeClubId : null);
    if (state.view === "clubTournamentDashboard" && !ui.currentTournamentId) ui.currentTournamentId = state.viewTournamentId;
    if (state.view === "clubTournamentDashboard" && !ui.currentTournamentId) state.view = ui.currentClubId ? "clubHome" : "myClubs";
    else if (!ui.currentClubId) state.view = state.view === "clubHome" ? "myClubs" : "home";
  }
  if (CLUB_VIEWS.includes(state.view) && (state.viewClubId !== ui.currentClubId || state.viewTournamentId !== ui.currentTournamentId)){
    state.viewClubId = ui.currentClubId || null; state.viewTournamentId = ui.currentTournamentId || null;
    save();
  }
  // Club data (roster, matches, presets) is loaded once per club the screen
  // in front of you needs: a club match, Home while acting as a club, or a
  // club setup screen. ui.clubRosterLoading marks the one fetch in flight (so
  // a re-render never fires a second) and is cleared when it lands, so a club
  // whose data was dropped (ui.club = null) is loaded again.
  const wantClubId = m && m.clubId ? m.clubId
    : (!m && state.view === "home" && state.activeClubId && (ui.myClubs || []).some(c => c.id === state.activeClubId)) ? state.activeClubId
    : (!m && (state.view === "matchSetup" || state.view === "clubTournamentSetup") && ui.currentClubId && (state.view !== "matchSetup" || ui.clubMatchSetupType)) ? ui.currentClubId
    : (!m && ["clubHome", "clubPlayers", "clubPresets", "clubStats", "clubTournamentDashboard"].includes(state.view) && ui.currentClubId) ? ui.currentClubId
    : null;
  if (wantClubId && supabaseClient && session && (!ui.club || ui.club.id !== wantClubId) && ui.clubRosterLoading !== wantClubId){
    ui.clubRosterLoading = wantClubId;
    fetchClubDetail(wantClubId).then(() => {
      if (ui.clubRosterLoading === wantClubId) ui.clubRosterLoading = null;
      render();
    });
  }
  // Same for a club tournament's dashboard (reached after a reload or by back,
  // not through open-club-tournament). A tournament that can't be found (or
  // isn't cached while offline) goes back to the club rather than spinning.
  const wantTournamentId = !m && (state.view === "clubTournamentDashboard" || (state.view === "matchSetup" && ui.clubMatchSetupType === "tournament")) ? ui.currentTournamentId : null;
  if (wantTournamentId && supabaseClient && session && (!ui.clubTournament || ui.clubTournament.id !== wantTournamentId) && ui.clubTournamentLoading !== wantTournamentId){
    ui.clubTournamentLoading = wantTournamentId;
    fetchClubTournamentDetail(wantTournamentId).then(() => {
      if (ui.clubTournamentLoading === wantTournamentId) ui.clubTournamentLoading = null;
      if (!ui.clubTournament && state.view === "clubTournamentDashboard" && ui.currentTournamentId === wantTournamentId){
        state.view = "clubHome"; ui.currentTournamentId = null; save();
      }
      render();
    });
  }
  let html;
  const inProgress = !!(m && m.status !== "complete");
  const away = inProgress && ui.awayFromMatch;
  if (inProgress && !away){
    html = m.status === "innings_break" ? renderInningsBreak(m) : renderLive(m);
  } else if (m && m.status === "complete"){
    html = renderResult(m);
  } else if (state.view === "teams"){
    html = renderTeamsScreen();
  } else if (state.view === "players"){
    html = renderPlayersScreen();
  } else if (state.view === "presets"){
    html = renderPresetsScreen();
  } else if (state.view === "matchSetup"){
    html = renderMatchSetup();
  } else if (state.view === "tournamentSetup"){
    html = renderTournamentSetup();
  } else if (state.view === "tournamentDashboard"){
    html = renderTournamentDashboard();
  } else if (state.view === "stats"){
    html = renderStatsScreen();
  } else if (state.view === "signIn"){
    html = renderSignIn();
  } else if (state.view === "signUp"){
    html = renderSignUp();
  } else if (state.view === "account"){
    html = renderAccount();
  } else if (state.view === "myClubs"){
    html = renderMyClubs();
  } else if (state.view === "clubHome"){
    html = renderClubHome();
  } else if (state.view === "clubTournamentSetup"){
    html = renderClubTournamentSetup();
  } else if (state.view === "clubTournamentDashboard"){
    html = renderClubTournamentDashboard();
  } else if (state.view === "premier"){
    html = renderPremierScreen();
  } else if (["premierPlayers", "premierTeams", "premierStats"].includes(state.view) && !ui.premier){
    html = `<div class="screen">${renderBackBar("Premier", "premier")}${loadingHtml()}</div>`;
  } else if (state.view === "premierPlayers"){
    html = renderPremierPlayers();
  } else if (state.view === "premierTeams"){
    html = renderPremierTeams();
  } else if (state.view === "premierStats"){
    html = renderPremierStats();
  } else if (state.view === "settings"){
    html = renderSettingsScreen();
  } else if (state.view === "playerProfile"){
    html = renderPlayerProfile();
  } else if (state.view === "clubPlayers"){
    html = renderClubPlayers();
  } else if (state.view === "clubPresets"){
    html = renderClubPresets();
  } else if (state.view === "clubStats"){
    html = renderClubStats();
  } else {
    html = renderHome();
  }
  const canNavigate = !m || inProgress;
  // Hidden on the auth screens themselves -- showing a "Sign in" CTA
  // while already on the sign-in form (or signed-out on Account, which
  // renders the same form) is redundant clutter, not a shortcut to anywhere.
  const onAuthScreen = state.view === "signIn" || state.view === "signUp" || state.view === "account";
  root.classList.toggle("live-mode", !!(inProgress && !away && m.status !== "innings_break"));
  // Loading indicators are off while a match is on screen (see "activity").
  document.body.classList.toggle("live-scoring", !!(inProgress && !away));
  const appDrafts = captureFormDrafts(root);
  // Same screen re-rendered (a tap, a sheet opening, a ball scored): skip the
  // screen's settle animation, and only pulse the score when it changed --
  // replaying them on every render is what made taps flicker.
  const screenKey = navKey() + (m ? ":" + m.status : "");
  const sameScreen = root.dataset.screenKey === screenKey;
  const prevScore = sameScreen ? (root.querySelector(".score-n") || {}).textContent : null;
  const prevChips = sameScreen ? new Set([...root.querySelectorAll("[data-chip]")].map(c => c.dataset.chip)) : null;
  syncRoute();
  root.innerHTML = renderTopBar(canNavigate, onAuthScreen) + html + renderPlayersDatalist() + renderTeamsDatalist()
    + (canNavigate ? renderSideMenu() : "");
  root.dataset.screenKey = screenKey;
  if (sameScreen){
    const scr = root.querySelector(".screen");
    if (scr) scr.classList.add("no-anim");
    const score = root.querySelector(".score-n");
    if (score && score.textContent === prevScore) root.querySelector(".score-tile").classList.add("no-anim");
    root.querySelectorAll("[data-chip]").forEach(c => { if (prevChips.has(c.dataset.chip)) c.classList.add("no-anim"); });
  }
  restoreFormDrafts(root, appDrafts);

  const modalRoot = document.getElementById("modal-root");
  let modalHtml = "";
  // Player modals (club Players / profile) only exist off the live screen.
  // modalKey lets an already-open one survive re-renders untouched.
  let modalKey = "";
  const pm = ui.playerModal;
  const pmValid = pm && (!inProgress || away) && (
    (pm.kind === "add" && state.view === "clubPlayers") ||
    (pm.kind === "edit" && state.view === "playerProfile" && ui.profile && ui.profile.data && ui.profile.data.can_see_contact));
  if (pm && !pmValid) ui.playerModal = null;
  const teamEditOpen = ui.tournamentTeamEdit && state.view === "clubTournamentDashboard" && ui.clubTournament && !ui.clubTournament.teams_unavailable && (!inProgress || away);
  // The shared confirmation sheet has its own layer above everything (see
  // askConfirm), so the sheet under it stays in the DOM -- typed input and
  // all -- while it asks.
  if (ui.syncSheet && session){
    modalHtml = renderSyncSheet();
  } else if (pmValid){
    modalKey = pm.kind;
    modalHtml = pm.kind === "add" ? renderClubAddPlayerModal() : renderPlayerEditModal();
  } else if (teamEditOpen){
    modalHtml = renderTournamentTeamModal();
  } else if (away){
    modalHtml = "";
  } else if (m && m.status !== "complete" && ui.matchMenu){
    modalHtml = renderMatchMenuModal(m);
  } else if (m && m.status === "opening"){
    modalHtml = renderOpeningModal(m);
  } else if (m && m.status === "live"){
    const inn = currentInnings(m);
    const slot = pendingBatsmanSlot(inn);
    const later = pickSheetDismissed(m);
    if (slot){ if (!later) modalHtml = renderNewBatsmanModal(inn, slot); }
    else if (!inn.bowler){ if (!later) modalHtml = renderNewBowlerModal(inn); }
    else if (ui.wicketFlow) modalHtml = renderWicketModal(inn);
  }
  if (!(modalKey && modalRoot.dataset.modalKey === modalKey)){
    // Re-rendering the same sheet (a tap inside it) keeps its scroll position
    // and skips the slide-up animation -- see data-keep-scroll.
    const prev = modalRoot.querySelector("[data-keep-scroll]");
    const keep = prev ? { key: prev.dataset.keepScroll, top: prev.scrollTop } : null;
    const hadBackdrop = !!modalRoot.querySelector(".modal-backdrop");
    const modalDrafts = captureFormDrafts(modalRoot);
    modalRoot.innerHTML = modalHtml;
    // Sheet -> sheet (e.g. wicket -> new batsman): the scrim is already up.
    const backdrop = hadBackdrop && modalRoot.querySelector(".modal-backdrop");
    if (backdrop) backdrop.classList.add("no-anim");
    modalRoot.dataset.modalKey = modalKey;
    restoreFormDrafts(modalRoot, modalDrafts);
    const again = keep && modalRoot.querySelector(`[data-keep-scroll="${keep.key}"]`);
    if (again){ again.classList.add("no-anim"); again.scrollTop = keep.top; }
    if (modalKey === "add"){ const first = modalRoot.querySelector('input[name="name"]'); if (first) first.focus(); }
  }
  const confirmRoot = document.getElementById("confirm-root");
  const prevConfirm = confirmRoot.querySelector("[data-keep-scroll]");
  const confirmTop = prevConfirm ? prevConfirm.scrollTop : null;
  confirmRoot.innerHTML = ui.confirm ? renderConfirmModal() : "";
  const againConfirm = confirmTop != null && confirmRoot.querySelector("[data-keep-scroll]");
  if (againConfirm){
    againConfirm.classList.add("no-anim"); againConfirm.scrollTop = confirmTop;
    againConfirm.closest(".modal-backdrop").classList.add("no-anim");
  }
  // The DOM was just replaced: put the tapped button's spinner back.
  if (activity.shown || document.querySelector(".is-loading")) applyActivity();
}
