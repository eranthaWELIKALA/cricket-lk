/* Cricket.lk — match: opening/new batsman/new bowler/match options/wicket sheets.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- opening / new-batsman / new-bowler modals --- */
function renderOpeningModal(match){
  const inn = currentInnings(match);
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="opening">
        <h2>${escapeHtml(teamName(match, inn.battingTeam))} — opening players</h2>
        <form id="opening-form">
          <div class="form-error"></div>
          ${renderNameCombo("Striker", `name="striker" required maxlength="24" placeholder="Search players"`, pickCandidates(match, pickPool(inn.battingTeam), "batter"))}
          ${renderNameCombo("Non-striker", `name="nonStriker" required maxlength="24" placeholder="Search players"`, pickCandidates(match, pickPool(inn.battingTeam), "batter"))}
          ${renderNameCombo(`${escapeHtml(teamName(match, inn.bowlingTeam))} bowler`, `name="bowler" required maxlength="24" placeholder="Search players"`, pickCandidates(match, pickPool(inn.bowlingTeam), "bowler"))}
          <button type="submit" class="primary">Start innings</button>
        </form>
        ${match.innings.length === 1 ? `<button type="button" data-action="swap-toss" class="link-btn">Wrong toss? ${escapeHtml(teamName(match, inn.bowlingTeam))} bats first instead</button>` : ""}
        <button type="button" data-action="open-match-menu" class="link-btn">Match options: cancel, forfeit${match.squads ? ", switch players" : ""}</button>
        ${state.snapshots.length ? `<div class="modal-footer-hint"><p class="hint">${match.innings.length === 1 ? "Undo goes back to the match as it was before the restart." : "Undo goes back to the innings break."}</p><button type="button" data-action="undo" class="undo-chip">UNDO</button></div>` : ""}
      </div>
    </div>
  `;
}

/* Forfeit goes through the shared confirmation sheet, with the two teams as
   `choices`: picking a team and confirming are two separate taps -- a
   forfeit has no working undo (the Result screen has no Undo control). */
function askForfeit(){
  const m = state.match;
  if (!m || m.status === "complete") return;
  ui.matchMenu = null;
  const cur = currentInnings(m);
  const order = cur.battingTeam === "A" ? ["A", "B"] : ["B", "A"];
  askConfirm({
    title: "Forfeit this match?", icon: "🚩",
    body: `<p>The match ends now at <b class="n">${cur.runs}-${cur.wickets} (${oversDisplay(cur.legalBalls, cur.ballsPerOver)})</b> and the other team wins. No margin is worked out, and this innings is left out of net run rate.</p><p><b>Which team forfeits?</b></p>`,
    choices: order.map(key => ({ value: key, label: teamName(m, key), sub: forfeitTeamLine(m, key) })),
    confirmLabel: "End match",
    onConfirm: team => {
      pushSnapshot();
      forfeitMatch(state.match, team);
      maybeArchiveCompletedMatch(state.match);
      save();
    }
  });
}

/* "Batting"/"Bowling" here means "currently" or "next" -- at the break,
   the team that just finished batting reads as "Bowling" (their role in
   the innings about to start), and the team yet to bat at all reads as
   "Yet to bat", covering every point forfeitMatch can fire from (see
   CLAUDE.md's "Forfeiting a match"). */
function forfeitTeamLine(match, teamKey){
  const inn = match.innings.find(i => i.battingTeam === teamKey);
  if (!inn) return "Yet to bat";
  const scoreStr = `${inn.runs}-${inn.wickets}`;
  if (inn === currentInnings(match) && !inn.complete) return `Batting · ${scoreStr}`;
  const allOut = inn.complete && inn.completeReason === "allout";
  return `Bowling · ${scoreStr}${allOut ? " all out" : ""}`;
}

/* Live screen + new-batsman/new-bowler sheets: close the innings by hand
   when there's no overs or players limit (see canEndInningsByHand). Asks
   first (handleEndInnings) -- in the 2nd innings this ends the match. */
function renderEndInningsButton(match, inn, inline){
  if (!canEndInningsByHand(inn)) return "";
  const last = match.innings.length === 2;
  return `<button type="button" data-action="end-innings" class="link-btn${inline ? "" : " end-innings-sheet"}">${last ? "End innings · finish match" : "End innings"}</button>`;
}

/* "Match options" (the top bar's ⋯, or the opening sheet's link): change
   who bats first, switch players between squads, forfeit, cancel. One
   sheet whose content follows ui.matchMenu ("menu" | "squads"), like the
   wicket sheet -- never a separate screen. Checked in render() before the
   opening/batsman/bowler sheets, so it can interrupt any of them. The
   risky rows (toss restart, forfeit, cancel) go through askConfirm. */
function renderMatchMenuModal(match){
  const view = ui.matchMenu;
  const cur = currentInnings(match);
  const started = matchHasStarted(match);
  const otherFirst = match.battingFirst === "A" ? "B" : "A";
  const scoreLine = `${cur.runs}-${cur.wickets} (${oversDisplay(cur.legalBalls, cur.ballsPerOver)})`;
  const sheet = (inner, danger) => `<div class="modal-backdrop"><div class="modal${danger ? " danger" : ""}" data-keep-scroll="match-${view}">${inner}</div></div>`;

  if (view === "squads" && match.squads){
    const side = key => {
      const other = key === "A" ? "B" : "A";
      const names = match.squads[key] || [];
      return `
        <div class="squad-col">
          <div class="squad-col-head"><span class="team-dot team-dot-${key}"></span><b>${escapeHtml(teamName(match, key))}</b><span class="muted n">${names.length}</span></div>
          ${names.length ? names.map(n => playerHasPlayed(match, n)
            ? `<div class="squad-player played"><span class="name">${escapeHtml(n)}<span class="sub">${isGuestInMatch(match, n) ? "guest · " : ""}played</span></span></div>`
            : `<button type="button" data-action="move-squad-player" data-name="${escapeHtml(n)}" class="squad-player" aria-label="Move ${escapeHtml(n)} to ${escapeHtml(teamName(match, other))}"><span class="name">${escapeHtml(n)}${isGuestInMatch(match, n) ? `<span class="sub guest">guest</span>` : ""}</span><span class="move">${key === "A" ? "→" : "←"}</span></button>`
          ).join("") : `<p class="hint">Nobody yet.</p>`}
        </div>`;
    };
    const inSquads = new Set([...(match.squads.A || []), ...(match.squads.B || [])].map(n => n.toLowerCase()));
    const addable = suggestionPlayerNames().filter(n => !inSquads.has(n.toLowerCase()));
    return sheet(`
      <div class="wicket-modal-head"><h2>Switch players</h2><span class="n batter">this match only</span></div>
      <p class="hint" style="margin-top:0;">Tap a player to move them to the other side. Anyone who has already batted, bowled or fielded stays where they are. ${match.clubId ? "The tournament's saved teams don't change." : "Your saved teams don't change."}</p>
      ${ui.squadError ? `<p class="form-error">${escapeHtml(ui.squadError)}</p>` : ""}
      <div class="squad-board">${side("A")}${side("B")}</div>
      <form id="squad-add-form" class="squad-add">
        <div class="section-label">Add a late arrival</div>
        <div class="tile-fieldset">
          <label><input type="radio" name="side" value="A" checked> ${escapeHtml(teamName(match, "A"))}</label>
          <label><input type="radio" name="side" value="B"> ${escapeHtml(teamName(match, "B"))}</label>
        </div>
        ${renderNameCombo("", `name="name" required maxlength="24" placeholder="${match.clubId ? "Search the roster or type a name" : "Search players or type a name"}"`, addable)}
        ${match.clubId ? `
        <div class="tile-fieldset">
          <label><input type="radio" name="kind" value="club" checked> Club player</label>
          <label><input type="radio" name="kind" value="guest"> Guest</label>
        </div>
        <p class="hint" style="margin-top:-4px;">A new club player joins the club roster once they play. A guest is never stored in the club.</p>` : ""}
        <button type="submit" class="ghost" style="width:100%;">Add to squad</button>
      </form>
      <button type="button" data-action="close-match-menu" class="primary">Done</button>`);
  }
  const row = (action, icon, title, sub, extra) => `
    <button type="button" data-action="${action}" ${extra || ""} class="menu-row">
      <span class="menu-row-icon">${icon}</span>
      <span class="menu-row-text"><span class="title">${title}</span><span class="sub">${sub}</span></span>
      <span class="menu-row-chev">›</span>
    </button>`;
  return sheet(`
    <div class="wicket-modal-head"><h2>Match options</h2><span class="n batter">${escapeHtml(match.teamA)} v ${escapeHtml(match.teamB)} · ${scoreLine}</span></div>
    <div class="menu-list">
      ${row("swap-toss", "⇄", "Change who bats first", started
        ? `Toss got reversed? Restarts from ball one with ${escapeHtml(teamName(match, otherFirst))} batting`
        : `Nothing bowled yet: ${escapeHtml(teamName(match, otherFirst))} bats first instead`)}
      ${match.squads ? row("match-menu-view", "👥", "Switch players between sides", "Move a player to the other team, or add a late arrival", `data-view="squads"`) : ""}
      ${row("open-forfeit", "🚩", "Forfeit", "End now and award the match to the other team")}
      ${row("ask-cancel-match", "✕", "Cancel match", "Started by mistake? Discard it with no result")}
    </div>
    <button type="button" data-action="close-match-menu" class="ghost" style="width:100%;margin-top:4px;">Close</button>`);
}

/* Flip who bats first by restarting the fixture (restartMatch). Snapshotted
   first, so the opening sheet's Undo can bring the old match back. */
function swapToss(){
  const m = state.match;
  if (!m || m.status === "complete") return;
  pushSnapshot();
  state.match = restartMatch(m, m.battingFirst === "A" ? "B" : "A");
  ui.matchMenu = null; ui.pendingExtra = null; ui.wicketFlow = null; ui.runoutRuns = 0; ui.runoutEnd = "striker";
  save(); render();
}

/* Before anything is recorded the flip is instant (nothing to lose); after,
   it restarts from ball one, so it asks first. */
function askSwapToss(){
  const m = state.match;
  if (!m || m.status === "complete") return;
  ui.matchMenu = null;
  if (!matchHasStarted(m)){ swapToss(); return; }
  const cur = currentInnings(m);
  const other = teamName(m, m.battingFirst === "A" ? "B" : "A");
  askConfirm({
    title: "Change who bats first?", icon: "⇄",
    body: `<p><b>${escapeHtml(other)}</b> will bat first instead. The match restarts from ball one with the same settings, so everything scored so far (<b class="n">${m.innings.length > 1 ? "both innings" : `${cur.runs}-${cur.wickets} (${oversDisplay(cur.legalBalls, cur.ballsPerOver)})`}</b>) is discarded.</p><p class="hint">Undo on the openers sheet brings it back.</p>`,
    confirmLabel: `Restart with ${other} batting`,
    onConfirm: () => swapToss()
  });
}
function askCancelMatch(){
  const m = state.match;
  if (!m || m.status === "complete") return;
  ui.matchMenu = null;
  const cur = currentInnings(m);
  askConfirm({
    title: "Cancel this match?", icon: "✕",
    body: `<p>Started by mistake? The match is thrown away: no result, and nothing goes into stats, standings${m.clubId ? " or the club's cloud records" : ""}.${matchHasStarted(m) ? ` What's been scored so far (<b class="n">${cur.runs}-${cur.wickets}</b>) is lost.` : ""} This can't be undone.</p>${m.clubId ? `<p class="hint">Players already added to the club roster during this match stay on it.</p>` : ""}`,
    confirmLabel: "Cancel match", cancelLabel: "Keep playing",
    onConfirm: () => cancelMatch()
  });
}

/* Throw away a match in progress: nothing is archived or synced (archiving
   only ever happens on completion -- see maybeArchiveCompletedMatch), so
   dropping state.match is the whole job. No undo: there's no match left
   to undo into, which is why the sheet asks first. */
function cancelMatch(){
  if (!state.match || state.match.status === "complete") return;
  leaveMatch();
}

/* Clear state.match and go back to wherever the match was started from.
   Shared by the Result screen's exit button and cancelMatch. */
function leaveMatch(){
  const tournamentId = state.match.tournamentId;
  const clubId = state.match.clubId;
  state.match = null; state.snapshots = []; ui = defaultUi();
  navReplaceNext = true; // this entry (Live/Result) is replaced, never returned to
  if (clubId && tournamentId){
    // a club's own Local-tier tournament -- tournamentId is a cloud
    // `tournaments` row here, NOT a key into local state.tournaments.
    ui.currentClubId = clubId; ui.currentTournamentId = tournamentId; state.view = "clubTournamentDashboard";
  }
  else if (clubId){ ui.currentClubId = clubId; state.view = "clubHome"; } // render() loads them
  else if (tournamentId){ state.activeTournamentId = tournamentId; state.view = "tournamentDashboard"; }
  else state.view = "home";
  save(); render();
}

function builderRosterMatchName(name){
  const key = (name || "").trim().toLowerCase();
  return !!key && suggestionPlayerNames().some(n => n.toLowerCase() === key);
}
function handleSquadAddSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const name = resolveTypedName(f.get("name"));
  const side = f.get("side") === "B" ? "B" : "A";
  const guest = !!state.match.clubId && f.get("kind") === "guest"; // guest matches have no club/guest split
  const err = guest && builderRosterMatchName(name)
    ? `${name} is on the club roster. Add them as a club player instead.`
    : addSquadPlayer(state.match, name, side);
  ui.squadError = err;
  if (!err && guest) state.match.guestNames = [...(state.match.guestNames || []), name];
  if (!err) save(); // roster/global registration happens when they actually play (registerMatchPlayer)
  render();
}

function handleOpeningSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const striker = resolveTypedName(f.get("striker"));
  const nonStriker = resolveTypedName(f.get("nonStriker"));
  const bowler = resolveTypedName(f.get("bowler"));
  if (!striker || !nonStriker || !bowler) return;
  if (striker.toLowerCase() === nonStriker.toLowerCase()){
    showFormError(e.target, "Striker and non-striker must be different players."); return;
  }
  const innOpen = currentInnings(state.match);
  const openers = [striker, nonStriker];
  if (openers.some(n => n.toLowerCase() === bowler.toLowerCase())){
    showFormError(e.target, `${bowler} can't bat and bowl in the same innings — they'd be on both teams.`); return;
  }
  const conflict = openers.map(n => playerSideConflict(state.match, n, innOpen.battingTeam)).find(Boolean)
    || playerSideConflict(state.match, bowler, innOpen.bowlingTeam);
  if (conflict){ showFormError(e.target, conflict); return; }
  pushSnapshot();
  const inn = currentInnings(state.match);
  ensureBatsman(inn, striker); ensureBatsman(inn, nonStriker); ensureBowler(inn, bowler);
  registerMatchPlayer(striker, inn.battingTeam); registerMatchPlayer(nonStriker, inn.battingTeam); registerMatchPlayer(bowler, inn.bowlingTeam);
  inn.striker = striker; inn.nonStriker = nonStriker; inn.bowler = bowler;
  state.match.status = "live";
  save(); render();
}

/* The dismissal banner reads from the last `inn.fallOfWickets` entry's
   `batsman` (see recordBall's `outName` local) rather than re-deriving
   who's out from the null slot -- the null slot only says *where*, not
   *who was there*. There's deliberately no "yet to bat" quick-pick chip
   row here (the Design-canvas mockup had one, grouped by team) -- a
   standalone match's teamA/teamB are plain display strings with no
   linked roster to draw it from (see CLAUDE.md's "Teams, players &
   presets"), and even a tournament match's `createMatch()` call only
   ever receives resolved name strings, not team IDs, so there's no
   squad list available at this point for either match type. */
function renderNewBatsmanModal(inn, slot){
  const endBadge = slot === "striker" ? "STRIKER'S END" : "NON-STRIKER'S END";
  const lastFow = inn.fallOfWickets.length ? inn.fallOfWickets[inn.fallOfWickets.length - 1] : null;
  const dismissed = lastFow && lastFow.batsman ? inn.batting.stats[lastFow.batsman] : null;
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="new-batsman">
        <div class="wicket-modal-head">
          <h2>New batsman</h2>
          <span class="end-badge">${endBadge}</span>
        </div>
        ${lastFow && dismissed ? `
          <div class="dismissal-banner">
            <span class="name">${escapeHtml(lastFow.batsman)}</span>
            <span class="n detail">${escapeHtml(dismissed.howOut || "")} · ${dismissed.runs} (${dismissed.balls})</span>
          </div>
        ` : ""}
        <form id="new-batsman-form">
          <div class="form-error"></div>
          ${renderNameCombo("Name", `name="name" required maxlength="24" placeholder="Search or type a player"`, pickCandidates(state.match, pickPool(inn.battingTeam), "batter"))}
          <p class="hint">A name that is not in your players list yet is added to it automatically.</p>
          <button type="submit" class="primary">Send in</button>
        </form>
        <div class="modal-footer-hint">
          <p class="hint">Scoring is paused until a name is entered. Pick later to do something else first.</p>
          <button type="button" data-action="undo" class="undo-chip" ${state.snapshots.length ? "" : "disabled"}>UNDO BALL</button>
        </div>
        ${renderEndInningsButton(state.match, inn)}
        ${renderPickLaterButton()}
      </div>
    </div>
  `;
}

function handleNewBatsmanSubmit(e){
  e.preventDefault();
  submitNewBatsman(resolveTypedName(new FormData(e.target).get("name")), e.target);
}

/* The one place a new batsman's name is checked and applied. */
function submitNewBatsman(name, form){
  const inn = currentInnings(state.match);
  const slot = pendingBatsmanSlot(inn);
  if (!slot || !name) return;
  const other = slot === "striker" ? inn.nonStriker : inn.striker;
  if (other && name.toLowerCase() === other.toLowerCase()){
    showFormError(form, "That player is already at the crease."); return;
  }
  if (inn.batting.stats[name] && inn.batting.stats[name].out){
    showFormError(form, `${name} is already out.`); return;
  }
  const sideConflict = playerSideConflict(state.match, name, inn.battingTeam);
  if (sideConflict){ showFormError(form, sideConflict); return; }
  pushSnapshot();
  ensureBatsman(inn, name);
  registerMatchPlayer(name, inn.battingTeam);
  inn[slot] = name;
  save(); render();
}

/* Previous-over bowlers get a real one-tap row (their own figures shown)
   instead of only being typeable via the datalist -- the common case at
   the top of a new over is picking someone who's already bowled. The
   over-before's bowler is excluded from that tappable list (mirroring
   handleNewBowlerSubmit's own check) and shown struck-through/disabled
   instead, so the "can't bowl two in a row" rule reads as a fact about
   that row, not just an error you'd only see after trying. */
function renderNewBowlerModal(inn){
  const bpo = inn.ballsPerOver;
  const overNumber = Math.floor(inn.legalBalls / bpo) + 1;
  const pickable = inn.bowling.order.filter(name => name !== inn.lastOverBowler);
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="new-bowler">
        <div class="wicket-modal-head">
          <h2>New bowler</h2>
          <span class="n batter">${overNumber}${ordinalSuffix(overNumber)} over · ${bpo} balls</span>
        </div>
        <form id="new-bowler-form">
          <div class="form-error"></div>
          ${renderNameCombo("Name", `name="name" required maxlength="24" placeholder="Search or type a bowler"`, pickCandidates(state.match, pickPool(inn.bowlingTeam), "bowler"))}
          ${inn.bowling.order.length ? `
            <div class="section-label">Already bowled</div>
            <div class="bowler-pick-list">
              ${pickable.map(name => {
                const b = inn.bowling.stats[name];
                return `<button type="button" data-action="pick-bowler" data-name="${escapeHtml(name)}" class="bowler-pick-row"><span class="name">${escapeHtml(name)}</span><span class="n figs">${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}</span></button>`;
              }).join("")}
              ${inn.lastOverBowler ? `
                <div class="bowler-pick-row disabled">
                  <span class="name strike">${escapeHtml(inn.lastOverBowler)}</span>
                  <span class="reason">bowled the ${overNumber - 1}${ordinalSuffix(overNumber - 1)}</span>
                </div>
              ` : ""}
            </div>
            <p class="hint">The previous over's bowler can't bowl two in a row.</p>
          ` : ""}
          <button type="submit" class="primary">Start over</button>
        </form>
        <div class="modal-footer-hint">
          <p class="hint">Strike has already been swapped for the new over.</p>
          <button type="button" data-action="undo" class="undo-chip" ${state.snapshots.length ? "" : "disabled"}>UNDO BALL</button>
        </div>
        ${renderEndInningsButton(state.match, inn)}
        ${renderPickLaterButton()}
      </div>
    </div>
  `;
}

function confirmNewBowler(name){
  const inn = currentInnings(state.match);
  if (inn.bowler || !name) return;
  if (inn.lastOverBowler && name.toLowerCase() === inn.lastOverBowler.toLowerCase()) return;
  pushSnapshot();
  ensureBowler(inn, name);
  registerMatchPlayer(name, inn.bowlingTeam);
  inn.bowler = name;
  save(); render();
}

function handleNewBowlerSubmit(e){
  e.preventDefault();
  submitNewBowler(resolveTypedName(new FormData(e.target).get("name")), e.target);
}

/* A typed/searched name -- unlike the "already bowled" rows (pick-bowler),
   it may not have played yet, so it needs the side check too. */
function submitNewBowler(name, form){
  const inn = currentInnings(state.match);
  if (inn.bowler || !name) return;
  if (inn.lastOverBowler && name.toLowerCase() === inn.lastOverBowler.toLowerCase()){
    showFormError(form, `${name} can't bowl two overs in a row.`); return;
  }
  const sideConflict = playerSideConflict(state.match, name, inn.bowlingTeam);
  if (sideConflict){ showFormError(form, sideConflict); return; }
  confirmNewBowler(name);
}

function showFormError(form, msg){
  const el = form && form.querySelector(".form-error");
  if (el) el.textContent = friendlyError(msg);
}
/* A raw fetch failure reads as gibberish ("TypeError: Failed to fetch"). */
function friendlyError(msg){
  return msg && /failed to fetch|networkerror|load failed|network request failed/i.test(String(msg))
    ? "You're offline. This needs an internet connection — try again when you're back online." : msg;
}

/* --- wicket modal (caught / run-out both capture an optional-or-required fielder) --- */
/* One sheet for every dismissal type, not a menu screen that swaps to a
   separate detail screen for caught/run-out. Tapping Bowled/LBW/Stumped/
   Hit wicket still fires immediately via confirmWicket() (same speed as
   always -- there's nothing to enter for those, so a second confirm tap
   would only slow down the common case). Caught/Run out instead select
   themselves (ui.wicketFlow holds which) and the sheet grows a fielder/
   end/runs section plus a Confirm button below the same type grid --
   still exactly two taps total for those two, just no full-screen swap. */
function renderWicketModal(inn){
  const match = state.match;
  const selected = ui.wicketFlow;
  const isRunout = selected === "runout";
  const isCaught = selected === "caught";
  const strikerStats = inn.striker ? inn.batting.stats[inn.striker] : null;

  const types = [
    { type: "bowled", label: "Bowled" },
    { type: "caught", label: "Caught" },
    { type: "lbw", label: "LBW" },
    { type: "stumped", label: "Stumped" },
    { type: "hitwicket", label: "Hit wicket" },
    { type: "runout", label: "Run out" }
  ].filter(t => !inn.freeHit || t.type === "runout");

  const required = isRunout ? match.requireFielderOnRunout : match.requireFielderOnCatch;

  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="wicket">
        <div class="wicket-modal-head">
          <h2>How out?</h2>
          ${strikerStats ? `<span class="batter">${escapeHtml(inn.striker)} ${strikerStats.runs} (${strikerStats.balls})</span>` : ""}
        </div>
        ${inn.freeHit ? `
          <div class="freehit-note"><span class="tag">FREE HIT</span><span class="desc">A run out is the only dismissal available</span></div>
        ` : ""}
        <div class="wicket-types${inn.freeHit ? " solo" : ""}">
          ${types.map(t => `<button type="button" data-action="pick-wicket" data-type="${t.type}" class="${selected === t.type ? "active" : ""}">${t.label}</button>`).join("")}
        </div>
        <form id="wicket-fielder-form">
          <div class="form-error"></div>
          ${isRunout ? `
            <div class="section-label">Who's out?</div>
            <div class="end-picker">
              <button type="button" data-action="pick-runout-end" data-end="striker" class="end-tile ${ui.runoutEnd === "striker" ? "active" : ""}">
                <span class="role">Striker</span><span class="n">${escapeHtml(inn.striker)}${strikerStats ? " " + strikerStats.runs : ""}</span>
              </button>
              ${inn.nonStriker ? `<button type="button" data-action="pick-runout-end" data-end="nonStriker" class="end-tile ${ui.runoutEnd === "nonStriker" ? "active" : ""}">
                <span class="role">Non-striker</span><span class="n">${escapeHtml(inn.nonStriker)}${inn.batting.stats[inn.nonStriker] ? " " + inn.batting.stats[inn.nonStriker].runs : ""}</span>
              </button>` : ""}
            </div>
            <p class="hint">The end you pick is vacated directly. Batsmen crossing is not modelled.</p>
            <div class="section-label">Runs completed before the run out</div>
            <div class="run-pad small">
              ${[0, 1, 2, 3].map(n => `<button type="button" data-action="runout-runs" data-runs="${n}" class="run-btn ${ui.runoutRuns === n ? "active" : ""}">${n}</button>`).join("")}
            </div>
            <p class="hint">These runs count against the bowler, unlike byes and leg byes.</p>
          ` : ""}
          ${(isRunout || isCaught) ? `
            <div class="fielder-box">
              <div class="fielder-box-head">
                <label for="wicket-fielder">FIELDER</label>
                ${required ? `<span class="required-badge">REQUIRED</span>` : ""}
              </div>
              ${renderNameCombo("", `id="wicket-fielder" name="fielder" maxlength="24" placeholder="Search players" ${required ? "required" : ""}`, pickCandidates(match, pickPool(inn.bowlingTeam), "fielder"))}
              ${isCaught ? `<div class="hint">Credits a catch in the fielding stats.</div>` : ""}
            </div>
            <div style="display:flex;gap:10px;margin-top:14px;">
              <button type="button" data-action="close-wicket-modal" class="ghost" style="width:112px;flex-shrink:0;">Cancel</button>
              <button type="submit" class="primary danger-confirm" style="flex-grow:1;">Confirm ${isRunout ? "run out" : "wicket"}</button>
            </div>
          ` : `
            <button type="button" data-action="close-wicket-modal" class="ghost" style="width:100%;margin-top:14px;">Cancel</button>
          `}
        </form>
      </div>
    </div>
  `;
}

function maybeArchiveCompletedMatch(match){
  if (match.status === "complete" && !match.archivedId){
    match.motm = pickMatchMOTM(match);
    const archived = archiveMatch(match);
    match.archivedId = archived.id;
    SFX.win();
    if (match.clubId) syncMatchToCloud(match, archived);
  }
}

function confirmWicket(type){
  pushSnapshot();
  const inn = currentInnings(state.match);
  recordBall(inn, { kind: "wicket", wicketType: type });
  afterBall(state.match);
  maybeArchiveCompletedMatch(state.match);
  SFX.wicket();
  ui.wicketFlow = null;
  save(); render();
}

function handleWicketFielderSubmit(e){
  e.preventDefault();
  const f = new FormData(e.target);
  const fielder = resolveTypedName(f.get("fielder"));
  const match = state.match;
  if (fielder){
    const sideConflict = playerSideConflict(match, fielder, currentInnings(match).bowlingTeam);
    if (sideConflict){ showFormError(e.target, sideConflict); return; }
  }
  if (ui.wicketFlow === "runout"){
    if (match.requireFielderOnRunout && !fielder){ showFormError(e.target, "This preset requires naming the run-out taker."); return; }
    pushSnapshot();
    const inn = currentInnings(match);
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: ui.runoutRuns, endComingIn: ui.runoutEnd, fielder: fielder || undefined });
    if (fielder) registerMatchPlayer(fielder, inn.bowlingTeam);
    afterBall(match);
    maybeArchiveCompletedMatch(match);
    SFX.wicket();
    ui.wicketFlow = null; ui.runoutRuns = 0; ui.runoutEnd = "striker";
    save(); render();
  } else if (ui.wicketFlow === "caught"){
    if (match.requireFielderOnCatch && !fielder){ showFormError(e.target, "This preset requires naming the catch taker."); return; }
    pushSnapshot();
    const inn = currentInnings(match);
    recordBall(inn, { kind: "wicket", wicketType: "caught", fielder: fielder || undefined });
    if (fielder) registerMatchPlayer(fielder, inn.bowlingTeam);
    afterBall(match);
    maybeArchiveCompletedMatch(match);
    SFX.wicket();
    ui.wicketFlow = null;
    save(); render();
  }
}
