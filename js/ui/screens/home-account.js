/* Cricket.lk — screens: home, sign in/up, account, settings.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- home --- */
/* "Recent matches" is scoped to the role you're in -- three different
   sources, never mixed: guest = this device's archived matches with no
   clubId; club (Home, "Acting as" a club) = that club's matches, cloud-loaded
   and merged with the local archive by id; Premier = level:"premier" matches
   on the Premier screen. */
function recentMatchesFor(matches, n){
  const byId = new Map();
  matches.forEach(m => byId.set(m.id || `${m.teamA}-${m.teamB}-${m.completedAt}`, m));
  return [...byId.values()].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, n);
}
function renderRecentMatches(title, matches){
  if (!matches.length) return "";
  return `
    <div class="home-section">
      <h3>${escapeHtml(title)}</h3>
      ${matches.map(m => `
        <div class="list-row">
          <span>${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}<br><span class="muted">${escapeHtml(m.result || "")}${m.completedAt ? " · " + new Date(m.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""}</span></span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHome(){
  const matchCount = Object.values(state.matchHistory).filter(m => !m.clubId).length; // guest stats only -- club matches are the club's
  const teamCount = Object.keys(state.teams).length;
  const playerCount = Object.keys(state.players).length;
  const tournaments = Object.values(state.tournaments);
  const b = state.branding || {};

  // A club acting as Home's quick-action target, toggled from the
  // switcher below -- resets itself if the club list loads and no
  // longer contains it (e.g. the user left/was removed from it).
  if (state.activeClubId && ui.myClubs && !ui.myClubs.some(c => c.id === state.activeClubId)){
    state.activeClubId = null;
  }
  const activeClub = state.activeClubId ? (ui.myClubs || []).find(c => c.id === state.activeClubId) : null;
  const clubLoaded = !!(activeClub && ui.club && ui.club.id === activeClub.id);
  const recentMatches = activeClub
    ? recentMatchesFor(clubMatchesFor(activeClub.id), 3)
    : recentMatchesFor(Object.values(state.matchHistory).filter(m => !m.clubId), 3);

  return `
    <div class="screen home">
      <div class="home-header">
        ${b.logo ? `<img src="${b.logo}" class="home-logo" alt="${escapeHtml(b.name || "Logo")}">` : ""}
        <h1>${b.logo ? "" : "🏏 "}<span class="brand-highlight">${escapeHtml(b.name) || "Cricket.lk"}</span></h1>
        <p class="tagline">Ball-by-ball live scorer.</p>
      </div>
      <div class="club-switcher">
        <span class="club-switcher-label">Acting as</span>
        <select id="home-club-switcher">
          <option value="">Guest</option>
          ${session ? (ui.myClubs || []).map(c => `<option value="${c.id}" ${c.id === state.activeClubId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("") : ""}
          <option value="__premier__">🏆 Premier</option>
        </select>
      </div>
      <div class="home-grid">
        ${state.match && state.match.status !== "complete" ? `
          <button data-action="resume-match" class="home-card primary-card">
            <span class="home-card-icon">🔴</span><span class="home-card-title">Resume live match</span>
            <span class="home-card-sub">${escapeHtml(state.match.teamA)} v ${escapeHtml(state.match.teamB)} · ${currentInnings(state.match).runs}-${currentInnings(state.match).wickets}</span>
          </button>
        ` : activeClub ? `
          <button data-action="go-club-match-setup" data-type="practice" class="home-card primary-card">
            <span class="home-card-icon">🏏</span><span class="home-card-title">Practice match</span>
            <span class="home-card-sub">${escapeHtml(activeClub.name)} · home vs home</span>
          </button>
          <button data-action="go-club-match-setup" data-type="friendly" class="home-card">
            <span class="home-card-icon">🤝</span><span class="home-card-title">Friendly match</span>
            <span class="home-card-sub">${escapeHtml(activeClub.name)} · home vs visitors</span>
          </button>
          <button data-action="go-club-tournament-setup" class="home-card">
            <span class="home-card-icon">🏆</span><span class="home-card-title">New tournament</span>
            <span class="home-card-sub">${escapeHtml(activeClub.name)} · Local tier</span>
          </button>
        ` : `
          <button data-action="go-match-setup" class="home-card primary-card">
            <span class="home-card-icon">🏏</span><span class="home-card-title">New match</span>
            <span class="home-card-sub">Score a one-off match</span>
          </button>
          <button data-action="go-tournament-setup" class="home-card">
            <span class="home-card-icon">🏆</span><span class="home-card-title">New tournament</span>
            <span class="home-card-sub">Teams, fixtures, standings</span>
          </button>
        `}
        ${activeClub ? `
          <button data-action="go-club-view" data-view="clubPlayers" class="home-card">
            <span class="home-card-icon">🧑‍🤝‍🧑</span><span class="home-card-title">Players</span>
            <span class="home-card-sub">${clubLoaded ? `${ui.club.roster.length} in ${escapeHtml(activeClub.name)}` : `${escapeHtml(activeClub.name)} roster`}</span>
          </button>
        ` : `
        <button data-action="go-view" data-view="teams" class="home-card">
          <span class="home-card-icon">👥</span><span class="home-card-title">Teams</span>
          <span class="home-card-sub">${teamCount} team${teamCount === 1 ? "" : "s"}</span>
        </button>
        <button data-action="go-view" data-view="players" class="home-card">
          <span class="home-card-icon">🧑‍🤝‍🧑</span><span class="home-card-title">Players</span>
          <span class="home-card-sub">${playerCount} player${playerCount === 1 ? "" : "s"}</span>
        </button>
        `}
        ${activeClub ? `
        <button data-action="go-club-view" data-view="clubPresets" class="home-card">
          <span class="home-card-icon">⚙️</span><span class="home-card-title">Presets</span>
          <span class="home-card-sub">${clubLoaded ? `${ui.club.presets.match.length} match · ${ui.club.presets.tournament.length} tournament` : "Club conditions"}</span>
        </button>
        <button data-action="go-club-view" data-view="clubStats" class="home-card">
          <span class="home-card-icon">📊</span><span class="home-card-title">Stats</span>
          <span class="home-card-sub">${clubMatchesFor(activeClub.id).length} club match${clubMatchesFor(activeClub.id).length === 1 ? "" : "es"}</span>
        </button>` : `
        <button data-action="go-view" data-view="presets" class="home-card">
          <span class="home-card-icon">⚙️</span><span class="home-card-title">Presets</span>
          <span class="home-card-sub">Playing conditions</span>
        </button>
        <button data-action="go-view" data-view="stats" class="home-card">
          <span class="home-card-icon">📊</span><span class="home-card-title">Stats</span>
          <span class="home-card-sub">${matchCount} match${matchCount === 1 ? "" : "es"} played</span>
        </button>`}
      </div>
      ${activeClub
        ? (ui.club && ui.club.id === activeClub.id && ui.club.tournaments.length ? `
        <div class="home-section">
          <h3>Tournaments · ${escapeHtml(activeClub.name)}</h3>
          ${ui.club.tournaments.map(t => `
            <button data-action="open-club-tournament" data-id="${t.id}" class="list-row">
              <span>${escapeHtml(t.name)}${t.pending ? `<span class="pending-tag">not synced</span>` : ""}</span><span class="chevron">›</span>
            </button>
          `).join("")}
        </div>
      ` : "")
        : (tournaments.length ? `
        <div class="home-section">
          <h3>Tournaments</h3>
          ${tournaments.map(t => `
            <button data-action="open-tournament" data-id="${t.id}" class="list-row">
              <span>${escapeHtml(t.name)}</span><span class="chevron">›</span>
            </button>
          `).join("")}
        </div>
      ` : "")}
      ${renderRecentMatches(activeClub ? `Recent matches · ${activeClub.name}` : "Recent matches", recentMatches)}
      ${activeClub ? "" : `<p class="hint" style="margin-top:14px;">Everything is stored on this device. Signing in is optional.</p>`}
    </div>
  `;
}

/* --- sign in / sign up / account --- */
function renderSignIn(){
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>🔐 Sign in</h1>
      ${!supabaseClient ? `<p class="hint">Cloud features aren't configured on this deployment yet.</p>` : `
        <div class="auth-card">
          <form id="sign-in-form">
            <div class="form-error"></div>
            <label>Email<input name="email" type="email" required autocomplete="email"></label>
            <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
            <button type="submit" class="primary">Sign in</button>
          </form>
        </div>
        <p class="hint">No account yet? <button type="button" data-action="go-view" data-view="signUp" class="link-btn">Sign up</button></p>
      `}
    </div>
  `;
}

function renderSignUp(){
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>✨ Sign up</h1>
      ${!supabaseClient ? `<p class="hint">Cloud features aren't configured on this deployment yet.</p>` : `
        <div class="auth-card">
          <form id="sign-up-form">
            <div class="form-error"></div>
            <label>Display name<input name="displayName" required maxlength="40"></label>
            <label>Email<input name="email" type="email" required autocomplete="email"></label>
            <label>Password<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
            <button type="submit" class="primary">Sign up</button>
          </form>
        </div>
        <p class="hint">Already have an account? <button type="button" data-action="go-view" data-view="signIn" class="link-btn">Sign in</button></p>
      `}
    </div>
  `;
}

function renderAccount(){
  if (!session) return renderSignIn();
  const initial = (profile?.display_name || session.user.email || "?").trim().charAt(0).toUpperCase();
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>Account</h1>
      <div class="auth-card">
        <div class="avatar-badge">${escapeHtml(initial)}</div>
        <p class="mvp-name">${escapeHtml(profile?.display_name || "—")}</p>
        <p class="muted">${escapeHtml(session.user.email || "")}</p>
        ${isAdmin ? `<p class="hint">Signed in as platform admin.</p><button data-action="go-admin-portal" class="ghost">Open admin portal</button>` : ""}
        <button data-action="go-my-clubs" class="primary">My clubs</button>
        <button data-action="sign-out" class="ghost">Sign out</button>
      </div>
    </div>
  `;
}

/* --- settings: sound + theme gallery. Deliberately separate from
   Presets, which CLAUDE.md documents as playing-conditions/points
   config -- this screen is app-wide appearance/behavior instead.
   Picking a theme here sets the whole palette (bg/panel/text included,
   not just accents) at once; a pre-existing custom branding accent from
   before the old Presets > Appearance editor was removed still overrides
   it (see applyTheme()), but there's no UI left to create a new one. --- */
function renderSettingsScreen(){
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>🎨 Settings</h1>

      <h3 class="section-label">Sound</h3>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${state.soundEnabled ? "🔊 Sound on" : "🔇 Sound off"}</div>
          <div class="settings-row-sub">Ball, boundary & wicket effects</div>
        </div>
        <button data-action="toggle-sound" class="ghost small">${state.soundEnabled ? "Mute" : "Unmute"}</button>
      </div>

      <h3 class="section-label">Theme</h3>
      <div class="theme-gallery">
        ${THEME_PRESETS.map(t => `
          <button data-action="pick-theme" data-id="${t.id}" class="theme-swatch ${t.id === state.themeId ? "active" : ""}" style="background:${t.vars["--bg-2"]};">
            <span class="theme-swatch-dots"><span style="background:${t.accent}"></span><span style="background:${t.accent2}"></span></span>
            <span class="theme-swatch-name" style="color:${t.vars["--text"]}">${escapeHtml(t.name)}${t.id === state.themeId ? " ✓" : ""}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function handleSignInSubmit(e){
  e.preventDefault();
  if (!supabaseClient) return;
  const form = e.target;
  const f = new FormData(form);
  const email = (f.get("email") || "").trim();
  const password = f.get("password") || "";
  supabaseClient.auth.signInWithPassword({ email, password }).then(({ data, error }) => {
    if (error){ showFormError(form, error.message); return; }
    session = data.session;
    ui.myClubs = null; // force a fresh fetch under the newly-signed-in account
    refreshProfileAndAdmin().then(() => {
      state.view = "account";
      save(); render();
    });
  });
}

function handleSignUpSubmit(e){
  e.preventDefault();
  if (!supabaseClient) return;
  const form = e.target;
  const f = new FormData(form);
  const displayName = (f.get("displayName") || "").trim();
  const email = (f.get("email") || "").trim();
  const password = f.get("password") || "";
  supabaseClient.auth.signUp({
    email, password,
    options: { data: { display_name: displayName } }
  }).then(({ data, error }) => {
    if (error){ showFormError(form, error.message); return; }
    if (!data.session){
      // Email confirmation is required before a session exists.
      state.view = "signIn";
      save(); render();
      return;
    }
    session = data.session;
    refreshProfileAndAdmin().then(() => {
      state.view = "account";
      save(); render();
    });
  });
}
