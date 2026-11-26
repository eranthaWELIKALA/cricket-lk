/* Cricket.lk — screens: the Records tab and the honours board.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- working figures out once per set of matches ---
   Records, ratings, match-ups and the honours board walk every ball of every
   match, and a sheet re-renders on each tap. statsMemo keeps the last few
   results, keyed by what they're worked out from: each match's id, finish
   time, score and players (an edit, a name put right or a new match changes
   the key), and the lists that tell who a name is on this phone. */
const statsMemoCache = new Map();
const STATS_MEMO_MAX = 40;
function statsMemoSig(matches){
  const ctx = [Object.keys(state.players || {}).length, ui.club && ui.club.roster ? ui.club.roster.length : 0,
    ui.premier && ui.premier.players ? ui.premier.players.length : 0, ui.identity && ui.identity.myPlayer ? ui.identity.myPlayer.id : ""].join(":");
  return ctx + "|" + (matches || []).map(m => !m ? "" : [m.id || "", m.completedAt || 0, m.motm || "", Object.keys(m.playerIds || {}).length,
    ...(m.innings || []).map(i => `${i.runs}/${i.wickets}/${i.legalBalls}/${i.batting ? i.batting.order.join(",") + ";" + i.bowling.order.join(",") : ""}`)].join(":")).join("|");
}
function statsMemo(name, matches, extra, fn){
  const sig = `${name}\u0001${extra || ""}\u0001${statsMemoSig(matches)}`;
  if (statsMemoCache.has(sig)) return statsMemoCache.get(sig);
  const value = fn();
  statsMemoCache.set(sig, value);
  if (statsMemoCache.size > STATS_MEMO_MAX) statsMemoCache.delete(statsMemoCache.keys().next().value);
  return value;
}

/* --- records (computeRecords, computeHonours) ---
   One section at a time behind a row of chips (ui.recordsTab): Batting,
   Bowling, Fielding, Partnerships, Match-ups, Teams, Awards and the Honours
   board -- only the ones with something in them. In a section every record
   is a full-width card (so long names show in full), its top three a row
   each: a career tally's name opens that player's sheet, a one-match row
   opens its scorecard (an over shows its balls). Places level beyond three
   are behind "see all" (renderRecordSheetModal). "Best for each wicket" has
   a row per wicket, and Teams opens with how matches were won (batting
   first, chasing, the toss). A record nobody has yet is left out. */
const RECORDS_SHOWN = 3;
const RECORD_SECTIONS = [["bat", "Batting"], ["bowl", "Bowling"], ["field", "Fielding"], ["partner", "Partnerships"],
  ["matchups", "Match-ups"], ["team", "Teams"], ["awards", "Awards"], ["honours", "Honours"]];
function recordValue(e){ return escapeHtml(e.text != null ? e.text : String(e.value)); }
// Places level beyond the three shown: a button to the record's full list (renderRecordSheetModal).
function recordMoreHtml(r){
  const more = r.entries.length - RECORDS_SHOWN;
  return more > 0 ? `<button type="button" data-action="open-record" data-key="${escapeHtml(r.key)}" class="record-more">+${more} more level · see all ›</button>` : "";
}
function recordLabelHtml(r){
  return `<div class="record-label">${escapeHtml(r.label)}</div>${r.note ? `<div class="record-note">${escapeHtml(r.note)}</div>` : ""}`;
}
// A player's name that opens their sheet over the same matches (career tallies carry a key).
function recordNameHtml(e){
  return e.key
    ? `<button type="button" data-action="open-player-stats" data-key="${escapeHtml(e.key)}" data-name="${escapeHtml(e.name)}" class="name-btn record-name">${escapeHtml(e.name)}</button>`
    : `<span class="record-name">${escapeHtml(e.name)}</span>`;
}
function recordBallsHtml(balls){
  return `<span class="record-balls">${balls.map(e => {
    const bat = !/^(Wd|Nb|B|Lb)/.test(e.display);
    const cls = e.isWicket ? " wicket" : e.runs === 4 && bat ? " four" : e.runs === 6 && bat ? " six" : /^(Wd|Nb)/.test(e.display) ? " extra" : "";
    return `<span class="chip${cls}">${escapeHtml(e.display)}</span>`;
  }).join("")}</span>`;
}
// `place`: what the round badge says (a place, or "1st" for a wicket's partnership).
function recordRowHtml(e, place){
  const lead = place == null && e.place === 1;
  const mark = place != null ? place : e.place;
  const inner = `<span class="record-place${place != null ? " wkt" : ""}">${escapeHtml(String(mark))}</span>
    <span class="record-who"><span class="record-name">${escapeHtml(e.name)}</span><span class="record-detail">${escapeHtml(e.detail || "")}</span>${lead && e.balls ? recordBallsHtml(e.balls) : ""}</span>
    <span class="record-val">${recordValue(e)}</span>`;
  return e.matchId
    ? `<li><button type="button" data-action="open-match-detail" data-id="${escapeHtml(e.matchId)}" class="record-row record-open${lead ? " lead" : ""}">${inner}<span class="chevron" aria-hidden="true">›</span></button></li>`
    : `<li class="record-row${lead ? " lead" : ""}">${inner}</li>`;
}
// A career tally's row: the name opens that player's sheet (a one-match row opens its scorecard, recordRowHtml).
function recordPlayerRowHtml(e){
  return `<li class="record-row${e.place === 1 ? " lead" : ""}"><span class="record-place">${e.place}</span>
    <span class="record-who">${recordNameHtml(e)}<span class="record-detail">${escapeHtml(e.detail || "")}</span></span>
    <span class="record-val">${recordValue(e)}</span></li>`;
}
/* A batter v bowler pair (Match-ups): one line each, tagged BAT / BOWL (the
   live board's striker and bowler colours), each name opening that player. */
function roleTagHtml(role){ return `<span class="role-tag ${role}">${role === "bat" ? "BAT" : "BOWL"}</span>`; }
function recordPairRowHtml(e){
  const who = (role, x) => `<span class="pair-line">${roleTagHtml(role)}${recordNameHtml({ key: isNameKey(x.key) ? null : x.key, name: x.name })}</span>`;
  return `<li class="record-row pair-row${e.place === 1 ? " lead" : ""}"><span class="record-place">${e.place}</span>
    <span class="record-who">${who("bat", e.pair.batter)}${who("bowl", e.pair.bowler)}<span class="record-detail">${escapeHtml(e.detail || "")}</span></span>
    <span class="record-val">${recordValue(e)}</span></li>`;
}
function recordEntryRowHtml(e){ return e.matchId ? recordRowHtml(e) : e.pair ? recordPairRowHtml(e) : recordPlayerRowHtml(e); }
function recordCardHtml(r){
  const rows = r.byWicket ? r.entries.map(e => recordRowHtml(e, ordinalText(e.wicket))) : r.entries.slice(0, RECORDS_SHOWN).map(recordEntryRowHtml);
  return `<div class="record-card">
    ${recordLabelHtml(r)}
    <ol class="record-rows">${rows.join("")}</ol>
    ${r.byWicket ? "" : recordMoreHtml(r)}
  </div>`;
}
function recordFactsHtml(facts){
  if (!facts || !facts.length) return "";
  return `<div class="record-facts">${facts.map(f => `
    <div class="record-fact"><span class="record-fact-val">${escapeHtml(f.value)}</span><span class="record-fact-label">${escapeHtml(f.label)}</span><span class="record-detail">${escapeHtml(f.detail)}</span></div>`).join("")}</div>`;
}
// One full-width card per record (two to a row cut long names short): career tallies first, then one-match records.
function renderRecordGroup(g){
  const cards = g.records.filter(r => r.tile).concat(g.records.filter(r => !r.tile));
  return `<section class="records-group" data-anim-key="records:${g.key}">
    ${recordFactsHtml(g.facts)}
    ${cards.length ? `<div class="records-cards">${cards.map(recordCardHtml).join("")}</div>` : ""}
  </section>`;
}
// Every record of `matches` (statsMemo'd), records nobody has yet left out.
function recordGroupsFor(matches){
  const opts = statsOpts();
  return statsMemo("records", matches, "", () => computeRecords(matches, opts))
    .map(g => Object.assign({}, g, { records: g.records.filter(r => r.entries.length) }))
    .filter(g => g.records.length || (g.facts && g.facts.length));
}
/* A record in full: every place it keeps (RECORDS_TOP places, with everyone
   level on them -- what a card leaves out past its first three). ui.recordSheet
   = { view, key }; its rows open the player's sheet (a career tally) or the
   match's scorecard (one match), over it. */
function renderRecordSheetModal(){
  const rs = ui.recordSheet;
  let rec = null;
  recordGroupsFor((statsScope && statsScope.matches) || []).forEach(g => g.records.forEach(r => { if (r.key === rs.key) rec = r; }));
  const row = recordEntryRowHtml;
  return `
    <div class="modal-backdrop">
      <div class="modal record-sheet" data-keep-scroll="record-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(rec ? rec.label : "Record")}">
        <div class="wicket-modal-head">
          <h2>${escapeHtml(rec ? rec.label : "Record")}</h2>
          <button type="button" data-action="close-record-sheet" class="sheet-close" aria-label="Close">✕</button>
        </div>
        ${rec ? `${rec.note ? `<p class="muted record-sheet-note">${escapeHtml(rec.note)}</p>` : ""}
          <p class="muted record-sheet-note">${escapeHtml(statsScope ? statsScope.title : "")} · top ${RECORDS_TOP} places, everyone level included</p>
          <ol class="record-rows">${rec.entries.map(row).join("")}</ol>` : `<p class="hint">This record isn't here any more.</p>`}
        <div class="sheet-actions"><button type="button" data-action="close-record-sheet" class="ghost">Close</button></div>
      </div>
    </div>`;
}
function renderRecords(matches){
  const groups = recordGroupsFor(matches);
  const honours = statsMemo("honours", matches, "", () => computeHonours(matches, statsOpts()));
  const hasHonours = honours.batting.length + honours.bowling.length + honours.hatTricks.length > 0;
  const tabs = RECORD_SECTIONS.filter(([k]) => k === "honours" ? hasHonours : groups.some(g => g.key === k));
  if (!tabs.length) return `<p class="hint">No records yet.</p>`;
  const tab = tabs.some(([k]) => k === ui.recordsTab) ? ui.recordsTab : tabs[0][0];
  return `<div class="records">
    ${tabsHtml("records-tab", tabs, tab, "main-tabs many records-tabs")}
    ${tab === "honours" ? renderHonours(honours) : renderRecordGroup(groups.find(g => g.key === tab))}
  </div>`;
}

/* --- the honours board ---
   Every 50 and 100, every haul of 3 wickets or more and every hat-trick, the
   newest first, each opening its scorecard -- the board in the pavilion. A
   long list shows its newest HONOURS_SHOWN until "Show all" (ui.honoursAll). */
const HONOURS_SHOWN = 20;
function honourRowHtml(e){
  const when = e.at ? matchDateText({ completedAt: e.at }) : "";
  const inner = `<span class="honour-val${e.big ? " big" : ""}">${escapeHtml(e.text)}</span>
    <span class="record-who"><span class="record-name">${escapeHtml(e.name)}</span><span class="record-detail">${escapeHtml([e.detail, when].filter(Boolean).join(" · "))}</span></span>`;
  return e.matchId
    ? `<li><button type="button" data-action="open-match-detail" data-id="${escapeHtml(e.matchId)}" class="record-row record-open">${inner}<span class="chevron" aria-hidden="true">›</span></button></li>`
    : `<li class="record-row">${inner}</li>`;
}
function renderHonours(h){
  const all = ui.honoursAll || {};
  const list = (key, title, entries) => {
    if (!entries.length) return "";
    const shown = all[key] ? entries : entries.slice(0, HONOURS_SHOWN);
    return `<div class="record-card honours-card">
      <div class="record-label">${title} <span class="record-count">${entries.length}</span></div>
      <ol class="record-rows">${shown.map(honourRowHtml).join("")}</ol>
      ${shown.length < entries.length ? `<button type="button" data-action="honours-all" data-tab="${key}" class="link-btn">Show all ${entries.length}</button>` : ""}
    </div>`;
  };
  return `<section class="records-group honours" data-anim-key="records:honours">
    ${list("batting", "50s and 100s", h.batting)}
    ${list("bowling", "3 wickets or more", h.bowling)}
    ${list("hatTricks", "Hat-tricks", h.hatTricks)}
  </section>`;
}
