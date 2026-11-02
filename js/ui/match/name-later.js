/* Cricket.lk — match: name an unnamed batter/bowler later (the pick sheets' "Continue without naming").
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- naming an unnamed player ---
   "Continue without naming" (the pick sheets) leaves a placeholder such as
   "Bat ?2". Tapping it -- on the live board, a scorecard, ⋯ Match
   options or Result -- opens this sheet (ui.nameLater = { name }): the same
   one-tap rows as the pick sheets, plus a box for a new name. Saving runs
   nameUnnamedPlayer (ENGINE) on a copy and swaps it in through applyBallEdit
   (snapshot first, a finished match's archive entry replaced and re-synced).
   Allowed wherever ball edits are (ballEditAllowed). */
function openNameLater(name){
  const m = state.match;
  if (!ballEditAllowed(m) || !unnamedPlayers(m).some(u => u.name === name)) return;
  ui.matchMenu = null;
  ui.nameLater = { name };
  render();
}
function closeNameLater(){
  ui.nameLater = null;
  render();
}
// Who the placeholder could be: everyone on that side it may still become.
function nameLaterCandidates(m, entry){
  const inn = m.innings[entry.inn];
  const ok = n => !isUnnamedPlayer(n) && !nameUnnamedError(m, entry.name, n);
  if (entry.role === "batter") return pickCandidates(m, pickPool(inn.battingTeam), "batter", inn).filter(ok);
  const bowled = inn.bowling.order.filter(ok);
  const seen = new Set(bowled.map(n => n.toLowerCase()));
  return { bowled, others: pickCandidates(m, pickPool(inn.bowlingTeam), "fielder", inn).filter(n => ok(n) && !seen.has(n.toLowerCase())) };
}
function renderNameLaterModal(m){
  const from = ui.nameLater.name;
  const entry = unnamedPlayers(m).find(u => u.name === from);
  const inn = m.innings[entry.inn];
  const bpo = inn.ballsPerOver;
  let line, rows;
  if (entry.role === "batter"){
    const s = inn.batting.stats[from];
    line = `${s.runs} (${s.balls}) · ${batterStatusText(s)} · ${teamName(m, inn.battingTeam)}`;
    rows = renderPickRows(m.squads ? "Yet to bat" : "Players", nameLaterCandidates(m, entry), "name-later-pick");
  } else {
    const b = inn.bowling.stats[from];
    const overs = inn.overs.map((o, i) => o.bowler === from ? i + 1 : null).filter(Boolean);
    if (inn.bowler === from && inn.currentOverEvents.length) overs.push(inn.overs.length + 1);
    line = `${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}${overs.length ? ` · over ${overs.join(", ")}` : ""} · ${teamName(m, inn.bowlingTeam)}`;
    const c = nameLaterCandidates(m, entry);
    rows = (c.bowled.length ? `
      <div class="section-label">Already bowled</div>
      <div class="bowler-pick-list">${c.bowled.map(n => {
        const s = inn.bowling.stats[n];
        return pickRowHtml(n, "name-later-pick", `${oversDisplay(s.legalBalls, bpo)}-${s.maidens}-${s.runs}-${s.wickets}`);
      }).join("")}</div>` : "")
      + renderPickRows("Players", c.others, "name-later-pick");
  }
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="name-later">
        <div class="wicket-modal-head">
          <h2>Who was it?</h2>
          <span class="end-badge">${escapeHtml(from)}</span>
        </div>
        <p class="hint n" style="margin-top:0;">${escapeHtml(line)}</p>
        <form id="name-later-form">
          <div class="form-error"></div>
          ${renderPickSearch("Save")}
          ${rows}
        </form>
        <div class="sheet-actions"><button type="button" data-action="close-name-later" class="ghost">Not now</button></div>
      </div>
    </div>`;
}
function handleNameLaterSubmit(e){
  e.preventDefault();
  saveNameLater(resolveTypedName(new FormData(e.target).get("name")), e.target);
}
function saveNameLater(typed, form){
  const m = state.match;
  if (!ui.nameLater || !ballEditAllowed(m)) return;
  const from = ui.nameLater.name;
  const err = nameUnnamedError(m, from, typed);
  if (err){ showFormError(form, err); return; }
  const entry = unnamedPlayers(m).find(u => u.name === from);
  const name = unnamedTarget(m, typed);
  const side = entry.role === "batter" ? m.innings[entry.inn].battingTeam : m.innings[entry.inn].bowlingTeam;
  const apply = () => {
    applyBallEdit(m, nameUnnamedPlayer(m, from, name));
    registerMatchPlayer(name, side);
    ui.nameLater = null;
    render();
  };
  // A name that isn't on the side's list asks first (confirmUnlisted); so
  // does a finished match, since the Result screen has no Undo.
  if (m.status !== "complete"){ confirmUnlisted(m, [{ name, teamKey: side }], apply); return; }
  const fresh = unlistedNames(m, [{ name, teamKey: side }]).length;
  askConfirm({
    title: `${from} was ${name}?`, icon: "✎", tone: "primary", confirmLabel: "Save",
    body: `<p>The scorecard, commentary and stats of this finished match will show <b>${escapeHtml(name)}</b> instead of ${escapeHtml(from)}.</p>`
      + (fresh ? `<p class="hint">${escapeHtml(name)} isn't on ${escapeHtml(teamName(m, side))}'s list yet: they'll be added as a new player.</p>` : ""),
    onConfirm: apply
  });
}
// A placeholder's name, as a button that opens the sheet (where naming is allowed).
function unnamedNameHtml(match, name, shown){
  if (!isUnnamedPlayer(name) || !ballEditAllowed(match)) return escapeHtml(shown == null ? name : shown);
  return `<button type="button" data-action="name-later" data-name="${escapeHtml(name)}" class="pick-slot unnamed-slot" aria-label="Say who ${escapeHtml(name)} was">${escapeHtml(name)} ✎</button>`;
}

/* --- a wrong player picked: replace them ---
   Tapping a batter's or bowler's name (the live board, a scorecard, or ⋯
   Match options → Change a player, which first lists whose) opens this sheet:
   ui.replacePick = { inn, role, name, overs } -- for a bowler, which of their
   overs (bowlerSpells keys): the over going on if they're bowling now,
   otherwise all of them, and chips to change that. Pick who it really was
   (the same one-tap rows as the pick sheets, or a typed name); the shared
   confirmation says what moves, and replacePick (ENGINE: the pick changed in
   the log, the innings replayed) goes in through applyBallEdit -- snapshot,
   a finished match's archive entry replaced. ui.replacePick = { choose: true }
   is Match options' first step. Placeholders go to "Who was it?" instead. */
function canReplacePick(m){ return ballEditAllowed(m) && !m.anonymous; }
function replaceablePlayers(m, idx){
  const inn = m.innings[idx];
  if (!inn || !inn.log) return { batters: [], bowlers: [] };
  return {
    batters: inn.batting.order.filter(n => !isUnnamedPlayer(n)),
    bowlers: inn.bowling.order.filter(n => !isUnnamedPlayer(n) && !(inn.logBase && inn.logBase.bowling.order.includes(n)))
  };
}
function openReplacePick(idx, role, name){
  const m = state.match;
  if (!canReplacePick(m)) return;
  if (isUnnamedPlayer(name)){ openNameLater(name); return; }
  const inn = m.innings[idx];
  if (!inn || !inn.log) return;
  let overs = null;
  if (role === "bowler"){
    const spells = bowlerSpells(inn, name);
    if (!spells.length) return;
    const now = spells.find(sp => sp.now);
    overs = now ? [now.key] : spells.map(sp => sp.key);
  } else if (!inn.batting.order.includes(name)) return;
  ui.matchMenu = null;
  ui.replacePick = { inn: idx, role, name, overs, fromChooser: !!(ui.replacePick && ui.replacePick.choose) };
  render();
}
// Back from a player picked in Match options' list goes back to that list.
function closeReplacePick(){
  ui.replacePick = ui.replacePick && ui.replacePick.fromChooser ? { choose: true } : null;
  render();
}
function replacePickStillThere(m, rp){
  if (rp.choose) return true;
  const inn = m.innings[rp.inn];
  if (!inn || !inn.log) return false;
  return rp.role === "batter" ? inn.batting.order.includes(rp.name) : bowlerSpells(inn, rp.name).length > 0;
}
function toggleReplaceOver(key){
  const rp = ui.replacePick;
  if (!rp || rp.role !== "bowler") return;
  rp.overs = rp.overs.includes(key) ? rp.overs.filter(k => k !== key) : [...rp.overs, key];
  render();
}
// Who it could have been: everyone on that side the change works for.
function replaceCandidates(m, rp){
  const inn = m.innings[rp.inn];
  const ok = n => !isUnnamedPlayer(n) && !replacePickError(m, { inn: rp.inn, role: rp.role, from: rp.name, to: n, overs: rp.overs });
  if (rp.role === "batter") return pickCandidates(m, pickPool(inn.battingTeam), "batter", inn).filter(ok);
  const bowled = inn.bowling.order.filter(ok);
  const seen = new Set(bowled.map(n => n.toLowerCase()));
  return { bowled, others: pickCandidates(m, pickPool(inn.bowlingTeam), "fielder", inn).filter(n => ok(n) && !seen.has(n.toLowerCase())) };
}
function bowlerFigs(b, bpo){ return `${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}`; }
function renderReplacePickModal(m){
  const rp = ui.replacePick;
  if (rp.choose) return renderReplaceChooser(m);
  const inn = m.innings[rp.inn];
  const bpo = inn.ballsPerOver;
  const from = rp.name;
  let line, rows, overPick = "";
  if (rp.role === "batter"){
    const s = inn.batting.stats[from];
    line = `${s.runs} (${s.balls}) · ${batterStatusText(s)} · ${teamName(m, inn.battingTeam)}`;
    rows = renderPickRows(m.squads ? "Yet to bat" : "Players", replaceCandidates(m, rp), "replace-pick-to");
  } else {
    line = `${bowlerFigs(inn.bowling.stats[from], bpo)} · ${teamName(m, inn.bowlingTeam)}`;
    const spells = bowlerSpells(inn, from);
    if (spells.length > 1) overPick = `
      <div class="section-label">Which overs were wrong?</div>
      <div class="over-chips">${spells.map(sp => `<button type="button" data-action="replace-pick-over" data-key="${sp.key}" class="over-chip${rp.overs.includes(sp.key) ? " active" : ""}" aria-pressed="${rp.overs.includes(sp.key)}">${sp.now ? `Over ${sp.number} · now` : `Over ${sp.number}`}</button>`).join("")}</div>`;
    const c = replaceCandidates(m, rp);
    rows = !rp.overs.length ? `<p class="hint">Pick at least one over above.</p>` : (c.bowled.length ? `
      <div class="section-label">Already bowled</div>
      <div class="bowler-pick-list">${c.bowled.map(n => pickRowHtml(n, "replace-pick-to", bowlerFigs(inn.bowling.stats[n], bpo))).join("")}</div>` : "")
      + renderPickRows("Players", c.others, "replace-pick-to");
  }
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="replace-pick">
        <div class="wicket-modal-head">
          <h2>${rp.role === "batter" ? "Wrong batter?" : "Wrong bowler?"}</h2>
          <span class="end-badge">${escapeHtml(from)}</span>
        </div>
        <p class="hint n" style="margin-top:0;">${escapeHtml(line)}</p>
        ${overPick}
        <form id="replace-pick-form">
          <div class="form-error"></div>
          ${renderPickSearch("Use")}
          ${rows}
        </form>
        <div class="sheet-actions"><button type="button" data-action="close-replace-pick" class="ghost">Cancel</button></div>
      </div>
    </div>`;
}
/* Match options → Change a player: this match's batters and bowlers, newest
   innings first, each a row that opens the sheet above. */
function renderReplaceChooser(m){
  const blocks = m.innings.map((inn, idx) => ({ inn, idx, p: replaceablePlayers(m, idx) }))
    .filter(b => b.p.batters.length || b.p.bowlers.length).reverse();
  const row = (idx, role, n, figs) => `<button type="button" data-action="replace-pick" data-inn="${idx}" data-role="${role}" data-name="${escapeHtml(n)}" class="bowler-pick-row"><span class="name">${escapeHtml(liveName(n))}</span><span class="n figs">${figs}</span></button>`;
  return `
    <div class="modal-backdrop">
      <div class="modal" data-keep-scroll="replace-pick">
        <div class="wicket-modal-head"><h2>Change a player</h2><span class="n batter">tap whose name is wrong</span></div>
        ${blocks.length ? blocks.map(({ inn, idx, p }) => `
          ${p.batters.length ? `<div class="section-label">${escapeHtml(teamName(m, inn.battingTeam))} batting</div>
          <div class="bowler-pick-list">${p.batters.map(n => { const s = inn.batting.stats[n]; return row(idx, "batter", n, `${s.runs} (${s.balls})${s.out ? " · out" : ""}`); }).join("")}</div>` : ""}
          ${p.bowlers.length ? `<div class="section-label">${escapeHtml(teamName(m, inn.bowlingTeam))} bowling</div>
          <div class="bowler-pick-list">${p.bowlers.map(n => row(idx, "bowler", n, bowlerFigs(inn.bowling.stats[n], inn.ballsPerOver))).join("")}</div>` : ""}
        `).join("") : `<p class="hint">No players to change yet.</p>`}
        <div class="sheet-actions"><button type="button" data-action="close-replace-pick" class="ghost">Close</button></div>
      </div>
    </div>`;
}
function openReplaceChooser(){
  if (!canReplacePick(state.match)) return;
  ui.matchMenu = null;
  ui.replacePick = { choose: true };
  render();
}
function handleReplacePickSubmit(e){
  e.preventDefault();
  askReplacePick(resolveTypedName(new FormData(e.target).get("name")), e.target);
}
/* Works the change out first (replacePick, on a copy), then asks: who moves
   where, as the scorecard will show it. */
function askReplacePick(typed, form){
  const m = state.match;
  const rp = ui.replacePick;
  if (!rp || rp.choose || !canReplacePick(m) || !typed) return;
  const spec = { inn: rp.inn, role: rp.role, from: rp.name, to: typed, overs: rp.role === "bowler" ? rp.overs : null };
  const res = replacePick(m, spec);
  if (res.error){ showFormError(form, res.error); return; }
  const to = unnamedTarget(m, typed);
  const from = rp.name;
  const inn = m.innings[rp.inn], nInn = res.match.innings[rp.inn];
  const side = rp.role === "batter" ? inn.battingTeam : inn.bowlingTeam;
  const fresh = unlistedNames(m, [{ name: to, teamKey: side }]).length;
  let what;
  if (rp.role === "batter"){
    const s = inn.batting.stats[from];
    what = `<p><b>${escapeHtml(to)}</b> takes ${escapeHtml(from)}'s place in this innings: <b class="n">${s.runs} (${s.balls})</b>, ${escapeHtml(batterStatusText(s))}. ${escapeHtml(from)} goes back on the list of those yet to bat.</p>`;
  } else {
    const spells = bowlerSpells(inn, from).filter(sp => rp.overs.includes(sp.key));
    const nums = spells.map(sp => sp.number);
    const which = spells.length === 1 && spells[0].now ? "This over is"
      : `Over${nums.length === 1 ? "" : "s"} ${nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`} ${nums.length === 1 ? "was" : "were"}`;
    const fig = n => nInn.bowling.stats[n] ? bowlerFigs(nInn.bowling.stats[n], nInn.ballsPerOver) : null;
    what = `<p>${which} <b>${escapeHtml(to)}</b>'s, not ${escapeHtml(from)}'s. Their figures in this innings then read:</p>`
      + `<ul class="confirm-names"><li><b>${escapeHtml(to)}</b> <span class="n">${fig(to)}</span></li>`
      + `<li>${escapeHtml(from)} <span class="n">${fig(from) || "no overs"}</span></li></ul>`;
  }
  askConfirm({
    title: `${from} → ${to}?`, icon: "⇄", tone: "primary", confirmLabel: "Replace",
    body: what
      + (fresh ? `<p class="hint">${escapeHtml(to)} isn't on ${escapeHtml(teamName(m, side))}'s list yet: they'll be added as a new player.</p>` : "")
      + (res.notes.length ? `<ul class="confirm-names">${res.notes.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "")
      + `<p class="hint">${m.status === "complete" ? "This match is finished: its scorecard, stats and history change too." : "Undo takes it back."}</p>`,
    onConfirm: () => {
      if (state.match !== m) return;
      applyBallEdit(m, res.match);
      registerMatchPlayer(to, side);
      ui.replacePick = null;
      render();
    }
  });
}
// A player's name on the board / a scorecard: a button that opens the sheet
// above where a pick can be changed (a placeholder's opens "Who was it?").
function playerNameHtml(match, inn, role, name, shown){
  if (isUnnamedPlayer(name)) return unnamedNameHtml(match, name, shown);
  const idx = match && match.innings ? match.innings.indexOf(inn) : -1;
  const text = escapeHtml(shown == null ? name : shown);
  if (idx < 0 || !inn.log || !canReplacePick(match)) return text;
  if (role === "bowler" && inn.logBase && inn.logBase.bowling.order.includes(name)) return text;
  return `<button type="button" data-action="replace-pick" data-inn="${idx}" data-role="${role}" data-name="${escapeHtml(name)}" class="name-btn" aria-label="${escapeHtml(name)}: wrong player? Change them">${text}</button>`;
}
