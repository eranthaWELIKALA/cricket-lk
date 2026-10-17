/* Cricket.lk — UI common: escapeHtml, theme, SFX, name search-selects, back bar.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* One row of chip tabs (.tab-row/.tab-btn). `tabs` is [[id, labelHtml]] --
   labels are trusted HTML, so callers escape names. Each tap fires
   `action` with data-tab=<id>; the caller keeps which one is active. */
function tabsHtml(action, tabs, active, cls){
  return `<div class="tab-row${cls ? " " + cls : ""}" role="tablist">${tabs.map(([id, label]) =>
    `<button type="button" data-action="${action}" data-tab="${id}" role="tab" aria-selected="${id === active}" class="tab-btn ${id === active ? "active" : ""}">${label}</button>`).join("")}</div>`;
}

/* --- THEME: a user's chosen accent/accent-2 hex (state.branding — no
   longer editable in the UI, but still honored for any pre-existing
   saved customization) is the only thing stored — everything else
   (the rgb triple used by rgba() overlays, a lightened gradient-stop
   shade, a darkened "dim" shade, and a light/dark "ink" text color)
   is derived from it and pushed onto :root as CSS custom properties.
   Leaving a color uncustomized (hex is null) removes the override so
   the hardcoded :root defaults in <style> — the single source of
   truth for the built-in palette — show through untouched. --- */
function hexToRgb(hex){
  const clean = String(hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b){
  return "#" + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}
function shadeColor(hex, amount){
  const [r, g, b] = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  const mix = c => c + (target - c) * p;
  return rgbToHex(mix(r), mix(g), mix(b));
}
function inkForColor(hex){
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return shadeColor(hex, luminance > 0.5 ? -0.88 : 0.88);
}
function applyAccentVars(root, prefix, hex){
  if (!hex){
    ["", "-rgb", "-dim", "-light", "-ink"].forEach(suffix => root.removeProperty(`--${prefix}${suffix}`));
    return;
  }
  root.setProperty(`--${prefix}`, hex);
  root.setProperty(`--${prefix}-rgb`, hexToRgb(hex).join(","));
  root.setProperty(`--${prefix}-dim`, shadeColor(hex, -0.35));
  root.setProperty(`--${prefix}-light`, shadeColor(hex, 0.35));
  root.setProperty(`--${prefix}-ink`, inkForColor(hex));
}
function applyTheme(){
  const b = state.branding || {};
  const root = document.documentElement.style;
  const preset = THEME_PRESETS.find(t => t.id === state.themeId) || THEME_PRESETS[0];
  Object.entries(preset.vars).forEach(([prop, value]) => root.setProperty(prop, value));
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = preset.vars["--bg-2"];
  // A pre-existing custom branding accent (legacy state.branding data) always overrides the theme's own.
  applyAccentVars(root, "accent", b.accent || preset.accent);
  applyAccentVars(root, "accent-2", b.accent2 || preset.accent2);
}

/* --- SFX: tiny synthesized sound effects via Web Audio API, no audio
   files — keeps the single-file/no-dependency/offline constraints.
   Muted via state.soundEnabled (persisted, toggled by the topbar's sound
   button rendered on every screen). AudioContext is created lazily on
   the first sound-triggering call, which is always inside a click
   handler, satisfying browsers' user-gesture autoplay requirement. --- */
const SFX = (() => {
  let ctx = null;
  function ensureCtx(){
    if (!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC){ try { ctx = new AC(); } catch (_){ ctx = null; } }
    }
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  function tone(freq, { duration = .12, type = "sine", gain = .18, delay = 0, glideTo = null } = {}){
    if (!state.soundEnabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + duration);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + duration + .03);
  }
  return {
    dot(){ tone(300, { duration: .06, gain: .09 }); },
    single(){ tone(430, { duration: .09, gain: .12 }); },
    two(){ tone(430, { duration: .08, gain: .12 }); tone(540, { duration: .09, gain: .12, delay: .07 }); },
    three(){ tone(430, { duration: .07, gain: .11 }); tone(520, { duration: .07, gain: .11, delay: .06 }); tone(620, { duration: .09, gain: .12, delay: .12 }); },
    four(){ tone(660, { duration: .16, type: "triangle", gain: .18 }); tone(880, { duration: .22, type: "triangle", gain: .14, delay: .05 }); },
    six(){ tone(660, { duration: .14, type: "triangle", gain: .2 }); tone(880, { duration: .14, type: "triangle", gain: .18, delay: .06 }); tone(1108, { duration: .3, type: "triangle", gain: .16, delay: .12 }); },
    extra(){ tone(300, { duration: .1, type: "square", gain: .07 }); },
    wicket(){ tone(190, { duration: .38, type: "sawtooth", gain: .2, glideTo: 65 }); },
    win(){ tone(523, { duration: .15, gain: .16 }); tone(659, { duration: .15, gain: .16, delay: .14 }); tone(784, { duration: .32, gain: .18, delay: .28 }); },
    tap(){ tone(520, { duration: .05, gain: .08 }); },
    runs(n){
      if (n === 0) this.dot();
      else if (n === 1) this.single();
      else if (n === 2) this.two();
      else if (n === 3) this.three();
      else if (n === 4) this.four();
      else if (n === 6) this.six();
      else this.single();
    }
  };
})();

function renderPlayersDatalist(){
  return `<datalist id="players-datalist">${suggestionPlayerNames().map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist>`;
}
/* The names a side can be picked from: its squad (saved tournament teams),
   else the same list the datalist offers -- except a friendly's visitors,
   who aren't on the home club's roster, so there's nothing to offer them. */
function pickPool(teamKey){
  const m = state.match;
  if (m && m.clubId && m.matchType === "friendly" && teamKey === "B") return [];
  // A side with no saved players (e.g. a typed guest team) still gets the
  // usual list; pickCandidates drops anyone who belongs to the other side.
  if (m && m.squads && (m.squads[teamKey] || []).length) return m.squads[teamKey];
  return suggestionPlayerNames();
}
/* A search-select for the in-match name boxes. Native <datalist> popups are
   unreliable on phones (options show but often can't be tapped inside a
   bottom sheet), so these inputs have no `list` and get our own option list
   instead: hidden until the input is focused, narrowed as you type, a tap
   fills the input (the form's own button still submits, so every check in
   the submit handlers applies). DOM-only -- see the focusin/focusout/input
   listeners and the "combo-pick" click action; nothing here re-renders.
   `label` is trusted HTML (callers escape names); `names` are escaped here. */
function renderNameCombo(label, inputAttrs, names){
  const input = `<input ${inputAttrs} autocomplete="off" autocapitalize="words">`;
  return `
    <div class="combo">
      ${label ? `<label>${label}${input}</label>` : input}
      <div class="combo-list" role="listbox" hidden>
        ${names.map(n => {
          // Club players also match on nickname / "#jersey" (data-search).
          const r = rosterEntryFor(n);
          const nick = r && r.nickname ? r.nickname.trim() : "";
          const jersey = r && r.jersey_no != null ? `#${r.jersey_no}` : "";
          const search = [n, nick, jersey].filter(Boolean).join(" ").toLowerCase();
          return `<button type="button" class="combo-opt" role="option" data-action="combo-pick" data-name="${escapeHtml(n)}" data-search="${escapeHtml(search)}">${escapeHtml(n)}${nick ? ` <span class="combo-nick">${escapeHtml(nick)}</span>` : ""}${jersey ? `<span class="combo-jersey">${jersey}</span>` : ""}</button>`;
        }).join("")}
      </div>
    </div>`;
}
/* The roster row behind a name in the current club match/setup (nickname,
   jersey), or null -- guest-mode players have neither. */
function currentRoster(){
  const clubId = activeSetupClubId();
  return clubId && ui.club && ui.club.id === clubId ? ui.club.roster : [];
}
function rosterEntryFor(name){
  const key = (name || "").trim().toLowerCase();
  return key ? currentRoster().find(p => p.name && p.name.toLowerCase() === key) || null : null;
}
/* Live-scorecard display name: the roster nickname when the scorer turned
   nicknames on (state.useNicknames, the toggle on the live screen) and this
   player has one, else the name as recorded. Display only -- the match,
   its howOut text, archive, stats and share image all keep real names. */
function liveName(name){
  if (!state.useNicknames || !name) return name;
  const r = rosterEntryFor(name);
  const nick = r && r.nickname ? r.nickname.trim() : "";
  return nick || name;
}
/* The toggle only shows when there's something to toggle: a club match
   whose loaded roster has any nicknames (guest players have none). */
function matchHasNicknames(){
  return currentRoster().some(p => p.nickname && p.nickname.trim());
}
/* A typed nickname / "#7" -> that roster player's name (see resolvePlayerAlias). */
function resolveTypedName(value){ return resolvePlayerAlias(value, currentRoster()); }
function updateCombo(input, open){
  const list = input.closest(".combo") && input.closest(".combo").querySelector(".combo-list");
  if (!list) return;
  const q = input.value.trim().toLowerCase();
  // A name already in another box of the same sheet isn't offered again --
  // on the opening sheet the striker, non-striker and bowler are always
  // three different people (handleOpeningSubmit enforces it too).
  // data-combo-group narrows that to boxes of the same group ("none": no
  // exclusion), for a form where one name may rightly fill several boxes
  // (catch-up: a bowler is also a dismissal's bowler and "bowling now").
  const form = input.closest("form");
  const group = input.dataset.comboGroup || "";
  const taken = new Set(form && group !== "none" ? [...form.querySelectorAll(".combo input")]
    .filter(other => other !== input && other.value.trim() && (other.dataset.comboGroup || "") === group)
    .map(other => resolveTypedName(other.value).toLowerCase()) : []);
  let shown = 0;
  list.querySelectorAll(".combo-opt").forEach(o => {
    const hit = !taken.has(o.dataset.name.toLowerCase()) && (!q || (o.dataset.search || o.dataset.name.toLowerCase()).includes(q));
    o.hidden = !hit;
    if (hit) shown++;
  });
  list.hidden = !open || shown === 0;
}
function renderTeamsDatalist(){
  return `<datalist id="teams-datalist">${suggestionTeamNames().map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist>`;
}
function renderBackBar(label, view){
  return `<button data-action="go-view" data-view="${view}" class="back-bar">‹ ${label}</button>`;
}

/* --- preset ⓘ: what a preset actually means, wherever one is picked.
   Each chip gets a joined ⓘ button (preset-info); tapping it shows a panel
   under the picker with the preset's rules in plain words (describeMatchPreset /
   describeTournamentPreset, ENGINE). A tap, not a hover tooltip -- phones
   have no hover. ui.presetInfo = { view, slot, kind, id }: `slot` names the
   picker (one screen could have two), and the panel only shows on the view
   it was opened on. Tap ⓘ again, ✕ or Esc to close. --- */
function presetPickerHtml({ presets, activeId, pickAction, kind, slot }){
  return `
    <div class="preset-picker">
      ${presets.map(p => `
        <span class="preset-chip-group">
          <button type="button" data-action="${pickAction}" data-id="${escapeHtml(p.id)}" class="preset-chip ${p.id === activeId ? "active" : ""}">${escapeHtml(p.name)}</button>
          ${presetInfoButtonHtml(kind, p.id, slot, p.name)}
        </span>
      `).join("")}
    </div>
    ${presetInfoPanelHtml(slot)}
  `;
}
/* `id` null: describes whatever the neighbouring <select> shows (.select-with-info). */
function presetInfoButtonHtml(kind, id, slot, name){
  const open = presetInfoOpen(slot, id);
  return `<button type="button" data-action="preset-info" data-kind="${kind}" data-id="${escapeHtml(id || "")}" data-slot="${slot}" class="preset-info-btn ${open ? "open" : ""}" aria-label="What is ${escapeHtml(name || "this preset")}?" aria-expanded="${open}" aria-controls="preset-info-${slot}">i</button>`;
}
function presetInfoOpen(slot, id){
  const p = ui.presetInfo;
  return !!p && p.view === state.view && p.slot === slot && (id == null || p.id === id);
}
/* Looks a preset up in every list it could come from (guest, club, the
   current setup's choices) -- ids don't collide across them. */
function presetForInfo(kind, id){
  const lists = kind === "match"
    ? [Object.values(state.matchPresets), (ui.club && ui.club.presets && ui.club.presets.match) || []]
    : [Object.values(state.tournamentPresets), (ui.club && ui.club.presets && ui.club.presets.tournament) || []];
  for (const list of lists){ const hit = list.find(p => p.id === id); if (hit) return hit; }
  return null;
}
function presetInfoPanelHtml(slot){
  if (!presetInfoOpen(slot)) return "";
  const { kind, id } = ui.presetInfo;
  const p = presetForInfo(kind, id);
  if (!p) return "";
  let rows;
  if (kind === "match") rows = describeMatchPreset(p);
  else {
    // A club tournament preset's matchPresetId is unused (see "Roles").
    const mp = p.matchPresetId ? state.matchPresets[p.matchPresetId] : null;
    rows = describeTournamentPreset(p, mp ? mp.name : null);
  }
  return `
    <div class="preset-info" id="preset-info-${slot}" role="region" aria-label="About ${escapeHtml(p.name)}">
      <div class="preset-info-head">
        <b>${escapeHtml(p.name)}</b>
        <button type="button" data-action="preset-info-close" class="preset-info-close" aria-label="Close">✕</button>
      </div>
      <dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
    </div>
  `;
}
function togglePresetInfo(btn){
  let id = btn.dataset.id;
  // The editor's <select> variant describes whatever is selected right now.
  const sel = btn.closest(".select-with-info") && btn.closest(".select-with-info").querySelector("select");
  if (sel) id = sel.value;
  ui.presetInfo = presetInfoOpen(btn.dataset.slot, id) ? null : { view: state.view, slot: btn.dataset.slot, kind: btn.dataset.kind, id };
  render();
}
