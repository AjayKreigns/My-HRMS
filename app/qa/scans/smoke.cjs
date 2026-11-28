// Read-only smoke check of the two deployed copies: load the sign-in page, no sign-in, no changes.
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const SITES = [['GitHub Pages', 'https://ajaykreigns.github.io/My-HRMS/'], ['Cloudflare', 'https://my-hrms.akinwork05.workers.dev/']];
(async () => {
  const browser = await chromium.launch();
  for (const [name, url] of SITES) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errs = [], bad = [];
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120)));
    page.on('pageerror', (e) => errs.push('uncaught: ' + e.message.slice(0, 120)));
    page.on('response', (r) => r.status() >= 400 && bad.push(r.status() + ' ' + r.url().slice(0, 100)));
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'load' }).catch((e) => ({ status: () => 'ERR ' + e.message.slice(0, 80) }));
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 90).replace(/\n/g, ' | '), imgs: [...document.querySelectorAll('img')].filter((i) => i.alt).map((i) => i.alt + ':' + (i.naturalWidth > 0)).join(', ') })).catch(() => ({}));
    const hdr = resp.headers ? await resp.allHeaders() : {};
    console.log(`${name} :: HTTP ${resp.status()} in ${Date.now() - t0} ms | title="${info.title}" | images ${info.imgs}\n   text: ${info.text}\n   console errors: ${errs.length ? errs.join(' || ') : 'none'} | failed requests: ${bad.length ? bad.join(' || ') : 'none'}\n   security headers: csp=${!!hdr['content-security-policy']} hsts=${!!hdr['strict-transport-security']} xcto=${hdr['x-content-type-options'] || 'no'} frame=${hdr['x-frame-options'] || 'no'} refpol=${hdr['referrer-policy'] || 'no'} | encoding=${hdr['content-encoding'] || 'none'}`);
    await page.close();
  }
  await browser.close();
})();
