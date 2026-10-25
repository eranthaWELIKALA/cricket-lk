/* Cricket.lk — match: name an unnamed batter/bowler later (the pick sheets' "carry on unnamed").
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- naming an unnamed player ---
   "Carry on unnamed" (the pick sheets) leaves a placeholder such as
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
    line = `${s.runs} (${s.balls}) · ${s.out ? s.howOut : "not out"} · ${teamName(m, inn.battingTeam)}`;
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
      }).join("")}</div>
      <p class="hint">Picking someone who already bowled adds this over to their figures.</p>` : "")
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
        <button type="button" data-action="close-name-later" class="ghost" style="width:100%;margin-top:10px;">Not now</button>
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
