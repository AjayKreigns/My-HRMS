// Full-frontend sweep. For each role it signs in, finds every page in the sidebar, opens it, then clicks every tab on it.
// Each view is checked for: a page heading, console errors, failed requests, broken-render text, sideways scrolling and unloaded images.
// Each view is also timed in milliseconds: "settle time" is how long the page keeps changing after the click or the page change.
//
// Run:   npm run test:full          (against the dev server)
//        BASE_URL=http://127.0.0.1:4199 QA_REPORT_DIR=<folder> npx playwright test full-frontend --project=chromium --workers=1
//        (against a production build served by `npx vite preview --port 4199`; use this one for timings, the dev server is slower)
// When QA_REPORT_DIR is set, the timings are written there as JSON and a screenshot of every page is saved.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

const REPORT_DIR = process.env.QA_REPORT_DIR || '';
const BAD_TEXT = ['NaN', 'undefined', '[object', 'Invalid Date'];

function watch(page) {
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text().slice(0, 140)}`));
  page.on('pageerror', (e) => problems.push(`uncaught error: ${e.message.slice(0, 140)}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url().slice(0, 100)}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 100)}`));
  return problems;
}

// Starts a page-wide change counter, so a view's "settle time" is the time from the action to the last change on the page.
async function installSettleClock(page) {
  await page.evaluate(() => {
    if (window.__settleInstalled) return;
    window.__settleInstalled = true;
    window.__lastMut = performance.now();
    new MutationObserver(() => (window.__lastMut = performance.now())).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}
async function settled(page, t0) {
  await page.waitForFunction((t) => window.__lastMut >= t && performance.now() - window.__lastMut > 250, t0, { timeout: 15_000 });
  return Math.round(await page.evaluate((t) => window.__lastMut - t, t0));
}

async function checkView(page, problems, mark, view, results, { screenshot } = {}) {
  const found = [];
  const fresh = problems.slice(mark);
  for (const p of new Set(fresh)) found.push(p);
  const facts = await page.evaluate((bad) => {
    const text = document.body.innerText;
    const imgs = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.alt || i.src.slice(-40));
    return {
      h1: !!document.querySelector('h1'),
      overflowX: document.documentElement.scrollWidth - innerWidth,
      bad: bad.filter((w) => text.includes(w)),
      brokenImages: imgs,
    };
  }, BAD_TEXT);
  if (!facts.h1) found.push('no page heading (h1)');
  if (facts.overflowX > 1) found.push(`page scrolls sideways by ${facts.overflowX}px`);
  if (facts.bad.length) found.push(`broken-render text on the page: ${facts.bad.join(', ')}`);
  if (facts.brokenImages.length) found.push(`images that did not load: ${facts.brokenImages.join(', ')}`);
  if (screenshot && REPORT_DIR) {
    fs.mkdirSync(path.join(REPORT_DIR, 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(REPORT_DIR, 'screenshots', screenshot) });
  }
  results.push({ ...view, problems: found });
  return found;
}

async function sweep(page, role, { withTabs, tag }) {
  const problems = watch(page);
  await signIn(page, role);
  await installSettleClock(page);
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href').slice(2)))]);
  const results = [];
  for (const route of hrefs) {
    let mark = problems.length;
    const t0 = await page.evaluate((r) => ((window.__t0 = performance.now()), (location.hash = `#/${r}`), window.__t0), route);
    let ms;
    try {
      ms = await settled(page, t0);
    } catch {
      ms = -1;
    }
    await checkView(page, problems, mark, { role, route, kind: 'page', ms }, results, { screenshot: `${tag}-${route.replace(/[/?]/g, '_')}.png` });
    if (!withTabs) continue;
    const labels = await page.locator('[role="tab"]').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()).filter(Boolean));
    for (const label of [...new Set(labels)]) {
      const tab = page.locator('[role="tab"]').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
      if (!(await tab.count()) || !(await tab.isVisible())) continue;
      if ((await tab.getAttribute('aria-selected')) === 'true') continue; // already open: a click changes nothing, so there is nothing to time
      mark = problems.length;
      const t1 = await page.evaluate(() => ((window.__t0 = performance.now()), window.__t0));
      await tab.click();
      let ms2;
      try {
        ms2 = await settled(page, t1);
      } catch {
        ms2 = -1;
      }
      await checkView(page, problems, mark, { role, route, kind: 'tab', tab: label, ms: ms2 }, results);
    }
  }
  if (REPORT_DIR) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `timings-${tag}-${test.info().project.name}.json`), JSON.stringify(results, null, 2));
  }
  return results;
}

const flat = (results) => results.filter((r) => r.problems.length).map((r) => `${r.role} ${r.kind === 'tab' ? `${r.route} > ${r.tab}` : r.route}: ${r.problems.join('; ')}`);

for (const role of ['admin', 'manager', 'employee']) {
  test(`every page and tab works for the ${role} (desktop)`, async ({ page }) => {
    test.setTimeout(test.info().project.name === 'webkit' ? 900_000 : 420_000); // WebKit is slower, so it gets more time
    const results = await sweep(page, role, { withTabs: true, tag: `${role}-desktop` });
    expect(results.length, 'the sidebar showed no pages').toBeGreaterThan(5);
    expect(flat(results)).toEqual([]);
  });
}

test('every page works for the admin on a phone', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 812 });
  // On a phone the sidebar is behind the menu button, so use the routes the desktop sidebar lists.
  const problems = watch(page);
  await signIn(page, 'admin');
  await installSettleClock(page);
  const routes = ['home', 'inbox', 'me/attendance', 'me/leave', 'me/performance', 'me/expenses', 'me/timesheets', 'me/documents', 'me/learning', 'me/helpdesk', 'finances/summary', 'team', 'org/employees', 'org/tree', 'org/engage', 'admin/employees', 'admin/lifecycle', 'admin/hiring', 'admin/payroll', 'admin/leave', 'admin/attendance', 'admin/performance', 'admin/expenses', 'admin/projects', 'admin/assets', 'admin/helpdesk', 'admin/reports', 'admin/settings'];
  const results = [];
  for (const route of routes) {
    const mark = problems.length;
    const t0 = await page.evaluate((r) => ((window.__t0 = performance.now()), (location.hash = `#/${r}`), window.__t0), route);
    let ms;
    try {
      ms = await settled(page, t0);
    } catch {
      ms = -1;
    }
    await checkView(page, problems, mark, { role: 'admin', route, kind: 'page', ms }, results, { screenshot: `admin-phone-${route.replace(/[/?]/g, '_')}.png` });
  }
  if (REPORT_DIR) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `timings-admin-phone-${test.info().project.name}.json`), JSON.stringify(results, null, 2));
  }
  expect(flat(results)).toEqual([]);
});
