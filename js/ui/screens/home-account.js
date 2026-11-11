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
        <button type="button" data-action="open-match-detail" data-id="${escapeHtml(m.id || "")}" class="list-row">
          <span>${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}<br><span class="muted">${escapeHtml(m.result || "")}${m.completedAt ? " · " + new Date(m.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""}</span></span>
          <span class="chevron">›</span>
        </button>
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
  // A club the user plays for but isn't a member of (supabase/020): read only.
  const playerOnly = !!(activeClub && !clubCanEdit(activeClub.id));
  const clubMatchCount = activeClub ? clubMatchesFor(activeClub.id).length : 0;
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
      ${GUEST_EDITION ? "" : `<div class="club-switcher">
        <span class="club-switcher-label">Acting as</span>
        <select id="home-club-switcher">
          <option value="">Guest</option>
          ${session ? (ui.myClubs || []).map(c => `<option value="${c.id}" ${c.id === state.activeClubId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("") : ""}
          <option value="__premier__">🏆 Premier</option>
        </select>
      </div>`}
      ${playerOnly ? `<p class="hint guest-note">You play for ${escapeHtml(activeClub.name)}: view only.</p>` : ""}
      <div class="home-grid">
        ${state.match && state.match.status !== "complete" ? `
          <button data-action="resume-match" class="home-card primary-card">
            <span class="home-card-icon">🔴</span><span class="home-card-title">Resume live match</span>
            <span class="home-card-sub">${escapeHtml(state.match.teamA)} v ${escapeHtml(state.match.teamB)} · ${currentInnings(state.match).runs}-${currentInnings(state.match).wickets}</span>
          </button>
        ` : playerOnly ? `
          <button data-action="go-club-view" data-view="clubStats" class="home-card primary-card">
            <span class="home-card-icon">📊</span><span class="home-card-title">Stats</span>
            <span class="home-card-sub">${escapeHtml(activeClub.name)} · ${clubMatchCount} club match${clubMatchCount === 1 ? "" : "es"}</span>
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
        ${playerOnly ? "" : activeClub ? `
        <button data-action="go-club-view" data-view="clubPresets" class="home-card">
          <span class="home-card-icon">⚙️</span><span class="home-card-title">Presets</span>
          <span class="home-card-sub">${clubLoaded ? `${ui.club.presets.match.length} match · ${ui.club.presets.tournament.length} tournament` : "Club conditions"}</span>
        </button>
        <button data-action="go-club-view" data-view="clubStats" class="home-card">
          <span class="home-card-icon">📊</span><span class="home-card-title">Stats</span>
          <span class="home-card-sub">${clubMatchCount} club match${clubMatchCount === 1 ? "" : "es"}</span>
        </button>
        ${isClubAdmin(activeClub.id) ? `
        <button data-action="go-club-view" data-view="clubAdmins" class="home-card">
          <span class="home-card-icon">🛡️</span><span class="home-card-title">Admins</span>
          <span class="home-card-sub">${clubLoaded ? `${ui.club.members.length} admin${ui.club.members.length === 1 ? "" : "s"}${(ui.club.invites || []).length ? ` · ${ui.club.invites.length} invited` : ""}` : "Invite & manage"}</span>
        </button>` : ""}` : `
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
        ${renderAuthNotice("signIn")}
        ${renderAuthMailCard()}
        <div class="auth-card">
          <form id="sign-in-form">
            <div class="form-error"></div>
            <label>Email<input name="email" type="email" required autocomplete="email"></label>
            <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
            <button type="submit" class="primary">Sign in</button>
          </form>
        </div>
        <p class="hint auth-switch">No account yet? <button type="button" data-action="go-view" data-view="signUp" class="link-btn">Sign up</button></p>
      `}
    </div>
  `;
}

function renderSignUp(){
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>✨ Sign up</h1>
      ${!supabaseClient ? `<p class="hint">Cloud features aren't configured on this deployment yet.</p>` : authMail && authMail.kind === "signup" && authMail.status !== "failed" ? renderAuthMailCard() : `
        ${renderAuthMailCard()}
        <div class="auth-card">
          <form id="sign-up-form">
            <div class="form-error"></div>
            <label>Display name<input name="displayName" required maxlength="40"></label>
            <label>Email<input name="email" type="email" required autocomplete="email"></label>
            <label>Password<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
            <button type="submit" class="primary">Sign up</button>
          </form>
        </div>
        <p class="hint auth-switch">Already have an account? <button type="button" data-action="go-view" data-view="signIn" class="link-btn">Sign in</button></p>
      `}
    </div>
  `;
}

/* What happened when the app was opened from a confirmation email
   (authNotice, set by finishAuthReturn in CLOUD), on the view it names. */
function renderAuthNotice(view){
  const n = authNotice;
  if (!n || n.view !== view) return "";
  return `<div class="auth-card auth-mail-card" role="status">
    <p class="mvp-name">${n.icon} ${escapeHtml(n.title)}</p>
    <p class="hint">${escapeHtml(n.text)}</p>
    <button type="button" data-action="auth-notice-dismiss" class="link-btn">Dismiss</button>
  </div>`;
}

/* The queued sign-up / confirmation email (authMail, CLOUD) -- shown on the
   sign-in and sign-up screens: waiting out the mailer's rate limit, sent
   ("check your inbox" + resend), unconfirmed (offer a resend) or failed. */
function renderAuthMailCard(){
  const job = authMail;
  if (!job) return "";
  const email = `<strong>${escapeHtml(job.email)}</strong>`;
  const what = job.kind === "signup" ? "Your sign-up" : "The confirmation email";
  // Resend stays off for a while after each email (authResendWait, CLOUD);
  // tickAuthCooldown counts it down in the DOM.
  const resendBtn = label => {
    const left = authCooldownLeft(job);
    if (left > 0) startAuthCooldownTick();
    return `<button type="button" data-action="auth-mail-send" class="ghost small" data-label="${escapeHtml(label)}"${left > 0 ? ` data-auth-cooldown disabled` : ""}>${escapeHtml(left > 0 ? authCooldownLabel(left) : label)}</button>`;
  };
  let body;
  if (job.status === "waiting"){
    const at = new Date(job.nextAt).toLocaleTimeString([], job.shortWait ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
    body = `
      <p class="mvp-name">📮 ${job.shortWait ? "Queued: one email a minute" : "Queued: email limit reached"}</p>
      <p class="hint">${job.shortWait ? "We can only send one email a minute to an address." : "We can only send a few emails an hour right now."} ${what} for ${email} is queued, and we'll try again automatically at ${escapeHtml(at)}.
        ${job.kind === "signup" ? "Keep this page open: closing it cancels the sign-up." : ""}</p>
      <button type="button" data-action="auth-mail-send" class="ghost small">Try now</button>
      <button type="button" data-action="auth-mail-cancel" class="link-btn">Cancel</button>`;
  } else if (job.status === "sending"){
    body = `<p class="mvp-name">📮 Sending…</p><p class="hint">${what} for ${email}.</p>`;
  } else if (job.status === "sent"){
    body = `
      <p class="mvp-name">✉️ Check your inbox</p>
      <p class="hint">We sent a confirmation link to ${email}. Open it, then sign in here. Can't find it? It can take a minute or two: check spam, or resend it.</p>
      ${resendBtn("Resend email")}`;
  } else if (job.status === "unconfirmed"){
    body = `
      <p class="mvp-name">✉️ Confirm your email first</p>
      <p class="hint">${email} hasn't been confirmed yet. Open the link we emailed you, or get a new one.</p>
      ${resendBtn("Resend confirmation email")}`;
  } else {
    body = `
      <p class="mvp-name">Couldn't send the email</p>
      <p class="hint">${escapeHtml(job.error || "")}</p>
      ${job.kind === "resend" ? `<button type="button" data-action="auth-mail-send" class="ghost small">Try again</button>` : ""}
      <button type="button" data-action="auth-mail-cancel" class="link-btn">Dismiss</button>`;
  }
  return `<div class="auth-card auth-mail-card" role="status">${body}</div>`;
}

function renderAccount(){
  if (!session) return renderSignIn();
  const initial = (profile?.display_name || session.user.email || "?").trim().charAt(0).toUpperCase();
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>Account</h1>
      ${renderAuthNotice("account")}
      <div class="auth-card">
        <div class="avatar-badge">${escapeHtml(initial)}</div>
        <p class="mvp-name">${escapeHtml(profile?.display_name || "—")}</p>
        <p class="muted">${escapeHtml(session.user.email || "")}</p>
        ${isAdmin ? `<p class="hint">Signed in as platform admin.</p><button data-action="go-admin-portal" class="ghost">Open admin portal</button>` : ""}
        <div class="auth-actions">
          <button data-action="go-my-clubs" class="primary">My clubs</button>
          <button data-action="sign-out" class="ghost">Sign out</button>
        </div>
      </div>
      ${renderMyPlayerCard()}
    </div>
  `;
}
/* Account → Player profile: the way in for someone who plays for a club but
   isn't one of its members (so has no club screens). Lists the profile they've
   claimed (with the names merged into it) and any claim or merge still
   waiting, each with its own way out: Unclaim, or Withdraw (023). With none of
   those, a search for their profile. One person holds one claimed profile
   (009); a second one that's also them is merged into it, which is why the
   merged names show under it.
   ui.identity is loaded by render() and reset on every visit (go-account). */
function renderMyPlayerCard(){
  if (!supabaseClient) return "";
  const id = ui.identity;
  const row = (name, sub, tag, buttons) => `
    <div class="my-profile-row">
      <div class="my-profile-main">
        <span class="my-profile-name">${escapeHtml(name || "A player")}${tag}</span>
        ${sub ? `<span class="my-profile-sub">${sub}</span>` : ""}
      </div>
      ${buttons}
    </div>`;
  const tag = (text, gold) => `<span class="tag-pill${gold ? " gold" : ""}">${text}</span>`;
  const openBtn = (pid, name) => `<button data-action="open-player-profile" data-scope="premier" data-id="${escapeHtml(pid)}" data-name="${escapeHtml(name || "")}" class="ghost small">Open</button>`;
  const withdrawBtn = (kind, rid) => `<button data-action="withdraw-request" data-kind="${kind}" data-id="${escapeHtml(rid)}" class="ghost small">Withdraw</button>`;
  let inner;
  if (needsInternet()) inner = `<p class="hint">Your player profile needs an internet connection.</p>`;
  else if (!id) inner = loadingHtml();
  else if (id.myPlayer){
    const me = id.myPlayer, aliases = me.aliases || [];
    inner = `
      ${row(me.name, aliases.length ? `Also played as ${aliases.map(escapeHtml).join(", ")}` : "", tag("Claimed", true), "")}
      ${id.pendingMerges.map(m => row(m.name, `Waiting to be merged into ${escapeHtml(me.name)}`, tag("Merge waiting"),
          `<div class="my-profile-btns">${openBtn(m.from_player_id, m.name)}${withdrawBtn("merge", m.id)}</div>`)).join("")}
      <div class="auth-actions">
        <button data-action="open-my-profile" class="primary">My stats & matches</button>
        <button data-action="unclaim-profile" class="ghost">Unclaim this profile</button>
      </div>`;
  }
  else if (id.pendingClaim) inner = `
    ${row(id.pendingClaim.name, "Waiting for a platform admin to approve it. We'll email you when it's approved.", tag("Claim waiting"),
        `<div class="my-profile-btns"><button data-action="open-my-profile" class="ghost small">Open</button>${withdrawBtn("claim", id.pendingClaim.id)}</div>`)}`;
  else inner = `
    <p class="hint">Play for a club? Find your profile to see your stats and matches, and claim it.</p>
    <button data-action="find-my-profile" class="primary">Find my profile</button>`;
  return `<h3 class="section-label">Player profile</h3><div class="auth-card my-player-card" style="margin-top:0;">${inner}</div>`;
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
    if (isEmailNotConfirmed(error)){
      // Offer a resend; it goes through the same rate-limit-aware queue.
      cancelAuthMail();
      queueAuthMail({ kind: "resend", email, status: "unconfirmed" });
      render(); return;
    }
    if (error){ showFormError(form, isAuthRateLimit(error) ? "Too many sign-in attempts. Wait a minute and try again." : error.message); return; }
    completeSignIn(data.session);
  });
}

/* Shared by sign-in, sign-up and a queued sign-up that went through. */
function completeSignIn(newSession){
  cancelAuthMail();
  authNotice = null;
  session = newSession;
  ui.myClubs = null; // force a fresh fetch under the newly-signed-in account
  ui.identity = null;
  return refreshProfileAndAdmin().then(() => {
    // Came from a profile's "Sign in to claim": back to that profile.
    const back = ui.afterSignIn;
    ui.afterSignIn = null;
    if (back){ openPlayerProfile("premier", back.id, back.name); state.view = "playerProfile"; }
    else state.view = "account";
    save(); render();
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
    options: { data: { display_name: displayName }, emailRedirectTo: authRedirectUrl() }
  }).then(({ data, error }) => {
    if (error && isAuthRateLimit(error)){
      // The mailer's limit: queue it and keep retrying (see authMail). A
      // "wait N seconds" (an email went to this address a moment ago) is
      // retried after exactly that.
      cancelAuthMail();
      const secs = authRetryAfter(error);
      queueAuthMail({ kind: "signup", email, displayName, password, status: "waiting" }, secs != null ? Math.max(1, secs) * 1000 : 0);
      render(); return;
    }
    if (error){ showFormError(form, error.message); return; }
    if (!data.session){
      // Email confirmation is required before a session exists.
      cancelAuthMail();
      queueAuthMail({ kind: "resend", email, status: "sent" });
      state.view = "signIn";
      save(); render();
      return;
    }
    completeSignIn(data.session);
  });
}
