/* Cricket.lk — screens: Premier players/teams/stats, claims & merges.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- Premier: cross-club players/stats + claiming --- */
/* computeStandings() needs a tournament-preset-shaped object for its
   points/NRR config, but Premier matches aren't organized under any
   real tournament preset (see fetchPremierData()'s comment) -- this is
   just fixed display config for the Teams section below, not a stored
   preset. */
const PREMIER_STANDINGS_DISPLAY_PRESET = { pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true };

// Dashboard entry point: same card-grid pattern as Home, not a long
// scrolling page. Each card jumps into its own sub-screen below, all
// reading the same ui.premier fetched once by "go-premier"/the Home
// switcher -- no extra fetch needed per card.
function renderPremierScreen(){
  const p = ui.premier;
  const pendingCount = (isAdmin && p) ? p.pendingClaims.length + p.pendingMerges.length : 0;
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>🏆 Premier</h1>
      <p class="tagline">Cross-club players, teams and stats.</p>
      ${!p ? `${loadingHtml()}` : `
        <div class="home-grid">
          <button data-action="go-view" data-view="premierPlayers" class="home-card primary-card">
            <span class="home-card-icon">🧑‍🤝‍🧑</span><span class="home-card-title">Players</span>
            <span class="home-card-sub">${p.players.length} player${p.players.length === 1 ? "" : "s"}${pendingCount ? ` · ${pendingCount} pending` : ""}</span>
          </button>
          <button data-action="go-view" data-view="premierTeams" class="home-card">
            <span class="home-card-icon">🛡️</span><span class="home-card-title">Teams</span>
            <span class="home-card-sub">${p.premierMatches.length ? "Standings" : "No Premier matches yet"}</span>
          </button>
          <button data-action="go-view" data-view="premierStats" class="home-card">
            <span class="home-card-icon">📊</span><span class="home-card-title">Stats</span>
            <span class="home-card-sub">${p.premierMatches.length ? "Leaderboards" : "No Premier matches yet"}</span>
          </button>
        </div>
        ${renderRecentMatches("Recent Premier matches", recentMatchesFor(p.premierMatches.map(m => m.data).filter(Boolean), 5))}
      `}
    </div>
  `;
}

function renderPremierPlayers(){
  const p = ui.premier;
  const nameOf = id => { const pl = p.players.find(x => x.id === id); return pl ? pl.name : "a profile"; };
  return `
    <div class="screen">
      ${renderBackBar("Premier", "premier")}
      <h1>🧑‍🤝‍🧑 Players</h1>
      ${!p ? `${loadingHtml()}` : `
        ${isAdmin && p.pendingClaims.length ? `
          <h3>Pending claim requests</h3>
          ${p.pendingClaims.map(c => `
              <div class="list-row">
                <span>${escapeHtml(nameOf(c.player_id))}${c.claimed_phone ? ` · ${escapeHtml(c.claimed_phone)}` : ""}${c.note ? `<br><span class="muted">${escapeHtml(c.note)}</span>` : ""}</span>
                <span class="action-row">
                  <button data-action="approve-claim" data-id="${c.id}" class="ghost small">Approve</button>
                  <button data-action="reject-claim" data-id="${c.id}" class="ghost small">Reject</button>
                </span>
              </div>`).join("")}
        ` : ""}
        ${isAdmin && p.pendingMerges.length ? `
          <h3>Pending merge requests</h3>
          ${p.pendingMerges.map(m => `
              <div class="list-row">
                <span>${escapeHtml(nameOf(m.from_player_id))} → ${escapeHtml(nameOf(m.into_player_id))}${m.note ? `<br><span class="muted">${escapeHtml(m.note)}</span>` : ""}</span>
                <span class="action-row">
                  <button data-action="approve-merge" data-id="${m.id}" class="ghost small">Approve</button>
                  <button data-action="reject-merge" data-id="${m.id}" class="ghost small">Reject</button>
                </span>
              </div>`).join("")}
        ` : ""}

        ${p.players.length ? `
          <input type="search" class="list-search" data-premier-search data-keep-focus="premier-search" data-nav-ignore
            value="${escapeHtml(ui.premierPlayerQuery || "")}" placeholder="Search a name, nickname or #jersey" aria-label="Search players"
            autocomplete="off" enterkeyhint="search">` : ""}
        <div class="premier-player-list">${premierPlayerRowsHtml()}</div>
        ${ui.claimMessage ? `<p class="hint">${escapeHtml(ui.claimMessage)}</p>` : ""}
      `}
    </div>
  `;
}
/* The rows under Premier → Players' search box, for ui.premierPlayerQuery
   (word starts, like every name search: nameSearchHit). Also refilled
   straight into the DOM as you type (the input listener), with no render().
   At most PREMIER_LIST_MAX rows: the platform can hold thousands. */
const PREMIER_LIST_MAX = 100;
function premierPlayerRowsHtml(){
  const p = ui.premier;
  if (!p || !p.players.length) return `<p class="hint">No players yet.</p>`;
  const q = (ui.premierPlayerQuery || "").trim();
  const hits = q ? p.players.filter(pl => nameSearchHit(pl.searchKey, q)) : p.players;
  if (!hits.length) return `<p class="hint">No player matches “${escapeHtml(q)}”. Try another spelling, a nickname or a jersey no.</p>`;
  const shown = hits.slice(0, PREMIER_LIST_MAX);
  return shown.map(pl => `
    <div class="list-row">
      <button data-action="open-player-profile" data-scope="premier" data-id="${escapeHtml(pl.id)}" data-name="${escapeHtml(pl.name)}" class="name-link">${escapeHtml(playerLabel(pl))}</button>
      <span class="muted">${pl.claimed_by ? (session && pl.claimed_by === session.user.id ? "Claimed by you" : "Claimed") : "Unclaimed"}</span>
    </div>`).join("")
    + (hits.length > shown.length ? `<p class="hint">Showing ${shown.length} of ${hits.length}. ${q ? "Keep typing to narrow it down." : "Search to find a player."}</p>` : "");
}

function renderPremierTeams(){
  const p = ui.premier;
  return `
    <div class="screen">
      ${renderBackBar("Premier", "premier")}
      <h1>🛡️ Teams</h1>
      ${!p ? `${loadingHtml()}` : (
        p.premierMatches.length
          ? renderStandingsTable(computeStandings(p.premierMatches.map(m => m.data), PREMIER_STANDINGS_DISPLAY_PRESET), true)
          : `<p class="hint">No Premier matches yet — organizing a Premier tournament (open for any club to join) is coming soon.</p>`
      )}
    </div>
  `;
}

function renderPremierStats(){
  const p = ui.premier;
  return `
    <div class="screen">
      ${renderBackBar("Premier", "premier")}
      <h1>📊 Stats</h1>
      ${!p ? `${loadingHtml()}` : (
        p.premierMatches.length
          // Premier is stats only: no MVP points (renderLeaderboards leaves the table out).
          ? renderLeaderboards(aggregatePlayerStats(p.premierMatches.map(m => m.data)), { points: null, matches: p.premierMatches.map(m => m.data) })
          : `<p class="hint">No Premier matches yet.</p>`
      )}
    </div>
  `;
}

function handleClaimRequestSubmit(e){
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const phone = (f.get("phone") || "").trim();
  if (!isValidPhone(phone)){ showFormError(form, "Contact number should be 7–15 digits (optionally starting with +)."); return; }
  requestClaim(ui.profile.id, phone, (f.get("note") || "").trim()).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    ui.profile.claiming = false;
    ui.profile.message = "Claim requested — a platform admin will review it.";
    fetchMyPlayerIdentity().then(render);
  });
}

/* The player's own way out (023): unclaim their profile, or withdraw a claim
   or merge still waiting. From Account's Player profile card or the profile's
   Ownership box. */
function askUnclaimProfile(){
  const mine = ui.identity && ui.identity.myPlayer;
  if (!mine) return;
  const merges = ui.identity.pendingMerges.length;
  askConfirm({
    title: `Unclaim ${mine.name}?`,
    icon: "↩",
    body: `<p>The profile stays on Cricket.lk with its stats and matches, but it's no longer yours: the club that added this player can edit it again, and you lose your view-only access to its clubs.${merges ? ` Your ${merges === 1 ? "merge request" : `${merges} merge requests`} into it ${merges === 1 ? "is" : "are"} withdrawn.` : ""} To get it back you'd claim it again and wait for approval.</p>`,
    choices: [
      { value: "remove", label: "Remove my contact no & NIC", sub: "The club won't see them" },
      { value: "keep", label: "Leave them on the profile", sub: "The club can see them" }
    ],
    choice: "remove",
    confirmLabel: "Unclaim",
    busyLabel: "Unclaiming…",
    onConfirm: choice => releaseMyClaim(choice === "remove").then(res => res.error ? res : refreshAfterOwnershipChange())
  });
}
function askWithdrawRequest(kind, requestId){
  const id = ui.identity;
  if (!id) return;
  const req = kind === "claim" ? id.pendingClaim : id.pendingMerges.find(m => m.id === requestId);
  if (!req) return;
  const name = `<b>${escapeHtml(req.name || "that profile")}</b>`;
  askConfirm({
    title: kind === "claim" ? "Withdraw your claim?" : "Withdraw this merge request?",
    body: `<p>${kind === "claim" ? `Your claim on ${name} won't be reviewed.` : `${name} won't be merged into ${escapeHtml(id.myPlayer ? id.myPlayer.name : "your profile")}.`} You can ask again later.</p>`,
    confirmLabel: "Withdraw",
    busyLabel: "Withdrawing…",
    onConfirm: () => withdrawMyRequest(kind, req.id).then(res => res.error ? res : refreshAfterOwnershipChange())
  });
}
/* After a claim changes hands: who the viewer is, the profile on screen (its
   Ownership box and who may edit it) and My clubs (020's read-only clubs
   follow the claim; Home drops an "Acting as" club that's gone). */
function refreshAfterOwnershipChange(){
  ui.myClubs = null;
  const pr = ui.profile;
  const profile = state.view === "playerProfile" && pr && pr.id
    ? fetchPlayerProfile(pr.id).then(r => { if (ui.profile === pr && !r.error) pr.data = r.data; })
    : null;
  return Promise.all([fetchMyPlayerIdentity(), profile]).catch(() => {}).then(() => { render(); });
}

function handleMergeRequestSubmit(e){
  e.preventDefault();
  const form = e.target;
  requestMerge(ui.profile.id, (new FormData(form).get("note") || "").trim()).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    ui.profile.merging = false;
    ui.profile.message = "Merge requested — a platform admin will review it.";
    fetchMyPlayerIdentity().then(render);
  });
}
