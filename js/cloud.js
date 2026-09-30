/* Cricket.lk — cloud: Supabase client, auth, outbox sync, read cache, cloud RPCs.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   4. CLOUD — Supabase client, auth session, and the platform-wide
   admin flag. Everything here is additive: with SUPABASE_URL/
   SUPABASE_ANON_KEY unset, `supabaseClient` stays null and every
   cloud-gated screen/action just falls back to "sign in required" —
   local guest scoring never depends on any of this, and no network
   request happens at all on an unconfigured deployment.
   Session/profile/isAdmin are deliberately plain top-level `let`
   vars, NOT fields on `state` or `ui`: `state` is JSON-persisted via
   DB.save() (a Supabase session object doesn't belong in that blob,
   supabase-js manages its own persistence) and `ui` gets wholesale
   reset (`ui = defaultUi()`) at points like finishing a match, which
   would otherwise wipe sign-in status out from under the user.
   The supabase-js library is loaded dynamically (not a static
   <script> tag) so a slow/blocked CDN fetch can never delay booting
   the core scorer — see loadSupabaseLib() below.
   ============================================================ */
const SUPABASE_URL = "https://xfsaldtvvcuyondayjjw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jDfjBu62WssP3fKEbbfVKw_ZyoxCXUm";  // publishable key -- safe to expose, access is enforced by RLS
const SUPABASE_JS_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

function loadSupabaseLib(){
  if (typeof window.supabase !== "undefined") return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SUPABASE_JS_CDN_URL;
    el.onload = () => resolve(window.supabase);
    el.onerror = () => reject(new Error("Failed to load supabase-js"));
    document.head.appendChild(el);
  });
}

function makeCloudAuthStorage(){
  const backend = DB.rawBackend; // same window.storage -> localStorage -> null tier as DB
  const mem = {};
  return {
    getItem: (key) => Promise.resolve(backend ? backend.getItem(key) : (key in mem ? mem[key] : null)),
    setItem: (key, value) => {
      try { if (backend) backend.setItem(key, value); else mem[key] = value; }
      catch (_){ mem[key] = value; }
      return Promise.resolve();
    },
    removeItem: (key) => {
      try { if (backend) backend.removeItem(key); } catch (_){}
      delete mem[key];
      return Promise.resolve();
    }
  };
}

/* --- offline-first: outbox + read cache ------------------------------------
   Every club write goes through submitCloudOp(kind, args): online with an
   empty queue it runs straight away (so errors like a duplicate team name
   still show on the form); offline, or behind earlier unsynced changes, it's
   appended to the OUTBOX (persisted under its own storage key) and replayed
   in order by syncNow() whenever the app is online and signed in. Creates
   carry client-generated uuids, so a replay after a lost response is safe
   (a duplicate-id error just means "already saved").
   Reads (fetchMyClubs / fetchClubDetail / fetchClubTournamentDetail) keep the
   last server copy in CLOUD CACHE (own key, per user, cleared on sign-out)
   and fall back to it offline; either way, pending ops are laid over the top
   (overlayClubData / overlayTournamentData) so the UI shows offline edits.
   The pure helpers below take their inputs explicitly and are tested. */
const OUTBOX_KEY = "cricket.lk.outbox.v1";
const CLOUD_CACHE_KEY = "cricket.lk.cloudcache.v1";
const TEMP_ID_PREFIX = "tmp:";   // a player added offline, until add_player_to_club returns the real id

function newUuid(){
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
  });
}
/* A failed fetch (offline, DNS, timeout) -- worth retrying later -- as
   opposed to a real database answer (RLS, constraint, missing SQL), which
   has a code and won't change by retrying. */
function isNetworkError(err, online){
  if (!err) return false;
  if (online === false) return true;
  const msg = String((err && err.message) || err);
  return !err.code && /fetch|network|load failed|timed? ?out|abort|offline/i.test(msg);
}
/* Deep-replace a temp id with the real one (outbox payloads, caches, open edits). */
function replaceIdDeep(obj, from, to){
  if (Array.isArray(obj)) return obj.map(v => replaceIdDeep(v, from, to));
  if (obj && typeof obj === "object"){
    const out = {};
    Object.keys(obj).forEach(k => { out[k] = replaceIdDeep(obj[k], from, to); });
    return out;
  }
  return obj === from ? to : obj;
}
/* Add `op` to `queue` (returns the new queue), folding it into a pending op
   for the same thing where that's equivalent: a second save of a team or
   preset replaces the first (keeping isNew), a delete of something never
   synced just cancels its create, and repeat roster/global adds of a name
   are dropped. Failed ops are left alone (they need a manual retry). */
function coalesceOp(queue, op){
  const same = o => !o.failed && o.userId === op.userId && o.kind === op.kind;
  const a = op.args;
  if (op.kind === "team.save" || op.kind === "preset.save"){
    const prev = queue.find(o => same(o) && o.args.id === a.id);
    if (prev) return queue.map(o => o === prev ? Object.assign({}, prev, { args: Object.assign({}, a, { isNew: prev.args.isNew || a.isNew }) }) : o);
  }
  if (op.kind === "team.delete" || op.kind === "preset.delete"){
    const saveKind = op.kind === "team.delete" ? "team.save" : "preset.save";
    const pendingNew = queue.find(o => !o.failed && o.userId === op.userId && o.kind === saveKind && o.args.id === a.id && o.args.isNew);
    if (pendingNew) return queue.filter(o => !(o.kind === saveKind && o.args.id === a.id && !o.failed));
    queue = queue.filter(o => !(o.kind === saveKind && o.args.id === a.id && !o.failed));
  }
  if (op.kind === "roster.add" || op.kind === "global.add"){
    const key = (a.name || "").trim().toLowerCase();
    if (queue.some(o => same(o) && o.args.clubId === a.clubId && (o.args.name || "").trim().toLowerCase() === key)) return queue;
  }
  if (op.kind === "match" && queue.some(o => same(o) && o.args.id === a.id)) return queue;
  return [...queue, op];
}
/* A club's server snapshot + this user's pending ops -> what the UI shows. */
function overlayClubData(club, ops){
  const c = JSON.parse(JSON.stringify(club));
  c.roster = c.roster || []; c.tournaments = c.tournaments || [];
  c.presets = c.presets || { match: [], tournament: [] };
  ops.filter(o => !o.failed && o.args && o.args.clubId === c.id).forEach(o => {
    const a = o.args;
    if (o.kind === "tournament.create" && !c.tournaments.some(t => t.id === a.id)){
      c.tournaments.unshift({ id: a.id, name: a.name, created_at: new Date(o.createdAt).toISOString(), pending: true });
    } else if (o.kind === "preset.save"){
      const list = c.presets[a.kind] = (c.presets[a.kind] || []).filter(p => p.id !== a.id);
      list.push(Object.assign({}, a.preset, { id: a.id, pending: true }));
    } else if (o.kind === "preset.delete"){
      ["match", "tournament"].forEach(k => { c.presets[k] = (c.presets[k] || []).filter(p => p.id !== a.id); });
    } else if (o.kind === "roster.add"){
      const key = a.name.trim().toLowerCase();
      if (!c.roster.some(p => p.name && p.name.toLowerCase() === key)){
        const d = a.details || {};
        c.roster.push({ id: a.tempId || null, name: a.name.trim(), nickname: d.nickname || null, jersey_no: parseJerseyNo(d.jersey_no), pending: true });
      }
    } else if (o.kind === "roster.addExisting"){
      if (!c.roster.some(p => p.id === a.playerId)) c.roster.push({ id: a.playerId, name: a.name, pending: true });
    } else if (o.kind === "roster.remove"){
      c.roster = c.roster.filter(p => p.id !== a.playerId);
    }
  });
  return c;
}
/* A tournament's server snapshot (or null, if it was created offline) +
   pending ops + this device's archived matches for it -> what the UI shows. */
function overlayTournamentData(t, ops, localMatches, tournamentId){
  const live = ops.filter(o => !o.failed && o.args);
  let out = t ? JSON.parse(JSON.stringify(t)) : null;
  if (!out){
    const created = live.find(o => o.kind === "tournament.create" && o.args.id === tournamentId);
    if (!created) return null;
    const a = created.args;
    out = { id: a.id, name: a.name, organizer_club_id: a.clubId, tournament_preset: a.preset, matches: [], teams: [], teams_unavailable: false, pending: true };
  }
  out.teams = out.teams || []; out.matches = out.matches || [];
  live.filter(o => o.args.tournamentId === out.id).forEach(o => {
    const a = o.args;
    if (o.kind === "team.save"){
      const row = { id: a.id, name: a.name, players: a.players, pending: true };
      const i = out.teams.findIndex(x => x.id === a.id);
      if (i >= 0) out.teams[i] = row; else out.teams.push(row);
    } else if (o.kind === "team.delete"){
      out.teams = out.teams.filter(x => x.id !== a.id);
    }
  });
  (localMatches || []).filter(m => m && m.tournamentId === out.id && m.clubId).forEach(m => {
    if (!out.matches.some(x => (x.data && x.data.id) === m.id || x.id === m.id)){
      out.matches.push({ id: m.id, data: m, played_at: new Date(m.completedAt || Date.now()).toISOString(), local: true });
    }
  });
  return out;
}
/* One line per queued change, for the sync sheet. */
function describeOp(op){
  const a = op.args || {};
  switch (op.kind){
    case "match": return `Match: ${a.data ? `${a.data.teamA} v ${a.data.teamB}` : "result"}`;
    case "club.create": return `New club “${a.name}”`;
    case "tournament.create": return `New tournament “${a.name}”`;
    case "team.save": return `Team “${a.name}”`;
    case "team.delete": return `Delete team “${a.name || "team"}”`;
    case "preset.save": return `Preset “${(a.preset && a.preset.name) || "preset"}”`;
    case "preset.delete": return `Delete preset “${a.name || "preset"}”`;
    case "roster.add": return `Add ${a.name} to the club`;
    case "roster.addExisting": return `Add ${a.name || "player"} to the club`;
    case "roster.remove": return `Remove ${a.name || "player"} from the club`;
    case "global.add": return `Record visiting player ${a.name}`;
    default: return op.kind;
  }
}

let outbox = DB.load(OUTBOX_KEY) || [];         // [{ id, kind, args, userId, createdAt, attempts, failed, error }]
let cloudCache = DB.load(CLOUD_CACHE_KEY) || null; // { userId, profile, isAdmin, myClubs, clubs: {id: snapshot}, tournaments: {id: snapshot} }
let syncState = { running: false, lastSyncAt: null };
function saveOutbox(){ DB.save(OUTBOX_KEY, outbox); }
function saveCloudCache(){ DB.save(CLOUD_CACHE_KEY, cloudCache); }
function isOnline(){ return typeof navigator === "undefined" || navigator.onLine !== false; }

let supabaseClient = null; // set by initAuth() once supabase-js has loaded, if configured
let session = null;  // current Supabase auth session, or null when signed out / cloud unavailable
let profile = null;  // { id, display_name } row from `profiles` for the signed-in user
let isAdmin = false;  // whether the signed-in user has a row in `admin_users`

async function refreshProfileAndAdmin(){
  profile = null; isAdmin = false;
  if (!supabaseClient || !session) return;
  const cache = cacheFor();
  if (session.offline || !isOnline()){
    if (cache){ profile = cache.profile; isAdmin = !!cache.isAdmin; }
    return;
  }
  const [p, a] = await Promise.all([
    supabaseClient.from("profiles").select("id, display_name").eq("id", session.user.id).maybeSingle(),
    supabaseClient.from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle()
  ]);
  if (isNetworkError(p.error, isOnline())){
    if (cache){ profile = cache.profile; isAdmin = !!cache.isAdmin; }
    return;
  }
  profile = p.data || null;
  isAdmin = !!a.data;
  if (cache){ cache.profile = profile; cache.isAdmin = isAdmin; saveCloudCache(); }
}

/* The per-user read cache; a different (or no) signed-in user gets a fresh
   one, so one account's club data is never shown to another. */
function cacheFor(){
  const uid = session && session.user && session.user.id;
  if (!uid) return null;
  if (!cloudCache || cloudCache.userId !== uid){
    cloudCache = { userId: uid, profile: null, isAdmin: false, myClubs: null, clubs: {}, tournaments: {} };
  }
  return cloudCache;
}
function myOps(){
  const uid = session && session.user && session.user.id;
  return uid ? outbox.filter(o => o.userId === uid) : [];
}
function pendingCount(){ return myOps().filter(o => !o.failed).length; }
function failedCount(){ return myOps().filter(o => o.failed).length; }

/* The last session supabase-js stored, read straight from storage. Offline,
   an expired access token can't be refreshed, so getSession() comes back
   empty even though the user is signed in on this device -- this keeps them
   signed in (session.offline = true) until the network returns. Only the
   user object is used offline; no request is made with it. */
function storedOfflineSession(){
  try {
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    const raw = DB.rawBackend ? DB.rawBackend.getItem(`sb-${ref}-auth-token`) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    const s = parsed && (parsed.currentSession || parsed);
    return s && s.user && s.user.id ? { user: s.user, offline: true } : null;
  } catch (_){ return null; }
}

/* Everything that writes to the club's cloud data comes through here (see
   the "offline-first" note above). Returns { ok, queued?, ...result } or
   { error }. */
async function submitCloudOp(kind, args){
  if (!supabaseClient || !session) return { error: "Sign in to save this to the club." };
  const op = { id: newUuid(), kind, args, userId: session.user.id, createdAt: Date.now(), attempts: 0, failed: false, error: null };
  if (session.offline || !isOnline() || pendingCount() > 0){ enqueueOp(op); return { ok: true, queued: true }; }
  const res = await executeOp(op);
  if (res.network){ enqueueOp(op); return { ok: true, queued: true }; }
  if (!res.error) afterOpSucceeded(op, res);
  return res;
}
function enqueueOp(op){
  outbox = coalesceOp(outbox, op);
  saveOutbox();
  scheduleSync();
}
let syncTimer = null;
function scheduleSync(delay){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay == null ? 400 : delay);
}

/* Run one op against Supabase. { ok, ... } | { error } | { network: true }. */
async function executeOp(op){
  const run = OP_HANDLERS[op.kind];
  if (!run) return { error: `Unknown change type "${op.kind}".` };
  try {
    const res = await run(op.args, op);
    if (res && res.error && isNetworkError(res.error, isOnline())) return { network: true };
    if (res && res.error) return { error: typeof res.error === "string" ? res.error : res.error.message };
    return Object.assign({ ok: true }, res || {});
  } catch (err){
    return isNetworkError(err, isOnline()) || !err.code ? { network: true } : { error: err.message };
  }
}
const dupId = err => err && err.code === "23505" && /pkey/i.test(err.message || "");
const OP_HANDLERS = {
  "match": async (a, op) => {
    const { error } = await supabaseClient.from("matches").upsert({
      id: a.id, club_id: a.clubId, match_type: a.matchType || "practice", level: "local",
      opponent_name: a.opponentName || null, tournament_id: a.tournamentId || null,
      created_by: op.userId, data: a.data, played_at: a.playedAt
    });
    return { error };
  },
  "club.create": async (a, op) => {
    let { error } = await supabaseClient.from("clubs").insert({ id: a.id, name: a.name, created_by: op.userId });
    if (error && !dupId(error)) return { error };
    ({ error } = await supabaseClient.from("club_members").insert({ club_id: a.id, user_id: op.userId, role: "owner" }));
    return { error: error && error.code !== "23505" ? error : null };
  },
  "tournament.create": async (a, op) => {
    const { error } = await supabaseClient.from("tournaments").insert({ id: a.id, name: a.name, organizer_club_id: a.clubId, tournament_preset: a.preset, created_by: op.userId });
    return { error: error && !dupId(error) ? error : null };
  },
  "team.save": async (a, op) => {
    const waiting = (a.players || []).find(p => String(p.id).startsWith(TEMP_ID_PREFIX));
    if (waiting) return { error: `Waiting for ${waiting.name} to be added to the club first.` };
    const row = { name: a.name, players: a.players };
    const insert = () => supabaseClient.from("tournament_teams").insert({ ...row, id: a.id, tournament_id: a.tournamentId, club_id: a.clubId, created_by: op.userId });
    const update = () => supabaseClient.from("tournament_teams").update(row).eq("id", a.id).eq("tournament_id", a.tournamentId).select("id");
    let error, data;
    if (a.isNew){
      ({ error } = await insert());
      if (dupId(error)) ({ error } = await update());
    } else {
      // An update that matches no row (its create never made it) becomes an insert.
      ({ data, error } = await update());
      if (!error && data && !data.length) ({ error } = await insert());
    }
    if (error && error.code === "23505") return { error: "This tournament already has a team with that name." };
    return { error: error ? (cloudTableMissing(error, "012_tournament_teams.sql") || error) : null };
  },
  "team.delete": async a => {
    const { error } = await supabaseClient.from("tournament_teams").delete().eq("id", a.id).eq("tournament_id", a.tournamentId);
    return { error: error ? (cloudTableMissing(error, "012_tournament_teams.sql") || error) : null };
  },
  "preset.save": async a => {
    const insert = () => supabaseClient.from("club_presets").insert({ id: a.id, club_id: a.clubId, kind: a.kind, preset: a.preset });
    const update = () => supabaseClient.from("club_presets").update({ preset: a.preset }).eq("id", a.id).eq("club_id", a.clubId).select("id");
    let error, data;
    if (a.isNew){
      ({ error } = await insert());
      if (dupId(error)) ({ error } = await update());
    } else {
      ({ data, error } = await update());
      if (!error && data && !data.length) ({ error } = await insert());
    }
    return { error };
  },
  "preset.delete": async a => {
    const { error } = await supabaseClient.from("club_presets").delete().eq("id", a.id).eq("club_id", a.clubId);
    return { error };
  },
  "roster.add": async a => {
    const { data, error } = await supabaseClient.rpc("add_player_to_club", { _club_id: a.clubId, _name: a.name.trim() });
    if (error) return { error: cloudSqlMissing(error, "supabase/005_add_player_to_club.sql") ? { message: cloudSqlMissing(error, "supabase/005_add_player_to_club.sql"), code: error.code } : error };
    // Before 009 the RPC returned a bare uuid (and the caller always owned the row).
    const id = data && typeof data === "object" ? data.id : data;
    const created = data && typeof data === "object" ? !!data.created : true;
    if (created && a.phone !== undefined && (a.phone || a.nic)){
      const r = await updatePlayerProfile(id, a.phone, a.nic);
      if (r && r.error) return { id, created, partial: `Added, but couldn't save the contact details: ${r.error}` };
    }
    if (created && a.details && playerHasDetails(a.details)){
      const r = await updatePlayerDetails(id, a.details);
      if (r && r.error) return { id, created, partial: `Added, but couldn't save the other details: ${r.error}` };
    }
    return { id, created };
  },
  "roster.addExisting": async a => {
    const { error } = await supabaseClient.from("club_rosters").insert({ club_id: a.clubId, player_id: a.playerId });
    return { error: error && error.code === "23505" ? null : error };
  },
  "roster.remove": async a => {
    const { data, error } = await supabaseClient.from("club_rosters").delete().eq("club_id", a.clubId).eq("player_id", a.playerId).select("player_id");
    if (error) return { error };
    // RLS turns a non-member's delete into "0 rows", not an error. Already
    // gone (e.g. removed on another device) counts as done too.
    return data && data.length ? {} : (a.mustExist ? { error: "Couldn't remove this player — only this club's admins can." } : {});
  },
  "global.add": async a => {
    let { error } = await supabaseClient.rpc("ensure_global_player", { _name: a.name.trim(), _club_id: a.clubId || null });
    if (error && error.code === "PGRST202") ({ error } = await supabaseClient.rpc("ensure_global_player", { _name: a.name.trim() }));
    return { error };
  }
};
/* A roster add that was queued offline got a temp id; once the server hands
   back the real one, rewrite every reference (later queued ops, caches,
   the open team editor) so nothing ever stores the temp id in the cloud. */
function afterOpSucceeded(op, res){
  if (op.kind === "roster.add" && op.args.tempId && res.id) remapTempId(op.args.tempId, res.id);
}
function remapTempId(from, to){
  // In place (not a new array): syncNow may be part-way through the queue.
  outbox.forEach(o => { o.args = replaceIdDeep(o.args, from, to); }); saveOutbox();
  if (cloudCache){ cloudCache = replaceIdDeep(cloudCache, from, to); saveCloudCache(); }
  if (ui.club) ui.club = replaceIdDeep(ui.club, from, to);
  if (ui.clubTournament) ui.clubTournament = replaceIdDeep(ui.clubTournament, from, to);
  if (ui.tournamentTeamEdit) ui.tournamentTeamEdit = replaceIdDeep(ui.tournamentTeamEdit, from, to);
}

/* Replay this user's queue in order. Stops at the first network failure (it
   will be retried); a real database error marks that op failed and moves on
   -- failed ops wait in the sync sheet for Retry or Discard. */
let lastSessionUpgrade = 0;
async function syncNow(){
  // Online again but still on the stored offline user: get a real session
  // first (throttled, so a failing refresh can't spin).
  if (session && session.offline && isOnline() && Date.now() - lastSessionUpgrade > 30000){
    lastSessionUpgrade = Date.now();
    handleBackOnline();
    return;
  }
  if (syncState.running || !supabaseClient || !session || session.offline || !isOnline()) return;
  const due = () => myOps().filter(o => !o.failed);
  if (!due().length) return;
  syncState.running = true; render();
  let changed = false, stalled = false;
  const tried = new Set();
  // Re-read the queue each step: a success can rewrite later ops (temp ids),
  // and new ops can be queued while this runs.
  for (let op = due()[0]; op && !tried.has(op.id); op = due().find(o => !tried.has(o.id))){
    tried.add(op.id);
    const res = await executeOp(op);
    if (res.network){ stalled = true; break; }
    op.attempts++;
    if (res.error){ op.failed = true; op.error = res.error; }
    else { afterOpSucceeded(op, res); outbox = outbox.filter(o => o.id !== op.id); changed = true; }
    saveOutbox();
  }
  syncState.running = false; syncState.lastSyncAt = Date.now();
  if (!stalled && due().some(o => !tried.has(o.id))) scheduleSync(0);    // more were queued while this ran
  if (changed) await refreshAfterSync();
  render();
}
/* Re-read whatever club data is on screen, now that the server has it. */
async function refreshAfterSync(){
  const jobs = [];
  if (ui.myClubs) jobs.push(fetchMyClubs());
  if (ui.club) jobs.push(fetchClubDetail(ui.club.id));
  if (ui.clubTournament) jobs.push(fetchClubTournamentDetail(ui.clubTournament.id));
  await Promise.all(jobs.map(j => j.catch(() => {})));
}
function retryFailedOps(ids){
  outbox.forEach(o => { if (ids.includes(o.id)){ o.failed = false; o.error = null; } });
  saveOutbox(); scheduleSync(0); render();
}
function discardOp(id){
  outbox = outbox.filter(o => o.id !== id); saveOutbox();
  refreshAfterSync().then(render);
}

async function initAuth(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return; // cloud not configured on this deployment
  let lib;
  // supabase-js comes from the service worker's cache when offline (sw.js);
  // without it (first ever visit offline) stay in guest mode.
  try { lib = await loadSupabaseLib(); } catch (_){ return; }
  supabaseClient = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: makeCloudAuthStorage(), persistSession: true, autoRefreshToken: true },
    // Every Supabase request (data, RPC, auth) goes through trackedFetch, so
    // the loading indicators know when the network is busy -- see "activity".
    global: { fetch: trackedFetch }
  });
  // Offline, getSession() can sit retrying a token refresh for a long time,
  // so don't wait on it: use the stored user straight away (session.offline)
  // and let the real session replace it once the network is back.
  const stored = storedOfflineSession();
  let real = null;
  if (isOnline() || !stored){
    real = await Promise.race([
      supabaseClient.auth.getSession().then(r => (r && r.data && r.data.session) || null).catch(() => null),
      new Promise(res => setTimeout(() => res(undefined), 2500))
    ]);
  }
  session = real || (real === null && isOnline() ? null : stored);
  await refreshProfileAndAdmin();
  render();
  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    // Offline, a failed token refresh isn't a sign-out: keep the stored user.
    if (!newSession && event !== "SIGNED_OUT" && session && session.offline) return;
    session = newSession;
    refreshProfileAndAdmin().then(() => { render(); scheduleSync(); });
  });
  scheduleSync(0);
}

/* Back online: swap an offline session for a real (refreshed) one, then sync. */
async function handleBackOnline(){
  if (supabaseClient && session && session.offline){
    lastSessionUpgrade = Date.now();
    try {
      const real = await Promise.race([
        supabaseClient.auth.getSession().then(r => (r && r.data && r.data.session) || null),
        new Promise(res => setTimeout(() => res(undefined), 8000))
      ]);
      if (real){ session = real; await refreshProfileAndAdmin(); }
    } catch (_){}
  }
  render();
  if (!(session && session.offline)) scheduleSync(0);
}

async function handleSignOut(){
  if (!supabaseClient) return;
  const n = pendingCount() + failedCount();
  if (n){
    askConfirm({
      title: "Sign out with unsynced changes?", icon: "☁",
      body: `<p>${n} change${n === 1 ? " hasn't" : "s haven't"} reached the cloud yet. ${n === 1 ? "It stays" : "They stay"} on this device and sync${n === 1 ? "s" : ""} the next time you sign in to this account here.</p>`,
      confirmLabel: "Sign out anyway", tone: "primary",
      onConfirm: () => doSignOut()
    });
    return;
  }
  doSignOut();
}
async function doSignOut(){
  // Local first: supabase-js' own sign-out can wait behind a stuck token
  // refresh offline, and the device must be cleared regardless.
  const client = supabaseClient;
  session = null; profile = null; isAdmin = false;
  // The read cache holds members-only club data (rosters, teams) -- never
  // leave it for whoever uses this device next. Queued changes stay, tagged
  // with their user, until that user signs in again.
  cloudCache = null; DB.clear(CLOUD_CACHE_KEY);
  state.view = "home";
  state.activeClubId = null; state.viewClubId = null; state.viewTournamentId = null;
  ui.identity = null; ui.premier = null;
  ui.myClubs = null; ui.club = null; ui.currentClubId = null; // don't leak the previous account's clubs to whoever signs in next
  save(); render();
  try {
    // scope "local" never needs the network; online, also revoke the refresh token.
    await client.auth.signOut(isOnline() ? undefined : { scope: "local" });
  } catch (_){}
  if (!isOnline()){ try { const ref = new URL(SUPABASE_URL).hostname.split(".")[0]; DB.rawBackend && DB.rawBackend.removeItem(`sb-${ref}-auth-token`); } catch (_){} }
}

/* --- clubs (Milestone 2): a signed-in user's clubs, roster, and synced
   matches. Players are global (see supabase/002_clubs.sql) -- a club's
   "roster" is just a club_rosters join, not a copy of the player. There
   is deliberately no synced "team" entity for a club's own matches; see
   CLAUDE.md's "Cloud accounts & Supabase" section. ------------------- */

async function fetchMyClubs(){
  if (!supabaseClient || !session) { ui.myClubs = []; return; }
  const cache = cacheFor();
  let list = null;
  if (!session.offline && isOnline()){
    const { data, error } = await supabaseClient.from("club_members").select("role, clubs(id, name)").eq("user_id", session.user.id);
    if (!error){ list = data.map(r => ({ id: r.clubs.id, name: r.clubs.name, role: r.role })); cache.myClubs = list; saveCloudCache(); }
    else if (!isNetworkError(error, isOnline())) list = [];
  }
  if (!list) list = (cache && cache.myClubs) || [];
  // Clubs created offline show up straight away.
  myOps().filter(o => o.kind === "club.create" && !o.failed && !list.some(c => c.id === o.args.id))
    .forEach(o => list = [...list, { id: o.args.id, name: o.args.name, role: "owner", pending: true }]);
  ui.myClubs = list;
}

async function createClub(name){
  if (!supabaseClient || !session) return null;
  const id = newUuid();
  const res = await submitCloudOp("club.create", { id, name });
  if (res.error) return { error: res.error };
  return { club: { id, name }, queued: !!res.queued };
}

/* Members, then their display names in a second query: PostgREST can't embed
   profiles_public in club_members (both only reference auth.users, and a view
   carries no FK), so "club_members?select=...,profiles_public(...)" is a 400. */
async function fetchClubMembers(clubId){
  const { data: rows, error } = await supabaseClient.from("club_members").select("user_id, role").eq("club_id", clubId);
  if (error || !rows) return { data: [] };
  const ids = rows.map(r => r.user_id);
  const { data: names } = ids.length
    ? await supabaseClient.from("profiles_public").select("id, display_name").in("id", ids)
    : { data: [] };
  const byId = new Map((names || []).map(n => [n.id, n.display_name]));
  return { data: rows.map(r => ({ userId: r.user_id, role: r.role, displayName: byId.get(r.user_id) || "—" })) };
}

async function fetchClubDetail(clubId){
  ui.clubBusy = true;
  const cache = cacheFor();
  let server = null;
  if (supabaseClient && session && !session.offline && isOnline()){
    try { server = await fetchClubDetailFromServer(clubId); } catch (_){ server = null; }
  }
  if (server && cache){
    // Cache a trimmed copy (recent matches only) -- it's a separate storage
    // key, so running out of space here can never cost the scorer's state.
    cache.clubs[clubId] = Object.assign({}, server, { matches: server.matches.slice(0, 30) });
    saveCloudCache();
  }
  const base = server || (cache && cache.clubs[clubId]) || { id: clubId, name: (ui.myClubs || []).find(c => c.id === clubId)?.name || "", members: [], roster: [], matches: [], tournaments: [], presets: { match: [], tournament: [] } };
  ui.club = Object.assign(overlayClubData(base, myOps()), { fromCache: !server });
  ui.clubBusy = false;
}
async function fetchClubDetailFromServer(clubId){
  const [clubRes, members, rosterRes, matchesRes, tournamentsRes, presetsRes] = await Promise.all([
    supabaseClient.from("clubs").select("id, name").eq("id", clubId).single(),
    fetchClubMembers(clubId),
    fetchRosterRows(clubId),
    supabaseClient.from("matches").select("id, match_type, data, played_at").eq("club_id", clubId).order("played_at", { ascending: false }).limit(50),
    supabaseClient.from("tournaments").select("id, name, created_at").eq("organizer_club_id", clubId).order("created_at", { ascending: false }),
    supabaseClient.from("club_presets").select("id, kind, preset").eq("club_id", clubId).order("created_at")
  ]);
  if ([clubRes, rosterRes, matchesRes].some(r => isNetworkError(r.error, isOnline()))) return null;
  const presetRows = presetsRes.data || [];
  return {
    id: clubId,
    name: clubRes.data ? clubRes.data.name : "",
    members: (members && members.data) || [],
    roster: (rosterRes.data || []).map(r => r.players_public).filter(Boolean),
    matches: matchesRes.data || [],
    tournaments: tournamentsRes.data || [],
    // This club's own presets (club_presets), same shape as the guest ones
    // plus the row id -- never mixed with state.matchPresets/tournamentPresets.
    presets: {
      match: presetRows.filter(r => r.kind === "match").map(r => Object.assign({}, r.preset, { id: r.id })),
      tournament: presetRows.filter(r => r.kind === "tournament").map(r => Object.assign({}, r.preset, { id: r.id }))
    }
  };
}

async function createClubTournament(clubId, name, tournamentPreset){
  if (!supabaseClient || !session) return null;
  const id = newUuid();
  const res = await submitCloudOp("tournament.create", { id, clubId, name, preset: tournamentPreset });
  if (res.error) return { error: res.error };
  return { tournament: { id, name, organizer_club_id: clubId, tournament_preset: tournamentPreset }, queued: !!res.queued };
}

async function fetchClubTournamentDetail(tournamentId){
  const cache = cacheFor();
  let server;   // undefined = couldn't ask; null = asked, not there (yet)
  if (supabaseClient && session && !session.offline && isOnline()){
    try {
      const [{ data: tournament, error: tErr }, { data: matches }, { data: teams, error: teamsError }] = await Promise.all([
        supabaseClient.from("tournaments").select("id, name, organizer_club_id, tournament_preset").eq("id", tournamentId).maybeSingle(),
        supabaseClient.from("matches").select("id, data, played_at").eq("tournament_id", tournamentId).order("played_at", { ascending: false }),
        supabaseClient.from("tournament_teams").select("id, name, players").eq("tournament_id", tournamentId).order("created_at")
      ]);
      if (!isNetworkError(tErr, isOnline())){
        // teams_unavailable: 012 hasn't been run -- the dashboard says so instead
        // of breaking, and match setup falls back to typed team names.
        server = tournament ? { ...tournament, matches: matches || [], teams: teamsError ? [] : (teams || []), teams_unavailable: !!teamsError } : null;
      }
    } catch (_){ server = undefined; }
  }
  if (server && cache){ cache.tournaments[tournamentId] = server; saveCloudCache(); }
  const base = server !== undefined ? server : (cache && cache.tournaments[tournamentId]) || null;
  ui.clubTournament = overlayTournamentData(base, myOps(), Object.values(state.matchHistory), tournamentId);
  if (ui.clubTournament) ui.clubTournament.fromCache = server === undefined;
}

/* Tournament teams (supabase/012): a name + roster players, members-only.
   `players` is [{ id, name }] -- the name is a snapshot, see the SQL. */
async function saveTournamentTeam(tournament, team){
  const res = await submitCloudOp("team.save", {
    id: team.id || newUuid(), isNew: !team.id, tournamentId: tournament.id, clubId: tournament.organizer_club_id,
    name: team.name, players: team.players
  });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}
async function deleteTournamentTeam(tournamentId, teamId){
  const team = ui.clubTournament && ui.clubTournament.teams.find(t => t.id === teamId);
  const res = await submitCloudOp("team.delete", { id: teamId, tournamentId, name: team ? team.name : "" });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}
function cloudTableMissing(error, file){
  return error && (error.code === "42P01" || error.code === "PGRST205")
    ? `Cloud database is missing ${file} — run it in the Supabase SQL editor.` : null;
}

/* Club presets live in the cloud (club_presets, members-only via RLS) --
   the club's own, separate from the on-device guest presets. */
async function saveClubPreset(clubId, kind, preset){
  const { id, pending, ...body } = preset;
  const res = await submitCloudOp("preset.save", { id: id || newUuid(), isNew: !id, clubId, kind, preset: body });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}
async function deleteClubPreset(clubId, id){
  const pr = ["match", "tournament"].map(k => clubPresetList(k, clubId)).flat().find(p => p.id === id);
  const res = await submitCloudOp("preset.delete", { id, clubId, name: pr ? pr.name : "" });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}

/* One server-side step (supabase/009, superseding 005): find the player in
   the global players table by name (or a merge alias), create them there if
   they're not (so they show up in Premier too, with this club recorded as
   the one that added them), then add the roster row. Returns
   { id, created }. Only when `created` is true does this club get to edit the
   profile -- an already-existing player just joins the roster, and can only
   be edited by the club that first added them (until claimed) or by
   themselves. Done as an RPC because the base players table isn't readable
   by ordinary users. */
function cloudSqlMissing(error, file){
  return error && (error.code === "PGRST202" || error.code === "42883")
    ? `Cloud database is missing ${file} — run it in the Supabase SQL editor.` : null;
}
async function addPlayerToClub(clubId, name, extras){
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  const phone = extras && extras.phone, nic = extras && extras.nic;
  // Contact number and NIC are personal data: they're only ever sent
  // straight to the database, never kept in the on-device queue.
  if ((phone || nic) && (session && session.offline || !isOnline() || pendingCount() > 0)){
    return { error: "Contact number and NIC need an internet connection. Clear them to add the player offline, and fill them in later from the profile." };
  }
  const tempId = TEMP_ID_PREFIX + newUuid();
  const args = { clubId, name: trimmed, tempId, details: extras && extras.details ? extras.details : null };
  if (phone || nic) Object.assign(args, { phone: phone || "", nic: nic || "" });
  const res = await submitCloudOp("roster.add", args);
  if (res.error) return { error: res.error };
  if (res.queued){
    // Already queued for this name? Reuse that op's temp id.
    const prev = outbox.find(o => o.kind === "roster.add" && !o.failed && o.args.clubId === clubId && o.args.name.toLowerCase() === trimmed.toLowerCase());
    return { ok: true, queued: true, id: prev ? prev.args.tempId : tempId };
  }
  if (res.partial) return { error: res.partial, id: res.id, created: res.created };
  return { ok: true, id: res.id, created: res.created };
}
function playerHasDetails(d){
  return !!(d.batting_hand || d.bowling_arm || d.bowling_type || d.is_keeper || d.city || d.photo || d.nickname || parseJerseyNo(d.jersey_no) != null);
}

/* Players already on the platform whose name contains `query` -- public
   columns only (players_public; never phone/NIC). Used by the add-player
   sheet to offer "add the existing player" instead of creating a new one. */
async function searchPlatformPlayers(query){
  if (needsInternet()) return [];
  const pattern = `%${escapeLike(query.trim())}%`;
  const full = await supabaseClient.from("players_public").select(`id, name, city, photo, ${PLAYER_KIT_COLS}`).ilike("name", pattern).order("name").limit(8);
  if (!full.error) return full.data || [];
  const { data } = await supabaseClient.from("players_public").select("id, name").ilike("name", pattern).order("name").limit(8);
  return data || [];
}
/* Add one specific existing player (by id -- names aren't unique) to the
   roster. A plain insert: 002's "members manage" policy allows it, and it
   never creates a player or grants edit rights (origin_club_id is untouched). */
async function addExistingPlayerToClub(clubId, playerId, name){
  const res = await submitCloudOp("roster.addExisting", { clubId, playerId, name: name || "" });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}

/* Take a player off this club's roster (club_rosters delete; any club member
   may, per 002's "members remove" policy -- every member is an owner/admin).
   The global player, their profile and every past match (which store names)
   are untouched, so stats stay and they can be re-added later. RLS turns a
   non-member's delete into "0 rows", not an error, hence the row check. */
async function removePlayerFromClub(clubId, playerId){
  const p = ui.club && ui.club.roster.find(x => x.id === playerId);
  // A player added offline and never synced: just drop the queued add.
  if (String(playerId).startsWith(TEMP_ID_PREFIX)){
    outbox = outbox.filter(o => !(o.kind === "roster.add" && o.args.tempId === playerId)); saveOutbox();
    return { ok: true };
  }
  const res = await submitCloudOp("roster.remove", { clubId, playerId, name: p ? p.name : "", mustExist: true });
  return res.error ? { error: res.error } : { ok: true, queued: !!res.queued };
}

/* --- player profiles (supabase/007_player_profiles.sql). Name and stats are
   public; the database only returns contact number / NIC to the player,
   admins, and members of a club that has them on its roster (everyone else
   gets nulls and can_see_contact = false). Signed-out visitors (Premier is
   browsable without an account) just get the public row. --- */
function profileSqlMissing(error){
  return cloudSqlMissing(error, "supabase/007_player_profiles.sql") || (error && error.message) || "Something went wrong";
}
/* Public details (batting/bowling/keeper/city/photo) come from players_public;
   they only exist once supabase/008 has been run, so a failed select there
   just means "details unavailable", not a failed profile. */
const PLAYER_DETAIL_COLS = "batting_hand, bowling_arm, bowling_type, is_keeper, city, photo";
const PLAYER_KIT_COLS = "nickname, jersey_no";   // supabase/010
async function fetchPlayerDetails(playerId){
  // Try with 010's columns first; without 010 that select fails, so fall
  // back to 008's and flag nickname/jersey as unavailable.
  const full = await supabaseClient.from("players_public").select(`${PLAYER_DETAIL_COLS}, ${PLAYER_KIT_COLS}`).eq("id", playerId).single();
  if (!full.error && full.data) return Object.assign({ details_unavailable: false, kit_unavailable: false }, full.data);
  const { data, error } = await supabaseClient.from("players_public").select(PLAYER_DETAIL_COLS).eq("id", playerId).single();
  return error || !data ? { details_unavailable: true, kit_unavailable: true } : Object.assign({ details_unavailable: false, kit_unavailable: true }, data);
}
/* Same 010 fallback for the roster list, so it still loads before 010 is run. */
async function fetchRosterRows(clubId){
  const full = await supabaseClient.from("club_rosters").select(`player_id, players_public(id, name, ${PLAYER_KIT_COLS})`).eq("club_id", clubId);
  return full.error ? supabaseClient.from("club_rosters").select("player_id, players_public(id, name)").eq("club_id", clubId) : full;
}
async function fetchPlayerProfile(playerId){
  if (!supabaseClient) return { error: "Cloud isn't configured on this deployment." };
  const offline = needsInternet(); if (offline) return { error: "You're offline. Player profiles need an internet connection." };
  if (!session){
    const { data } = await supabaseClient.from("players_public").select("id, name, claimed_by").eq("id", playerId).single();
    if (!data) return { error: "Player not found." };
    return { data: Object.assign({}, data, { phone: null, nic: null, can_see_contact: false }, await fetchPlayerDetails(playerId)) };
  }
  const { data, error } = await supabaseClient.rpc("get_player_profile", { _player_id: playerId });
  if (error) return { error: profileSqlMissing(error) };
  if (!data || !data[0]) return { error: "Player not found." };
  return { data: Object.assign({}, data[0], await fetchPlayerDetails(playerId)) };
}

/* Club matches for a Premier-opened profile: matches are publicly readable,
   but there is no way to ask "which clubs does this player belong to" (club
   rosters are members-only), so the club side of the stats comes from the
   clubs the *viewer* belongs to -- cloud matches merged by id with the
   local archive of those clubs' matches. */
async function fetchViewerClubMatches(){
  if (!supabaseClient || !session) return [];
  if (!ui.myClubs) await fetchMyClubs();
  const ids = (ui.myClubs || []).map(c => c.id);
  if (!ids.length) return [];
  const { data } = await supabaseClient.from("matches").select("id, data").eq("level", "local").in("club_id", ids);
  const byId = new Map();
  Object.values(state.matchHistory).filter(m => m.clubId && ids.includes(m.clubId)).forEach(m => byId.set(m.id, m));
  (data || []).forEach(r => { if (r.data) byId.set(r.data.id || r.id, r.data); });
  return [...byId.values()];
}
async function updatePlayerDetails(playerId, d){
  const offline = needsInternet(); if (offline) return offline;
  const { error } = await supabaseClient.rpc("update_player_details", {
    _player_id: playerId, _batting_hand: d.batting_hand || "", _bowling_arm: d.bowling_arm || "", _bowling_type: d.bowling_type || "",
    _is_keeper: !!d.is_keeper, _city: d.city || "", _photo: d.photo || ""
  });
  if (error) return { error: error.code === "PGRST202" || error.code === "42883"
    ? "Cloud database is missing supabase/008_player_details.sql — run it in the Supabase SQL editor." : error.message };
  // Nickname + jersey no are a separate RPC (supabase/010). Without 010 a
  // blank nickname/jersey is fine -- only complain if one was actually typed.
  const nickname = (d.nickname || "").trim(), jersey = parseJerseyNo(d.jersey_no);
  const kit = await supabaseClient.rpc("update_player_nickname_jersey", { _player_id: playerId, _nickname: nickname, _jersey_no: jersey });
  if (!kit.error) return { ok: true };
  const missing = cloudSqlMissing(kit.error, "supabase/010_player_nickname_jersey.sql");
  if (missing && !nickname && jersey == null) return { ok: true };
  return { error: missing || kit.error.message };
}
/* Rename (supabase/013): same manage rule as the other profile edits. The
   old name becomes an alias, so past matches -- stored by name -- still
   count on the profile and a typed old name still finds this player. */
async function renamePlayer(playerId, name){
  const offline = needsInternet(); if (offline) return offline;
  const { data, error } = await supabaseClient.rpc("rename_player", { _player_id: playerId, _name: name });
  if (error){
    const missing = cloudSqlMissing(error, "supabase/013_rename_player.sql");
    const msg = missing || error.message || "Couldn't rename.";
    return { error: msg.charAt(0).toUpperCase() + msg.slice(1) + (missing || /[.!?]$/.test(msg) ? "" : ".") };
  }
  return { ok: true, name: data || name };
}
async function updatePlayerProfile(playerId, phone, nic){
  const offline = needsInternet(); if (offline) return offline;
  const { error } = await supabaseClient.rpc("update_player_profile", { _player_id: playerId, _phone: phone || "", _nic: nic || "" });
  return error ? { error: profileSqlMissing(error) } : { ok: true };
}

/* Global-only sibling of addPlayerToClub (supabase/006): for a friendly's
   visitors, who aren't on the home club's roster. The club is passed so a
   brand-new visitor is attributed to the club that first recorded them (and
   that club can edit the profile until the player claims it). */
async function addGlobalPlayer(name, clubId){
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  const res = await submitCloudOp("global.add", { name: trimmed, clubId: clubId || null });
  return res.error ? { error: res.error } : { ok: true };
}

/* The few cloud actions that can't work offline (they need the server to
   look something up or check a rule there and then). */
function needsInternet(){
  return !isOnline() || (session && session.offline) ? { error: "You're offline. This needs an internet connection — try again when you're back online." } : null;
}
async function inviteClubAdmin(clubId, email){
  const offline = needsInternet(); if (offline) return offline;
  const { data, error } = await supabaseClient.rpc("invite_club_admin", { _club_id: clubId, _email: email });
  if (error) return { error: error.message };
  return { result: data }; // "ok" | "not_found" | "already_member"
}

async function syncMatchToCloud(match, archived){
  if (!supabaseClient || !session || !match.clubId) return;
  await submitCloudOp("match", {
    id: archived.id, clubId: match.clubId, matchType: match.matchType || "practice",
    opponentName: match.opponentName || null, tournamentId: match.tournamentId || null,
    // squads are the saved tournament teams (members-only, supabase/012);
    // matches are publicly readable, so they stay on this device.
    data: Object.assign({}, archived, { squads: undefined }),
    playedAt: new Date(archived.completedAt).toISOString()
  });
}

/* --- Premier: a cross-club, public players/stats/(eventually teams)
   browse screen, and player claiming ("this is me"). Claiming works
   today even though Premier tournaments (organizing, multi-club) don't
   exist yet -- players are already global (Milestone 2), so there's a
   real identity to claim regardless. Approval is admin-only, enforced
   server-side by the approve_claim/reject_claim RPCs (see
   supabase/004_premier_claims.sql), never by the isAdmin flag alone. */
async function fetchPremierData(){
  if (!supabaseClient){ ui.premier = { players: [], premierMatches: [], pendingClaims: [], pendingMerges: [] }; return; }
  const [{ data: players }, { data: premierMatches }, pendingClaims, pendingMerges] = await Promise.all([
    supabaseClient.from("players_public").select("id, name, claimed_by").order("name"),
    supabaseClient.from("matches").select("id, data").eq("level", "premier"),
    isAdmin
      ? supabaseClient.from("claim_requests").select("id, player_id, requested_by, claimed_phone, note, created_at").eq("status", "pending")
      : Promise.resolve({ data: [] }),
    // Errors (e.g. supabase/009 not run yet) just mean "no merge requests".
    isAdmin
      ? supabaseClient.from("merge_requests").select("id, from_player_id, into_player_id, requested_by, note, created_at").eq("status", "pending")
      : Promise.resolve({ data: [] })
  ]);
  ui.premier = {
    players: players || [],
    premierMatches: premierMatches || [],
    pendingClaims: (pendingClaims && pendingClaims.data) || [],
    pendingMerges: (pendingMerges && pendingMerges.data) || []
  };
}

/* Who the signed-in viewer already is: the one profile they've claimed (at
   most one -- enforced by a unique index), and any request of theirs still
   waiting for admin approval. Drives whether a profile offers "This is me"
   (no claim yet), "Request merge" (already have one) or neither. */
async function fetchMyPlayerIdentity(){
  if (!supabaseClient || !session){ ui.identity = null; return; }
  const uid = session.user.id;
  const [mine, claim, merges] = await Promise.all([
    supabaseClient.from("players").select("id, name").eq("claimed_by", uid).limit(1),
    supabaseClient.from("claim_requests").select("id, player_id").eq("requested_by", uid).eq("status", "pending").limit(1),
    supabaseClient.from("merge_requests").select("id, from_player_id").eq("requested_by", uid).eq("status", "pending")
  ]);
  ui.identity = {
    myPlayer: (mine.data && mine.data[0]) || null,
    pendingClaim: (claim.data && claim.data[0]) || null,
    pendingMerges: merges.data || []
  };
}

async function fetchPlayerAliases(playerId){
  const { data, error } = await supabaseClient.from("player_aliases").select("alias").eq("player_id", playerId);
  return error || !data ? [] : data.map(r => r.alias);
}

const CLAIM_SQL_MISSING = "supabase/009_ownership_claims_merges.sql";
async function ownershipRpc(fn, args){
  const offline = needsInternet(); if (offline) return offline;
  const { error } = await supabaseClient.rpc(fn, args);
  return error ? { error: cloudSqlMissing(error, CLAIM_SQL_MISSING) || error.message } : { ok: true };
}
const requestClaim = (playerId, phone, note) => ownershipRpc("request_claim", { _player_id: playerId, _phone: phone || null, _note: note || null });
const requestMerge = (fromPlayerId, note) => ownershipRpc("request_merge", { _from_player_id: fromPlayerId, _note: note || null });
const approveClaimRequest = requestId => ownershipRpc("approve_claim", { _request_id: requestId });
const rejectClaimRequest = requestId => ownershipRpc("reject_claim", { _request_id: requestId });
const approveMergeRequest = requestId => ownershipRpc("approve_merge", { _request_id: requestId });
const rejectMergeRequest = requestId => ownershipRpc("reject_merge", { _request_id: requestId });
