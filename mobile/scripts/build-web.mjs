// Builds mobile/www: the web app in ../ as the guest edition, for Capacitor.
//
// The web app stays the one source of truth. This copies exactly what
// ../index.html loads (its stylesheet and <script src> files, in order) and
// the images it shows, then:
//   - sets window.CRICKET_LK_EDITION = "guest" before the app's scripts, so the
//     app hides sign-in, clubs and Premier (GUEST_EDITION in js/cloud.js);
//   - blanks the Supabase URL/key in the copied js/cloud.js, so the APK
//     carries no backend address at all;
//   - adds js/native-bridge.js (mobile/web/), which gives the WebView what it
//     lacks: share sheet, saving images, printing (Export PDF), status bar
//     icon colour;
//   - leaves out the web-only parts: the PWA manifest, the service worker
//     (never copied, so its registration just fails quietly) and the install
//     banner script.
// Every edit is checked: if ../index.html or js/cloud.js changes shape so an
// edit no longer applies, the build fails instead of shipping the wrong app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.resolve(MOBILE, "..");
const OUT = path.join(MOBILE, "www");

const WEB_ONLY_SCRIPTS = ["js/install-prompt.js"];

function fail(msg){ console.error("build-web: " + msg); process.exit(1); }
// Replace exactly one occurrence, or fail.
function replaceOnce(text, find, replacement, what){
  const hits = typeof find === "string" ? text.split(find).length - 1 : (text.match(new RegExp(find.source, "g")) || []).length;
  if (hits !== 1) fail(`expected exactly one ${what}, found ${hits}`);
  return text.replace(find, replacement);
}
function copy(rel, transform){
  const from = path.join(WEB, rel);
  if (!fs.existsSync(from)) fail(`missing ${rel}`);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (transform) fs.writeFileSync(to, transform(fs.readFileSync(from, "utf8")));
  else fs.copyFileSync(from, to);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");

// The page's own code, in the order index.html loads it.
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!styles.length || scripts.length < 10) fail("couldn't find the app's stylesheet and scripts in index.html");
for (const s of WEB_ONLY_SCRIPTS){
  if (!scripts.includes(s)) fail(`index.html no longer loads ${s}; update WEB_ONLY_SCRIPTS`);
  html = replaceOnce(html, `<script src="${s}"></script>\n`, "", `<script src="${s}">`);
}

// Web-only <head> parts.
html = replaceOnce(html, /<link rel="manifest" href="[^"]+">\n/, "", "manifest link");

// Edition flag + native bridge, before the first app script.
const firstScript = `<script src="${scripts[0]}"></script>`;
html = replaceOnce(html, firstScript,
  `<script>window.CRICKET_LK_EDITION = "guest";</script>\n<script src="js/native-bridge.js"></script>\n${firstScript}`,
  "first app script");

for (const rel of styles) copy(rel);
for (const rel of scripts){
  if (WEB_ONLY_SCRIPTS.includes(rel)) continue;
  if (rel === "js/cloud.js"){
    copy(rel, src => {
      src = replaceOnce(src, /const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "";', "SUPABASE_URL in js/cloud.js");
      src = replaceOnce(src, /const SUPABASE_ANON_KEY = "[^"]*";/, 'const SUPABASE_ANON_KEY = "";', "SUPABASE_ANON_KEY in js/cloud.js");
      if (!/var GUEST_EDITION = /.test(src)) fail("js/cloud.js has no GUEST_EDITION flag");
      return src;
    });
  } else copy(rel);
}
fs.copyFileSync(path.join(MOBILE, "web", "native-bridge.js"), path.join(OUT, "js", "native-bridge.js"));

// Every local image the page references (icons, splash, print header). The
// share image's logo is icon-192.png, which the splash already uses.
const assets = new Set([...html.matchAll(/(?:src|href)="([^":#?]+\.(?:png|svg|jpg|webp|ico))"/g)].map(m => m[1]));
if (!assets.has("icon-192.png")) fail("icon-192.png (the share image's logo) isn't referenced any more; copy it explicitly");
for (const rel of assets) copy(rel);

fs.writeFileSync(path.join(OUT, "index.html"), html);

const files = [];
(function walk(dir){ for (const e of fs.readdirSync(dir, { withFileTypes: true })){ const p = path.join(dir, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(OUT);
const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`build-web: guest edition in www/ (${files.length} files, ${(bytes / 1024).toFixed(0)} KB)`);
