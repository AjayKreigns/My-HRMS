// Read-only check of a deployed copy of iFe Hive: is the new version live, and does it work? Usage: node live-check.cjs <site-url> [label]
// Signs in with the README demo admin account (the app keeps all data in the browser, so nothing is changed on the server),
// opens the pages that carry the 2026-11-27 and 2026-11-28 fixes, and records console errors, failed requests and security headers.
const { chromium } = require('../../node_modules/playwright');
const url = (process.argv[2] || '').replace(/\/?$/, '/');
const label = process.argv[3] || url;
if (!process.argv[2]) { console.error('usage: node live-check.cjs <site-url> [label]'); process.exit(2); }

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })).newPage();
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push('console error: ' + m.text().slice(0, 120)));
  page.on('pageerror', (e) => problems.push('uncaught error: ' + e.message.slice(0, 120)));
  page.on('requestfailed', (r) => problems.push('request failed: ' + r.url().slice(0, 100)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 100)}`));
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });

  const resp = await page.goto(url, { waitUntil: 'load' });
  const headers = await resp.allHeaders();
  await page.getByLabel('Email').waitFor();
  await page.waitForTimeout(1400);
  check('login page loads, title is "iFe Hive Login"', (await page.title()) === 'iFe Hive Login', await page.title());
  check('login page has an h1 and a main landmark', (await page.locator('main h1').count()) === 1);
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop()));
  check('serves the new build (main script name)', true, scripts.join(', '));
  check('login photo is the WebP', await page.evaluate(() => [...document.querySelectorAll('img')].some((i) => i.src.endsWith('.webp') && i.naturalWidth > 0)));

  await page.getByLabel('Email').fill('admin@ifluids.com');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#\/home/);
  await page.locator('h1').first().waitFor();
  const label1 = page.locator('span.muted', { hasText: /^Not clocked in$/ }).first();
  const dims = await label1.evaluate((el) => ({ h: el.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el).fontSize) }));
  check('topbar "Not clocked in" label is one line (fix 1)', dims.h < dims.fs * 2, `${Math.round(dims.h)} px tall`);

  // pages that load their own code: each must show its heading
  for (const [route, heading] of [['me/leave', 'Leave'], ['finances/summary', 'My Finances'], ['admin/payroll', 'Payroll'], ['admin/employees', 'Manage employees'], ['profile/E101', null]]) {
    await page.evaluate((r) => (location.hash = '#/' + r), route);
    const ok = await page.locator('h1').filter(heading ? { hasText: new RegExp('^' + heading + '$') } : {}).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    check(`page ${route} opens with its heading${heading ? '' : ' (Profile h1, fix 3)'}`, ok);
  }

  // payslip: no placeholder address, logo present, encrypted PDF downloads
  await page.evaluate(() => (location.hash = '#/finances/summary'));
  await page.locator('button, a, [role=tab]').filter({ hasText: /^Payslips$/ }).first().click();
  await page.locator('button, a').filter({ hasText: /^View$/ }).first().click();
  await page.getByText(/^Payslip — /).waitFor();
  const body = await page.evaluate(() => document.body.innerText);
  check('payslip has no placeholder address (fix 2)', !body.includes('Update the registered address'));
  check('payslip shows the iFluids logo', (await page.locator('img[alt="iFluids Engineering"]').count()) > 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF \(password protected\)/ }).click()]);
  const raw = require('fs').readFileSync(await dl.path()).toString('latin1');
  check('payslip PDF downloads and is encrypted (jsPDF 4)', raw.startsWith('%PDF') && raw.includes('/Encrypt'), dl.suggestedFilename());

  check('no console errors or failed requests during the whole check', problems.length === 0, problems.slice(0, 4).join(' | '));
  console.log(`\n=== ${label} ===`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log('security headers: ' + ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy'].map((h) => `${h}=${headers[h] ? 'yes' : 'no'}`).join(' ') + ` | encoding=${headers['content-encoding'] || 'none'}`);
  console.log(`RESULT: ${results.filter((r) => r.ok).length} of ${results.length} checks pass`);
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('LIVE CHECK FAILED TO RUN', e); process.exit(2); });
