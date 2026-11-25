/* Cricket.lk — player ids: who each scorecard name is (the UI's half).
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- player ids ---
   The engine counts every player over several matches by key (see "who a
   scorecard name is" in engine.js): the id a match stored for that name
   (match.playerIds, recorded by registerMatchPlayer), else whatever this
   device can tell, else the name. This file is the device's part:
   - resolveMatchPlayerId: for a name a match has no id for (a match scored
     before ids), the one player it can only be -- a guest match's names are
     this phone's guest players, a club match's are that club's roster (when
     it's loaded or in the read cache here), a tournament visitor is their
     "guest:<name>" key. Two players with that name: it can't say (null).
   - playerNameForId: the name to show for an id (a renamed player shows
     their current name, whichever name each match has).
   - statsOpts(): both, for aggregatePlayerStats / computeRecords /
     tournamentSummary; statsWho(id, names): one player, for playerCareer /
     playerMatchLines.
   - setMatchPlayerId / withoutTempIds: recording ids, and keeping a temp id
     (a club player added offline, "tmp:…") off the cloud. */

// name (lowercase) -> [player ids] of a list of { id, name }.
function playerNameIndex(list){
  const idx = {};
  (list || []).forEach(p => {
    if (!p || !p.id || !p.name) return;
    const k = String(p.name).trim().toLowerCase();
    const ids = idx[k] || (idx[k] = []);
    if (!ids.includes(p.id)) ids.push(p.id);
  });
  return idx;
}
// A club's roster on this device: the loaded club, else the read cache's copy.
function clubRosterHere(clubId){
  if (ui.club && ui.club.id === clubId && Array.isArray(ui.club.roster)) return ui.club.roster;
  const cache = typeof cacheFor === "function" ? cacheFor() : null;
  const c = cache && cache.clubs && cache.clubs[clubId];
  return c && Array.isArray(c.roster) ? c.roster : [];
}

/* Built once per stats render (statsOpts), so a leaderboard over hundreds of
   matches doesn't search the lists for every name. */
function playerIdLookup(){
  const guests = playerNameIndex(Object.values(state.players || {}));
  const rosters = {};
  const roster = clubId => rosters[clubId] || (rosters[clubId] = playerNameIndex(clubRosterHere(clubId)));
  const resolve = (match, label) => {
    if (!match || label == null || isUnnamedPlayer(label)) return null;
    const k = String(label).trim().toLowerCase();
    if (!k) return null;
    if (!match.clubId){
      const ids = guests[k];
      return ids && ids.length === 1 ? ids[0] : null;
    }
    if (isGuestInMatch(match, label)) return guestPlayerKey(label);
    const ids = roster(match.clubId)[k];
    return ids && ids.length === 1 ? ids[0] : null;
  };
  const keyOf = (match, label) => playerKey(match, label, resolve);
  // Two players of that name on the list the match belongs to: an unlinked
  // label is neither of them (linkedKeyOf / playerTestFor leave it alone).
  keyOf.ambiguous = (match, label) => {
    if (!match || label == null) return false;
    const k = String(label).trim().toLowerCase();
    if (!match.clubId) return (guests[k] || []).length > 1;
    if (isGuestInMatch(match, label)) return false;
    return (roster(match.clubId)[k] || []).length > 1;
  };
  return { resolve, keyOf };
}

// The name to show for an id: this phone's guest list, a roster here, Premier's list, the viewer's own profile.
function playerNameForId(id){
  if (!id || isNameKey(id)) return null;
  if (state.players && state.players[id]) return state.players[id].name;
  const cache = typeof cacheFor === "function" ? cacheFor() : null;
  const rosters = [ui.club && ui.club.roster, ...Object.values((cache && cache.clubs) || {}).map(c => c && c.roster)];
  for (const r of rosters){
    const p = (r || []).find(x => x && x.id === id);
    if (p && p.name) return p.name;
  }
  const premier = ui.premier && ui.premier.players && ui.premier.players.find(p => p.id === id);
  if (premier) return premier.name;
  const me = typeof myPlayerSelf === "function" ? myPlayerSelf() : null;
  return me && me.id === id ? me.name : null;
}

// For aggregatePlayerStats / computeRecords / tournamentSummary.
function statsOpts(){
  const look = playerIdLookup();
  return { keyOf: look.keyOf, nameOf: playerNameForId };
}
// One player for playerCareer / playerMatchLines: their id, and the names
// that count for them in matches without ids (their name and any aliases).
function statsWho(id, names){
  return playerWho(id, names, playerIdLookup().keyOf);
}

/* Records that `label` in the match being scored is player `id`. */
function setMatchPlayerId(label, id, match){
  const m = match || state.match;
  if (!m || !label || !id) return false;
  if (!m.playerIds) m.playerIds = {};
  if (m.playerIds[label] === id) return false;
  m.playerIds[label] = id;
  return true;
}
// A match's ids as they go to the cloud: a temp id (a club player added
// offline whose add hasn't synced) is left out -- the name still counts, and
// the database links it later (supabase/025).
function withoutTempIds(ids){
  if (!ids) return ids;
  const out = {};
  Object.keys(ids).forEach(k => { if (ids[k] && String(ids[k]).indexOf(TEMP_ID_PREFIX) !== 0) out[k] = ids[k]; });
  return out;
}
