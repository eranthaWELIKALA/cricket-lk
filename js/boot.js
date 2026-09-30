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
