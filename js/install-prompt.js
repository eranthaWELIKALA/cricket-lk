/* Cricket.lk — phone-only install / open-the-app banner.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   INSTALL PROMPT — phone-only "install / open the app" banner.
   Browsers never let a page install itself or launch an installed PWA:
   - Android/Chromium fires `beforeinstallprompt`; we hold it and call
     prompt() only from the banner's button (a user gesture is required).
     It fires only after a tap and ~30s on the page, so those browsers
     wait up to 45s for it before falling back to the menu steps.
   - Every other browser (iOS in any browser, Firefox, Opera, Samsung
     Internet without the event, in-app browsers like WhatsApp/Instagram)
     has no install API: `manualInstallHint()` names that browser's own
     menu path, or says to open the page in Chrome/Safari first.
   - "Already installed" is detected via getInstalledRelatedApps() (the
     manifest's related_applications webapp entry) or a flag set when the
     app last ran standalone; all we can do then is say "open it from your
     home screen" — Chrome also offers "Open in app" in its own menu.
   DOM-only, outside render(); dismissals snooze it for a week.
   ============================================================ */
(() => {
  const banner = document.getElementById("install-banner");
  if (!banner || !window.matchMedia) return;
  const KEY_INSTALLED = "cricket.lk.installed", KEY_SNOOZE = "cricket.lk.installSnooze";
  const SNOOZE_MS = 7 * 24 * 3600 * 1000;
  const store = DB.rawBackend;
  const get = k => { try { return store ? store.getItem(k) : null; } catch (_){ return null; } };
  const set = (k, v) => { try { if (store) v == null ? store.removeItem(k) : store.setItem(k, v); } catch (_){} };

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone){ set(KEY_INSTALLED, "1"); return; }

  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android|Mobi/i.test(ua);
  if (!isMobile) return;
  // In-app webviews carry "Chrome" in their UA, and report Chromium's
  // install API too, but can't install anything.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|Twitter|MicroMessenger|; wv\)/.test(ua);
  const promptApi = !inApp && "onbeforeinstallprompt" in window;
  const PROMPT_WAIT_MS = 45000;
  const snoozed = () => Date.now() - Number(get(KEY_SNOOZE) || 0) < SNOOZE_MS;

  let deferred = null;
  const title = banner.querySelector("strong"), sub = banner.querySelector(".install-banner-text span");
  const go = banner.querySelector(".install-banner-go");
  function show(t, s, button){
    if (snoozed()) return;
    title.textContent = t; sub.textContent = s;
    go.hidden = !button; if (button) go.textContent = button;
    banner.hidden = false;
    document.body.classList.add("has-install-banner");
  }
  const hide = () => { banner.hidden = true; document.body.classList.remove("has-install-banner"); };

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();            // suppress Chrome's mini-infobar; we show our own
    deferred = e;
    set(KEY_INSTALLED, null);      // it fires only when NOT installed (e.g. uninstalled since)
    show("Install Cricket.lk", "Score offline, full screen, one tap from your home screen.", "Install");
  });
  go.addEventListener("click", async () => {
    if (!deferred) return;
    const e = deferred; deferred = null;
    hide();
    try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome === "dismissed") set(KEY_SNOOZE, String(Date.now())); } catch (_){}
  });
  window.addEventListener("appinstalled", () => {
    set(KEY_INSTALLED, "1"); deferred = null;
    show("Cricket.lk is installed", "Open it from your home screen for full-screen scoring.");
  });
  banner.querySelector(".install-banner-close").addEventListener("click", () => {
    set(KEY_SNOOZE, String(Date.now())); hide();
  });

  const openHint = () => show("Cricket.lk is installed", "Open the app from your home screen — it works offline and full screen.");
  const ALREADY = " Already installed? Open it from your home screen.";

  // Install steps for browsers with no install API, by user agent. Pure
  // text; the order matters (in-app webviews carry "Chrome" in their UA too).
  function manualInstallHint(){
    if (inApp){
      return isIOS
        ? "This in-app browser can't install apps. Tap ⋯ → “Open in Safari”, then Share ⎋ → “Add to Home Screen”."
        : "This in-app browser can't install apps. Tap ⋮ → “Open in Chrome”, then install from there.";
    }
    if (isIOS){
      if (/CriOS|EdgiOS|FxiOS|OPiOS/.test(ua)) return "Tap Share ⎋ (address bar or menu) → “Add to Home Screen”. Not listed? Open this page in Safari." + ALREADY;
      return "Tap Share ⎋ at the bottom → “Add to Home Screen”." + ALREADY;
    }
    if (/SamsungBrowser/.test(ua)) return "Tap the menu ☰ → “Add page to” → “Home screen”." + ALREADY;
    if (/Firefox/.test(ua))        return "Tap the menu ⋮ → “Install” (or “Add to Home screen”)." + ALREADY;
    if (/OPR\/|Opera/.test(ua))    return "Tap the menu ⋮ → “Add to Home screen”." + ALREADY;
    if (/EdgA/.test(ua))           return "Tap the menu ⋯ → “Add to phone”." + ALREADY;
    return "Tap your browser's menu ⋮ → “Install app” or “Add to Home screen”." + ALREADY;
  }

  if (isIOS){
    // iOS keeps home-screen apps' storage separate from the browser, so the
    // installed flag never reaches here: one message covers both cases.
    show("Get the Cricket.lk app", manualInstallHint());
    return;
  }
  // Android. Chromium browsers (Chrome, Edge, Samsung Internet) get the
  // one-tap Install button, but only fire beforeinstallprompt once the
  // visitor has tapped the page and spent ~30s on it (Chrome's engagement
  // rule, counted across visits) — so on a first visit it comes late.
  // Menu steps shown meanwhile would send them to the browser menu for
  // nothing, and ✕ on them would snooze the real button, so those browsers
  // wait for it and get the steps only if it never comes. Browsers without
  // the API get the steps after 3s. Either way the banner turns into the
  // Install button if the event fires later.
  async function installedAlready(){
    if (get(KEY_INSTALLED) === "1") return true;
    try { return !!navigator.getInstalledRelatedApps && (await navigator.getInstalledRelatedApps()).length > 0; }
    catch (_){ return false; }
  }
  async function noPrompt(waited){
    if (deferred || !banner.hidden) return;
    const installed = await installedAlready();
    if (deferred || !banner.hidden) return;
    if (installed) openHint();
    else if (!promptApi || waited) show("Get the Cricket.lk app", manualInstallHint());
  }
  setTimeout(() => noPrompt(false), 3000);
  if (promptApi) setTimeout(() => noPrompt(true), PROMPT_WAIT_MS);
})();
