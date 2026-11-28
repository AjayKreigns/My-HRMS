// Why does #/me/leave take ~1260 ms to settle? Is the main thread busy (a real slowdown) or is it a deliberate animation? Read only.
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const BASE = 'http://127.0.0.1:4199';
(async () => {
  const browser = await chromium.launch();
  for (const [label, cpu] of [['desktop, no throttling', 1], ['phone-class CPU (4x slower)', 4]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.getByLabel('Email').fill('admin@ifluids.com'); await page.getByLabel('Password').fill('Admin@123');
    await page.getByRole('button', { name: 'Login' }).click(); await page.waitForURL(/#\/home/); await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    for (const route of ['me/leave', 'me/attendance', 'admin/payroll']) {
      const r = await page.evaluate(async (route) => {
        const long = [];
        const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(Math.round(e.duration))));
        po.observe({ type: 'longtask', buffered: false });
        let muts = 0, last = 0, first = 0;
        const t0 = performance.now();
        const mo = new MutationObserver(() => { muts++; last = performance.now() - t0; if (!first) first = last; });
        mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        let raf = 0, stop = false; const tick = () => { raf++; if (!stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        location.hash = '#/' + route;
        await new Promise((r) => setTimeout(r, 2500));
        stop = true; mo.disconnect(); po.disconnect();
        const textMuts = muts;
        return { firstChangeMs: Math.round(first), lastChangeMs: Math.round(last), domChanges: muts, longTasksMs: long, framesIn2500ms: raf };
      }, route);
      console.log(`${label.padEnd(30)} ${route.padEnd(14)} first change ${String(r.firstChangeMs).padStart(4)} ms | last change ${String(r.lastChangeMs).padStart(5)} ms | DOM changes ${String(r.domChanges).padStart(4)} | long tasks (>50 ms): ${r.longTasksMs.length ? r.longTasksMs.join(', ') + ' ms' : 'none'} | frames in 2.5 s: ${r.framesIn2500ms}`);
      await page.evaluate(() => (location.hash = '#/home')); await page.waitForTimeout(600);
    }
    await ctx.close();
  }
  await browser.close();
})();
