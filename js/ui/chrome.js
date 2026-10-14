/* Cricket.lk — UI chrome: top bar, loading indicators, shared confirmation sheet.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- topbar: one sticky row (hamburger + sound + sign-in) replacing the
   three independently-floating circular buttons that used to stack at
   top-right. The hamburger only appears when canNavigate (see render()'s
   documented "no navigating away from a live match" rule); mid-match it's
   replaced by a live-dot + "TeamA v TeamB" instead, and a forfeit icon
   joins the right cluster -- both only while a match is actually in
   progress (not once it's "complete", which is the one case canNavigate
   is false without a live match: the Result screen still shows the
   static brand mark there, since Result already has its own explicit
   "New match"/"Back to..." exit and isn't wired to also exit via the
   side menu). Sign-in only appears when signed out and off the auth
   screens themselves, same condition the old floating signin-toggle used. */
function renderTopBar(canNavigate, onAuthScreen){
  const m = state.match;
  const inProgress = !!(m && m.status !== "complete");
  const away = inProgress && ui.awayFromMatch;
  const menuBtn = `<button data-action="open-side-menu" class="topbar-icon-btn" aria-label="Open menu">☰</button>`;
  return `
    <header class="topbar">
      <div class="topbar-left">
        ${inProgress
          ? menuBtn + (away
              ? `<button data-action="resume-match" class="topbar-live"><span class="live-dot"></span>Live · ${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}</button>`
              : `<span class="live-dot"></span><span class="topbar-match">${escapeHtml(m.teamA)} v ${escapeHtml(m.teamB)}</span>`)
          : canNavigate ? menuBtn : `<span class="topbar-brand">🏏 Cricket.lk</span>`}
      </div>
      <div class="topbar-right">
        ${inProgress && !away ? `<button data-action="open-match-menu" class="topbar-icon-btn" aria-label="Match options">⋯</button>` : ""}
        ${canNavigate && !inProgress && !onAuthScreen
          ? (session
              ? `<button data-action="go-account" class="topbar-icon-btn" aria-label="Account">👤</button>`
              : `<button data-action="go-account" class="topbar-signin">Sign in</button>`)
          : ""}
        ${renderSyncPill()}
        <button data-action="toggle-sound" class="topbar-icon-btn" aria-label="${state.soundEnabled ? "Mute sound" : "Unmute sound"}">${state.soundEnabled ? "🔊" : "🔇"}</button>
      </div>
    </header>
  `;
}
/* --- activity: loading indicators outside live scoring ---------------------
   One in-flight counter fed by trackedFetch (the fetch every Supabase request
   uses). While it's > 0 (after a 150ms grace, so fast calls don't flash):
   - body.is-busy shows the thin #top-progress bar under the top bar, and
     #busy-status tells screen readers "Loading…";
   - the button / form that started it gets .is-loading (spinner, no second
     tap). The tap is remembered as a descriptor (data-action + data-id, or a
     form id), not an element, and re-applied after every render(), so the
     spinner survives the screen re-rendering underneath it. A tap only
     "owns" the activity if a request starts within 400ms of it -- so a
     background sync never puts a spinner on an unrelated button.
   All of it is off on the live-scoring screen (body.live-scoring): scoring
   stays instant and uncluttered. Don't add per-screen spinners for cloud
   calls -- this already covers them; use loadingHtml() for a
   "nothing to show yet" placeholder. */
const activity = { inflight: 0, trigger: null, timer: null, shown: false };
function trackedFetch(input, init){
  activityStart();
  let p;
  try { p = fetch(input, init); } catch (err){ activityEnd(); throw err; }
  return p.finally(activityEnd);
}
function noteTrigger(el){
  if (!el || document.body.classList.contains("live-scoring")) return;
  activity.trigger = el.tagName === "FORM"
    ? { form: el.getAttribute("id"), at: Date.now() }
    : { action: el.dataset.action, id: el.dataset.id || null, at: Date.now() };
}
function activityStart(){
  activity.inflight++;
  const t = activity.trigger;
  if (t && !t.owned){ if (Date.now() - t.at <= 400) t.owned = true; else activity.trigger = null; }
  if (activity.inflight === 1 && !activity.shown){
    clearTimeout(activity.timer);
    activity.timer = setTimeout(() => { activity.shown = activity.inflight > 0; applyActivity(); }, 150);
  }
}
function activityEnd(){
  activity.inflight = Math.max(0, activity.inflight - 1);
  if (activity.inflight) return;
  clearTimeout(activity.timer);
  // Short grace: "save, then reload the list" is two requests back to back.
  activity.timer = setTimeout(() => {
    if (activity.inflight) return;
    activity.shown = false; activity.trigger = null; applyActivity();
  }, 150);
}
function findTriggerEl(t){
  if (!t) return null;
  if (t.form){
    const f = document.getElementById(t.form);
    return f && f.querySelector('button[type="submit"]');
  }
  const esc = v => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
  return document.querySelector(`[data-action="${esc(t.action)}"]${t.id ? `[data-id="${esc(t.id)}"]` : ""}`);
}
function applyActivity(){
  const live = document.body.classList.contains("live-scoring");
  const busy = activity.shown && activity.inflight > 0 && !live;
  document.body.classList.toggle("is-busy", busy);
  const status = document.getElementById("busy-status");
  if (status && status.textContent !== (busy ? "Loading…" : "")) status.textContent = busy ? "Loading…" : "";
  document.querySelectorAll(".is-loading").forEach(el => { el.classList.remove("is-loading"); el.removeAttribute("aria-busy"); });
  const el = busy && activity.trigger && activity.trigger.owned ? findTriggerEl(activity.trigger) : null;
  if (el){ el.classList.add("is-loading"); el.setAttribute("aria-busy", "true"); }
}
/* A "nothing to show yet" placeholder -- spinner + text. */
function loadingHtml(text){
  return `<div class="loading-block" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(text || "Loading…")}</span></div>`;
}

/* The one confirmation sheet (ui.confirm), used for every "are you sure?"
   in the app: deletes and removals, ending / cancelling / forfeiting a
   match, restarting after a reversed toss, discarding unsaved edits. Open it
   with askConfirm({...}); render() layers it above every other sheet, so it
   can interrupt any of them. Options:
   - title (text), body (trusted HTML -- escape names with escapeHtml),
     confirmLabel, cancelLabel ("Cancel"), busyLabel, icon, tone ("danger" |
     "primary")
   - choices: optional [{ value, label, sub }] to pick one of first (forfeit:
     which team) -- the confirm button stays disabled until one is picked
   - onConfirm(choice): return nothing to close, { error } to stay open with
     that message, or a Promise of either (the sheet shows busyLabel)
   - onCancel(): optional
   ui isn't persisted, so a pending confirmation never survives a reload.
   Don't reintroduce window.confirm() or "tap again to confirm" buttons. */
function askConfirm(opts){
  ui.confirm = Object.assign({ cancelLabel: "Cancel", busyLabel: "Working…", tone: "danger", icon: "", choices: null }, opts,
    { choice: opts.choice != null ? String(opts.choice) : null, busy: false, error: null });
  render();
}
function renderConfirmModal(){
  const c = ui.confirm;
  const needChoice = !!(c.choices && c.choices.length && c.choice == null);
  return `
    <div class="modal-backdrop">
      <div class="modal confirm-modal${c.tone === "danger" ? " danger" : ""}" data-keep-scroll="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-head">
          ${c.icon ? `<span class="confirm-icon" aria-hidden="true">${c.icon}</span>` : ""}
          <h2 id="confirm-title">${escapeHtml(c.title)}</h2>
        </div>
        ${c.body ? `<div class="confirm-body">${c.body}</div>` : ""}
        ${c.choices ? `<div class="bowler-pick-list">${c.choices.map(ch => `
          <button type="button" data-action="confirm-pick" data-value="${escapeHtml(String(ch.value))}" class="bowler-pick-row ${c.choice === String(ch.value) ? "active" : ""}" style="height:60px;" ${c.busy ? "disabled" : ""}>
            <span class="name">${escapeHtml(ch.label)}</span>${ch.sub ? `<span class="figs">${escapeHtml(ch.sub)}</span>` : ""}
          </button>`).join("")}</div>` : ""}
        ${c.error ? `<p class="form-error">${escapeHtml(c.error)}</p>` : ""}
        <div class="confirm-actions">
          <button type="button" data-action="confirm-cancel" class="ghost" ${c.busy ? "disabled" : ""}>${escapeHtml(c.cancelLabel)}</button>
          <button type="button" data-action="confirm-ok" class="primary${c.tone === "danger" ? " danger-confirm" : ""}" ${c.busy || needChoice ? "disabled" : ""}>${escapeHtml(c.busy ? c.busyLabel : c.confirmLabel)}</button>
        </div>
      </div>
    </div>`;
}
function runConfirm(){
  const c = ui.confirm;
  if (!c || c.busy || (c.choices && c.choices.length && c.choice == null)) return;
  const done = res => {
    if (ui.confirm !== c) return; // the handler already moved on (e.g. leaveMatch reset ui)
    if (res && res.error){ c.busy = false; c.error = res.error; } else ui.confirm = null;
    render();
  };
  let res;
  try { res = c.onConfirm(c.choice); } catch (err){ res = { error: err.message || String(err) }; }
  if (res && typeof res.then === "function"){
    c.busy = true; c.error = null; render();
    res.then(done, err => done({ error: err.message || String(err) }));
  } else done(res);
}
function cancelConfirm(){
  const c = ui.confirm;
  if (!c || c.busy) return;
  ui.confirm = null;
  if (c.onCancel) c.onCancel();
  render();
}

/* --- drag a sheet down to close it ---
   Any bottom sheet that can be closed (#modal-root or #confirm-root) follows
   a finger dragged down from its top edge -- or from anywhere while it's
   scrolled to the top -- and closes past a threshold or on a quick flick,
   exactly as its own Close/Cancel/Pick later would (dragCloseSheet). A sheet
   that can't be closed (the opening sheet, a busy confirmation) doesn't move.
   Touch events, not pointer events: with pointer events the browser claims a
   vertical drag for scrolling and cancels it. All DOM-only, never render(). */
function sheetCanDragClose(modal){
  if (modal.closest("#confirm-root")) return !!(ui.confirm && !ui.confirm.busy);
  if (!modal.closest("#modal-root") || ui.confirm) return false;
  const m = state.match;
  return overlayOpen() || !!(m && !ui.awayFromMatch && pendingPickKey(m) && !pickSheetDismissed(m));
}
function dragCloseSheet(modal){
  if (modal.closest("#confirm-root")){ cancelConfirm(); return; }
  // Match options: a drag closes the whole sheet, not just its Switch players page.
  if (ui.matchMenu === "squads") ui.matchMenu = "menu";
  if (closeTopOverlay()) return;
  const m = state.match;
  if (m && pendingPickKey(m) && !pickSheetDismissed(m)) dismissPick();
}
let sheetDrag = null, sheetDragEndedAt = 0;
function sheetDragStart(target, x, y){
  const modal = target.closest && target.closest("#modal-root .modal, #confirm-root .modal");
  if (!modal || target.closest("input, textarea, select, .combo-list") || !sheetCanDragClose(modal)) return;
  const fromTop = y - modal.getBoundingClientRect().top < 48;
  sheetDrag = { modal, x, y, t: Date.now(), fromTop, active: false, dy: 0 };
}
function sheetDragMove(x, y){
  const d = sheetDrag;
  if (!d) return false;
  const dy = y - d.y, dx = x - d.x;
  if (!d.active){
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)){ sheetDrag = null; return false; }
    if (dy < -6 || (dy > 0 && !d.fromTop && d.modal.scrollTop > 0)){ sheetDrag = null; return false; }
    if (dy < 8) return false;
    d.active = true; d.y = y; d.t = Date.now();
    d.modal.classList.add("dragging");
  }
  d.dy = Math.max(0, y - d.y);
  d.modal.style.transform = `translateY(${d.dy}px)`;
  const backdrop = d.modal.closest(".modal-backdrop");
  if (backdrop) backdrop.style.setProperty("--drag", Math.min(d.dy / d.modal.offsetHeight, 1).toFixed(3));
  return true;
}
function sheetDragEnd(){
  const d = sheetDrag;
  sheetDrag = null;
  if (!d || !d.active) return;
  sheetDragEndedAt = Date.now();
  const { modal } = d, backdrop = modal.closest(".modal-backdrop");
  const fast = d.dy > 40 && d.dy / Math.max(Date.now() - d.t, 1) > 0.5;
  modal.classList.remove("dragging");
  const reset = () => {
    modal.style.transform = "";
    if (backdrop) backdrop.style.removeProperty("--drag");
  };
  if (!(fast || d.dy > Math.min(120, modal.offsetHeight * 0.3))){ reset(); return; }
  modal.classList.add("drag-out");
  modal.style.transform = "translateY(100%)";
  setTimeout(() => {
    dragCloseSheet(modal);
    // Still on screen (unsaved changes asked first, or a kept-alive player
    // modal): slide it back.
    if (modal.isConnected){ modal.classList.remove("drag-out"); reset(); }
  }, 160);
}
document.addEventListener("touchstart", e => { if (e.touches.length === 1) sheetDragStart(e.target, e.touches[0].clientX, e.touches[0].clientY); else sheetDrag = null; }, { passive: true });
document.addEventListener("touchmove", e => { if (sheetDrag && sheetDragMove(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener("touchend", sheetDragEnd);
document.addEventListener("touchcancel", sheetDragEnd);
// Mouse: from the top edge only (no scroll to compete with).
document.addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  sheetDragStart(e.target, e.clientX, e.clientY);
  if (sheetDrag && !sheetDrag.fromTop) sheetDrag = null;
});
document.addEventListener("mousemove", e => { if (sheetDrag) sheetDragMove(e.clientX, e.clientY); });
document.addEventListener("mouseup", sheetDragEnd);
// The tap that ends a drag isn't a click on whatever is under the finger.
window.addEventListener("click", e => { if (Date.now() - sheetDragEndedAt < 350){ e.stopPropagation(); e.preventDefault(); } }, true);
