// Payroll module laid out like the company's own payroll screens: module tabs,
// analytics, the run-payroll cycle with its six input steps, admin, approvals,
// loans, benefits, reports and settings.
import { useEffect, useMemo, useState } from 'react';
import { useDB, addItem, patchItem, removeItem, update, uid, notify } from '../store.js';
import { Icon, Btn, Badge, DataTable, FormModal, EmpChip, Crud, Modal, FormGrid, Tabs, NavTabs, toast, confirmAction, exportCSV, exportText, ReasonModal, Dropdown } from '../ui.jsx';
import { PayslipView, DECLARATION_FIELDS } from './Finances.jsx';
import { ApproveButtons, empCol } from './AdminOps.jsx';
import { empById, fullName, fmtDate, money, monthLabel, payslipFor, ymOf, addMonths, addDays, todayISO, declarationTotal, cycleRange, cycleDays, payrollPeople, attendanceFor, taxProjection, fyOf, cycleStartOf, loanEmi, loanOutstanding, loanPaidBefore, salaryBreakup, breakupFor, payGroupOf, structureOf, settingsFor, structureFromSettings, GRATUITY_DEFAULTS, gratuityPolicy, gratuityPayable, groupFromSettings, COMPONENT_TYPES, MONTHS, pad } from '../utils.js';
import { EXIT_DEFAULTS, exitPolicy, WAGE_DEFAULTS, wagePolicy, wageShare, PF_DEFAULTS, ESI_DEFAULTS, PT_DEFAULTS, LWF_DEFAULTS, pfPolicy, esiPolicy, ptPolicy, lwfPolicy, ptHalfYear, ptMonthly, pfCeilingOn, pfOf, esiPeriodOf } from '../statutory.js';
import { ecrFile, esiRows, pfTotals, ESI_COLUMNS } from '../statutoryFiles.js';
import { payrollRegister } from '../register.js';
import { downloadPayslipPdf } from '../payslipPdf.js';
import { MAIL_DEFAULTS, mailSettings, smtpReady, queuePayslipMail } from '../payslipMail.js';
import { exceptionDays, unresolvedDays, setResolution, RESOLUTIONS } from '../attendanceExceptions.js';
import { approvalPolicy, approverIds, isApprover, canApproveRun, canApproveUnlock, lockRun, submitRun, withdrawRun, approveRun, rejectRun, unlockRun, requestUnlock, approveUnlock, rejectUnlock, cancelUnlock, markInputsChanged, saveApprovalSettings } from '../payrollApproval.js';
import '../payroll.css';
import '../payrollx.css';
import { MonthRail, GateLine, CostTape, SplitBar, ShareTable, VarianceRows, lakh } from './payrollViews.jsx';

// ---------- helpers ----------
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#64748b', '#2563eb', '#84cc16'];
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

function payrollErrors(people, slips, open = []) {
  const out = [];
  // Absent / Action Required days with no decision from HR yet (see Attendance exceptions).
  [...new Set(open.map((x) => x.emp.id))].forEach((id) => {
    const mine = open.filter((x) => x.emp.id === id);
    out.push({ emp: mine[0].emp, text: `${mine.length} attendance day(s) have no decision yet. Decide them in “Leave, Attendance & Payable Units”.`, fixStep: 'attendance' });
  });
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
    touchRun(d, ym);
    markInputsChanged(d, ym, user);
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
  else body = <PayrollSettings db={db} user={user} />;

  return (
    <div className="pr">
      <NavTabs className="pr-modules" variant="underline" glideSelector=".pr-body" label="Payroll" items={MODULES.map((m) => ({ key: m.key, label: m.label, href: `#/admin/payroll/${m.key}` }))} active={mod} />
      {subs && <NavTabs className="pr-subs" glideSelector=".pr-body" label={`${mod} sections`} items={subs.map(([k, label]) => ({ key: k, label, href: `#/admin/payroll/${mod}/${k}` }))} active={sub} />}
      <div className="pr-body page-enter">
        <div className="pr-entity">
          <Dropdown value={entity} onChange={setEntity} options={entities.length ? entities : [db.company.name]} label="Legal entity" />
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
function Analytics({ db }) {
  const cur = currentPayMonth(db);
  const lastRun = db.payrollRuns.filter(isDone).sort((a, b) => b.month.localeCompare(a.month))[0];
  const lastT = useMemo(() => (lastRun ? monthTotals(db, lastRun.month) : null), [db, lastRun]);
  const upT = useMemo(() => monthTotals(db, cur), [db, cur]);
  const today = todayISO();
  const upcoming = db.promotions.filter((p) => p.status === 'Approved' && p.effectiveFrom > today && p.effectiveFrom <= addDays(today, 92));
  const pending = db.promotions.filter((p) => p.status === 'Pending');
  const [list, setList] = useState(null);
  const [by, setBy] = useState('department');
  const firstFy = fyStart([...db.payrollRuns.map((r) => r.month), cur].sort()[0]);
  const fys = [];
  for (let f = fyStart(cur); f >= firstFy; f = addMonths(f, -12)) fys.push(f);
  const [fy, setFy] = useState(fys[0]);
  const people = db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding');
  const group = (key) => {
    const m = new Map();
    people.forEach((e) => {
      const g = m.get(key(e)) || { value: 0, count: 0 };
      m.set(key(e), { value: g.value + Number(e.ctc || 0), count: g.count + 1 });
    });
    return [...m].map(([label, g]) => ({ label, ...g })).sort((x, y) => y.value - x.value);
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

  const split = lastT ? [{ label: 'Take-home pay', value: lastT.deposit, color: 'var(--px-ink)' }, { label: 'Deductions', value: lastT.deductions, color: 'var(--px-steel)' }, { label: 'Employer contributions', value: lastT.contributions, color: 'var(--px-faint)' }] : null;
  const shown = by === 'department' ? group((e) => e.department) : group(locName);

  return (
    <div className="px">
      <section className="px-lede">
        <div className="px-lede-main">
          {lastT ? (
            <>
              <h2 className="px-title" style={{ marginBottom: 0 }}>{`Last payroll, ${monthLabel(lastRun.month)}`}</h2>
              <span className="px-fig">{lakh(lastT.cost)}</span>
              <p>{`What it cost to pay ${lastT.people.length} people: what they took home, what was deducted for them, and what the company paid on top.`}</p>
              <SplitBar parts={split} />
            </>
          ) : (
            <>
              <h2 className="px-title" style={{ marginBottom: 0 }}>No payroll locked yet</h2>
              <p>Once the first month is locked, its cost and where it went show up here.</p>
            </>
          )}
        </div>
        <aside className="px-next" aria-label="Coming up">
          <h3>Coming up</h3>
          <div className="px-next-row">
            <div>
              <span>{`${monthLabel(cur)} payroll, as it stands`}</span>
              <b className="px-fig">{lakh(upT.cost)}</b>
            </div>
          </div>
          <div className="px-next-row">
            <div>
              <span>Revisions starting in the next 3 months</span>
              <b className="px-fig">{upcoming.length}</b>
            </div>
            {upcoming.length > 0 && <button onClick={() => setList('upcoming')}>See who</button>}
          </div>
          <div className="px-next-row">
            <div>
              <span>Revisions waiting for approval</span>
              <b className="px-fig">{pending.length}</b>
            </div>
            {pending.length > 0 && <button onClick={() => setList('pending')}>See who</button>}
          </div>
        </aside>
      </section>

      <section>
        <div className="px-section-head">
          <div>
            <h2>Who the money goes to</h2>
            <p>Annual CTC of everyone on payroll today, largest first.</p>
          </div>
          <div className="px-seg" role="group" aria-label="Group by">
            <button aria-pressed={by === 'department'} onClick={() => setBy('department')}>Department</button>
            <button aria-pressed={by === 'location'} onClick={() => setBy('location')}>Location</button>
          </div>
        </div>
        <ShareTable rows={shown} noun={by === 'department' ? 'Department' : 'Location'} />
      </section>

      <section>
        <div className="px-section-head">
          <div>
            <h2>Plan against actual</h2>
            <p>What each month was planned at from everyone’s CTC, against what payroll cost.</p>
          </div>
          <div className="row" style={{ gap: 20, alignItems: 'center' }}>
            <div className="px-var-key">
              <span className="plan">Planned</span>
              <span className="act">Paid</span>
            </div>
            <select className="px-select" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
              {fys.map((f) => (
                <option key={f} value={f}>
                  {fyName(f)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {chart.length ? <VarianceRows rows={chart} label={(m) => shortMonth(m)} /> : <p className="px-empty">No month of this financial year has been locked yet.</p>}
      </section>
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
  { key: 'bonus', title: 'Bonus & Salary Revisions', icon: 'briefcase', tone: '#8d93d8' },
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

function RunPayroll({ user, month }) {
  const db = useDB();
  const s = db.payrollSettings;
  const cur = currentPayMonth(db);
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : cur;
  const [fy, setFy] = useState(fyStart(ym));
  const [step, setStep] = useState(null);
  const [modal, setModal] = useState(null);
  const [slip, setSlip] = useState(null);
  const [panels, setPanels] = useState({ activity: false, help: false });
  const [reason, setReason] = useState(null);
  useEffect(() => setFy(fyStart(ym)), [ym]);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const prev = useMemo(() => monthTotals(db, addMonths(ym, -1)), [db, ym]);
  const [from, to] = cycleRange(ym, s.cycleStartDay);
  const days = cycleDays(ym, s.cycleStartDay);
  const joiners = t.people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
  const exits = db.exits.filter((x) => x.lastWorkingDay >= from && x.lastWorkingDay <= to);
  const undecided = useMemo(() => unresolvedDays(db, ym), [db, ym]);
  const errors = payrollErrors(t.people, t.slips, undecided);
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
  // Run one approval action; show its error, or the message when it worked.
  const act = (fn, okText) => {
    let res;
    update((d) => {
      res = fn(d);
    });
    if (!res.ok) toast(res.error, 'error');
    else if (okText) toast(okText);
    return res.ok;
  };
  const sep = approvalPolicy(db).separate;
  const who = (id) => shortName(empById(db, id));
  const waitingOn = approverIds(db).filter((id) => id !== run?.submittedBy).map(who).join(', ');
  const lock = () => {
    if (!confirmAction(`Lock payroll for ${monthLabel(ym)}? Inputs can't be changed after this.`)) return;
    act((d) => lockRun(d, ym, user), `Payroll locked for ${monthLabel(ym)}`);
  };
  const submit = () => {
    if (!confirmAction(`Submit payroll for ${monthLabel(ym)} for approval?`)) return;
    act((d) => submitRun(d, ym, user), 'Submitted for approval');
  };
  const approve = () => {
    if (!confirmAction(`Approve and lock payroll for ${monthLabel(ym)}? Inputs can't be changed after this.`)) return;
    act((d) => approveRun(d, ym, user), `Payroll approved and locked for ${monthLabel(ym)}`);
  };
  const release = () => {
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Paid', releasedAt: new Date().toISOString() });
      logActivity(d, ym, user, 'Released payslips');
      const queued = queuePayslipMail(d, ym, t.slips.filter((x) => !x.onHold).map((x) => x.emp));
      if (queued) logActivity(d, ym, user, `Put ${queued} payslip email(s) in the outbox`);
    });
    t.slips.filter((x) => !x.onHold).forEach((x) => notify(x.emp.id, `Your payslip for ${monthLabel(ym)} is ready.`, 'finances/payslips'));
    toast('Payslips released');
  };
  const processed = run?.processedAt ? new Date(run.processedAt) : null;
  let footNote;
  if (done) footNote = `Payroll was locked${run.lockedAt ? ` on ${stamp(run.lockedAt)}` : ''}${run.lockedBy ? ` by ${who(run.lockedBy)}` : ''}${run.approvedBy && run.submittedBy ? ` (submitted by ${who(run.submittedBy)}, approved by ${who(run.approvedBy)})` : ''}${run.status === 'Paid' ? ' and payslips were released' : ''}`;
  else if (run?.status === 'Submitted') footNote = `Submitted for approval on ${stamp(run.submittedAt)} by ${who(run.submittedBy)}`;
  else if (processed) footNote = `Payroll was last processed on ${pad(processed.getDate())} ${MONTHS[processed.getMonth()].slice(0, 3)} at ${stamp(run.processedAt).slice(-8)} by ${shortName(empById(db, run.processedBy))}`;
  else if (upcoming) footNote = `Payroll for ${monthLabel(ym)} opens once ${monthLabel(cur)} is locked`;
  else footNote = 'Payroll has not been processed for this month yet';

  // Where the month stands: five gates, and the one thing to do at the gate it has reached.
  const processedOk = !!run?.processedAt && !run.dirty;
  const hasErrors = errors.length > 0;
  const submitted = run?.status === 'Submitted';
  const gates = [
    { key: 'inputs', label: 'Inputs', state: stepsDone === STEPS.length ? 'cleared' : 'open', note: `${stepsDone} of ${STEPS.length} saved` },
    { key: 'process', label: 'Process', state: upcoming ? 'idle' : processedOk ? 'cleared' : 'active', note: processedOk ? `${run.processedCount ?? payable} employees` : run?.dirty ? 'Inputs changed' : 'Not run yet' },
    { key: 'review', label: 'Review', state: !processedOk ? 'idle' : hasErrors ? 'blocked' : 'cleared', note: !processedOk ? 'After processing' : hasErrors ? `${errors.length} to fix` : 'Nothing in the way' },
    { key: 'lock', label: sep ? 'Approve and lock' : 'Lock', state: done ? 'cleared' : submitted ? 'waiting' : processedOk && !hasErrors ? 'active' : 'idle', note: done ? (run.lockedBy ? `By ${who(run.lockedBy)}` : 'Locked') : submitted ? `Waiting for ${waitingOn || 'an approver'}` : sep ? 'Needs a second person' : 'Freezes the payslips' },
    { key: 'release', label: 'Release', state: run?.status === 'Paid' ? 'cleared' : run?.status === 'Finalized' ? 'active' : 'idle', note: run?.status === 'Paid' ? 'Payslips released' : 'Payslips reach staff' },
  ];
  let now;
  if (upcoming) now = { title: 'Not open yet', text: `${monthLabel(ym)} opens once ${monthLabel(cur)} is locked.` };
  else if (run?.status === 'Paid') now = { title: 'Done. Payslips are released', text: 'Everyone has been notified, and their payslip emails are in the outbox.' };
  else if (run?.status === 'Finalized') now = { title: 'Locked. Payslips are not released yet', text: 'Releasing notifies every employee and queues their payslip emails.' };
  else if (submitted) now = { title: 'Waiting for approval', text: run.submittedBy === user.id ? `Waiting for ${waitingOn || 'an approver'} to approve it. You submitted it, so you cannot.` : `${who(run.submittedBy)} submitted it. ${canApproveRun(db, user, run) ? 'You can approve or send it back.' : `Waiting for ${waitingOn || 'an approver'}.`}` };
  else if (!processedOk) now = { title: run?.dirty ? 'Inputs changed since the last run' : 'Ready to process', text: run?.dirty ? 'Save the steps you changed, then process again so the payslips match.' : `Processing works out a payslip for each of the ${payable} employees.` };
  else if (hasErrors) now = { title: errors.length === 1 ? 'One thing is in the way' : `${errors.length} things are in the way`, text: 'The month cannot lock until these are clear. Process again after you fix them.' };
  else now = { title: sep ? 'Ready to submit for approval' : 'Ready to lock', text: `${sep ? 'A second person approves, and approval locks the month.' : 'Locking freezes every payslip. Inputs cannot change after this.'} Look over every employee’s pay first.` };

  let primaryKey = null;
  if (!upcoming) {
    if (done) primaryKey = run.status === 'Finalized' ? (run.unlockRequest && canApproveUnlock(db, user, run) ? 'approveUnlock' : 'release') : null;
    else if (submitted) primaryKey = canApproveRun(db, user, run) ? 'approve' : null;
    else if (!processedOk) primaryKey = 'process';
    else if (hasErrors) primaryKey = 'fix';
    else primaryKey = sep ? 'submit' : 'lock';
  }
  const locked = run?.status === 'Finalized';
  const acts = [
    { k: 'process', show: !done, label: processedOk ? 'Process again' : 'Process payroll', onClick: process, disabled: upcoming || submitted },
    { k: 'fix', show: !done && hasErrors && processedOk, label: errors.length === 1 ? 'Fix the issue' : `Fix ${errors.length} issues`, onClick: () => setModal('errors') },
    { k: 'lock', show: !done && !sep, label: 'Lock payroll', onClick: lock, disabled: !canLock || upcoming, title: canLock ? '' : 'Process payroll and fix everything in the way first' },
    { k: 'submit', show: !done && sep && !submitted, label: 'Submit for approval', onClick: submit, disabled: !canLock || upcoming, title: canLock ? '' : 'Process payroll and fix everything in the way first' },
    { k: 'approve', show: !done && sep && submitted && canApproveRun(db, user, run), label: 'Approve and lock', onClick: approve },
    { k: 'sendBack', show: !done && sep && submitted && canApproveRun(db, user, run), label: 'Send back', onClick: () => setReason('sendBack') },
    { k: 'withdraw', show: !done && sep && submitted && (run.submittedBy === user.id || user.role === 'admin'), label: 'Withdraw', onClick: () => act((d) => withdrawRun(d, ym, user), 'Withdrawn from approval') },
    { k: 'release', show: locked, label: 'Release payslips', onClick: release },
    { k: 'approveUnlock', show: locked && run.unlockRequest && canApproveUnlock(db, user, run), label: 'Approve unlock', onClick: () => act((d) => approveUnlock(d, ym, user), 'Payroll unlocked') },
    { k: 'declineUnlock', show: locked && run.unlockRequest && canApproveUnlock(db, user, run), label: 'Decline unlock', onClick: () => setReason('declineUnlock') },
    { k: 'cancelUnlock', show: locked && run.unlockRequest && run.unlockRequest.by === user.id, label: 'Withdraw unlock request', onClick: () => act((d) => cancelUnlock(d, ym, user), 'Unlock request withdrawn') },
    { k: 'unlock', show: locked && !run.unlockRequest, label: sep ? 'Request unlock' : 'Unlock payroll', onClick: () => setReason('unlock') },
    { k: 'review', show: true, label: 'Review all employees', onClick: () => setModal('review'), review: true },
    { k: 'register', show: true, label: 'Payroll register', onClick: () => setModal('register'), quiet: true },
  ].filter((a) => a.show);
  // The main action first, then the review of every employee's pay (the check that matters before locking), then the rest.
  const ordered = [...acts.filter((a) => a.k === primaryKey), ...acts.filter((a) => a.k === 'review' && a.k !== primaryKey), ...acts.filter((a) => a.k !== primaryKey && a.k !== 'review')];
  const dm = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
  const [cf0, ct0] = cycleRange(ym, s.cycleStartDay);
  const joined = joiners.length;
  const left = exits.length;
  const againstPrev = shortMonth(prevYm);

  return (
    <div className="px">
      <MonthRail
        months={months}
        ym={ym}
        stateOf={stateOf}
        short={(m) => MONTHS[Number(m.slice(5)) - 1].slice(0, 3)}
        hint={(m) => `${shortMonth(m)}, ${cycleRange(m, s.cycleStartDay).map(dm).join(' to ')}`}
        onPick={(m) => goto(`run/${m}`)}
        onPrev={() => setFy(addMonths(fy, -12))}
        onNext={() => setFy(addMonths(fy, 12))}
      />

      <header className="px-head">
        <h2 className="px-month">{monthLabel(ym)}</h2>
        <span className="px-cycle">{`${dm(cf0)} to ${dm(ct0)}, ${days} days`}</span>
      </header>

      <div className="px-run">
        <div className="px-main">
          <section aria-label="Where this month stands">
            <GateLine gates={gates} />
            <div className="px-now">
              <h3>{now.title}</h3>
              <p>{now.text}</p>
              {(run?.rejection && run.status === 'Processed' && !done) || (run?.unlockRequest && locked) ? (
                <div className="px-notes">
                  {run?.rejection && run.status === 'Processed' && !done && <p>{`Sent back by ${who(run.rejection.by)}: “${run.rejection.reason}”`}</p>}
                  {run?.unlockRequest && locked && <p>{`${who(run.unlockRequest.by)} asked to unlock this month: “${run.unlockRequest.reason}”${canApproveUnlock(db, user, run) ? '' : `. Waiting for ${approverIds(db).filter((id) => id !== run.unlockRequest.by).map(who).join(', ')}.`}`}</p>}
                </div>
              ) : null}
              <div className="px-actions">
                {ordered.map((a) => (
                  <button key={a.k} className={`px-btn ${a.k === primaryKey ? 'primary' : a.review ? 'review' : a.quiet ? 'quiet' : ''}`} onClick={a.onClick} disabled={a.disabled} title={a.title}>
                    {a.review && <Icon name="team" size={16} />}
                    {a.label}
                    {a.review && <span className="px-count">{t.people.length}</span>}
                  </button>
                ))}
              </div>
              <p className="px-foot">{footNote}</p>
              {hasErrors && !done && (
                <div className="px-block">
                  <h4 className="px-block-title">{`In the way (${errors.length})`}</h4>
                  {errors.slice(0, 4).map((e, i) => (
                    <div className="px-block-row" key={i}>
                      <b>{fullName(e.emp)}</b>
                      <span>{e.text}</span>
                    </div>
                  ))}
                  <button className="px-btn quiet px-block-more" onClick={() => setModal('errors')}>
                    {errors.length > 4 ? `See all ${errors.length} and fix them` : 'Open and fix'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section aria-label="Inputs">
            <h3 className="px-title">
              Inputs<small>{`${stepsDone} of ${STEPS.length} saved. Open one to check or change it.`}</small>
            </h3>
            <ul className="px-ledger">
              {STEPS.map((st) => {
                const info = run?.steps?.[st.key];
                return (
                  <li key={st.key}>
                    <button className={info ? 'saved' : ''} onClick={() => setStep(st)}>
                      <span className="px-mark">{info && <Icon name="check" size={11} />}</span>
                      <span>
                        <span className="px-ledger-title">{st.title}</span>
                        <span className="px-ledger-sub">{info ? `Saved ${stamp(info.at)} by ${shortName(empById(db, info.by))}` : 'Nothing saved yet'}</span>
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="px-side">
          <CostTape
            against={againstPrev}
            parts={[
              { label: 'Take-home pay', value: t.deposit, delta: t.deposit - prev.deposit },
              { label: 'Deductions', value: t.deductions, delta: t.deductions - prev.deductions },
              { label: 'Employer contributions', value: t.contributions, delta: t.contributions - prev.contributions },
            ]}
            total={{ value: t.cost, delta: t.cost - prev.cost }}
          >
            <div className="px-people">
              <span>
                <b>{t.people.length}</b> employees{joined || left ? `, ${joined} joined and ${left} left this cycle` : ''}
              </span>
              <span>
                <b>{run?.processedAt ? run.processedCount ?? payable : 0}</b> of {t.people.length} processed
              </span>
            </div>
          </CostTape>

          <section aria-label="Activity">
            <h3 className="px-title">Activity</h3>
            {activity.length === 0 ? (
              <p className="px-muted">Nothing has happened to this month yet.</p>
            ) : (
              <ul className="px-feed">
                {activity.slice(0, panels.activity ? 30 : 6).map((a) => (
                  <li key={a.id}>
                    <span>{a.text}</span>
                    <small>{`${stamp(a.at)}, ${shortName(empById(db, a.by))}`}</small>
                  </li>
                ))}
              </ul>
            )}
            {activity.length > 6 && (
              <button className="px-btn quiet" style={{ paddingInline: 0 }} onClick={() => setPanels({ ...panels, activity: !panels.activity })}>
                {panels.activity ? 'Show fewer' : `Show all ${Math.min(activity.length, 30)}`}
              </button>
            )}
          </section>

          <section aria-label="Help">
            <h3 className="px-title">Need a hand?</h3>
            <div className="px-links">
              <button onClick={() => setModal('tour')}>Take the guided tour</button>
              {HELP.map(([q], i) => (
                <button key={q} onClick={() => setModal(i)}>
                  {q}
                </button>
              ))}
              <a href="#/me/helpdesk">Raise a helpdesk ticket</a>
            </div>
          </section>
        </aside>
      </div>

      {reason === 'unlock' && (
        <ReasonModal
          title={sep ? 'Request to unlock payroll' : 'Unlock payroll'}
          label="Why does this month need to be unlocked?"
          help={sep ? `${monthLabel(ym)} stays locked until an approver agrees. The reason is kept in the activity log.` : `${monthLabel(ym)} goes back to being editable and its payslips are worked out again from live data. The reason is kept in the activity log.`}
          confirmText={sep ? 'Send request' : 'Unlock'}
          danger={!sep}
          onClose={() => setReason(null)}
          onConfirm={(text) => (sep ? act((d) => requestUnlock(d, ym, user, text), 'Unlock request sent') : act((d) => unlockRun(d, ym, user, text), 'Payroll unlocked'))}
        />
      )}
      {reason === 'sendBack' && <ReasonModal title="Send payroll back" label="What needs to be fixed?" confirmText="Send back" danger onClose={() => setReason(null)} onConfirm={(text) => act((d) => rejectRun(d, ym, user, text), 'Sent back')} />}
      {reason === 'declineUnlock' && <ReasonModal title="Decline the unlock request" label="Why not?" confirmText="Decline" danger onClose={() => setReason(null)} onConfirm={(text) => act((d) => rejectUnlock(d, ym, user, text), 'Request declined')} />}
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
              { key: 'fix', label: '', sortable: false, render: (r) => (r.fixStep ? <Btn kind="ghost" small onClick={() => { setModal(null); setStep(STEPS.find((x) => x.key === r.fixStep)); }}>Decide</Btn> : <a className="btn btn-ghost btn-sm" href={`#/profile/${r.emp.id}`}>Fix in profile</a>) },
            ]}
          />
        </Modal>
      )}
      {modal === 'register' && <RegisterModal db={db} ym={ym} onClose={() => setModal(null)} />}
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
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<><Btn kind="ghost" icon="download" onClick={() => downloadPayslipPdf(db, slip)} title="Password: employee number followed by date of birth (DDMMYYYY)">PDF (password protected)</Btn><Btn icon="print" onClick={() => window.print()}>Print</Btn></>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
    </div>
  );
}

// Download the payroll register for the month, for all pay groups or one.
function RegisterModal({ db, ym, onClose }) {
  const [groupId, setGroupId] = useState('');
  const reg = useMemo(() => payrollRegister(db, ym, groupId), [db, ym, groupId]);
  const group = (db.payGroups || []).find((g) => g.id === groupId);
  const download = () => exportCSV(`payroll-register-${ym}${group ? `-${group.name.replace(/\s+/g, '-').toLowerCase()}` : ''}`, reg.columns, reg.rows);
  return (
    <Modal
      title={`Payroll register — ${monthLabel(ym)}`}
      onClose={onClose}
      footer={
        <Btn icon="download" disabled={!reg.count} onClick={download}>
          Download register (CSV)
        </Btn>
      }
    >
      <div className="field">
        <label htmlFor="reg_group">Pay group</label>
        <select id="reg_group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">All pay groups</option>
          {(db.payGroups || []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <table className="pr-breakup" style={{ marginTop: 12 }}>
        <tbody>
          <tr>
            <td>Employees</td>
            <td>{reg.count}</td>
          </tr>
          <tr>
            <td>Gross earnings</td>
            <td>{inr(reg.totals.gross)}</td>
          </tr>
          <tr>
            <td>Total deductions</td>
            <td>{inr(reg.totals.deductions)}</td>
          </tr>
          <tr className="total-row">
            <td>Net pay</td>
            <td>{inr(reg.totals.net)}</td>
          </tr>
        </tbody>
      </table>
      <p className="pr-muted" style={{ marginTop: 12 }}>
        One row per employee with every earning, deduction and employer cost, and a totals row. Opens in Excel.
        {isDone(db.payrollRuns.find((r) => r.month === ym)) ? ' This month is locked, so the register matches the payslips that were issued.' : ' This month is not locked yet, so the numbers can still change.'}
      </p>
    </Modal>
  );
}

function Tour({ onClose }) {
  const [i, setI] = useState(0);
  const ABOUT = {
    attendance: 'Check paid days and loss-of-pay for everyone in the cycle.',
    joinees: 'Confirm who joined or left during the cycle; their pay is worked out for the days they were here.',
    bonus: 'Add bonuses and check salary revisions that take effect this month.',
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
      markInputsChanged(d, ym, user);
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
    const exc = exceptionDays(db, ym);
    const decide = (x, value) => {
      update((d) => {
        setResolution(d, x.emp.id, x.date, value, user);
      });
      changed(`${value ? `Marked ${fmtDate(x.date)} for ${fullName(x.emp)} as ${value.toLowerCase()}` : `Cleared the decision for ${fmtDate(x.date)} for ${fullName(x.emp)}`}`);
    };
    content = (
      <>
      <h4 className="form-section" style={{ marginTop: 0 }}>Attendance exceptions ({exc.filter((x) => !x.resolution).length} without a decision)</h4>
      <p className="pr-muted" style={{ marginBottom: 10 }}>
        Days marked Absent or Action Required in this cycle. Choose what happens to each: paid, loss of pay, or half a day of loss of pay. Every day needs a decision before payroll can be locked, and you can change any of them until then. A day leaves this list when the employee applies leave or regularizes it. Exception employees are not listed.
      </p>
      <DataTable
        rows={exc.map((x) => ({ ...x, id: `${x.emp.id}-${x.date}` }))}
        empty="No attendance exceptions in this cycle."
        pageSize={20}
        columns={[
          { key: 'emp', label: 'Employee', sortable: false, render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
          { key: 'date', label: 'Date', render: (x) => fmtDate(x.date) },
          { key: 'status', label: 'What happened', sortable: false, render: (x) => <span><Badge tone={x.status === 'Absent' ? 'red' : 'amber'}>{x.status}</Badge>{x.note ? <span className="muted"> {x.note}</span> : null}{x.remark?.kind === 'pending' ? <span className="muted"> · {x.remark.text}</span> : null}</span> },
          { key: 'decision', label: 'Decision', sortable: false, render: (x) => (
            <select value={x.resolution} disabled={locked} onChange={(e) => decide(x, e.target.value)} aria-label={`Decision for ${fullName(x.emp)} on ${x.date}`}>
              <option value="">Not decided</option>
              {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          ) },
        ]}
      />
      <h4 className="form-section" style={{ marginTop: 20 }}>Payable days</h4>
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
      </>
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
        {db.attendanceSettings?.overtimeEnabled ? (
          <>
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
        ) : (
          <p className="pr-muted">Overtime is switched off in Attendance settings, so there is nothing to pay.</p>
        )}
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
        <AdjList db={db} ym={ym} kinds={['Reimbursement', 'Adhoc payment', 'Leave encashment', 'Gratuity', 'Deduction']} title="Reimbursements, adhoc payments and deductions" locked={locked} changed={changed} />
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

const runLabel = (r) => (r.status === 'Finalized' ? 'Locked' : r.status === 'Submitted' ? 'Awaiting approval' : r.status);

function PayrollAdmin({ db, user, sub }) {
  const cur = currentPayMonth(db);
  const months = [...new Set([cur, ...db.payrollRuns.map((r) => r.month)])].sort().reverse();
  const [ym, setYm] = useState(months.find((m) => isDone(db.payrollRuns.find((r) => r.month === m))) || cur);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const [slip, setSlip] = useState(null);
  const [decl, setDecl] = useState(null);
  const [emp, setEmp] = useState(null);
  const [revise, setRevise] = useState(null);
  const [challan, setChallan] = useState(null);
  const sumDed = (prefix) => sumOf(t.slips, (x) => x.deductions.find((d) => d[0].startsWith(prefix))?.[1] || 0);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const br = (e) => breakupFor(db, e);

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
    // Components differ between structures, so the columns are the union of every structure's components.
    const compNames = [...new Set(people.flatMap((e) => br(e).earnings.map(([k]) => k)))];
    const cols = [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Pay group', csv: (e) => payGroupOf(db, e)?.name }, { label: 'Structure', csv: (e) => structureOf(db, e)?.name }, { label: 'Annual CTC', csv: (e) => e.ctc }, ...compNames.map((k) => ({ label: k, csv: (e) => Math.round(br(e).earnings.find(([n]) => n === k)?.[1] || 0) }))];
    body = (
      <Panel title="Employee salaries" right={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('employee-salaries', cols, people)}>Export</Btn>}>
        <DataTable
          rows={people}
          pageSize={30}
          onRowClick={setEmp}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} sub={e.empNo} /> },
            { key: 'band', label: 'Band', render: (e) => bandOf(db, e)?.name || '—' },
            { key: 'group', label: 'Pay group', sortable: false, render: (e) => payGroupOf(db, e)?.name || '—' },
            { key: 'structure', label: 'Structure', sortable: false, render: (e) => structureOf(db, e)?.name || '—' },
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
    const pft = pfTotals(db, t.slips);
    const ecr = ecrFile(db, t.slips);
    const esiList = esiRows(db, t.slips);
    const esiEmployer = sumOf(t.slips, (x) => x.esi?.employer || 0);
    const esiNow = esiPolicy(db);
    const period = esiPeriodOf(esiNow, ym);
    body = (
      <div className="pr-stack">
        <div className="row">
          <MonthSelect value={ym} onChange={setYm} months={months} />
        </div>
        <div className="pr-cards4">
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>PF (employee)</span><em>{`ER ${inr(pft.employer)}`}</em></div>
            <strong>{inr(sumDed('Provident'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>ESI (employee)</span><em>{`ER ${inr(esiEmployer)}`}</em></div>
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
        <Panel title="PF ECR summary" right={<Btn kind="ghost" small icon="download" onClick={() => downloadEcr(db, t.slips, ym)}>Download ECR</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>
            {pft.members} member(s). Employee {money(pft.employee)} + employer EPF {money(pft.epf)} + employer EPS {money(pft.eps)} + EDLI {money(pft.edli)} + administration {money(pft.admin)}{pft.adminSum > 0 && pft.admin > Math.round(pft.adminSum) ? ' (raised to the minimum)' : ''} = <strong>{money(pft.remit)}</strong> to pay with the challan. The file follows the ECR 2.0 layout.
          </p>
          {ecr.missing.length > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>No UAN on the profile, so left out of the file: {ecr.missing.map(fullName).join(', ')}.</p>}
          <DataTable
            rows={ecr.rows}
            empty="No employee has PF deducted this month."
            rowKey={(r) => r.slip.emp.id}
            pageSize={30}
            columns={[
              { key: 'uan', label: 'UAN', sortable: false, render: (r) => r.slip.emp.uan || '—' },
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => fullName(r.slip.emp) },
              { key: 'gross', label: 'Gross wages', render: (r) => money(r.slip.gross) },
              { key: 'epf', label: 'EPF wages', sortable: false, render: (r) => money(r.pf.wage) },
              { key: 'eps', label: 'EPS wages', sortable: false, render: (r) => money(r.pf.epsWage) },
              { key: 'ee', label: 'Employee EPF', sortable: false, render: (r) => money(r.pf.employee) },
              { key: 'er1', label: 'Employer EPS', sortable: false, render: (r) => money(r.pf.eps) },
              { key: 'er2', label: 'Employer EPF', sortable: false, render: (r) => money(r.pf.employer - r.pf.eps) },
              { key: 'ncp', label: 'Days not paid', sortable: false, render: (r) => Math.round(r.slip.lop || 0) },
            ]}
          />
        </Panel>
        <Panel title="ESI contribution" right={<Btn kind="ghost" small icon="download" onClick={() => downloadEsi(db, t.slips, ym)}>Download ESI file</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>
            {esiNow.enabled === false
              ? 'ESI is switched off for the company (Payroll > Settings > PF & ESI).'
              : <>Contribution period {monthLabel(period.start)} – {monthLabel(period.end)}. Covered for the whole period if wages in its first month are up to {money(esiNow.grossLimit)}. Employee {esiNow.employeeRate}% and employer {esiNow.employerRate}% of wages, without overtime, rounded up to the rupee. Total to pay: <strong>{money(sumDed('ESI') + esiEmployer)}</strong>.</>}
          </p>
          {esiList.missing.length > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>No ESI number on the profile, so left out of the file: {esiList.missing.map(fullName).join(', ')}.</p>}
          <DataTable
            rows={esiList.rows}
            empty="No employee is covered by ESI this month."
            rowKey={(r) => r.slip.emp.id}
            pageSize={30}
            columns={[
              { key: 'ip', label: 'ESI number', sortable: false, render: (r) => r.cols[0] },
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => fullName(r.slip.emp) },
              { key: 'days', label: 'Days paid', sortable: false, render: (r) => r.cols[2] },
              { key: 'wages', label: 'ESI wages', sortable: false, render: (r) => money(r.cols[3]) },
              { key: 'ee', label: 'Employee', sortable: false, render: (r) => money(r.slip.esi?.employee ?? 0) },
              { key: 'er', label: 'Employer', sortable: false, render: (r) => money(r.slip.esi?.employer ?? 0) },
            ]}
          />
        </Panel>
        <Panel title="Challan register" right={<Btn small icon="plus" onClick={() => setChallan({ month: ym, paidOn: todayISO() })}>Record a payment</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>What is due for {monthLabel(ym)} against the payments you record. Record each challan after you pay it at the portal.</p>
          <DataTable
            rows={CHALLAN_TYPES.map((tp) => {
              const due = { PF: pft.remit, ESI: sumDed('ESI') + esiEmployer, 'Professional Tax': sumDed('Professional'), LWF: sumDed('Labour') + sumOf(t.slips, (x) => (x.employer.find(([k]) => k === 'Employer LWF') || [0, 0])[1]), TDS: sumDed('Income') }[tp];
              const paid = sumOf((db.challans || []).filter((c) => c.type === tp && c.month === ym), (c) => c.amount);
              return { id: tp, type: tp, due, paid };
            })}
            columns={[
              { key: 'type', label: 'Payment' },
              { key: 'due', label: `Due for ${monthLabel(ym)}`, render: (r) => money(r.due) },
              { key: 'paid', label: 'Recorded as paid', render: (r) => money(r.paid) },
              { key: 'st', label: 'Status', sortable: false, render: (r) => (r.due <= 0 ? <Badge tone="grey">Nothing due</Badge> : r.paid >= r.due ? <Badge tone="green">Paid</Badge> : r.paid > 0 ? <Badge tone="amber">Part paid</Badge> : <Badge tone="red">Not paid</Badge>) },
            ]}
          />
          <h4 className="form-section" style={{ marginTop: 18 }}>Payments recorded</h4>
          <DataTable
            rows={[...(db.challans || [])].sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || ''))}
            empty="No payments recorded yet."
            columns={[
              { key: 'type', label: 'Payment' },
              { key: 'month', label: 'For', render: (c) => monthLabel(c.month) },
              { key: 'amount', label: 'Amount', render: (c) => money(c.amount) },
              { key: 'paidOn', label: 'Paid on', render: (c) => fmtDate(c.paidOn) },
              { key: 'ref', label: 'Challan / reference no.' },
              { key: 'bank', label: 'Bank' },
              { key: '_a', label: '', sortable: false, align: 'right', render: (c) => <Btn kind="icon" icon="trash" title="Delete" aria-label="Delete this payment" onClick={() => { if (confirmAction('Delete this recorded payment?')) removeItem('challans', c.id); }} /> },
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
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<><Btn kind="ghost" icon="download" onClick={() => downloadPayslipPdf(db, slip)} title="Password: employee number followed by date of birth (DDMMYYYY)">PDF (password protected)</Btn><Btn icon="print" onClick={() => window.print()}>Print</Btn></>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
      {challan && (
        <FormModal
          title="Record a payment"
          fields={[
            { key: 'type', label: 'Payment', type: 'select', options: CHALLAN_TYPES, required: true },
            { key: 'month', label: 'For the payroll month', type: 'select', options: months.map((m) => ({ value: m, label: monthLabel(m) })), required: true },
            { key: 'amount', label: 'Amount paid (₹)', type: 'number', required: true },
            { key: 'paidOn', label: 'Paid on', type: 'date', required: true },
            { key: 'ref', label: 'Challan / reference number' },
            { key: 'bank', label: 'Bank' },
          ]}
          initial={challan}
          onClose={() => setChallan(null)}
          onSave={(v) => {
            addItem('challans', { ...v, amount: Number(v.amount) });
            setChallan(null);
            toast('Payment recorded');
          }}
        />
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
  const paidMonths = (l) => loanPaidBefore(l, ym);
  const emi = loanEmi;
  const active = db.loans.filter((l) => l.status === 'Active');
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Active loans</span></div><strong>{active.length}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Amount lent</span></div><strong>{inr(sumOf(active, (l) => l.amount))}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Outstanding</span></div><strong>{inr(sumOf(active, (l) => loanOutstanding(l, ym)))}</strong></div>
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

const CHALLAN_TYPES = ['PF', 'ESI', 'Professional Tax', 'LWF', 'TDS'];

// ---------- PF and ESI files ----------
// The ECR 2.0 file. Members with no UAN cannot be put in it, so say who was left out.
function downloadEcr(db, slips, ym) {
  const f = ecrFile(db, slips);
  if (!f.lines.length) return toast('No employee has PF this month.', 'error');
  exportText(`ECR_${ym}`, f.text);
  toast(f.missing.length ? `ECR downloaded with ${f.lines.length} member(s). Left out, no UAN: ${f.missing.map(fullName).join(', ')}.` : `ECR downloaded with ${f.lines.length} member(s).`, f.missing.length ? 'error' : undefined);
}
function downloadEsi(db, slips, ym) {
  const f = esiRows(db, slips);
  if (!f.rows.length) return toast('No employee is covered by ESI this month.', 'error');
  exportCSV(`ESI_${ym}`, ESI_COLUMNS.map((label, i) => ({ label, csv: (r) => r.cols[i] })), f.rows);
  toast(f.missing.length ? `ESI file downloaded with ${f.rows.length} employee(s). Left out, no ESI number: ${f.missing.map(fullName).join(', ')}.` : `ESI file downloaded with ${f.rows.length} employee(s).`, f.missing.length ? 'error' : undefined);
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
    ['Payroll register', 'Every earning, deduction and employer cost for each employee, with totals.', () => { const reg = payrollRegister(db, ym); exportCSV(`payroll-register-${ym}`, reg.columns, reg.rows); }],
    ['Bank transfer statement', 'Account details and net pay for the bank upload.', () => exportCSV(`bank-transfer-${ym}`, [...base, { label: 'Account holder', csv: (x) => x.emp.bank?.accountHolder }, { label: 'Bank', csv: (x) => x.emp.bank?.bankName }, { label: 'Account number', csv: (x) => x.emp.bank?.accountNumber }, { label: 'IFSC', csv: (x) => x.emp.bank?.ifsc }, { label: 'Net pay', csv: (x) => Math.round(x.net) }, { label: 'Payment mode', csv: () => 'NEFT' }, { label: 'Narration', csv: () => `Salary ${monthLabel(ym)}` }], slips().filter((x) => !x.onHold))],
    ['PF ECR', 'The ECR 2.0 text file for the EPFO upload, with EPF, EPS and EDLI wages and contributions.', () => downloadEcr(db, slips(), ym)],
    ['ESI contribution', 'The monthly contribution file for the ESIC upload: days worked and wages of every covered employee.', () => downloadEsi(db, slips(), ym)],
    ['Form 130 data (annual salary and tax)', 'For your CA: each employee’s pay, PF, Professional Tax, taxable income, tax for the year and TDS so far in this financial year. Unlocked months use current figures.', () => {
      const months = Array.from({ length: 12 }, (_, i) => addMonths(`${fyOf(ym)}-04`, i)).filter((m) => m <= ym);
      const ded = (sl, p) => sumOf(sl, (s) => (s.deductions.find((d) => d[0].startsWith(p)) || [0, 0])[1]);
      const rows = monthTotals(db, ym).people.map((e) => {
        const sl = months.map((m) => payslipFor(db, e, m));
        return { e, gross: sumOf(sl, (s) => s.gross), pf: ded(sl, 'Provident'), pt: ded(sl, 'Professional'), tds: ded(sl, 'Income'), tp: taxProjection(db, e, ym) };
      });
      exportCSV(`form130-data-${fyOf(ym)}-${ym}`, [{ label: 'Employee', csv: (r) => fullName(r.e) }, { label: 'Emp no', csv: (r) => r.e.empNo }, { label: 'PAN', csv: (r) => r.e.pan }, { label: 'Tax regime', csv: (r) => r.tp.regime }, { label: 'Gross pay to date', csv: (r) => Math.round(r.gross) }, { label: 'Employee PF', csv: (r) => Math.round(r.pf) }, { label: 'Professional Tax', csv: (r) => Math.round(r.pt) }, { label: 'Taxable income (year)', csv: (r) => Math.round(r.tp.taxable) }, { label: 'Tax for the year', csv: (r) => Math.round(r.tp.annualTax) }, { label: 'TDS deducted to date', csv: (r) => Math.round(r.tds) }], rows);
    }],
    ['Form 138 data (quarterly TDS)', 'For your CA: TDS deducted each month of the quarter that holds this month, with PAN.', () => {
      const qStart = [`${fyOf(ym)}-04`, `${fyOf(ym)}-07`, `${fyOf(ym)}-10`, `${fyOf(ym) + 1}-01`].filter((m) => m <= ym).pop();
      const months = [0, 1, 2].map((i) => addMonths(qStart, i)).filter((m) => m <= ym);
      const rows = months.flatMap((m) => monthTotals(db, m).slips.map((s) => ({ m, s })));
      exportCSV(`form138-data-${qStart}`, [{ label: 'Employee', csv: (r) => fullName(r.s.emp) }, { label: 'PAN', csv: (r) => r.s.emp.pan }, { label: 'Month', csv: (r) => monthLabel(r.m) }, { label: 'Gross pay', csv: (r) => Math.round(r.s.gross) }, { label: 'TDS deducted', csv: (r) => Math.round((r.s.deductions.find((d) => d[0].startsWith('Income')) || [0, 0])[1]) }], rows);
    }],
    ['Form 124 data (tax declarations)', 'The investment declarations employees have made, with regime, rent and landlord details.', () =>
      exportCSV('form124-declarations', [{ label: 'Employee', csv: (d) => fullName(empById(db, d.empId)) }, { label: 'PAN', csv: (d) => empById(db, d.empId)?.pan }, { label: 'Financial year', csv: (d) => d.fy }, { label: 'Regime', csv: (d) => d.regime }, { label: '80C', csv: (d) => declarationTotal(d).c80 }, { label: '80D', csv: (d) => declarationTotal(d).d80 }, { label: 'Other deductions', csv: (d) => declarationTotal(d).other }, { label: 'Annual rent', csv: (d) => declarationTotal(d).hraRent }, { label: 'Landlord', csv: (d) => d.items?.landlordName }, { label: 'Landlord PAN', csv: (d) => d.items?.landlordPan }, { label: 'Status', csv: (d) => d.status }], db.taxDeclarations)],
    ['Muster roll', 'Attendance of every employee for each day of the pay cycle (P present, W work from home, L leave, A absent, AR action required, WO weekly off, H holiday).', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const code = { Present: 'P', WFH: 'W', Leave: 'L', Absent: 'A', 'Action Required': 'AR', 'Weekly off': 'WO', Holiday: 'H' };
      exportCSV(`muster-roll-${ym}`, [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, ...days.map((d) => ({ label: d.slice(8) + '/' + d.slice(5, 7), csv: (e) => (e.attendanceExempt === 'Yes' ? 'EX' : d < e.dateOfJoining ? '' : code[attendanceFor(db, e.id, d).status] || '') }))], monthTotals(db, ym).people);
    }],
    ['Leave register', 'Approved leave taken in this pay cycle.', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      exportCSV(`leave-register-${ym}`, [{ label: 'Employee', csv: (r) => fullName(empById(db, r.empId)) }, { label: 'Emp no', csv: (r) => empById(db, r.empId)?.empNo }, { label: 'Leave type', csv: (r) => db.leaveTypes.find((t) => t.id === r.typeId)?.name }, { label: 'From', csv: (r) => r.from }, { label: 'To', csv: (r) => r.to }, { label: 'Days', csv: (r) => r.days }, { label: 'Loss of pay days', csv: (r) => r.lopDays || 0 }], db.leaveRequests.filter((r) => r.status === 'Approved' && r.from >= from && r.from <= to));
    }],
    ['Change audit', 'Who changed pay-related details (salary, bank, statutory numbers, pay group) and payroll settings in this pay cycle.', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      const rows = (db.auditLog || []).filter((a) => a.at.slice(0, 10) >= from && a.at.slice(0, 10) <= to);
      if (!rows.length) return toast('No changes were recorded in this pay cycle.');
      exportCSV(`change-audit-${ym}`, [{ label: 'When', csv: (a) => a.at.replace('T', ' ').slice(0, 19) }, { label: 'Changed by', csv: (a) => fullName(empById(db, a.by)) || a.by }, { label: 'Type', csv: (a) => a.kind }, { label: 'Employee', csv: (a) => (a.empId ? fullName(empById(db, a.empId)) : '') }, { label: 'What changed', csv: (a) => a.field }, { label: 'From', csv: (a) => a.from }, { label: 'To', csv: (a) => a.to }], rows);
    }],
    ['Professional tax', 'PT deducted for each employee.', () => exportCSV(`pt-${ym}`, [...base, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'PT', csv: ded('Professional') }], slips())],
    ['Labour welfare fund', 'LWF deducted this month.', () => exportCSV(`lwf-${ym}`, [...base, { label: 'Employee LWF', csv: ded('Labour') }, { label: 'Employer LWF', csv: (x) => Number(settingsFor(db, x.emp).lwfEmployer || 0) }], slips().filter((x) => ded('Labour')(x) > 0))],
    ['TDS summary', 'Income tax deducted, with PAN and tax regime.', () => exportCSV(`tds-${ym}`, [...base, { label: 'PAN', csv: (x) => x.emp.pan }, { label: 'Regime', csv: (x) => x.regime }, { label: 'TDS', csv: ded('Income') }], slips())],
    ['CTC report', 'Annual CTC, band and department of every employee.', () => exportCSV('ctc-report', [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Department', csv: (e) => e.department }, { label: 'Band', csv: (e) => bandOf(db, e)?.name }, { label: 'Annual CTC', csv: (e) => e.ctc }], db.employees.filter((e) => e.status !== 'Exited'))],
    ['Variance report', 'Change in net pay against the month before.', variance],
    ['Loan outstanding', 'Active loans with EMI and tenure.', () => exportCSV('loans', [{ label: 'Employee', csv: (l) => fullName(empById(db, l.empId)) }, { label: 'Type', csv: (l) => l.type }, { label: 'Amount', csv: (l) => l.amount }, { label: 'EMI', csv: (l) => Math.round(loanEmi(l)) }, { label: 'Start', csv: (l) => l.startMonth }, { label: 'Status', csv: (l) => l.status }], db.loans)],
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

// ---------- settings: pay cycle, pay groups, pay structures ----------
const GROUP_FIELDS = [
  { key: 'name', label: 'Pay group name', required: true, section: 'Pay group' },
  { key: 'structureId', label: 'Default pay structure', type: 'select', required: true, options: (db) => (db.payStructures || []).map((s) => ({ value: s.id, label: s.name })), help: 'An employee can have a different structure on their profile.' },
  { key: 'description', label: 'Description', full: true },
  { key: 'payDay', label: 'Pay day', type: 'select', options: ['Last working day', '1st of next month', '7th of next month'], section: 'Pay and lock' },
  { key: 'lockDay', label: 'Attendance & inputs lock day', type: 'number' },
  { key: 'pfEnabled', label: 'Provident Fund applies', type: 'checkbox', section: 'Statutory deductions' },
  { key: 'pfCeiling', label: 'PF wage ceiling (blank follows the statutory rules)', type: 'number', min: 0, show: (v) => v.pfEnabled, help: 'Leave empty to use the ceiling set under Settings > PF & ESI. Fill it in only if this group needs its own.' },
  { key: 'esiEnabled', label: 'ESI applies (wage limit is set under Settings > PF & ESI)', type: 'checkbox' },
  { key: 'ptEnabled', label: 'Professional tax applies', type: 'checkbox' },
  { key: 'ptAmount', label: 'Fixed Professional Tax / month (blank follows the state slabs)', type: 'number', min: 0, show: (v) => v.ptEnabled, help: 'Leave empty to use the slabs under Settings > PT & LWF. Fill it in only to charge one fixed amount to this group.' },
  { key: 'lwfEnabled', label: 'Labour welfare fund applies', type: 'checkbox' },
  { key: 'lwfEmployee', label: 'LWF employee share (each payment)', type: 'number', show: (v) => v.lwfEnabled },
  { key: 'lwfEmployer', label: 'LWF employer share (each payment)', type: 'number', show: (v) => v.lwfEnabled, help: 'Taken only in the months set under Settings > PT & LWF.' },
];

// Mark one pay group / structure as the default for employees who have none of their own.
function makeDefault(col, item) {
  update((d) => {
    d[col].forEach((x) => (x.isDefault = x.id === item.id));
  });
  toast(`${item.name} is now the default`);
}

function PayGroups({ db }) {
  const [editing, setEditing] = useState(null);
  const [members, setMembers] = useState(null);
  const groups = db.payGroups || [];
  const inGroup = (g, activeOnly = true) => db.employees.filter((e) => (!activeOnly || e.status !== 'Exited') && payGroupOf(db, e)?.id === g.id);

  const remove = (g) => {
    if (groups.length <= 1) return toast('At least one pay group is needed.', 'error');
    if (g.isDefault) return toast('This is the default pay group. Make another group the default first.', 'error');
    const n = inGroup(g, false).length;
    if (n > 0) return toast(`${n} employee(s) are in ${g.name}. Move them to another pay group first (Members).`, 'error');
    if (!confirmAction(`Delete the pay group ${g.name}?`)) return;
    update((d) => {
      d.payGroups = d.payGroups.filter((x) => x.id !== g.id);
    });
    toast('Pay group deleted');
  };
  const save = (v) => {
    // Leave the id out when adding: an `id: undefined` would overwrite the one addItem makes.
    const { id: _unused, isDefault: _d, ...data } = v;
    ['lockDay', 'pfCeiling', 'ptAmount', 'lwfEmployee', 'lwfEmployer'].forEach((k) => {
      if (data[k] !== '' && data[k] !== undefined) data[k] = Number(data[k]);
    });
    if (editing.id) patchItem('payGroups', editing.id, data);
    else addItem('payGroups', data);
    setEditing(null);
    toast('Pay group saved');
  };
  const saveMembers = (v) => {
    const sel = v.members || [];
    const fallback = groups.find((x) => x.id !== members.id)?.id;
    update((d) => {
      d.employees.forEach((e) => {
        if (e.status === 'Exited') return;
        if (sel.includes(e.id)) e.payGroupId = members.id;
        else if (payGroupOf(d, e)?.id === members.id && fallback) e.payGroupId = fallback;
      });
    });
    setMembers(null);
    toast('Members updated');
  };
  const statutory = (g) => [g.pfEnabled && 'PF', g.esiEnabled && 'ESI', g.ptEnabled && 'PT', g.lwfEnabled && 'LWF'].filter(Boolean).join(' · ') || 'None';

  return (
    <Panel
      title="Pay groups"
      right={
        <Btn small icon="plus" onClick={() => setEditing({ ...groupFromSettings(db.payrollSettings), id: undefined, name: '', description: '', structureId: (db.payStructures || [])[0]?.id })}>
          Add pay group
        </Btn>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        A pay group is a set of employees paid on the same terms: the same pay day and the same statutory deductions. All groups share the pay cycle.
      </p>
      <DataTable
        rows={groups}
        columns={[
          { key: 'name', label: 'Pay group', render: (g) => (<span>{g.name}{g.isDefault && <> <Badge tone="blue">Default</Badge></>}</span>) },
          { key: 'structure', label: 'Default structure', sortable: false, render: (g) => (db.payStructures || []).find((s) => s.id === g.structureId)?.name || '—' },
          { key: 'payDay', label: 'Pay day' },
          { key: 'stat', label: 'Statutory', sortable: false, render: statutory },
          { key: 'people', label: 'Employees', sortable: false, render: (g) => inGroup(g).length },
          {
            key: '_a',
            label: '',
            sortable: false,
            align: 'right',
            render: (g) => (
              <span className="row-actions">
                {!g.isDefault && (
                  <Btn kind="ghost" small onClick={() => makeDefault('payGroups', g)}>
                    Make default
                  </Btn>
                )}
                <Btn kind="ghost" small onClick={() => setMembers(g)}>
                  Members
                </Btn>
                <Btn kind="icon" icon="edit" title="Edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing({ ...g })} />
                <Btn kind="icon" icon="trash" title="Delete" aria-label={`Delete ${g.name}`} onClick={() => remove(g)} />
              </span>
            ),
          },
        ]}
      />
      {editing && <FormModal title={editing.id ? `Edit ${editing.name}` : 'Add pay group'} fields={GROUP_FIELDS} initial={editing} onClose={() => setEditing(null)} onSave={save} wide />}
      {members && (
        <FormModal
          title={`Members of ${members.name}`}
          fields={[{ key: 'members', label: 'Employees in this pay group', type: 'multiemployee', full: true, help: groups.length > 1 ? 'Anyone you untick moves to another pay group.' : '' }]}
          initial={{ members: inGroup(members).map((e) => e.id) }}
          onClose={() => setMembers(null)}
          onSave={saveMembers}
          wide
        />
      )}
    </Panel>
  );
}

const money0 = (n) => inr(n);

// Editor for one pay structure: the earning components and how each is worked out.
function StructureEditor({ db, st, onClose }) {
  const [v, setV] = useState(() => ({
    name: st.name || '',
    description: st.description || '',
    employerPf: st.employerPf !== false,
    gratuity: st.gratuity !== false,
    gratuityPct: st.gratuityPct ?? 4.81,
    components: (st.components || []).map((c) => ({ ...c })),
  }));
  const [sample, setSample] = useState(600000);
  const [error, setError] = useState('');
  const setComp = (i, ch) => setV((s) => ({ ...s, components: s.components.map((c, j) => (j === i ? { ...c, ...ch } : c)) }));
  const setHra = (i) => setV((s) => ({ ...s, components: s.components.map((c, j) => ({ ...c, role: j === 0 ? 'basic' : j === i ? (c.role === 'hra' ? '' : 'hra') : c.role === 'hra' ? '' : c.role })) }));
  const draft = { ...v, components: v.components.map((c, i) => ({ ...c, role: i === 0 ? 'basic' : c.role })) };
  const preview = salaryBreakup(Number(sample) || 0, { ...db.payrollSettings, pf: pfPolicy(db) }, draft);
  const balance = v.components.findIndex((c) => c.type === 'Balance');

  const validate = () => {
    if (!v.name.trim()) return 'Give the structure a name.';
    if ((db.payStructures || []).some((x) => x.id !== st.id && x.name.trim().toLowerCase() === v.name.trim().toLowerCase())) return 'Another structure already has that name.';
    if (!v.components.length) return 'Add at least one component.';
    if (v.components[0].type === 'Balance' || v.components[0].type === 'Percent of Basic') return 'The first component is Basic, so it must be a percent of CTC or a fixed amount.';
    const names = v.components.map((c) => c.name.trim().toLowerCase());
    if (names.some((n) => !n)) return 'Every component needs a name.';
    if (new Set(names).size !== names.length) return 'Two components have the same name.';
    if (v.components.filter((c) => c.type === 'Balance').length > 1) return 'Only one component can be the balance.';
    const bad = v.components.find((c) => c.type !== 'Balance' && (Number(c.value) < 0 || (c.type.startsWith('Percent') && Number(c.value) > 100) || c.value === '' || c.value === undefined));
    if (bad) return `Check the value of ${bad.name || 'a component'}.`;
    return '';
  };
  const save = () => {
    const err = validate();
    if (err) return setError(err);
    const components = v.components.map((c, i) => ({ id: c.id || uid('c'), name: c.name.trim(), type: c.type, value: c.type === 'Balance' ? 0 : Number(c.value), role: i === 0 ? 'basic' : c.role === 'hra' ? 'hra' : '' }));
    const data = { name: v.name.trim(), description: v.description, employerPf: v.employerPf, gratuity: v.gratuity, gratuityPct: Number(v.gratuityPct) || 0, components };
    if (st.id) patchItem('payStructures', st.id, data);
    else addItem('payStructures', data);
    toast('Pay structure saved');
    onClose();
  };

  return (
    <Modal
      title={st.id ? `Edit ${st.name}` : 'Add pay structure'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn kind="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={save}>Save structure</Btn>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ps_name">
            Structure name<span className="req">*</span>
          </label>
          <input id="ps_name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ps_desc">Description</label>
          <input id="ps_desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={v.employerPf} onChange={(e) => setV({ ...v, employerPf: e.target.checked })} /> Employer PF is part of the CTC (untick if the company pays it on top)
        </label>
        <label className="check">
          <input type="checkbox" checked={v.gratuity} onChange={(e) => setV({ ...v, gratuity: e.target.checked })} /> Gratuity is part of the CTC
        </label>
        {v.gratuity && (
          <div className="field">
            <label htmlFor="ps_grat">Gratuity (% of basic)</label>
            <input id="ps_grat" type="number" step="0.01" value={v.gratuityPct} onChange={(e) => setV({ ...v, gratuityPct: e.target.value })} />
          </div>
        )}
      </div>

      <h4 className="form-section" style={{ marginTop: 16 }}>
        Earning components
      </h4>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Component</th>
              <th>How it is worked out</th>
              <th>Value</th>
              <th title="Used for the HRA exemption under the old tax regime">HRA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {v.components.map((c, i) => (
              <tr key={c.id || i}>
                <td data-label="Component">
                  <input className="input-sm" aria-label={`Component ${i + 1} name`} value={c.name} disabled={i === 0} onChange={(e) => setComp(i, { name: e.target.value })} />
                </td>
                <td data-label="How it is worked out">
                  <select className="select-sm" aria-label={`${c.name || 'Component'} type`} value={c.type} onChange={(e) => setComp(i, { type: e.target.value })}>
                    {COMPONENT_TYPES.filter((t) => i > 0 || (t !== 'Balance' && t !== 'Percent of Basic')).map((t) => (
                      <option key={t} value={t}>
                        {{ 'Percent of CTC': '% of CTC', 'Percent of Basic': '% of Basic', Fixed: 'Fixed per month', Balance: 'Balance of CTC' }[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Value">
                  {c.type === 'Balance' ? (
                    <span className="pr-muted">the rest</span>
                  ) : (
                    <input className="input-sm" type="number" min="0" step="any" aria-label={`${c.name || 'Component'} value`} value={c.value ?? ''} onChange={(e) => setComp(i, { value: e.target.value })} />
                  )}
                </td>
                <td data-label="HRA">{i > 0 ? <input type="checkbox" aria-label={`${c.name} is HRA`} checked={c.role === 'hra'} onChange={() => setHra(i)} /> : '—'}</td>
                <td>{i > 0 && <Btn kind="icon" icon="trash" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => setV((s) => ({ ...s, components: s.components.filter((_, j) => j !== i) }))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <Btn kind="ghost" small icon="plus" onClick={() => setV((s) => ({ ...s, components: [...s.components, { id: uid('c'), name: '', type: 'Fixed', value: 0, role: '' }] }))}>
          Add component
        </Btn>
      </div>

      <h4 className="form-section" style={{ marginTop: 16 }}>
        Check with a sample salary
      </h4>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="ps_sample">Annual CTC</label>
        <input id="ps_sample" type="number" value={sample} onChange={(e) => setSample(e.target.value)} />
      </div>
      <table className="pr-breakup" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Component</th>
            <th>Monthly</th>
            <th>Annual</th>
          </tr>
        </thead>
        <tbody>
          {[...preview.earnings, ...preview.employer].map(([k, x]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{money0(x)}</td>
              <td>{money0(x * 12)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Cost to company</td>
            <td>{money0(preview.monthly)}</td>
            <td>{money0(Number(sample) || 0)}</td>
          </tr>
        </tbody>
      </table>
      {(() => {
        const w = wageShare(preview.earnings, wagePolicy(db));
        return <p className={w.below ? 'pr-warn' : 'pr-muted'} style={{ marginTop: 10 }}>{`Wages are ${w.pct.toFixed(1)}% of pay at this CTC (rule: at least ${wagePolicy(db).minPct}%${wagePolicy(db).enabled === false ? ', switched off' : ''}).${w.below ? ' Raise basic or take components off the exclusion list in Settings > Wage rule.' : ''}`}</p>;
      })()}
      {balance >= 0 && preview.earnings[balance][1] === 0 && Number(sample) > 0 && <p className="pr-muted">The other components already use the whole CTC, so the balance component is zero.</p>}
      {balance < 0 && <p className="pr-muted">No balance component: gross pay may come out below the CTC less employer costs.</p>}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function PayStructures({ db }) {
  const [editing, setEditing] = useState(null);
  const list = db.payStructures || [];
  const users = (st) => db.employees.filter((e) => e.status !== 'Exited' && structureOf(db, e)?.id === st.id).length;
  const remove = (st) => {
    if (list.length <= 1) return toast('At least one pay structure is needed.', 'error');
    if (st.isDefault) return toast('This is the default pay structure. Make another structure the default first.', 'error');
    const groups = (db.payGroups || []).filter((g) => g.structureId === st.id);
    const people = db.employees.filter((e) => structureOf(db, e)?.id === st.id).length;
    if (groups.length || people) return toast(`${st.name} is used by ${groups.length ? `${groups.length} pay group(s)` : ''}${groups.length && people ? ' and ' : ''}${people ? `${people} employee(s)` : ''}. Move them to another structure first.`, 'error');
    if (!confirmAction(`Delete the pay structure ${st.name}?`)) return;
    update((d) => {
      d.payStructures = d.payStructures.filter((x) => x.id !== st.id);
    });
    toast('Pay structure deleted');
  };
  const duplicate = (st) => setEditing({ ...st, id: undefined, name: `${st.name} (copy)`, components: st.components.map((c) => ({ ...c, id: uid('c') })) });

  return (
    <Panel
      title="Pay structures"
      right={
        <Btn small icon="plus" onClick={() => setEditing({ ...structureFromSettings(db.payrollSettings), id: undefined, name: '', description: '' })}>
          Add pay structure
        </Btn>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        A pay structure says how a CTC is split into earning components. A pay group gives its employees a default structure, and a profile can pick a different one.
      </p>
      <DataTable
        rows={list}
        columns={[
          { key: 'name', label: 'Structure', render: (s) => (<span>{s.name}{s.isDefault && <> <Badge tone="blue">Default</Badge></>}</span>) },
          { key: 'components', label: 'Components', sortable: false, render: (s) => s.components.map((c) => c.name).join(', ') },
          { key: 'wages', label: 'Wages share', sortable: false, render: (s) => { const w = wageShare(salaryBreakup(1200000, { ...db.payrollSettings, pf: pfPolicy(db) }, s).earnings, wagePolicy(db)); return <span>{w.pct.toFixed(0)}% {w.below && <Badge tone="amber">Below {wagePolicy(db).minPct}%</Badge>}</span>; } },
          { key: 'pf', label: 'Employer PF', sortable: false, render: (s) => (s.employerPf === false ? 'No' : 'Yes') },
          { key: 'grat', label: 'Gratuity', sortable: false, render: (s) => (s.gratuity === false ? 'No' : `${s.gratuityPct ?? 4.81}% of basic`) },
          { key: 'people', label: 'Employees', sortable: false, render: users },
          {
            key: '_a',
            label: '',
            sortable: false,
            align: 'right',
            render: (s) => (
              <span className="row-actions">
                {!s.isDefault && (
                  <Btn kind="ghost" small onClick={() => makeDefault('payStructures', s)}>
                    Make default
                  </Btn>
                )}
                <Btn kind="ghost" small onClick={() => duplicate(s)}>
                  Duplicate
                </Btn>
                <Btn kind="icon" icon="edit" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ ...s })} />
                <Btn kind="icon" icon="trash" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => remove(s)} />
              </span>
            ),
          },
        ]}
      />
      {editing && <StructureEditor db={db} st={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// ---------- settings: gratuity on exit ----------
const GRATUITY_FIELDS = [
  { key: 'enabled', label: 'Use gratuity in this company', type: 'checkbox', help: 'Switch off if you do not give gratuity. Nothing is set aside in the CTC and nothing is paid on exit. Your settings below are kept.' },
  { key: 'eligibility', label: 'Who gets gratuity', type: 'select', options: [{ value: 'all', label: 'Everyone, once they have the years of service' }, { value: 'selected', label: 'Only the employees I choose' }], placeholder: 'Everyone', section: 'Who gets it', show: (v) => v.enabled !== false },
  { key: 'eligible', label: 'Employees who get gratuity', type: 'employeesearch', full: true, show: (v) => v.enabled !== false && v.eligibility === 'selected', help: 'Only the people added here have gratuity in their CTC and get it on exit. Anyone who joins later is left out until you add them here or set Gratuity applies on their profile. The years of service below still apply to them.' },
  { key: 'daysPerYear', label: 'Days of wages for each year of service', type: 'number', min: 1, section: 'Formula', help: 'The Act says 15.', show: (v) => v.enabled !== false },
  { key: 'monthDays', label: 'Days in a month for this calculation', type: 'number', min: 1, help: 'A month’s wages are divided by this to get a day’s wages. The Act says 26.', show: (v) => v.enabled !== false },
  { key: 'roundMonths', label: 'A part-year counts as a full year from (months)', type: 'number', min: 1, max: 12, help: '6 means 7 years 6 months is paid as 8 years. Use 12 to pay completed years only.', show: (v) => v.enabled !== false },
  { key: 'minYears', label: 'Years of service needed: permanent staff', type: 'number', min: 0, step: 0.5, section: 'Years of service needed', help: 'Nothing is paid below this. The Act says 5.', show: (v) => v.enabled !== false },
  { key: 'minYearsFixedTerm', label: 'Years of service needed: Contract (fixed-term) staff', type: 'number', min: 0, step: 0.5, help: 'Applies to anyone whose worker type is Contract.', show: (v) => v.enabled !== false },
  { key: 'cap', label: 'Most that can be paid (₹)', type: 'number', min: 0, section: 'Limit', help: 'The Act says ₹20,00,000. Enter 0 for no limit.', show: (v) => v.enabled !== false },
];

function GratuitySettings({ db }) {
  const saved = gratuityPolicy(db);
  // The list starts empty when everyone has gratuity; once "only chosen employees" is saved it holds those marked Yes.
  const eligibleNow = saved.eligibility === 'selected' ? db.employees.filter((e) => e.status !== 'Exited' && e.gratuityApplies === 'Yes').map((e) => e.id) : [];
  const [v, setV] = useState({ ...saved, eligible: eligibleNow });
  const [ex, setEx] = useState({ basic: 30000, years: 7.6 });
  const num = (k) => (k === 'enabled' ? v.enabled !== false : k === 'eligibility' ? (v.eligibility === 'selected' ? 'selected' : 'all') : v[k] === '' || v[k] === undefined ? GRATUITY_DEFAULTS[k] : Number(v[k]));
  const draft = Object.fromEntries(Object.keys(GRATUITY_DEFAULTS).map((k) => [k, num(k)]));
  const on = draft.enabled;
  const picked = v.eligible || [];
  const pickedChanged = draft.eligibility === 'selected' && (picked.length !== eligibleNow.length || picked.some((id) => !eligibleNow.includes(id)));
  const changed = Object.keys(GRATUITY_DEFAULTS).some((k) => draft[k] !== saved[k]) || pickedChanged;
  const isDefault = Object.keys(GRATUITY_DEFAULTS).every((k) => k === 'enabled' || k === 'eligibility' || draft[k] === GRATUITY_DEFAULTS[k]);
  const save = () => {
    if (on && (!(draft.daysPerYear > 0) || !(draft.monthDays > 0))) return toast('Days of wages and days in a month must be more than zero.', 'error');
    if (on && (draft.roundMonths < 1 || draft.roundMonths > 12)) return toast('The rounding month must be between 1 and 12.', 'error');
    if (on && (draft.minYears < 0 || draft.minYearsFixedTerm < 0 || draft.cap < 0)) return toast('Years and the limit cannot be negative.', 'error');
    update((d) => {
      d.payrollSettings.gratuityPolicy = draft;
      // The list is kept on each employee's profile (Gratuity applies), so the two always agree.
      if (on && draft.eligibility === 'selected') {
        d.employees.forEach((e) => {
          if (e.status === 'Exited') return;
          if (picked.includes(e.id)) e.gratuityApplies = 'Yes';
          else if (e.gratuityApplies === 'Yes') e.gratuityApplies = '';
        });
      }
    });
    setV({ ...draft, eligible: picked });
    toast('Gratuity settings saved');
  };
  const reset = () => setV({ ...GRATUITY_DEFAULTS, enabled: v.enabled !== false, eligibility: draft.eligibility, eligible: picked });
  const demoYears = Number(ex.years) || 0;
  const demoBasic = Number(ex.basic) || 0;
  const r = gratuityPayable(draft, demoBasic, demoYears, 'Permanent');
  const f = gratuityPayable(draft, demoBasic, demoYears, 'Contract');
  const accrual = ((draft.daysPerYear / draft.monthDays / 12) * 100).toFixed(2);
  return (
    <Panel
      title="Gratuity on exit"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the Act’s formula</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        {!on ? 'Gratuity is switched off. Nothing is set aside in the CTC and nothing is paid on exit. Your values below are kept for when you switch it on again.' : <>Gratuity paid in the full and final settlement = <strong>{draft.daysPerYear} ÷ {draft.monthDays} × last monthly basic × years of service</strong>
        {draft.cap > 0 ? <>, up to {money(draft.cap)}</> : <>, with no upper limit</>}. {draft.eligibility === 'selected' ? <>{picked.length ? `Only the ${picked.length} employee(s) chosen below get it. ` : 'No one is chosen yet, so no one gets it. Add employees below. '}</> : <>Everyone gets it. </>}It starts after {draft.minYears} year(s) of service, or {draft.minYearsFixedTerm} for Contract staff. {isDefault ? 'These are the standard values from the Payment of Gratuity Act.' : 'These differ from the Act’s standard values.'}</>}
      </p>
      <FormGrid fields={GRATUITY_FIELDS} values={v} setValues={setV} db={db} />
      {on && (
      <>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'basic', label: 'Monthly basic (₹)', type: 'number' }, { key: 'years', label: 'Years of service', type: 'number', step: 0.1 }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        Permanent: <strong>{money(Math.round(r.amount))}</strong> {r.amount ? `(${r.countedYears} years counted${r.capped ? ', limited by the cap' : ''})` : `(needs ${r.minYears} years)`}
        {' · '}
        Contract: <strong>{money(Math.round(f.amount))}</strong> {f.amount ? `(${f.countedYears} years counted${f.capped ? ', limited by the cap' : ''})` : `(needs ${f.minYears} years)`}
      </p>
      <p className="pr-muted" style={{ marginTop: 12 }}>
        The monthly amount set aside inside the CTC is separate. It is the percentage of basic on each Pay structure (the formula above works out to {accrual}%). An employee can also be switched off or on under Statutory on their profile.
      </p>
      </>
      )}
    </Panel>
  );
}

// ---------- settings: provident fund and ESI ----------
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
const PF_FIELDS = [
  { key: 'basis', label: 'PF is worked out on', type: 'select', options: [{ value: 'capped', label: 'Basic up to the wage ceiling' }, { value: 'actual', label: 'The full basic' }], section: 'Provident Fund', help: 'The company default. An employee can choose differently on their profile under Statutory.' },
  { key: 'employeeRate', label: 'Employee share (% of PF wage)', type: 'number', min: 0, max: 100, step: 0.01, section: 'Rates' },
  { key: 'employerRate', label: 'Employer share in all (% of PF wage)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'epsRate', label: 'Of this, pension fund / EPS (%)', type: 'number', min: 0, max: 100, step: 0.01, help: 'On wages up to the ceiling. The rest of the employer share goes to EPF.' },
  { key: 'edliRate', label: 'EDLI insurance, paid by employer (%)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'adminRate', label: 'EPF administration charge, paid by employer (%)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'adminMin', label: 'Administration charge: least for the whole month (₹)', type: 'number', min: 0 },
  { key: 'chargesInCtc', label: 'EDLI and administration charges come out of the CTC', type: 'checkbox', help: 'Off means the company pays them on top of the CTC and nobody’s pay changes. The employer’s PF share itself follows each pay structure (“Employer PF is part of the CTC”).' },
];
const ESI_FIELDS = [
  { key: 'enabled', label: 'Use ESI in this company', type: 'checkbox', help: 'Switch off if no one is covered. Your values below are kept. A pay group can also switch ESI off for its own people.' },
  { key: 'grossLimit', label: 'Covered if monthly wages are up to (₹)', type: 'number', min: 1, section: 'Who is covered', show: (v) => v.enabled !== false },
  { key: 'employeeRate', label: 'Employee share (% of wages)', type: 'number', min: 0, max: 100, step: 0.01, section: 'Rates', show: (v) => v.enabled !== false },
  { key: 'employerRate', label: 'Employer share (% of wages)', type: 'number', min: 0, max: 100, step: 0.01, show: (v) => v.enabled !== false },
  { key: 'periodStart1', label: 'First contribution period starts in', type: 'select', options: MONTH_OPTIONS, section: 'Contribution periods', show: (v) => v.enabled !== false },
  { key: 'periodStart2', label: 'Second contribution period starts in', type: 'select', options: MONTH_OPTIONS, help: 'Whether someone is covered is decided on their wages in the first month of the period they work in, and stays for the whole period even if pay rises past the limit. The law has April and October.', show: (v) => v.enabled !== false },
];

function PfEsiSettings({ db }) {
  const savedPf = pfPolicy(db);
  const savedEsi = esiPolicy(db);
  const [pf, setPf] = useState({ ...savedPf });
  const [esi, setEsi] = useState({ ...savedEsi, periodStart1: String(savedEsi.periodStart1), periodStart2: String(savedEsi.periodStart2) });
  const [ex, setEx] = useState({ basic: 30000 });
  const n = (x, d) => (x === '' || x === undefined || x === null ? d : Number(x));
  const pfDraft = {
    ...Object.fromEntries(['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate', 'adminMin'].map((k) => [k, n(pf[k], PF_DEFAULTS[k])])),
    basis: pf.basis === 'actual' ? 'actual' : 'capped',
    chargesInCtc: !!pf.chargesInCtc,
    rules: (pf.rules || []).map((r) => ({ from: r.from || '', ceiling: r.ceiling === '' ? '' : Number(r.ceiling) })),
  };
  const esiDraft = {
    enabled: esi.enabled !== false,
    ...Object.fromEntries(['grossLimit', 'employeeRate', 'employerRate'].map((k) => [k, n(esi[k], ESI_DEFAULTS[k])])),
    periodStart1: n(esi.periodStart1, ESI_DEFAULTS.periodStart1),
    periodStart2: n(esi.periodStart2, ESI_DEFAULTS.periodStart2),
  };
  const key = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const pfOnly = (o) => ({ ...Object.fromEntries(['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate', 'adminMin', 'basis', 'chargesInCtc'].map((k) => [k, o[k]])), rules: o.rules.map((r) => [r.from, r.ceiling]) });
  const esiOnly = (o) => Object.fromEntries(['enabled', 'grossLimit', 'employeeRate', 'employerRate'].map((k) => [k, o[k]]).concat([['periodStart1', Number(o.periodStart1)], ['periodStart2', Number(o.periodStart2)]]));
  const changed = key(pfOnly(pfDraft)) !== key(pfOnly(savedPf)) || key(esiOnly(esiDraft)) !== key(esiOnly(savedEsi));
  const isDefault = key(pfOnly(pfDraft)) === key(pfOnly(PF_DEFAULTS)) && key({ ...esiOnly(esiDraft), enabled: true }) === key(esiOnly(ESI_DEFAULTS));
  const setRule = (i, patch) => setPf({ ...pf, rules: pf.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () => {
    const bad = [...['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate'].map((k) => pfDraft[k]), esiDraft.employeeRate, esiDraft.employerRate].some((x) => !(x >= 0 && x <= 100));
    if (bad) return toast('Every rate must be between 0 and 100.', 'error');
    if (pfDraft.epsRate > pfDraft.employerRate) return toast('The pension share cannot be more than the employer share.', 'error');
    if (pfDraft.adminMin < 0) return toast('The minimum administration charge cannot be negative.', 'error');
    if (!pfDraft.rules.length || pfDraft.rules.some((r) => !r.from || !(r.ceiling > 0))) return toast('Every wage ceiling needs a date and an amount.', 'error');
    if (new Set(pfDraft.rules.map((r) => r.from)).size !== pfDraft.rules.length) return toast('Two wage ceilings start on the same day.', 'error');
    if (esiDraft.enabled && !(esiDraft.grossLimit > 0)) return toast('The ESI wage limit must be more than zero.', 'error');
    const rules = [...pfDraft.rules].sort((a, b) => a.from.localeCompare(b.from));
    update((d) => {
      d.payrollSettings.pfPolicy = { ...pfDraft, rules };
      d.payrollSettings.esiPolicy = esiDraft;
    });
    setPf({ ...pfDraft, rules });
    toast('PF and ESI settings saved');
  };
  const reset = () => {
    setPf({ ...PF_DEFAULTS, rules: PF_DEFAULTS.rules.map((r) => ({ ...r })) });
    setEsi({ ...ESI_DEFAULTS, enabled: esi.enabled !== false, periodStart1: String(ESI_DEFAULTS.periodStart1), periodStart2: String(ESI_DEFAULTS.periodStart2) });
  };
  const demoBasic = Number(ex.basic) || 0;
  const today = pfCeilingOn(pfDraft);
  const sample = pfOf(pfDraft, { basic: demoBasic, ceiling: today, basis: pfDraft.basis });
  return (
    <Panel
      title="Provident Fund and ESI"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the statutory values</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        The values start as the ones the law sets and you can change any of them. Months already locked keep the figures they were paid with. Who is covered is set per pay group (Pay groups) and per employee (profile, Statutory).
      </p>
      <FormGrid fields={PF_FIELDS} values={pf} setValues={setPf} db={db} />
      <h4 className="form-section" style={{ marginTop: 18 }}>PF wage ceiling over time</h4>
      <p className="pr-muted" style={{ marginBottom: 10 }}>
        The ceiling that applies from each date. A pay cycle that holds the day a new ceiling starts uses each day’s own ceiling and the average of them. In force today: <strong>{money(today)}</strong>. A pay group can set a ceiling of its own instead.
      </p>
      {(pf.rules || []).map((r, i) => (
        <div className="row" key={i} style={{ gap: 12, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 170 }}>
            <label>From</label>
            <input type="date" value={r.from || ''} onChange={(e) => setRule(i, { from: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label>Wage ceiling (₹)</label>
            <input type="number" min="1" value={r.ceiling ?? ''} onChange={(e) => setRule(i, { ceiling: e.target.value === '' ? '' : Number(e.target.value) })} />
          </div>
          <Btn kind="icon" icon="trash" title="Remove" aria-label="Remove this ceiling" disabled={(pf.rules || []).length <= 1} onClick={() => setPf({ ...pf, rules: pf.rules.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Btn kind="ghost" small icon="plus" onClick={() => setPf({ ...pf, rules: [...(pf.rules || []), { from: '', ceiling: '' }] })}>Add a ceiling</Btn>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'basic', label: 'Monthly basic (₹)', type: 'number' }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        PF wage <strong>{money(sample.wage)}</strong>. Employee <strong>{money(Math.round(sample.employee))}</strong>. Employer <strong>{money(Math.round(sample.employer))}</strong> = EPS {money(Math.round(sample.eps))} + EPF {money(Math.round(sample.employer) - Math.round(sample.eps))}. EDLI {money(Math.round(sample.edli))}, administration {money(Math.round(sample.admin))}.
      </p>
      <h4 className="form-section" style={{ marginTop: 22 }}>Employees’ State Insurance</h4>
      <FormGrid fields={ESI_FIELDS} values={esi} setValues={setEsi} db={db} />
    </Panel>
  );
}

// ---------- settings: who approves payroll ----------
const APPROVAL_FIELDS = [
  { key: 'separate', label: 'A different person approves payroll', type: 'checkbox', help: 'Off: whoever processes payroll can lock it, and an admin can unlock it by giving a reason. On: the person who processes submits it, and someone else approves it. Approval is what locks the month, and unlocking also needs their approval.' },
  { key: 'approvers', label: 'Payroll approvers', type: 'employeesearch', full: true, show: (v) => !!v.separate, help: 'Anyone can be chosen, not only admins. Leave it empty to let every admin approve. The person who submitted a month or asked to unlock it can never be the one to approve it.' },
];

function ApprovalSettings({ db, user }) {
  const saved = approvalPolicy(db);
  const [v, setV] = useState({ separate: saved.separate, approvers: saved.approvers });
  const same = (a, b) => !!a.separate === !!b.separate && JSON.stringify([...(a.approvers || [])].sort()) === JSON.stringify([...(b.approvers || [])].sort());
  const save = () => {
    let res;
    update((d) => {
      res = saveApprovalSettings(d, user, v);
    });
    if (!res.ok) return toast(res.error, 'error');
    toast('Approval settings saved');
  };
  const pending = (db.payrollRuns || []).filter((r) => r.status === 'Submitted').length;
  const eligible = approverIds({ ...db, payrollSettings: { ...db.payrollSettings, approval: { separate: true, approvers: v.approvers || [] } } });
  return (
    <Panel title="Payroll approval" right={<Btn small onClick={save} disabled={same(v, saved)}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        {v.separate ? <>Payroll is submitted by the person who processes it and locked when an approver approves it. Approvers: <strong>{eligible.map((id) => fullName(empById(db, id))).join(', ') || 'none'}</strong>{(v.approvers || []).length === 0 ? ' (every admin)' : ''}. Each approver gets an item in their Inbox.</> : 'Payroll is locked directly by whoever processes it. Admins have full access, and unlocking asks for a reason that is logged.'}
      </p>
      {saved.separate && !v.separate && pending > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>{pending} month(s) are waiting for approval. Switching approval off sends them back to Processed so they can be locked directly.</p>}
      <FormGrid fields={APPROVAL_FIELDS} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: Professional Tax and Labour Welfare Fund ----------
const LWF_FIELDS = [
  { key: 'frequency', label: 'Paid', type: 'select', options: [{ value: 'yearly', label: 'Once a year' }, { value: 'half-yearly', label: 'Twice a year (half-yearly)' }], section: 'Labour Welfare Fund', help: 'The amounts are set on each pay group. They are taken only in the months below, not every month.' },
  { key: 'month', label: 'Taken in', type: 'select', options: MONTH_OPTIONS, help: 'Tamil Nadu: yearly, due by 31 January, so December payroll. For half-yearly this is the second of the two months and the other is six months before it.' },
];

function PtLwfSettings({ db }) {
  const savedPt = ptPolicy(db);
  const state = savedPt.defaultState;
  const [slabs, setSlabs] = useState((savedPt.states[state]?.slabs || []).map((r) => ({ ...r })));
  const savedLwf = lwfPolicy(db);
  const [lwf, setLwf] = useState({ frequency: savedLwf.frequency, month: String(savedLwf.month) });
  const [ex, setEx] = useState({ gross: 40000 });
  const clean = slabs.map((r) => ({ upTo: r.upTo === '' || r.upTo === null || r.upTo === undefined ? null : Number(r.upTo), amount: Number(r.amount) || 0 }));
  const lwfDraft = { frequency: lwf.frequency === 'half-yearly' ? 'half-yearly' : 'yearly', month: Number(lwf.month) || 12 };
  const key = (o) => JSON.stringify(o);
  const changed = key(clean) !== key(savedPt.states[state]?.slabs || []) || key(lwfDraft) !== key({ frequency: savedLwf.frequency, month: Number(savedLwf.month) });
  const isDefault = key(clean) === key(PT_DEFAULTS.states['Tamil Nadu'].slabs) && key(lwfDraft) === key(LWF_DEFAULTS);
  const set = (i, patch) => setSlabs(slabs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const limited = clean.filter((r) => r.upTo !== null);
    if (!clean.length) return toast('Add at least one slab.', 'error');
    if (clean.some((r) => r.amount < 0 || (r.upTo !== null && !(r.upTo > 0)))) return toast('Amounts and limits must be positive.', 'error');
    if (limited.some((r, i) => i > 0 && r.upTo <= limited[i - 1].upTo)) return toast('Each limit must be higher than the one before.', 'error');
    if (clean.findIndex((r) => r.upTo === null) !== -1 && clean.findIndex((r) => r.upTo === null) !== clean.length - 1) return toast('The slab with no limit must be the last one.', 'error');
    update((d) => {
      const cur = ptPolicy(d);
      d.payrollSettings.ptPolicy = { defaultState: cur.defaultState, states: { ...cur.states, [cur.defaultState]: { slabs: clean } } };
      d.payrollSettings.lwfPolicy = lwfDraft;
    });
    toast('PT and LWF settings saved');
  };
  const reset = () => {
    setSlabs(PT_DEFAULTS.states['Tamil Nadu'].slabs.map((r) => ({ ...r })));
    setLwf({ frequency: LWF_DEFAULTS.frequency, month: String(LWF_DEFAULTS.month) });
  };
  const preview = { ...savedPt, states: { ...savedPt.states, [state]: { slabs: clean } } };
  const g = Number(ex.gross) || 0;
  const half = ptHalfYear(preview, state, g);
  return (
    <Panel
      title="Professional Tax and Labour Welfare Fund"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the Tamil Nadu values</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        Professional Tax for <strong>{state}</strong> (the company’s state) is charged on half-yearly income and taken monthly: a sixth of the half-yearly amount each month, with September and March making the total exact. Check the slab amounts with your CA. Months already locked keep what they were paid with. An employee who works in another state can be given a work state on their profile once that state’s slabs are added.
      </p>
      <h4 className="form-section">Slabs — half-yearly income</h4>
      {slabs.map((r, i) => (
        <div className="row" key={i} style={{ gap: 12, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Income up to (₹)</label>
            <input type="number" min="1" placeholder="No limit" value={r.upTo ?? ''} onChange={(e) => set(i, { upTo: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Tax for the half-year (₹)</label>
            <input type="number" min="0" value={r.amount ?? ''} onChange={(e) => set(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })} />
          </div>
          <Btn kind="icon" icon="trash" title="Remove" aria-label="Remove this slab" disabled={slabs.length <= 1} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Btn kind="ghost" small icon="plus" onClick={() => setSlabs([...slabs, { upTo: '', amount: '' }])}>Add a slab</Btn>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'gross', label: 'Monthly gross (₹)', type: 'number' }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        Half-yearly income <strong>{money(g * 6)}</strong> → tax for the half-year <strong>{money(half)}</strong>. Deducted <strong>{money(ptMonthly(preview, state, g, '2026-11'))}</strong> a month, and <strong>{money(ptMonthly(preview, state, g, '2027-03'))}</strong> in September and March.
      </p>
      <FormGrid fields={LWF_FIELDS} values={lwf} setValues={setLwf} db={db} />
    </Panel>
  );
}

// ---------- settings: the wage rule ----------
function WageRuleSettings({ db }) {
  const saved = wagePolicy(db);
  const names = [...new Set([...(db.payStructures || []).flatMap((st) => st.components.slice(1).map((c) => c.name)), ...saved.exclusions])];
  const [v, setV] = useState({ enabled: saved.enabled !== false, minPct: saved.minPct, exclusions: [...saved.exclusions] });
  const draft = { enabled: !!v.enabled, minPct: v.minPct === '' ? '' : Number(v.minPct), exclusions: v.exclusions || [] };
  const changed = JSON.stringify(draft) !== JSON.stringify({ enabled: saved.enabled !== false, minPct: saved.minPct, exclusions: saved.exclusions });
  const save = () => {
    if (draft.enabled && !(draft.minPct > 0 && draft.minPct <= 100)) return toast('The share must be between 1 and 100.', 'error');
    update((d) => {
      d.payrollSettings.wagePolicy = { ...draft, minPct: draft.minPct === '' ? WAGE_DEFAULTS.minPct : draft.minPct };
    });
    toast('Wage rule saved');
  };
  const fields = [
    { key: 'enabled', label: 'Warn when wages are below the share', type: 'checkbox', help: 'The labour codes want wages (basic and similar pay) to be at least a set share of total pay. A pay structure that falls short is flagged. Nothing is blocked.' },
    { key: 'minPct', label: 'Wages must be at least this share of total pay (%)', type: 'number', min: 1, max: 100, show: (x) => x.enabled },
    { key: 'exclusions', label: 'Pay components that are not counted as wages', type: 'multiselect', full: true, options: names.map((n) => ({ value: n, label: n })), show: (x) => x.enabled, help: 'Basic always counts. Tick the allowances the law lets you leave out of wages (for example HRA or conveyance). Components you add to a pay structure later appear here.' },
  ];
  return (
    <Panel title="Wage rule" right={<Btn small onClick={save} disabled={!changed}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        Total pay is the earnings in a pay structure; employer PF and gratuity are not part of it. This only warns for now: PF and gratuity are still worked out on basic, as set under PF & ESI and Gratuity. The Pay structures tab shows each structure’s wages share at ₹12 lakh CTC.
      </p>
      <FormGrid fields={fields} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: full and final ----------
const EXIT_FIELDS = [
  { key: 'encashEnabled', label: 'Pay out unused leave on exit', type: 'checkbox', section: 'Leave encashment', help: 'Applies to the leave types marked encashable under Leave settings.' },
  { key: 'encashBasis', label: 'A day’s pay is worked out from', type: 'select', options: [{ value: 'basic', label: 'Basic' }, { value: 'gross', label: 'Gross pay' }], show: (v) => v.encashEnabled },
  { key: 'encashDivisor', label: 'Divided by this many days a month', type: 'number', min: 1, show: (v) => v.encashEnabled },
  { key: 'encashMaxDays', label: 'Most days paid out (0 for no limit)', type: 'number', min: 0, show: (v) => v.encashEnabled },
  { key: 'noticeBasis', label: 'A day’s pay is worked out from', type: 'select', options: [{ value: 'basic', label: 'Basic' }, { value: 'gross', label: 'Gross pay' }], section: 'Notice shortfall recovery', help: 'Taken when someone leaves before their notice period ends. An admin can waive it for an exit.' },
  { key: 'noticeDivisor', label: 'Divided by this many days a month', type: 'number', min: 1 },
  { key: 'noticeCapDays', label: 'Most days recovered (0 for no limit)', type: 'number', min: 0 },
];
function ExitSettings({ db }) {
  const saved = exitPolicy(db);
  const [v, setV] = useState({ ...saved });
  const num = (k) => (v[k] === '' || v[k] === undefined ? EXIT_DEFAULTS[k] : Number(v[k]));
  const draft = { encashEnabled: !!v.encashEnabled, encashBasis: v.encashBasis === 'gross' ? 'gross' : 'basic', encashDivisor: num('encashDivisor'), encashMaxDays: num('encashMaxDays'), noticeBasis: v.noticeBasis === 'basic' ? 'basic' : 'gross', noticeDivisor: num('noticeDivisor'), noticeCapDays: num('noticeCapDays') };
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = () => {
    if (!(draft.encashDivisor > 0) || !(draft.noticeDivisor > 0)) return toast('Days in a month must be more than zero.', 'error');
    if (draft.encashMaxDays < 0 || draft.noticeCapDays < 0) return toast('Limits cannot be negative.', 'error');
    update((d) => {
      d.payrollSettings.exitPolicy = draft;
    });
    toast('Full and final settings saved');
  };
  return (
    <Panel title="Full and final settlement" right={<span className="row"><Btn kind="ghost" small onClick={() => setV({ ...EXIT_DEFAULTS })} disabled={JSON.stringify(draft) === JSON.stringify(EXIT_DEFAULTS)}>Use the standard values</Btn><Btn small onClick={save} disabled={!changed}>Save</Btn></span>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        How leave encashment and notice recovery are worked out when someone leaves. Gratuity has its own tab. Settlements that are already added to payroll keep their amounts.
      </p>
      <FormGrid fields={EXIT_FIELDS} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: payslip email ----------
const MAIL_FIELDS = [
  { key: 'enabled', label: 'The mail service is connected', type: 'checkbox', section: 'Mail service (SMTP)', help: 'Tick this once SMTP is set up. Until then payslips wait in the outbox below and nothing is sent. The SMTP password is not stored here; it belongs with the mail service.' },
  { key: 'host', label: 'SMTP server' },
  { key: 'port', label: 'Port', type: 'number' },
  { key: 'security', label: 'Security', type: 'select', options: ['STARTTLS', 'SSL/TLS', 'None'] },
  { key: 'user', label: 'User name' },
  { key: 'fromName', label: 'Sent from (name)', section: 'Message' },
  { key: 'fromEmail', label: 'Sent from (email)', type: 'email' },
  { key: 'subject', label: 'Subject', full: true, help: 'Use {month} and {name}.' },
  { key: 'body', label: 'Message', type: 'textarea', full: true, help: 'Use {month} and {name}. The payslip is attached as a PDF that opens with the employee number followed by the date of birth (DDMMYYYY).' },
];
function MailSettings({ db }) {
  const saved = mailSettings(db);
  const [v, setV] = useState({ ...saved });
  const changed = JSON.stringify({ ...saved, port: Number(v.port) || saved.port }) !== JSON.stringify({ ...v, port: Number(v.port) || saved.port }) || JSON.stringify(v) !== JSON.stringify(saved);
  const save = () => {
    update((d) => {
      d.payrollSettings.mail = { ...MAIL_DEFAULTS, ...v, port: Number(v.port) || 587 };
    });
    toast('Payslip email settings saved');
  };
  const outbox = db.payslipOutbox || [];
  const waiting = outbox.filter((x) => x.status !== 'Sent').length;
  return (
    <Panel title="Payslip email" right={<Btn small onClick={save} disabled={!changed}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        When payroll is released, each employee’s payslip is put in the outbox below, to be emailed as a password-protected PDF. {smtpReady(saved) ? 'The mail service is marked as connected, so new payslips are queued for sending.' : 'The mail service is not connected yet, so they wait in the outbox. Nothing is sent from the browser.'} {waiting} waiting.
      </p>
      <FormGrid fields={MAIL_FIELDS} values={v} setValues={setV} db={db} />
      <h4 className="form-section" style={{ marginTop: 18 }}>Outbox</h4>
      <DataTable
        rows={outbox.slice(0, 100)}
        empty="Nothing in the outbox yet. Payslips are added when you release payroll."
        pageSize={10}
        columns={[
          { key: 'emp', label: 'Employee', sortable: false, render: (x) => fullName(empById(db, x.empId)) },
          { key: 'to', label: 'To' },
          { key: 'month', label: 'Payslip for', render: (x) => monthLabel(x.month) },
          { key: 'status', label: 'Status', render: (x) => <Badge tone={x.status === 'Sent' ? 'green' : x.status === 'No email address' ? 'red' : 'amber'}>{x.status}</Badge> },
        ]}
      />
    </Panel>
  );
}

function PayrollSettings({ db, user }) {
  const [tab, setTab] = useState('cycle');
  const [v, setV] = useState({ cycleStartDay: db.payrollSettings.cycleStartDay });
  const save = () => {
    update((d) => (d.payrollSettings.cycleStartDay = Math.min(28, Math.max(1, Number(v.cycleStartDay) || 1))));
    toast('Pay cycle saved');
  };
  return (
    <div className="pr-stack">
      <Tabs tabs={[{ key: 'cycle', label: 'Pay cycle' }, { key: 'groups', label: 'Pay groups' }, { key: 'structures', label: 'Pay structures' }, { key: 'pfesi', label: 'PF & ESI' }, { key: 'ptlwf', label: 'PT & LWF' }, { key: 'wage', label: 'Wage rule' }, { key: 'exit', label: 'Full & final' }, { key: 'mail', label: 'Payslip email' }, { key: 'gratuity', label: 'Gratuity' }, { key: 'approval', label: 'Approval' }]} active={tab} onChange={setTab} />
      {tab === 'cycle' && (
        <Panel title="Pay cycle" right={<Btn small onClick={save}>Save</Btn>}>
          <FormGrid fields={[{ key: 'cycleStartDay', label: 'Pay cycle starts on day', type: 'number', min: 1, max: 28, help: '26 means November payroll covers 26 Oct – 25 Nov. Use 1 for calendar months. Attendance uses the same cycle, so it is also shown in Attendance settings.' }]} values={v} setValues={setV} db={db} />
          <p className="pr-muted" style={{ marginTop: 12 }}>
            Pay day, statutory deductions and the salary split are set per pay group and pay structure.
          </p>
        </Panel>
      )}
      {tab === 'groups' && <PayGroups db={db} />}
      {tab === 'structures' && <PayStructures db={db} />}
      {tab === 'pfesi' && <PfEsiSettings db={db} />}
      {tab === 'ptlwf' && <PtLwfSettings db={db} />}
      {tab === 'wage' && <WageRuleSettings db={db} />}
      {tab === 'exit' && <ExitSettings db={db} />}
      {tab === 'mail' && <MailSettings db={db} />}
      {tab === 'gratuity' && <GratuitySettings db={db} />}
      {tab === 'approval' && <ApprovalSettings db={db} user={user} />}
    </div>
  );
}
