import { defineConfig, devices } from '@playwright/test';

// Browser tests for iFe Hive. They start the Vite dev server themselves (port 5199, as in the README).
// Every test gets a fresh browser context, so the app starts from its seed data each time.
const PORT = 5199;
// BASE_URL points the tests at a server that is already running (for example `vite preview`, a production build); no dev server is started then.
const EXTERNAL = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // SLOWMO=500 (milliseconds per action) makes headed runs easy to follow by eye.
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) },
    baseURL: EXTERNAL || `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium is the everyday run (npm run test:e2e). Firefox and WebKit (Safari's engine) run with npm run test:e2e:all.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 720 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: EXTERNAL
    ? undefined
    : {
      command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      },
});
