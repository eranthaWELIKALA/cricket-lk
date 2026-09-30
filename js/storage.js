/* Cricket.lk — storage: the DB wrapper (window.storage -> localStorage -> memory).
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   3. STORAGE — DB wrapper: window.storage -> localStorage -> memory.
   Schema v2 adds teams/players/presets/tournaments/history alongside
   the original { match, snapshots }; v1 saves are migrated in place
   the first time a v2-aware build loads them.
   ============================================================ */
var STORAGE_KEY = "cricket.lk.v2";
var LEGACY_KEY = "cricket.lk.v1";

var DB = (() => {
  let mem = {};
  function backend(){
    if (typeof window !== "undefined" && window.storage && typeof window.storage.getItem === "function") return window.storage;
    try {
      if (typeof localStorage !== "undefined"){
        localStorage.setItem("__t", "1"); localStorage.removeItem("__t");
        return localStorage;
      }
    } catch (_){ /* private mode / disabled storage */ }
    return null;
  }
  const store = backend();
  return {
    load(key){
      try {
        const raw = store ? store.getItem(key) : mem[key];
        return raw ? JSON.parse(raw) : null;
      } catch (_){ return null; }
    },
    save(key, data){
      const raw = JSON.stringify(data);
      try { if (store) store.setItem(key, raw); else mem[key] = raw; }
      catch (_){ mem[key] = raw; }
    },
    clear(key){
      try { if (store) store.removeItem(key); } catch (_){}
      delete mem[key];
    },
    // Exposes the same window.storage -> localStorage -> null tier DB itself
    // resolved, so other things (the Supabase auth session adapter) can
    // follow the identical backend choice instead of re-detecting it.
    rawBackend: store
  };
})();

function genId(prefix){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState(){
  const matchPresets = {}; DEFAULT_MATCH_PRESETS.forEach(p => { matchPresets[p.id] = p; });
  const tournamentPresets = {}; DEFAULT_TOURNAMENT_PRESETS.forEach(p => { tournamentPresets[p.id] = p; });
  return {
    match: null, snapshots: [],
    view: "home",
    players: {}, teams: {},
    matchPresets, tournamentPresets,
    tournaments: {}, matchHistory: {},
    activeTournamentId: null,
    activeClubId: null, // which club (if any) Home's quick-action cards currently target -- see the CLOUD "clubs" section
    // The club / club tournament the saved `view` is showing. ui.currentClubId /
    // currentTournamentId aren't persisted, so without these a reload on a club
    // screen had no id to load and spun on "Loading…" forever. See render().
    viewClubId: null, viewTournamentId: null,
    clubDataReset202609: false, // one-time drop of local club-match copies after the cloud wipe -- see purgeLocalClubMatches()
    guestPlayersCleaned: false, // one-time purge of club-match names that leaked into state.players -- see purgeLeakedClubPlayers()
    soundEnabled: true,
    themeId: "midnight", // see THEME_PRESETS (REFERENCE DATA) and applyTheme()
    branding: { name: "", logo: null, accent: null, accent2: null }
  };
}
