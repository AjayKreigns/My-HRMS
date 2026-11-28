// Which colour pairs fail WCAG AA contrast, on every page, in light and dark theme. Read only.
const path = require('path');
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const AXE = path.join(__dirname, 'node_modules/axe-core/axe.min.js');
const BASE = process.env.BASE || 'http://localhost:5199';
const routes = ['home', 'inbox', 'me/attendance', 'me/leave', 'me/performance', 'me/expenses', 'me/timesheets', 'me/documents', 'me/learning', 'me/helpdesk', 'finances/summary', 'team', 'org/employees', 'org/tree', 'org/engage', 'admin/employees', 'admin/lifecycle', 'admin/hiring', 'admin/payroll', 'admin/leave', 'admin/attendance', 'admin/performance', 'admin/expenses', 'admin/projects', 'admin/assets', 'admin/helpdesk', 'admin/reports', 'admin/settings'];

async function sweep(theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (theme === 'dark') await ctx.addInitScript(() => localStorage.setItem('ifluids-hrms-theme', 'dark'));
  const page = await ctx.newPage();
  const groups = new Map();
  const scan = async (label) => {
    await page.addScriptTag({ path: AXE });
    const nodes = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] });
      const v = r.violations[0];
      if (!v) return [];
      return v.nodes.map((n) => {
        const d = (n.any[0] && n.any[0].data) || {};
        const el = document.querySelector(n.target[n.target.length - 1]);
        return { fg: d.fgColor, bg: d.bgColor, ratio: d.contrastRatio, need: d.expectedContrastRatio, size: d.fontSize, weight: d.fontWeight, target: n.target.join(' '), cls: el ? (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) : '', text: el ? (el.innerText || '').trim().slice(0, 28) : '' };
      });
    });
    for (const n of nodes) {
      const key = `${n.fg} on ${n.bg}`;
      const g = groups.get(key) || { fg: n.fg, bg: n.bg, ratio: n.ratio, need: n.need, count: 0, pages: new Set(), samples: new Map() };
      g.count++; g.pages.add(label);
      const sk = String(n.cls).split(' ')[0] || n.target.split(' ').pop();
      g.samples.set(sk, (g.samples.get(sk) || 0) + 1);
      if (!g.sampleText) g.sampleText = n.text;
      groups.set(key, g);
    }
  };
  await page.goto(BASE + '/'); await page.getByLabel('Email').waitFor(); await scan('login');
  await page.getByLabel('Email').fill('admin@ifluids.com'); await page.getByLabel('Password').fill('Admin@123'); await page.getByRole('button', { name: 'Login' }).click(); await page.waitForURL(/#\/home/);
  for (const r of routes) { await page.goto(`${BASE}/#/${r}`); await page.locator('main').waitFor(); await page.waitForTimeout(400); await scan(r); }
  await browser.close();
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

(async () => {
  for (const theme of ['light', 'dark']) {
    const g = await sweep(theme);
    console.log(`\n=== ${theme} theme: ${g.reduce((s, x) => s + x.count, 0)} failing elements in ${g.length} colour pairs ===`);
    for (const x of g.slice(0, 45)) {
      const top = [...x.samples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k}(${c})`).join(' ');
      console.log(`${String(x.count).padStart(4)}x  ${x.fg} on ${x.bg}  ratio ${x.ratio} (need ${x.need})  pages=${x.pages.size}  classes: ${top}  e.g. "${x.sampleText}"`);
    }
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
