// Accessibility scan of iFe Hive with axe-core (WCAG 2.0/2.1/2.2 A and AA rules, plus best practices), plus a keyboard check on the login page.
// Read only. Runs against the local dev server with the README demo admin account. Nothing in the repo is touched.
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const AXE = path.join(__dirname, 'node_modules/axe-core/axe.min.js');
const BASE = process.env.BASE || 'http://localhost:5199';

const routes = ['home', 'inbox', 'me/attendance', 'me/leave', 'me/performance', 'me/expenses', 'me/timesheets', 'me/documents', 'me/learning', 'me/helpdesk', 'finances/summary', 'team', 'org/employees', 'org/tree', 'org/engage', 'admin/employees', 'admin/lifecycle', 'admin/hiring', 'admin/payroll', 'admin/leave', 'admin/attendance', 'admin/performance', 'admin/expenses', 'admin/projects', 'admin/assets', 'admin/helpdesk', 'admin/reports', 'admin/settings'];

const found = new Map(); // rule id -> { impact, help, helpUrl, tags, pages:Set, nodes:number, sample }

async function scan(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, nodes: v.nodes.length, sample: { target: v.nodes[0].target.join(' '), html: v.nodes[0].html.slice(0, 160) } }));
  });
  for (const v of res) {
    const e = found.get(v.id) || { impact: v.impact, help: v.help, helpUrl: v.helpUrl, wcag: v.tags.filter((t) => t.startsWith('wcag')).join(','), best: !v.tags.some((t) => t.startsWith('wcag')), pages: new Set(), nodes: 0, sample: v.sample };
    e.pages.add(label);
    e.nodes += v.nodes;
    found.set(v.id, e);
  }
  return res.length;
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const perPage = {};

  // Login page: axe, then keyboard order and visible focus.
  await page.goto(BASE + '/');
  await page.getByLabel('Email').waitFor();
  perPage['login'] = await scan(page, 'login');
  await page.goto(BASE + '/');
  await page.getByLabel('Email').waitFor();
  const kb = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    kb.push(await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return 'body';
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      return `${e.tagName.toLowerCase()} "${(e.innerText || e.getAttribute('aria-label') || e.alt || e.id || '').trim().slice(0, 24)}" focusRing=${ring}`;
    }));
  }

  // Sign in with the README demo admin.
  await page.getByLabel('Email').fill('admin@ifluids.com');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#\/home/);

  for (const r of routes) {
    await page.goto(`${BASE}/#/${r}`);
    await page.waitForTimeout(700);
    perPage[r] = await scan(page, r);
  }
  // Two overlay states: the payslip dialog and the open legal-entity menu.
  await page.goto(`${BASE}/#/finances/summary`);
  await page.locator('button, a, [role=tab]').filter({ hasText: /^Payslips$/ }).first().click();
  await page.locator('button, a').filter({ hasText: /^View$/ }).first().click();
  await page.getByText(/^Payslip — /).waitFor();
  perPage['payslip dialog'] = await scan(page, 'payslip dialog');

  await browser.close();

  const rows = [...found.entries()].map(([id, e]) => ({ id, impact: e.impact, kind: e.best ? 'best-practice' : 'WCAG ' + e.wcag, help: e.help, pages: e.pages.size, nodes: e.nodes, sample: e.sample, helpUrl: e.helpUrl }));
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  rows.sort((a, b) => order[a.impact] - order[b.impact] || b.pages - a.pages);
  fs.writeFileSync(path.join(__dirname, 'a11y-result.json'), JSON.stringify({ perPage, keyboard: kb, rows }, null, 2));
  console.log('PAGES_SCANNED=' + Object.keys(perPage).length);
  console.log('PAGES_WITH_VIOLATIONS=' + Object.values(perPage).filter((n) => n > 0).length);
  console.log('KEYBOARD (first 9 Tab stops on login):'); kb.forEach((k, i) => console.log('  ' + (i + 1) + '. ' + k));
  console.log('RULES_VIOLATED=' + rows.length + '  (WCAG: ' + rows.filter((r) => r.kind !== 'best-practice').length + ', best-practice: ' + rows.filter((r) => r.kind === 'best-practice').length + ')');
  for (const r of rows) console.log(`[${r.impact}] ${r.id} | ${r.kind} | pages=${r.pages} nodes=${r.nodes} | ${r.help}\n     e.g. ${r.sample.target} :: ${r.sample.html.replace(/\s+/g, ' ')}`);
})().catch((e) => { console.error('SCAN FAILED', e); process.exit(1); });
