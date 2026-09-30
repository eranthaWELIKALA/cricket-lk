/* Cricket.lk — sync pill/sheet and side menu.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
function renderSyncPill(){
  if (!session) return "";
  const pending = pendingCount(), failed = failedCount();
  const offline = !isOnline() || session.offline;
  if (!pending && !failed && !offline) return "";
  const cls = failed ? "failed" : offline ? "offline" : syncState.running ? "syncing" : "pending";
  const label = failed ? `${failed} not synced` : offline ? (pending ? `Offline · ${pending}` : "Offline") : syncState.running ? "Syncing…" : `${pending} to sync`;
  const icon = failed ? ICON_WARN : offline ? ICON_CLOUD_OFF : ICON_CLOUD;
  const count = failed || pending;
  return `<button data-action="open-sync-sheet" class="topbar-sync ${cls}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}<span class="short">${count ? count : ""}</span><span class="long">${escapeHtml(label)}</span></button>`;
}
function renderSyncSheet(){
  const ops = myOps();
  const offline = !isOnline() || (session && session.offline);
  const failed = ops.filter(o => o.failed);
  const when = syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="sync">
        <div class="wicket-modal-head"><h2>Sync</h2><span class="n batter">${offline ? "offline" : syncState.running ? "syncing…" : when ? `last synced ${when}` : "online"}</span></div>
        <p class="hint" style="margin-top:0;">${offline
          ? "You're offline. Everything you do is saved on this device and sent to the cloud automatically when you're back online."
          : !ops.length ? "Everything is synced."
          : failed.length === ops.length ? "These changes are saved on this device, but the cloud refused them."
          : "These changes are saved on this device and are being sent to the cloud."}</p>
        ${ops.length ? `<div class="sync-list">${ops.map(o => `
          <div class="sync-row${o.failed ? " failed" : ""}">
            <div class="sync-row-text"><span class="title">${escapeHtml(describeOp(o))}</span>
              <span class="sub">${o.failed ? escapeHtml(o.error || "Couldn't sync") : `waiting · ${new Date(o.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}</span></div>
            ${o.failed ? `<div class="sync-row-actions">
              <button data-action="sync-retry" data-id="${o.id}" class="ghost small" ${offline ? "disabled" : ""}>Retry</button>
              <button data-action="sync-discard" data-id="${o.id}" class="icon-btn danger" aria-label="Discard this change" title="Discard">${ICON_DELETE}</button>
            </div>` : ""}
          </div>`).join("")}</div>` : ""}
        ${failed.length ? `<p class="hint">A change that couldn't sync was refused by the server (for example a team name that's already taken). Fix it and retry, or discard it.</p>` : ""}
        <div class="confirm-actions">
          <button data-action="close-sync-sheet" class="ghost">Close</button>
          <button data-action="sync-now" class="primary" ${offline || syncState.running || !ops.length ? "disabled" : ""}>${syncState.running ? "Syncing…" : failed.length ? "Retry all" : "Sync now"}</button>
        </div>
      </div>
    </div>`;
}

function renderSideMenu(){
  if (!ui.sideMenuOpen) return "";
  const clubRole = state.activeClubId ? (ui.myClubs || []).find(c => c.id === state.activeClubId) : null;
  const items = [
    ...(state.match && state.match.status !== "complete" ? [{ action: "resume-match", icon: "🔴", label: "Live match" }] : []),
    { view: "home", icon: "🏠", label: "Home" },
    { action: "go-premier", icon: "🏆", label: "Premier" },
    // Teams / Players / Presets / Stats are per role: the guest ones (on this
    // device) only in guest mode; while acting as a club, one "Club" entry
    // (that club's roster, presets and stats, all cloud) instead.
    ...(clubRole
      ? [
        { action: "go-club-view", view: "clubPlayers", icon: "🧑‍🤝‍🧑", label: "Players" },
        { action: "go-club-view", view: "clubPresets", icon: "⚙️", label: "Presets" },
        { action: "go-club-view", view: "clubStats", icon: "📊", label: "Stats" }
      ]
      : [
        { view: "teams", icon: "👥", label: "Teams" },
        { view: "players", icon: "🧑‍🤝‍🧑", label: "Players" },
        { view: "presets", icon: "⚙️", label: "Presets" },
        { view: "stats", icon: "📊", label: "Stats" }
      ]),
    { view: "settings", icon: "🎨", label: "Settings" },
    { action: "go-account", icon: "👤", label: session ? "Account" : "Sign in" }
  ];
  return `
    <div class="side-menu-backdrop" data-action="close-side-menu"></div>
    <nav class="side-menu">
      <button data-action="close-side-menu" class="ghost small side-menu-close">✕</button>
      <h2>🏏 Cricket.lk</h2>
      ${items.map(it => `
        <button data-action="${it.action || "go-view"}" ${it.view ? `data-view="${it.view}"` : ""} ${it.id ? `data-id="${it.id}"` : ""} class="side-menu-item">
          <span class="icon">${it.icon}</span><span>${escapeHtml(it.label)}</span>
        </button>
      `).join("")}
    </nav>
  `;
}
function activeTournament(){ return state.activeTournamentId ? state.tournaments[state.activeTournamentId] : null; }
