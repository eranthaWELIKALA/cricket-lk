/* Cricket.lk — UI state: state/ui objects, load/save/migration, guest data helpers.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   5. UI
   ============================================================ */
var state = defaultState();
function defaultUi(){
  return {
    pendingExtra: null, wicketFlow: null, runoutRuns: 0, runoutEnd: "striker", showFullScorecard: false, confirm: null, syncSheet: false, matchMenu: null, squadError: null, pickDismissed: null, awayFromMatch: false, clubRosterLoading: null, clubTournamentLoading: null, editingClubMatchPreset: null, editingClubTournamentPreset: null, profile: null,
    matchSetupPresetId: null,
    tournamentSetupPresetId: null, tournamentSetupTeamIds: [],
    tournamentTab: "standings",
    selectedTeamId: null,
    presetsTab: "match", editingMatchPreset: null, editingTournamentPreset: null,
    // cloud clubs (see CLOUD section) -- caches of fetched data, not persisted;
    // re-fetched whenever their screen is opened.
    myClubs: null, myClubsLoading: false, currentClubId: null, club: null, clubBusy: false, clubInviteMessage: null,
    clubMatchSetupType: null, // "practice" | "friendly" | "tournament", set when entering club match setup
    clubTournamentSetupPresetId: null, clubTournamentSetupName: null, currentTournamentId: null, clubTournament: null, tournamentTeamEdit: null, tournamentTeamBusy: false, tournamentTeamError: null,
    premierLoading: false, premier: null, // { players, premierMatches, pendingClaims, pendingMerges } -- see fetchPremierData()
    identity: null, // { myPlayer, pendingClaim, pendingMerges } for the signed-in viewer -- see fetchMyPlayerIdentity()
    claimMessage: null, clubAddMessage: null, playerModal: null,
    sideMenuOpen: false
  };
}
var ui = defaultUi();

function save(){ DB.save(STORAGE_KEY, state); }

function migrateLegacy(){
  const legacy = DB.load(LEGACY_KEY);
  if (!legacy || !legacy.match) return null;
  const fresh = defaultState();
  fresh.match = legacy.match;
  fresh.snapshots = legacy.snapshots || [];
  return fresh;
}

/* One-time cleanup: before club matches stopped writing to the guest table,
   every name typed in a club match landed in state.players, so club players
   showed up in guest mode. Remove exactly those: a name that appears in a
   club match (archived or in progress) and nowhere guest -- not in any guest
   match, not on a saved local team. A guest player who merely shares a name
   with a club player and was never used anywhere else goes too; guest
   players are temporary and re-created by typing the name. Mutates `st`,
   returns the removed names. */
function purgeLeakedClubPlayers(st){
  const club = new Set(), keep = new Set();
  const matches = Object.values(st.matchHistory || {}).concat(st.match ? [st.match] : []);
  matches.forEach(m => matchPlayerNames(m).forEach(n => (m.clubId ? club : keep).add(n.toLowerCase())));
  Object.values(st.teams || {}).forEach(t => (t.playerIds || []).forEach(id => {
    if (st.players[id]) keep.add(st.players[id].name.toLowerCase());
  }));
  const removed = [];
  Object.values(st.players || {}).forEach(p => {
    const k = p.name.toLowerCase();
    if (club.has(k) && !keep.has(k)){ delete st.players[p.id]; removed.push(p.name); }
  });
  return removed;
}

/* One-time, per device: the cloud's clubs/players/matches were wiped
   (2026-09), so drop this device's archived copies of club matches (they'd
   otherwise keep feeding club stats via clubMatchesFor) and forget the
   selected club, which no longer exists. Guest matches (no clubId) and a
   match still in progress are left alone. Returns how many were removed. */
function purgeLocalClubMatches(st){
  let removed = 0;
  Object.keys(st.matchHistory || {}).forEach(id => {
    if (st.matchHistory[id] && st.matchHistory[id].clubId){ delete st.matchHistory[id]; removed++; }
  });
  st.activeClubId = null;
  return removed;
}

function load(){
  const data = DB.load(STORAGE_KEY);
  if (data){
    state = Object.assign(defaultState(), data);
    if (!state.guestPlayersCleaned){ purgeLeakedClubPlayers(state); state.guestPlayersCleaned = true; save(); }
    if (!state.clubDataReset202609){ purgeLocalClubMatches(state); state.clubDataReset202609 = true; save(); }
    applyTheme(); return;
  }
  state = migrateLegacy() || defaultState();
  state.clubDataReset202609 = true;   // nothing from before the wipe to purge on a fresh/legacy install
  applyTheme();
  save();
}

function pushSnapshot(){
  state.snapshots.push(JSON.parse(JSON.stringify(state.match)));
  if (state.snapshots.length > 80) state.snapshots.shift();
}

/* --- teams & players (persistent, swappable rosters; name autocomplete) --- */
function findOrCreatePlayer(name){
  const trimmed = (name || "").trim();
  const existing = Object.values(state.players).find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const player = { id: genId("player"), name: trimmed };
  state.players[player.id] = player;
  return player;
}

function allPlayerNames(){ return Object.values(state.players).map(p => p.name); }

/* --- guest vs club scoping. Guest data (state.players / state.teams) lives
   only on this device and is only offered in guest matches. A club match's
   names belong to that club's roster instead -- and, via the same
   add_player_to_club RPC, to the global (Premier) players table, where one
   player can sit on any number of clubs' rosters. --- */
function activeMatchClubId(){ return state.match && state.match.clubId ? state.match.clubId : null; }
function activeSetupClubId(){ return activeMatchClubId() || (ui.clubMatchSetupType && ui.currentClubId) || null; }

/* Presets are per role too: guests use state.matchPresets/tournamentPresets
   (on this device); a club uses its own club_presets, cached on ui.club. The
   two are never merged -- club setup screens call these instead of reading
   the guest tables. */
function clubPresetList(kind, clubId){
  return ui.club && ui.club.id === clubId && ui.club.presets ? ui.club.presets[kind] : [];
}
function clubSetupId(){ return ui.clubMatchSetupType && ui.currentClubId ? ui.currentClubId : null; }
function matchPresetChoices(){
  const c = clubSetupId();
  return c ? clubPresetList("match", c) : Object.values(state.matchPresets);
}

function suggestionPlayerNames(){
  const clubId = activeMatchClubId();
  if (!clubId) return allPlayerNames();
  return ui.club && ui.club.id === clubId ? ui.club.roster.map(p => p.name) : [];
}
function suggestionTeamNames(){
  const clubId = activeSetupClubId();
  if (!clubId) return Object.values(state.teams).map(t => t.name);
  const club = (ui.myClubs || []).find(c => c.id === clubId) || (ui.club && ui.club.id === clubId ? ui.club : null);
  return club ? [club.name] : [];
}

/* Where a name typed during a match gets remembered. Guest match: the local
   players table, as always. Club match: never the guest table -- it goes to
   the club roster + global players (best effort, like syncMatchToCloud; the
   match itself is safe locally either way) and into the cached roster so the
   suggestions update straight away. */
function registerMatchPlayer(name, teamKey){
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  if (state.match && isGuestInMatch(state.match, trimmed)) return; // guests are never stored
  const clubId = activeMatchClubId();
  if (!clubId){ findOrCreatePlayer(trimmed); return; }
  // A friendly's visiting side (team B) isn't the home club's people: they
  // still become global players, but stay off this club's roster.
  const visitor = state.match.matchType === "friendly" && teamKey === "B";
  const onRoster = ui.club && ui.club.id === clubId ? ui.club.roster.find(p => p.name.toLowerCase() === trimmed.toLowerCase()) : null;
  if (!visitor && onRoster && onRoster.id) return;   // already a club player -- nothing to store
  if (!visitor && ui.club && ui.club.id === clubId && !onRoster){
    ui.club.roster.push({ id: null, name: trimmed });
  }
  // Queued if offline (submitCloudOp) -- syncs with everything else.
  if (supabaseClient && session) (visitor ? addGlobalPlayer(trimmed, clubId) : addPlayerToClub(clubId, trimmed)).catch(() => {});
}

function createTeam(name){
  const team = { id: genId("team"), name: (name || "").trim(), playerIds: [] };
  state.teams[team.id] = team;
  return team;
}

function deleteTeam(teamId){ delete state.teams[teamId]; }

function addPlayerToTeam(teamId, name){
  const player = findOrCreatePlayer(name);
  const team = state.teams[teamId];
  if (team && !team.playerIds.includes(player.id)) team.playerIds.push(player.id);
  return player;
}

function removePlayerFromTeam(teamId, playerId){
  const team = state.teams[teamId];
  if (team) team.playerIds = team.playerIds.filter(id => id !== playerId);
}

function movePlayerToTeam(playerId, fromTeamId, toTeamId){
  removePlayerFromTeam(fromTeamId, playerId);
  const team = state.teams[toTeamId];
  if (team && !team.playerIds.includes(playerId)) team.playerIds.push(playerId);
}

// Global delete (Players screen) -- also scrubs the player out of every
// team's roster so nothing keeps a dangling playerId.
function deletePlayer(playerId){
  delete state.players[playerId];
  Object.values(state.teams).forEach(t => { t.playerIds = t.playerIds.filter(id => id !== playerId); });
}

/* --- presets --- */
function saveMatchPreset(preset){
  const id = preset.id || genId("preset");
  state.matchPresets[id] = Object.assign({}, preset, { id });
  return state.matchPresets[id];
}
function deleteMatchPreset(id){ delete state.matchPresets[id]; }

function saveTournamentPreset(preset){
  const id = preset.id || genId("tpreset");
  state.tournamentPresets[id] = Object.assign({}, preset, { id });
  return state.tournamentPresets[id];
}
function deleteTournamentPreset(id){ delete state.tournamentPresets[id]; }

/* --- tournaments & match history --- */
function createTournament({ name, tournamentPresetId, teamIds }){
  const tournament = { id: genId("tourney"), name: (name || "").trim(), tournamentPresetId, teamIds: (teamIds || []).slice(), matchIds: [] };
  state.tournaments[tournament.id] = tournament;
  return tournament;
}

function archiveMatch(match){
  const archived = JSON.parse(JSON.stringify(match));
  archived.id = genId("match");
  archived.completedAt = Date.now();
  state.matchHistory[archived.id] = archived;
  if (match.tournamentId && state.tournaments[match.tournamentId]){
    state.tournaments[match.tournamentId].matchIds.push(archived.id);
  }
  return archived;
}
