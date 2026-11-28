import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, greeting, employeeIdOf } from './helpers.js';

test.describe('sign in', () => {
  test('login page shows the iFe Hive and iFluids branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('iFe Hive Login');
    await expect(page.getByText('Login to iFe Hive', { exact: true })).toBeVisible();
    await expect(page.locator('img[alt="iFe Hive"]').first()).toBeVisible();
    // The company logo sits in the footer of the card.
    await expect(page.locator('img[alt="iFluids Engineering"]')).toBeVisible();
  });

  test('a wrong password is rejected and the user stays on the login page', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('admin@ifluids.com');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page.getByText('Login to iFe Hive', { exact: true })).toBeVisible();
  });

  test('the admin demo account lands on Home with no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, 'admin');
    await expect(page).toHaveTitle('iFe Hive');
    await expect(page.getByText(greeting)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('role access', () => {
  test('an employee cannot see or open admin pages', async ({ page }) => {
    await signIn(page, 'employee');
    await expect(page.getByRole('link', { name: 'Manage Employees' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Company Settings' })).toHaveCount(0);

    for (const route of ['admin/payroll', 'admin/employees', 'admin/settings', 'admin/reports']) {
      await page.goto(`/#/${route}`);
      // The employee gets their own Home screen, not the admin page.
      await expect(page.getByText(greeting)).toBeVisible();
      await expect(page.getByText('Manage employees', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Company settings', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Run Payroll' })).toHaveCount(0);
    }
  });
});

test.describe('layout', () => {
  // ISSUE-001. Fails until the topbar label fits on one line at 1280 px.
  test('the topbar "Not clocked in" label stays on one line', async ({ page }) => {
    await signIn(page, 'admin');
    const label = page.locator('span.muted', { hasText: /^Not clocked in$/ }).first();
    await expect(label).toBeVisible();
    const { height, fontSize } = await label.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    }));
    // One line is about 1.2 to 1.6 times the font size. Three lines is about 4 times.
    expect(height).toBeLessThan(fontSize * 2);
  });

  // The legal-entity heading on Payroll must slide under the sticky topbar, not over it.
  for (const [name, size] of [['desktop', { width: 1280, height: 720 }], ['phone', { width: 375, height: 812 }]]) {
    test(`the payroll entity heading scrolls under the topbar (${name})`, async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page, 'admin');
      await page.goto('/#/admin/payroll');
      await expect(page.locator('.pr-entity')).toBeVisible();
      await page.mouse.move(size.width / 2, size.height / 2);
      const overlap = async () =>
        page.evaluate(() => {
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const e = document.querySelector('.pr-entity').getBoundingClientRect();
          const top = Math.max(e.top, bar.top);
          const bottom = Math.min(e.bottom, bar.bottom);
          if (bottom - top < 4) return null;
          const el = document.elementFromPoint(e.left + 10, (top + bottom) / 2);
          return { overlapPx: bottom - top, topbarOnTop: !!el?.closest('.topbar') };
        });
      // Scroll in small steps until the heading reaches the topbar.
      let hit = null;
      for (let i = 0; i < 40 && !hit; i++) {
        await page.mouse.wheel(0, 40);
        await page.waitForTimeout(40);
        hit = await overlap();
      }
      expect(hit, 'the heading never reached the topbar').not.toBeNull();
      expect(hit.topbarOnTop, 'the heading is drawn over the topbar').toBe(true);
    });
  }

  test('the payroll legal entity menu opens above the page content', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/#/admin/payroll');
    await page.getByRole('button', { name: 'Legal entity' }).click();
    const menu = page.getByRole('listbox', { name: 'Legal entity' });
    await expect(menu).toBeVisible();
    const onTop = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest('[role=listbox]');
    });
    expect(onTop, 'something else is drawn over the open menu').toBe(true);
  });

  test('no page scrolls sideways at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'admin');
    for (const route of ['home', 'me/leave', 'finances/summary', 'admin/payroll', 'admin/employees', 'me/attendance', 'inbox']) {
      await page.goto(`/#/${route}`);
      await expect(page.locator('main')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, `horizontal overflow on #/${route}`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('payslip', () => {
  async function openPayslip(page) {
    await page.goto('/#/finances/summary');
    await page.locator('button, a, [role=tab]').filter({ hasText: /^Payslips$/ }).first().click();
    await page.locator('button, a').filter({ hasText: /^View$/ }).first().click();
    await expect(page.getByText(/^Payslip — /)).toBeVisible();
  }
  async function openLatestPayslip(page) {
    await signIn(page, 'admin');
    await openPayslip(page);
  }
  // Simulate data saved by an older version: set the company address and forget the one-time address migration.
  async function saveAddressAsOldVersion(page, address) {
    // The app writes its data to storage on the first change, so clock in to make it save.
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('ifluids-hrms-v1'));
    await page.evaluate((a) => {
      const db = JSON.parse(localStorage.getItem('ifluids-hrms-v1'));
      db.company.address = a;
      db.migrations = db.migrations.filter((m) => m !== 'company-address-1');
      localStorage.setItem('ifluids-hrms-v1', JSON.stringify(db));
    }, address);
    await page.reload();
  }

  test('the payslip shows the iFluids Engineering company logo', async ({ page }) => {
    await openLatestPayslip(page);
    const logo = page.locator('img[alt="iFluids Engineering"]');
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  });

  // ISSUE-002. Fails until the placeholder address is replaced or hidden.
  test('the payslip header has no placeholder address text', async ({ page }) => {
    await openLatestPayslip(page);
    await expect(page.getByText(/Update the registered address/)).toHaveCount(0);
  });

  test('a placeholder address saved by an older version is cleared, without a stray comma', async ({ page }) => {
    await signIn(page, 'admin');
    await saveAddressAsOldVersion(page, 'Update the registered address in Settings');
    await openPayslip(page);
    await expect(page.getByText(/Update the registered address/)).toHaveCount(0);
    await expect(page.getByText(/^, /)).toHaveCount(0);
    await expect(page.getByText('Chennai', { exact: true })).toBeVisible();
  });

  test('downloading a payslip gives a password-protected PDF named with the employee number and month', async ({ page }) => {
    await openLatestPayslip(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF \(password protected\)/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Payslip_IFE\d+_\d{4}-\d{2}\.pdf$/);
    const raw = (await readFile(await download.path())).toString('latin1');
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(raw).toContain('/Encrypt');
  });

  test('an address someone typed is kept and printed on the payslip', async ({ page }) => {
    await signIn(page, 'admin');
    await saveAddressAsOldVersion(page, '12 Anna Salai');
    await openPayslip(page);
    await expect(page.getByText('12 Anna Salai, Chennai', { exact: true })).toBeVisible();
  });
});

// Accessibility. axe-core checks every page against WCAG 2.0 to 2.2 A and AA, and against its best-practice rules.
// For each role the pages come from that role's own sidebar. The Profile page (own profile, and for the admin another person's)
// is scanned on every one of its tabs, and so is the payslip dialog.
// A finding is listed as "page: rule (elements) example selector" so a failure says exactly what to fix.
test.describe('accessibility', () => {
  const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  const BEST_PRACTICE = ['best-practice'];
  const ALL = [...WCAG, ...BEST_PRACTICE];
  const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Wait until every short animation (page and dialog fade-ins) has finished. Scanning mid-fade reads washed-out colours,
  // and Firefox and WebKit are slower than Chromium to finish them. The 24 s photo zoom on the login page is ignored.
  async function settle(page) {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => {
            const t = a.effect && a.effect.getComputedTiming();
            return t && Number.isFinite(t.endTime) && t.endTime <= 3000;
          })
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    await page.waitForTimeout(150);
  }
  async function scan(page, label, tags, out) {
    await settle(page);
    const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
    for (const v of violations) out.push(`${label}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0].target.join(' ')}`);
  }
  async function scanProfile(page, id, label, tags, out) {
    await page.goto(`/#/profile/${id}`);
    await page.locator('h1, h2').first().waitFor();
    await page.waitForTimeout(400);
    await scan(page, label, tags, out);
    const tabs = await page.locator('[role="tab"]').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()).filter(Boolean));
    for (const name of [...new Set(tabs)]) {
      await page.locator('[role="tab"]').filter({ hasText: new RegExp(`^${escapeRegex(name)}$`) }).first().click();
      await scan(page, `${label} > ${name}`, tags, out);
    }
    return tabs.length;
  }
  async function scanEverything(page, tags, { role = 'admin', includeLogin = false } = {}) {
    const found = [];
    if (includeLogin) {
      await page.goto('/');
      await page.getByLabel('Email').waitFor();
      await page.waitForTimeout(1400); // the login card fades in over about 1.1 s
      await scan(page, 'login', tags, found);
    }
    await signIn(page, role);
    const routes = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href').slice(2)))]);
    expect(routes.length, `the ${role}'s sidebar showed no pages`).toBeGreaterThan(5);
    for (const route of routes) {
      await page.goto(`/#/${route}`);
      // A page with no heading is a finding, not a reason to hang: wait a few seconds, record it, and scan anyway.
      const hasHeading = await page.locator('h1').first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      if (!hasHeading) found.push(`${role} ${route}: no page heading (h1)`);
      await page.waitForTimeout(400);
      await scan(page, `${role} ${route}`, tags, found);
    }
    // Profile pages, with every tab. The admin also opens another person's profile.
    expect(await scanProfile(page, employeeIdOf(role), `${role} profile`, tags, found), 'the profile page showed no tabs').toBeGreaterThan(3);
    if (role === 'admin') await scanProfile(page, employeeIdOf('employee'), 'admin viewing another profile', tags, found);
    // The payslip dialog.
    await page.goto('/#/finances/summary');
    await page.locator('button, a, [role=tab]').filter({ hasText: /^Payslips$/ }).first().click();
    const view = page.locator('button, a').filter({ hasText: /^View$/ }).first();
    if (await view.count()) {
      await view.click();
      await page.getByText(/^Payslip — /).waitFor();
      await page.waitForTimeout(900); // let the dialog finish opening before reading its colours
      await scan(page, `${role} payslip dialog`, tags, found);
    }
    return found;
  }

  test('no WCAG A or AA violations on any page (light theme)', async ({ page }) => {
    test.setTimeout(300_000);
    expect(await scanEverything(page, WCAG, { includeLogin: true })).toEqual([]);
  });

  test('no WCAG A or AA violations on any page (dark theme)', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(() => localStorage.setItem('ifluids-hrms-theme', 'dark'));
    expect(await scanEverything(page, WCAG, { includeLogin: true })).toEqual([]);
  });

  test('no best-practice violations on any page (headings, landmarks, table headers)', async ({ page }) => {
    test.setTimeout(300_000);
    expect(await scanEverything(page, BEST_PRACTICE)).toEqual([]);
  });

  test('manager: no accessibility violations on any page, profile tab or dialog (light theme)', async ({ page }) => {
    test.setTimeout(300_000);
    expect(await scanEverything(page, ALL, { role: 'manager' })).toEqual([]);
  });

  test('employee: no accessibility violations on any page, profile tab or dialog (light theme)', async ({ page }) => {
    test.setTimeout(300_000);
    expect(await scanEverything(page, ALL, { role: 'employee' })).toEqual([]);
  });

  test('employee: no WCAG A or AA violations on any page, profile tab or dialog (dark theme)', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(() => localStorage.setItem('ifluids-hrms-theme', 'dark'));
    expect(await scanEverything(page, WCAG, { role: 'employee' })).toEqual([]);
  });
});
