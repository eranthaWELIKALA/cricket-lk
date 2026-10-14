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
  const shot = async (name, opts) => { await p.waitForTimeout(350); await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 74, ...(opts || {}) }); console.log('shot', name); };
  const hideBanner = () => p.addStyleTag({ content: '#install-banner{display:none!important}' });
  return { b, ctx, p, run, tap, shot, hideBanner };
}
module.exports = { setup, BASE };
