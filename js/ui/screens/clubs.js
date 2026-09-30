/* Cricket.lk — screens: clubs, club players/presets/stats, player profiles & modals.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- clubs --- */
// The name for ui.currentClubId, without requiring a full fetchClubDetail
// first -- Home's quick-action cards jump straight into these setup
// screens (see "go-club-match-setup"/"go-club-tournament-setup"), so
// ui.club may not be loaded (or may still hold a *different* club's
// detail from an earlier visit). ui.myClubs (fetched for the Home
// switcher) already has the name; prefer the richer ui.club only when
// it's actually for the right club.
function currentClubName(){
  if (ui.club && ui.club.id === ui.currentClubId) return ui.club.name;
  const fromList = (ui.myClubs || []).find(c => c.id === ui.currentClubId);
  return fromList ? fromList.name : "";
}

function renderMyClubs(){
  if (!session) return renderSignIn();
  return `
    <div class="screen">
      ${renderBackBar("Account", "account")}
      <h1>My clubs</h1>
      <form id="create-club-form" class="inline-form">
        <div class="form-error"></div>
        <input name="name" placeholder="Club name" required maxlength="40">
        <button type="submit" class="primary">Create</button>
      </form>
      ${ui.myClubs === null ? `${loadingHtml()}` : ui.myClubs.length ? ui.myClubs.map(c => `
        <button data-action="open-club" data-id="${c.id}" class="list-row">
          <span>${escapeHtml(c.name)}</span><span class="muted">${escapeHtml(c.role)}</span>
        </button>
      `).join("") : `<p class="hint">No clubs yet — create one above.</p>`}
    </div>
  `;
}

function renderClubHome(){
  if (!session) return renderSignIn();
  const club = ui.club;
  return `
    <div class="screen">
      ${renderBackBar("My clubs", "myClubs")}
      ${ui.clubBusy || !club ? `${loadingHtml()}` : `
        <h1>${escapeHtml(club.name)}</h1>
        <p class="hint">To start a practice/friendly match or a new tournament for this club, pick it from the switcher on <button data-action="go-view" data-view="home" class="link-btn">Home</button>.</p>

        <h3 class="section-label">Tournaments</h3>
        ${club.tournaments.length ? club.tournaments.map(t => `
          <button data-action="open-club-tournament" data-id="${t.id}" class="list-row">
            <span>${escapeHtml(t.name)}${t.pending ? `<span class="pending-tag">not synced</span>` : ""}</span><span class="chevron">›</span>
          </button>
        `).join("") : `<p class="hint">No tournaments yet — e.g. group everything played on one day into one.</p>`}

        <h3 class="section-label">Admins</h3>
        ${club.members.map(m => `<div class="list-row"><span>${escapeHtml(m.displayName)}</span><span class="muted">${escapeHtml(m.role)}</span></div>`).join("")}
        <form id="club-invite-admin-form" class="inline-form">
          <input name="email" type="email" placeholder="Email to add as admin" required>
          <button type="submit" class="ghost small">Invite</button>
        </form>
        ${ui.clubInviteMessage ? `<p class="hint">${escapeHtml(ui.clubInviteMessage)}</p>` : ""}

        <h3 class="section-label">Matches</h3>
        ${club.matches.length ? club.matches.map(m => `
          <div class="list-row"><span>${escapeHtml(m.data.teamA)} v ${escapeHtml(m.data.teamB)}</span><span class="muted">${escapeHtml(m.data.result || "")}</span></div>
        `).join("") : `<p class="hint">No matches yet — play one above.</p>`}
      `}
    </div>
  `;
}

/* --- club-scoped screens: Players / Presets / Stats. Reached from Home's
   tiles (and the side menu) while "Acting as" a club, they show only that
   club's cloud data -- never the guest lists. ui.currentClubId is the club
   (set by "go-club-view" from state.activeClubId). --- */
function clubMatchesFor(clubId){
  const local = Object.values(state.matchHistory).filter(m => m.clubId === clubId);
  const cloud = ui.club && ui.club.id === clubId ? ui.club.matches.map(x => x.data).filter(Boolean) : [];
  const byId = new Map();
  local.concat(cloud).forEach(m => byId.set(m.id || `${m.teamA}-${m.teamB}-${m.completedAt}`, m));
  return [...byId.values()];
}

function renderClubScreen(title, bodyFn){
  if (!session) return renderSignIn();
  const clubId = ui.currentClubId;
  const club = ui.club && ui.club.id === clubId ? ui.club : null;
  return `
    <div class="screen">
      ${renderBackBar("Home", "home")}
      <h1>${escapeHtml(currentClubName() || "Club")} · ${title}</h1>
      <p class="hint guest-note">Club ${title.toLowerCase()} — stored in the cloud for this club only. Guest data on this device is never shown here.</p>
      ${!club || ui.clubBusy ? `${loadingHtml()}` : bodyFn(club)}
    </div>
  `;
}

/* Resize an uploaded image to a small square JPEG data URL (centre-cropped),
   stepping quality down until it fits the 80,000-character column limit. */
function resizeImageToDataUrl(file, size = 240){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const side = Math.min(img.width, img.height);
      canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.82, out = canvas.toDataURL("image/jpeg", q);
      while (out.length > 70000 && q > 0.3){ q -= 0.1; out = canvas.toDataURL("image/jpeg", q); }
      out.length <= 80000 ? resolve(out) : reject(new Error("Image is too detailed to store."));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image the browser can read.")); };
    img.src = url;
  });
}

/* Shared by the profile editor and the club "add player" form. The photo is a
   hidden data-URL input plus a preview, handled generically (closest
   .photo-field) so it works in either form without ids. */
function photoFieldHtml(photo, initial){
  const preview = photo
    ? `<img class="profile-photo photo-preview" src="${photo}" alt="">`
    : `<div class="avatar-badge photo-preview">${escapeHtml(initial)}</div>`;
  return `
    <div class="profile-photo-edit photo-field" data-initial="${escapeHtml(initial)}">
      ${preview}
      <div>
        <input type="hidden" name="photo" value="${photo}">
        <label class="ghost small file-btn">Choose photo<input class="photo-file-input" type="file" accept="image/*" hidden></label>
        <button type="button" data-action="clear-photo" class="ghost small">Remove</button>
        <p class="hint" style="margin:6px 0 0;">Shrunk to a small square before saving.</p>
      </div>
    </div>`;
}
function playerDetailFieldsHtml(d){
  const opt = (v, cur, label) => `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return `
    <div class="field-row" style="grid-template-columns:1fr 96px;">
      <label>Nickname<input name="nickname" value="${escapeHtml(d.nickname || "")}" placeholder="e.g. Mahi" maxlength="24" autocomplete="off"></label>
      <label>Jersey no<input name="jersey_no" value="${d.jersey_no == null ? "" : escapeHtml(String(d.jersey_no))}" inputmode="numeric" pattern="[0-9]{1,3}" placeholder="7" maxlength="3" autocomplete="off"></label>
    </div>
    <label>City <span class="muted">(optional)</span><input name="city" value="${escapeHtml(d.city || "")}" placeholder="e.g. Kandy" maxlength="40"></label>
    <div class="field-row">
      <label>Batting<select name="batting_hand">${opt("", d.batting_hand || "", "Not set")}${opt("right", d.batting_hand, "Right-hand")}${opt("left", d.batting_hand, "Left-hand")}</select></label>
      <label>Bowling arm<select name="bowling_arm">${opt("", d.bowling_arm || "", "Not set")}${opt("right", d.bowling_arm, "Right-arm")}${opt("left", d.bowling_arm, "Left-arm")}</select></label>
    </div>
    <label>Bowling style<select name="bowling_type">${opt("", d.bowling_type || "", "Not set / doesn't bowl")}${Object.entries(BOWLING_TYPES).map(([v, l]) => opt(v, d.bowling_type, l)).join("")}</select></label>
    <label class="check-row"><input type="checkbox" name="is_keeper" ${d.is_keeper ? "checked" : ""}> Wicket-keeper</label>`;
}
function readPlayerDetails(f){
  return {
    batting_hand: f.get("batting_hand") || "", bowling_arm: f.get("bowling_arm") || "", bowling_type: f.get("bowling_type") || "",
    is_keeper: f.get("is_keeper") === "on", city: (f.get("city") || "").trim(), photo: f.get("photo") || "",
    nickname: (f.get("nickname") || "").trim(), jersey_no: (f.get("jersey_no") || "").trim()
  };
}

function handlePlayerProfileSubmit(e){
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const pr = ui.profile;
  const canContact = pr.data.can_see_contact;
  const phone = (f.get("phone") || "").trim();
  const nic = normalizeNic(f.get("nic"));
  const details = readPlayerDetails(f);
  if (!isValidPhone(phone)){ showFormError(form, "Contact number should be 7–15 digits (optionally starting with +)."); return; }
  if (!isValidNic(nic)){ showFormError(form, "NIC should be 9 digits + V/X, or 12 digits."); return; }
  const detailsError = playerDetailsError(details);
  if (detailsError){ showFormError(form, detailsError); return; }
  const newName = normalizePlayerName(f.get("playerName"));
  const nameError = playerNameError(newName);
  if (nameError){ showFormError(form, nameError); return; }
  const oldName = pr.data.name || pr.name;
  // Rename first: a taken name is the likeliest failure, and nothing else is
  // saved until it's sorted out.
  const renameStep = newName !== oldName ? renamePlayer(pr.id, newName) : Promise.resolve({ ok: true });
  const contactStep = renameStep.then(r => {
    if (r.error) return r;
    if (r.name && r.name !== oldName) applyPlayerRename(pr, oldName, r.name);
    return canContact ? updatePlayerProfile(pr.id, phone, nic) : { ok: true };
  });
  contactStep.then(r => {
    if (r && r.error){ showFormError(form, r.error); return null; }
    return updatePlayerDetails(pr.id, details);
  }).then(r => {
    if (r === null) return;
    if (r && r.error){ showFormError(form, r.error); return; }
    if (canContact){ pr.data.phone = phone || null; pr.data.nic = nic || null; }
    Object.assign(pr.data, { batting_hand: details.batting_hand || null, bowling_arm: details.bowling_arm || null, bowling_type: details.bowling_type || null,
      is_keeper: details.is_keeper, city: details.city || null, photo: details.photo || null, details_unavailable: false });
    if (!pr.data.kit_unavailable) Object.assign(pr.data, { nickname: details.nickname || null, jersey_no: parseJerseyNo(details.jersey_no) });
    ui.playerModal = null; pr.message = "Saved.";
    // The roster list shows name/jersey/nickname, so refresh it if it's this club's.
    if (pr.scope === "club" && ui.currentClubId) fetchClubDetail(ui.currentClubId).then(render);
    render();
  });
}

/* Mirror a successful rename into what's on screen: the profile, its alias
   list (the old name joins it, the new one leaves it if it was a former
   name) and the Premier list. The club roster is re-fetched by the caller.
   Past matches keep the name they were scored with. */
function applyPlayerRename(pr, oldName, newName){
  pr.name = newName; pr.data.name = newName;
  const lower = newName.toLowerCase();
  pr.aliases = (pr.aliases || []).filter(a => a.toLowerCase() !== lower);
  if (oldName.toLowerCase() !== lower && !pr.aliases.some(a => a.toLowerCase() === oldName.toLowerCase())) pr.aliases.push(oldName);
  const listed = ui.premier && ui.premier.players.find(p => p.id === pr.id);
  if (listed) listed.name = newName;
}

/* Who can edit this profile, and the claim / merge actions (all approved by a
   platform admin). A person may hold one claimed profile; a second profile
   that is also them has to be merged into it instead of claimed. */
function renderOwnershipBlock(pr, d, canEdit){
  const id = ui.identity;
  const me = session ? session.user.id : null;
  const note = t => `<p class="hint">${t}</p>`;
  let inner;
  if (d.claimed_by){
    inner = me && d.claimed_by === me
      ? note("This is your profile. Only you and platform admins can edit it.")
      : note("Claimed by the player — only they (and platform admins) can edit this profile.");
  } else if (!session){
    inner = note("Unclaimed. Sign in to claim this profile if it's you.");
  } else if (!id){
    inner = note("Checking your claim status…");
  } else if (pr.claiming || pr.merging){
    const merging = pr.merging;
    inner = `
      <form id="${merging ? "merge-request-form" : "claim-request-form"}" class="preset-form" style="margin-top:6px;">
        <div class="form-error"></div>
        ${merging ? note(`Merge this profile into <b>${escapeHtml(id.myPlayer.name)}</b>, your claimed profile. Its name becomes one of your aliases, its club rosters move to you and its stats are counted as yours.`)
                  : note("A platform admin checks this before the profile becomes yours.")}
        ${merging ? "" : `<label>Your contact no <span class="muted">(optional)</span><input name="phone" type="tel" maxlength="16" placeholder="07x xxx xxxx" autocomplete="off"></label>`}
        <label>Note for the admin <span class="muted">(optional)</span><input name="note" maxlength="200" placeholder="${merging ? "e.g. I used to be listed as this" : "e.g. I play for Colombo CC"}"></label>
        <div style="display:flex;gap:10px;">
          <button type="button" data-action="close-ownership-form" class="ghost" style="width:112px;flex-shrink:0;">Cancel</button>
          <button type="submit" class="primary" style="flex-grow:1;margin-top:0;">${merging ? "Request merge" : "Send claim"}</button>
        </div>
      </form>`;
  } else if (id.myPlayer){
    inner = id.pendingMerges.some(m => m.from_player_id === d.id)
      ? note("Your merge request for this profile is waiting for admin approval.")
      : `${note(`You've already claimed <b>${escapeHtml(id.myPlayer.name)}</b> — one person can only have one profile. If this one is also you, request a merge into it.`)}
         <button data-action="open-merge-form" class="ghost small">This is also me — request merge</button>`;
  } else if (id.pendingClaim){
    inner = id.pendingClaim.player_id === d.id
      ? note("Your claim on this profile is waiting for admin approval.")
      : note("You already have a claim waiting for approval on another profile. You can only claim one player.");
  } else {
    inner = `${note(canEdit ? "Unclaimed — you can edit it because your club added this player. Once the player claims it, only they can." : "Unclaimed. Only the club that added this player can edit it until they claim it themselves.")}
       <button data-action="open-claim-form" class="ghost small">This is me — claim profile</button>`;
  }
  return `<h3 class="section-label">Ownership</h3><div class="auth-card" style="margin-top:0;">${inner}</div>`;
}

function renderPlayerProfile(){
  const pr = ui.profile;
  const isClub = pr.scope === "club";
  const back = isClub ? renderBackBar("Players", "clubPlayers") : renderBackBar("Premier players", "premierPlayers");
  const d = pr.data;
  const f1 = n => n == null ? "—" : n.toFixed(1);
  const stat = (label, value) => `<div class="stat-tile"><span class="n stat-num">${value}</span><span class="stat-label">${label}</span></div>`;
  // Two separate tiers (club matches / Premier matches), never merged -- and
  // inside each, batting / bowling / fielding are separate sections too.
  const grid = tiles => `<div class="stat-grid">${tiles.join("")}</div>`;
  const hs = c => c.highScore ? `${c.highScore.runs}${c.highScore.out ? "" : "*"}` : "—";
  const statsBlock = (title, career, emptyHint, note) => {
    if (!career) return `<h3 class="section-label">${title}</h3><p class="hint">${emptyHint}</p>`;
    const batting = career.innings > 0
      ? grid([stat("Innings", career.innings), stat("Runs", career.runs), stat("Balls", career.balls),
              stat("Highest", hs(career)), stat("Average", f1(career.average)), stat("Strike rate", f1(career.strikeRate)),
              stat("Not outs", career.notOuts), stat("Ducks", career.ducks), stat("4s", career.fours),
              stat("6s", career.sixes), stat("50s", career.fifties), stat("100s", career.hundreds)])
      : `<p class="hint">Hasn't batted yet.</p>`;
    const bowling = career.bowlInnings > 0
      ? grid([stat("Innings", career.bowlInnings), stat("Overs", oversDisplay(career.legalBalls, 6)), stat("Maidens", career.maidens),
              stat("Runs", career.runsConceded), stat("Wickets", career.wickets), stat("Best", career.best ? `${career.best.wickets}/${career.best.runs}` : "—"),
              stat("Average", f1(career.bowlAverage)), stat("Economy", f1(career.economy)), stat("Strike rate", f1(career.bowlStrikeRate))])
      : `<p class="hint">Hasn't bowled yet.</p>`;
    const fielding = (career.catches + career.runouts) > 0
      ? grid([stat("Catches", career.catches), stat("Run-outs", career.runouts), stat("Dismissals", career.fieldDismissals)])
      : `<p class="hint">No catches or run-outs yet.</p>`;
    return `
      <h3 class="section-label">${title}</h3>
      <div class="tier-summary"><span class="tag-pill">${career.matches} match${career.matches === 1 ? "" : "es"}</span><span class="tag-pill gold">${career.points} MVP pts</span></div>
      <h4 class="stat-sub">Batting</h4>${batting}
      <h4 class="stat-sub">Bowling</h4>${bowling}
      <h4 class="stat-sub">Fielding</h4>${fielding}
      <p class="hint">${note}</p>
    `;
  };
  const clubMatches = isClub ? clubMatchesFor(ui.currentClubId) : (pr.clubMatches || []);
  const clubLabel = isClub ? (currentClubName() || "club") : "your clubs";
  const clubBlock = statsBlock(
    `Club matches · ${escapeHtml(clubLabel)}`, playerCareer([pr.name, ...(pr.aliases || [])], clubMatches),
    isClub ? "No matches for this player in this club yet."
      : pr.clubMatches === undefined ? "Loading…"
      : session ? "No matches for this player in the clubs you belong to yet." : "Sign in to see club stats from your clubs.",
    isClub ? "From this club's archived matches only." : "From matches of the clubs you belong to only — club stats elsewhere aren't visible from here."
  );
  const premierBlock = statsBlock(
    "Premier matches", playerCareer([pr.name, ...(pr.aliases || [])], ui.premier ? ui.premier.premierMatches.map(m => m.data).filter(Boolean) : []),
    ui.premier ? "No Premier matches yet for this player." : "Loading…", "From Premier archived matches only."
  );
  const sections = isClub ? [clubBlock, premierBlock] : [premierBlock, clubBlock];
  const initial = (pr.name || "?").trim().charAt(0).toUpperCase();
  const photo = d ? safePhoto(d.photo) : "";
  const canEdit = !!(d && d.can_see_contact);   // server-decided (supabase/009): the claimant, an admin, or -- only while unclaimed -- a member of the club that added them
  const avatar = p => p ? `<img class="profile-photo" src="${p}" alt="">` : `<div class="avatar-badge">${escapeHtml(initial)}</div>`;

  let body = "";
  if (pr.loading) body = `<div class="auth-card" style="margin-top:0;">${loadingHtml()}</div>`;
  else if (pr.error) body = `<div class="auth-card" style="margin-top:0;"><p class="hint">${escapeHtml(pr.error)}</p></div>`;
  else {
    const batting = formatBatting(d.batting_hand), bowling = formatBowling(d.bowling_arm, d.bowling_type);
    body = `
      ${d.details_unavailable ? (canEdit ? `<p class="hint guest-note">Batting, bowling, keeper, city and photo need supabase/008_player_details.sql to be run in the Supabase SQL editor.</p>` : "") : `
      <h3 class="section-label">Details</h3>
      <div class="auth-card" style="margin-top:0;">
        <div class="profile-row"><span class="profile-key">Batting</span><span>${batting ? escapeHtml(batting) : `<span class="muted">Not set</span>`}</span></div>
        <div class="profile-row"><span class="profile-key">Bowling</span><span>${bowling ? escapeHtml(bowling) : `<span class="muted">Not set</span>`}</span></div>
        <div class="profile-row"><span class="profile-key">Wicket-keeper</span><span>${d.is_keeper ? "Yes" : `<span class="muted">No</span>`}</span></div>
        <div class="profile-row"><span class="profile-key">City</span><span>${d.city ? escapeHtml(d.city) : `<span class="muted">Not set</span>`}</span></div>
      </div>`}
      ${d.kit_unavailable ? (canEdit && !d.details_unavailable ? `<p class="hint guest-note">Nickname and jersey no need supabase/010_player_nickname_jersey.sql to be run in the Supabase SQL editor.</p>` : "") : ""}
      <h3 class="section-label">Profile</h3>
      <div class="auth-card" style="margin-top:0;">
        <div class="profile-row"><span class="profile-key">Name</span><span>${escapeHtml(d.name)}</span></div>
        ${d.kit_unavailable ? "" : `
          <div class="profile-row"><span class="profile-key">Nickname</span><span>${d.nickname ? escapeHtml(d.nickname) : `<span class="muted">Not set</span>`}</span></div>
          <div class="profile-row"><span class="profile-key">Jersey no</span><span>${d.jersey_no != null ? `#${d.jersey_no}` : `<span class="muted">Not set</span>`}</span></div>`}
        ${(pr.aliases || []).length ? `<div class="profile-row"><span class="profile-key">Also played as</span><span>${pr.aliases.map(escapeHtml).join(", ")}</span></div>` : ""}
        ${canEdit ? `
          <div class="profile-row"><span class="profile-key">Contact no</span><span>${d.phone ? escapeHtml(d.phone) : `<span class="muted">Not set</span>`}</span></div>
          <div class="profile-row"><span class="profile-key">NIC</span><span>${d.nic ? escapeHtml(d.nic) : `<span class="muted">Not set</span>`}</span></div>
        ` : `
          <div class="profile-row"><span class="profile-key">Contact no</span><span class="muted">Private</span></div>
          <div class="profile-row"><span class="profile-key">NIC</span><span class="muted">Private</span></div>
          <p class="hint" style="margin-top:8px;">Contact number and NIC are visible only to this player and admins — or, until the player claims the profile, the club that added them.</p>
        `}
        ${pr.message ? `<p class="hint">${escapeHtml(pr.message)}</p>` : ""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px;">
        ${canEdit ? `<button data-action="edit-player-profile" class="ghost small">Edit profile</button>` : ""}
        ${isClub && onClubRoster(pr.id) ? `<button data-action="ask-remove-club-player" data-id="${escapeHtml(pr.id)}" data-name="${escapeHtml(pr.name)}" class="ghost small danger-text">Remove from club</button>` : ""}
      </div>`;
  }
  return `
    <div class="screen">
      ${back}
      <div class="profile-head">
        ${avatar(photo)}
        <div>
          <h1 style="margin:0;">${d && d.jersey_no != null ? `<span class="jersey-no">#${d.jersey_no}</span> ` : ""}${escapeHtml(pr.name)}</h1>
          ${d && d.nickname ? `<div class="muted" style="font-size:.85rem;">“${escapeHtml(d.nickname)}”</div>` : ""}
          <div class="profile-badges">
            ${d && d.claimed_by ? `<span class="required-badge">${session && d.claimed_by === session.user.id ? "THIS IS YOU" : "CLAIMED"}</span>` : ""}
            ${d && d.is_keeper ? `<span class="required-badge">KEEPER</span>` : ""}
            ${d && d.city ? `<span class="muted" style="font-size:.78rem;">📍 ${escapeHtml(d.city)}</span>` : ""}
          </div>
        </div>
      </div>
      ${body}
      ${!pr.loading && !pr.error && d ? renderOwnershipBlock(pr, d, canEdit) : ""}

      ${sections.join("")}
    </div>
  `;
}

/* Is this player on the currently loaded club's roster? (Gates "Remove from
   club" -- the roster is members-only, so a loaded roster means a member.) */
function onClubRoster(playerId){
  return !!(ui.club && ui.club.id === ui.currentClubId && ui.club.roster.some(p => p.id === playerId));
}

function renderClubPlayers(){
  const loaded = !!(session && ui.club && ui.club.id === ui.currentClubId && !ui.clubBusy);
  // The FAB sits outside .screen: .screen animates a transform, which would
  // make a position:fixed child position against it during the animation.
  return renderClubScreen("Players", club => `
    ${ui.clubAddMessage ? `<p class="hint guest-note">${escapeHtml(ui.clubAddMessage)}</p>` : ""}
    ${club.roster.length ? club.roster.map(p => p.id && String(p.id).startsWith(TEMP_ID_PREFIX)
      ? `<div class="list-row roster-row">
          <span class="roster-open" style="cursor:default;"><span>${escapeHtml(playerLabel(p))}<span class="pending-tag">not synced</span></span></span>
          <button data-action="ask-remove-club-player" data-id="${p.id}" data-name="${escapeHtml(p.name)}" class="roster-remove" aria-label="Remove ${escapeHtml(p.name)} from club" title="Remove from club">✕</button>
        </div>`
      : p.id
      ? `<div class="list-row roster-row">
          <button data-action="open-player-profile" data-scope="club" data-id="${p.id}" data-name="${escapeHtml(p.name)}" class="roster-open"><span>${escapeHtml(playerLabel(p))}</span><span class="chevron">›</span></button>
          <button data-action="ask-remove-club-player" data-id="${p.id}" data-name="${escapeHtml(p.name)}" class="roster-remove" aria-label="Remove ${escapeHtml(p.name)} from club" title="Remove from club">✕</button>
        </div>`
      : `<div class="list-row"><span>${escapeHtml(p.name)}<span class="pending-tag">not synced</span></span></div>`).join("") : `<p class="hint">No players yet — tap + to add one.</p>`}
    <div class="fab-spacer"></div>
  `) + (loaded ? `<button data-action="open-club-add-player" class="fab" aria-label="Add player" title="Add player">+</button>` : "");
}

/* --- player modals (club Players / profile). ui.playerModal is
   { kind: "add" | "edit" | "remove", id?, name? }; not persisted. render()
   keeps an already-open one's DOM (see modalKey) so a background fetch that
   re-renders the page can't wipe what's been typed. --- */
/* The "Already on the platform" block under the add sheet's name field.
   Filled straight into the DOM by the input listener (no render()), so the
   rest of the form keeps what's been typed. */
function platformSuggestHtml(query, players){
  if (!players.length) return "";
  const rosterIds = new Set(ui.club && ui.club.id === ui.currentClubId ? ui.club.roster.map(p => p.id) : []);
  const exact = players.find(p => p.name.toLowerCase() === query.trim().toLowerCase());
  return `
    <div class="section-label" style="margin-top:4px;">Already on the platform</div>
    ${players.map(p => {
      const photo = safePhoto(p.photo);
      const avatar = photo ? `<img class="suggest-avatar" src="${photo}" alt="">` : `<span class="suggest-avatar avatar-badge">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>`;
      const inClub = rosterIds.has(p.id);
      return `
        <div class="suggest-row">
          ${avatar}
          <span class="suggest-name">${escapeHtml(playerLabel(p))}${p.city ? `<span class="muted"> · ${escapeHtml(p.city)}</span>` : ""}</span>
          ${inClub ? `<span class="muted" style="font-size:.75rem;">In your club</span>`
            : `<button type="button" data-action="add-existing-club-player" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" class="ghost small">Add to club</button>`}
        </div>`;
    }).join("")}
    <p class="hint" style="margin:4px 0 10px;">${exact && rosterIds.has(exact.id)
      ? `“${escapeHtml(exact.name)}” is already in your club. Add someone else, or pick another player above.`
      : exact
      ? `“${escapeHtml(exact.name)}” already exists — submitting this name adds that player rather than creating a new one, and the details below won't be applied. Use “Add to club” to pick the right person.`
      : "Pick one to add them as they are, or keep typing to create a new player."}</p>`;
}

function renderClubAddPlayerModal(){
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Add player</h2>
        <form id="club-add-player-form" class="preset-form" style="margin:0;">
          <div class="form-error"></div>
          <label>Name<input name="name" placeholder="Player name" required maxlength="24" autocomplete="off"></label>
          <div class="platform-suggest" hidden></div>
          <div class="field-row">
            <label>Contact no<input name="phone" type="tel" placeholder="07x xxx xxxx" maxlength="16" autocomplete="off"></label>
            <label>NIC<input name="nic" placeholder="901234567V" maxlength="14" autocomplete="off"></label>
          </div>
          ${playerDetailFieldsHtml({})}
          ${photoFieldHtml("", "?")}
          <p class="hint">Everything except the name is optional. If they're already on the platform they just join your roster — their profile is then edited by the club that first added them until they claim it, and by the player after that. Contact number and NIC are never shown to other clubs.</p>
          <div style="display:flex;gap:10px;">
            <button type="button" data-action="close-player-modal" class="ghost" style="width:112px;flex-shrink:0;">Cancel</button>
            <button type="submit" class="primary" style="flex-grow:1;margin-top:0;">Add player</button>
          </div>
        </form>
      </div>
    </div>`;
}
function renderPlayerEditModal(){
  const pr = ui.profile, d = pr.data;
  const initial = (pr.name || "?").trim().charAt(0).toUpperCase();
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Edit ${escapeHtml(pr.name)}</h2>
        <form id="player-profile-form" style="margin:0;">
          <div class="form-error"></div>
          ${photoFieldHtml(safePhoto(d.photo), initial)}
          <label>Name<input name="playerName" value="${escapeHtml(d.name || pr.name || "")}" required maxlength="24" autocomplete="off"></label>
          <p class="hint" style="margin-top:-6px;">Renaming keeps the old name as an alias, so past scorecards still count for this player.</p>
          ${d.can_see_contact ? `
            <label>Contact no<input name="phone" type="tel" value="${escapeHtml(d.phone || "")}" placeholder="07x xxx xxxx" maxlength="16" autocomplete="off"></label>
            <label>NIC<input name="nic" value="${escapeHtml(d.nic || "")}" placeholder="901234567V" maxlength="14" autocomplete="off"></label>` : ""}
          ${playerDetailFieldsHtml(d)}
          <div style="display:flex;gap:10px;">
            <button type="button" data-action="close-player-modal" class="ghost" style="width:112px;flex-shrink:0;">Cancel</button>
            <button type="submit" class="primary" style="flex-grow:1;margin-top:0;">Save</button>
          </div>
        </form>
      </div>
    </div>`;
}
/* Removal has no undo, so it goes through the shared confirmation sheet. */
function askRemoveClubPlayer(id, name){
  const clubId = ui.currentClubId;
  askConfirm({
    title: `Remove ${name} from ${currentClubName() || "this club"}?`, icon: "👤",
    body: `<p>They come off this club's roster only. Their player profile, their past match stats and any other clubs they're on stay as they are, and you can add them again later.</p>`,
    confirmLabel: "Remove player", busyLabel: "Removing…",
    onConfirm: () => removePlayerFromClub(clubId, id).then(r => {
      if (r.error) return r;
      ui.clubAddMessage = `${name} was removed from the club roster.`;
      if (state.view === "playerProfile") state.view = "clubPlayers";
      save();
      fetchClubDetail(clubId).then(render);
    })
  });
}

function renderClubPresets(){
  return renderClubScreen("Presets", club => `
    <h3 class="section-label">Match presets</h3>
    ${clubPresetList("match", club.id).map(p => matchPresetCardHtml(p, false, "club-edit-match-preset", "club-delete-match-preset")).join("") || `<p class="hint">No match presets yet.</p>`}
    ${ui.editingClubMatchPreset ? renderMatchPresetForm(ui.editingClubMatchPreset, club.id) : `<button data-action="club-new-match-preset" class="link-btn">+ New match preset</button>`}
    <h3 class="section-label">Tournament presets</h3>
    ${clubPresetList("tournament", club.id).map(p => tournamentPresetCardHtml(p, "", false, "club-edit-tournament-preset", "club-delete-tournament-preset")).join("") || `<p class="hint">No tournament presets yet.</p>`}
    ${ui.editingClubTournamentPreset ? renderTournamentPresetForm(ui.editingClubTournamentPreset, club.id) : `<button data-action="club-new-tournament-preset" class="link-btn">+ New tournament preset</button>`}
  `);
}

function renderClubStats(){
  return renderClubScreen("Stats", club => {
    const matches = clubMatchesFor(club.id);
    return matches.length
      ? renderLeaderboards(aggregatePlayerStats(matches)) + `<p class="hint">Read from ${matches.length} archived club match${matches.length === 1 ? "" : "es"} only.</p>`
      : `<p class="hint">Play and finish a club match to see stats here.</p>`;
  });
}

function handleCreateClubSubmit(e){
  e.preventDefault();
  const form = e.target;
  const name = (new FormData(form).get("name") || "").trim();
  if (!name) return;
  if (name.toLowerCase() === "premier"){
    // "PREMIER" is reserved for the cross-club Home switcher entry -- also
    // enforced server-side (clubs_name_not_reserved), this just avoids a
    // round trip for the common case.
    showFormError(form, `"Premier" is reserved and can't be used as a club name.`);
    return;
  }
  createClub(name).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    fetchMyClubs().then(render);
  });
}

function handleClubAddPlayerSubmit(e){
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const name = (f.get("name") || "").trim();
  const phone = (f.get("phone") || "").trim();
  const nic = normalizeNic(f.get("nic"));
  const details = readPlayerDetails(f);
  if (!name) return;
  if (!isValidPhone(phone)){ showFormError(form, "Contact number should be 7–15 digits (optionally starting with +)."); return; }
  if (!isValidNic(nic)){ showFormError(form, "NIC should be 9 digits + V/X, or 12 digits."); return; }
  const detailsError = playerDetailsError(details);
  if (detailsError){ showFormError(form, detailsError); return; }
  ui.clubAddMessage = null;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;   // no double-add on a slow network
  addPlayerToClub(ui.currentClubId, name, { phone, nic, details }).then(result => {
    if (submit) submit.disabled = false;
    // "Added, but couldn't save ..." means the roster row exists already --
    // close the sheet (re-submitting would just hit "already on the platform").
    const partial = result && result.error && result.error.startsWith("Added,");
    if (result && result.error && !partial){ showFormError(form, result.error); return; }
    ui.playerModal = null;
    if (partial) ui.clubAddMessage = result.error;
    else if (result && result.queued) ui.clubAddMessage = `${name} added on this device. They'll sync to the club when you're online.`;
    else if (result && result.created === false){
      const typed = phone || nic || playerHasDetails(details);
      ui.clubAddMessage = `${name} is already on the platform, so they were added to your roster as they are${typed ? " — the details you entered weren't applied" : ""}. Only the club that first added them, or the player after claiming, can edit their profile.`;
    } else ui.clubAddMessage = `${name} added.`;
    // A brand-new name also just became a global (Premier) player -- refresh
    // that list too if it was already loaded, so it doesn't show stale.
    if (ui.premier) fetchPremierData();
    render();
    fetchClubDetail(ui.currentClubId).then(render);
  });
}

function handleClubInviteAdminSubmit(e){
  e.preventDefault();
  const form = e.target;
  const email = (new FormData(form).get("email") || "").trim();
  if (!email) return;
  inviteClubAdmin(ui.currentClubId, email).then(result => {
    if (result && result.error){ showFormError(form, result.error); return; }
    ui.clubInviteMessage = result.result === "ok" ? "Added." : result.result === "already_member" ? "Already an admin." : "No account found with that email.";
    fetchClubDetail(ui.currentClubId).then(render);
  });
}
