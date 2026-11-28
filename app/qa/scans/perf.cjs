// Page-load performance of the production build (vite preview). Read only; demo admin account from the README.
// Two profiles: desktop (no throttling) and a mid-tier phone (375 px, 4x CPU slowdown, ~1.6 Mbps / 150 ms network, like Lighthouse mobile).
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:4199';
const RUNS = 3;
const performance_reqs = () => 0;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const INIT = `(() => { window.__m = { lcp: 0, cls: 0, fcp: 0, shown: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  window.__long = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true }); })()`;

async function profile(name, viewport, throttle) {
  const browser = await chromium.launch();
  const out = {};
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  // Sign in once (not throttled); the session stays in localStorage for the measured loads.
  await page.goto(BASE + '/');
  await page.getByLabel('Email').fill('admin@ifluids.com');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#\/home/);
  const cdp = await ctx.newCDPSession(page);
  if (throttle) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  // The third item is a selector for the page's own content. "Shown" is when it is on the page and drawn: Chrome's largest-paint reading is
  // not reliable on its own (it sometimes never counts the text of a page that loads late), so this is the number to trust for Payroll.
  for (const [label, url, sel] of [['login (signed out)', null, 'main h1'], ['home', '#/home', 'main h1'], ['payroll analytics', '#/admin/payroll', '.px p']]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const pctx = url ? ctx : await browser.newContext({ viewport });
      const p = await pctx.newPage();
      await p.addInitScript(INIT);
      // polled every 25 ms rather than watched with a MutationObserver, which on its own added about 100 ms to the blocked-time reading
      await p.addInitScript(`(() => { const sel = ${JSON.stringify(sel)}; const t = setInterval(() => { if (document.body && document.querySelector(sel)) { clearInterval(t); requestAnimationFrame(() => requestAnimationFrame(() => (window.__m.shown = Math.round(performance.now())))); } }, 25); })()`);
      const c = await pctx.newCDPSession(p);
      if (throttle) {
        await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await c.send('Network.enable');
        await c.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      }
      await c.send('Network.enable');
      await c.send('Network.setCacheDisabled', { cacheDisabled: true });
      let bytes = 0, reqs = 0;
      c.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
      const t0 = Date.now();
      await p.goto(BASE + '/' + (url || ''), { waitUntil: 'load' });
      await p.waitForTimeout(url ? 3500 : 2500);
      const m = await p.evaluate(() => ({ ...window.__m, tbt: window.__long, load: performance.timing ? performance.timing.loadEventEnd - performance.timing.navigationStart : 0, transfer: (performance.getEntriesByType('navigation')[0]||{}).transferSize + performance.getEntriesByType('resource').reduce((t, r) => t + (r.transferSize || 0), 0), reqs: performance.getEntriesByType('resource').length + 1, js: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js')).reduce((s, r) => s + (r.encodedBodySize || 0), 0) }));
      runs.push({ ...m, bytes: m.transfer, reqs: m.reqs });
      await p.close();
      if (!url) await pctx.close();
    }
    out[label] = { FCP: Math.round(med(runs.map((r) => r.fcp))), SHOWN: Math.round(med(runs.map((r) => r.shown))), LCP: Math.round(med(runs.map((r) => r.lcp))), CLS: +med(runs.map((r) => r.cls)).toFixed(3), TBTms: Math.round(med(runs.map((r) => r.tbt))), loadMs: Math.round(med(runs.map((r) => r.load))), transferKB: Math.round(med(runs.map((r) => r.bytes)) / 1024), requests: med(runs.map((r) => r.reqs)) };
  }
  await browser.close();
  return out;
}

(async () => {
  const desktop = await profile('desktop', { width: 1280, height: 720 }, false);
  const phone = await profile('phone', { width: 375, height: 812 }, true);
  const show = (t, o) => { console.log(t); for (const [k, v] of Object.entries(o)) console.log(`  ${k.padEnd(20)} FCP ${String(v.FCP).padStart(5)} ms | content shown ${String(v.SHOWN).padStart(5)} ms | LCP ${String(v.LCP).padStart(5)} ms | CLS ${v.CLS} | TBT~${String(v.TBTms).padStart(4)} ms | load ${String(v.loadMs).padStart(5)} ms | ${v.transferKB} KB in ${v.requests} requests`); };
  show('DESKTOP (no throttling, cache off, median of ' + RUNS + ')', desktop);
  show('PHONE (375px, 4x CPU slowdown, 1.6 Mbps / 150 ms, cache off, median of ' + RUNS + ')', phone);
})().catch((e) => { console.error('PERF FAILED', e); process.exit(1); });
