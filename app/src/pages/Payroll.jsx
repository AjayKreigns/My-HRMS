// Payroll module laid out like the company's own payroll screens: module tabs,
// analytics, the run-payroll cycle with its six input steps, admin, approvals,
// loans, benefits, reports and settings.
import { useEffect, useMemo, useState } from 'react';
import { useDB, addItem, patchItem, removeItem, update, uid, notify } from '../store.js';
import { Icon, Btn, Badge, DataTable, FormModal, EmpChip, Crud, Modal, FormGrid, toast, confirmAction, exportCSV } from '../ui.jsx';
import { PayslipView, DECLARATION_FIELDS } from './Finances.jsx';
import { ApproveButtons, empCol } from './AdminOps.jsx';
import { empById, fullName, fmtDate, money, monthLabel, payslipFor, ymOf, addMonths, addDays, todayISO, declarationTotal, cycleRange, cycleDays, payrollPeople, salaryBreakup, MONTHS, pad } from '../utils.js';
import '../payroll.css';

// ---------- helpers ----------
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
const PALETTE = ['#0f766e', '#2dd4bf', '#3b82f6', '#f26b5b', '#f5a524', '#8b5cf6', '#0ea5e9', '#64748b', '#ec4899', '#84cc16'];
const inr = (n) => `INR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const monOf = (ym) => MON[Number(ym.slice(5)) - 1];
const shortMonth = (ym) => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
const dayMon = (d) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const monDay = (d) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
const fyStart = (ym) => {
  const y = Number(ym.slice(0, 4));
  return `${Number(ym.slice(5)) >= 4 ? y : y - 1}-04`;
};
const fyName = (start) => `Financial Year ${start.slice(0, 4)} - ${Number(start.slice(0, 4)) + 1}`;
const isDone = (run) => !!run && ['Finalized', 'Paid'].includes(run.status);
const sumOf = (rows, f) => rows.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const stamp = (at) => {
  if (!at) return '';
  const d = new Date(at);
  const h = d.getHours();
  return `${fmtDate(at.slice(0, 10))} ${pad(((h + 11) % 12) + 1)}:${pad(d.getMinutes())} ${h >= 12 ? 'pm' : 'am'}`;
};
const shortName = (e) => (e ? `${e.firstName} ${e.lastName ? e.lastName[0] : ''}`.trim() : '—');

// First month whose payroll is not locked yet.
export function currentPayMonth(db) {
  const done = db.payrollRuns.filter(isDone).map((r) => r.month).sort();
  return done.length ? addMonths(done[done.length - 1], 1) : ymOf();
}

function monthTotals(db, ym) {
  const people = payrollPeople(db, ym);
  const slips = people.map((e) => payslipFor(db, e, ym));
  const deposit = sumOf(slips, (x) => x.net);
  const deductions = sumOf(slips, (x) => x.totalDed);
  const contributions = sumOf(slips, (x) => x.employer.reduce((t, [, v]) => t + v, 0));
  return { people, slips, deposit, deductions, contributions, gross: deposit + deductions, cost: deposit + deductions + contributions };
}

function payrollErrors(people, slips) {
  const out = [];
  people.forEach((e) => {
    if (!Number(e.ctc)) out.push({ emp: e, text: 'No salary has been assigned.' });
    if (!e.bank?.accountNumber || !e.bank?.ifsc) out.push({ emp: e, text: 'Bank account number or IFSC is missing.' });
    if (!e.pan) out.push({ emp: e, text: 'PAN is missing, so tax must be deducted at the higher rate.' });
  });
  slips.forEach((x) => x.net < 0 && out.push({ emp: x.emp, text: 'Deductions are more than earnings (net pay is negative).' }));
  return out;
}

function touchRun(d, ym) {
  let r = d.payrollRuns.find((x) => x.month === ym);
  if (!r) {
    r = { id: uid('run'), month: ym, status: 'Draft', steps: {} };
    d.payrollRuns.push(r);
  }
  r.steps = r.steps || {};
  return r;
}
function logActivity(d, ym, user, text) {
  d.payrollActivity = d.payrollActivity || [];
  d.payrollActivity.unshift({ id: uid('pa'), month: ym, at: new Date().toISOString(), by: user.id, text });
}
// Any change to inputs after processing means payroll must be processed again.
function inputsChanged(ym, user, text) {
  update((d) => {
    const r = touchRun(d, ym);
    if (r.processedAt) r.dirty = true;
    logActivity(d, ym, user, text);
  });
}

function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => setR(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
const goto = (p) => {
  window.location.hash = `#/admin/payroll/${p}`;
};

const MODULES = [
  { key: 'analytics', label: 'Payroll Analytics' },
  { key: 'run', label: 'Run Payroll' },
  { key: 'admin', label: 'Payroll Admin' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'loans', label: 'Loans' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];
const SUBS = {
  analytics: [
    ['overview', 'Analytics'],
    ['planning', 'Compensation Planning'],
    ['budget', 'Budget Estimation'],
    ['compare', 'Compare Compensation Cost'],
    ['competitiveness', 'Employee Competitiveness'],
    ['geo', 'Geographical Differentials'],
  ],
  admin: [
    ['history', 'Payroll History'],
    ['salaries', 'Employee Salaries'],
    ['payslips', 'Payslips'],
    ['statutory', 'Statutory Filings'],
    ['tax', 'Tax Declarations'],
    ['revisions', 'Salary Revisions'],
  ],
  approvals: [
    ['loans', 'Loans'],
    ['claims', 'Reimbursement Claims'],
    ['advances', 'Advances'],
    ['revisions', 'Salary Revisions'],
    ['proofs', 'Investment Proofs'],
  ],
};

// ---------- shell ----------
export default function Payroll({ user }) {
  const db = useDB();
  const route = useRoute();
  const mod = MODULES.some((m) => m.key === route[2]) ? route[2] : 'analytics';
  const subs = SUBS[mod];
  const sub = subs ? (subs.some(([k]) => k === route[3]) ? route[3] : subs[0][0]) : route[3];
  const entities = [...new Set(db.employees.map((e) => e.legalEntity).filter(Boolean))];
  const [entity, setEntity] = useState(entities[0] || db.company.name);

  let body;
  if (mod === 'analytics') body = { overview: <Analytics db={db} />, planning: <CompPlanning db={db} user={user} />, budget: <BudgetEstimation db={db} />, compare: <CompareCost db={db} />, competitiveness: <Competitiveness db={db} />, geo: <GeoDifferentials db={db} /> }[sub];
  else if (mod === 'run') body = <RunPayroll user={user} month={sub} />;
  else if (mod === 'admin') body = <PayrollAdmin db={db} user={user} sub={sub} />;
  else if (mod === 'approvals') body = <Approvals db={db} user={user} sub={sub} />;
  else if (mod === 'loans') body = <Loans db={db} user={user} />;
  else if (mod === 'benefits') body = <Benefits db={db} />;
  else if (mod === 'reports') body = <Reports db={db} />;
  else body = <PayrollSettings db={db} />;

  return (
    <div className="pr">
      <nav className="pr-modules" aria-label="Payroll">
        {MODULES.map((m) => (
          <a key={m.key} href={`#/admin/payroll/${m.key}`} className={mod === m.key ? 'active' : ''}>
            {m.label}
          </a>
        ))}
      </nav>
      {subs && (
        <nav className="pr-subs">
          {subs.map(([k, label]) => (
            <a key={k} href={`#/admin/payroll/${mod}/${k}`} className={sub === k ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
      )}
      <div className="pr-body page-enter" key={`${mod}/${sub || ''}`}>
        <div className="pr-entity">
          <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Legal entity">
            {(entities.length ? entities : [db.company.name]).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <Icon name="chevronDown" size={16} />
        </div>
        {body}
      </div>
    </div>
  );
}

function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`pr-panel ${className}`}>
      {(title || right) && (
        <header className="pr-panel-head">
          <h3>{title}</h3>
          {right}
        </header>
      )}
      <div className="pr-panel-body">{children}</div>
    </section>
  );
}

function EmployeeList({ title, rows, onClose }) {
  const db = useDB();
  return (
    <Modal title={title} onClose={onClose}>
      <DataTable rows={rows} empty="No employees." columns={[empCol(db), { key: 'newDesignation', label: 'Job title' }, { key: 'newCtc', label: 'New CTC', render: (p) => money(p.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }]} />
    </Modal>
  );
}

// ---------- analytics ----------
function Donut({ data, size = 180 }) {
  const total = sumOf(data, (d) => d.value) || 1;
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="pr-donut" role="img" aria-label="Distribution chart">
      <g transform="rotate(-90 100 100)">
        {data.map((d) => {
          const len = (d.value / total) * C;
          const el = (
            <circle key={d.label} cx="100" cy="100" r={R} fill="none" stroke={d.color} strokeWidth="60" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}>
              <title>{`${d.label}: ${inr(d.value)}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
      </g>
    </svg>
  );
}

function Distribution({ title, groups }) {
  const data = groups.map((g, i) => ({ ...g, color: PALETTE[i % PALETTE.length] }));
  const total = sumOf(data, (d) => d.value);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <Panel title={title} className="pr-dist">
      <div className="pr-dist-body">
        <div className="pr-dist-chart">
          <Donut data={data} />
          <ul className="pr-legend">
            {data.map((d) => (
              <li key={d.label}>
                <i style={{ background: d.color }} />
                {d.label}
              </li>
            ))}
          </ul>
        </div>
        <dl className="pr-dist-facts">
          <dt>Total compensation</dt>
          <dd>{inr(total)}</dd>
          <dt>Highest compensation</dt>
          <dd>{sorted[0] ? `${sorted[0].label} (${inr(sorted[0].value)})` : '—'}</dd>
          <dt>Lowest compensation</dt>
          <dd>{sorted.length ? `${sorted[sorted.length - 1].label} (${inr(sorted[sorted.length - 1].value)})` : '—'}</dd>
        </dl>
      </div>
    </Panel>
  );
}

function PlannedActual({ rows }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual]));
  const step = max > 4e6 ? 1e6 : max > 1e6 ? 5e5 : 1e5;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = 1200;
  const H = 280;
  const L = 60;
  const B = 30;
  const bw = (W - L - 20) / Math.max(rows.length, 1);
  const y = (v) => H - B - (v / top) * (H - B - 10);
  const label = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)}L` : `${v / 1000}K`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pr-bars" role="img" aria-label="Planned versus actual compensation">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 10} y1={y(t)} y2={y(t)} className="pr-grid" />
          <text x={L - 10} y={y(t) + 4} textAnchor="end" className="pr-axis">
            {label(t)}
          </text>
        </g>
      ))}
      <text x="14" y={H / 2} transform={`rotate(-90 14 ${H / 2})`} textAnchor="middle" className="pr-axis">
        Amount (INR)
      </text>
      {rows.map((r, i) => {
        const x = L + i * bw + bw * 0.2;
        return (
          <g key={r.ym}>
            <rect x={x} y={y(r.planned)} width={bw * 0.6} height={H - B - y(r.planned)} className="pr-bar-planned">
              <title>{`${shortMonth(r.ym)} planned ${inr(r.planned)}`}</title>
            </rect>
            <rect x={x + bw * 0.1} y={y(r.actual)} width={bw * 0.4} height={H - B - y(r.actual)} className="pr-bar-actual">
              <title>{`${shortMonth(r.ym)} actual ${inr(r.actual)} (variance ${inr(r.actual - r.planned)})`}</title>
            </rect>
            <text x={x + bw * 0.3} y={H - 10} textAnchor="middle" className="pr-axis">
              {shortMonth(r.ym)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Analytics({ db }) {
  const cur = currentPayMonth(db);
  const lastRun = db.payrollRuns.filter(isDone).sort((a, b) => b.month.localeCompare(a.month))[0];
  const lastT = useMemo(() => (lastRun ? monthTotals(db, lastRun.month) : null), [db, lastRun]);
  const upT = useMemo(() => monthTotals(db, cur), [db, cur]);
  const today = todayISO();
  const upcoming = db.promotions.filter((p) => p.status === 'Approved' && p.effectiveFrom > today && p.effectiveFrom <= addDays(today, 92));
  const pending = db.promotions.filter((p) => p.status === 'Pending');
  const [list, setList] = useState(null);
  const firstFy = fyStart([...db.payrollRuns.map((r) => r.month), cur].sort()[0]);
  const fys = [];
  for (let f = fyStart(cur); f >= firstFy; f = addMonths(f, -12)) fys.push(f);
  const [fy, setFy] = useState(fys[0]);
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding');
  const group = (key) => {
    const m = new Map();
    people.forEach((e) => m.set(key(e), (m.get(key(e)) || 0) + Number(e.ctc || 0)));
    return [...m].map(([label, value]) => ({ label, value }));
  };
  const locName = (e) => db.locations.find((l) => l.id === e.locationId)?.name || 'Unassigned';
  const chart = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => addMonths(fy, i))
        .filter((m) => m < cur)
        .map((m) => {
          const run = db.payrollRuns.find((r) => r.month === m);
          const planned = sumOf(payrollPeople(db, m), (e) => Number(e.ctc || 0) / 12);
          return { ym: m, planned, actual: isDone(run) ? monthTotals(db, m).cost : 0 };
        }),
    [db, fy, cur],
  );

  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Last Salary Processed</span>
            <em>{lastRun ? `${monOf(lastRun.month).slice(0, 3)} ${lastRun.month.slice(0, 4)}` : ''}</em>
          </div>
          <strong>{lastT ? inr(lastT.cost) : '—'}</strong>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Upcoming Salary</span>
            <em>{`${monOf(cur).slice(0, 3)} ${cur.slice(0, 4)}`}</em>
          </div>
          <strong>{inr(upT.cost)}</strong>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Upcoming Revisions</span>
            <em>3 Months</em>
          </div>
          <div className="pr-kpi-row">
            <strong>{upcoming.length}</strong>
            <button className="pr-link" onClick={() => setList('upcoming')}>
              View Employees
            </button>
          </div>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Pending Revisions</span>
          </div>
          <div className="pr-kpi-row">
            <strong>{pending.length}</strong>
            <button className="pr-link" onClick={() => setList('pending')}>
              View Employees
            </button>
          </div>
        </div>
      </div>

      <div className="pr-section-head">
        <h2>Compensation Summary</h2>
        <select className="pr-select" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          {fys.map((f) => (
            <option key={f} value={f}>
              {fyName(f)}
            </option>
          ))}
        </select>
      </div>
      <div className="pr-cards2">
        <Distribution title="Compensation Distribution by Department/Sub-Department" groups={group((e) => e.department)} />
        <Distribution title="Compensation Distribution by Location" groups={group(locName)} />
      </div>
      <Panel
        title="Planned Vs Actual Compensation (Variance) - Past Months"
        right={
          <span className="pr-key">
            <i className="pr-key-planned" /> Planned <i className="pr-key-actual" /> Actual
          </span>
        }
      >
        {chart.length ? <PlannedActual rows={chart} /> : <p className="pr-muted">No payroll has been completed in this financial year yet.</p>}
      </Panel>
      {list && <EmployeeList title={list === 'upcoming' ? 'Revisions in the next 3 months' : 'Revisions waiting for approval'} rows={list === 'upcoming' ? upcoming : pending} onClose={() => setList(null)} />}
    </div>
  );
}

function bandOf(db, e) {
  return db.grades.find((g) => g.id === e.gradeId) || db.grades.find((g) => e.ctc >= g.minCtc && e.ctc < g.maxCtc);
}
const compa = (db, e) => {
  const g = bandOf(db, e);
  return g ? Number(e.ctc || 0) / ((g.minCtc + g.maxCtc) / 2) : 1;
};

function CompPlanning({ db, user }) {
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding');
  const plan = db.compPlans[0];
  const [budgetPct, setBudgetPct] = useState(plan?.budgetPct ?? 8);
  const [pcts, setPcts] = useState(() => Object.fromEntries(people.map((e) => [e.id, plan?.rows?.[e.id] ?? (compa(db, e) < 0.9 ? 10 : compa(db, e) > 1.1 ? 5 : 8)])));
  const nextFy = `${Number(fyStart(ymOf()).slice(0, 4)) + 1}-04-01`;
  const [effective, setEffective] = useState(plan?.effectiveFrom || nextFy);
  const current = sumOf(people, (e) => e.ctc);
  const increase = sumOf(people, (e) => (Number(e.ctc || 0) * Number(pcts[e.id] || 0)) / 100);
  const budget = (current * Number(budgetPct || 0)) / 100;
  const save = (status) => {
    update((d) => {
      d.compPlans = [{ id: plan?.id || uid('cp'), budgetPct: Number(budgetPct), rows: pcts, effectiveFrom: effective, savedAt: new Date().toISOString(), by: user.id, status }];
    });
  };
  const send = () => {
    const raise = people.filter((e) => Number(pcts[e.id]) > 0);
    if (!confirmAction(`Send ${raise.length} salary revisions for approval?`)) return;
    save('Sent for approval');
    raise.forEach((e) => addItem('promotions', { empId: e.id, oldDesignation: e.designation, newDesignation: e.designation, oldCtc: e.ctc, newCtc: Math.round(e.ctc * (1 + Number(pcts[e.id]) / 100)), effectiveFrom: effective, reason: 'Compensation planning cycle', status: 'Pending' }));
    toast('Revisions sent for approval');
  };
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi">
          <div className="pr-kpi-top"><span>Current annual payroll</span></div>
          <strong>{inr(current)}</strong>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Increment budget</span>
            <label className="pr-inline">
              <input type="number" min="0" step="0.5" value={budgetPct} onChange={(e) => setBudgetPct(e.target.value)} aria-label="Budget percent" /> %
            </label>
          </div>
          <strong>{inr(budget)}</strong>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top"><span>Planned increase</span><em>{current ? ((increase / current) * 100).toFixed(1) : 0}%</em></div>
          <strong>{inr(increase)}</strong>
        </div>
        <div className="pr-kpi">
          <div className="pr-kpi-top"><span>Budget left</span></div>
          <strong className={budget - increase < 0 ? 'pr-neg' : 'pr-pos'}>{inr(budget - increase)}</strong>
        </div>
      </div>
      <Panel
        title="Increment plan"
        right={
          <div className="row">
            <label className="pr-inline">
              Effective from <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </label>
            <Btn kind="ghost" small onClick={() => (save('Draft'), toast('Plan saved'))}>Save draft</Btn>
            <Btn small onClick={send}>Send for approval</Btn>
          </div>
        }
      >
        {plan && <p className="pr-muted" style={{ marginBottom: 10 }}>{`${plan.status} · last saved ${stamp(plan.savedAt)} by ${shortName(empById(db, plan.by))}`}</p>}
        <DataTable
          rows={people}
          pageSize={50}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} /> },
            { key: 'band', label: 'Band', render: (e) => bandOf(db, e)?.name || '—' },
            { key: 'ctc', label: 'Current CTC', render: (e) => inr(e.ctc) },
            { key: 'compa', label: 'Compa-ratio', sortValue: (e) => compa(db, e), render: (e) => compa(db, e).toFixed(2) },
            { key: 'pct', label: 'Increase %', sortable: false, render: (e) => <input className="pr-num" type="number" step="0.5" min="0" value={pcts[e.id]} onChange={(ev) => setPcts({ ...pcts, [e.id]: ev.target.value })} aria-label={`Increase for ${fullName(e)}`} /> },
            { key: 'new', label: 'New CTC', sortable: false, render: (e) => inr(e.ctc * (1 + Number(pcts[e.id] || 0) / 100)) },
          ]}
        />
      </Panel>
    </div>
  );
}

function BudgetEstimation({ db }) {
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding');
  const [inputs, setInputs] = useState(() => ({ hike: 8, ...db.budgetInputs }));
  const set = (k, v) => setInputs({ ...inputs, [k]: v });
  const rows = db.departments.map((d) => {
    const staff = people.filter((e) => e.department === d.name);
    const cost = sumOf(staff, (e) => e.ctc);
    const avg = staff.length ? cost / staff.length : 600000;
    const hires = Number(inputs[`hires_${d.id}`] || 0);
    const hireCtc = Number(inputs[`ctc_${d.id}`] || Math.round(avg));
    const projected = cost * (1 + Number(inputs.hike || 0) / 100) + hires * hireCtc;
    return { id: d.id, name: d.name, count: staff.length, cost, hires, hireCtc, projected };
  });
  const tot = (k) => sumOf(rows, (r) => r[k]);
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Current annual cost</span></div><strong>{inr(tot('cost'))}</strong></div>
        <div className="pr-kpi">
          <div className="pr-kpi-top">
            <span>Expected increment</span>
            <label className="pr-inline"><input type="number" min="0" step="0.5" value={inputs.hike} onChange={(e) => set('hike', e.target.value)} aria-label="Expected increment percent" /> %</label>
          </div>
          <strong>{inr((tot('cost') * Number(inputs.hike || 0)) / 100)}</strong>
        </div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Planned new hires</span></div><strong>{tot('hires')}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Projected annual cost</span><em>{tot('cost') ? `+${(((tot('projected') - tot('cost')) / tot('cost')) * 100).toFixed(1)}%` : ''}</em></div><strong>{inr(tot('projected'))}</strong></div>
      </div>
      <Panel title="Budget by department" right={<Btn small onClick={() => (update((d) => (d.budgetInputs = { ...inputs })), toast('Budget saved'))}>Save</Btn>}>
        <DataTable
          rows={rows}
          pageSize={50}
          columns={[
            { key: 'name', label: 'Department' },
            { key: 'count', label: 'Headcount' },
            { key: 'cost', label: 'Current cost', render: (r) => inr(r.cost) },
            { key: 'hires', label: 'New hires', sortable: false, render: (r) => <input className="pr-num" type="number" min="0" value={inputs[`hires_${r.id}`] || ''} placeholder="0" onChange={(e) => set(`hires_${r.id}`, e.target.value)} aria-label={`New hires in ${r.name}`} /> },
            { key: 'hireCtc', label: 'CTC per hire', sortable: false, render: (r) => <input className="pr-num pr-num-wide" type="number" min="0" value={inputs[`ctc_${r.id}`] || ''} placeholder={String(r.hireCtc)} onChange={(e) => set(`ctc_${r.id}`, e.target.value)} aria-label={`CTC per hire in ${r.name}`} /> },
            { key: 'projected', label: 'Projected cost', render: (r) => <strong>{inr(r.projected)}</strong> },
          ]}
        />
      </Panel>
    </div>
  );
}

function componentTotals(t) {
  const m = new Map();
  const add = (group, name, v) => {
    const k = `${group}|${name.replace(/ \(.*\)$/, '')}`;
    m.set(k, (m.get(k) || 0) + v);
  };
  t.slips.forEach((s) => {
    s.earnings.forEach(([k, v]) => add('Earnings', k, v));
    s.deductions.forEach(([k, v]) => add('Deductions', k, v));
    s.employer.forEach(([k, v]) => add('Employer contributions', k, v));
  });
  return m;
}

function CompareCost({ db }) {
  const months = [...new Set([...db.payrollRuns.map((r) => r.month), currentPayMonth(db)])].sort().reverse();
  const [a, setA] = useState(months[1] || months[0]);
  const [b, setB] = useState(months[0]);
  const ta = useMemo(() => monthTotals(db, a), [db, a]);
  const tb = useMemo(() => monthTotals(db, b), [db, b]);
  const ca = componentTotals(ta);
  const cb = componentTotals(tb);
  const keys = [...new Set([...ca.keys(), ...cb.keys()])];
  const rows = [
    { id: 'hc', group: 'Summary', name: 'Employees paid', a: ta.slips.length, b: tb.slips.length, count: true },
    ...['Earnings', 'Deductions', 'Employer contributions'].flatMap((g) => keys.filter((k) => k.startsWith(g + '|')).map((k) => ({ id: k, group: g, name: k.split('|')[1], a: ca.get(k) || 0, b: cb.get(k) || 0 }))),
    { id: 'gross', group: 'Summary', name: 'Gross pay', a: ta.gross, b: tb.gross, bold: true },
    { id: 'net', group: 'Summary', name: 'Net pay (employee deposit)', a: ta.deposit, b: tb.deposit, bold: true },
    { id: 'cost', group: 'Summary', name: 'Total payroll cost', a: ta.cost, b: tb.cost, bold: true },
  ];
  const fmt = (r, v) => (r.count ? v : inr(v));
  return (
    <Panel
      title="Compare compensation cost"
      right={
        <div className="row">
          <MonthSelect value={a} onChange={setA} months={months} label="First month" />
          <span className="pr-muted">vs</span>
          <MonthSelect value={b} onChange={setB} months={months} label="Second month" />
          <Btn kind="ghost" small icon="download" onClick={() => exportCSV(`compare-${a}-${b}`, [{ label: 'Group', csv: (r) => r.group }, { label: 'Component', csv: (r) => r.name }, { label: monthLabel(a), csv: (r) => Math.round(r.a) }, { label: monthLabel(b), csv: (r) => Math.round(r.b) }, { label: 'Difference', csv: (r) => Math.round(r.b - r.a) }], rows)}>Export</Btn>
        </div>
      }
    >
      <DataTable
        rows={rows}
        pageSize={60}
        columns={[
          { key: 'group', label: 'Group', sortable: false },
          { key: 'name', label: 'Component', sortable: false, render: (r) => (r.bold ? <strong>{r.name}</strong> : r.name) },
          { key: 'a', label: monthLabel(a), sortable: false, render: (r) => fmt(r, r.a) },
          { key: 'b', label: monthLabel(b), sortable: false, render: (r) => fmt(r, r.b) },
          { key: 'd', label: 'Difference', sortable: false, render: (r) => <span className={r.b - r.a < 0 ? 'pr-neg' : r.b - r.a > 0 ? 'pr-pos' : ''}>{fmt(r, r.b - r.a)}</span> },
          { key: 'p', label: 'Change', sortable: false, render: (r) => (r.a ? `${(((r.b - r.a) / r.a) * 100).toFixed(1)}%` : '—') },
        ]}
      />
    </Panel>
  );
}

function Competitiveness({ db }) {
  const [band, setBand] = useState('');
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding' && (!band || bandOf(db, e)?.id === band));
  const position = (e) => {
    const g = bandOf(db, e);
    if (!g) return 'No band';
    if (e.ctc < g.minCtc) return 'Below range';
    if (e.ctc > g.maxCtc) return 'Above range';
    const c = compa(db, e);
    return c < 0.9 ? 'Low in range' : c > 1.1 ? 'High in range' : 'At midpoint';
  };
  const TONES = { 'Below range': 'red', 'Low in range': 'amber', 'At midpoint': 'green', 'High in range': 'blue', 'Above range': 'purple', 'No band': 'grey' };
  const count = (p) => people.filter((e) => position(e) === p).length;
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        {['Below range', 'Low in range', 'At midpoint', 'High in range'].map((p) => (
          <div key={p} className="pr-kpi">
            <div className="pr-kpi-top"><span>{p}</span><em>{people.length ? Math.round((count(p) / people.length) * 100) : 0}%</em></div>
            <strong>{count(p)}</strong>
          </div>
        ))}
      </div>
      <Panel
        title="Pay position against salary bands"
        right={
          <select className="pr-select" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Band">
            <option value="">All bands</option>
            {db.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        }
      >
        <DataTable
          rows={people}
          pageSize={50}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} /> },
            { key: 'band', label: 'Band', render: (e) => bandOf(db, e)?.name || '—' },
            { key: 'range', label: 'Band range', sortable: false, render: (e) => { const g = bandOf(db, e); return g ? `${inr(g.minCtc)} – ${inr(g.maxCtc)}` : '—'; } },
            { key: 'ctc', label: 'CTC', render: (e) => inr(e.ctc) },
            { key: 'compa', label: 'Compa-ratio', sortValue: (e) => compa(db, e), render: (e) => compa(db, e).toFixed(2) },
            { key: 'pos', label: 'Position', sortValue: position, render: (e) => <Badge tone={TONES[position(e)]}>{position(e)}</Badge> },
          ]}
        />
      </Panel>
    </div>
  );
}

function GeoDifferentials({ db }) {
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding');
  const index = (id) => Number(db.geoIndex?.[id] ?? 100);
  const base = db.locations[0];
  const rows = db.locations.map((l) => {
    const staff = people.filter((e) => e.locationId === l.id).map((e) => Number(e.ctc || 0)).sort((a, b) => a - b);
    const avg = staff.length ? sumOf(staff, (x) => x) / staff.length : 0;
    return { id: l.id, name: l.name, count: staff.length, avg, median: staff.length ? staff[Math.floor(staff.length / 2)] : 0, min: staff[0] || 0, max: staff[staff.length - 1] || 0, adjusted: avg / (index(l.id) / 100) };
  });
  return (
    <Panel title={`Pay by location (cost-of-living index, ${base?.name || 'head office'} = 100)`}>
      <DataTable
        rows={rows}
        columns={[
          { key: 'name', label: 'Location' },
          { key: 'count', label: 'Employees' },
          { key: 'avg', label: 'Average CTC', render: (r) => inr(r.avg) },
          { key: 'median', label: 'Median CTC', render: (r) => inr(r.median) },
          { key: 'range', label: 'Range', sortable: false, render: (r) => (r.count ? `${inr(r.min)} – ${inr(r.max)}` : '—') },
          { key: 'idx', label: 'Cost-of-living index', sortable: false, render: (r) => <input className="pr-num" type="number" min="1" defaultValue={index(r.id)} onBlur={(e) => update((d) => (d.geoIndex = { ...d.geoIndex, [r.id]: Number(e.target.value) || 100 }))} aria-label={`Index for ${r.name}`} /> },
          { key: 'adjusted', label: 'Adjusted average', render: (r) => inr(r.adjusted) },
          { key: 'diff', label: 'Differential', sortable: false, render: (r) => `${index(r.id) - 100 >= 0 ? '+' : ''}${index(r.id) - 100}%` },
        ]}
      />
    </Panel>
  );
}

// ---------- run payroll ----------
const STEPS = [
  { key: 'attendance', title: 'Leave, Attendance & Payable Units', icon: 'calendar', tone: '#62c1d1' },
  { key: 'joinees', title: 'New Joinees & Exits', icon: 'userPlus', tone: '#c47bc4' },
  { key: 'bonus', title: 'Bonus, Salary Revisions & Overtime', icon: 'briefcase', tone: '#8d93d8' },
  { key: 'reimbursement', title: 'Reimbursement, Adhoc Payment, Deduction', icon: 'calc', tone: '#5ea9e0' },
  { key: 'hold', title: 'Salaries on Hold & Arrears', icon: 'hourglass', tone: '#a5bf3a' },
  { key: 'override', title: 'Override (PT, ESI, TDS, LWF)', icon: 'userCheck', tone: '#e2b84b' },
];

const HELP = [
  ['How to override statutory contributions & deductions?', 'Open the "Override (PT, ESI, TDS, LWF)" step, pick the employee and enter the amount to use this month. Leave a box empty to keep the calculated value. Process payroll again afterwards.'],
  ['How to release payslips?', 'Process payroll, fix any errors, then lock it. Once it is locked, "Release Payslips" sends every employee a notification and their payslip appears under My Finances.'],
  ['How to download salary bulk upload format of your bank?', "Go to Reports and download \"Bank transfer statement\" for the month. It lists each employee's bank, account number, IFSC and net pay, ready to paste into your bank's bulk upload sheet."],
  ['How to run off cycle payroll?', "Add the payment as an adhoc payment in the \"Reimbursement, Adhoc Payment, Deduction\" step of the month it should be paid in, then process that month's payroll again."],
  ['How to check if my payroll values are calculated correctly?', 'Use "Review all employees" to open each payslip, or compare this month with the last one under Payroll Analytics → Compare Compensation Cost.'],
];

function Delta({ ym, value }) {
  const neg = value < 0;
  return (
    <span className="pr-delta">
      {monOf(ym)} <b className={neg ? 'pr-neg' : 'pr-pos'}>INR {Math.round(value).toLocaleString('en-IN')}</b>
      <Icon name={neg ? 'chevronDown' : 'arrowUp'} size={12} className={neg ? 'pr-neg' : 'pr-pos'} />
    </span>
  );
}

function RunPayroll({ user, month }) {
  const db = useDB();
  const s = db.payrollSettings;
  const cur = currentPayMonth(db);
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : cur;
  const [fy, setFy] = useState(fyStart(ym));
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(null);
  const [modal, setModal] = useState(null);
  const [slip, setSlip] = useState(null);
  const [panels, setPanels] = useState({ activity: false, help: true });
  useEffect(() => setFy(fyStart(ym)), [ym]);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const prev = useMemo(() => monthTotals(db, addMonths(ym, -1)), [db, ym]);
  const [from, to] = cycleRange(ym, s.cycleStartDay);
  const days = cycleDays(ym, s.cycleStartDay);
  const joiners = t.people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
  const exits = db.exits.filter((x) => x.lastWorkingDay >= from && x.lastWorkingDay <= to);
  const errors = payrollErrors(t.people, t.slips);
  const done = isDone(run);
  const upcoming = ym > cur;
  const stepsDone = STEPS.filter((st) => run?.steps?.[st.key]).length;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(fy, i));
  const payable = t.slips.filter((x) => !x.onHold).length;
  const canLock = run?.status === 'Processed' && !run.dirty && errors.length === 0;
  const activity = (db.payrollActivity || []).filter((a) => a.month === ym);
  const prevYm = addMonths(ym, -1);

  const stateOf = (m) => {
    const r = db.payrollRuns.find((x) => x.month === m);
    if (isDone(r)) return 'completed';
    if (m === cur) return 'current';
    return m > cur ? 'upcoming' : 'pending';
  };
  const process = () => {
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Processed', processedAt: new Date().toISOString(), processedOn: todayISO(), processedBy: user.id, processedCount: payable, dirty: false });
      logActivity(d, ym, user, `Processed payroll for ${payable} employees`);
    });
    toast(`Payroll processed for ${payable} employees`);
  };
  const lock = () => {
    if (!confirmAction(`Lock payroll for ${monthLabel(ym)}? Inputs can't be changed after this.`)) return;
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Finalized', lockedAt: new Date().toISOString(), lockedBy: user.id });
      logActivity(d, ym, user, 'Locked payroll');
    });
    toast(`Payroll locked for ${monthLabel(ym)}`);
  };
  const release = () => {
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Paid', releasedAt: new Date().toISOString() });
      logActivity(d, ym, user, 'Released payslips');
    });
    t.slips.filter((x) => !x.onHold).forEach((x) => notify(x.emp.id, `Your payslip for ${monthLabel(ym)} is ready.`, 'finances/payslips'));
    toast('Payslips released');
  };
  const unlock = () => {
    if (!confirmAction(`Unlock payroll for ${monthLabel(ym)}?`)) return;
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Processed', dirty: true });
      logActivity(d, ym, user, 'Unlocked payroll');
    });
  };
  const processed = run?.processedAt ? new Date(run.processedAt) : null;
  let footNote;
  if (done) footNote = `Payroll was locked${run.lockedAt ? ` on ${stamp(run.lockedAt)}` : ''}${run.status === 'Paid' ? ' and payslips were released' : ''}`;
  else if (processed) footNote = `Payroll was last processed on ${pad(processed.getDate())} ${MONTHS[processed.getMonth()].slice(0, 3)} at ${stamp(run.processedAt).slice(-8)} by ${shortName(empById(db, run.processedBy))}`;
  else if (upcoming) footNote = `Payroll for ${monthLabel(ym)} opens once ${monthLabel(cur)} is locked`;
  else footNote = 'Payroll has not been processed for this month yet';

  return (
    <div className="pr-stack">
      <div className="pr-cycles">
        <button className="pr-cycle-nav" onClick={() => setFy(addMonths(fy, -12))} aria-label="Previous year">
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="pr-cycle-list">
          {months.map((m) => {
            const st = stateOf(m);
            const [a, b] = cycleRange(m, s.cycleStartDay);
            return (
              <button key={m} className={`pr-cycle ${st} ${m === ym ? 'selected' : ''}`} onClick={() => goto(`run/${m}`)}>
                <span className="pr-cycle-m">{shortMonth(m)}</span>
                <span className="pr-cycle-r">{`${dayMon(a)}-${dayMon(b)}`}</span>
                <span className="pr-cycle-s">
                  {st === 'completed' && <Icon name="check" size={11} />}
                  {st === 'current' && <Icon name="refresh" size={11} />}
                  {{ completed: 'Completed', current: 'Current', upcoming: 'Upcoming', pending: 'Not processed' }[st]}
                </span>
              </button>
            );
          })}
        </div>
        <button className="pr-cycle-nav" onClick={() => setFy(addMonths(fy, 12))} aria-label="Next year">
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <h2 className="pr-month">
        {`${monOf(ym)}-${ym.slice(0, 4)}`} <small>{`(${monDay(from)} - ${monDay(to)}, ${days} days)`}</small>
      </h2>

      <section className="pr-summary">
        <div className="pr-summary-left">
          <div>
            <span className="pr-cap">Total employees</span>
            <strong>
              {t.people.length}
              <small className="pr-pos">
                <Icon name="arrowUp" size={11} />
                {joiners.length}
              </small>
              <small className="pr-neg">
                <Icon name="chevronDown" size={11} />
                {exits.length}
              </small>
            </strong>
          </div>
          <div>
            <span className="pr-cap">Calendar days</span>
            <strong>{days}</strong>
          </div>
          <div>
            <span className="pr-cap">Payroll processed</span>
            <strong>
              {`${run?.processedAt ? run.processedCount ?? payable : 0}/${t.people.length}`} <small className="pr-cap">Employees</small>
            </strong>
          </div>
        </div>
        <div className="pr-formula">
          <div>
            <span>Total Payroll Cost</span>
            <b>{inr(t.cost)}</b>
            <Delta ym={prevYm} value={t.cost - prev.cost} />
          </div>
          <i>=</i>
          <div>
            <span>
              Employee Deposit <Icon name="info" size={13} />
            </span>
            <b>{inr(t.deposit)}</b>
            <Delta ym={prevYm} value={t.deposit - prev.deposit} />
          </div>
          <i>+</i>
          <div>
            <span>Total Deductions</span>
            <b className="pr-accent">{inr(t.deductions)}</b>
            <Delta ym={prevYm} value={t.deductions - prev.deductions} />
          </div>
          <i>+</i>
          <div>
            <span>Total contributions</span>
            <b className="pr-accent">{inr(t.contributions)}</b>
            <Delta ym={prevYm} value={t.contributions - prev.contributions} />
          </div>
        </div>
      </section>

      {run?.processedAt && run.dirty && !done && (
        <div className="pr-warn">
          <Icon name="alert" size={18} />
          <span>There are changes in payroll inputs after the last payroll process. To apply the changes and lock payroll, save the respective run payroll steps and process payroll again</span>
          <button className="pr-link" onClick={() => setPanels({ ...panels, activity: true })}>
            View changes <Icon name="chevronRight" size={13} />
          </button>
        </div>
      )}

      <div className="pr-run-grid">
        <section className="pr-panel pr-run">
          <div className="pr-run-top">
            <h3>Run Payroll</h3>
            <div className="pr-run-intro">
              <button className="pr-collapse" onClick={() => setOpen(!open)} aria-label={open ? 'Hide steps' : 'Show steps'}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
              </button>
              <div className="pr-tip">
                <strong>Everything you need to know about running payroll.</strong>
                <p>Click the button below for a guided tutorial.</p>
                <button onClick={() => setModal('tour')}>Click here</button>
              </div>
              <div className="pr-progress">
                <span className="pr-track">
                  <span style={{ width: `${(stepsDone / STEPS.length) * 100}%` }} />
                </span>
                {`${stepsDone} of ${STEPS.length} steps completed`}
              </div>
            </div>
          </div>
          {open && (
            <div className="pr-steps">
              {STEPS.map((st) => {
                const info = run?.steps?.[st.key];
                return (
                  <button key={st.key} className={`pr-step ${info ? 'done' : ''}`} onClick={() => setStep(st)}>
                    <span className="pr-step-icon" style={{ color: st.tone, background: `${st.tone}29` }}>
                      <Icon name={st.icon} size={18} />
                    </span>
                    <span>
                      <span className="pr-step-title">{st.title}</span>
                      <span className="pr-step-sub">{info ? `Last Changes on ${stamp(info.at)} BY ${shortName(empById(db, info.by))}` : 'No changes saved yet'}</span>
                    </span>
                    {info && <Icon name="check" size={16} className="pr-step-check" />}
                  </button>
                );
              })}
            </div>
          )}
          {errors.length > 0 && !done && (
            <div className="pr-error">
              <Icon name="info" size={15} />
              <span>{`There ${errors.length === 1 ? 'is 1 error' : `are ${errors.length} errors`} in Payroll run - Please review and fix them to proceed.`}</span>
              <button onClick={() => setModal('errors')}>Review and fix</button>
            </div>
          )}
          <div className="pr-run-foot">
            <p>{footNote}</p>
            <div className="pr-actions">
              {!done && (
                <button className="pr-btn" disabled={upcoming} onClick={process}>
                  Process Payroll
                </button>
              )}
              <button className="pr-btn" onClick={() => setModal('review')}>
                Review all employees
              </button>
              {!done && (
                <button className="pr-btn pr-btn-fill" disabled={!canLock || upcoming} onClick={lock} title={canLock ? '' : 'Process payroll and fix all errors first'}>
                  Lock Payroll
                </button>
              )}
              {run?.status === 'Finalized' && (
                <>
                  <button className="pr-btn" onClick={unlock}>
                    Unlock Payroll
                  </button>
                  <button className="pr-btn pr-btn-fill" onClick={release}>
                    Release Payslips
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <aside className="pr-side">
          <section className="pr-panel pr-acc">
            <button className="pr-acc-head" onClick={() => setPanels({ ...panels, activity: !panels.activity })}>
              Activity <Icon name={panels.activity ? 'arrowUp' : 'chevronDown'} size={16} />
            </button>
            {panels.activity && (
              <ul className="pr-activity">
                {activity.length === 0 && <li className="pr-muted">No activity for this month yet.</li>}
                {activity.slice(0, 30).map((a) => (
                  <li key={a.id}>
                    <span>{a.text}</span>
                    <small>{`${stamp(a.at)} · ${shortName(empById(db, a.by))}`}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="pr-panel pr-acc">
            <button className="pr-acc-head" onClick={() => setPanels({ ...panels, help: !panels.help })}>
              Help Resources <Icon name={panels.help ? 'arrowUp' : 'chevronDown'} size={16} />
            </button>
            {panels.help && (
              <div className="pr-help">
                {HELP.map(([q], i) => (
                  <button key={q} onClick={() => setModal(i)}>
                    <span>{q}</span>
                    <Icon name="external" size={14} />
                  </button>
                ))}
                <div className="pr-help-more">
                  <Icon name="help" size={18} />
                  <strong>Still need help?</strong>
                  <a href="#/me/helpdesk">Raise a helpdesk ticket</a>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {step && <StepModal step={step} ym={ym} user={user} t={t} locked={done || upcoming} range={[from, to]} onClose={() => setStep(null)} />}
      {modal === 'tour' && <Tour onClose={() => setModal(null)} />}
      {typeof modal === 'number' && (
        <Modal title={HELP[modal][0]} onClose={() => setModal(null)}>
          <p>{HELP[modal][1]}</p>
        </Modal>
      )}
      {modal === 'errors' && (
        <Modal title="Payroll errors" onClose={() => setModal(null)} wide>
          <DataTable
            rows={errors.map((e, i) => ({ ...e, id: i }))}
            columns={[
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => <EmpChip emp={r.emp} sub={r.emp.empNo} /> },
              { key: 'text', label: 'Problem', sortable: false },
              { key: 'fix', label: '', sortable: false, render: (r) => <a className="btn btn-ghost btn-sm" href={`#/profile/${r.emp.id}`}>Fix in profile</a> },
            ]}
          />
        </Modal>
      )}
      {modal === 'review' && (
        <Modal
          title={`Review all employees — ${monthLabel(ym)}`}
          onClose={() => setModal(null)}
          wide
          footer={
            <Btn kind="ghost" icon="download" onClick={() => exportCSV(`payroll-${ym}`, [{ label: 'Employee', csv: (x) => fullName(x.emp) }, { label: 'Emp no', csv: (x) => x.emp.empNo }, { label: 'Paid days', csv: (x) => x.paidDays }, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'Deductions', csv: (x) => Math.round(x.totalDed) }, { label: 'Net pay', csv: (x) => Math.round(x.net) }, { label: 'On hold', csv: (x) => (x.onHold ? 'Yes' : 'No') }], t.slips)}>
              Export
            </Btn>
          }
        >
          <DataTable
            rows={t.slips}
            rowKey={(x) => x.emp.id}
            pageSize={25}
            onRowClick={setSlip}
            columns={[
              { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
              { key: 'paidDays', label: 'Paid days', render: (x) => `${x.paidDays}${x.lop ? ` (LOP ${x.lop})` : ''}` },
              { key: 'gross', label: 'Gross', render: (x) => money(x.gross) },
              { key: 'totalDed', label: 'Deductions', render: (x) => money(x.totalDed) },
              { key: 'net', label: 'Net pay', render: (x) => <strong>{money(x.net)}</strong> },
              { key: 'onHold', label: '', sortable: false, render: (x) => (x.onHold ? <Badge tone="amber">On hold</Badge> : null) },
            ]}
          />
        </Modal>
      )}
      {slip && (
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<Btn icon="print" onClick={() => window.print()}>Print</Btn>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
    </div>
  );
}

function Tour({ onClose }) {
  const [i, setI] = useState(0);
  const ABOUT = {
    attendance: 'Check paid days and loss-of-pay for everyone in the cycle.',
    joinees: 'Confirm who joined or left during the cycle; their pay is worked out for the days they were here.',
    bonus: 'Add bonuses, pay approved overtime and check salary revisions that take effect this month.',
    reimbursement: 'Pay approved claims and expenses through payroll, and add one-off payments or deductions.',
    hold: "Hold an employee's salary for this month or add arrears from earlier months.",
    override: 'Replace the calculated PT, ESI, TDS or LWF for an employee when needed.',
  };
  const pages = [
    ['Pick the month', 'The strip at the top shows every month of the financial year. Completed months are locked; the current month is the one to run.'],
    ...STEPS.map((st, n) => [`Step ${n + 1}: ${st.title}`, ABOUT[st.key]]),
    ['Process, lock and release', 'Process payroll to calculate every payslip, fix any errors, lock it, then release payslips so employees can see them.'],
  ];
  return (
    <Modal
      title="Running payroll"
      onClose={onClose}
      footer={
        <>
          <Btn kind="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </Btn>
          {i < pages.length - 1 ? <Btn onClick={() => setI(i + 1)}>Next</Btn> : <Btn onClick={onClose}>Done</Btn>}
        </>
      }
    >
      <p className="pr-muted">{`${i + 1} of ${pages.length}`}</p>
      <h4 style={{ margin: '6px 0' }}>{pages[i][0]}</h4>
      <p>{pages[i][1]}</p>
    </Modal>
  );
}

const ADJ_FIELDS = (kinds) => [
  { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
  { key: 'kind', label: 'Type', type: 'select', options: kinds, required: true },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'note', label: 'Note', full: true },
];

function AdjList({ db, ym, kinds, title, locked, changed }) {
  const [add, setAdd] = useState(false);
  const rows = db.payrollAdjustments.filter((a) => a.month === ym && kinds.includes(a.kind));
  return (
    <div className="pr-sec">
      <div className="pr-sec-head">
        <h4>{title}</h4>
        {!locked && (
          <Btn small kind="ghost" icon="plus" onClick={() => setAdd(true)}>
            Add
          </Btn>
        )}
      </div>
      <DataTable
        rows={rows}
        empty="Nothing added for this month."
        columns={[
          empCol(db),
          { key: 'kind', label: 'Type' },
          { key: 'amount', label: 'Amount', render: (a) => money(a.amount) },
          { key: 'note', label: 'Note' },
          { key: 'x', label: '', sortable: false, render: (a) => !locked && <Btn small kind="icon" icon="trash" aria-label="Remove" onClick={() => (removeItem('payrollAdjustments', a.id), changed(`Removed ${a.kind.toLowerCase()} for ${fullName(empById(db, a.empId))}`))} /> },
        ]}
      />
      {add && (
        <FormModal
          title={`Add ${title.toLowerCase()}`}
          fields={ADJ_FIELDS(kinds)}
          initial={{ kind: kinds[0] }}
          onClose={() => setAdd(false)}
          onSave={(v) => {
            addItem('payrollAdjustments', { ...v, amount: Number(v.amount), month: ym });
            setAdd(false);
            changed(`Added ${v.kind.toLowerCase()} of ${money(v.amount)} for ${fullName(empById(db, v.empId))}`);
          }}
        />
      )}
    </div>
  );
}

function PayNowButton({ onClick }) {
  return (
    <Btn small kind="ghost" onClick={onClick}>
      Pay in this payroll
    </Btn>
  );
}

function StepModal({ step, ym, user, t, locked, range, onClose }) {
  const db = useDB();
  const [from, to] = range;
  const [holdForm, setHoldForm] = useState(false);
  const [ovForm, setOvForm] = useState(null);
  const changed = (text) => inputsChanged(ym, user, text);
  const save = () => {
    update((d) => {
      const r = touchRun(d, ym);
      r.steps[step.key] = { at: new Date().toISOString(), by: user.id };
      if (r.processedAt) r.dirty = true;
      logActivity(d, ym, user, `Saved "${step.title}"`);
    });
    toast('Step saved');
    onClose();
  };
  const lopAdj = (id) => sumOf(db.payrollAdjustments.filter((a) => a.empId === id && a.month === ym && a.kind === 'LOP days'), (a) => a.amount);
  const setLop = (emp, v) => {
    if (Number(v || 0) === lopAdj(emp.id)) return;
    update((d) => {
      d.payrollAdjustments = d.payrollAdjustments.filter((a) => !(a.empId === emp.id && a.month === ym && a.kind === 'LOP days'));
      if (Number(v)) d.payrollAdjustments.push({ id: uid('adj'), empId: emp.id, month: ym, kind: 'LOP days', amount: Number(v), note: 'Payable units' });
    });
    changed(`Set loss-of-pay adjustment for ${fullName(emp)} to ${Number(v) || 0} day(s)`);
  };
  const hourly = (e) => Number(e?.ctc || 0) / 12 / 30 / 8;

  let content;
  if (step.key === 'attendance') {
    content = (
      <DataTable
        rows={t.slips}
        rowKey={(x) => x.emp.id}
        pageSize={50}
        columns={[
          { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
          { key: 'dim', label: 'Cycle days' },
          { key: 'leave', label: 'Unpaid leave / not employed', sortable: false, render: (x) => x.lop - lopAdj(x.emp.id) },
          { key: 'adj', label: 'LOP adjustment', sortable: false, render: (x) => <input key={`${x.emp.id}-${lopAdj(x.emp.id)}`} className="pr-num" type="number" min="0" step="0.5" defaultValue={lopAdj(x.emp.id) || ''} placeholder="0" disabled={locked} onBlur={(e) => setLop(x.emp, e.target.value)} aria-label={`Loss of pay for ${fullName(x.emp)}`} /> },
          { key: 'paidDays', label: 'Payable days', render: (x) => <strong>{x.paidDays}</strong> },
        ]}
      />
    );
  } else if (step.key === 'joinees') {
    const joiners = t.people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
    const exits = db.exits.filter((x) => x.lastWorkingDay >= from && x.lastWorkingDay <= to);
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>New joinees</h4>
          </div>
          <DataTable rows={joiners} empty="Nobody joined in this cycle." columns={[{ key: 'emp', label: 'Employee', sortable: false, render: (e) => <EmpChip emp={e} sub={e.empNo} /> }, { key: 'dateOfJoining', label: 'Joined on', render: (e) => fmtDate(e.dateOfJoining) }, { key: 'paid', label: 'Payable days', sortable: false, render: (e) => t.slips.find((x) => x.emp.id === e.id)?.paidDays }, { key: 'ctc', label: 'Annual CTC', render: (e) => money(e.ctc) }]} />
        </div>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Exits</h4>
            <a className="btn btn-ghost btn-sm" href="#/admin/lifecycle">
              Open exits & settlement
            </a>
          </div>
          <DataTable rows={exits} empty="Nobody leaves in this cycle." columns={[empCol(db), { key: 'exitType', label: 'Exit type' }, { key: 'lastWorkingDay', label: 'Last working day', render: (x) => fmtDate(x.lastWorkingDay) }, { key: 'status', label: 'Exit status', render: (x) => <Badge>{x.status}</Badge> }, { key: 'fnf', label: 'Full & final', sortable: false, render: (x) => <Badge>{db.fnf.find((f) => f.empId === x.empId)?.status || 'Not started'}</Badge> }]} />
        </div>
      </>
    );
  } else if (step.key === 'bonus') {
    const revisions = db.promotions.filter((p) => p.effectiveFrom >= from && p.effectiveFrom <= to);
    const ot = db.overtime.filter((o) => o.status === 'Approved' && o.date >= from && o.date <= to);
    const rate = Number(db.attendanceSettings?.overtimeRate || 1.5);
    const otPay = (o) => Math.round(o.hours * hourly(empById(db, o.empId)) * rate);
    const payOt = (o) => {
      addItem('payrollAdjustments', { empId: o.empId, month: ym, kind: 'Overtime', amount: otPay(o), note: fmtDate(o.date) });
      patchItem('overtime', o.id, { paidIn: ym });
      changed(`Added overtime pay for ${fullName(empById(db, o.empId))}`);
    };
    content = (
      <>
        <AdjList db={db} ym={ym} kinds={['Bonus', 'Incentive']} title="Bonus" locked={locked} changed={changed} />
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Salary revisions taking effect</h4>
            <a className="btn btn-ghost btn-sm" href="#/admin/payroll/admin/revisions">
              Manage revisions
            </a>
          </div>
          <DataTable rows={revisions} empty="No revisions take effect in this cycle." columns={[empCol(db), { key: 'newDesignation', label: 'Job title' }, { key: 'oldCtc', label: 'Old CTC', render: (p) => money(p.oldCtc) }, { key: 'newCtc', label: 'New CTC', render: (p) => money(p.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]} />
        </div>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Approved overtime</h4>
          </div>
          <DataTable
            rows={ot}
            empty="No approved overtime in this cycle."
            columns={[
              empCol(db),
              { key: 'date', label: 'Date', render: (o) => fmtDate(o.date) },
              { key: 'hours', label: 'Hours' },
              { key: 'amt', label: `Pay at ${rate}×`, sortable: false, render: (o) => money(otPay(o)) },
              { key: 'act', label: '', sortable: false, render: (o) => (o.paidIn ? <Badge tone="green">{`Added to ${shortMonth(o.paidIn)}`}</Badge> : !locked && <PayNowButton onClick={() => payOt(o)} />) },
            ]}
          />
        </div>
        <AdjList db={db} ym={ym} kinds={['Overtime']} title="Overtime payouts" locked={locked} changed={changed} />
      </>
    );
  } else if (step.key === 'reimbursement') {
    const waiting = [...db.claims.filter((c) => c.status === 'Approved' && !c.paidIn).map((c) => ({ ...c, src: 'claims', label: c.component })), ...db.expenses.filter((e) => e.status === 'Approved').map((e) => ({ ...e, src: 'expenses', label: e.title }))];
    const pay = (c) => {
      addItem('payrollAdjustments', { empId: c.empId, month: ym, kind: 'Reimbursement', amount: Number(c.amount), note: c.label });
      patchItem(c.src, c.id, c.src === 'claims' ? { paidIn: ym } : { status: 'Paid', paidIn: ym });
      changed(`Added reimbursement "${c.label}" for ${fullName(empById(db, c.empId))}`);
    };
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Approved claims and expenses waiting for payment</h4>
          </div>
          <DataTable rows={waiting} empty="Nothing waiting for payment." columns={[empCol(db), { key: 'label', label: 'Item' }, { key: 'amount', label: 'Amount', render: (c) => money(c.amount) }, { key: 'act', label: '', sortable: false, render: (c) => !locked && <PayNowButton onClick={() => pay(c)} /> }]} />
        </div>
        <AdjList db={db} ym={ym} kinds={['Reimbursement', 'Adhoc payment', 'Deduction']} title="Reimbursements, adhoc payments and deductions" locked={locked} changed={changed} />
      </>
    );
  } else if (step.key === 'hold') {
    const holds = (db.payrollHolds || []).filter((h) => h.month === ym);
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Salaries on hold</h4>
            {!locked && (
              <Btn small kind="ghost" icon="plus" onClick={() => setHoldForm(true)}>
                Hold salary
              </Btn>
            )}
          </div>
          <DataTable rows={holds} empty="No salaries are on hold this month." columns={[empCol(db), { key: 'reason', label: 'Reason' }, { key: 'x', label: '', sortable: false, render: (h) => !locked && <Btn small kind="ghost" onClick={() => (removeItem('payrollHolds', h.id), changed(`Released salary hold for ${fullName(empById(db, h.empId))}`))}>Release hold</Btn> }]} />
        </div>
        <AdjList db={db} ym={ym} kinds={['Arrears']} title="Arrears" locked={locked} changed={changed} />
        {holdForm && (
          <FormModal
            title="Hold salary"
            fields={[
              { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
              { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
            ]}
            onClose={() => setHoldForm(false)}
            onSave={(v) => {
              addItem('payrollHolds', { ...v, month: ym });
              setHoldForm(false);
              changed(`Held salary for ${fullName(empById(db, v.empId))}`);
            }}
          />
        )}
      </>
    );
  } else {
    const rows = (db.payrollOverrides || []).filter((o) => o.month === ym);
    const val = (v) => (v === '' || v === undefined || v === null ? 'Calculated' : money(v));
    content = (
      <div className="pr-sec">
        <div className="pr-sec-head">
          <h4>Statutory overrides</h4>
          {!locked && (
            <Btn small kind="ghost" icon="plus" onClick={() => setOvForm({})}>
              Add override
            </Btn>
          )}
        </div>
        <DataTable
          rows={rows}
          empty="All statutory amounts are calculated automatically this month."
          onRowClick={locked ? undefined : setOvForm}
          columns={[
            empCol(db),
            { key: 'pt', label: 'PT', render: (o) => val(o.pt) },
            { key: 'esi', label: 'ESI', render: (o) => val(o.esi) },
            { key: 'tds', label: 'TDS', render: (o) => val(o.tds) },
            { key: 'lwf', label: 'LWF', render: (o) => val(o.lwf) },
            { key: 'reason', label: 'Reason' },
            { key: 'x', label: '', sortable: false, render: (o) => !locked && <Btn small kind="icon" icon="trash" aria-label="Remove" onClick={(e) => (e.stopPropagation(), removeItem('payrollOverrides', o.id), changed(`Removed override for ${fullName(empById(db, o.empId))}`))} /> },
          ]}
        />
        {ovForm && (
          <FormModal
            title={ovForm.id ? 'Edit override' : 'Add override'}
            initial={ovForm}
            fields={[
              { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
              { key: 'pt', label: 'Professional tax', type: 'number', help: 'Leave empty to keep the calculated amount.' },
              { key: 'esi', label: 'ESI (employee)', type: 'number' },
              { key: 'tds', label: 'Income tax (TDS)', type: 'number' },
              { key: 'lwf', label: 'Labour welfare fund', type: 'number' },
              { key: 'reason', label: 'Reason', full: true },
            ]}
            onClose={() => setOvForm(null)}
            onSave={(v) => {
              if (ovForm.id) patchItem('payrollOverrides', ovForm.id, v);
              else addItem('payrollOverrides', { ...v, month: ym });
              setOvForm(null);
              changed(`Saved statutory override for ${fullName(empById(db, v.empId))}`);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <Modal
      title={`${step.title} — ${monthLabel(ym)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn kind="ghost" onClick={onClose}>
            Close
          </Btn>
          {!locked && <Btn onClick={save}>Save & mark complete</Btn>}
        </>
      }
    >
      {locked && <p className="pr-note">This payroll month is locked or not open yet, so its inputs can't be changed.</p>}
      {content}
    </Modal>
  );
}

// ---------- payroll admin ----------
function MonthSelect({ value, onChange, months, label = 'Payroll month' }) {
  return (
    <select className="pr-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  );
}

const runLabel = (r) => (r.status === 'Finalized' ? 'Locked' : r.status);

function PayrollAdmin({ db, user, sub }) {
  const cur = currentPayMonth(db);
  const months = [...new Set([cur, ...db.payrollRuns.map((r) => r.month)])].sort().reverse();
  const [ym, setYm] = useState(months.find((m) => isDone(db.payrollRuns.find((r) => r.month === m))) || cur);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const [slip, setSlip] = useState(null);
  const [decl, setDecl] = useState(null);
  const [emp, setEmp] = useState(null);
  const [revise, setRevise] = useState(null);
  const sumDed = (prefix) => sumOf(t.slips, (x) => x.deductions.find((d) => d[0].startsWith(prefix))?.[1] || 0);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const br = (e) => salaryBreakup(e.ctc, db.payrollSettings);

  let body;
  if (sub === 'history') {
    body = (
      <Panel title="Payroll history">
        <DataTable
          rows={[...db.payrollRuns].sort((a, b) => b.month.localeCompare(a.month))}
          onRowClick={(r) => goto(`run/${r.month}`)}
          columns={[
            { key: 'month', label: 'Month', render: (r) => monthLabel(r.month) },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={isDone(r) ? 'green' : 'blue'}>{runLabel(r)}</Badge> },
            { key: 'processedOn', label: 'Processed on', render: (r) => (r.processedAt ? stamp(r.processedAt) : fmtDate(r.processedOn)) },
            { key: 'processedBy', label: 'By', render: (r) => fullName(empById(db, r.processedBy)) },
            { key: 'cost', label: 'Payroll cost', sortable: false, render: (r) => inr(monthTotals(db, r.month).cost) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'salaries') {
    const people = db.employees.filter((e) => e.status !== 'Exited');
    const cols = [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Annual CTC', csv: (e) => e.ctc }, ...br({ ctc: 0 }).earnings.map(([k], i) => ({ label: k, csv: (e) => Math.round(br(e).earnings[i][1]) }))];
    body = (
      <Panel title="Employee salaries" right={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('employee-salaries', cols, people)}>Export</Btn>}>
        <DataTable
          rows={people}
          pageSize={30}
          onRowClick={setEmp}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} sub={e.empNo} /> },
            { key: 'band', label: 'Band', render: (e) => bandOf(db, e)?.name || '—' },
            { key: 'ctc', label: 'Annual CTC', render: (e) => inr(e.ctc) },
            { key: 'gross', label: 'Monthly gross', sortable: false, render: (e) => inr(br(e).gross) },
            { key: 'basic', label: 'Basic', sortable: false, render: (e) => inr(br(e).earnings[0][1]) },
            { key: 'pf', label: 'Employer PF', sortable: false, render: (e) => inr(br(e).employer[0][1]) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'payslips') {
    body = (
      <Panel
        title={`Payslips — ${monthLabel(ym)}`}
        right={
          <div className="row">
            <MonthSelect value={ym} onChange={setYm} months={months} />
            {run && <Badge tone={isDone(run) ? 'green' : 'blue'}>{runLabel(run)}</Badge>}
          </div>
        }
      >
        <DataTable
          rows={t.slips}
          rowKey={(x) => x.emp.id}
          pageSize={30}
          onRowClick={setSlip}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
            { key: 'gross', label: 'Gross', render: (x) => money(x.gross) },
            { key: 'totalDed', label: 'Deductions', render: (x) => money(x.totalDed) },
            { key: 'net', label: 'Net pay', render: (x) => <strong>{money(x.net)}</strong> },
            { key: 'v', label: '', sortable: false, render: (x) => (x.onHold ? <Badge tone="amber">On hold</Badge> : run?.status === 'Paid' ? <Badge tone="green">Released</Badge> : null) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'statutory') {
    const ee = (x) => x.deductions.find((d) => d[0].startsWith('Provident'))?.[1] || 0;
    const epf = (x) => Math.min(x.earnings[0][1], db.payrollSettings.pfCeiling);
    const ecr = [{ label: 'UAN', csv: (x) => x.emp.uan }, { label: 'Name', csv: (x) => fullName(x.emp) }, { label: 'Gross wages', csv: (x) => Math.round(x.gross) }, { label: 'EPF wages', csv: (x) => Math.round(epf(x)) }, { label: 'EE share', csv: (x) => Math.round(ee(x)) }, { label: 'ER share', csv: (x) => Math.round(x.employer[0][1]) }];
    body = (
      <div className="pr-stack">
        <div className="row">
          <MonthSelect value={ym} onChange={setYm} months={months} />
        </div>
        <div className="pr-cards4">
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>PF (employee)</span><em>{`ER ${inr(sumOf(t.slips, (x) => x.employer[0][1]))}`}</em></div>
            <strong>{inr(sumDed('Provident'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>ESI (employee)</span></div>
            <strong>{inr(sumDed('ESI'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>Professional tax</span><em>{`LWF ${inr(sumDed('Labour'))}`}</em></div>
            <strong>{inr(sumDed('Professional'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>TDS deducted</span></div>
            <strong>{inr(sumDed('Income'))}</strong>
          </div>
        </div>
        <Panel title="PF ECR summary" right={<Btn kind="ghost" small icon="download" onClick={() => exportCSV(`pf-ecr-${ym}`, ecr, t.slips)}>Export ECR</Btn>}>
          <DataTable
            rows={t.slips}
            rowKey={(x) => x.emp.id}
            pageSize={30}
            columns={[
              { key: 'uan', label: 'UAN', sortable: false, render: (x) => x.emp.uan || '—' },
              { key: 'emp', label: 'Employee', sortable: false, render: (x) => fullName(x.emp) },
              { key: 'gross', label: 'Gross wages', render: (x) => money(x.gross) },
              { key: 'epf', label: 'EPF wages', sortable: false, render: (x) => money(epf(x)) },
              { key: 'ee', label: 'Employee 12%', sortable: false, render: (x) => money(ee(x)) },
              { key: 'er', label: 'Employer 12%', sortable: false, render: (x) => money(x.employer[0][1]) },
            ]}
          />
        </Panel>
      </div>
    );
  } else if (sub === 'tax') {
    body = (
      <Panel title="Investment declarations">
        <DataTable
          rows={db.taxDeclarations}
          empty="No declarations submitted."
          columns={[
            empCol(db),
            { key: 'fy', label: 'FY' },
            { key: 'regime', label: 'Regime' },
            { key: 'c80', label: '80C', sortable: false, render: (d) => money(declarationTotal(d).c80) },
            { key: 'rent', label: 'Rent / year', sortable: false, render: (d) => money(declarationTotal(d).hraRent) },
            { key: 'status', label: 'Status', render: (d) => <Badge>{d.status}</Badge> },
            { key: 'act', label: '', sortable: false, render: (d) => <Btn kind="ghost" small onClick={() => setDecl(d)}>View</Btn> },
          ]}
        />
      </Panel>
    );
  } else {
    body = (
      <Crud
        title="Salary revisions & promotions"
        collection="promotions"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ effectiveFrom: todayISO(), status: 'Pending' }}
        beforeSave={(v) => ({ ...v, oldCtc: v.oldCtc || empById(db, v.empId)?.ctc, oldDesignation: v.oldDesignation || empById(db, v.empId)?.designation })}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'newDesignation', label: 'New job title', type: 'select', options: db.designations.map((d) => d.title), required: true },
          { key: 'newGradeId', label: 'New band', type: 'select', options: db.grades.map((g) => ({ value: g.id, label: g.name })) },
          { key: 'newCtc', label: 'New annual CTC', type: 'number', required: true },
          { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
          { key: 'reason', label: 'Reason', type: 'textarea', full: true },
        ]}
        columns={[empCol(db), { key: 'oldDesignation', label: 'From' }, { key: 'newDesignation', label: 'To' }, { key: 'newCtc', label: 'New CTC', render: (p) => `${money(p.newCtc)}${p.oldCtc ? ` (+${Math.round(((p.newCtc - p.oldCtc) / p.oldCtc) * 100)}%)` : ''}` }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
        rowActions={(p) => <ApproveButtons db={db} user={user} col="promotions" row={p} kind="Promotion" />}
      />
    );
  }
  const b = emp && br(emp);
  return (
    <>
      {body}
      {slip && (
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<Btn icon="print" onClick={() => window.print()}>Print</Btn>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
      {decl && <FormModal title={`Declaration — ${fullName(empById(db, decl.empId))}`} fields={DECLARATION_FIELDS.map((f) => ({ ...f, disabled: true }))} initial={{ regime: decl.regime, ...decl.items }} submitLabel="Close" onClose={() => setDecl(null)} onSave={() => setDecl(null)} wide />}
      {emp && (
        <Modal title={`Salary structure — ${fullName(emp)}`} onClose={() => setEmp(null)} footer={<Btn onClick={() => (setRevise(emp), setEmp(null))}>Revise salary</Btn>}>
          <table className="pr-breakup">
            <thead>
              <tr>
                <th>Component</th>
                <th>Monthly</th>
                <th>Annual</th>
              </tr>
            </thead>
            <tbody>
              {[...b.earnings, ...b.employer].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{inr(v)}</td>
                  <td>{inr(v * 12)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Cost to company</td>
                <td>{inr(b.monthly)}</td>
                <td>{inr(emp.ctc)}</td>
              </tr>
            </tbody>
          </table>
        </Modal>
      )}
      {revise && (
        <FormModal
          title={`Revise salary — ${fullName(revise)}`}
          initial={{ newCtc: revise.ctc, newDesignation: revise.designation, effectiveFrom: todayISO() }}
          fields={[
            { key: 'newDesignation', label: 'Job title', type: 'select', options: db.designations.map((d) => d.title), required: true },
            { key: 'newCtc', label: 'New annual CTC', type: 'number', required: true },
            { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
            { key: 'reason', label: 'Reason', type: 'textarea', full: true },
          ]}
          onClose={() => setRevise(null)}
          onSave={(v) => {
            addItem('promotions', { ...v, empId: revise.id, oldCtc: revise.ctc, oldDesignation: revise.designation, newCtc: Number(v.newCtc), status: 'Pending' });
            setRevise(null);
            toast('Revision sent for approval');
          }}
        />
      )}
    </>
  );
}

// ---------- approvals ----------
function Approvals({ db, user, sub }) {
  const [all, setAll] = useState(false);
  const show = (rows) => (all ? rows : rows.filter((r) => r.status === 'Pending' || r.status === 'Submitted'));
  const toggle = (
    <label className="check">
      <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show decided requests too
    </label>
  );
  const status = { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> };
  if (sub === 'proofs') {
    const verify = (d) => {
      patchItem('taxDeclarations', d.id, { status: 'Verified' });
      notify(d.empId, 'Your investment proofs were verified.');
      toast('Verified');
    };
    return (
      <Panel title="Investment proofs" right={toggle}>
        <DataTable
          rows={show(db.taxDeclarations)}
          empty="No proofs waiting for verification."
          columns={[empCol(db), { key: 'fy', label: 'FY' }, { key: 'regime', label: 'Regime' }, { key: 'c80', label: '80C', sortable: false, render: (d) => money(declarationTotal(d).c80) }, status, { key: 'act', label: '', sortable: false, render: (d) => d.status === 'Submitted' && <Btn kind="success" small onClick={() => verify(d)}>Verify</Btn> }]}
        />
      </Panel>
    );
  }
  const cfg = {
    loans: { col: 'loans', kind: 'Loan', title: 'Loan requests', cols: [{ key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'tenureMonths', label: 'Months' }, { key: 'reason', label: 'Reason' }] },
    claims: { col: 'claims', kind: 'Claim', title: 'Reimbursement claims', cols: [{ key: 'component', label: 'Component' }, { key: 'month', label: 'For', render: (r) => (r.month ? monthLabel(r.month) : '—') }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'billName', label: 'Bill' }] },
    advances: { col: 'advances', kind: 'Advance', title: 'Salary & expense advances', cols: [{ key: 'purpose', label: 'Purpose' }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'requiredBy', label: 'Needed by', render: (r) => fmtDate(r.requiredBy) }] },
    revisions: { col: 'promotions', kind: 'Promotion', title: 'Salary revisions', cols: [{ key: 'newDesignation', label: 'Job title' }, { key: 'oldCtc', label: 'Current CTC', render: (r) => money(r.oldCtc) }, { key: 'newCtc', label: 'New CTC', render: (r) => money(r.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (r) => fmtDate(r.effectiveFrom) }] },
  }[sub];
  return (
    <Panel title={cfg.title} right={toggle}>
      <DataTable rows={show(db[cfg.col] || [])} empty="Nothing waiting for approval." columns={[empCol(db), ...cfg.cols, status, { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col={cfg.col} row={r} kind={cfg.kind} /> }]} />
    </Panel>
  );
}

// ---------- loans ----------
function Loans({ db, user }) {
  const ym = currentPayMonth(db);
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
  const paidMonths = (l) => (l.startMonth && l.startMonth < ym ? Math.min(Number(l.tenureMonths), monthsBetween(l.startMonth, ym)) : 0);
  const emi = (l) => Number(l.amount) / Number(l.tenureMonths || 1);
  const active = db.loans.filter((l) => l.status === 'Active');
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Active loans</span></div><strong>{active.length}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Amount lent</span></div><strong>{inr(sumOf(active, (l) => l.amount))}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Outstanding</span></div><strong>{inr(sumOf(active, (l) => l.amount - emi(l) * paidMonths(l)))}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>EMI this month</span><em>{shortMonth(ym)}</em></div><strong>{inr(sumOf(active.filter((l) => l.startMonth <= ym && paidMonths(l) < l.tenureMonths), emi))}</strong></div>
      </div>
      <Crud
        title="Loans & advances"
        collection="loans"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ status: 'Active', startMonth: addMonths(ymOf(), 1), tenureMonths: 6, interestRate: 0 }}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Salary Advance', 'Personal Loan', 'Vehicle Loan', 'Emergency Loan'], required: true },
          { key: 'amount', label: 'Amount', type: 'number', required: true },
          { key: 'interestRate', label: 'Interest rate (%)', type: 'number' },
          { key: 'tenureMonths', label: 'Tenure (months)', type: 'number', required: true },
          { key: 'startMonth', label: 'Deduction starts', type: 'month', required: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Active', 'Closed', 'Rejected'] },
          { key: 'reason', label: 'Reason', type: 'textarea', full: true },
        ]}
        columns={[empCol(db), { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount', render: (l) => money(l.amount) }, { key: 'emi', label: 'EMI', sortable: false, render: (l) => money(emi(l)) }, { key: 'paid', label: 'EMIs paid', sortable: false, render: (l) => `${paidMonths(l)}/${l.tenureMonths}` }, { key: 'startMonth', label: 'From', render: (l) => (l.startMonth ? monthLabel(l.startMonth) : '—') }, { key: 'status', label: 'Status', render: (l) => <Badge>{l.status}</Badge> }]}
        rowActions={(l) => <ApproveButtons db={db} user={user} col="loans" row={l} kind="Loan" />}
      />
    </div>
  );
}

// ---------- benefits ----------
function Benefits({ db }) {
  const plan = (id) => db.benefitPlans.find((p) => p.id === id);
  return (
    <div className="pr-stack">
      <Crud
        title="Benefit plans"
        collection="benefitPlans"
        searchKeys={['name', 'provider']}
        defaults={{ status: 'Active', type: 'Health insurance' }}
        fields={[
          { key: 'name', label: 'Plan name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Health insurance', 'Life insurance', 'Accident insurance', 'Retirement', 'Meal card', 'Fuel & vehicle', 'Wellness', 'Other'], required: true },
          { key: 'provider', label: 'Provider' },
          { key: 'policyNumber', label: 'Policy number' },
          { key: 'coverage', label: 'Cover amount', type: 'number' },
          { key: 'employerMonthly', label: 'Company pays / month', type: 'number' },
          { key: 'employeeMonthly', label: 'Employee pays / month', type: 'number' },
          { key: 'eligibility', label: 'Who is eligible', full: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Closed'] },
        ]}
        columns={[{ key: 'name', label: 'Plan' }, { key: 'type', label: 'Type' }, { key: 'provider', label: 'Provider' }, { key: 'coverage', label: 'Cover', render: (p) => (Number(p.coverage) ? money(p.coverage) : '—') }, { key: 'employerMonthly', label: 'Company / month', render: (p) => money(p.employerMonthly) }, { key: 'enrolled', label: 'Enrolled', sortable: false, render: (p) => db.benefitEnrollments.filter((x) => x.planId === p.id && x.status === 'Enrolled').length }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
      />
      <Crud
        title="Enrolments"
        collection="benefitEnrollments"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ status: 'Enrolled', tier: 'Employee only', startDate: todayISO() }}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'planId', label: 'Plan', type: 'select', options: db.benefitPlans.map((p) => ({ value: p.id, label: p.name })), required: true },
          { key: 'tier', label: 'Cover for', type: 'select', options: ['Employee only', 'Employee + spouse', 'Employee + family', 'Employee + family + parents'] },
          { key: 'dependents', label: 'Dependents covered', full: true },
          { key: 'startDate', label: 'Start date', type: 'date', required: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Enrolled', 'Opted out', 'Ended'] },
        ]}
        columns={[empCol(db), { key: 'planId', label: 'Plan', render: (r) => plan(r.planId)?.name || '—' }, { key: 'tier', label: 'Cover for' }, { key: 'startDate', label: 'Since', render: (r) => fmtDate(r.startDate) }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Enrolled' ? 'green' : 'grey'}>{r.status}</Badge> }]}
      />
    </div>
  );
}

// ---------- reports ----------
function Reports({ db }) {
  const cur = currentPayMonth(db);
  const months = [...new Set([cur, ...db.payrollRuns.map((r) => r.month)])].sort().reverse();
  const [ym, setYm] = useState(months[1] || months[0]);
  const ded = (prefix) => (x) => Math.round(x.deductions.find((d) => d[0].startsWith(prefix))?.[1] || 0);
  const base = [{ label: 'Employee', csv: (x) => fullName(x.emp) }, { label: 'Emp no', csv: (x) => x.emp.empNo }];
  const slips = () => monthTotals(db, ym).slips;
  const prevNet = (prev, x) => prev.find((p) => p.emp.id === x.emp.id)?.net || 0;
  const variance = () => {
    const prev = monthTotals(db, addMonths(ym, -1)).slips;
    exportCSV(`variance-${ym}`, [...base, { label: 'Previous net', csv: (x) => Math.round(prevNet(prev, x)) }, { label: 'This month net', csv: (x) => Math.round(x.net) }, { label: 'Difference', csv: (x) => Math.round(x.net - prevNet(prev, x)) }], slips());
  };
  const REPORTS = [
    ['Payroll register', 'Every earning and deduction for each employee.', () => exportCSV(`payroll-register-${ym}`, [...base, { label: 'Paid days', csv: (x) => x.paidDays }, ...salaryBreakup(0, db.payrollSettings).earnings.map(([k], i) => ({ label: k, csv: (x) => Math.round(x.earnings[i][1]) })), { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'PF', csv: ded('Provident') }, { label: 'ESI', csv: ded('ESI') }, { label: 'PT', csv: ded('Professional') }, { label: 'LWF', csv: ded('Labour') }, { label: 'TDS', csv: ded('Income') }, { label: 'Total deductions', csv: (x) => Math.round(x.totalDed) }, { label: 'Net pay', csv: (x) => Math.round(x.net) }], slips())],
    ['Bank transfer statement', 'Account details and net pay for the bank upload.', () => exportCSV(`bank-transfer-${ym}`, [...base, { label: 'Account holder', csv: (x) => x.emp.bank?.accountHolder }, { label: 'Bank', csv: (x) => x.emp.bank?.bankName }, { label: 'Account number', csv: (x) => x.emp.bank?.accountNumber }, { label: 'IFSC', csv: (x) => x.emp.bank?.ifsc }, { label: 'Net pay', csv: (x) => Math.round(x.net) }], slips().filter((x) => !x.onHold))],
    ['PF ECR', 'Provident fund wages and shares for the ECR upload.', () => exportCSV(`pf-ecr-${ym}`, [{ label: 'UAN', csv: (x) => x.emp.uan }, ...base, { label: 'Gross wages', csv: (x) => Math.round(x.gross) }, { label: 'EPF wages', csv: (x) => Math.round(Math.min(x.earnings[0][1], db.payrollSettings.pfCeiling)) }, { label: 'EE share', csv: ded('Provident') }, { label: 'ER share', csv: (x) => Math.round(x.employer[0][1]) }], slips())],
    ['ESI contribution', 'Employees covered by ESI and their contributions.', () => exportCSV(`esi-${ym}`, [...base, { label: 'ESI number', csv: (x) => x.emp.esiNumber }, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'Employee 0.75%', csv: ded('ESI') }], slips().filter((x) => ded('ESI')(x) > 0))],
    ['Professional tax', 'PT deducted for each employee.', () => exportCSV(`pt-${ym}`, [...base, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'PT', csv: ded('Professional') }], slips())],
    ['Labour welfare fund', 'LWF deducted this month.', () => exportCSV(`lwf-${ym}`, [...base, { label: 'Employee LWF', csv: ded('Labour') }, { label: 'Employer LWF', csv: () => Number(db.payrollSettings.lwfEmployer || 0) }], slips().filter((x) => ded('Labour')(x) > 0))],
    ['TDS summary', 'Income tax deducted, with PAN and tax regime.', () => exportCSV(`tds-${ym}`, [...base, { label: 'PAN', csv: (x) => x.emp.pan }, { label: 'Regime', csv: (x) => x.regime }, { label: 'TDS', csv: ded('Income') }], slips())],
    ['CTC report', 'Annual CTC, band and department of every employee.', () => exportCSV('ctc-report', [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Department', csv: (e) => e.department }, { label: 'Band', csv: (e) => bandOf(db, e)?.name }, { label: 'Annual CTC', csv: (e) => e.ctc }], db.employees.filter((e) => e.status !== 'Exited'))],
    ['Variance report', 'Change in net pay against the month before.', variance],
    ['Loan outstanding', 'Active loans with EMI and tenure.', () => exportCSV('loans', [{ label: 'Employee', csv: (l) => fullName(empById(db, l.empId)) }, { label: 'Type', csv: (l) => l.type }, { label: 'Amount', csv: (l) => l.amount }, { label: 'EMI', csv: (l) => Math.round(l.amount / l.tenureMonths) }, { label: 'Start', csv: (l) => l.startMonth }, { label: 'Status', csv: (l) => l.status }], db.loans)],
    ['Salaries on hold', 'Employees whose pay is held this month.', () => exportCSV(`holds-${ym}`, [...base, { label: 'Net pay held', csv: (x) => Math.round(x.net) }], slips().filter((x) => x.onHold))],
    ['Reimbursements paid', 'Claims and expenses paid through payroll.', () => exportCSV(`reimbursements-${ym}`, [{ label: 'Employee', csv: (a) => fullName(empById(db, a.empId)) }, { label: 'Type', csv: (a) => a.kind }, { label: 'Amount', csv: (a) => a.amount }, { label: 'Note', csv: (a) => a.note }], db.payrollAdjustments.filter((a) => a.month === ym && a.kind === 'Reimbursement'))],
  ];
  return (
    <div className="pr-stack">
      <div className="pr-section-head">
        <h2>Payroll reports</h2>
        <MonthSelect value={ym} onChange={setYm} months={months} />
      </div>
      <div className="pr-reports">
        {REPORTS.map(([name, about, download]) => (
          <section key={name} className="pr-panel pr-report">
            <h3>{name}</h3>
            <p className="pr-muted">{about}</p>
            <Btn kind="ghost" small icon="download" onClick={download}>
              Download
            </Btn>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------- settings ----------
const PAYROLL_SETTING_FIELDS = [
  { key: 'payGroup', label: 'Pay group name', section: 'Pay cycle' },
  { key: 'cycleStartDay', label: 'Pay cycle starts on day', type: 'number', min: 1, max: 28, help: '26 means November payroll covers 26 Oct – 25 Nov. Use 1 for calendar months.', section: 'Pay cycle' },
  { key: 'payDay', label: 'Pay day', type: 'select', options: ['Last working day', '1st of next month', '7th of next month'], section: 'Pay cycle' },
  { key: 'lockDay', label: 'Attendance & inputs lock day', type: 'number', section: 'Pay cycle' },
  { key: 'basicPct', label: 'Basic (% of CTC)', type: 'number', section: 'Salary structure' },
  { key: 'hraPct', label: 'HRA (% of basic)', type: 'number', section: 'Salary structure' },
  { key: 'conveyance', label: 'Conveyance allowance / month', type: 'number', section: 'Salary structure' },
  { key: 'medical', label: 'Medical allowance / month', type: 'number', section: 'Salary structure' },
  { key: 'pfEnabled', label: 'Provident Fund enabled', type: 'checkbox', section: 'Statutory' },
  { key: 'pfCeiling', label: 'PF wage ceiling', type: 'number', section: 'Statutory' },
  { key: 'esiEnabled', label: 'ESI enabled (gross up to ₹21,000)', type: 'checkbox', section: 'Statutory' },
  { key: 'ptEnabled', label: 'Professional tax enabled', type: 'checkbox', section: 'Statutory' },
  { key: 'ptAmount', label: 'Professional tax / month', type: 'number', section: 'Statutory' },
  { key: 'lwfEnabled', label: 'Labour welfare fund enabled', type: 'checkbox', section: 'Statutory' },
  { key: 'lwfEmployee', label: 'LWF employee share', type: 'number', section: 'Statutory' },
  { key: 'lwfEmployer', label: 'LWF employer share', type: 'number', section: 'Statutory' },
];

function PayrollSettings({ db }) {
  const [v, setV] = useState(db.payrollSettings);
  const save = () => {
    update((d) => (d.payrollSettings = { ...v, cycleStartDay: Math.min(28, Math.max(1, Number(v.cycleStartDay) || 1)) }));
    toast('Payroll settings saved');
  };
  return (
    <Panel title="Payroll settings" right={<Btn small onClick={save}>Save</Btn>}>
      <FormGrid fields={PAYROLL_SETTING_FIELDS} values={v} setValues={setV} db={db} />
      <p className="pr-muted" style={{ marginTop: 12 }}>
        Special allowance balances the gross to CTC after employer PF and gratuity (4.81% of basic).
      </p>
    </Panel>
  );
}
