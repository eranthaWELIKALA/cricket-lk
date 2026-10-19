/* Cricket.lk — match: "Catch up the score" sheet.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- catch up the score ---
   For a scorer who stopped updating the board: enter the innings as it
   stands now (totals, who got out and how, who's batting and bowling) and
   carry on from there. The engine does the work (catchUpError checks it,
   applyCatchUp lays it over what's recorded); this is the form around it.
   ui.catchUp = { rev, draft } -- `draft` is the form as plain strings, read
   back from the DOM before every add/remove row (catchUpEdit), and `rev`
   is the sheet's modalKey, so background re-renders leave typed input
   alone and only our own edits rebuild it. Opened from ⋯ Match options and
   from the opening sheet ("Already under way?"); applying it goes through
   the shared confirmation sheet, and Undo walks it back. */
function catchUpDraftFrom(match){
  const inn = currentInnings(match);
  const bpo = inn.ballsPerOver;
  const batters = inn.batting.order.filter(n => !inn.batting.stats[n].out).map(n => {
    const s = inn.batting.stats[n];
    return { name: n, locked: true, status: n === inn.nonStriker ? "nonStriker" : "striker", runs: String(s.runs), balls: String(s.balls) };
  });
  // Two at the crease to fill in (one with last man stands' lone batter).
  const want = battingAlone(inn) ? 1 : 2;
  while (batters.filter(b => b.status !== "out").length < want){
    const taken = batters.map(b => b.status);
    batters.push({ name: "", status: taken.includes("striker") ? "nonStriker" : "striker", runs: "", balls: "" });
  }
  const bowlers = match.anonymous ? [] : inn.bowling.order.map(n => {
    const b = inn.bowling.stats[n];
    return { name: n, locked: true, overs: oversDisplay(b.legalBalls, bpo), runs: String(b.runs) };
  });
  return {
    runs: String(inn.runs), wickets: String(inn.wickets), overs: oversDisplay(inn.legalBalls, bpo),
    wides: String(inn.extras.wides), noBalls: String(inn.extras.noBalls), byes: String(inn.extras.byes), legByes: String(inn.extras.legByes),
    finished: false, batters, bowlers, bowlerNow: inn.bowler || "", lastOver: inn.lastOverBowler || ""
  };
}

function openCatchUp(){
  const m = state.match;
  if (!m || (m.status !== "opening" && m.status !== "live") || currentInnings(m).complete) return;
  ui.matchMenu = null; ui.pendingExtra = null; resetWicketUi(); ui.liveScorecard = false;
  ui.catchUp = { rev: 0, draft: catchUpDraftFrom(m) };
  render();
}
function closeCatchUp(){
  const close = () => { ui.catchUp = null; render(); };
  if (ui.catchUp && (ui.catchUp.rev || hasDirtyForm("#modal-root"))) confirmDiscard(close); else close();
}

function readCatchUpDraft(form){
  const v = n => { const el = form.elements[n]; return el ? el.value : ""; };
  const draft = {
    runs: v("runs"), wickets: v("wickets"), overs: v("overs"),
    wides: v("wides"), noBalls: v("noBalls"), byes: v("byes"), legByes: v("legByes"),
    finished: !!(form.elements.finished && form.elements.finished.checked),
    batters: [], bowlers: [], bowlerNow: v("bowlerNow"), lastOver: v("lastOver")
  };
  form.querySelectorAll(".cu-bat").forEach(row => {
    const i = row.dataset.i;
    draft.batters.push({ name: v(`bat_name_${i}`), locked: row.dataset.locked === "1", status: v(`bat_status_${i}`),
      runs: v(`bat_runs_${i}`), balls: v(`bat_balls_${i}`), wicketType: v(`bat_how_${i}`), bowler: v(`bat_bowler_${i}`), fielder: v(`bat_fielder_${i}`) });
  });
  form.querySelectorAll(".cu-bowl").forEach(row => {
    const i = row.dataset.i;
    draft.bowlers.push({ name: v(`bowl_name_${i}`), locked: row.dataset.locked === "1", overs: v(`bowl_overs_${i}`), runs: v(`bowl_runs_${i}`) });
  });
  return draft;
}

/* Draft strings -> the engine's numbers and names. A blank total is NaN (the
   engine says what's missing); a blank player figure is null ("leave as
   recorded"). Typed nicknames / "#7" resolve to the roster name. */
function catchUpDataFrom(draft, match){
  const bpo = currentInnings(match).ballsPerOver;
  const num = v => { const t = String(v || "").trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : NaN; };
  const opt = v => (String(v || "").trim() ? num(v) : null);
  const overs = v => { const b = parseOversInput(v, bpo); return b === null ? NaN : b; };
  const name = v => resolveTypedName(v || "");
  const rows = draft.batters.filter(b => b.locked || String(b.name).trim());
  return {
    runs: num(draft.runs), wickets: num(draft.wickets), balls: overs(draft.overs),
    extras: { wides: num(draft.wides), noBalls: num(draft.noBalls), byes: num(draft.byes), legByes: num(draft.legByes) },
    finished: !!draft.finished,
    batters: rows.map(b => ({ name: name(b.name), status: b.status, runs: opt(b.runs), balls: opt(b.balls),
      wicketType: b.wicketType || null, bowler: name(b.bowler), fielder: name(b.fielder) })),
    bowlers: draft.bowlers.filter(b => b.locked || String(b.name).trim()).map(b => ({
      name: name(b.name), balls: String(b.overs || "").trim() ? overs(b.overs) : null, runs: opt(b.runs) })),
    bowlerNow: name(draft.bowlerNow), lastOver: name(draft.lastOver)
  };
}

// Read the form, change the draft, rebuild the sheet (a new rev = a new modalKey).
function catchUpEdit(fn){
  const form = document.getElementById("catch-up-form");
  if (!form || !ui.catchUp) return;
  const draft = readCatchUpDraft(form);
  fn(draft);
  ui.catchUp.draft = draft;
  ui.catchUp.rev += 1;
  form.dataset.submitted = "1"; // the draft carries the values now, not captureFormDrafts
  render();
}
function catchUpAddRow(kind){
  catchUpEdit(d => {
    if (kind === "bowl") d.bowlers.push({ name: "", overs: "", runs: "" });
    else {
      // a free end first (the batter who came in), else another one who got out
      const taken = d.batters.map(b => b.status);
      const status = !taken.includes("striker") ? "striker" : !taken.includes("nonStriker") ? "nonStriker" : "out";
      d.batters.push({ name: "", status, runs: "", balls: "", wicketType: "", bowler: "", fielder: "" });
    }
  });
}
function catchUpRemoveRow(kind, i){
  catchUpEdit(d => {
    const list = kind === "bowl" ? d.bowlers : d.batters;
    if (list[i] && !list[i].locked) list.splice(i, 1);
  });
}

function renderCatchUpModal(match){
  const inn = currentInnings(match);
  const bpo = inn.ballsPerOver;
  const d = ui.catchUp.draft;
  const esc = escapeHtml;
  const field = (label, name, value, extra) => `<label class="cu-field"><span>${label}</span><input name="${name}" value="${esc(value)}" inputmode="numeric" autocomplete="off" ${extra || ""}></label>`;
  const batPool = pickCandidates(match, pickPool(inn.battingTeam), "batter");
  const fieldPool = [...new Set([...inn.bowling.order, ...pickCandidates(match, pickPool(inn.bowlingTeam), "fielder")])];
  const combo = (name, value, placeholder, pool, group) =>
    renderNameCombo("", `name="${name}" value="${esc(value)}" maxlength="24" placeholder="${placeholder}" data-combo-group="${group}"`, pool);
  const doneOut = inn.batting.order.filter(n => inn.batting.stats[n].out);
  const HOW = [["", "How out?"], ["bowled", "Bowled"], ["caught", "Caught"], ["lbw", "LBW"], ["stumped", "Stumped"], ["hitwicket", "Hit wicket"], ["runout", "Run out"]];
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
  const batRow = (b, i) => `
    <div class="cu-row cu-bat" data-i="${i}" data-locked="${b.locked ? 1 : 0}">
      <div class="cu-line">
        ${b.locked
          ? `<div class="cu-name">${esc(liveName(b.name))}</div><input type="hidden" name="bat_name_${i}" value="${esc(b.name)}">`
          : combo(`bat_name_${i}`, b.name, "Batter", batPool, "bat")}
        ${b.locked ? "" : `<button type="button" data-action="catch-up-remove" data-kind="bat" data-i="${i}" class="cu-remove" aria-label="Remove this batter">✕</button>`}
      </div>
      <div class="cu-line">
        <select name="bat_status_${i}" class="cu-status" aria-label="Status">${opts([["striker", "On strike"], ["nonStriker", "Other end"], ["out", "Out"]], b.status)}</select>
        <input name="bat_runs_${i}" value="${esc(b.runs)}" inputmode="numeric" placeholder="Runs" aria-label="Runs" class="cu-num">
        <input name="bat_balls_${i}" value="${esc(b.balls)}" inputmode="numeric" placeholder="Balls" aria-label="Balls" class="cu-num">
      </div>
      <div class="cu-out">
        <select name="bat_how_${i}" class="cu-how" aria-label="How out">${opts(HOW, b.wicketType || "")}</select>
        <div class="cu-bowler">${combo(`bat_bowler_${i}`, b.bowler || "", "Bowler", fieldPool, "none")}</div>
        <div class="cu-fielder">${combo(`bat_fielder_${i}`, b.fielder || "", `Fielder${match.requireFielderOnCatch || match.requireFielderOnRunout ? "" : " (optional)"}`, fieldPool, "none")}</div>
      </div>
    </div>`;
  const bowlRow = (b, i) => `
    <div class="cu-row cu-bowl" data-i="${i}" data-locked="${b.locked ? 1 : 0}">
      <div class="cu-line">
        ${b.locked
          ? `<div class="cu-name">${esc(liveName(b.name))}</div><input type="hidden" name="bowl_name_${i}" value="${esc(b.name)}">`
          : combo(`bowl_name_${i}`, b.name, "Bowler", fieldPool, "bowl")}
        <input name="bowl_overs_${i}" value="${esc(b.overs)}" inputmode="decimal" placeholder="Overs" aria-label="Overs" class="cu-num">
        <input name="bowl_runs_${i}" value="${esc(b.runs)}" inputmode="numeric" placeholder="Runs" aria-label="Runs conceded" class="cu-num">
        ${b.locked ? "" : `<button type="button" data-action="catch-up-remove" data-kind="bowl" data-i="${i}" class="cu-remove" aria-label="Remove this bowler">✕</button>`}
      </div>
    </div>`;
  const now = `${inn.runs}-${inn.wickets} (${oversDisplay(inn.legalBalls, bpo)})`;
  return `
    <div class="modal-backdrop">
      <div class="modal catch-up-modal" data-keep-scroll="catch-up" role="dialog" aria-modal="true" aria-label="Catch up the score">
        <div class="wicket-modal-head">
          <h2>Catch up the score</h2>
          <span class="n batter">${esc(teamName(match, inn.battingTeam))} · ${now}</span>
          <button type="button" data-action="close-catch-up" class="sheet-close" aria-label="Close">✕</button>
        </div>
        <p class="hint" style="margin-top:0;">Missed some balls? Enter the innings as it stands <b>now</b> and carry on scoring from there. What's already recorded stays; nothing changes until you confirm.</p>
        <form id="catch-up-form" novalidate>
          <div class="section-label">Score now</div>
          <div class="cu-grid three">
            ${field("Runs", "runs", d.runs)}
            ${field("Wickets", "wickets", d.wickets)}
            ${field("Overs", "overs", d.overs, `inputmode="decimal" placeholder="6.1"`)}
          </div>
          <div class="cu-grid four">
            ${field("Wides", "wides", d.wides)}
            ${field("No-balls", "noBalls", d.noBalls)}
            ${field("Byes", "byes", d.byes)}
            ${field("Leg byes", "legByes", d.legByes)}
          </div>
          <p class="hint">Overs like <b>6.1</b> = 6 overs and 1 ball (up to ${bpo - 1} after the dot). Extras are the innings totals so far.</p>
          ${match.anonymous ? `<p class="hint">No names in this match: the next batters and bowlers fill in by themselves.</p>` : `
          <div class="section-label">Batters</div>
          ${doneOut.length ? `<div class="cu-done">${doneOut.map(n => { const s = inn.batting.stats[n]; return `<div class="cu-done-row"><span class="name">${esc(liveName(n))}</span><span class="n">${esc(s.howOut || "out")} · ${s.runs} (${s.balls})</span></div>`; }).join("")}</div>` : ""}
          ${d.batters.map(batRow).join("")}
          <button type="button" data-action="catch-up-add" data-kind="bat" class="ghost small cu-add">+ Add batter</button>
          <div class="section-label">Bowlers</div>
          <div class="cu-grid two">
            <div class="cu-field"><span>Bowling now</span>${combo("bowlerNow", d.bowlerNow, "Needed mid-over", fieldPool, "none")}</div>
            <div class="cu-field"><span>Bowled the last over</span>${combo("lastOver", d.lastOver, "Needed at x.0", fieldPool, "none")}</div>
          </div>
          <p class="hint">Mid-over (like 6.1) say who's bowling it. At the end of an over (like 6.0) say who bowled the last one: they can't bowl the next.</p>
          ${d.bowlers.map(bowlRow).join("")}
          <button type="button" data-action="catch-up-add" data-kind="bowl" class="ghost small cu-add">+ Add bowler figures</button>`}
          <label class="cu-check"><input type="checkbox" name="finished" ${d.finished ? "checked" : ""}> This innings is already over</label>
          <p class="hint">Players' runs, balls and overs are optional; anything left blank shows as "not attributed". A caught-up match doesn't count towards player stats or MVP.</p>
          <div class="form-error" role="alert"></div>
          <div class="cu-actions">
            <button type="button" data-action="close-catch-up" class="ghost">Cancel</button>
            <button type="submit" class="primary">Review</button>
          </div>
        </form>
      </div>
    </div>`;
}

function handleCatchUpSubmit(e){
  e.preventDefault();
  const m = state.match, form = e.target;
  if (!m || !ui.catchUp) return;
  const draft = readCatchUpDraft(form);
  ui.catchUp.draft = draft;
  const data = catchUpDataFrom(draft, m);
  const err = catchUpError(m, data);
  if (err){
    showFormError(form, err);
    const box = form.querySelector(".form-error");
    if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
    return;
  }
  askCatchUpConfirm(m, data);
}

/* The review: before → after, who's out, who's in, what isn't credited to
   anyone, and whether this ends the innings -- worked out on a copy. */
function askCatchUpConfirm(m, data){
  const inn = currentInnings(m);
  const bpo = inn.ballsPerOver;
  const probe = JSON.parse(JSON.stringify(m));
  applyCatchUp(probe, data);
  const after = probe.innings[m.innings.length - 1];
  const esc = escapeHtml;
  const score = i => `${i.runs}-${i.wickets} (${oversDisplay(i.legalBalls, bpo)})`;
  const newOut = after.fallOfWickets.slice(inn.fallOfWickets.length).map(f => `<li><b>${esc(f.batsman)}</b> ${esc(after.batting.stats[f.batsman].howOut)}</li>`);
  const un = catchUpUnattributed(after);
  const notes = [];
  if (un && un.batRuns > 0) notes.push(`${un.batRuns} run${un.batRuns === 1 ? "" : "s"} off the bat not credited to a batter`);
  if (un && !m.anonymous && un.bowlBalls > 0) notes.push(`${oversDisplay(un.bowlBalls, bpo)} overs not credited to a bowler`);
  if (un && !m.anonymous && un.bowlRuns > 0) notes.push(`${un.bowlRuns} run${un.bowlRuns === 1 ? "" : "s"} conceded not credited to a bowler`);
  const ends = after.complete
    ? (probe.status === "complete" ? `<p><b>This ends the match:</b> ${esc(probe.result)}.</p>` : `<p><b>This ends the innings.</b> ${esc(teamName(m, inn.bowlingTeam))} will need ${after.runs + 1}.</p>`)
    : `<p>Then: ${after.striker ? `<b>${esc(after.striker)}</b> on strike${after.nonStriker ? `, ${esc(after.nonStriker)} at the other end` : ""}` : "pick the next batter"}; ${after.bowler ? `<b>${esc(after.bowler)}</b> bowling` : "pick the next bowler"}.</p>`;
  askConfirm({
    title: "Update the score?", icon: "⏩", tone: "primary",
    body: `
      <p>${esc(teamName(m, inn.battingTeam))} <b class="n">${score(inn)}</b> → <b class="n">${score(after)}</b></p>
      ${newOut.length ? `<p class="hint" style="margin-bottom:2px;">Out since then:</p><ul class="cu-list">${newOut.join("")}</ul>` : ""}
      ${ends}
      ${notes.length ? `<p class="hint">Not attributed: ${notes.map(esc).join("; ")}.</p>` : ""}
      <p class="hint">This match won't count towards player stats or MVP. Undo puts the score back.</p>`,
    confirmLabel: "Update score", cancelLabel: "Back to edit",
    onConfirm: () => applyCatchUpNow(data)
  });
}

function applyCatchUpNow(data){
  const m = state.match;
  if (!m || catchUpError(m, data)) return { error: "The score changed meanwhile. Check the form again." };
  const inn = currentInnings(m);
  pushSnapshot();
  applyCatchUp(m, data);
  if (!m.anonymous){
    const fieldSide = [...data.bowlers.map(b => b.name), data.bowlerNow, data.lastOver];
    data.batters.forEach(b => {
      registerMatchPlayer(b.name, inn.battingTeam);
      if (b.status === "out"){ if (b.wicketType !== "runout") fieldSide.push(b.bowler); if (b.wicketType === "caught" || b.wicketType === "runout") fieldSide.push(b.fielder); }
    });
    fieldSide.filter(n => n && n.trim()).forEach(n => registerMatchPlayer(n, inn.bowlingTeam));
  }
  maybeArchiveCompletedMatch(m);
  ui.catchUp = null; ui.pickDismissed = null;
  save();
}
