import { expect } from '@playwright/test';
import { seed } from '../src/seed.js';

// The demo accounts from the README. All data is fictional seed data.
export const ACCOUNTS = {
  admin: { email: 'admin@ifluids.com', password: 'Admin@123' },
  manager: { email: 'manager@ifluids.com', password: 'Manager@123' },
  employee: { email: 'employee@ifluids.com', password: 'Employee@123' },
};

export async function signIn(page, who) {
  const { email, password } = ACCOUNTS[who];
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/#\/home/);
}

// "Good morning, Priya" changes with the time of day.
export const greeting = /Good (morning|afternoon|evening), /;

// The employee id of a demo account, read from the same seed data the app starts with (for example the id in #/profile/E106).
export function employeeIdOf(role) {
  const emp = seed().employees.find((e) => (e.workEmail || '').toLowerCase() === ACCOUNTS[role].email);
  if (!emp) throw new Error(`no employee in the seed data for the ${role} account`);
  return emp.id;
}
