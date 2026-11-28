# Fix plan

Based on the scans of 2026-11-27 ([details](results/scans/2026-11-27.md), [test register](test-register.md)). Every fix is proved by a test or scan that fails (or is red) before the fix and passes after. After each fix: tick its box, add a line to the progress log at the bottom, run `npm run qa:update:all`, and update `scans-status.json` for any scan that was rerun.

Status: `[ ]` not started, `[~]` in progress, `[x]` done and verified.

## Decisions (2026-11-27)

- D1 Contrast: yes, darken the secondary grey and blue as little as needed.
- D2 Hosting: both sites are temporary previews, so security headers and other hosting-level safety work (F2, F5) wait until the app moves to a real host with a real domain.
- D3 jsPDF: check first. Upgrade only if payslips still open with the same password and layout.
- D4 New dev dependencies: add one only if it is necessary and useful. `@axe-core/playwright` is (it guards the accessibility fixes). ESLint is decided in F6.
- D5 Deploy: after the fixes are done, not before.

## Where we are (updated 2026-11-28, after the Profile fix and phone speed work)

Nothing is committed. Two reports are in `C:\Users\0635\Desktop\HRMS\test-reports\`: `2026-11-28\REPORT.md` (the first full test) and `2026-11-28-after-fixes\` (the sweep after the fixes). No servers are running.

**Completed and verified**
- F1 jsPDF upgrade (2.5.2 to 4.2.1); audit down to 2 issues (both dev tools, deferred).
- The three QA issues, F3 accessibility, and BUG-1 (the Profile page had no `h1`): fixed.
- Accessibility tests now cover all three roles, every Profile tab and the payslip dialog (6 tests).
- F4 phone speed: pages load on demand (main script 648 to 300 kB), login photo as WebP (254 to 85 KB), idle prefetch of the other pages. Phone first paint 2.1 to 2.6 s down to 1.65 to 1.69 s; Home largest paint 2.4 s down to 1.65 s; login 535 KB down to 263 KB.
- Verification on the production build: payroll rules 73 of 73; 20 of 20 browser tests on Chromium, Firefox and WebKit; the full sweep 12 of 12 on all three browsers (645 views, zero problems).

**Open**
- Phone, Payroll opened directly: largest paint 3.7 s (target 2.5 s). Blocked time 0.39 to 0.73 s (target 0.3 s). Both need smaller admin code or fonts, or a different approach; details in `qa/results/scans/2026-11-28.md`.
- SLOW-1 (optional): the Leave page animates for about 1.3 s.
- F6 tooling: decide on ESLint; the slow sweep is now opt-in (`npm run qa:update:full`); tidy `playwright.config.js` indentation; move the scan scripts into the update command (T3).
- F0: commit in three parts and deploy to GitHub Pages and Cloudflare, then recheck the live sites (S-05, S-06).
- F2 (security headers) is deferred until real hosting. F5 (Vite upgrade) was done on 2026-11-28.

**Next, in order** (waiting for the owner's go-ahead)
1. Decide whether to go further on phone speed (Payroll direct load, blocked time) or accept the current numbers.
2. F6, then F0.

## Order at a glance

| # | Fix | Why this order | Size | Risk | Proved by | Status |
|---|---|---|---|---|---|---|
| F1 | Check and, if clean, upgrade jsPDF (critical audit finding) | Only critical item; small and well covered | 45 min | medium: payslip PDF must keep its password | audit, P-073, E-14 | [x] 2026-11-27 |
| F3 | Accessibility (4 WCAG rules, 6 best-practice) | Largest user impact; shared components fix many pages at once | 3 to 4 h | medium: contrast changes the look | S-01, 3 new accessibility tests | [x] 2026-11-28 (follow-up: BUG-1) |
| F4 | Phone performance | Needs a stable base; measure before and after | 2 to 3 h | medium: lazy loading changes page switches | S-04 | [x] 2026-11-28 (round 2 done: Login and Home meet all three targets; Payroll opened directly shows content at 2.1 s but blocked time is 0.44 to 0.60 s, target 0.3 s) |
| F6 | Test tooling gaps | Locks everything above in | 3 h | low | register | [ ] |
| F0 | Commit and deploy everything (moved to the end, D5) | Deploy once, after the fixes | 15 min | low | all tests, S-05 | [x] 2026-11-28 |
| F2 | Security headers on Cloudflare | Waits for real hosting (D2) | 30 min | low | S-06, new E-15 | deferred |
| F5 | Vite and esbuild upgrade (dev tools only) | Dev-only exposure | 45 min | medium | audit, build, all browser tests | [x] 2026-11-28 (Vite 7.3.8; audit 0 issues; all tests pass) |

## F0. Commit and deploy what is already fixed

The three QA issues (topbar label, payslip placeholder address, payroll heading over the topbar), the saved-data migration, the Playwright suite and this folder are all uncommitted.
1. Commit in three parts: the fixes with the migration; the Playwright setup and e2e tests; the `qa/` folder.
2. Push to `main` (deploys GitHub Pages), then deploy Cloudflare with `npx wrangler deploy --assets ./dist --name my-hrms --compatibility-date 2026-11-01` from `app/`.
3. Rerun the read-only live-site check (S-05) and confirm the three fixes are live.

## F1. Upgrade jsPDF (critical)

jsPDF 2.5.2 has 12 advisories (critical: file inclusion, new-window HTML injection). The app uses only `text`, `line`, `rect`, `addImage`, `setFont`, `setFontSize`, `setTextColor`, `setFillColor` and `save`, so the named paths look unreachable, but the fix is still an upgrade to 4.x (a breaking change).
1. Read the 3.x and 4.x release notes for changes to the encryption option, `output('arraybuffer')`, `addImage` and font handling.
2. Write test E-14 first: download a payslip PDF in the browser, check it starts with `%PDF` and contains `/Encrypt`. (This also closes the earlier gap that no browser test covers the PDF.)
3. Upgrade `jspdf`; run P-073 (encrypted payslip PDF), E-14 and the build.
4. A person opens one downloaded payslip with the real password (employee number plus date of birth, e.g. `E10220011990`) to confirm it opens and the layout and logo are right.
5. `npm audit` should list no jspdf or dompurify issue.
Rollback: revert the package change; payslip code is untouched unless the API changed.

## F2. Security headers

Neither live site sends a Content-Security-Policy, X-Content-Type-Options, X-Frame-Options or Referrer-Policy.
1. Add `app/public/_headers` (Cloudflare serves it with the assets): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone and geolocation off, `Strict-Transport-Security`, and a CSP of `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. (`'unsafe-inline'` for styles is needed because the app sets inline styles from React.)
2. Add the same headers to the Vite preview server, then write E-15: load the main pages and a payslip download against the preview and fail on any console message about a blocked resource.
3. Deploy, then rerun S-06.
GitHub Pages cannot send custom headers, so it will stay without them. See decision D2.

## F3. Accessibility

Status: done and verified 2026-11-28 (three accessibility tests pass on all three browsers). Follow-up: BUG-1, the Profile page heading, found by the full sweep.

Tests written first and seen failing, then passing on Chromium: "no WCAG A or AA violations on any page (light theme)", the same for the dark theme, and "no best-practice violations on any page". Each scans 30 pages (login, 28 routes, the payslip dialog).

What was changed:
- Contrast (measured per colour pair, light and dark): `--muted` #64748b to #566579; green badge text #15803d to #157a38; amber badge text #b45309 to #a04c07; payroll `--px-faint` #8a9aa6 to #5d6d82 and `--px-hold` #b86e00 to #92590a; avatar initials background darkened where drawn (`readableBg` in `ui.jsx`, only when a colour is too light); Home "Web clock in" text uses `--brand-dark`. Before and after look the same at a glance.
- Names and roles: sidebar links drop the extra label unless collapsed; progress bar labelled; leave rings `role="img"`; Account menu name is "PR (Priya Raman), account menu"; dropdown name includes its current value; avatars `aria-hidden`.
- Structure: card and dialog titles are `h2`; other skipped headings fixed (`h4` to `h3`, Leave page cards, kanban columns, Engage posts); dialog header is no longer a second banner; empty table headers get hidden text "Actions"; Payroll page has a hidden `h1`; Login has a `main` landmark, an `h1` title and a decorative photo hidden from assistive technology.
- Two timing notes for the tests: the login card fades in over about 1.1 s and the payslip dialog opens with an animation, so the tests wait before scanning (otherwise axe reads washed-out mid-fade colours).

Original plan for reference:


3a. Structural fixes (no visual change):
- Sidebar links (`.nav-item`): the accessible name must contain the visible text. Drop the extra `aria-label` where there is visible text; keep it only when the sidebar is collapsed to icons. (59 elements, 29 pages)
- `.day-bar-track` progress bar: add an accessible name, for example "Hours worked today". (1 page)
- Leave-balance ring (`.lv-ring`, an SVG `<g>` with `aria-label`): give it `role="img"` so the label is allowed. (1 page, 4 elements)
- Headings: card titles are `<h3>` with no `<h2>` above. Change the shared Card title to `<h2>` and keep its look. (18 pages)
- Tables: give the empty header cells for action columns hidden text such as "Actions". (10 pages)
- Login: wrap the form in `<main>`, make the "Login to iFe Hive" title the page's `<h1>`, mark the decorative photo panel `aria-hidden`.
- Find the one page with a duplicate banner landmark (`.topbar` header) and fix it.

3b. Colour contrast (355 elements, every page). This changes how the app looks, so it needs your decision (D1):
1. Collect, per failing element, the text colour, background colour and ratio, and group them by colour pair. This shows how few design tokens are really at fault.
2. Propose the smallest change that reaches 4.5 to 1 for normal text and 3 to 1 for large text, with before and after screenshots of the login page, Home and Payroll in both light and dark themes.
3. Apply after you approve.

3c. Rerun the scan (S-01) and update the register. Zero WCAG A and AA violations is the target.
Not covered by any of this: a screen reader pass on a real device (S-09).

## F4. Phone performance

Status: done 2026-11-28 for the common path; see the results in `results/scans/2026-11-28.md`. Remaining: Payroll opened directly (largest paint 3.7 s) and blocked time (0.39 to 0.73 s). Preparation notes from 2026-11-27:
- `App.jsx` imports every page up front (lines 5 to 16), so Login, Home and Payroll all ship in one 648 kB script. `Payroll.jsx` alone is 168 KB of source, `AdminOps.jsx` 66 KB.
- `Admin.jsx` imports `Payroll`, `AdminOps` and `Hiring`, and `App.jsx` imports `pendingFor` from `Inbox.jsx`. Admin also imports `go` from `App.jsx`, a circular import that lazy loading makes harmless.
- Plan: keep `Login` and the app shell static; load every other page with `React.lazy` inside one `Suspense`; keep `pendingFor` where it can stay static (or move it to a small module) so Inbox does not pull its page into the main script.
- After lazy loading, a page's content appears slightly later, so the accessibility tests should wait for the page's `h1` instead of only `main`.
- Login photo is `src/assets/login-photo.jpg`, 980 x 1268, 254 KB. A WebP size test (quality 60, 70, 78) was about to run and was not run.
- Rerun the speed script before starting (it is in `qa/scans/`) so before and after come from the same script.

Target on the phone profile: first paint at most 1.8 s, largest paint at most 2.5 s, blocking time at most 300 ms (stretch: 200 ms). Today: largest paint 2.5 to 3.5 s, blocking time 0.3 to 1.0 s.
1. Move the scan scripts into `qa/scans/` so before and after numbers come from the same script (F6, T3).
2. Split the single 633 KB script by page with `React.lazy`, so the login page and Home do not load Payroll (a very large file) and the PDF libraries. Keep a plain fallback while a page loads.
3. Login photo: 254 KB JPEG, the heaviest login asset. Resize to about 1280 px wide and save as WebP (target 50 to 80 KB), with explicit width and height.
4. Fonts: preload the font files used on first paint and check `font-display`.
5. Rerun S-03 and S-04. Keep a change only if it moves a number.
Rollback: each step is independent.

## F5. Vite and esbuild

Both are development-time only (the dev server), rated high and moderate. The fix offered is Vite 8.
1. Try the newest Vite together with the matching `@vitejs/plugin-react`.
2. Run the build, `qa:update:all` and a manual look at the dev server.
3. If it breaks, stay on Vite 5 and note the reason here; the dev server only listens on localhost, so the exposure is small.

## F6. Test tooling gaps

| ID | Item | Detail |
|---|---|---|
| T1 | Lint | Add ESLint with the React and hooks rules and an `npm run lint` script. Fix or silence what it finds, one rule at a time. |
| T2 | Accessibility tests in the suite | Add `@axe-core/playwright` as a dev dependency for E-16 (F3). |
| T3 | Scans in the repo | Move the accessibility, speed and live-site scripts into `qa/scans/` and call them from `qa:update`, so `scans-status.json` is generated, not hand-edited. |
| T4 | Run tests before deploy | Add a job to `.github/workflows/pages.yml` that runs the payroll tests, the build and the Chromium browser tests, and blocks the deploy if they fail. |
| T5 | Live smoke after deploy | Run the read-only live-site check after each deploy and fail the workflow if the login page does not load. |
| T6 | Visual comparison | Add screenshot baselines for login, Home, Payroll and the payslip at desktop and phone width. |
| T7 | Firefox load timeouts | `qa:update:all` already uses 3 workers; run browser tests against `vite preview` in CI instead of the dev server. |
| T8 | Real devices and screen reader | A person with NVDA or VoiceOver and a real phone (S-09). Cannot be automated. |

## Decisions needed from you

- **D1 Contrast:** may I darken the secondary grey text and, if needed, the blue of buttons and links slightly to meet the 4.5 to 1 standard? I will show before and after first.
- **D2 Hosting:** which site is the main one? Cloudflare can send security headers; GitHub Pages cannot. If Cloudflare is the main one, GitHub Pages could stay as a mirror without them.
- **D3 jsPDF 4.x:** OK to take the breaking upgrade if the payslip PDF still opens with the same password and layout?
- **D4 New dev dependencies:** OK to add `eslint` and `@axe-core/playwright`?
- **D5 Commit now:** OK to do F0 first (commit and deploy the existing fixes)?

## Done means

`npm audit` shows no critical or high issue; axe shows no WCAG A or AA violation on any route; both live sites send the security headers (GitHub Pages excepted, per D2); the phone profile meets the F4 targets; `npm run qa:update:all` passes on Chromium, Firefox and WebKit; scans-status.json and the register are current.

## Progress log

- 2026-11-27: plan written from the first full round of scans. Nothing fixed yet beyond the three QA issues listed in F0.
- 2026-11-27: F1 done. jsPDF 2.5.2 to 4.2.1. Checked with an independent PDF reader (PyMuPDF) before and after: still encrypted, wrong password rejected, `IFE10112061977` opens it, same text, logo present, same layout. New test E-14 (payslip download). Audit: 4 issues down to 2 (vite high, esbuild moderate, both dev-only and deferred with F5).
- 2026-11-27: decisions D1 to D5 recorded. F2 and F5 deferred until real hosting; F0 (commit and deploy) moved to the end.
- 2026-11-27 (evening): F3 code changes made and the three accessibility tests seen passing on Chromium. A full cross-browser run was started and stopped at the user's request; nothing else was verified, and the register was not refreshed. F4 not started. Details in "Where we stopped".
- 2026-11-28: full cross-browser run found two regressions from the accessibility edits (Leave page sideways scroll on phones; WebKit keyboard focus on the year grid), both fixed; Chromium and WebKit 17/17, Firefox 17/17 on the production build. Full-frontend sweep and report written to `test-reports/2026-11-28/REPORT.md`: one open bug (Profile page heading), one slow page (Leave, animation), no speed regression. F3 ticked. Waiting for the owner's decision on next steps.
- 2026-11-28 (afternoon): BUG-1 fixed (Profile name is now the page `h1`; "Skills" is an `h2`). Accessibility tests extended to manager, employee, every Profile tab and the payslip dialog; all 6 pass on three browsers. F4 done for the common path: pages load on demand, WebP login photo, idle prefetch; font preloading was tried and reverted (it slowed first paint by about 200 ms). Verified on the production build: 20 of 20 browser tests on Chromium, Firefox and WebKit, 73 of 73 payroll checks, full sweep 12 of 12 (645 views, zero problems). Also fixed: the update script's slow-sweep filter (a space split into two arguments on Windows, so no tests ran for one run; it now rejects a zero-test run). Payroll direct-load speed and blocked time remain open.
- 2026-11-28 (deploy, F0): committed in four parts (`b6bdb0b` app fixes, `6f72b1d` dependencies, `8c8bcc2` tests, `f909f1d` QA folder), pushed to `main` (GitHub Pages) and deployed to Cloudflare (version `a7d8a64e`). `qa/scans/live-check.cjs` passes 14 of 14 on both live sites. Security headers (F2) and the Vite upgrade (F5) stay deferred until real hosting. Open: Payroll direct-load speed and blocked time (optional), the Leave animation (optional), F6 tooling.
