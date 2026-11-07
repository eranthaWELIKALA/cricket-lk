# Cricket.lk for Android — guest edition

The scorer as an Android app for **Google Play** and the **Samsung Galaxy
Store**. It is the guest part of the web app only: matches, tournaments,
teams, players, presets, stats, themes, sharing and Export PDF, all on the
phone. No sign-in, clubs, Premier, sync or tutorial page. It has **no
internet access at all**: the APK asks for no permissions.

This folder is separate from the website. The web app in `../` stays the one
source of code. `npm run release` copies it in, and changes on the website
only reach the app when you build and upload a new version.

## How it's put together

| | |
|---|---|
| `scripts/build-web.mjs` | Builds `www/` from `../index.html` and the files it loads, as the guest edition (details below). Fails loudly if `../index.html` or `js/cloud.js` changed shape. |
| `web/native-bridge.js` | Fills in what Android's WebView lacks: the share sheet, saving images, printing, status-bar icon colour. |
| `android/` | The Capacitor 8 Android project (target SDK 36, min SDK 24 = Android 7). Our own code: `MainActivity.java` (back button, edge to edge) and `CricketNativePlugin.java` (share, save to Pictures/Cricket.lk, print). |
| `capacitor.config.json` | App id, name, background colour, system-bar handling. |
| `scripts/make-icons.py` | Launcher icons from `../icon-512*.png`. |
| `scripts/make-keystore.sh` | Creates the release key, once. |
| `scripts/release.mjs` | Builds the signed store files into `dist/`. |
| `scripts/store-graphics.mjs` | The store images, drawn from the guest build in Chrome (below). |
| `store/` | Store listing text, privacy policy, store icon, screenshots, feature graphic. |

What the guest build changes, compared with the website:
- `window.CRICKET_LK_EDITION = "guest"` is set before the app's scripts. The
  app then hides Sign in, Account, Premier, the club switcher and "How to
  use", and sends any cloud screen or link to Home (`GUEST_EDITION` in
  `js/cloud.js`, see CLAUDE.md).
- The Supabase URL and key are blanked in the copied `js/cloud.js`.
- Left out: the PWA manifest, the service worker and the install banner.

## Build and try it

Needs Node 22+, JDK 21 (`JAVA_HOME`) and the Android SDK (`ANDROID_HOME`),
which Android Studio installs.

```bash
cd mobile
npm install            # first time only
npm run apk:debug      # android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run open` opens the project in Android Studio. A debug build can be
inspected from desktop Chrome at `chrome://inspect`.

## Release

1. **Once: create the release key.** `sh scripts/make-keystore.sh` asks for a
   password and writes `~/.android-keys/cricket-lk-upload.jks` and
   `android/keystore.properties` (both kept out of git). Back up the `.jks`
   file and its password somewhere safe, off this computer. Google Play can
   reset a lost key; the Galaxy Store can't, and without the key you can
   never update the app there.
2. **Each release:** raise `versionCode` by 1 (and `versionName` if you like)
   in `android/app/build.gradle`. Both stores refuse a `versionCode` they've
   already seen.
3. Build from a committed, tested state of the web app (`node ../test.js`):
   ```bash
   npm run release
   ```
   You get two files in `dist/`, each signature-checked:
   - `cricket-lk-guest-<version>-<code>.aab` → upload to **Google Play**
   - `cricket-lk-guest-<version>-<code>.apk` → upload to the **Samsung Galaxy Store**

### Before the first upload

- **The app id is permanent once uploaded:** `com.eranthawelikala.cricketlk`.
  To use a different one, change it in `capacitor.config.json`,
  `android/app/build.gradle` (`namespace`, `applicationId`),
  `android/app/src/main/res/values/strings.xml`, and the Java package folder
  `android/app/src/main/java/com/eranthawelikala/cricketlk/`.
- **Google Play:** use Play App Signing (the default). The key above is then
  only the *upload* key. New personal developer accounts must run a closed
  test with at least 12 testers for 14 days before they can publish to
  production. Plan for that.
- **Galaxy Store:** the APK is installed exactly as you signed it, so every
  future update must use the same key.
- Store text, Data safety answers and the privacy policy are in
  `store/listing.md` and `store/privacy-policy.html`. Both stores want the
  privacy policy at a public URL. Put that page on your website (fill in the
  contact email first).
- **Store images** are ready: `store/screenshots/` (8 captioned phone
  screenshots, 1080×1920, for both stores), `store/feature-graphic.jpg`
  (Google Play, 1024×500) and `store/play-icon-512.png`. `npm run
  store-graphics` makes them again from the current build, after a change to
  a screen they show. It uses sample data with made-up team and player names,
  and also writes the screens without captions to `store/screenshots/plain/`.

## When the web app changes

- **A new `<script src>` in `../index.html`** is picked up automatically.
- **A new cloud-only screen** needs no change here as long as it isn't added to
  `GUEST_EDITION_VIEWS` (`js/ui/router.js`): the guest edition sends it to
  Home. If it has a new entry point on a guest screen (a Home tile, a side
  menu item), hide it with `GUEST_EDITION` too.
- **A new web API the app relies on** (anything a phone's Chrome has but
  Android's WebView doesn't, like `navigator.share` was) needs filling in by
  `web/native-bridge.js`, or the feature silently does nothing in the app.
- **Capacitor updates:** keep `@capacitor/*` on the same version, then
  `npx cap sync android`. Google Play raises its required target SDK every
  August. Check `android/variables.gradle` then.
