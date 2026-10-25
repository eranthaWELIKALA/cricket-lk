/* Cricket.lk — match: edit (or remove) an earlier ball, from ball by ball.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- edit an earlier ball ---
   Ball by ball's chips are buttons for the match in progress (and a finished
   one still on its Result screen). A tap opens this sheet: ui.ballEdit =
   { inn, seq, label, d (the draft: kind, runs, wicketType, extra,
   endComingIn, outEnd), need, supply, error }. Saving runs replayMatch
   (ENGINE) on a copy; when the log can't say who batted or bowled next
   (`need`), the sheet asks and tries again with that name in `supply`. The
   shared confirmation sheet then shows old -> new before anything changes,
   and the change is snapshotted first, so Undo walks it back. */
const BALL_EDIT_KINDS = [["run", "Runs"], ["wide", "Wide"], ["noball", "No ball"], ["bye", "Bye"], ["legbye", "Leg bye"], ["wicket", "Wicket"]];

// ⋯ Match options → "Edit an earlier ball": the scorecard sheet, on ball by ball.
function openEditBalls(){
  ui.matchMenu = null;
  if (!state.match) return;
  ui.liveScorecard = state.match.status;
  ui.scorecard = { inn: null, mode: "balls" };
  render();
}

/* Only the match on this device, while it's being scored or on its Result
   screen -- an archived match from a list (ui.matchDetail) is never edited. */
function ballEditAllowed(match){
  return !!(match && match === state.match && !match.forfeited && !match.resultOnly && !ui.awayFromMatch);
}

function ballEditEvent(match, idx, seq){
  const inn = match.innings[idx];
  const all = [...inn.overs.flatMap(o => o.events), ...inn.currentOverEvents];
  return all.find(ev => ev.seq === seq) || null;
}

function openBallEdit(idx, seq, label){
  const m = state.match;
  if (!ballEditAllowed(m)) return;
  const act = editableBall(m, idx, seq);
  if (!act) return;
  const ev = act.ev;
  ui.ballEdit = {
    inn: idx, seq, label: label || "",
    d: {
      kind: ev.kind, runs: ev.runs || 0, wicketType: ev.wicketType || null, extra: ev.extra || "",
      endComingIn: ev.endComingIn || "striker", outEnd: ev.outEnd || null, fielder: ev.fielder || ""
    },
    need: null, needFor: null, supply: { batters: [], bowlers: [] }, supplied: [], error: null
  };
  render();
}

function closeBallEdit(){
  ui.ballEdit = null;
  render();
}

/* One tap in the sheet: change one draft field. Anything asked for earlier
   (a name, an error) belonged to the old draft, so it's dropped. */
function ballEditSet(field, value){
  const be = ui.ballEdit;
  if (!be) return;
  const d = be.d;
  readBallEditFielder(be);
  if (field === "kind"){
    d.kind = value;
    if (value === "bye" || value === "legbye") d.runs = Math.max(1, d.runs || 0);
    if (value === "wicket"){ d.runs = 0; if (!d.wicketType) d.wicketType = null; }
  } else if (field === "runs") d.runs = parseInt(value, 10) || 0;
  else if (field === "extra") d.extra = value;
  else if (field === "wicketType") d.wicketType = value;
  else if (field === "endComingIn"){ d.endComingIn = value; d.outEnd = null; }
  else if (field === "outEnd") d.outEnd = value;
  if (d.kind === "wicket"){
    const fh = (ballEditEvent(state.match, be.inn, be.seq) || {}).freeHit;
    const allowed = wicketTypesFor(fh, d.extra);
    if (d.wicketType && !allowed.includes(d.wicketType)) d.wicketType = null;
    if (!d.wicketType && allowed.length === 1) d.wicketType = allowed[0];
    if (d.wicketType !== "runout") d.runs = 0;
  }
  be.need = null; be.supply = { batters: [], bowlers: [] }; be.supplied = []; be.error = null;
  // A change the log can't follow (one more wicket, an over ending at
  // another ball) is asked about at once, as a "?" in the sheet.
  const pv = ballEditPreview(state.match, be);
  if (pv.need){ be.need = pv.need; be.needFor = "edit"; }
  render();
}

/* The fielder box is typed, not tapped: keep what's in it in the draft, so a
   re-render (a tap, an error, a "who came in?" question) never loses it. */
function readBallEditFielder(be){
  const input = document.querySelector('#ball-edit-form input[name="fielder"]');
  if (input) be.d.fielder = input.value;
}

// Two events are the same ball if every field matches (in any order).
function sameBallEvent(a, b){
  const norm = e => JSON.stringify(Object.keys(e).filter(k => k !== "seq" && e[k] !== undefined).sort().map(k => [k, e[k]]));
  return norm(a) === norm(b);
}

// The draft as a recordBall event, or { error }. `preview`: only what
// changes the score -- the fielder is checked when it's saved.
function ballEditToEvent(match, be, preview){
  const d = be.d;
  const inn = match.innings[be.inn];
  if (d.kind !== "wicket") return { ev: { kind: d.kind, runs: d.runs } };
  if (!d.wicketType) return { error: "Pick how the batter was out." };
  const act = editableBall(match, be.inn, be.seq);
  const ev = { kind: "wicket", wicketType: d.wicketType };
  if (d.extra) ev.extra = d.extra;
  if (d.wicketType === "runout"){
    if (!act[d.endComingIn]) return { error: "Nobody was batting at that end on this ball." };
    Object.assign(ev, { runs: d.runs, endComingIn: d.endComingIn, outEnd: d.outEnd || d.endComingIn });
  }
  if (!preview && (d.wicketType === "caught" || d.wicketType === "runout")){
    const fielder = match.anonymous ? "" : resolveTypedName(d.fielder);
    const required = d.wicketType === "runout" ? match.requireFielderOnRunout : match.requireFielderOnCatch;
    if (required && !fielder) return { error: `This match needs the ${d.wicketType === "runout" ? "run-out taker" : "catch taker"} named.` };
    if (fielder){
      const conflict = playerSideConflict(match, fielder, inn.bowlingTeam);
      if (conflict) return { error: conflict };
      ev.fielder = fielder;
    }
  }
  return { ev };
}

function ballEditSave(remove){
  const m = state.match;
  const be = ui.ballEdit;
  if (!be || !ballEditAllowed(m)) return;
  const form = document.getElementById("ball-edit-form");
  const inn = m.innings[be.inn];
  const act = editableBall(m, be.inn, be.seq);
  if (!act){ closeBallEdit(); return; }
  // A name asked for belongs to the change that asked (edit or remove).
  if (be.need && be.needFor !== (remove ? "remove" : "edit")){ be.need = null; be.supply = { batters: [], bowlers: [] }; be.supplied = []; }
  readBallEditFielder(be);
  let ev = null;
  if (!remove){
    const r = ballEditToEvent(m, be);
    if (r.error){ be.error = r.error; render(); return; }
    ev = r.ev;
    if (sameBallEvent(act.ev, ev)){ be.error = "Nothing has changed yet."; render(); return; }
  }
  // A name the replay asked for last time (who came in / who bowled next).
  if (be.need){
    const name = resolveTypedName(form ? new FormData(form).get("newName") : "");
    if (!name){ be.error = be.need.kind === "batter" ? "Enter who came in to bat." : "Enter who bowled that over."; render(); return; }
    const needInn = m.innings[be.need.inn];
    const conflict = playerSideConflict(m, name, be.need.kind === "batter" ? needInn.battingTeam : needInn.bowlingTeam);
    if (conflict){ be.error = conflict; render(); return; }
    if (be.need.kind === "bowler" && be.need.last && name.toLowerCase() === be.need.last.toLowerCase()){
      be.error = `${name} bowled the over before, so can't bowl this one.`; render(); return;
    }
    be.supply[be.need.kind === "batter" ? "batters" : "bowlers"].push(name);
    be.supplied.push({ name, team: be.need.kind === "batter" ? needInn.battingTeam : needInn.bowlingTeam });
  }
  const res = replayMatch(m, { inn: be.inn, seq: be.seq, ev }, be.supply);
  if (res.need){
    be.need = res.need; be.needFor = remove ? "remove" : "edit"; be.error = null;
    render();
    const input = document.querySelector('#ball-edit-form input[name="newName"]');
    if (input) input.value = "";
    return;
  }
  if (res.error){ be.error = res.error; be.need = null; render(); return; }
  if (m.status === "complete" && res.match.status !== "complete"){
    be.error = "This would mean the match isn't over any more. After the result, a change has to keep the match finished.";
    render(); return;
  }
  askBallEditConfirm(m, res, remove, ev);
}

function askBallEditConfirm(m, res, remove, ev){
  const be = ui.ballEdit;
  const nm = res.match;
  const oldEv = ballEditEvent(m, be.inn, be.seq);
  const newEv = remove ? null : ballEditEvent(nm, be.inn, be.seq);
  const chip = e => e ? ballChipHtml(e) : "";
  const lines = scoreChangeLines(m, nm);
  const result = m.result !== nm.result && nm.result ? `<li>Result: <b>${escapeHtml(nm.result)}</b></li>` : "";
  const supplied = be.supplied.slice();
  askConfirm({
    title: remove ? `Remove ball ${be.label}?` : `Change ball ${be.label}?`, icon: "✎", tone: "primary",
    body: `
      <p class="ball-edit-diff">${chip(oldEv)} <span class="arrow">→</span> ${remove ? "<b>removed</b>" : chip(newEv)}</p>
      ${lines || result ? `<ul class="ball-edit-notes">${lines}${result}</ul>` : `<p>The score stays the same.</p>`}
      ${res.notes.length ? `<ul class="ball-edit-notes">${res.notes.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
      <p class="hint">Every later ball is worked out again from here. Undo brings the old version back.</p>`,
    confirmLabel: remove ? "Remove ball" : "Save change",
    onConfirm: () => {
      applyBallEdit(m, nm);
      if (ev && ev.fielder) registerMatchPlayer(ev.fielder, nm.innings[be.inn].bowlingTeam);
      supplied.forEach(p => registerMatchPlayer(p.name, p.team));
    }
  });
}

function ballChipHtml(e, extraCls){
  const cls = e.isWicket ? " wicket" : /^(Wd|Nb)/.test(e.display) ? " extra" : "";
  return `<span class="chip${cls}${extraCls ? " " + extraCls : ""}">${escapeHtml(e.display)}</span>`;
}
function inningsScoreText(i){
  return i ? `${i.runs}-${i.wickets} (${oversDisplay(i.legalBalls || 0, i.ballsPerOver)})` : "—";
}
// "<li>Lions 45-2 (6.3) → 49-2 (6.3)</li>" for each innings the change moves.
function scoreChangeLines(m, nm){
  const inns = nm.innings.length > m.innings.length ? nm.innings : m.innings;
  return inns.map((x, n) => {
    const before = m.innings[n], after = nm.innings[n];
    const was = before ? inningsScoreText(before) : "yet to bat";
    if (before && after && was === inningsScoreText(after) && !!before.complete === !!after.complete) return "";
    const now = after ? inningsScoreText(after) + (after.complete && !(before && before.complete) ? ", innings over" : "") : "—";
    return `<li><b>${escapeHtml(teamName(m, x.battingTeam))}</b> <span class="n">${was} → ${now}</span></li>`;
  }).join("");
}

/* What the draft would do, worked out on a copy on every render (cheap: one
   replay). { pending } while the draft is incomplete (no dismissal picked),
   { error }, or { match (the replayed match, or as far as it got), need,
   left (later balls that can't be worked out until `need` is answered),
   notes }. */
function ballEditPreview(m, be){
  const r = ballEditToEvent(m, be, true);
  if (r.error) return { pending: r.error };
  const res = replayMatch(m, { inn: be.inn, seq: be.seq, ev: r.ev }, be.supply);
  if (res.error) return { error: res.error };
  return { match: res.match || res.partial, need: res.need || null, left: res.left || 0, notes: res.notes || [] };
}

/* The panel at the top of the edit sheet: the over as it was recorded (this
   ball ringed), the score before this ball, the ball as it now reads, the
   score after it, and the innings total before -> after the change. Anything
   the change leaves unknown until the scorer answers below is a "?". */
function renderBallEditContext(m, be){
  const inn = m.innings[be.inn];
  const ctx = ballContext(inn, be.seq);
  if (!ctx) return "";
  const bpo = inn.ballsPerOver;
  const pv = ballEditPreview(m, be);
  const nInn = pv.match ? pv.match.innings[be.inn] : null;
  const nCtx = nInn ? ballContext(nInn, be.seq) : null;
  const q = `<span class="chip unknown">?</span>`;
  const sc = x => `${x.runs}-${x.wickets}`;
  const changed = !!nCtx && !sameBallEvent(ctx.over.events[ctx.over.at], nCtx.over.events[nCtx.over.at]);
  const overChips = (events, at, unknown) => events.map((e, k) => ballChipHtml(e, k === at ? "this" : "")).join("")
    + (unknown ? q.repeat(Math.min(unknown, bpo)) : "");
  // The edited over, worked out again (cut short where a name is needed).
  const after = nCtx && changed ? (() => {
    const unknown = pv.need ? Math.max(0, ctx.over.events.length - nCtx.over.events.length) || (pv.left ? 1 : 0) : 0;
    return `<div class="bec-over"><span class="bec-k">With this change</span><div class="chips">${overChips(nCtx.over.events, nCtx.over.at, unknown)}</div></div>`;
  })() : "";
  const total = (() => {
    if (!pv.match || !changed) return "";
    if (pv.need) return `<li><b>${escapeHtml(teamName(m, inn.battingTeam))}</b> <span class="n">${inningsScoreText(inn)} → ?</span> <span class="hint">(answer below)</span></li>`;
    return scoreChangeLines(m, pv.match);
  })();
  const result = pv.match && !pv.need && changed && pv.match.result !== m.result
    ? `<li>Result: <b>${pv.match.result ? escapeHtml(pv.match.result) : "not decided yet"}</b></li>` : "";
  const later = pv.need && pv.left ? `<p class="bec-unknown">${q} ${pv.left} later ball${pv.left === 1 ? "" : "s"}, from ${escapeHtml(pv.need.label)}, can't be worked out until you say who ${pv.need.kind === "batter" ? "came in" : "bowled"}.</p>` : "";
  const notes = pv.match && changed && pv.notes.length
    ? `<ul class="ball-edit-notes">${pv.notes.map(t => `<li${/Check it/.test(t) ? ` class="bec-check"` : ""}>${/Check it/.test(t) ? `${q} ` : ""}${escapeHtml(t)}</li>`).join("")}</ul>` : "";
  return `
    <div class="ball-edit-context">
      <div class="bec-over"><span class="bec-k">Over ${ctx.over.number}${ctx.over.bowler && !m.anonymous ? ` · ${escapeHtml(liveName(ctx.over.bowler))}` : ""} · as recorded</span><div class="chips">${overChips(ctx.over.events, ctx.over.at, 0)}</div></div>
      ${after}
      <div class="bec-grid">
        <div><span class="bec-k">Before this ball</span><span class="bec-v n">${sc(ctx.before)}</span><span class="bec-s n">${oversDisplay(ctx.before.balls, bpo)} ov</span></div>
        <div><span class="bec-k">This ball</span><span class="bec-v">${nCtx ? ballChipHtml(nCtx.over.events[nCtx.over.at]) : q}</span><span class="bec-s n">${nCtx ? `+${nCtx.after.runs - nCtx.before.runs}${nCtx.after.wickets > nCtx.before.wickets ? " · wkt" : ""}` : escapeHtml(pv.pending || pv.error || "")}</span></div>
        <div><span class="bec-k">After this ball</span><span class="bec-v n">${nCtx ? sc(nCtx.after) : "?"}</span><span class="bec-s n">${nCtx ? `${oversDisplay(nCtx.after.balls, bpo)} ov` : ""}${changed && nCtx && sc(nCtx.after) !== sc(ctx.after) ? ` · was ${sc(ctx.after)}` : ""}</span></div>
      </div>
      ${total || result ? `<ul class="ball-edit-notes bec-total">${total}${result}</ul>` : `<p class="bec-same">Innings total <b class="n">${inningsScoreText(inn)}</b>${changed ? " · stays the same" : ""}</p>`}
      ${later}
      ${notes}
    </div>`;
}

/* Swap in the replayed match. A finished match was archived (and maybe
   synced) already: its archive entry is replaced in place, same id, and the
   club copy is queued again. Player of the match is worked out again unless
   the scorer had picked someone else who still played. */
function applyBallEdit(old, next){
  pushSnapshot();
  if (old.archivedId && state.matchHistory[old.archivedId]){
    const prev = state.matchHistory[old.archivedId];
    const auto = pickMatchMOTM(old);
    const kept = old.motm && old.motm !== auto && Array.from(matchPlayerNames(next)).includes(old.motm);
    next.motm = kept ? old.motm : pickMatchMOTM(next);
    const archived = Object.assign(archivedCopy(next), { id: prev.id, completedAt: prev.completedAt });
    state.matchHistory[prev.id] = archived;
    state.match = next;
    if (next.clubId) syncMatchToCloud(next, archived);
  } else {
    state.match = next;
    maybeArchiveCompletedMatch(next);
  }
  ui.ballEdit = null; ui.scoreSet = null; ui.pickDismissed = null; ui.pendingExtra = null; resetWicketUi();
  save();
}

function renderBallEditModal(m){
  const be = ui.ballEdit;
  const inn = m.innings[be.inn];
  const act = editableBall(m, be.inn, be.seq);
  const orig = ballEditEvent(m, be.inn, be.seq);
  if (!act || !orig) return "";
  const d = be.d;
  const fh = !!orig.freeHit;
  const name = n => n ? escapeHtml(liveName(n)) : "—";
  const tile = (field, value, label, on, sub) => `<button type="button" data-action="ball-edit-set" data-field="${field}" data-value="${value}" class="${on ? "active" : ""}">${label}${sub ? `<span class="sub">${sub}</span>` : ""}</button>`;
  const kinds = BALL_EDIT_KINDS.filter(([k]) =>
    (k !== "wide" || m.wideEnabled || orig.kind === "wide" || orig.extra === "wide")
    && (k !== "noball" || m.noBallEnabled || orig.kind === "noball" || orig.extra === "noball"));
  const runPad = (from, to) => {
    const out = [];
    for (let n = from; n <= to; n++) out.push(`<button type="button" data-action="ball-edit-set" data-field="runs" data-value="${n}" class="run-btn ${d.runs === n ? "active" : ""}">${n}</button>`);
    return `<div class="run-pad small">${out.join("")}</div>`;
  };
  const runsAsk = { run: "Runs off the bat", wide: "Runs on top of the wide", noball: "Runs off the bat (or run) on top of the no-ball", bye: "Byes", legbye: "Leg byes" }[d.kind];
  const types = wicketTypesFor(fh, d.extra);
  const isRunout = d.kind === "wicket" && d.wicketType === "runout";
  const needsFielder = d.kind === "wicket" && (d.wicketType === "caught" || d.wicketType === "runout") && !m.anonymous;
  const outAt = d.outEnd || d.endComingIn;
  const fielderPool = pickPool(inn.bowlingTeam).filter(n => !playerSideConflict(m, n, inn.bowlingTeam));
  const needInn = be.need ? m.innings[be.need.inn] : null;
  const needPool = !be.need ? [] : be.need.kind === "batter"
    ? pickPool(needInn.battingTeam).filter(n => !needInn.batting.order.some(x => x.toLowerCase() === n.toLowerCase()) && !playerSideConflict(m, n, needInn.battingTeam))
    : [...needInn.bowling.order, ...pickPool(needInn.bowlingTeam)].filter((n, i, a) => a.indexOf(n) === i
      && (!be.need.last || n.toLowerCase() !== be.need.last.toLowerCase()) && !playerSideConflict(m, n, needInn.bowlingTeam));
  return `
    <div class="modal-backdrop">
      <div class="modal ball-edit-modal" data-keep-scroll="ball-edit" role="dialog" aria-modal="true" aria-label="Edit ball ${escapeHtml(be.label)}">
        <div class="wicket-modal-head">
          <h2>Edit ball ${escapeHtml(be.label)}</h2>
          <button type="button" data-action="close-ball-edit" class="sheet-close" aria-label="Close">✕</button>
        </div>
        <p class="ball-edit-who">${m.anonymous ? "" : `${name(act.bowler)} to ${name(act.striker)} · `}recorded as <span class="chip${orig.isWicket ? " wicket" : /^(Wd|Nb)/.test(orig.display) ? " extra" : ""}">${escapeHtml(orig.display)}</span>${fh ? ` <span class="freehit-badge">FREE HIT</span>` : ""}</p>
        ${renderBallEditContext(m, be)}
        <form id="ball-edit-form" data-nav-ignore>
          <div class="section-label">What happened?</div>
          <div class="ball-edit-kinds">${kinds.map(([k, label]) => tile("kind", k, label, d.kind === k)).join("")}</div>
          ${d.kind !== "wicket" ? `
            <div class="section-label">${runsAsk}</div>
            ${runPad(d.kind === "bye" || d.kind === "legbye" ? 1 : 0, 6)}
          ` : `
            ${m.wideEnabled || m.noBallEnabled || d.extra ? `
              <div class="section-label">Off which ball?</div>
              <div class="ball-edit-kinds three">
                ${tile("extra", "", "Fair ball", !d.extra)}
                ${m.wideEnabled || d.extra === "wide" ? tile("extra", "wide", "Wide", d.extra === "wide") : ""}
                ${m.noBallEnabled || d.extra === "noball" ? tile("extra", "noball", "No ball", d.extra === "noball") : ""}
              </div>` : ""}
            <div class="section-label">How out?</div>
            <div class="wicket-types${types.length === 1 ? " solo" : ""}">
              ${types.map(t => `<button type="button" data-action="ball-edit-set" data-field="wicketType" data-value="${t}" class="${d.wicketType === t ? "active" : ""}">${DISMISSAL_WORDS[t]}</button>`).join("")}
            </div>
            ${isRunout ? `
              <div class="section-label">Who's out?</div>
              <div class="end-picker">
                ${tile("endComingIn", "striker", `<span class="role">Striker</span><span class="n">${name(act.striker)}</span>`, d.endComingIn === "striker").replace("<button ", `<button ${act.striker ? "" : "disabled "}`).replace('class="', 'class="end-tile ')}
                ${act.nonStriker ? tile("endComingIn", "nonStriker", `<span class="role">Non-striker</span><span class="n">${name(act.nonStriker)}</span>`, d.endComingIn === "nonStriker").replace('class="', 'class="end-tile ') : ""}
              </div>
              <div class="section-label">Run out at which end?</div>
              <div class="end-picker">
                ${tile("outEnd", "striker", `<span class="role">Striker's end</span><span class="n">Keeper's end</span>`, outAt === "striker").replace('class="', 'class="end-tile ')}
                ${tile("outEnd", "nonStriker", `<span class="role">Non-striker's end</span><span class="n">Bowler's end</span>`, outAt === "nonStriker").replace('class="', 'class="end-tile ')}
              </div>
              <div class="section-label">Runs completed${d.extra ? ` (on top of the ${d.extra === "wide" ? "wide" : "no-ball"})` : ""}</div>
              ${runPad(0, 3)}
            ` : ""}
            ${needsFielder ? `
              <div class="fielder-box">
                <div class="fielder-box-head"><label for="ball-edit-fielder">FIELDER</label></div>
                ${renderNameCombo("", `id="ball-edit-fielder" name="fielder" maxlength="24" placeholder="Search players" value="${escapeHtml(d.fielder || "")}"`, fielderPool)}
              </div>` : ""}
          `}
          ${be.need ? `
            <div class="ball-edit-need">
              <div class="section-label"><span class="chip unknown">?</span> ${be.need.kind === "batter"
                ? `Who came in${be.need.out ? ` after ${name(be.need.out)} was out` : ""}?`
                : `Who bowled the over from ball ${escapeHtml(be.need.label)}?`}</div>
              <p class="hint">${be.need.kind === "batter"
                ? `With this change there's one more wicket, so someone else faced ball ${escapeHtml(be.need.label)}.`
                : "With this change the over ends at a different ball, so the next over starts earlier."}</p>
              ${renderNameCombo("", `name="newName" maxlength="24" placeholder="Search or type a player" required`, needPool)}
            </div>` : ""}
          <div class="form-error">${be.error ? escapeHtml(be.error) : ""}</div>
          <div class="ball-edit-actions">
            <button type="button" data-action="ball-edit-delete" class="ghost danger-text">Remove ball</button>
            <button type="submit" class="primary">${be.need ? "Continue" : "Review change"}</button>
          </div>
        </form>
        <button type="button" data-action="close-ball-edit" class="ghost" style="width:100%;margin-top:6px;">Cancel</button>
      </div>
    </div>`;
}

/* --- set the final score by hand ---
   For a scorer who'd rather not fix the score ball by ball: one sheet with
   each innings' runs, wickets and overs (a chase not started yet can be
   filled in too). ui.scoreSet = { error }. A finished innings counts only if
   its numbers changed; one still in progress ends at what's entered, unless
   "carry on scoring" is ticked (then it's left alone -- Catch up the score
   is the way to carry on from a new score). setScoresByHand (ENGINE) does
   the work on a copy, the shared confirmation shows old -> new, and it's
   swapped in like a ball edit (snapshot first, archive replaced in place). */
function openScoreSet(){
  if (!ballEditAllowed(state.match)) return;
  ui.matchMenu = null;
  ui.scoreSet = { error: null };
  render();
}
function closeScoreSet(){
  ui.scoreSet = null;
  render();
}

function readScoreSetForm(m, form){
  const fd = new FormData(form);
  const bpo = m.ballsPerOver || m.innings[0].ballsPerOver;
  const scores = [];
  for (let i = 0; i < 2; i++){
    const inn = m.innings[i];
    const raw = k => String(fd.get(`${k}${i}`) || "").trim();
    if (!inn && !raw("runs") && !raw("wkts") && !raw("overs")){ scores.push(null); continue; }
    if (inn && !inn.complete && fd.get(`goon${i}`)){
      const same = raw("runs") === String(inn.runs) && raw("wkts") === String(inn.wickets) && parseOversInput(raw("overs"), bpo) === inn.legalBalls;
      if (!same) return { error: `To carry on scoring ${teamName(m, inn.battingTeam)}'s innings from a new score, use ⋯ Match options → Catch up the score.` };
      scores.push(null); continue;
    }
    const num = v => /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    const s = { runs: num(raw("runs")), wickets: num(raw("wkts")), balls: parseOversInput(raw("overs"), bpo) };
    if (s.balls === null) s.balls = NaN;
    const same = inn && inn.complete && s.runs === inn.runs && s.wickets === inn.wickets && s.balls === inn.legalBalls;
    scores.push(same ? null : s);
  }
  return { scores };
}

function scoreSetSave(){
  const m = state.match;
  const form = document.getElementById("score-set-form");
  if (!ui.scoreSet || !ballEditAllowed(m) || !form) return;
  const r = readScoreSetForm(m, form);
  const res = r.error ? r : setScoresByHand(m, r.scores);
  if (res.error){ ui.scoreSet.error = res.error; render(); return; }
  const nm = res.match;
  const lines = scoreChangeLines(m, nm);
  const result = nm.result && nm.result !== m.result ? `<li>Result: <b>${escapeHtml(nm.result)}</b></li>` : "";
  const status = !nm.result && nm.status !== m.status
    ? `<li>${nm.status === "innings_break" ? "Innings break: the chase is next." : "Scoring carries on."}</li>` : "";
  askConfirm({
    title: "Set the score?", icon: "✎", tone: "primary",
    body: `
      ${lines || result || status ? `<ul class="ball-edit-notes">${lines}${result}${status}</ul>` : `<p>The score stays the same.</p>`}
      ${res.notes.length ? `<ul class="ball-edit-notes">${res.notes.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
      ${nm.caughtUp && !m.caughtUp ? `<p class="hint">Runs and wickets set by hand aren't credited to any player, so this match leaves the player stats and MVP (team totals and standings still count). Balls already scored can't be edited afterwards.</p>` : ""}
      <p class="hint">Undo brings the old score back.</p>`,
    confirmLabel: "Set score",
    onConfirm: () => { applyBallEdit(m, nm); }
  });
}

function renderScoreSetModal(m){
  const ss = ui.scoreSet;
  const i0 = m.innings[0];
  const bpo = m.ballsPerOver || i0.ballsPerOver;
  const rows = [0, 1].map(i => {
    const inn = m.innings[i];
    const team = teamName(m, i === 0 ? i0.battingTeam : i0.bowlingTeam);
    const val = (v) => inn ? `value="${v}"` : "";
    const status = !inn ? "Yet to bat" : inn.complete ? "Innings over" : "Batting now";
    return `
      <fieldset class="score-set-inn">
        <legend><b>${escapeHtml(team)}</b> <span class="hint">${status}${inn ? ` · now <span class="n">${inningsScoreText(inn)}</span>` : ""}${i === 1 && inn && inn.target != null ? ` · target ${inn.target}` : ""}</span></legend>
        <div class="score-set-fields">
          <label>Runs<input name="runs${i}" inputmode="numeric" pattern="[0-9]*" maxlength="4" ${val(inn ? inn.runs : "")}></label>
          <label>Wickets<input name="wkts${i}" inputmode="numeric" pattern="[0-9]*" maxlength="2" ${val(inn ? inn.wickets : "")}></label>
          <label>Overs<input name="overs${i}" inputmode="decimal" maxlength="5" placeholder="19.4" ${val(inn ? oversDisplay(inn.legalBalls || 0, bpo) : "")}></label>
        </div>
        ${inn && !inn.complete ? `<label class="check-row"><input type="checkbox" name="goon${i}"> Not over yet: carry on scoring this innings</label>` : ""}
        ${!inn ? `<p class="hint">Leave blank if they haven't batted yet.</p>` : ""}
      </fieldset>`;
  }).join("");
  return `
    <div class="modal-backdrop">
      <div class="modal score-set-modal" data-keep-scroll="score-set" role="dialog" aria-modal="true" aria-label="Set the final score">
        <div class="wicket-modal-head">
          <h2>Set the final score</h2>
          <button type="button" data-action="close-score-set" class="sheet-close" aria-label="Close">✕</button>
        </div>
        <p class="hint">Skip fixing it ball by ball: type each side's final score${m.oversLimit != null ? ` (overs out of ${m.oversLimit})` : ""}. An innings still being scored ends at what you enter.</p>
        <form id="score-set-form" data-nav-ignore>
          ${rows}
          <div class="form-error">${ss.error ? escapeHtml(ss.error) : ""}</div>
          <button type="submit" class="primary" style="width:100%;">Review</button>
        </form>
        <button type="button" data-action="close-score-set" class="ghost" style="width:100%;margin-top:6px;">Cancel</button>
      </div>
    </div>`;
}
