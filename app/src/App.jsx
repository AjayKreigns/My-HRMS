import { useEffect, useMemo, useRef, useState } from 'react';
import { useDB, currentUser, setSession, update, getSessionId } from './store.js';
import { Icon, Avatar, Toasts, toast, FormModal } from './ui.jsx';
import { fullName, todayISO, minutesBetween, hm, pad } from './utils.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import { Attendance, Leave } from './pages/TimeOff.jsx';
import Performance from './pages/Performance.jsx';
import { Expenses, Helpdesk, Documents, Learning } from './pages/Requests.jsx';
import Timesheets from './pages/Timesheets.jsx';
import Profile from './pages/Profile.jsx';
import Inbox, { pendingFor } from './pages/Inbox.jsx';
import Team from './pages/Team.jsx';
import Finances from './pages/Finances.jsx';
import { Directory, OrgTree, Engage } from './pages/Org.jsx';
import Admin from './pages/Admin.jsx';
import logo from './assets/ifluids-logo.png';

export function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const f = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
}

export const go = (path) => {
  window.location.hash = `#/${path.replace(/^\//, '')}`;
};

function nav(user) {
  const admin = user.role === 'admin';
  const manager = admin || user.role === 'manager';
  const groups = [
    { items: [{ to: 'home', label: 'Home', icon: 'home' }, { to: 'inbox', label: 'Inbox', icon: 'inbox', count: true }] },
    {
      title: 'Me',
      items: [
        { to: 'me/attendance', label: 'Attendance', icon: 'clock' },
        { to: 'me/leave', label: 'Leave', icon: 'calendar' },
        { to: 'me/performance', label: 'Performance', icon: 'target' },
        { to: 'me/expenses', label: 'Expenses & Travel', icon: 'plane' },
        { to: 'me/timesheets', label: 'Timesheets', icon: 'timer' },
        { to: 'me/documents', label: 'Documents', icon: 'file' },
        { to: 'me/learning', label: 'Learning', icon: 'book' },
        { to: 'me/helpdesk', label: 'Helpdesk', icon: 'help' },
      ],
    },
    {
      title: 'Finances',
      items: [{ to: 'finances/summary', label: 'My Finances', icon: 'wallet' }],
    },
    {
      title: 'Organisation',
      items: [
        ...(manager ? [{ to: 'team', label: 'My Team', icon: 'team' }] : []),
        { to: 'org/employees', label: 'Employees', icon: 'user' },
        { to: 'org/tree', label: 'Org Chart', icon: 'org' },
        { to: 'org/engage', label: 'Engage', icon: 'megaphone' },
      ],
    },
  ];
  if (admin) {
    groups.push({
      title: 'Admin',
      items: [
        { to: 'admin/employees', label: 'Manage Employees', icon: 'user' },
        { to: 'admin/lifecycle', label: 'Onboarding & Exit', icon: 'briefcase' },
        { to: 'admin/hiring', label: 'Hiring', icon: 'hire' },
        { to: 'admin/payroll', label: 'Payroll', icon: 'money' },
        { to: 'admin/leave', label: 'Leave Settings', icon: 'calendar' },
        { to: 'admin/attendance', label: 'Attendance Settings', icon: 'clock' },
        { to: 'admin/performance', label: 'Performance', icon: 'award' },
        { to: 'admin/expenses', label: 'Expenses & Claims', icon: 'plane' },
        { to: 'admin/projects', label: 'Projects & Clients', icon: 'briefcase' },
        { to: 'admin/assets', label: 'Assets', icon: 'laptop' },
        { to: 'admin/helpdesk', label: 'Helpdesk Tickets', icon: 'help' },
        { to: 'admin/reports', label: 'Reports', icon: 'chart' },
        { to: 'admin/settings', label: 'Company Settings', icon: 'settings' },
      ],
    });
  }
  return groups;
}

// Clock in / out from anywhere; writes today's attendance record.
export function useClock(user) {
  const db = useDB();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const today = todayISO();
  const rec = db.attendance.find((a) => a.empId === user.id && a.date === today);
  const now = new Date();
  const nowT = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const clockedIn = !!rec?.clockIn && !rec?.clockOut;
  const worked = rec?.clockIn ? minutesBetween(rec.clockIn, rec.clockOut || nowT) : 0;
  const secs = rec?.clockIn && !rec.clockOut ? now.getSeconds() : 0;
  const toggle = (wfh = false) => {
    update((d) => {
      const r = d.attendance.find((a) => a.empId === user.id && a.date === today);
      if (!r) d.attendance.push({ id: `att_${user.id}_${today}`, empId: user.id, date: today, clockIn: nowT, clockOut: '', wfh, source: 'Web', sessions: [{ in: nowT }] });
      else if (!r.clockOut) {
        r.clockOut = nowT;
        r.sessions = (r.sessions || []).map((s) => (s.out ? s : { ...s, out: nowT }));
      } else {
        r.clockOut = '';
        r.sessions = [...(r.sessions || []), { in: nowT }];
      }
    });
    toast(clockedIn ? 'Clocked out' : 'Clocked in');
  };
  return { rec, clockedIn, worked, label: `${hm(worked)}${clockedIn ? ` ${pad(secs)}s` : ''}`, toggle };
}

const ACTIONS = [
  { label: 'Apply Leave', to: 'me/leave' },
  { label: 'Regularise Attendance', to: 'me/attendance' },
  { label: 'Submit Expense', to: 'me/expenses' },
  { label: 'View Payslips', to: 'finances/payslips' },
  { label: 'Declare Investments', to: 'finances/tax' },
  { label: 'Raise Helpdesk Ticket', to: 'me/helpdesk' },
  { label: 'Run Payroll', to: 'admin/payroll/run', admin: true },
  { label: 'Payroll Analytics', to: 'admin/payroll/analytics', admin: true },
  { label: 'Add Employee', to: 'admin/employees', admin: true },
];

function GlobalSearch({ user }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const ref = useRef(null);
  // Alt+K jumps to search from anywhere.
  useEffect(() => {
    const k = (e) => {
      if (e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return db.employees.filter((e) => [fullName(e), e.empNo, e.workEmail, e.designation, e.department].join(' ').toLowerCase().includes(s)).slice(0, 8);
  }, [q, db.employees]);
  const actions = q.trim() ? ACTIONS.filter((a) => (!a.admin || user.role === 'admin') && a.label.toLowerCase().includes(q.trim().toLowerCase())) : [];
  return (
    <div className="global-search">
      <div className="searchbox">
        <Icon name="search" size={16} />
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees or actions (Ex: Apply Leave)" aria-label="Search employees or actions" onBlur={() => setTimeout(() => setQ(''), 200)} />
        <span className="kbd hide-sm">Alt + K</span>
      </div>
      {results.length + actions.length > 0 && (
        <div className="results">
          {actions.map((a) => (
            <div key={a.to} className="result" onMouseDown={() => go(a.to)}>
              <Icon name="chevronRight" size={14} /> {a.label}
            </div>
          ))}
          {results.map((e) => (
            <div key={e.id} className="result" onMouseDown={() => go(`profile/${e.id}`)}>
              <span className="emp-chip">
                <Avatar emp={e} size={28} />
                <span>
                  <span className="emp-chip-name">{fullName(e)}</span>
                  <span className="emp-chip-sub">
                    {e.designation} · {e.department}
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const THEME_KEY = 'ifluids-hrms-theme';

function Shell({ user, route }) {
  const db = useDB();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [pw, setPw] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const switchTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  };
  const clock = useClock(user);
  const path = route.join('/');
  const groups = nav(user);
  const pending = pendingFor(db, user).length;
  const notes = db.notifications.filter((n) => n.empId === user.id);
  const unread = notes.filter((n) => !n.read).length;

  useEffect(() => {
    setOpen(false);
    setMenu(null);
  }, [path]);

  const [section, sub, extra] = route;
  let page;
  switch (section) {
    case 'home':
      page = <Home user={user} />;
      break;
    case 'inbox':
      page = <Inbox user={user} />;
      break;
    case 'me':
      page =
        {
          attendance: <Attendance user={user} />,
          leave: <Leave user={user} />,
          performance: <Performance user={user} />,
          expenses: <Expenses user={user} />,
          timesheets: <Timesheets user={user} />,
          documents: <Documents user={user} />,
          learning: <Learning user={user} />,
          helpdesk: <Helpdesk user={user} />,
        }[sub] || <Home user={user} />;
      break;
    case 'profile':
      page = <Profile user={user} empId={sub || user.id} tab={extra} />;
      break;
    case 'team':
      page = <Team user={user} />;
      break;
    case 'finances':
      page = <Finances user={user} tab={sub || 'summary'} />;
      break;
    case 'org':
      page = sub === 'tree' ? <OrgTree user={user} /> : sub === 'engage' ? <Engage user={user} /> : <Directory user={user} />;
      break;
    case 'admin':
      page = user.role === 'admin' ? <Admin user={user} section={sub || 'employees'} tab={extra} /> : <Home user={user} />;
      break;
    default:
      page = <Home user={user} />;
  }

  const isActive = (to) => path === to || path.startsWith(to + '/') || (to === 'finances/summary' && section === 'finances');

  return (
    <div className={`shell theme-${theme}`}>
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="side-brand">
          <img src={logo} alt="iFluids Engineering" />
          <span>HRMS</span>
        </div>
        <nav className="side-nav">
          {groups.map((g, i) => (
            <div key={i} className="nav-group">
              {g.title && <div className="nav-group-title">{g.title}</div>}
              {g.items.map((it) => (
                <a key={it.to} href={`#/${it.to}`} className={`nav-item ${isActive(it.to) ? 'active' : ''}`}>
                  <Icon name={it.icon} size={17} />
                  {it.label}
                  {it.count && pending > 0 && <span className="count">{pending}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="topbar-company hide-md">{db.company.name}</span>
          <GlobalSearch user={user} />
          <div className="grow hide-sm" />
          <div className="clock-pill hide-sm">
            <span className="muted hide-md">{clock.rec?.clockIn ? clock.label : 'Not clocked in'}</span>
            <button className={`btn btn-sm ${clock.clockedIn ? 'btn-danger' : 'btn-primary'}`} onClick={() => clock.toggle()}>
              <Icon name="clock" size={14} />
              {clock.clockedIn ? 'Clock out' : 'Clock in'}
            </button>
          </div>
          <div className="dropdown">
            <button className="icon-btn" aria-label="Notifications" onClick={() => setMenu(menu === 'n' ? null : 'n')}>
              <Icon name="bell" />
              {unread > 0 && <span className="dot">{unread}</span>}
            </button>
            {menu === 'n' && (
              <div className="dropdown-menu" style={{ width: 320, maxHeight: 400, overflow: 'auto', padding: 0 }}>
                <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                  <strong>Notifications</strong>
                  {unread > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => update((d) => d.notifications.forEach((n) => n.empId === user.id && (n.read = true)))}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notes.length === 0 && <p className="muted" style={{ padding: 14 }}>You're all caught up.</p>}
                {notes.slice(0, 30).map((n) => (
                  <div
                    key={n.id}
                    className={`notif ${n.read ? '' : 'unread'}`}
                    onClick={() => {
                      update((d) => {
                        const x = d.notifications.find((y) => y.id === n.id);
                        if (x) x.read = true;
                      });
                      if (n.link) go(n.link);
                      setMenu(null);
                    }}
                  >
                    {n.text}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {new Date(n.date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="dropdown hide-sm">
            <button className="icon-btn" aria-label="Quick actions" onClick={() => setMenu(menu === 'q' ? null : 'q')}>
              <Icon name="rocket" />
            </button>
            {menu === 'q' && (
              <div className="dropdown-menu">
                {ACTIONS.filter((a) => !a.admin || user.role === 'admin').map((a) => (
                  <a key={a.to} className="menu-item" href={`#/${a.to}`}>
                    {a.label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <a className="icon-btn hide-sm" href={user.role === 'admin' ? '#/admin/settings' : `#/profile/${user.id}`} aria-label="Settings">
            <Icon name="settings" />
          </a>
          <a className="icon-btn hide-sm" href="#/me/helpdesk" aria-label="Help">
            <Icon name="help" />
          </a>
          <span className="topbar-sep hide-sm" />
          <div className="dropdown">
            <button className="icon-btn" style={{ width: 'auto' }} onClick={() => setMenu(menu === 'u' ? null : 'u')} aria-label="Account menu">
              <Avatar emp={user} size={32} />
            </button>
            {menu === 'u' && (
              <div className="dropdown-menu">
                <div style={{ padding: '8px 14px 10px', borderBottom: '1px solid var(--line-soft)' }}>
                  <strong>{fullName(user)}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {user.workEmail}
                  </div>
                </div>
                <a className="menu-item" href={`#/profile/${user.id}`}>
                  <Icon name="user" size={16} /> My profile
                </a>
                <button className="menu-item" onClick={() => (setPw(true), setMenu(null))}>
                  <Icon name="key" size={16} /> Change password
                </button>
                <button className="menu-item" onClick={() => (switchTheme(), setMenu(null))}>
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setSession(null);
                    go('');
                  }}
                >
                  <Icon name="logout" size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </header>
        <main key={`${section}/${section === 'admin' && sub === 'payroll' ? 'payroll' : sub || ''}`} className={`content ${section === 'admin' && sub === 'payroll' ? 'content-flush' : 'page-enter'}`}>
          {page}
        </main>
      </div>
      {pw && (
        <FormModal
          title="Change password"
          fields={[
            { key: 'current', label: 'Current password', type: 'password', required: true, full: true },
            { key: 'next', label: 'New password', type: 'password', required: true, full: true, help: 'At least 8 characters with a number.' },
            { key: 'confirm', label: 'Confirm new password', type: 'password', required: true, full: true },
          ]}
          validate={(v) => (v.current !== user.password ? 'Your current password is wrong.' : v.next.length < 8 || !/\d/.test(v.next) ? 'The new password needs at least 8 characters and a number.' : v.next !== v.confirm ? 'The new passwords do not match.' : '')}
          onClose={() => setPw(false)}
          onSave={(v) => {
            update((d) => {
              d.employees.find((e) => e.id === user.id).password = v.next;
            });
            setPw(false);
            toast('Password changed');
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  const route = useHash();
  const db = useDB();
  const user = getSessionId() ? currentUser(db) : null;
  useEffect(() => {
    document.title = user ? 'iFluids HRMS' : 'iFluids HRMS Login';
  }, [user]);
  let view;
  if (!user) view = <Login mode={route[0] === 'forgot-password' ? 'forgot' : 'login'} />;
  else view = <Shell user={user} route={route.length && route[0] !== 'forgot-password' ? route : ['home']} />;
  return (
    <>
      {view}
      <Toasts />
    </>
  );
}
