/* Cricket.lk — match: opening/new batsman/new bowler/match options/wicket sheets.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- opening / new-batsman / new-bowler modals --- */
/* The pick and wicket sheets cover the scoreboard, so the live card's score
   tiles (renderScoreBento, plus the batting team) sit in a banner at the top
   of the scrim, above the sheet: a .modal-backdrop.with-score. */
function renderSheetScore(match, inn){
  return `<div class="sheet-score-banner" aria-label="Current score">${renderScoreBento(match, inn, teamName(match, inn.battingTeam))}</div>`;
}
/* Openers and the first bowler: three boxes, one per line, each a
   search-select (renderNameCombo) -- focusing a box lists that side's players
   under it as rows, typing narrows them, a tap fills that box. A name already
   in one box isn't offered in the others (updateCombo). Any name can still be
   typed; the submit handler checks it all. */
function renderOpeningModal(match){
  const inn = currentInnings(match);
  const bat = pickCandidates(match, pickPool(inn.battingTeam), "batter");
  const bowl = pickCandidates(match, pickPool(inn.bowlingTeam), "bowler");
  const box = (name, label, names) => renderNameCombo(label, `name="${name}" required maxlength="24" placeholder="${names.length ? "Tap to pick, or type a name" : "Type a name"}"`, names);
  return `
    <div class="modal-backdrop${inn.target != null ? " with-score" : ""}">
      ${inn.target != null ? renderSheetScore(match, inn) : ""}
      <div class="modal" data-keep-scroll="opening">
        <h2>${escapeHtml(teamName(match, inn.battingTeam))} — opening players</h2>
        <form id="opening-form">
          <div class="form-error"></div>
          <div class="section-label">Openers</div>
          ${box("striker", "On strike", bat)}
          ${box("nonStriker", "Other end", bat)}
          <div class="section-label">${escapeHtml(teamName(match, inn.bowlingTeam))} · opening bowler</div>
          ${box("bowler", "Bowler", bowl)}
          <button type="submit" class="primary">Start innings</button>
        </form>
        ${match.innings.length === 1 ? `<button type="button" data-action="swap-toss" class="link-btn">Wrong toss? ${escapeHtml(teamName(match, inn.bowlingTeam))} bats first instead</button>` : ""}
        <button type="button" data-action="open-catch-up" class="link-btn">Already under way? Enter the score so far</button>
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
  return inline
    ? `<button type="button" data-action="end-innings" class="ghost small">${last ? "End · finish match" : "End innings"}</button>`
    : `<button type="button" data-action="end-innings" class="link-btn end-innings-sheet">${last ? "End innings · finish match" : "End innings"}</button>`;
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
      ${match.status === "live" && canSwapStrike(cur) ? row("swap-strike", "⇅", "Swap strike", `Put ${escapeHtml(liveName(cur.nonStriker))} on strike instead of ${escapeHtml(liveName(cur.striker))}`) : ""}
      ${match.innings.some(i => i.log && i.log.some(x => x.t === "ball")) ? row("open-edit-balls", "✎", "Edit an earlier ball", "Wrong runs, a missed wide or wicket? Fix it from ball by ball") : ""}
      ${ballEditAllowed(match) ? row("open-score-set", "#", "Set the final score", "Skip ball by ball: type each side's runs, wickets and overs") : ""}
      ${reopenableInnings(match).map(i => row("reopen-innings", "↺", `Reopen ${escapeHtml(possessive(teamName(match, match.innings[i].battingTeam)))} innings`, match.innings[i + 1]
        ? `Ended too early? Clears ${escapeHtml(possessive(teamName(match, match.innings[i + 1].battingTeam)))} innings so far and carries on from ${inningsScoreText(match.innings[i])}`
        : `Ended too early? Carry on batting from ${inningsScoreText(match.innings[i])}`, `data-inn="${i}"`)).join("")}
      ${unnamedPlayers(match).map(u => row("name-later", "?", `Name ${escapeHtml(u.name)}`,
        `Who ${u.role === "batter" ? "batted" : "bowled"} for ${escapeHtml(teamName(match, u.role === "batter" ? match.innings[u.inn].battingTeam : match.innings[u.inn].bowlingTeam))}? Leave it till you know`,
        `data-name="${escapeHtml(u.name)}"`)).join("")}
      ${!cur.complete ? row("open-catch-up", "⏩", "Catch up the score", "Missed some balls? Enter the score as it is now and carry on") : ""}
      ${match.squads ? row("match-menu-view", "👥", "Switch players between sides", "Move a player to the other team, or add a late arrival", `data-view="squads"`) : ""}
      ${matchHasNicknames() ? `
        <button type="button" data-action="toggle-nicknames" class="menu-row" role="switch" aria-checked="${!!state.useNicknames}">
          <span class="menu-row-icon">Aa</span>
          <span class="menu-row-text"><span class="title">Show nicknames</span><span class="sub">Scoreboard and scorecard, where a player has one</span></span>
          <span class="toggle-pill ${state.useNicknames ? "on" : ""}" aria-hidden="true"><span></span></span>
        </button>` : ""}
      ${!cur.complete ? row("end-innings", "⏹", match.innings.length === 2 ? "End innings · finish match" : "End innings", match.innings.length === 2
        ? "Rain or time? Close the chase now and work out the result from the scores"
        : `Rain, time or a declaration? Close ${escapeHtml(teamName(match, cur.battingTeam))}'s innings now`) : ""}
      ${row("open-forfeit", "🚩", "Forfeit", "End now and award the match to the other team")}
      ${row("ask-cancel-match", "✕", "Cancel match", "Started by mistake? Discard it with no result")}
    </div>
    <button type="button" data-action="close-match-menu" class="ghost" style="width:100%;margin-top:4px;">Close</button>`);
}

/* The live screen's full scorecard, as a sheet over the board
   (ui.liveScorecard) rather than growing the fixed-height screen. The
   innings in play opens first (renderScorecard: innings tabs, then
   Scorecard / Ball by ball). Back / ✕ / Close closes it. */
function renderLiveScorecardModal(match){
  return `
    <div class="modal-backdrop">
      <div class="modal scorecard-modal" data-keep-scroll="live-scorecard" role="dialog" aria-label="Full scorecard">
        <div class="wicket-modal-head">
          <h2>Scorecard</h2>
          <span class="n batter">${escapeHtml(match.teamA)} v ${escapeHtml(match.teamB)}</span>
          <button type="button" data-action="close-live-scorecard" class="sheet-close" aria-label="Close scorecard">✕</button>
        </div>
        ${renderScorecard(match)}
        <button type="button" data-action="close-live-scorecard" class="primary" style="width:100%;">Close</button>
      </div>
    </div>`;
}

/* Flip who bats first by restarting the fixture (restartMatch). Snapshotted
   first, so the opening sheet's Undo can bring the old match back. */
function swapToss(){
  const m = state.match;
  if (!m || m.status === "complete") return;
  pushSnapshot();
  state.match = restartMatch(m, m.battingFirst === "A" ? "B" : "A");
  ui.matchMenu = null; ui.pendingExtra = null; resetWicketUi();
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
    body: m.reopenedFrom && state.matchHistory[m.reopenedFrom]
      ? `<p>This match was finished, then reopened. Cancelling throws away the changes since then; match history keeps the result it had (<b>${escapeHtml(state.matchHistory[m.reopenedFrom].result || "")}</b>). This can't be undone.</p>`
      : `<p>Started by mistake? The match is thrown away: no result, and nothing goes into stats, standings${m.clubId ? " or the club's cloud records" : ""}.${matchHasStarted(m) ? ` What's been scored so far (<b class="n">${cur.runs}-${cur.wickets}</b>) is lost.` : ""} This can't be undone.</p>${m.clubId ? `<p class="hint">Players already added to the club roster during this match stay on it.</p>` : ""}`,
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
  else if (clubId){ state.activeClubId = clubId; state.view = "home"; } // the club's Home; render() loads it
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
  confirmUnlisted(state.match, [
    { name: striker, teamKey: innOpen.battingTeam }, { name: nonStriker, teamKey: innOpen.battingTeam }, { name: bowler, teamKey: innOpen.bowlingTeam }
  ], () => {
    if (!state.match || state.match.status !== "opening") return;
    pushSnapshot();
    const inn = currentInnings(state.match);
    openInnings(inn, striker, nonStriker, bowler);
    registerMatchPlayer(striker, inn.battingTeam); registerMatchPlayer(nonStriker, inn.battingTeam); registerMatchPlayer(bowler, inn.bowlingTeam);
    state.match.status = "live";
    save(); render();
  });
}

/* A typed name that isn't on that side's list -- its squad, else the club
   roster / guest players (pickPool) -- and hasn't played for that side in
   this match yet is asked about before it's recorded: a typo would become a
   new player. A side with no list at all (a friendly's visitors) has nothing
   to compare against, so it never asks. Placeholders (Bat ?1) never ask. */
function unlistedNames(match, entries){
  const seen = new Set();
  return entries.filter(({ name, teamKey }) => {
    const key = (name || "").trim().toLowerCase();
    if (!key || seen.has(key) || isUnnamedPlayer(name)) return false;
    seen.add(key);
    const pool = pickPool(teamKey);
    if (!pool.length || pool.some(n => n.toLowerCase() === key)) return false;
    return playerTeamInMatch(match, name) !== teamKey;
  });
}
function confirmUnlisted(match, entries, proceed){
  const fresh = unlistedNames(match, entries);
  if (!fresh.length){ proceed(); return; }
  const one = fresh.length === 1;
  const list = match.squads ? "this match's squad" : match.clubId ? "the club roster" : "your players list";
  askConfirm({
    title: one ? `Add ${fresh[0].name}?` : "Add new players?", icon: "👤", tone: "primary",
    body: `<p>${one ? "This name isn't" : "These names aren't"} in ${list}:</p>`
      + `<ul class="confirm-names">${fresh.map(f => `<li><b>${escapeHtml(f.name)}</b> · ${escapeHtml(teamName(match, f.teamKey))}</li>`).join("")}</ul>`
      + `<p class="hint">Add ${one ? "them as a new player" : "them as new players"} and carry on? Check the spelling: a typo becomes a separate player.</p>`,
    confirmLabel: one ? "Add player" : "Add players", cancelLabel: "Go back",
    onConfirm: () => { proceed(); }
  });
}

/* The dismissal banner reads from the last `inn.fallOfWickets` entry's
   `batsman` (see recordBall's `outName` local) rather than re-deriving
   who's out from the null slot -- the null slot only says *where*, not
   *who was there*. Everyone who can still bat for this side (pickPool ->
   pickCandidates: the squad, else the club roster / guest players) is a
   one-tap row; the box on top filters them or takes a new name; "carry on
   unnamed" scores on with a placeholder to be named later. */
function renderNewBatsmanModal(inn, slot){
  const endBadge = slot === "striker" ? "STRIKER'S END" : "NON-STRIKER'S END";
  const lastFow = inn.fallOfWickets.length ? inn.fallOfWickets[inn.fallOfWickets.length - 1] : null;
  const dismissed = lastFow && lastFow.batsman ? inn.batting.stats[lastFow.batsman] : null;
  return `
    <div class="modal-backdrop with-score">
      ${renderSheetScore(state.match, inn)}
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
          ${renderPickSearch("Send in")}
          ${renderUnnamedButton("batter")}
          ${renderPickRows(state.match.squads ? "Yet to bat" : "Players", pickCandidates(state.match, pickPool(inn.battingTeam), "batter"), "pick-batter")}
          <p class="hint">A new name is added to your players list automatically.</p>
        </form>
        <div class="modal-footer-hint">
          <p class="hint">Scoring is paused until you pick someone or carry on unnamed. Pick later to do something else first.</p>
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
  if (isUnnamedPlayer(name)){ showFormError(form, "That name is kept for unnamed players. Use “carry on unnamed” instead."); return; }
  const other = slot === "striker" ? inn.nonStriker : inn.striker;
  if (other && name.toLowerCase() === other.toLowerCase()){
    showFormError(form, "That player is already at the crease."); return;
  }
  // Case-insensitive, like every other name check: "kusal" is the same person as "Kusal".
  const outName = inn.batting.order.find(n => n.toLowerCase() === name.toLowerCase() && inn.batting.stats[n].out);
  if (outName){
    showFormError(form, `${outName} is already out.`); return;
  }
  const sideConflict = playerSideConflict(state.match, name, inn.battingTeam);
  if (sideConflict){ showFormError(form, sideConflict); return; }
  confirmUnlisted(state.match, [{ name, teamKey: inn.battingTeam }], () => {
    if (pendingBatsmanSlot(currentInnings(state.match)) !== slot) return;   // something else filled it meanwhile
    pushSnapshot();
    sendInBatter(inn, name);
    registerMatchPlayer(name, inn.battingTeam);
    save(); render();
  });
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
  // Each unnamed over has its own placeholder -- they're never offered again.
  const pickable = inn.bowling.order.filter(name => name !== inn.lastOverBowler && !isUnnamedPlayer(name));
  return `
    <div class="modal-backdrop with-score">
      ${renderSheetScore(state.match, inn)}
      <div class="modal" data-keep-scroll="new-bowler">
        <div class="wicket-modal-head">
          <h2>New bowler</h2>
          <span class="n batter">${overNumber}${ordinalSuffix(overNumber)} over · ${bpo} balls</span>
        </div>
        <form id="new-bowler-form">
          <div class="form-error"></div>
          ${renderPickSearch("Bowl")}
          ${renderUnnamedButton("bowler")}
          ${pickable.length || inn.lastOverBowler ? `
            <div class="section-label">Already bowled</div>
            <div class="bowler-pick-list">
              ${pickable.map(name => {
                const b = inn.bowling.stats[name];
                return pickRowHtml(name, "pick-bowler", `${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}`);
              }).join("")}
              ${inn.lastOverBowler ? `
                <div class="bowler-pick-row disabled">
                  <span class="name strike">${escapeHtml(inn.lastOverBowler)}</span>
                  <span class="reason">bowled the ${overNumber - 1}${ordinalSuffix(overNumber - 1)}</span>
                </div>
              ` : ""}
            </div>
            ${inn.lastOverBowler ? `<p class="hint">The previous over's bowler can't bowl two in a row.</p>` : ""}
          ` : ""}
          ${renderPickRows("Yet to bowl", pickCandidates(state.match, pickPool(inn.bowlingTeam), "bowler"), "pick-bowler")}
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

/* The pick sheets' building blocks: a box that filters the rows below as
   you type and, for someone who isn't listed, takes a new name (its button
   submits the form, so every check in the submit handler applies); one tap
   per listed player; and the way to carry on without a name. DOM-only
   filtering (the delegated input listener, [data-pick-filter]). */
function renderPickSearch(submitLabel){
  return `
    <div class="pick-search">
      <input name="name" required maxlength="24" placeholder="Search, or type a new name" data-pick-filter autocomplete="off" autocapitalize="words" aria-label="Search or type a name">
      <button type="submit" class="primary">${submitLabel}</button>
    </div>
    <p class="hint pick-none" hidden>Nobody listed matches. Tap ${submitLabel} to use the name you typed.</p>`;
}
// DOM-only: hide the rows (and empty sections) that don't match the box.
function applyPickFilter(input){
  const sheet = input.closest(".modal"), q = input.value.trim().toLowerCase();
  if (!sheet) return;
  let shown = 0;
  sheet.querySelectorAll(".pick-row-item").forEach(row => { row.hidden = !!q && !row.dataset.search.includes(q); if (!row.hidden) shown++; });
  sheet.querySelectorAll(".bowler-pick-list").forEach(list => {
    const any = [...list.children].some(c => !c.hidden && c.classList.contains("pick-row-item"));
    list.hidden = !!q && !any;
    const label = list.previousElementSibling;
    if (label && label.classList.contains("section-label")) label.hidden = list.hidden;
  });
  const none = sheet.querySelector(".pick-none"); if (none) none.hidden = !q || shown > 0;
}
function pickRowHtml(name, action, figs){
  const r = rosterEntryFor(name);
  const nick = r && r.nickname ? r.nickname.trim() : "";
  const jersey = r && r.jersey_no != null ? `#${r.jersey_no}` : "";
  const search = [name, nick, jersey].filter(Boolean).join(" ").toLowerCase();
  return `<button type="button" data-action="${action}" data-name="${escapeHtml(name)}" data-search="${escapeHtml(search)}" class="bowler-pick-row pick-row-item">`
    + `<span class="name">${jersey ? `<span class="pick-jersey">${jersey}</span> ` : ""}${escapeHtml(name)}${nick ? ` <span class="combo-nick">${escapeHtml(nick)}</span>` : ""}</span>`
    + (figs ? `<span class="n figs">${figs}</span>` : "")
    + `</button>`;
}
function renderPickRows(label, names, action){
  if (!names.length) return "";
  return `
    <div class="section-label">${label}</div>
    <div class="bowler-pick-list">${names.map(n => pickRowHtml(n, action)).join("")}</div>`;
}
function renderUnnamedButton(role){
  const next = nextUnnamedName(state.match, role);
  return `
    <button type="button" data-action="pick-unnamed" class="ghost unnamed-btn">Don't know yet · carry on as “${escapeHtml(next)}”</button>
    <p class="hint" style="margin-top:4px;">Tap that name later (on the board, the scorecard or ⋯ Match options) to say who it was.</p>`;
}
/* Carry on without a name: the slot gets the next placeholder (see
   nextUnnamedName). Logged like any name, so a later ball edit keeps it. */
function pickUnnamed(){
  const m = state.match;
  if (!m || m.status !== "live") return;
  const inn = currentInnings(m);
  if (pendingBatsmanSlot(inn)){
    pushSnapshot();
    sendInBatter(inn, nextUnnamedName(m, "batter"));
  } else if (!inn.bowler){
    pushSnapshot();
    setBowler(inn, nextUnnamedName(m, "bowler"));
  } else return;
  save(); render();
}

function confirmNewBowler(name){
  const inn = currentInnings(state.match);
  if (inn.bowler || !name) return;
  if (inn.lastOverBowler && name.toLowerCase() === inn.lastOverBowler.toLowerCase()) return;
  pushSnapshot();
  setBowler(inn, name);
  registerMatchPlayer(name, inn.bowlingTeam);
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
  if (isUnnamedPlayer(name)){ showFormError(form, "That name is kept for unnamed players. Use “carry on unnamed” instead."); return; }
  if (inn.lastOverBowler && name.toLowerCase() === inn.lastOverBowler.toLowerCase()){
    showFormError(form, `${name} can't bowl two overs in a row.`); return;
  }
  const sideConflict = playerSideConflict(state.match, name, inn.bowlingTeam);
  if (sideConflict){ showFormError(form, sideConflict); return; }
  confirmUnlisted(state.match, [{ name, teamKey: inn.bowlingTeam }], () => confirmNewBowler(name));
}

function showFormError(form, msg){
  const el = form && form.querySelector(".form-error");
  if (!el) return;
  el.textContent = friendlyError(msg);
  // Nudge it for every new error, even the same text twice in a row.
  el.classList.remove("shake");
  if (msg){ void el.offsetWidth; el.classList.add("shake"); }
}
/* A raw fetch failure reads as gibberish ("TypeError: Failed to fetch").
   While the device is online that means the server itself couldn't be
   reached (e.g. a paused Supabase project, a VPN/proxy or firewall
   blocking it) -- don't tell the user they're offline then. */
function friendlyError(msg){
  if (!msg || !/failed to fetch|networkerror|load failed|network request failed/i.test(String(msg))) return msg;
  return isOnline()
    ? "Couldn't reach the cricket.lk server. Your internet looks fine, so the server may be down, or a VPN, proxy or firewall may be blocking it. Try again in a moment."
    : "You're offline. This needs an internet connection — try again when you're back online.";
}

/* --- wicket modal (caught / run-out / stumped capture a fielder: optional, or required by the preset) --- */
/* One sheet for every dismissal type, not a menu screen that swaps to a
   separate detail screen for caught/run-out. Tapping Bowled/LBW/Hit wicket
   still fires immediately via confirmWicket() (same speed as always --
   there's nothing to enter for those, so a second confirm tap would only
   slow down the common case). Caught/Run out/Stumped instead select
   themselves (ui.wicketFlow holds which) and the sheet grows a fielder (the
   keeper, for a stumping)/end/runs section plus a Confirm button below the
   same type grid -- still exactly two taps total, just no full-screen swap. */
function renderWicketModal(inn){
  const match = state.match;
  const selected = ui.wicketFlow;
  const isRunout = selected === "runout";
  const isCaught = selected === "caught";
  const isStumped = selected === "stumped";
  const strikerStats = inn.striker ? inn.batting.stats[inn.striker] : null;
  // A wicket off a wide / no-ball (ui.wicketExtra, from the extra-runs sheet).
  const extra = ui.wicketExtra;
  const allowed = wicketTypesFor(inn.freeHit, extra);
  const extraLabel = extra === "wide" ? "Wide" : extra === "noball" ? "No ball" : null;
  const extraBase = extra === "wide" ? inn.wideBaseRuns : extra === "noball" ? inn.noBallBaseRuns : 0;

  const types = [
    { type: "bowled", label: "Bowled" },
    { type: "caught", label: "Caught" },
    { type: "lbw", label: "LBW" },
    { type: "stumped", label: "Stumped" },
    { type: "hitwicket", label: "Hit wicket" },
    { type: "runout", label: "Run out" }
  ].filter(t => allowed.includes(t.type));

  // Where the wicket was broken -- defaults to the end the out batter
  // started the ball at until the scorer picks one.
  const runoutAt = ui.runoutAt || ui.runoutEnd;
  const runoutSurvivor = ui.runoutEnd === "striker" ? inn.nonStriker : inn.striker;

  const required = isRunout ? match.requireFielderOnRunout : isCaught ? match.requireFielderOnCatch : false;

  return `
    <div class="modal-backdrop with-score">
      ${renderSheetScore(match, inn)}
      <div class="modal" data-keep-scroll="wicket">
        <div class="wicket-modal-head">
          <h2>How out?</h2>
          ${strikerStats ? `<span class="batter">${escapeHtml(inn.striker)} ${strikerStats.runs} (${strikerStats.balls})</span>` : ""}
        </div>
        ${extraLabel ? `
          <div class="freehit-note extra-note"><span class="tag">${extraLabel.toUpperCase()}</span><span class="desc">${extra === "wide" && !inn.freeHit ? "Off a wide: stumped, hit wicket or run out" : "Off a no-ball: only a run out"}. The ${extraLabel.toLowerCase()} still counts (+${extraBase}) and the ball is bowled again.</span></div>
        ` : inn.freeHit ? `
          <div class="freehit-note"><span class="tag">FREE HIT</span><span class="desc">A run out is the only dismissal available</span></div>
        ` : ""}
        <div class="wicket-types${types.length === 1 ? " solo" : ""}">
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
            <div class="section-label">Run out at which end?</div>
            <div class="end-picker">
              ${[["striker", "Keeper's end", "Striker's end"], ["nonStriker", "Bowler's end", "Non-striker's end"]].map(([end, label, sub]) => `
                <button type="button" data-action="pick-runout-at" data-end="${end}" class="end-tile ${runoutAt === end ? "active" : ""}">
                  <span class="role">${sub}</span><span class="n">${label}</span>
                </button>`).join("")}
            </div>
            ${runoutSurvivor ? `<p class="hint">${escapeHtml(runoutSurvivor)} stays at the ${runoutAt === "striker" ? "bowler's" : "keeper's"} end; the new batter comes in at the ${runoutAt === "striker" ? "keeper's" : "bowler's"} end.</p>` : ""}
            <div class="section-label">Runs completed before the run out${extraLabel ? ` (on top of the ${extraLabel.toLowerCase()})` : ""}</div>
            <div class="run-pad small">
              ${[0, 1, 2, 3].map(n => `<button type="button" data-action="runout-runs" data-runs="${n}" class="run-btn ${ui.runoutRuns === n ? "active" : ""}">${n}</button>`).join("")}
            </div>
            <p class="hint">${extra === "wide" ? "They count as wides, against the bowler." : "These runs count against the bowler, unlike byes and leg byes."}</p>
          ` : ""}
          ${(isRunout || isCaught || isStumped) ? `
            ${match.anonymous ? "" : `            <div class="fielder-box">
              <div class="fielder-box-head">
                <label for="wicket-fielder">${isStumped ? "KEEPER" : "FIELDER"}</label>
                ${required ? `<span class="required-badge">REQUIRED</span>` : isStumped ? `<span class="muted optional-note">optional</span>` : ""}
              </div>
              ${renderNameCombo("", `id="wicket-fielder" name="fielder" maxlength="24" placeholder="Search players" ${required ? "required" : ""}`, pickCandidates(match, pickPool(inn.bowlingTeam), "fielder"))}
              ${isCaught ? `<div class="hint">Credits a catch in the fielding stats.</div>` : isStumped ? `<div class="hint">Credits the keeper with a stumping.</div>` : ""}
            </div>`}
            <div style="display:flex;gap:10px;margin-top:14px;">
              <button type="button" data-action="close-wicket-modal" class="ghost" style="width:112px;flex-shrink:0;">Cancel</button>
              <button type="submit" class="primary danger-confirm" style="flex-grow:1;">Confirm ${isRunout ? "run out" : "wicket"}</button>
            </div>
          ` : `
            <button type="button" data-action="close-wicket-modal" class="ghost" style="width:100%;margin-top:14px;">${extraLabel ? `Back to ${extraLabel.toLowerCase()}` : "Cancel"}</button>
          `}
        </form>
      </div>
    </div>
  `;
}

function maybeArchiveCompletedMatch(match){
  if (match.status === "complete" && !match.archivedId){
    match.motm = pickMatchMOTM(match, pointsPresetFor(match));
    // A finished match that was reopened (or undone past its end) and has now
    // finished again goes back into its own archive entry, not a second one.
    const prevId = match.reopenedFrom && state.matchHistory[match.reopenedFrom] ? match.reopenedFrom : null;
    delete match.reopenedFrom;
    if (prevId){
      match.archivedId = prevId;
      replaceArchivedMatch(prevId, match);
    } else {
      const archived = archiveMatch(match);
      match.archivedId = archived.id;
      if (match.clubId) syncMatchToCloud(match, archived);
    }
    SFX.win();
  }
}

/* Resets everything the wicket sheet keeps between taps (incl. the extra a
   wicket off a wide / no-ball came from). */
function resetWicketUi(){
  ui.wicketFlow = null; ui.wicketExtra = null; ui.runoutRuns = 0; ui.runoutEnd = "striker"; ui.runoutAt = null;
}
function confirmWicket(type){
  const inn = currentInnings(state.match);
  const extra = ui.wicketExtra || undefined;
  if (!wicketTypesFor(inn.freeHit, extra).includes(type)) return;
  pushSnapshot();
  recordBall(inn, { kind: "wicket", wicketType: type, extra });
  afterBall(state.match);
  maybeArchiveCompletedMatch(state.match);
  SFX.wicket(); liveMoment = wicketMoment(inn);
  resetWicketUi(); ui.pendingExtra = null;
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
    recordBall(inn, { kind: "wicket", wicketType: "runout", runs: ui.runoutRuns, endComingIn: ui.runoutEnd, outEnd: ui.runoutAt || ui.runoutEnd, fielder: fielder || undefined, extra: ui.wicketExtra || undefined });
    if (fielder) registerMatchPlayer(fielder, inn.bowlingTeam);
    afterBall(match);
    maybeArchiveCompletedMatch(match);
    SFX.wicket(); liveMoment = wicketMoment(inn);
    resetWicketUi(); ui.pendingExtra = null;
    save(); render();
  } else if (ui.wicketFlow === "caught" || ui.wicketFlow === "stumped"){
    const type = ui.wicketFlow;
    if (type === "caught" && match.requireFielderOnCatch && !fielder){ showFormError(e.target, "This preset requires naming the catch taker."); return; }
    const inn = currentInnings(match);
    if (!wicketTypesFor(inn.freeHit, ui.wicketExtra || undefined).includes(type)) return;
    pushSnapshot();
    recordBall(inn, { kind: "wicket", wicketType: type, fielder: fielder || undefined, extra: ui.wicketExtra || undefined });
    if (fielder) registerMatchPlayer(fielder, inn.bowlingTeam);
    afterBall(match);
    maybeArchiveCompletedMatch(match);
    SFX.wicket(); liveMoment = wicketMoment(inn);
    resetWicketUi(); ui.pendingExtra = null;
    save(); render();
  }
}
