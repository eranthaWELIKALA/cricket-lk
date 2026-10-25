/* Screenshots for tutorial.html (tutorial/img/*.jpg).
   Usage: serve the repo (python3 -m http.server 8765), `npm i -D playwright`
   (+ `npx playwright install chromium`), then: node scripts/tutorial/cap1.js,
   cap2.js, cap3.js. Supabase is blocked, so nothing touches the real cloud:
   club/Premier screens are drawn from sample data injected into the page. */
const { chromium, devices } = require('playwright');
const OUT = require('path').join(__dirname, '../../tutorial/img/');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
async function setup(){
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // Keep the real cloud out of it: no supabase-js -> no client, no fetches.
  await ctx.route(/supabase/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  const run = js => p.evaluate(js => { const s = document.createElement('script'); s.textContent = js; document.body.appendChild(s); }, js);
  const tap = async (sel) => { await p.evaluate(sel => { const el = document.querySelector(sel); if (!el) throw new Error('no ' + sel); el.click(); }, sel); await p.waitForTimeout(250); };
  // animations:'disabled' finishes the one-shot entrances (tiles rising in,
  // sheets sliding up) before the shot, so none is caught half-faded. Pass
  // { animations: 'allow' } to keep a frame you froze on purpose.
  const shot = async (name, opts) => { await p.waitForTimeout(350); await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 74, animations: 'disabled', ...(opts || {}) }); console.log('shot', name); };
  // Paint a live moment (the 4/6/W stinger) on the current board without
  // recording a ball, and freeze it at `ms` into its animation for a shot.
  const freezeMoment = (kind, label, sub, ms) => p.evaluate(([kind, label, sub, ms]) => {
    // A ball just scored may have left its own (hidden) stinger behind.
    document.querySelectorAll('#app .moment.stinger').forEach(e => e.remove());
    const s = document.createElement('script');
    s.textContent = `liveMoment = ${JSON.stringify({ kind, label, sub })}; playLiveMoment();`;
    document.body.appendChild(s);
    const el = document.querySelector('#app .moment.stinger');
    el.style.setProperty('display', 'block', 'important'); // hideBanner hides moments
    el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = ms; });
  }, [kind, label, sub || null, ms]);
  // Also hides the one-shot celebrations (confetti, live moments), so a shot
  // never catches one mid-flight.
  const hideBanner = () => p.addStyleTag({ content: '#install-banner,.confetti,.moment{display:none!important}' });
  return { b, ctx, p, run, tap, shot, hideBanner, freezeMoment };
}
module.exports = { setup, BASE };
