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

        ${p.players.length ? p.players.map(pl => `
          <div class="list-row">
            <button data-action="open-player-profile" data-scope="premier" data-id="${pl.id}" data-name="${escapeHtml(pl.name)}" class="name-link">${escapeHtml(pl.name)}</button>
            <span class="muted">${pl.claimed_by ? (session && pl.claimed_by === session.user.id ? "Claimed by you" : "Claimed") : "Unclaimed"}</span>
          </div>`).join("") : `<p class="hint">No players yet.</p>`}
        ${ui.claimMessage ? `<p class="hint">${escapeHtml(ui.claimMessage)}</p>` : ""}
        <p class="hint">Open a player to claim their profile or request a merge — a platform admin approves both.</p>
      `}
    </div>
  `;
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
          ? renderLeaderboards(aggregatePlayerStats(p.premierMatches.map(m => m.data)))
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
