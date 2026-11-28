// Downloads the October payslip PDF of the demo admin through the real UI and prints the password the app uses.
// Usage: node get-payslip.cjs <label>   -> writes out-<label>.pdf next to this script. Read only.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('C:/Users/0635/Desktop/HRMS/app/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:5199';
(async () => {
  const label = process.argv[2] || 'x';
  const out = path.join(__dirname, `out-${label}.pdf`);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })).newPage();
  await page.goto(BASE + '/');
  await page.getByLabel('Email').fill('admin@ifluids.com');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#\/home/);
  await page.goto(`${BASE}/#/finances/summary`);
  await page.locator('button, a, [role=tab]').filter({ hasText: /^Payslips$/ }).first().click();
  await page.locator('button, a').filter({ hasText: /^View$/ }).first().click();
  await page.getByText(/^Payslip — /).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF \(password protected\)/ }).click()]);
  await dl.saveAs(out);
  console.log('FILENAME=' + dl.suggestedFilename());
  await browser.close();
  // The password the app builds (employee number + DDMMYYYY of the date of birth), computed from the seed data with the app's own function.
  const { seed } = await import(pathToFileURL('C:/Users/0635/Desktop/HRMS/app/src/seed.js').href);
  const { payslipPassword } = await import(pathToFileURL('C:/Users/0635/Desktop/HRMS/app/src/payslipPdf.js').href);
  const db = seed();
  const emp = db.employees.find((e) => (e.workEmail || '').toLowerCase() === 'admin@ifluids.com');
  console.log('PASSWORD=' + payslipPassword(emp));
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
