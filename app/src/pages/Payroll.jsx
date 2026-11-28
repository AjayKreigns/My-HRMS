// Payroll module laid out like the company's own payroll screens: module tabs, analytics, the run-payroll cycle with its six input steps,
// admin, approvals, loans, benefits, reports and settings. The analytics screens are here; every other module is its own file,
// loaded the first time its tab is opened (Payroll was one 2,700-line file, and opening it parsed all of it).
import { lazy, Suspense } from 'react';
import { useMemo, useState } from 'react';
import { useDB, addItem, update, uid } from '../store.js';
import { Btn, Badge, DataTable, EmpChip, NavTabs, toast, confirmAction, exportCSV, Dropdown } from '../ui.jsx';
import { empById, fullName, money, monthLabel, ymOf, addMonths, addDays, todayISO, payrollPeople } from '../utils.js';
import { SplitBar, ShareTable, VarianceRows, lakh } from './payrollViews.jsx';
import { EmployeeList, MODULES, MonthSelect, Panel, SUBS, bandOf, compa, currentPayMonth, fyName, fyStart, inr, isDone, monthTotals, shortMonth, shortName, stamp, sumOf, useRoute } from './payrollShared.jsx';
import '../payroll.css';
import '../payrollx.css';
export { currentPayMonth };

const RunPayroll = lazy(() => import('./PayrollRun.jsx'));
const ops = (name) => lazy(() => import('./PayrollOps.jsx').then((m) => ({ default: m[name] })));
const PayrollAdmin = ops('PayrollAdmin');
const Approvals = ops('Approvals');
const Loans = ops('Loans');
const Benefits = ops('Benefits');
const Reports = ops('Reports');
const PayrollSettings = lazy(() => import('./PayrollSettings.jsx'));

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
      <h1 className="sr-only">Payroll</h1>
      <NavTabs className="pr-modules" variant="underline" glideSelector=".pr-body" label="Payroll" items={MODULES.map((m) => ({ key: m.key, label: m.label, href: `#/admin/payroll/${m.key}` }))} active={mod} />
      {subs && <NavTabs className="pr-subs" glideSelector=".pr-body" label={`${mod} sections`} items={subs.map(([k, label]) => ({ key: k, label, href: `#/admin/payroll/${mod}/${k}` }))} active={sub} />}
      <div className="pr-body page-enter">
        <div className="pr-entity">
          <Dropdown value={entity} onChange={setEntity} options={entities.length ? entities : [db.company.name]} label="Legal entity" />
        </div>
        <Suspense fallback={<div className="page-loading" role="status"><span className="sr-only">Loading</span></div>}>{body}</Suspense>
      </div>
    </div>
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
