/* Cricket.lk — boot: load, first render, cloud auth, sync triggers, service worker.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
load();
// Page navigation (see ROUTES): number this entry, and let a URL that names a
// screen (reload, shared link) pick what's shown.
history.replaceState({ idx: 0 }, "", location.hash || "#/");
navRoutes = [currentRoute()];
if (currentRoute() !== "/") applyRoute(currentRoute());
// ...except mid-match: a reload always lands back on the match (see "Navigation").
ui.awayFromMatch = false;
navApplying = true; render(); navApplying = false;
initAuth();
// Launch splash (static in index.html): keep it up long enough to read, then
// fade it out behind the first render. A tap skips it.
(function(){
  const splash = document.getElementById("splash");
  if (!splash) return;
  const hide = () => { splash.classList.add("out"); setTimeout(() => splash.remove(), 350); };
  splash.addEventListener("click", hide);
  setTimeout(hide, Math.max(0, 900 - performance.now()));
})();
// First tap: give a page opened straight onto a screen a Home entry to go back to.
document.addEventListener("click", ensureNavBase, true);
// Offline-first sync triggers: coming back online, returning to the app, and
// a slow heartbeat while anything is still waiting.
window.addEventListener("online", () => handleBackOnline());
window.addEventListener("offline", () => render());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(0); });
setInterval(() => { if (pendingCount()) scheduleSync(0); }, 60000);

if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
