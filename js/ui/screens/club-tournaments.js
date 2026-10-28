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
function tournamentTab(ended, list){
  const tabs = tournamentTabs(ended, list);
  return tabs.some(([id]) => id === ui.tournamentTab) ? ui.tournamentTab : tabs[0][0];
}
/* The Overview/Fixtures actions: start a scored match, record a result only,
   and (Overview, once something's been played) end the tournament. */
function tournamentActionsHtml(startBtn, played, withEnd){
  return `
    <div class="tournament-actions">
      ${startBtn}
      <button type="button" data-action="open-result-entry" class="ghost">Enter result only</button>
    </div>
    ${withEnd && played ? `<button type="button" data-action="end-tournament" class="ghost end-tournament-btn">🏁 End tournament</button>` : ""}`;
}
const ENDED_NOTE = `<p class="hint">This tournament has ended. Reopen it from the Summary tab to add matches.</p>`;

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
  if (!t) return `<div class="screen tournament">${renderBackBar(escapeHtml(clubName) || "Home", "home")}${loadingHtml()}</div>`;
  const p = t.tournament_preset || {};
  const ended = !!p.endedAt;
  const tab = tournamentTab(ended);
  const matches = tournamentRowMatches(t.matches);
  const startBtn = `<button data-action="go-club-tournament-match-setup" class="primary">Start match</button>`;
  return `
    <div class="screen tournament">
      ${renderBackBar(escapeHtml(clubName) || "Home", "home")}
      <h1>🏆 ${escapeHtml(t.name)}</h1>
      <p class="tagline">${clubTournamentTagline(p, matches.length)}</p>
      <div class="tournament-links">
        <button type="button" data-action="share-tournament-link" class="ghost small">${ICON_LINK} Share link</button>
      </div>
      ${tabsHtml("switch-tournament-tab", tournamentTabs(ended), tab, ended ? "main-tabs many" : "main-tabs")}
      ${tab === "summary" ? renderTournamentSummary(tournamentContext()) : ""}
      ${tab === "overview" ? `
        ${matches.length ? renderStandingsTable(computeStandings(matches, p), p.useNRR) : `<p class="hint">No matches yet — start one to fill the points table.</p>`}
        ${matches.length ? `<h3 class="section-label">Latest results</h3>${renderFixtureList([...matches].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 3))}` : ""}
        ${ended ? ENDED_NOTE : tournamentActionsHtml(startBtn, matches.length, true)}` : ""}
      ${tab === "teams" ? renderTournamentTeams(t) : ""}
      ${tab === "fixtures" ? `${ended ? ENDED_NOTE : tournamentActionsHtml(startBtn, 0, false)}<h3 class="section-label">Completed matches</h3>${renderFixtureList(matches, "No matches yet — start one above.")}` : ""}
      ${tab === "stats" ? (matches.length ? renderLeaderboards(aggregatePlayerStats(matches, clubPointsPreset(t.organizer_club_id)), { points: clubPointsPreset(t.organizer_club_id), where: "the club's Presets" }) : `<p class="hint">Stats appear once a match is finished.</p>`) : ""}
    </div>
  `;
}
/* A club tournament's matches rows ({ id, data }) as match objects. */
function tournamentRowMatches(rows){
  return rows.map(m => m.data ? Object.assign({ id: m.id }, m.data) : null).filter(Boolean);
}
function clubTournamentTagline(p, played){
  return `${p.pointsForWin ?? 2}/${p.pointsForTie ?? 1}/${p.pointsForLoss ?? 0} pts${p.useNRR ? " · NRR" : ""} · ${played} match${played === 1 ? "" : "es"} played`;
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

/* --- ended tournaments: Summary tab + share ---
   Ending a tournament (guest: t.endedAt; club: tournament_preset.endedAt,
   saved with the "tournament.update" outbox op -- no migration needed, the
   preset jsonb is members-updatable) stops new fixtures and puts a Summary
   tab first: champion, final table and the top performers
   (tournamentSummary, ENGINE), shareable as an image. Reopening clears it. */
const ICON_SHARE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>`;
const ICON_LINK = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`;
function tournamentTabs(ended, list){ const tabs = list || TOURNAMENT_TABS; return ended ? [["summary", `${ICON_SHARE} Summary`], ...tabs] : tabs; }

/* Who's viewing: guest tournaments live in state.tournaments, club ones in
   ui.clubTournament, a shared link's in ui.publicTournament. Returns what the
   summary/result sheet need. */
function tournamentContext(){
  const club = state.view === "clubTournamentDashboard" && ui.clubTournament;
  const pub = state.view === "publicTournament" && ui.publicTournament && ui.publicTournament.matches && ui.publicTournament;
  if (club || pub){
    const p = (club ? club.tournament_preset : pub.preset) || {};
    return {
      kind: club ? "club" : "public", id: (club || pub).id, name: (club || pub).name, endedAt: p.endedAt || null,
      preset: { pointsForWin: p.pointsForWin ?? 2, pointsForTie: p.pointsForTie ?? 1, pointsForLoss: p.pointsForLoss ?? 0, useNRR: !!p.useNRR },
      matches: tournamentRowMatches((club || pub).matches),
      teamNames: club ? (club.teams || []).map(x => x.name) : [],
      // null on a public page whose server lacks supabase/017: no MVP anywhere.
      pointsPreset: club ? clubPointsPreset(club.organizer_club_id) : pub.points
    };
  }
  const t = activeTournament();
  if (!t) return null;
  const preset = state.tournamentPresets[t.tournamentPresetId] || DEFAULT_TOURNAMENT_PRESETS[0];
  return {
    kind: "guest", id: t.id, name: t.name, endedAt: t.endedAt || null, preset,
    matches: t.matchIds.map(id => state.matchHistory[id]).filter(Boolean),
    teamNames: t.teamIds.map(id => state.teams[id]).filter(Boolean).map(x => x.name),
    pointsPreset: guestPointsPreset()
  };
}

function askEndTournament(){
  const c = tournamentContext();
  if (!c) return;
  askConfirm({
    title: `End ${c.name}?`, icon: "🏆", tone: "primary",
    body: `<p>The final table and tournament stats move to a new <b>Summary</b> tab you can share. No more matches can be added — you can reopen it from the Summary tab.</p>`,
    confirmLabel: "End tournament", busyLabel: "Saving…",
    onConfirm: () => setTournamentEnded(c, Date.now())
  });
}
function askReopenTournament(){
  const c = tournamentContext();
  if (!c) return;
  askConfirm({
    title: `Reopen ${c.name}?`, icon: "↺", tone: "primary",
    body: `<p>Matches can be added again and the Summary tab goes away until you end it again.</p>`,
    confirmLabel: "Reopen", busyLabel: "Saving…",
    onConfirm: () => setTournamentEnded(c, null)
  });
}
async function setTournamentEnded(c, endedAt){
  ui.tournamentTab = endedAt ? "summary" : null;
  if (c.kind === "guest"){
    const t = state.tournaments[c.id];
    if (endedAt) t.endedAt = endedAt; else delete t.endedAt;
    save(); return;
  }
  const t = ui.clubTournament;
  const preset = Object.assign({}, t.tournament_preset || {});
  if (endedAt) preset.endedAt = endedAt; else delete preset.endedAt;
  const res = await updateClubTournament(t, { preset });
  if (res.error) return res;
  return fetchClubTournamentDetail(t.id);
}

/* tournamentSummary for a context: with no points preset (a public page
   without supabase/017) there's no MVP, rather than one counted with points
   the club doesn't use. */
function tournamentSummaryOf(c){
  const s = tournamentSummary(c.matches, c.preset, c.pointsPreset);
  if (!c.pointsPreset) s.mvp = null;
  return s;
}
function renderTournamentSummary(c){
  const s = tournamentSummaryOf(c);
  const when = c.endedAt ? new Date(c.endedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const tile = (label, value) => `<div class="stat-tile"><span class="stat-num">${value}</span><span class="stat-label">${label}</span></div>`;
  const row = (label, who, val) => who ? `<div class="summary-row"><span class="summary-label">${label}</span><span class="summary-who">${who}</span><span class="summary-val n">${val}</span></div>` : "";
  return `
    <div class="summary-hero">
      <div class="eyebrow">${s.shared ? "Joint top" : "Champions"}${when ? ` · ended ${escapeHtml(when)}` : ""}</div>
      ${s.champion ? `<div class="summary-champ">🏆 ${escapeHtml(s.champion.name)}${s.shared && s.runnerUp ? ` &amp; ${escapeHtml(s.runnerUp.name)}` : ""}</div>
        <div class="muted">${s.champion.points} pts · ${s.champion.won} won of ${s.champion.played}${!s.shared && s.runnerUp ? ` · runner-up ${escapeHtml(s.runnerUp.name)}` : ""}</div>`
        : `<div class="summary-champ">No completed matches</div>`}
      <div class="summary-actions">
        <button type="button" data-action="share-tournament" class="primary summary-share">${ICON_SHARE} Share results</button>
        <button type="button" data-action="export-pdf" class="ghost summary-pdf">Export PDF</button>
      </div>
    </div>
    <div class="stat-grid four">${tile("Matches", s.matches)}${tile("Runs", s.runs)}${tile("Wickets", s.wickets)}${tile("Sixes", s.sixes)}</div>
    <div class="summary-card">
      ${row("MVP", s.mvp && escapeHtml(s.mvp.name), s.mvp && `${pointsNum(s.mvp.points)} pts`)}
      ${row("Most runs", s.topBat && escapeHtml(s.topBat.name), s.topBat && `${s.topBat.runs}`)}
      ${row("Most wickets", s.topBowl && escapeHtml(s.topBowl.name), s.topBowl && `${s.topBowl.wickets}`)}
      ${row("Best innings", s.bestInnings && escapeHtml(s.bestInnings.name), s.bestInnings && `${s.bestInnings.runs}${s.bestInnings.notOut ? "*" : ""} (${s.bestInnings.balls})`)}
      ${row("Best bowling", s.bestBowling && escapeHtml(s.bestBowling.name), s.bestBowling && `${s.bestBowling.wickets}/${s.bestBowling.runs}`)}
      ${row("Most dismissals", s.topField && escapeHtml(s.topField.name), s.topField && `${fieldDismissals(s.topField)}`)}
      ${row("Highest total", s.highestTotal && `${escapeHtml(s.highestTotal.team)} <span class="muted">v ${escapeHtml(s.highestTotal.against)}</span>`, s.highestTotal && `${s.highestTotal.runs}-${s.highestTotal.wickets}`)}
    </div>
    ${renderStandingsTable(s.standings, c.preset.useNRR)}
    ${c.kind === "public" ? "" : `<button type="button" data-action="reopen-tournament" class="ghost" style="width:100%;">Reopen tournament</button>`}`;
}

/* The share image: drawn with the share kit in result.js (logo, theme,
   "by Erantha Welikala" footer), previewed in the share sheet first. */
function renderTournamentCanvas(c, themeKey, logo){
  const th = SHARE_THEMES[themeKey] || SHARE_THEMES.night;
  const s = tournamentSummaryOf(c);
  const when = c.endedAt ? new Date(c.endedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  return composeShareImage(th, ctx => {
    const X = SHARE_PAD, W = SHARE_W - SHARE_PAD * 2;
    let y = shareHeader(ctx, th, logo, when);
    shareText(ctx, "TOURNAMENT RESULTS", X, y + 22, { size: 20, weight: 800, color: th.muted, spacing: 4 });
    shareText(ctx, c.name, X, y + 86, { size: 62, weight: 800, color: th.text, maxW: W });
    y += 120;
    // Champion card.
    shareCard(ctx, X, y, W, 220, th.gold, null, 32);
    shareText(ctx, "🏆", X + W - 40, y + 150, { size: 120, align: "right" });
    shareText(ctx, s.shared ? "JOINT TOP" : "CHAMPIONS", X + 36, y + 56, { size: 20, weight: 800, color: th.goldInk, spacing: 4 });
    const champ = s.champion ? (s.shared && s.runnerUp ? `${s.champion.name} & ${s.runnerUp.name}` : s.champion.name) : "No completed matches";
    shareText(ctx, champ, X + 36, y + 126, { size: 64, weight: 800, color: th.goldInk, maxW: W - 220 });
    if (s.champion) shareText(ctx, `${s.champion.points} pts · won ${s.champion.won} of ${s.champion.played}${!s.shared && s.runnerUp ? ` · runner-up ${s.runnerUp.name}` : ""}`, X + 36, y + 178, { size: 26, weight: 700, color: th.goldInk, maxW: W - 220 });
    y += 220 + 28;
    // Stat tiles.
    const tiles = [["Matches", s.matches], ["Runs", s.runs], ["Wickets", s.wickets], ["Sixes", s.sixes]];
    const tw = (W - 3 * 20) / 4;
    tiles.forEach(([label, v], i) => {
      const tx = X + i * (tw + 20);
      shareCard(ctx, tx, y, tw, 132, th.panel, th.line, 24);
      shareText(ctx, v, tx + tw / 2, y + 74, { size: 50, weight: 800, color: th.accent, align: "center" });
      shareText(ctx, label.toUpperCase(), tx + tw / 2, y + 110, { size: 17, weight: 800, color: th.muted, align: "center", spacing: 2 });
    });
    y += 132 + 28;
    // Points table.
    const rows = s.standings;
    const th0 = 90 + rows.length * 62;
    shareCard(ctx, X, y, W, th0, th.panel, th.line);
    shareText(ctx, "POINTS TABLE", X + 32, y + 50, { size: 20, weight: 800, color: th.muted, spacing: 3 });
    const cols = [[W - 32 - (c.preset.useNRR ? 330 : 230), "P"], [W - 32 - (c.preset.useNRR ? 270 : 170), "W"], [W - 32 - (c.preset.useNRR ? 210 : 110), "L"], [W - 32 - (c.preset.useNRR ? 120 : 0), "PTS"]];
    if (c.preset.useNRR) cols.push([W - 32, "NRR"]);
    cols.forEach(([cx, l]) => shareText(ctx, l, X + cx, y + 50, { size: 18, weight: 800, color: th.muted, align: "right", spacing: 2 }));
    rows.forEach((t, i) => {
      const ry = y + 70 + i * 62;
      if (i === 0) shareCard(ctx, X + 16, ry + 4, W - 32, 56, th.faint, null, 16);
      shareCard(ctx, X + 30, ry + 13, 38, 38, i === 0 ? th.gold : th.line, null, 19);
      shareText(ctx, i + 1, X + 49, ry + 41, { size: 20, weight: 800, color: i === 0 ? th.goldInk : th.text, align: "center" });
      shareText(ctx, t.name, X + 88, ry + 43, { size: 28, weight: i === 0 ? 800 : 600, color: th.text, maxW: cols[0][0] - 130 });
      const vals = [t.played, t.won, t.lost, t.points];
      if (c.preset.useNRR) vals.push(`${t.nrr >= 0 ? "+" : ""}${t.nrr.toFixed(2)}`);
      vals.forEach((v, k) => shareText(ctx, v, X + cols[k][0], ry + 43, { size: 28, weight: k === 3 ? 800 : 500, color: k === 3 ? th.accent : th.muted, align: "right" }));
    });
    y += th0 + 28;
    // Highlights: two columns of small cards.
    const hl = [
      ["MVP", s.mvp && s.mvp.name, s.mvp && `${pointsNum(s.mvp.points)} pts`],
      ["Most runs", s.topBat && s.topBat.name, s.topBat && `${s.topBat.runs} runs`],
      ["Most wickets", s.topBowl && s.topBowl.name, s.topBowl && `${s.topBowl.wickets} wkts`],
      ["Best innings", s.bestInnings && s.bestInnings.name, s.bestInnings && `${s.bestInnings.runs}${s.bestInnings.notOut ? "*" : ""} (${s.bestInnings.balls})`],
      ["Best bowling", s.bestBowling && s.bestBowling.name, s.bestBowling && `${s.bestBowling.wickets}/${s.bestBowling.runs}`],
      ["Highest total", s.highestTotal && s.highestTotal.team, s.highestTotal && `${s.highestTotal.runs}-${s.highestTotal.wickets}`]
    ].filter(h => h[1]);
    const hw = (W - 20) / 2;
    hl.forEach(([label, who, val], i) => {
      const hx = X + (i % 2) * (hw + 20), hy = y + Math.floor(i / 2) * 150;
      shareCard(ctx, hx, hy, hw, 130, th.panel, th.line, 24);
      shareText(ctx, label.toUpperCase(), hx + 28, hy + 40, { size: 17, weight: 800, color: th.muted, spacing: 2 });
      shareText(ctx, who, hx + 28, hy + 84, { size: 32, weight: 800, color: th.text, maxW: hw - 56 });
      shareText(ctx, val, hx + 28, hy + 114, { size: 22, weight: 700, color: th.accent, maxW: hw - 56 });
    });
    y += Math.ceil(hl.length / 2) * 150 + 10;
    return shareFooter(ctx, th, logo, y);
  });
}
function shareTournamentResults(){ openSharePreview("tournament"); }

/* --- a tournament's public page (#/t/<id>) ---
   "Share link" on a club tournament gives a link anyone can open, signed in
   or not: the points table, results, scorecards and player stats, read only.
   render() loads it with fetchPublicTournament (straight from the server)
   into ui.publicTournament. Same tabs as the dashboard minus Teams (team lists
   are members-only, 012) and every button that changes something; a member
   of the club also gets Manage, into the club's own dashboard. Guest
   tournaments live on one phone, so they have no link. */
const PUBLIC_TOURNAMENT_TABS = TOURNAMENT_TABS.filter(([id]) => id !== "teams");
function publicTournamentUrl(id){
  return location.origin + location.pathname + "#/t/" + encodeURIComponent(id);
}
function openPublicTournament(id){
  if (ui.publicTournamentId === id) return;
  ui.publicTournamentId = id; ui.publicTournament = null; ui.tournamentTab = null;
}
function loadPublicTournament(id){
  ui.publicTournamentLoading = id;
  return fetchPublicTournament(id).then(t => {
    if (ui.publicTournamentLoading === id) ui.publicTournamentLoading = null;
    if (ui.publicTournamentId !== id) return;
    // A refresh that fails keeps what's on screen and says so.
    const shown = ui.publicTournament && ui.publicTournament.id === id && ui.publicTournament.matches ? ui.publicTournament : null;
    if (t.error && shown) shown.refreshError = t.error;
    else ui.publicTournament = t;
    render();
  });
}
function openPublicInClub(){
  const pt = ui.publicTournament;
  if (!pt || !pt.clubId) return;
  ui.currentClubId = pt.clubId; ui.currentTournamentId = pt.id;
  ui.clubTournament = null; ui.tournamentTeamEdit = null; ui.tournamentTeamError = null; ui.tournamentTab = null; ui.expandedTeamId = null;
  state.view = "clubTournamentDashboard"; render(); // render() loads it
}
function askShareTournamentLink(){
  const club = state.view === "clubTournamentDashboard" ? ui.clubTournament : null;
  const t = club || (state.view === "publicTournament" ? ui.publicTournament : null);
  if (!t || !t.name) return;
  const url = publicTournamentUrl(t.id);
  const unsynced = club ? club.matches.filter(m => m.local).length : 0;
  const canShare = typeof navigator.share === "function";
  askConfirm({
    title: "Share this tournament", icon: "🔗", tone: "primary",
    body: `
      <p>Anyone with this link can see the <b>points table, results, scorecards and player stats</b>, with no sign-in. It's read only: nothing can be changed from it${club ? ", and team lists stay private" : ""}.</p>
      <input type="text" class="share-link-input" readonly value="${escapeHtml(url)}" aria-label="Link to this tournament">
      ${club && club.pending ? `<p>This tournament hasn't synced yet, so the link won't open until it has.</p>`
        : unsynced ? `<p>${unsynced === 1 ? "1 match on this phone hasn't" : `${unsynced} matches on this phone haven't`} synced yet. ${unsynced === 1 ? "It shows" : "They show"} on the link once synced.</p>` : ""}
      ${club && !club.pending ? `<button type="button" data-action="open-public-tournament" data-id="${escapeHtml(t.id)}" class="link-btn">See what they'll see</button>` : ""}`,
    confirmLabel: canShare ? "Share link" : "Copy link",
    busyLabel: canShare ? "Sharing…" : "Copied ✓",
    cancelLabel: "Close",
    // Cancelling the phone's share sheet closes this one too. A copy holds
    // "Copied ✓" on the button for a moment before closing.
    onConfirm: () => canShare
      ? navigator.share({ title: t.name, text: `${t.name}: points table, results and stats`, url }).catch(() => {})
      : (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(() => new Promise(done => setTimeout(done, 900)), () => ({ error: "Couldn't copy it here. Select the link above and copy it." }))
  });
}
function renderPublicTournament(){
  const pt = ui.publicTournament;
  const back = renderBackBar("Home", "home");
  if (!pt || pt.id !== ui.publicTournamentId) return `<div class="screen tournament">${back}${loadingHtml("Loading tournament…")}</div>`;
  if (pt.missing || pt.error) return `
    <div class="screen tournament">
      ${back}
      <h1>🏆 ${pt.missing ? "Tournament not found" : "Can't load this tournament"}</h1>
      <p class="hint">${pt.missing ? "This link doesn't lead to a tournament. Part of it may be missing, or the tournament was removed. Ask whoever sent it for the link again." : escapeHtml(pt.error)}</p>
      ${pt.error ? `<button type="button" data-action="refresh-public-tournament" class="primary">Try again</button>` : ""}
    </div>`;
  const p = pt.preset, ended = !!p.endedAt;
  const tabs = tournamentTabs(ended, PUBLIC_TOURNAMENT_TABS), tab = tournamentTab(ended, PUBLIC_TOURNAMENT_TABS);
  const matches = tournamentRowMatches(pt.matches);
  const latest = [...matches].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 3);
  const member = (ui.myClubs || []).some(c => c.id === pt.clubId);
  const updated = new Date(pt.loadedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `
    <div class="screen tournament">
      ${back}
      <h1>🏆 ${escapeHtml(pt.name)}</h1>
      <p class="tagline">${pt.clubName ? `${escapeHtml(pt.clubName)} · ` : ""}${clubTournamentTagline(p, matches.length)}</p>
      <div class="tournament-links">
        <button type="button" data-action="share-tournament-link" class="ghost small">${ICON_LINK} Share link</button>
        <button type="button" data-action="refresh-public-tournament" class="ghost small">↻ Refresh</button>
        ${member ? `<button type="button" data-action="manage-public-tournament" class="ghost small">Manage</button>` : ""}
      </div>
      ${tabsHtml("switch-tournament-tab", tabs, tab, ended ? "main-tabs many" : "main-tabs")}
      ${tab === "summary" ? renderTournamentSummary(tournamentContext()) : ""}
      ${tab === "overview" ? (matches.length
        ? `${renderStandingsTable(computeStandings(matches, p), p.useNRR)}<h3 class="section-label">Latest results</h3>${renderFixtureList(latest)}`
        : `<p class="hint">No matches yet. The points table fills in as results come in.</p>`) : ""}
      ${tab === "fixtures" ? `<h3 class="section-label">Completed matches</h3>${renderFixtureList(matches)}` : ""}
      ${tab === "stats" ? (matches.length ? renderLeaderboards(aggregatePlayerStats(matches, pt.points), { points: pt.points }) : `<p class="hint">Stats appear once a match is finished.</p>`) : ""}
      <p class="hint public-note">${pt.refreshError ? escapeHtml(pt.refreshError) : `Read only · updated ${escapeHtml(updated)}`}</p>
    </div>`;
}

/* --- result-only fixtures ---
   "Enter result" on a tournament's Overview/Fixtures opens a sheet that
   records a fixture with just each side's runs, wickets and (optionally)
   overs -- createResultOnlyMatch (ENGINE). Archived like a scored match (and
   synced for a club), so the points table and fixtures pick it up; it has
   no scorecard and no player stats. ui.resultEntry = { view } while open. */
function resultEntryDefaults(c){
  if (c.kind === "guest"){
    const mp = state.matchPresets[c.preset.matchPresetId] || DEFAULT_MATCH_PRESETS[0];
    return { oversLimit: mp.oversLimit, playersPerSide: mp.playersPerSide, ballsPerOver: mp.ballsPerOver || 6, lastManStands: !!mp.lastManStands, presetId: mp.id, presetName: mp.name };
  }
  // Club: the conditions of this tournament's latest match, else the club's first preset.
  const last = [...c.matches].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
  if (last) return { oversLimit: last.oversLimit, playersPerSide: last.playersPerSide, ballsPerOver: last.ballsPerOver || 6, lastManStands: !!last.lastManStands, presetId: last.presetId, presetName: last.presetName };
  const mp = matchPresetChoices()[0] || DEFAULT_MATCH_PRESETS[0];
  return { oversLimit: mp.oversLimit, playersPerSide: mp.playersPerSide, ballsPerOver: mp.ballsPerOver || 6, lastManStands: !!mp.lastManStands, presetId: mp.id, presetName: mp.name };
}
function renderResultEntryModal(){
  const c = tournamentContext();
  if (!c) return "";
  const d = resultEntryDefaults(c);
  const names = c.teamNames;
  const teamField = (side, i) => names.length >= 2
    ? `<select name="team${side}" required>${names.map((n, k) => `<option value="${escapeHtml(n)}" ${k === i ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>`
    : `<input name="team${side}" required maxlength="24" placeholder="${side === "A" ? "e.g. Lions" : "e.g. Tigers"}" list="teams-datalist" autocomplete="off">`;
  const scoreRow = side => `
    <div class="result-team">
      <label class="result-team-name">${side === "A" ? "Team A" : "Team B"}${teamField(side, side === "A" ? 0 : 1)}</label>
      <div class="field-row three">
        <label>Runs<input name="runs${side}" type="number" inputmode="numeric" min="0" max="999" required></label>
        <label>Wickets<input name="wkts${side}" type="number" inputmode="numeric" min="0" max="${d.playersPerSide != null ? d.playersPerSide : 99}" required></label>
        <label>Overs <span class="muted">(optional)</span><input name="overs${side}" inputmode="decimal" maxlength="5" placeholder="${d.oversLimit != null ? `e.g. ${d.oversLimit}` : "e.g. 18.3"}" autocomplete="off"></label>
      </div>
    </div>`;
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="result-entry" role="dialog" aria-modal="true" aria-label="Enter a result">
        <div class="wicket-modal-head">
          <h2>Enter a result</h2>
          <button type="button" data-action="close-result-entry" class="sheet-close" aria-label="Close">✕</button>
        </div>
        <p class="hint">No ball-by-ball scoring: just the totals. It counts in the points table, with no scorecard or player stats.</p>
        <form id="result-entry-form">
          <div class="form-error"></div>
          ${scoreRow("A")}
          ${scoreRow("B")}
          <fieldset class="tile-fieldset">
            <legend>Who batted first?</legend>
            <label><input type="radio" name="battingFirst" value="A" checked> Team A</label>
            <label><input type="radio" name="battingFirst" value="B"> Team B</label>
          </fieldset>
          <details class="result-conditions">
            <summary>Conditions: ${d.oversLimit != null ? `${d.oversLimit} overs` : "no overs limit"} · ${d.playersPerSide != null ? `${d.playersPerSide} a side` : "no players limit"}</summary>
            <div class="field-row">
              <label>Overs per innings<input name="oversLimit" type="number" min="1" max="50" value="${limitInputValue(d.oversLimit, 20)}" placeholder="No limit"></label>
              <label>Players per side<input name="players" type="number" min="2" max="11" value="${limitInputValue(d.playersPerSide, 11)}" placeholder="No limit"></label>
            </div>
            <p class="hint">Used for the wickets/overs checks and net run rate. Blank overs count as the full quota in NRR.</p>
          </details>
          <input type="hidden" name="ballsPerOver" value="${d.ballsPerOver}">
          <button type="submit" class="primary" style="width:100%;">Save result</button>
        </form>
      </div>
    </div>`;
}
async function handleResultEntrySubmit(e){
  e.preventDefault();
  const form = e.target, c = tournamentContext();
  if (!c || c.endedAt) return;
  const f = new FormData(form);
  const d = resultEntryDefaults(c);
  const teamA = (f.get("teamA") || "").trim(), teamB = (f.get("teamB") || "").trim();
  if (!teamA || !teamB || teamA.toLowerCase() === teamB.toLowerCase()){ showFormError(form, "Pick two different teams."); return; }
  const battingFirst = f.get("battingFirst") === "B" ? "B" : "A";
  const ballsPerOver = Math.max(1, parseInt(f.get("ballsPerOver"), 10) || 6);
  const config = {
    teamA, teamB, battingFirst, ballsPerOver,
    oversLimit: parseOptionalLimit(f.get("oversLimit"), 1),
    playersPerSide: parseOptionalLimit(f.get("players"), 2),
    lastManStands: d.lastManStands, presetId: d.presetId, presetName: d.presetName, tournamentId: c.id
  };
  const num = v => (v === null || String(v).trim() === "") ? NaN : Number(v);
  const side = k => ({ runs: num(f.get("runs" + k)), wickets: num(f.get("wkts" + k)), balls: parseOversInput(f.get("overs" + k), ballsPerOver) });
  const scores = battingFirst === "A" ? [side("A"), side("B")] : [side("B"), side("A")];
  const err = resultOnlyError(config, scores);
  if (err){ showFormError(form, err); return; }
  const match = createResultOnlyMatch(config, scores);
  if (c.kind === "club"){
    match.clubId = ui.currentClubId || ui.clubTournament.organizer_club_id;
    match.matchType = "tournament";
  }
  const archived = archiveMatch(match);
  ui.resultEntry = null;
  save();
  if (c.kind === "club"){
    await syncMatchToCloud(match, archived);
    await fetchClubTournamentDetail(c.id);
  }
  render();
}
