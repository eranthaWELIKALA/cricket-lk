/* Cricket.lk service worker: offline cache only, no notifications (yet). */
const CACHE = "cricket-lk-v10";
// The app's own code: index.html's stylesheet and <script src> files, in the
// same order. test.js checks this list against index.html, so a file added
// there and not here fails the tests instead of breaking offline use.
const APP_CODE = [
  "./css/app.css",
  "./js/reference-data.js",
  "./js/engine.js",
  "./js/storage.js",
  "./js/cloud.js",
  "./js/ui/state.js",
  "./js/ui/common.js",
  "./js/ui/chrome.js",
  "./js/ui/router.js",
  "./js/ui/menus.js",
  "./js/ui/screens/home-account.js",
  "./js/ui/screens/clubs.js",
  "./js/ui/screens/club-tournaments.js",
  "./js/ui/screens/premier.js",
  "./js/ui/match/setup.js",
  "./js/ui/match/sheets.js",
  "./js/ui/match/live.js",
  "./js/ui/match/result.js",
  "./js/ui/screens/guest.js",
  "./js/ui/screens/stats.js",
  "./js/ui/render.js",
  "./js/ui/events.js",
  "./js/boot.js",
  "./js/install-prompt.js"
];
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./apple-touch-icon.png", "./favicon-32.png", "./icon.svg", ...APP_CODE];
// supabase-js (loaded dynamically by index.html's loadSupabaseLib). Cached so
// a signed-in user can still boot into their clubs offline -- keep in step
// with SUPABASE_JS_CDN_URL in index.html.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    // Best effort: a blocked CDN must not fail the whole install.
    try { await c.add(SUPABASE_JS); } catch (_){}
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first -- refreshing the cached copy -- for the page and the app's
// own code (css/, js/), so a deploy lands in one go and the page and its
// scripts never come from different versions; stale-while-revalidate for the
// supabase-js CDN script; cache first for everything else (icons). Supabase
// API calls themselves are never cached here -- the app keeps its own read
// cache and outbox (see "Offline-first sync" in CLAUDE.md).
function networkFirst(req, cacheKey){
  return fetch(req).then(res => {
    if (res && res.ok) caches.open(CACHE).then(c => c.put(cacheKey, res.clone()));
    return res;
  }).catch(() => caches.match(cacheKey));
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate"){
    // Only the scorer page is kept for offline (admin.html isn't -- it's
    // useless without the database, and falls back to the scorer offline).
    const path = new URL(req.url).pathname;
    const isScorer = path.endsWith("/") || path.endsWith("/index.html");
    e.respondWith(isScorer ? networkFirst(req, "./index.html") : fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  if (req.url.startsWith("https://cdn.jsdelivr.net/npm/@supabase/")){
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req.url);
      const fresh = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(req.url, res.clone()); return res; }).catch(() => null);
      return hit || (await fresh) || Response.error();
    }));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase API etc.: straight to the network
  if (/\.(js|css)$/.test(url.pathname)){ e.respondWith(networkFirst(req, req.url)); return; }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
