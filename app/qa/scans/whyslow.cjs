// What is the largest paint, and where does the main thread spend its time, on the phone profile? Read only.
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:4199';
const INIT = `window.__lcp = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), tag: e.element ? e.element.tagName.toLowerCase() : '?', cls: e.element ? String(e.element.className && e.element.className.baseVal !== undefined ? e.element.className.baseVal : e.element.className).slice(0, 40) : '', text: e.element ? (e.element.innerText || '').trim().slice(0, 28) : '', size: e.size, url: (e.url || '').slice(-30) }); }).observe({ type: 'largest-contentful-paint', buffered: true });`;
(async () => {
  const browser = await chromium.launch();
  for (const [label, signedIn, hash] of [['login', false, ''], ['home', true, '#/home'], ['payroll', true, '#/admin/payroll']]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    if (signedIn) {
      const p0 = await ctx.newPage(); await p0.goto(BASE + '/'); await p0.getByLabel('Email').fill('admin@ifluids.com'); await p0.getByLabel('Password').fill('Admin@123');
      await p0.getByRole('button', { name: 'Login' }).click(); await p0.waitForURL(/#\/home/); await p0.close();
    }
    const page = await ctx.newPage(); await page.addInitScript(INIT);
    const c = await ctx.newCDPSession(page);
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await c.send('Performance.enable');
    const reqs = []; c.on('Network.responseReceived', (e) => reqs.push({ t: Math.round(e.timestamp * 1000), url: e.response.url.replace(BASE, '').slice(0, 52), type: e.type }));
    const t0 = Date.now();
    await page.goto(BASE + '/' + hash, { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const m = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const lcp = await page.evaluate(() => window.__lcp);
    console.log(`\n=== ${label} (phone profile) ===`);
    console.log('LCP candidates:', lcp.map((x) => `${x.t} ms <${x.tag}${x.cls ? '.' + x.cls : ''}> "${x.text}"${x.url ? ' url=' + x.url : ''}`).join('\n               '));
    const ms = (v) => Math.round(v * 1000);
    console.log(`main thread over the whole load: tasks ${ms(m.TaskDuration)} ms | script ${ms(m.ScriptDuration)} ms | layout ${ms(m.LayoutDuration)} ms | style ${ms(m.RecalcStyleDuration)} ms`);
    const base = reqs.length ? reqs[0].t : 0;
    console.log('request order (ms after first response):', reqs.map((r) => `${r.t - base} ${r.url.split('/').pop()}`).slice(0, 14).join(' | '));
    await ctx.close();
  }
  await browser.close();
})();
