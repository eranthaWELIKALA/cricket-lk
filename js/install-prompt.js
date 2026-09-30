/* Cricket.lk — phone-only install / open-the-app banner.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   INSTALL PROMPT — phone-only "install / open the app" banner.
   Browsers never let a page install itself or launch an installed PWA:
   - Android/Chromium fires `beforeinstallprompt`; we hold it and call
     prompt() only from the banner's button (a user gesture is required).
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
    if (/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|Twitter|MicroMessenger|; wv\)/.test(ua)){
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
  // Android: give beforeinstallprompt a moment (Chromium only). If it never
  // fires, the app is either installed already or this browser has no
  // install API — then show that browser's manual steps.
  setTimeout(async () => {
    if (deferred || !banner.hidden) return;
    let installed = get(KEY_INSTALLED) === "1";
    try {
      if (!installed && navigator.getInstalledRelatedApps){
        installed = (await navigator.getInstalledRelatedApps()).length > 0;
      }
    } catch (_){}
    if (deferred) return;
    if (installed) openHint();
    else show("Get the Cricket.lk app", manualInstallHint());
  }, 3000);
})();
