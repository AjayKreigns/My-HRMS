// The code of each page that is loaded when it is first opened (see App.jsx). vite.config.js knows the same pages, for the preload hint.
export const loaders = {
  home: () => import('./pages/Home.jsx'),
  timeOff: () => import('./pages/TimeOff.jsx'),
  performance: () => import('./pages/Performance.jsx'),
  requests: () => import('./pages/Requests.jsx'),
  timesheets: () => import('./pages/Timesheets.jsx'),
  profile: () => import('./pages/Profile.jsx'),
  team: () => import('./pages/Team.jsx'),
  finances: () => import('./pages/Finances.jsx'),
  org: () => import('./pages/Org.jsx'),
  admin: () => import('./pages/Admin.jsx'),
  payroll: () => import('./pages/Payroll.jsx'), // opened straight from the sidebar, without the rest of the admin tools
  adminOps: () => import('./pages/AdminOps.jsx'),
  hiring: () => import('./pages/Hiring.jsx'),
};
