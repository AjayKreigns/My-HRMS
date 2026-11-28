# Scan scripts

The scripts used for the hand-run scans on 2026-11-27, copied here unchanged so they are not lost. They are the starting point for moving the scans into `npm run qa:update` (FIX-PLAN item T3).

| Script | What it does | Needs |
|---|---|---|
| `a11y.cjs` | axe-core scan of 30 pages (WCAG A and AA plus best practice) and a keyboard check on the login page | the dev server on port 5199; axe-core |
| `contrast.cjs` | lists failing colour pairs per theme with their ratios | same |
| `perf.cjs` | page speed on desktop and on a mid-tier phone profile | `npx vite preview --port 4199` serving a fresh build |
| `smoke.cjs` | read-only check of the two live sites (loads, logos, console errors, security headers) | internet |
| `navcost.cjs` | first-visit time per page on the phone profile after the app has sat idle (shows the cost of loading pages on demand and the effect of the idle prefetch) | `vite preview` on port 4199 |
| `whyslow.cjs` | the largest-paint element, request order and main-thread breakdown per page on the phone profile | same |
| `leave-timing.cjs` | why the Leave page takes 1.3 s to stop changing (long tasks, number of page updates) | same |
| `get-payslip.cjs` and `verify.py` | download a payslip PDF through the app and check it with an independent reader (encrypted, password, text, logo) | the dev server; Python with PyMuPDF (`pip install pymupdf`) |

Paths: they still point at the temporary folder where axe-core was installed (`require('./node_modules/axe-core/axe.min.js')`) and use an absolute path to this project's Playwright. `@axe-core/playwright` is now a dev dependency, which installs `axe-core`; when these move into the update script, switch them to `require('axe-core')` and relative paths.
