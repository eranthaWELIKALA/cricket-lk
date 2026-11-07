/* Cricket.lk — match: super over (start one off a tie, keep its result in the tied match).
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* --- super over ---
   The rules are ENGINE's ("super over": createSuperOver, superOverRecord,
   matchResult). A super over is played as a match of its own (state.match,
   with `superOverOf`), so live scoring, Undo, ball edits, catch-up and the
   pick sheets all work on it unchanged. It's never archived by itself: once
   it finishes it goes into its tied match's archive entry (`superOvers`, in
   place by its number), so the result, standings, fixtures and a club's
   cloud copy follow. Like a reopened match, a finished super over that's
   taken back (Undo, reopen an innings) keeps its result there until it
   finishes again; Undo all the way out of it removes it. */

// A tied match's super overs into its archive entry (and the cloud, for a club).
function writeSuperOvers(id, list){
  const entry = state.matchHistory[id];
  if (!entry) return false;
  const next = withSuperOvers(entry, list);
  if (canonicalJson(next) === canonicalJson(entry)) return false;
  state.matchHistory[id] = next;
  if (next.clubId) syncMatchToCloud(next, next);
  return true;
}
// A finished super over goes into its tied match, replacing an earlier copy
// of itself (maybeArchiveCompletedMatch calls this after every change).
function syncSuperOver(so){
  const ref = so && so.superOverOf;
  const entry = ref && state.matchHistory[ref.id];
  if (!entry || so.status !== "complete") return;
  const had = (entry.superOvers || [])[ref.n - 1];
  const list = (entry.superOvers || []).slice(0, ref.n - 1).concat([superOverRecord(so)]);
  if (writeSuperOvers(ref.id, list) && !had) SFX.win();
}
// Undo all the way out of a super over: it comes out of its tied match again.
function dropSuperOver(ref){
  const entry = ref && state.matchHistory[ref.id];
  if (entry && (entry.superOvers || []).length >= ref.n) writeSuperOvers(ref.id, entry.superOvers.slice(0, ref.n - 1));
}

/* The tied match a super over would be added to: its archive entry and id.
   `m` is the tied match on Result, a super over that tied too, or (from the
   scorecard sheet) an archived tie. Null when there's none to go to. */
function superOverParent(m){
  const id = !m ? null : m.superOverOf ? m.superOverOf.id : m === state.match ? m.archivedId : m.id;
  const entry = id && state.matchHistory[id];
  if (!entry || superOverError(entry) || superOverError(m)) return null;
  return { id, entry };
}
// Who bats first in the next super over: the side that batted second last time.
function nextSuperOverBatting(entry){
  return (lastSuperOver(entry) || entry).innings[1].battingTeam;
}
/* A tied match's scorecard sheet (history) offers a super over too, for a
   match archived on this device -- not while another match is on screen
   (its "Edit match" line already says to finish that one first). */
function superOverStartBlocked(m){
  return !m || !m.id || state.match || !superOverParent(m) ? "none" : null;
}

/* Start the next super over: from Result (the tied match, or a super over
   that tied too -- snapshotted, so Undo goes back to that Result), or for
   an archived tie from its scorecard sheet (`id`). A club match is checked
   against its cloud copy first, as for Edit match. */
function startSuperOver(id){
  if (id){
    if (superOverStartBlocked(state.matchHistory[id])) return;
    if (cloudCopyWorthChecking(id)) return takeNewerCloudCopy(id).then(() => beginSuperOver(id, false));
    return beginSuperOver(id, false);
  }
  const p = superOverParent(state.match);
  if (!p) return;
  pushSnapshot();
  beginSuperOver(p.id, true);
}
function beginSuperOver(parentId, fromResult){
  const entry = state.matchHistory[parentId];
  if (!entry || superOverError(entry) || (!fromResult && state.match)) return;
  state.match = createSuperOver(entry, parentId);
  if (!fromResult) state.snapshots = [];
  ui = defaultUi();
  navReplaceNext = fromResult;   // Result is replaced by the super over, never returned to
  save(); render();
}

// The cancel sheet's words for a super over in progress (askCancelMatch).
function cancelSuperOverText(m){
  const ref = m.superOverOf, entry = state.matchHistory[ref.id];
  const result = entry ? ` (<b>${escapeHtml(entry.result || "")}</b>)` : "";
  return (entry && (entry.superOvers || [])[ref.n - 1]
    ? `<p>This super over was finished, then reopened. Cancelling throws away the changes since then; the match keeps the result it had${result}.</p>`
    : `<p>The super over is thrown away and the match keeps its result${result}.</p>`) + `<p>This can't be undone.</p>`;
}

/* "Super over" on a tie's Result (and its scorecard sheet, with `id`). With
   the preset's "a tie goes to a super over" (`match.superOver`), or for a
   super over that tied too, it's the main way on (primary button). */
function superOverCalledFor(m){ return !!(m && (m.superOver || m.superOverOf)); }
function renderSuperOverCard(m, id){
  const p = superOverParent(m);
  if (!p || (id ? superOverStartBlocked(m) : m !== state.match)) return "";
  const main = !id && superOverCalledFor(m);
  const n = (p.entry.superOvers || []).length + 1;
  return `
    <div class="super-over-card${main ? " main" : ""}">
      <div class="super-over-head"><span class="so-badge" aria-hidden="true">SO</span><b>${escapeHtml(capitalize(superOverName(n)))}</b></div>
      <p class="super-over-rules">${escapeHtml(teamName(p.entry, nextSuperOverBatting(p.entry)))} bat first · ${SUPER_OVER_OVERS} over, ${SUPER_OVER_PLAYERS - 1} wickets a side</p>
      <button type="button" data-action="start-super-over"${id ? ` data-id="${escapeHtml(id)}"` : ""} class="${main ? "primary" : "ghost"}">Start super over</button>
    </div>`;
}

/* The super overs a tie was settled with (or not), under its scorecard:
   each side's score, its balls, who batted and who bowled. They're not in
   the match's stats, so there's no edit from here. */
function ballChipClass(ev){
  if (ev.isWicket) return "chip wicket";
  const off = /^(Wd|Nb|B|Lb)/.test(ev.display);
  if (ev.runs === 4 && !off) return "chip four";
  if (ev.runs === 6 && !off) return "chip six";
  return /^(Wd|Nb)/.test(ev.display) ? "chip extra" : "chip";
}
function renderSuperOverSection(m){
  const list = matchTied(m) ? m.superOvers || [] : [];
  return list.map(rec => {
    const so = superOverMatch(m, rec);
    return `
      <div class="super-over-block">
        <div class="super-over-head"><span class="so-badge" aria-hidden="true">SO</span><b>${escapeHtml(capitalize(superOverName(rec.n, list.length > 1)))}</b><span class="super-over-result">${escapeHtml(rec.result || "")}</span></div>
        ${rec.innings.map(inn => {
          const bpo = inn.ballsPerOver;
          const balls = [...inn.overs.flatMap(o => o.events || []), ...inn.currentOverEvents];
          const bat = inn.batting.order.map(n => { const s = inn.batting.stats[n]; return `${escapeHtml(liveName(n))} ${s.runs}${s.out ? "" : "*"} (${s.balls})`; });
          const bowl = inn.bowling.order.map(n => { const b = inn.bowling.stats[n]; return `${escapeHtml(liveName(n))} ${oversDisplay(b.legalBalls, bpo)}-${b.maidens}-${b.runs}-${b.wickets}`; });
          return `
            <div class="so-inn">
              <div class="so-inn-head"><b>${escapeHtml(teamName(so, inn.battingTeam))}</b><span class="n">${inn.runs}-${inn.wickets}</span><span class="n muted">(${oversDisplay(inn.legalBalls, bpo)})</span></div>
              ${balls.length ? `<div class="chips so-balls">${balls.map(ev => `<span class="${ballChipClass(ev)}">${escapeHtml(ev.display)}</span>`).join("")}</div>` : ""}
              ${bat.length || bowl.length ? `<div class="so-players">${[bat.join(", "), bowl.join(", ")].filter(Boolean).join(" · ")}</div>` : ""}
            </div>`;
        }).join("")}
      </div>`;
  }).join("");
}
