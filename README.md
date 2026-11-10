# iFluids HRMS

HR, payroll and time management for iFluids Engineering. A React 18 + Vite single-page app that keeps its data in the browser (localStorage), so it needs no server.

**Live preview:** https://ajaykreigns.github.io/My-HRMS/
**Design system:** https://ajaykreigns.github.io/My-HRMS/design-system/

## Demo logins

| Role | Email | Password |
|---|---|---|
| Admin | admin@ifluids.com | Admin@123 |
| Manager | manager@ifluids.com | Manager@123 |
| Employee | employee@ifluids.com | Employee@123 |

All people and figures are fictional sample data. "Company Settings > Data & backup" resets or restores it.

## Run locally

```bash
cd app
npm install
npm run dev -- --port 5199
```

Build for production with `npm run build` (output in `app/dist`).

## Modules

Home, Inbox, Attendance, Leave, Performance, Expenses & Travel, Timesheets, Documents, Learning, Helpdesk, My Finances (payslips, tax, loans, claims), Org (directory, chart, Engage), and Admin (employees, onboarding and exit, hiring, leave and attendance settings, performance, expenses, projects, assets, helpdesk, reports, payroll, company settings).

## Notes

Roles are enforced in the browser only and passwords are stored in plain text in localStorage. This is a demo; add a backend and hashed passwords before using real HR data.

Every push to `main` builds the app and publishes it to GitHub Pages (`.github/workflows/pages.yml`). In the repo, set Settings > Pages > Source to **GitHub Actions** once.
