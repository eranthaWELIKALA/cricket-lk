// npm run release: the two store files, signed with the release key.
//   dist/cricket-lk-guest-<versionName>-<versionCode>.aab  → Google Play
//   dist/cricket-lk-guest-<versionName>-<versionCode>.apk  → Samsung Galaxy Store (and sideloading)
// Builds www/ from the web app first, so they always carry the current code.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = path.join(MOBILE, "android");
const DIST = path.join(MOBILE, "dist");
const fail = msg => { console.error("release: " + msg); process.exit(1); };
const run = (cmd, args, cwd = MOBILE) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (!fs.existsSync(path.join(ANDROID, "keystore.properties")))
  fail("no android/keystore.properties. Create the release key once with: sh scripts/make-keystore.sh (see README.md)");

const gradle = fs.readFileSync(path.join(ANDROID, "app", "build.gradle"), "utf8");
const versionCode = (gradle.match(/versionCode (\d+)/) || [])[1];
const versionName = (gradle.match(/versionName "([^"]+)"/) || [])[1];
if (!versionCode || !versionName) fail("couldn't read versionCode/versionName from android/app/build.gradle");

run("node", ["scripts/build-web.mjs"]);
run("npx", ["cap", "sync", "android"]);
run("./gradlew", ["clean", "bundleRelease", "assembleRelease"], ANDROID);

const base = `cricket-lk-guest-${versionName}-${versionCode}`;
const aab = path.join(ANDROID, "app/build/outputs/bundle/release/app-release.aab");
const apk = path.join(ANDROID, "app/build/outputs/apk/release/app-release.apk");
if (!fs.existsSync(aab)) fail("the .aab wasn't built");
if (!fs.existsSync(apk)) fail("no signed .apk (app-release.apk): is android/keystore.properties right?");
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(aab, path.join(DIST, base + ".aab"));
fs.copyFileSync(apk, path.join(DIST, base + ".apk"));

// Check both are really signed, and show the certificate (the stores show its SHA-256 too).
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), "Library/Android/sdk");
const tools = fs.readdirSync(path.join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
run(path.join(sdk, "build-tools", tools, "apksigner"), ["verify", "--print-certs", path.join(DIST, base + ".apk")]);
const aabCheck = execFileSync("jarsigner", ["-verify", path.join(DIST, base + ".aab")], { encoding: "utf8" });
if (!/jar verified/.test(aabCheck)) fail("the .aab isn't signed: " + aabCheck.trim());
console.log(`\nrelease: dist/${base}.aab (Google Play) and dist/${base}.apk (Samsung Galaxy Store)`);
