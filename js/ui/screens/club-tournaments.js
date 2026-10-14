/* Cricket.lk — screens: club tournaments, tournament teams & team builder.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- club (Local-tier) tournaments: group a club's own matches -- e.g.
   everything played on one day -- under one tournament with standings,
   with no external registration and no persistent team entity (see
   CLAUDE.md). Reuses the same renderStandingsTable/computeStandings/
   renderLeaderboards/aggregatePlayerStats as the local guest tournament
   feature, fed cloud-fetched matches instead of state.matchHistory. --- */
// Club tournaments are usually "everything played today", so the name box is
// pre-filled with today's date (e.g. "Sun 27 Sep 2026") -- no typing needed.
function defaultClubTournamentName(date = new Date()){
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/,/g, "");
}

function renderClubTournamentSetup(){
  if (!session) return renderSignIn();
  const clubName = currentClubName();
  const presets = clubPresetList("tournament", ui.currentClubId);
  if (!ui.clubTournamentSetupPresetId || !presets.some(p => p.id === ui.clubTournamentSetupPresetId)){
    ui.clubTournamentSetupPresetId = presets.length ? presets[0].id : null;
  }
  return `
    <div class="screen setup">
      ${renderBackBar(clubName || "Club", "home")}
      <h1>🏆 New tournament</h1>
      <p class="tagline">Group this club's own matches -- e.g. everything played on one day -- under one tournament with standings.</p>
      <form id="club-tournament-setup-form">
        <label>Tournament name<input name="name" required maxlength="40" placeholder="e.g. Sunday 12 Oct" value="${escapeHtml(ui.clubTournamentSetupName ?? defaultClubTournamentName())}"></label>
        <input type="hidden" name="tournamentPresetId" value="${ui.clubTournamentSetupPresetId || ""}">
        ${!presets.length ? `<p class="hint">${ui.club && ui.club.id === ui.currentClubId ? "This club has no tournament presets yet — add one on the club page first." : "Loading this club's presets…"}</p>` : ""}
        ${presets.length ? `
          ${presetPickerHtml({ presets, activeId: ui.clubTournamentSetupPresetId, pickAction: "pick-club-tournament-preset", kind: "tournament", slot: "club-tournament-setup" })}
        ` : ""}
        <button type="submit" class="primary">Create tournament</button>
      </form>
    </div>
  `;
}

function handleClubTournamentSetupSubmit(e){
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const name = (f.get("name") || "").trim();
  const wantId = f.get("tournamentPresetId") || ui.clubTournamentSetupPresetId;
  const preset = clubPresetList("tournament", ui.currentClubId).find(p => p.id === wantId);
  if (!name || !preset) return;
  createClubTournament(ui.currentClubId, name, preset).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    ui.currentTournamentId = result.tournament.id;
    ui.clubTournamentSetupPresetId = null; ui.clubTournamentSetupName = null;
    state.view = "clubTournamentDashboard";
    save(); render();
    fetchClubTournamentDetail(result.tournament.id).then(render);
  });
}

/* Club and guest tournament dashboards share one shape: Overview (points
   table), Teams (collapsed cards, tap one to see its players), Fixtures
   (start a match + every completed one, tap for its scorecard) and Stats
   (leaderboards, with their own sub-tabs). ui.tournamentTab picks the tab;
   opening a tournament resets it to "overview". */
const TOURNAMENT_TABS = [["overview", "Overview"], ["teams", "Teams"], ["fixtures", "Fixtures"], ["stats", "Stats"]];
function tournamentTab(){ return TOURNAMENT_TABS.some(([id]) => id === ui.tournamentTab) ? ui.tournamentTab : "overview"; }

/* Completed matches, newest first; each row opens the match's scorecard
   sheet (open-match-detail). */
function renderFixtureList(matches, empty){
  const list = [...matches].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  if (!list.length) return `<p class="hint">${empty || "No matches played yet."}</p>`;
  return `<div class="fixtures">${list.map(m => `
    <button type="button" data-action="open-match-detail" data-id="${escapeHtml(m.id || "")}" class="fixture-row fixture-open">
      <span class="fixture-main"><b>${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}</b><span class="fixture-result">${escapeHtml(m.result || "")}</span></span>
      <span class="fixture-meta">${m.completedAt ? new Date(m.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""}<span class="chevron">›</span></span>
    </button>`).join("")}</div>`;
}

/* One team card, collapsed to its name + count until tapped
   (ui.expandedTeamId). `players` is [{ name, guest? }]; `actions` is the
   trusted HTML of the head's buttons (edit/delete) or "". */
function teamCardHtml({ id, name, players, index, actions, pending }){
  const open = ui.expandedTeamId === id;
  const guests = players.filter(pl => pl.guest).length;
  return `
    <div class="team-card team-c${index % 4}${open ? " open" : ""}">
      <div class="team-card-head">
        <button type="button" data-action="toggle-team-card" data-id="${escapeHtml(id)}" class="team-card-toggle" aria-expanded="${open}">
          <span class="team-badge">${escapeHtml(nameInitials(name))}</span>
          <span class="team-card-title"><b>${escapeHtml(name)}${pending ? `<span class="pending-tag">not synced</span>` : ""}</b><span class="muted">${players.length} player${players.length === 1 ? "" : "s"}${guests ? ` · ${guests} guest${guests === 1 ? "" : "s"}` : ""}</span></span>
          <span class="chevron">${open ? "▾" : "▸"}</span>
        </button>
        ${actions ? `<div class="team-card-actions">${actions}</div>` : ""}
      </div>
      ${open ? (players.length ? `<div class="team-roster">
        ${players.map(pl => `<span class="player-chip${pl.guest ? " guest" : ""}"><span class="mini-avatar">${escapeHtml(nameInitials(pl.name))}</span>${escapeHtml(pl.name)}${pl.guest ? `<span class="guest-tag">guest</span>` : ""}</span>`).join("")}
      </div>` : `<p class="hint">No players picked yet.</p>`) : ""}
    </div>`;
}

function renderClubTournamentDashboard(){
  if (!session) return renderSignIn();
  const t = ui.clubTournament;
  const clubName = currentClubName();
  if (!t) return `<div class="screen tournament">${renderBackBar(clubName || "Club", "clubHome")}${loadingHtml()}</div>`;
  const tab = tournamentTab();
  const matches = t.matches.map(m => m.data ? Object.assign({ id: m.id }, m.data) : null).filter(Boolean);
  const startBtn = `<button data-action="go-club-tournament-match-setup" class="primary">Start match</button>`;
  const p = t.tournament_preset || {};
  return `
    <div class="screen tournament">
      ${renderBackBar(clubName || "Club", "clubHome")}
      <h1>🏆 ${escapeHtml(t.name)}</h1>
      <p class="tagline">${p.pointsForWin ?? 2}/${p.pointsForTie ?? 1}/${p.pointsForLoss ?? 0} pts${p.useNRR ? " · NRR" : ""} · ${matches.length} match${matches.length === 1 ? "" : "es"} played</p>
      ${tabsHtml("switch-tournament-tab", TOURNAMENT_TABS, tab, "main-tabs")}
      ${tab === "overview" ? `
        ${matches.length ? renderStandingsTable(computeStandings(matches, p), p.useNRR) : `<p class="hint">No matches yet — start one to fill the points table.</p>`}
        ${matches.length ? `<h3 class="section-label">Latest results</h3>${renderFixtureList(matches.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 3))}` : ""}
        ${startBtn}` : ""}
      ${tab === "teams" ? renderTournamentTeams(t) : ""}
      ${tab === "fixtures" ? `${startBtn}<h3 class="section-label">Completed matches</h3>${renderFixtureList(matches, "No matches yet — start one above.")}` : ""}
      ${tab === "stats" ? (matches.length ? renderLeaderboards(aggregatePlayerStats(matches)) : `<p class="hint">Stats appear once a match is finished.</p>`) : ""}
    </div>
  `;
}

/* Tournament teams (supabase/012). A team is a name + players picked from
   the club roster; a player can be on only one team per tournament (checked
   here, on save). Teams only pre-fill match setup and set match.squads --
   played matches keep their own names, so editing or deleting a team never
   changes history or standings. */
function renderTournamentTeams(t){
  if (t.teams_unavailable){
    return `<p class="hint">Saved teams need 012_tournament_teams.sql — run it in the Supabase SQL editor. You can still type team names at match setup.</p>`;
  }
  const rosterReady = ui.club && ui.club.id === t.organizer_club_id;
  const assigned = new Set(t.teams.flatMap(team => team.players.map(pl => pl.id)));
  const unassigned = rosterReady ? ui.club.roster.filter(p => p.id && !assigned.has(p.id)) : [];
  return `
    ${ui.tournamentTeamError ? `<p class="form-error">${escapeHtml(ui.tournamentTeamError)}</p>` : ""}
    <div class="team-grid">
      ${t.teams.map((team, i) => teamCardHtml({ id: team.id, name: team.name, players: team.players, index: i, pending: team.pending, actions: `
        <button data-action="edit-tournament-team" data-id="${team.id}" class="icon-btn" aria-label="Edit ${escapeHtml(team.name)}" title="Edit team">${ICON_EDIT}</button>
        <button data-action="delete-tournament-team" data-id="${team.id}" class="icon-btn danger" aria-label="Delete ${escapeHtml(team.name)}" title="Delete team">${ICON_DELETE}</button>` })).join("")}
      <button data-action="new-tournament-team" class="team-card add" ${ui.tournamentTeamBusy ? "disabled" : ""}><span class="plus">＋</span><span>Add team</span></button>
    </div>
    ${t.teams.length ? `<p class="hint">Tap a team to see its players.</p>` : ""}
    ${!t.teams.length ? `
      <p class="hint">Most club tournaments are two sides. Build them here, then pick them when you start a match.</p>
      ${rosterReady && unassigned.length >= 2 ? `<button data-action="quick-split-teams" class="ghost" style="width:100%;" ${ui.tournamentTeamBusy ? "disabled" : ""}>${ui.tournamentTeamBusy ? "Creating…" : `🎲 Split the roster into 2 random teams (${unassigned.length} players)`}</button>` : ""}
    ` : rosterReady && unassigned.length ? `<p class="hint">${unassigned.length} roster player${unassigned.length === 1 ? " isn't" : "s aren't"} on a team yet: ${unassigned.slice(0, 5).map(p => escapeHtml(p.name)).join(", ")}${unassigned.length > 5 ? "…" : ""}</p>` : ""}
  `;
}

/* Inline SVG icons (no icon font/CDN -- single-file, offline). currentColor,
   so they follow the button's text color. */
const ICON_EDIT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_CLOUD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a5 5 0 1 1 .9-9.92A6 6 0 0 1 19.4 11 4 4 0 0 1 17.5 19Z"/></svg>`;
const ICON_CLOUD_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M5.8 9.4A5 5 0 0 0 7 19h10.5M20.8 16.9A4 4 0 0 0 19.4 11 6 6 0 0 0 10 7.2"/></svg>`;
const ICON_WARN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>`;
const ICON_DELETE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

function nameInitials(name){
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
}

/* Everyone the team builder can offer: the club roster (sorted), anyone
   still on this team who has since left the roster, and guests -- those
   already on any team in this tournament plus ones added in this edit
   (edit.guests). A guest is { id: guestPlayerKey(name), name, guest: true }
   and lives only inside tournament_teams.players, never on the roster.
   `takenBy` maps a player id to the other team they're on. */
function teamBuilderPool(t, edit){
  const roster = ui.club.roster.filter(p => p.id).slice().sort((a, b) => a.name.localeCompare(b.name));
  const current = t.teams.find(team => team.id === edit.id);
  const leftRoster = current ? current.players.filter(pl => !pl.guest && !roster.some(p => p.id === pl.id)) : [];
  const guests = [];
  [...t.teams.flatMap(team => team.players.filter(pl => pl.guest)), ...(edit.guests || [])].forEach(g => {
    if (!guests.some(x => x.id === g.id)) guests.push(g);
  });
  const all = [
    ...roster.map(p => ({ id: p.id, name: p.name, label: playerLabel(p) })),
    ...leftRoster.map(pl => ({ id: pl.id, name: pl.name, label: `${pl.name} (left the roster)` })),
    ...guests.map(g => ({ id: g.id, name: g.name, label: g.name, guest: true }))
  ];
  const takenBy = {};
  t.teams.forEach(team => { if (team.id !== edit.id) team.players.forEach(pl => { takenBy[pl.id] = team.name; }); });
  return { all, takenBy };
}

/* The team builder: tap a roster player to add them, tap a picked chip to
   take them off. Picks live in ui.tournamentTeamEdit (playerIds, name,
   search) so a re-render -- each tap, or the roster finishing loading --
   never drops them. Someone on another team is shown with "move": picking
   them takes them off that team when this one is saved (a player is on one
   team per tournament). The search box filters rows in the DOM only. */
function renderTournamentTeamForm(t, edit){
  const rosterReady = ui.club && ui.club.id === t.organizer_club_id;
  const idx = edit.id ? Math.max(0, t.teams.findIndex(team => team.id === edit.id)) : t.teams.length;
  const { all, takenBy } = rosterReady ? teamBuilderPool(t, edit) : { all: [], takenBy: {} };
  const picked = edit.playerIds.map(id => all.find(p => p.id === id)).filter(Boolean);
  const available = all.filter(p => !edit.playerIds.includes(p.id));
  const q = (edit.search || "").trim().toLowerCase();
  const hit = p => !q || p.label.toLowerCase().includes(q);
  const freeCount = available.filter(p => !takenBy[p.id] && hit(p)).length;
  const moving = picked.filter(p => takenBy[p.id]);
  return `
    <form id="tournament-team-form" class="team-builder team-c${idx % 4}">
      <div class="team-card-head">
        <span class="team-badge">${escapeHtml(nameInitials(edit.name || "?"))}</span>
        <div class="team-card-title"><b>${edit.id ? "Edit team" : "New team"}</b><span class="muted">${picked.length} player${picked.length === 1 ? "" : "s"} picked</span></div>
        ${edit.id ? `<button type="button" data-action="delete-tournament-team" data-id="${escapeHtml(edit.id)}" class="ghost small danger-text" style="margin-left:auto;">Delete</button>` : ""}
      </div>
      <div class="form-error"></div>
      <label>Team name<input name="teamName" required maxlength="24" value="${escapeHtml(edit.name || "")}" placeholder="e.g. Reds" autocomplete="off"></label>

      <div class="section-label">In this team · ${picked.length}</div>
      ${picked.length ? `<div class="team-roster picked">
        ${picked.map(p => `<button type="button" data-action="team-builder-toggle" data-id="${escapeHtml(p.id)}" class="player-chip on" aria-label="Take ${escapeHtml(p.name)} off the team"><span class="mini-avatar">${escapeHtml(nameInitials(p.name))}</span>${escapeHtml(p.label)}${p.guest ? `<span class="guest-tag">guest</span>` : ""}<span class="x">×</span></button>`).join("")}
      </div>` : `<p class="hint">Nobody yet. Tap players below to add them.</p>`}
      ${moving.length ? `<p class="hint move-note">Moving here on save: ${moving.map(p => `${escapeHtml(p.name)} (from ${escapeHtml(takenBy[p.id])})`).join(", ")}</p>` : ""}

      <div class="section-label">Club roster</div>
      ${edit.notice ? `<p class="hint builder-notice${edit.notice.error ? " error" : ""}">${escapeHtml(edit.notice.text)}</p>` : ""}
      ${!rosterReady ? loadingHtml("Loading the club roster…")
        : `
        <div class="builder-tools">
          <input type="text" enterkeyhint="search" name="teamSearch" class="team-builder-search" placeholder="Search, or type a new name" maxlength="24" value="${escapeHtml(edit.search || "")}" autocomplete="off">
          <button type="button" data-action="team-builder-add-free" class="ghost small" ${freeCount ? "" : "disabled"}>+ All free${freeCount ? ` (${freeCount})` : ""}</button>
        </div>
        <div class="pick-grid">
          ${available.map(p => `
            <button type="button" data-action="team-builder-toggle" data-id="${escapeHtml(p.id)}" data-label="${escapeHtml(p.label.toLowerCase())}" data-free="${takenBy[p.id] ? "0" : "1"}" class="pick-row${takenBy[p.id] ? " taken" : ""}" ${hit(p) ? "" : "hidden"}>
              <span class="mini-avatar">${escapeHtml(nameInitials(p.name))}</span>
              <span class="name">${escapeHtml(p.label)}${p.guest ? ` <span class="guest-tag">guest</span>` : ""}</span>
              <span class="state">${takenBy[p.id] ? `${escapeHtml(takenBy[p.id])} · move` : "＋"}</span>
            </button>`).join("")}
          <p class="hint no-results" ${available.some(hit) ? "hidden" : ""}>${!all.length ? "The club roster is empty. Type a name above to add someone." : available.length ? "No players match." : "Everyone on the roster is in this team."}</p>
        </div>
        ${renderBuilderAddCard(edit)}`}

      <div class="builder-bar">
        <button type="button" data-action="cancel-tournament-team" class="ghost">Cancel</button>
        <button type="submit" class="primary" ${ui.tournamentTeamBusy ? "disabled" : ""}>${ui.tournamentTeamBusy ? "Saving…" : `Save team${picked.length ? ` (${picked.length})` : ""}`}</button>
      </div>
    </form>
  `;
}

/* "Someone new?" under the builder's roster list, driven by the search box
   (the input listener keeps its text/disabled state in step without a
   re-render). Its one button asks, in the shared confirmation sheet, whether
   the name is a new club player (add_player_to_club: roster + platform, same
   as the Players screen) or a guest (a name on this team only). */
function renderBuilderAddCard(edit){
  const q = (edit.search || "").trim();
  return `
    <div class="builder-add">
      <div class="builder-add-title">${q ? `Add “<span class="q">${escapeHtml(q)}</span>”` : `Someone new? <span class="muted">Type their name in the search box.</span>`}</div>
      <div class="builder-add-actions">
        <button type="button" data-action="team-builder-add-new" class="ghost small" ${q && !edit.adding ? "" : "disabled"}>${edit.adding ? "Adding…" : "＋ Add to this team…"}</button>
      </div>
    </div>`;
}

function builderRosterMatch(name){
  const key = name.trim().toLowerCase();
  return (ui.club ? ui.club.roster : []).find(p => p.id && p.name.toLowerCase() === key);
}
function builderSelect(edit, id){ if (!edit.playerIds.includes(id)) edit.playerIds = [...edit.playerIds, id]; }

/* The add button: a typed name that's already on the roster is just picked;
   anything else asks "new club player or guest?" before adding. */
function askAddBuilderPlayer(){
  const edit = ui.tournamentTeamEdit;
  const name = (edit && edit.search || "").trim();
  if (!name || edit.adding) return;
  const onRoster = builderRosterMatch(name);
  if (onRoster){
    builderSelect(edit, onRoster.id);
    edit.notice = { text: `${onRoster.name} is already on the club roster, so they were picked from there.` };
    edit.search = ""; render(); return;
  }
  askConfirm({
    title: `Add ${name}`, icon: "＋", tone: "primary",
    body: `<p>Who is <b>${escapeHtml(name)}</b>?</p>`,
    choices: [
      { value: "club", label: "New club player", sub: "Joins the club roster" },
      { value: "guest", label: "Guest player", sub: "This team only, not stored in the club" }
    ],
    confirmLabel: "Add to team", busyLabel: "Adding…",
    onConfirm: choice => choice === "guest" ? addBuilderGuest(edit, name) : addBuilderClubPlayer(edit, name)
  });
}

function addBuilderGuest(edit, name){
  const id = guestPlayerKey(name);
  const known = (ui.clubTournament.teams.flatMap(team => team.players).find(pl => pl.id === id));
  if (!known && !(edit.guests || []).some(g => g.id === id)) edit.guests = [...(edit.guests || []), { id, name, guest: true }];
  builderSelect(edit, id);
  edit.notice = { text: `${name} added as a guest.` };
  edit.search = "";
}

/* Returns { error } to keep the sheet open with the message. */
async function addBuilderClubPlayer(edit, name){
  const t = ui.clubTournament;
  if (!supabaseClient || !session) return { error: "Sign in to add players to the club." };
  // (Works offline too -- the add is queued and the player gets a temp id until it syncs.)
  edit.adding = true; edit.notice = null;
  const result = await addPlayerToClub(t.organizer_club_id, name);
  edit.adding = false;
  if (!result || result.error) return { error: (result && result.error) || "Couldn't add that player." };
  if (ui.club && ui.club.id === t.organizer_club_id && !ui.club.roster.some(p => p.id === result.id)) ui.club.roster.push({ id: result.id, name });
  builderSelect(edit, result.id);
  edit.notice = { text: result.queued ? `${name} added on this device. They'll join the club roster when you're online.` : result.created ? `${name} added to the club roster.` : `${name} was already on the platform, so they joined the club roster.` };
  edit.search = "";
}

/* Picking someone who's on another team asks first, so a stray tap can't
   move a player between teams. */
function askMoveBuilderPlayer(id){
  const t = ui.clubTournament, edit = ui.tournamentTeamEdit;
  const from = t.teams.find(team => team.id !== edit.id && team.players.some(pl => pl.id === id));
  if (!from){ builderSelect(edit, id); edit.notice = null; render(); return; }
  const name = from.players.find(pl => pl.id === id).name;
  askConfirm({
    title: `Move ${name}?`, icon: "⇄", tone: "primary",
    body: `<p><b>${escapeHtml(name)}</b> is on <b>${escapeHtml(from.name)}</b>. They'll leave it and join <b>${escapeHtml(edit.name || "this team")}</b> when you save.</p>`,
    confirmLabel: "Move here",
    onConfirm: () => { builderSelect(edit, id); edit.notice = null; }
  });
}

/* The team builder opens as a bottom sheet over the dashboard. Each tap
   inside re-renders it; render() keeps its scroll (data-keep-scroll). */
function renderTournamentTeamModal(){
  const t = ui.clubTournament, edit = ui.tournamentTeamEdit;
  const idx = edit.id ? Math.max(0, t.teams.findIndex(team => team.id === edit.id)) : t.teams.length;
  return `
    <div class="modal-backdrop">
      <div class="modal team-modal team-c${idx % 4}" data-keep-scroll="team-edit" role="dialog" aria-modal="true" aria-label="${edit.id ? "Edit team" : "New team"}">
        ${renderTournamentTeamForm(t, edit)}
      </div>
    </div>`;
}
function teamEditState(id, name, playerIds){
  return { id, name, playerIds: playerIds.slice(), search: "", original: JSON.stringify({ name, ids: playerIds.slice().sort() }) };
}
function teamEditDirty(edit){
  return JSON.stringify({ name: edit.name, ids: edit.playerIds.slice().sort() }) !== edit.original;
}
/* Closing with unsaved picks asks first (the shared confirmation sheet). */
function closeTeamEdit(){
  const edit = ui.tournamentTeamEdit;
  if (!edit) return;
  if (!teamEditDirty(edit)){ ui.tournamentTeamEdit = null; render(); return; }
  askConfirm({
    title: "Discard your changes?", icon: "✎", tone: "primary",
    body: `<p>The players you picked${edit.id ? " and any name change" : ""} for <b>${escapeHtml(edit.name || "this team")}</b> won't be saved.</p>`,
    confirmLabel: "Discard", cancelLabel: "Keep editing",
    onConfirm: () => { ui.tournamentTeamEdit = null; }
  });
}
function askDeleteTournamentTeam(teamId){
  const t = ui.clubTournament;
  const team = t && t.teams.find(x => x.id === teamId);
  if (!team) return;
  const n = team.players.length;
  askConfirm({
    title: `Delete ${team.name}?`, icon: "🗑",
    body: `<p>${n ? `Its ${n === 1 ? "1 player goes" : `${n} players go`} back to unassigned. ` : ""}Matches already played keep their team names, so standings don't change.</p>`,
    confirmLabel: "Delete team", busyLabel: "Deleting…",
    onConfirm: () => deleteTournamentTeam(t.id, teamId).then(r => {
      if (r.error) return r;
      if (ui.tournamentTeamEdit && ui.tournamentTeamEdit.id === teamId) ui.tournamentTeamEdit = null;
      return fetchClubTournamentDetail(t.id);
    })
  });
}

async function handleTournamentTeamSubmit(e){
  e.preventDefault();
  const form = e.target;
  const t = ui.clubTournament, edit = ui.tournamentTeamEdit;
  if (!t || !edit || ui.tournamentTeamBusy) return;
  const name = (new FormData(form).get("teamName") || "").trim();
  if (!name){ showFormError(form, "Give the team a name."); return; }
  const others = t.teams.filter(team => team.id !== edit.id);
  if (others.some(team => team.name.toLowerCase() === name.toLowerCase())){ showFormError(form, "This tournament already has a team with that name."); return; }
  edit.name = name;
  const ids = edit.playerIds.slice();
  const known = [...(ui.club ? ui.club.roster : []), ...t.teams.flatMap(team => team.players), ...(edit.guests || [])];
  const players = ids.map(id => known.find(p => p.id === id)).filter(Boolean)
    .map(p => p.guest ? { id: p.id, name: p.name, guest: true } : { id: p.id, name: p.name });
  // Players picked off another team leave it first, so nobody is ever on two.
  const donors = others.filter(team => team.players.some(pl => ids.includes(pl.id)));
  ui.tournamentTeamBusy = true; render();
  let result = { ok: true };
  for (const d of donors){
    result = await saveTournamentTeam(t, { id: d.id, name: d.name, players: d.players.filter(pl => !ids.includes(pl.id)) });
    if (result.error) break;
  }
  if (!result.error) result = await saveTournamentTeam(t, { id: edit.id, name, players });
  ui.tournamentTeamBusy = false;
  if (result.error){
    render(); showFormError(document.getElementById("tournament-team-form"), result.error);
    if (donors.length) fetchClubTournamentDetail(t.id).then(render);
    return;
  }
  ui.tournamentTeamEdit = null;
  fetchClubTournamentDetail(t.id).then(render);
}

/* One tap for the usual "club splits in two for the day": shuffle the
   players who aren't on a team yet into two new teams, then edit from there.
   Only offered while the tournament has no teams. */
async function quickSplitTeams(){
  const t = ui.clubTournament;
  if (!t || t.teams.length || ui.tournamentTeamBusy || !ui.club || ui.club.id !== t.organizer_club_id) return;
  const pool = ui.club.roster.filter(p => p.id).map(p => ({ id: p.id, name: p.name }));
  if (pool.length < 2) return;
  for (let i = pool.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  ui.tournamentTeamBusy = true; ui.tournamentTeamError = null; render();
  let result = await saveTournamentTeam(t, { id: null, name: "Team A", players: pool.filter((_, i) => i % 2 === 0) });
  if (!result.error) result = await saveTournamentTeam(t, { id: null, name: "Team B", players: pool.filter((_, i) => i % 2 === 1) });
  ui.tournamentTeamBusy = false;
  ui.tournamentTeamError = result.error || null;
  fetchClubTournamentDetail(t.id).then(render);
}
