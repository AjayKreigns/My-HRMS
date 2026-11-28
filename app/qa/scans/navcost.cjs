// How long does the FIRST visit to a page take on a phone-class device after the app has loaded and sat idle? Read only.
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:4199';
const IDLE = Number(process.env.IDLE || 9000);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p0 = await ctx.newPage(); await p0.goto(BASE + '/'); await p0.getByLabel('Email').fill('admin@ifluids.com'); await p0.getByLabel('Password').fill('Admin@123');
  await p0.getByRole('button', { name: 'Login' }).click(); await p0.waitForURL(/#\/home/); await p0.close();
  const results = [];
  for (const round of [1, 2, 3]) {
    const page = await ctx.newPage();
    const c = await ctx.newCDPSession(page);
    await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: false });
    await c.send('Network.clearBrowserCache');
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await page.goto(BASE + '/#/home', { waitUntil: 'load' });
    await page.evaluate(() => { window.__lastMut = performance.now(); new MutationObserver(() => (window.__lastMut = performance.now())).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
    await page.waitForTimeout(IDLE); // the user reads the first page
    const row = { round };
    const heading = { 'me/leave': 'Leave', 'finances/summary': 'My Finances', 'admin/payroll': 'Payroll', 'admin/employees': 'Manage employees' };
    for (const route of Object.keys(heading)) {
      const t0 = await page.evaluate((r) => ((window.__seen = 0), (window.__t0 = performance.now()), (location.hash = '#/' + r), window.__t0), route);
      await page.waitForFunction((h) => { const ok = [...document.querySelectorAll('main h1')].some((e) => e.textContent.trim() === h); if (ok && !window.__seen) window.__seen = performance.now(); return ok; }, heading[route], { timeout: 30000, polling: 'raf' });
      row[route] = Math.round(await page.evaluate((t) => window.__seen - t, t0));
      await page.evaluate(() => (location.hash = '#/home')); await page.waitForTimeout(800);
    }
    results.push(row); await page.close();
  }
  const med = (k) => results.map((r) => r[k]).sort((a, b) => a - b)[1];
  console.log(`First visit after ${IDLE / 1000} s idle, phone profile (median of 3, ms until the page's own heading is on screen):`);
  for (const k of ['me/leave', 'finances/summary', 'admin/payroll', 'admin/employees']) console.log(`  ${k.padEnd(18)} ${String(med(k)).padStart(5)} ms   (runs: ${results.map((r) => r[k]).join(', ')})`);
  await browser.close();
})();
