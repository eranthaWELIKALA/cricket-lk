/* Cricket.lk — screens: CSV downloads and the guest backup (save / restore).
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */

/* --- saving a file ---
   An <a download> of a blob, the way Save image works. (In the Android
   app, mobile/web/native-bridge.js hands a file that isn't an image to the
   share sheet: Drive, Files, WhatsApp.) */
function downloadTextFile(name, text, type){
  const blob = new Blob([text], { type: type || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function fileStamp(ts){
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fileSlug(s){ return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "stats"; }

/* --- CSV ---
   A cell that starts with = + - @ (or a tab / carriage return) is read as a
   formula by Excel and Sheets, and names are typed by anyone: such a cell
   gets a leading ' so it stays text (CSV injection). Numbers stay numbers. */
function csvCell(v){
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows){ return rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n"; }
const stripTags = s => String(s == null ? "" : s).replace(/<[^>]*>/g, "");
// One leaderboard table, as sorted on screen, every column it shows.
function leaderboardCsv(table, totals){
  const cols = LEADERBOARD_COLUMNS[table];
  const rows = sortLeaderboard(totals.filter(LEADERBOARD_ROWS[table] || (() => true)), table, leaderboardSort(table));
  return toCsv([cols.map(c => c.title), ...rows.map(t => cols.map(c => {
    if (c.key === "name") return t.name;
    const v = c.text ? stripTags(c.text(t)) : c.value(t);
    return v === "—" ? "" : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }))]);
}
// Every match, newest first: when, the teams, each innings' score, the result and player of the match.
function matchesCsv(matches){
  const list = [...matches].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const inn = (m, i) => { const x = m.innings[i]; return x ? `${x.runs}-${x.wickets}${x.legalBalls != null ? ` (${oversDisplay(x.legalBalls, x.ballsPerOver || 6)})` : ""}` : ""; };
  return toCsv([["Date", "Team batting first", "Score", "Team batting second", "Score", "Result", "Player of the match"],
    ...list.map(m => [m.completedAt ? fileStamp(statsDayOf(m.completedAt)) : "", m.innings[0] ? teamName(m, m.innings[0].battingTeam) : m.teamA, inn(m, 0),
      m.innings[1] ? teamName(m, m.innings[1].battingTeam) : m.innings[0] ? teamName(m, m.innings[0].bowlingTeam) : m.teamB, inn(m, 1), m.result || "", m.motm || ""])]);
}
function askExportCsv(table){
  const sc = lbCsvScope;
  if (!sc || !LEADERBOARD_COLUMNS[table]) return;
  const players = sc.totals.filter(LEADERBOARD_ROWS[table] || (() => true)).length;
  askConfirm({
    title: "Download a CSV file", icon: "⬇", tone: "primary",
    body: `<p>For a spreadsheet: <b>${escapeHtml(sc.title)}</b>.</p>`,
    choices: [
      { value: "table", label: `${LEADERBOARD_TITLES[table]} table`, sub: plural(players, "player") },
      ...(sc.matches.length ? [{ value: "matches", label: "Every match", sub: plural(sc.matches.length, "match", "matches") }] : [])
    ],
    choice: "table", confirmLabel: "Download",
    onConfirm: choice => {
      const base = `cricket-lk-${fileSlug(sc.title)}`;
      if (choice === "matches") downloadTextFile(`${base}-matches.csv`, matchesCsv(sc.matches), "text/csv");
      else downloadTextFile(`${base}-${fileSlug(LEADERBOARD_TITLES[table])}.csv`, leaderboardCsv(table, sc.totals), "text/csv");
    }
  });
}

/* --- the guest backup ---
   Guest data lives only on this phone (and in the Android app, only in the
   app), so a lost phone was a lost history. Settings → Your data saves it
   all to one file -- matches (with the logs that keep their balls
   editable), players, teams, presets, tournaments -- and brings a file back.
   Club data isn't in it: that's in the cloud already, and a club match
   restored onto another phone could upload an old copy over a newer one.
   Restoring only adds: whatever this phone already has (by id) stays as it
   is, nothing is removed, and the match being scored is never touched. */
const BACKUP_KIND = "cricket.lk/guest-backup", BACKUP_VERSION = 1;
const BACKUP_MAX_BYTES = 25 * 1024 * 1024;
function guestBackupData(){
  const matchHistory = {};
  Object.values(state.matchHistory).forEach(m => { if (m && m.id && !m.clubId) matchHistory[m.id] = m; });
  const store = matchLogStore(), matchLogs = {};
  Object.keys(matchHistory).forEach(id => { if (store[id]) matchLogs[id] = store[id]; });
  return {
    kind: BACKUP_KIND, version: BACKUP_VERSION, savedAt: Date.now(),
    data: { players: state.players, teams: state.teams, matchPresets: state.matchPresets, tournamentPresets: state.tournamentPresets,
      pointsPresets: state.pointsPresets, pointsPresetId: state.pointsPresetId, tournaments: state.tournaments, matchHistory, matchLogs }
  };
}
function guestDataCounts(d){
  const n = o => Object.keys(o || {}).length;
  return { matches: n(d.matchHistory), players: n(d.players), teams: n(d.teams), tournaments: n(d.tournaments) };
}
function saveGuestBackup(){
  const b = guestBackupData();
  downloadTextFile(`cricket-lk-backup-${fileStamp(b.savedAt)}.json`, JSON.stringify(b), "application/json");
}
/* What restoring `backup` onto `st` would add (and the merged pieces):
   { error } for a file that isn't a backup, else { add: { matches, players,
   teams, presets, tournaments }, apply(st, logStore) }. Pure apart from
   `apply`. Each record is checked for its shape, and keys that could reach
   an object's prototype are never copied. */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isPlainRecord(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function safeEntries(o){ return isPlainRecord(o) ? Object.keys(o).filter(k => !UNSAFE_KEYS.has(k) && isPlainRecord(o[k])).map(k => [k, o[k]]) : []; }
function validBackupMatch(id, m){
  return typeof m.id === "string" && m.id === id && !m.clubId && Array.isArray(m.innings) && m.innings.length <= 2
    && typeof m.teamA === "string" && typeof m.teamB === "string" && m.status === "complete"
    && m.innings.every(i => isPlainRecord(i) && typeof i.runs === "number" && (m.resultOnly || (isPlainRecord(i.batting) && Array.isArray(i.batting.order))));
}
function planGuestRestore(backup, st){
  if (!isPlainRecord(backup) || backup.kind !== BACKUP_KIND || !isPlainRecord(backup.data)) return { error: "That isn't a Cricket.lk backup file." };
  if (backup.version > BACKUP_VERSION) return { error: "This backup was saved by a newer version of the app. Update the app, then try again." };
  const d = backup.data;
  const fresh = (list, have, ok) => safeEntries(list).filter(([id, v]) => !have[id] && (!ok || ok(id, v)));
  const matches = fresh(d.matchHistory, st.matchHistory, validBackupMatch);
  const players = fresh(d.players, st.players, (id, p) => typeof p.name === "string" && p.name.trim());
  const teams = fresh(d.teams, st.teams, (id, t) => typeof t.name === "string" && Array.isArray(t.playerIds));
  const presets = [["matchPresets", fresh(d.matchPresets, st.matchPresets, (id, p) => typeof p.name === "string")],
    ["tournamentPresets", fresh(d.tournamentPresets, st.tournamentPresets, (id, p) => typeof p.name === "string")],
    ["pointsPresets", fresh(d.pointsPresets, st.pointsPresets, (id, p) => typeof p.name === "string" && !pointsPresetError(p))]];
  const tournaments = fresh(d.tournaments, st.tournaments, (id, t) => typeof t.name === "string" && Array.isArray(t.matchIds));
  // A tournament on both: the backup's matches join this phone's list.
  const known = new Set(Object.keys(st.matchHistory).concat(matches.map(([id]) => id)));
  const joined = safeEntries(d.tournaments).filter(([id, t]) => st.tournaments[id] && Array.isArray(t.matchIds)
    && t.matchIds.some(mid => typeof mid === "string" && known.has(mid) && !st.tournaments[id].matchIds.includes(mid)));
  return {
    savedAt: typeof backup.savedAt === "number" ? backup.savedAt : null, counts: guestDataCounts(d),
    add: { matches: matches.length, players: players.length, teams: teams.length, presets: presets.reduce((n, [, l]) => n + l.length, 0), tournaments: tournaments.length + joined.length },
    apply(target, logStore){
      const copy = v => JSON.parse(JSON.stringify(v));
      matches.forEach(([id, m]) => { target.matchHistory[id] = copy(m); });
      players.forEach(([id, p]) => { target.players[id] = copy(p); });
      teams.forEach(([id, t]) => { target.teams[id] = Object.assign(copy(t), { playerIds: t.playerIds.filter(x => typeof x === "string") }); });
      presets.forEach(([field, list]) => list.forEach(([id, p]) => { target[field][id] = copy(p); }));
      tournaments.forEach(([id, t]) => { target.tournaments[id] = Object.assign(copy(t), { matchIds: t.matchIds.filter(x => typeof x === "string" && target.matchHistory[x]) }); });
      joined.forEach(([id, t]) => { t.matchIds.forEach(mid => { if (target.matchHistory[mid] && !target.tournaments[id].matchIds.includes(mid)) target.tournaments[id].matchIds.push(mid); }); });
      // Restored matches keep their logs (balls stay editable), up to what this phone keeps.
      if (logStore) safeEntries(d.matchLogs).forEach(([id, l]) => {
        if (target.matchHistory[id] && !logStore[id] && matches.some(([mid]) => mid === id) && Array.isArray(l.innings)) logStore[id] = copy(l);
      });
    }
  };
}
function restoreGuestBackup(file){
  if (file.size > BACKUP_MAX_BYTES){ askConfirm({ title: "That file is too big", icon: "⚠️", tone: "primary", body: `<p>A Cricket.lk backup is a few megabytes at most.</p>`, confirmLabel: "OK", onConfirm: () => {} }); return; }
  const reader = new FileReader();
  reader.onload = () => {
    let backup = null;
    try { backup = JSON.parse(String(reader.result)); } catch (_){ backup = null; }
    const plan = backup ? planGuestRestore(backup, state) : { error: "That isn't a Cricket.lk backup file." };
    if (plan.error){ askConfirm({ title: "Can't restore that file", icon: "⚠️", tone: "primary", body: `<p>${escapeHtml(plan.error)}</p>`, confirmLabel: "OK", onConfirm: () => {} }); return; }
    const a = plan.add, c = plan.counts;
    const parts = [a.matches ? plural(a.matches, "match", "matches") : "", a.players ? plural(a.players, "player") : "", a.teams ? plural(a.teams, "team") : "",
      a.presets ? plural(a.presets, "preset") : "", a.tournaments ? plural(a.tournaments, "tournament") : ""].filter(Boolean);
    const when = plan.savedAt ? new Date(plan.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    if (!parts.length){
      askConfirm({ title: "Nothing new in this backup", icon: "✓", tone: "primary", confirmLabel: "OK", onConfirm: () => {},
        body: `<p>Everything in it${when ? ` (saved ${escapeHtml(when)})` : ""} is already on this phone.</p>` });
      return;
    }
    askConfirm({
      title: "Restore this backup?", icon: "⤓", tone: "primary",
      body: `<p>Saved${when ? ` ${escapeHtml(when)}` : ""}: ${plural(c.matches, "match", "matches")}, ${plural(c.players, "player")}.</p>
        <p>Adds <b>${escapeHtml(parts.join(", "))}</b> that this phone doesn't have. Nothing here is changed or removed.</p>`,
      confirmLabel: "Restore",
      onConfirm: () => {
        const store = matchLogStore();
        plan.apply(state, store);
        // Keep only the newest MATCH_LOGS_KEEP matches' logs, as keepMatchLogs does.
        Object.keys(store).sort((x, y) => (store[y].at || 0) - (store[x].at || 0)).slice(MATCH_LOGS_KEEP).forEach(k => delete store[k]);
        DB.save(MATCH_LOGS_KEY, store);
        save();
      }
    });
  };
  reader.readAsText(file);
}
// Settings → Your data (guest data only).
function renderBackupSection(){
  const c = guestDataCounts(guestBackupData().data);
  return `
    <h3 class="section-label">Your data</h3>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Back up</div>
        <div class="settings-row-sub">${plural(c.matches, "match", "matches")} and ${plural(c.players, "player")} on this phone</div>
      </div>
      <button type="button" data-action="backup-save" class="ghost small">Save</button>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Restore</div>
        <div class="settings-row-sub">Adds what this phone doesn't have</div>
      </div>
      <button type="button" data-action="backup-restore" class="ghost small">Restore</button>
      <input type="file" id="backup-file" accept="application/json,.json" hidden data-nav-ignore>
    </div>`;
}
