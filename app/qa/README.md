# QA folder

Where the project's test results and the plan for fixing what they found are kept.

| File | What it is |
|---|---|
| [test-register.md](test-register.md) | Every automated test by name with its latest result per browser, the build and audit status, and the scans run by hand. Generated; do not edit by hand. |
| [FIX-PLAN.md](FIX-PLAN.md) | The ordered plan for fixing what the tests and scans found, with status boxes and a progress log. |
| [results/history.md](results/history.md) | One row per test run, newest last, so you can see when something broke. |
| [results/latest.json](results/latest.json) | The full data of the latest run (every test, duration, error). |
| [results/scans/](results/scans) | Dated write-ups of scans that are not part of the automatic run (accessibility, speed, live sites, dependencies). |
| [scans-status.json](scans-status.json) | The list of hand-run scans shown in the register. Edit this after rerunning a scan. |
| [update-results.mjs](update-results.mjs) | The script that runs the tests and writes the files above. |
| [scans/](scans) | The scripts behind the hand-run scans (accessibility, colour contrast, speed, live sites, payslip PDF check), with a README. |

## Keeping it up to date

Run from the `app/` folder:

- `npm run qa:update` runs everything on Chromium (about 1 minute).
- `npm run qa:update:all` also runs Firefox and WebKit (about 3 minutes).

Each run runs the payroll rules (`node tests/payroll.test.mjs`), the browser tests (`e2e/ife-hive.spec.js`), the production build and `npm audit`, then rewrites the register and latest.json and adds a row to history.md. It exits with an error if the payroll rules, the browser tests or the build fail. A browser that was not run keeps its earlier result, marked with `*`.

After a scan is rerun by hand, edit its entry in `scans-status.json` (date, result, summary) and add a dated write-up in `results/scans/`. Then run `qa:update` once so the register picks it up.

Test IDs (E-01, P-001) follow the order of the tests in their files, so they shift if a test is added in the middle. Refer to a test by its name when it matters.

Other ways to run the browser tests: `npm run test:e2e` (Chromium), `npm run test:e2e:headed` (a visible browser window), `npm run test:e2e:ui` (Playwright's own window with step-by-step replay), `npm run test:e2e:all` (three browsers).
