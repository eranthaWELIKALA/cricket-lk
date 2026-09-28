/* Cricket.lk service worker: offline cache only, no notifications (yet). */
const CACHE = "cricket-lk-v2";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
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

// Network first for the page so updates land; stale-while-revalidate for the
// supabase-js CDN script; cache first for everything else. Supabase API
// calls themselves are never cached here -- the app keeps its own read cache
// and outbox (see "offline-first" in index.html).
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate"){
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
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
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
