/* Cricket.lk — page navigation: URL routes, history, back-button interception.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- Page navigation: URL routes + the browser's own history.
   Every screen has a hash route (ROUTES below: #/clubs/<id>, #/premier/
   players/<id>, #/live, ...), so back, forward, reload and a pasted link all
   go through real browser history. Existing code doesn't change: it still sets
   state.view (plus ui.currentClubId etc.) and calls render(); syncRoute() at
   the end of render() turns that into a history entry. popstate goes the
   other way: applyRoute() sets the state for the URL, then render().
   A back/forward move is undone (history.go) and handled in place only when
   it shouldn't just change screen -- a sheet is open, a form has unsaved
   input, or it would leave live scoring. See interceptNav().
   Chrome skips history entries that were added without a user gesture, so an
   entry is only *pushed* while the user is interacting
   (navigator.userActivation); redirects and async results *replace* the
   current one, and nothing is ever pushed from inside popstate. Opened
   straight onto a screen (reload, relaunch), the first tap slips a Home entry
   underneath (ensureNavBase), so back lands on Home instead of closing the
   app -- which matters most mid-match.
   Sheets and menus opened by a tap get their own entry too (same URL,
   `overlay: true`), so back closes them even on the first entry, where there
   is nothing before to go back to; closing one by tap quietly pops its entry
   again (see syncRoute), so the next back isn't a dead press. */
const ROUTES = [
  ["/", "home"], ["/teams", "teams"], ["/players", "players"], ["/presets", "presets"],
  ["/stats", "stats"], ["/settings", "settings"],
  ["/new-match", "matchSetup"], ["/tournaments/new", "tournamentSetup"], ["/tournaments/:t", "tournamentDashboard"],
  ["/sign-in", "signIn"], ["/sign-up", "signUp"], ["/account", "account"],
  ["/clubs", "myClubs"], ["/clubs/:c", "clubHome"],
  ["/clubs/:c/players", "clubPlayers"], ["/clubs/:c/players/:p", "playerProfile", { scope: "club" }],
  ["/clubs/:c/presets", "clubPresets"], ["/clubs/:c/stats", "clubStats"],
  ["/clubs/:c/new-match/:type", "matchSetup"],
  ["/clubs/:c/tournaments/new", "clubTournamentSetup"], ["/clubs/:c/tournaments/:ct", "clubTournamentDashboard"],
  ["/clubs/:c/tournaments/:ct/new-match", "matchSetup", { type: "tournament" }],
  ["/premier", "premier"], ["/premier/players", "premierPlayers"], ["/premier/players/:p", "playerProfile", { scope: "premier" }],
  ["/premier/teams", "premierTeams"], ["/premier/stats", "premierStats"],
  ["/live", "match"], ["/result", "result"]
];
// Screens you never go back to: setup forms (consumed by starting the match /
// tournament) and Result (its match is gone once you leave).
const NAV_TRANSIENT = new Set(["matchSetup", "tournamentSetup", "clubTournamentSetup", "result"]);
let navIdx = 0;              // our position in history (history.state.idx)
let navRoutes = ["/"];       // the route at each idx this page has seen
let navSettling = 0;         // history.go() moves we started that haven't landed
let navBypass = false;       // next popstate: apply it, no interception
let navReplaceNext = false;  // next syncRoute replaces instead of pushing
let navApplying = false;     // handling a back/forward press: replace, never push
let navBaseReady = false;
let navOnOverlay = false;    // the current entry is a sheet's entry
let navHold = false;         // an intercepted move is being undone: URL is off, leave history alone

function navKey(){
  const m = state.match;
  if (m && m.status === "complete") return "result";
  if (m && !ui.awayFromMatch) return "match";
  return state.view || "home";
}
function parseRoute(path){
  const segs = (path || "/").replace(/^#/, "").split("?")[0].split("/").filter(Boolean);
  for (const [pattern, view, extra] of ROUTES){
    const ps = pattern.split("/").filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params = Object.assign({}, extra);
    if (ps.every((p, i) => p.startsWith(":") ? (params[p.slice(1)] = decodeURIComponent(segs[i]), true) : p === segs[i])) return { view, params };
  }
  return { view: "home", params: {} };
}
function buildRoute(view, params){
  const fits = ROUTES.filter(([pattern, v, extra]) => v === view
    && pattern.split("/").every(p => !p.startsWith(":") || params[p.slice(1)])
    && Object.keys(extra || {}).every(k => params[k] === extra[k]));
  // Most specific first: the pattern that uses the most of what we know.
  fits.sort((a, b) => b[0].split(":").length - a[0].split(":").length);
  return fits.length ? fits[0][0].replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k])) : "/";
}
// The route for what's on screen right now.
function routeFor(){
  const key = navKey();
  if (key === "match") return "/live";
  if (key === "result") return "/result";
  const pr = ui.profile;
  return buildRoute(key, {
    c: ui.currentClubId, ct: ui.currentTournamentId, t: state.activeTournamentId,
    p: key === "playerProfile" && pr ? pr.id : null,
    scope: key === "playerProfile" && pr ? (pr.scope === "club" && ui.currentClubId ? "club" : "premier") : null,
    type: key === "matchSetup" && ui.currentClubId ? ui.clubMatchSetupType : null
  });
}
function currentRoute(){ return (location.hash || "#/").slice(1) || "/"; }
function hasUserActivation(){
  return navigator.userActivation ? navigator.userActivation.isActive : true;
}

// Sheets/menus that back should close (the auto-opened pick sheets aren't
// here: they're handled by interceptNav's live-match step).
function overlayOpen(){
  const m = state.match;
  const onMatch = !!(m && m.status !== "complete" && !ui.awayFromMatch);
  return !!(ui.confirm || ui.sideMenuOpen || (ui.syncSheet && session) || ui.playerModal
    || (ui.tournamentTeamEdit && state.view === "clubTournamentDashboard")
    || (onMatch && (ui.matchMenu || ui.wicketFlow)));
}
// Called at the end of render(): record a screen change in browser history.
function syncRoute(){
  // Mid-undo (or while our own history.back()/go() is landing) the URL isn't
  // this screen's yet -- writing it now would overwrite the wrong entry.
  if (navHold || navSettling > 0) return;
  const route = routeFor(), cur = currentRoute();
  if (route !== cur){
    const leaving = parseRoute(cur).view;
    const replace = navApplying || navReplaceNext || navOnOverlay || !hasUserActivation() || NAV_TRANSIENT.has(leaving)
      || (leaving === "match" && route === "/result") || ((leaving === "signIn" || leaving === "signUp") && session);
    if (replace){
      history.replaceState({ idx: navIdx }, "", "#" + route);
    } else {
      navIdx++;
      history.pushState({ idx: navIdx }, "", "#" + route);
      navRoutes.length = navIdx;
    }
    navRoutes[navIdx] = route;
    navOnOverlay = false;
  }
  navReplaceNext = false;
  if (navApplying) return;
  const overlay = overlayOpen();
  if (overlay && !navOnOverlay && hasUserActivation()){
    navIdx++;
    history.pushState({ idx: navIdx, overlay: true }, "", "#" + route);
    navRoutes.length = navIdx; navRoutes[navIdx] = route;
    navOnOverlay = true;
  } else if (!overlay && navOnOverlay){
    // Closed by a tap: drop its entry so the next back does something.
    navOnOverlay = false;
    navSettling++; history.back();
  }
}
// First tap on a page that was opened straight onto a screen other than Home:
// turn this entry into Home and push the screen back on top of it (legal now,
// with a user gesture), so back has somewhere in the app to go.
function ensureNavBase(){
  if (navBaseReady) return;
  navBaseReady = true;
  const cur = currentRoute();
  if (navIdx !== 0 || cur === "/" || !hasUserActivation()) return;
  history.replaceState({ idx: 0 }, "", "#/");
  history.pushState({ idx: 1 }, "", "#" + cur);
  navIdx = 1; navRoutes = ["/", cur];
}

// Show the screen a URL names. Doesn't render (callers do).
function applyRoute(path){
  const { view, params } = parseRoute(path);
  const m = state.match;
  // Leaving the Result screen by history finishes that match: it's already
  // archived, so this is what Result's own exit button does, minus the jump.
  if (m && m.status === "complete" && view !== "result"){
    state.match = null; state.snapshots = []; ui = defaultUi(); save();
  }
  const live = state.match && state.match.status !== "complete";
  if (view === "match" || view === "result"){
    if (live) ui.awayFromMatch = false;
    return; // no match to show: syncRoute rewrites the URL to wherever render lands
  }
  if (live) ui.awayFromMatch = true;
  if (view !== state.view){
    ui.sideMenuOpen = false; ui.playerModal = null;
    ui.editingMatchPreset = ui.editingTournamentPreset = ui.editingClubMatchPreset = ui.editingClubTournamentPreset = null;
  }
  if (params.c) ui.currentClubId = params.c;
  if (params.ct) ui.currentTournamentId = params.ct;
  if (params.t) state.activeTournamentId = params.t;
  if (view === "matchSetup") ui.clubMatchSetupType = params.c ? (params.type || null) : null;
  if (view === "playerProfile" && (!ui.profile || ui.profile.id !== params.p)) openPlayerProfile(params.scope, params.p, "");
  setView(view);
}

// Switch screen, dropping cached data that belongs to a different club /
// tournament; render() lazy-loads whatever the screen needs.
function setView(view){
  state.view = view;
  if (view === "clubHome" && ui.currentClubId && ui.club && ui.club.id !== ui.currentClubId){
    ui.club = null;
  } else if (view === "clubTournamentDashboard" && ui.currentTournamentId && ui.clubTournament && ui.clubTournament.id !== ui.currentTournamentId){
    ui.clubTournament = null; ui.tournamentTeamEdit = null;
  }
}
function goToView(view){ setView(view); render(); }

// On-screen back bars: if the screen before this one in history is the bar's
// target, really go back (so the phone's back doesn't return here after);
// otherwise swap this entry for the target.
function backBarTo(view){
  const prev = navIdx > 0 && navRoutes[navIdx - 1];
  if (prev && parseRoute(prev).view === view){ navBypass = true; history.back(); return; }
  navReplaceNext = true;
  goToView(view);
}

/* A player profile, opened from a list or straight from its URL. The data
   loads in render() (ui.profile.pending), so a profile named by the URL at
   boot waits for the cloud client instead of failing. */
function openPlayerProfile(scope, id, name){
  ui.profile = { scope, id, name: name || "", data: null, loading: true, pending: true, error: null, editing: false, message: null, aliases: [], claiming: false, merging: false };
}
function loadPlayerProfile(){
  const pr = ui.profile, id = pr.id;
  pr.pending = false;
  const still = () => ui.profile && ui.profile.id === id;
  fetchPlayerProfile(id).then(r => {
    if (!still()) return;
    ui.profile.loading = false;
    if (r.error) ui.profile.error = r.error;
    else { ui.profile.data = r.data; if (!ui.profile.name && r.data) ui.profile.name = r.data.name; }
    render();
  });
  fetchPlayerAliases(id).then(al => { if (still()){ ui.profile.aliases = al; render(); } });
  if (session) fetchMyPlayerIdentity().then(() => { if (still()) render(); });
  // The Premier block needs ui.premier (render() loads it); a Premier-opened
  // profile also needs the viewer's clubs' matches for its club block.
  if (pr.scope === "premier"){
    fetchViewerClubMatches().then(ms => { if (still()){ ui.profile.clubMatches = ms; render(); } });
  }
}

/* A form holds unsaved input when any field differs from what it was
   rendered with. Hidden inputs can't be compared (their defaultValue follows
   .value) and search boxes only filter, so both are ignored. */
function formIsDirty(form){
  return [...form.elements].some(el => {
    if (el.disabled || el.closest("[data-nav-ignore]")) return false;
    const t = el.type;
    if (["hidden", "submit", "button", "reset", "search"].includes(t) || el.classList.contains("team-builder-search")) return false;
    if (t === "file") return !!(el.files && el.files.length);
    if (t === "checkbox" || t === "radio") return el.checked !== el.defaultChecked;
    if (el.tagName === "SELECT"){
      if (el.multiple) return [...el.options].some(o => o.selected !== o.defaultSelected);
      const opts = [...el.options], def = opts.findIndex(o => o.defaultSelected);
      return el.selectedIndex !== (def >= 0 ? def : (opts.length ? 0 : -1));
    }
    return typeof el.defaultValue === "string" && el.value !== el.defaultValue;
  });
}
function hasDirtyForm(rootSel){
  return [...document.querySelectorAll(`${rootSel} form`)].some(formIsDirty);
}
/* render() rebuilds #app / #modal-root with innerHTML, which used to drop
   anything half-typed whenever something re-rendered (a confirmation
   opening, a background fetch landing). These carry the edited fields of
   each form[id] across the swap. A field is only put back if the re-render
   left its default alone -- so a render that deliberately changes a field
   (picking a preset re-fills overs) still wins -- and a form that was just
   submitted is skipped, so a successful save still clears it. */
function captureFormDrafts(root){
  const drafts = {};
  root.querySelectorAll("form[id]").forEach(f => {
    if (f.dataset.submitted) return;
    const fields = [];
    [...f.elements].forEach(el => {
      if (!el.name || el.disabled || ["hidden", "submit", "button", "reset", "file"].includes(el.type)) return;
      if (el.type === "checkbox" || el.type === "radio"){
        if (el.checked !== el.defaultChecked) fields.push({ kind: "check", name: el.name, value: el.value, checked: el.checked, def: el.defaultChecked });
      } else if (el.tagName === "SELECT"){
        if (el.multiple) return;
        const d = [...el.options].find(o => o.defaultSelected) || el.options[0];
        const def = d ? d.value : "";
        if (el.value !== def) fields.push({ kind: "select", name: el.name, value: el.value, def });
      } else if (typeof el.defaultValue === "string" && el.value !== el.defaultValue){
        fields.push({ kind: "text", name: el.name, value: el.value, def: el.defaultValue });
      }
    });
    if (fields.length) drafts[f.getAttribute("id")] = fields;
  });
  return drafts;
}
function restoreFormDrafts(root, drafts){
  Object.keys(drafts).forEach(id => {
    const f = root.querySelector(`form[id="${CSS.escape(id)}"]`);
    if (!f) return;
    drafts[id].forEach(d => {
      const named = [...f.elements].filter(el => el.name === d.name);
      if (d.kind === "check"){
        const el = named.find(x => x.value === d.value);
        if (el && el.defaultChecked === d.def) el.checked = d.checked;
        return;
      }
      if (named.length !== 1) return;
      const el = named[0];
      if (d.kind === "select"){
        const o = [...el.options].find(x => x.defaultSelected) || el.options[0];
        if ((o ? o.value : "") === d.def && [...el.options].some(x => x.value === d.value)) el.value = d.value;
      } else if (el.defaultValue === d.def){
        el.value = d.value;
        // Lets DOM-only followers (e.g. match setup's "Who bats first?" labels)
        // catch up; not for search-selects, where input would pop the list open.
        if (!el.closest(".combo")) el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
}
function confirmDiscard(proceed){
  askConfirm({
    title: "Discard your changes?", icon: "✎", tone: "primary",
    body: `<p>What you've entered here hasn't been saved yet.</p>`,
    confirmLabel: "Discard", cancelLabel: "Keep editing",
    onConfirm: () => { proceed(); }
  });
}
// Back (or the on-screen back bar) away from a screen with typed input asks first.
function leaveScreen(go){
  if (hasDirtyForm("#app")) confirmDiscard(go); else go();
}

// Close the top-most sheet/menu. Returns false if none is open.
function closeTopOverlay(){
  const m = state.match;
  const onMatch = !!(m && m.status !== "complete" && !ui.awayFromMatch);
  if (ui.confirm){ cancelConfirm(); return true; }
  if (ui.sideMenuOpen){ ui.sideMenuOpen = false; render(); return true; }
  if (ui.syncSheet){ ui.syncSheet = false; render(); return true; }
  if (ui.playerModal && document.querySelector("#modal-root form")){
    const close = () => { ui.playerModal = null; render(); };
    if (hasDirtyForm("#modal-root")) confirmDiscard(close); else close();
    return true;
  }
  if (ui.tournamentTeamEdit && document.querySelector(".team-modal")){ closeTeamEdit(); return true; }
  if (onMatch && ui.matchMenu){ ui.matchMenu = ui.matchMenu === "menu" ? null : "menu"; ui.squadError = null; render(); return true; }
  if (onMatch && ui.wicketFlow){ ui.wicketFlow = null; ui.runoutRuns = 0; ui.runoutEnd = "striker"; render(); return true; }
  return false;
}

/* A back/forward move that shouldn't simply change screen is handled here
   and undone. Returns true when it took care of it, most specific first:
   sheets and overlays, the live match's own sheets and the "Leave live
   scoring?" question, in-screen sub-forms, and unsaved input. `redo` makes
   the original move for real (after a confirmation). */
function interceptNav(redo){
  const m = state.match;
  const onMatch = !!(m && m.status !== "complete" && !ui.awayFromMatch);
  // 1. Sheets and overlays, top-most first (the live match's included).
  if (closeTopOverlay()) return true;
  // 2. The live match screen: its other pauses, then ask before leaving.
  if (onMatch){
    if (ui.pendingExtra){ ui.pendingExtra = null; render(); return true; }
    if (pendingPickKey(m) && !pickSheetDismissed(m)){ dismissPick(); return true; }
    if (ui.showFullScorecard){ ui.showFullScorecard = false; render(); return true; }
    askConfirm({
      title: "Leave live scoring?", icon: "🏏", tone: "primary",
      body: `<p>The match keeps going and nothing is lost. Get back to it from the green <b>Live</b> pill at the top, or from Home.</p>`,
      confirmLabel: "Leave", cancelLabel: "Keep scoring",
      onConfirm: () => { redo(); }
    });
    return true;
  }
  // 3. A form opened inside a screen (preset editors, claim/merge).
  const subForm = state.view === "presets" && (ui.editingMatchPreset || ui.editingTournamentPreset) ? () => { ui.editingMatchPreset = null; ui.editingTournamentPreset = null; }
    : state.view === "clubPresets" && (ui.editingClubMatchPreset || ui.editingClubTournamentPreset) ? () => { ui.editingClubMatchPreset = null; ui.editingClubTournamentPreset = null; }
    : state.view === "playerProfile" && ui.profile && (ui.profile.claiming || ui.profile.merging) ? () => { ui.profile.claiming = false; ui.profile.merging = false; }
    : null;
  if (subForm){ leaveScreen(() => { subForm(); render(); }); return true; }
  // 4. Unsaved input on the screen.
  if (hasDirtyForm("#app")){ confirmDiscard(redo); return true; }
  return false;
}

window.addEventListener("popstate", (e) => {
  // Nothing rendered while handling the press may add an entry (a sheet this
  // opens, e.g. a confirmation, just doesn't get one).
  navApplying = true;
  try { onPopState(e); } finally { navApplying = false; }
});
function onPopState(e){
  const idx = e.state && typeof e.state.idx === "number" ? e.state.idx : null;
  const wasOverlay = navOnOverlay;
  navOnOverlay = !!(e.state && e.state.overlay);
  // A move we made ourselves (undoing an intercepted one, or dropping a closed
  // sheet's entry): just note where we are.
  if (navSettling > 0){ navSettling--; if (idx != null) navIdx = idx; return; }
  // Back off a sheet's own entry: that press was for the sheet.
  if (wasOverlay && idx != null && idx < navIdx && !navBypass){
    navIdx = idx;
    closeTopOverlay();
    return;
  }
  if (idx == null){
    // A hand-edited URL (or an entry from before routes existed): a new entry.
    navIdx++; history.replaceState({ idx: navIdx }, "", location.hash || "#/");
    navRoutes.length = navIdx; navRoutes[navIdx] = currentRoute();
  } else {
    const delta = idx - navIdx;
    if (!navBypass && delta !== 0){
      const redo = () => { navBypass = true; history.go(delta); };
      navHold = true;
      let handled;
      try { handled = interceptNav(redo); } finally { navHold = false; }
      if (handled){ navSettling++; history.go(-delta); return; }
    }
    navIdx = idx;
    navRoutes[navIdx] = currentRoute();
  }
  navBypass = false;
  applyRoute(currentRoute());
  render();
}

/* Top-bar sync status, only for a signed-in (cloud) user: nothing when all
   is synced and online; otherwise offline / syncing / N waiting / N failed.
   Tapping it opens the sync sheet. Static -- no infinite animation on an
   always-visible control (see CLAUDE.md "Theme & sound"). */
