import { useEffect, useState } from 'react';
import { useDB, addItem, patchItem, update, uid, notify, resetDB, getDB } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, EmpChip, Stat, Crud, KV, Modal, SearchBox, toast, confirmAction, exportCSV, BarChart, FormGrid, Progress } from '../ui.jsx';
import { go } from '../App.jsx';
import { PRIMARY_FIELDS, CONTACT_FIELDS, jobFields, timeFields, FINANCE_FIELDS, ADDRESS_FIELDS, IDENTITY_FIELDS, unflatten } from './Profile.jsx';
import Payroll from './Payroll.jsx';
import { LeaveAdmin, AttendanceAdmin, PerformanceAdmin, ExpensesAdmin, ProjectsAdmin, AssetsAdmin, HelpdeskAdmin } from './AdminOps.jsx';
import Hiring from './Hiring.jsx';
import { empById, fullName, fmtDate, money, todayISO, addDays, salaryBreakup, leaveBalances, parseISO, ymOf, monthLabel, payslipFor, daysInMonth } from '../utils.js';
import { monthRecords, attendanceStats } from './TimeOff.jsx';

export default function Admin({ user, section }) {
  switch (section) {
    case 'lifecycle':
      return <Lifecycle user={user} />;
    case 'hiring':
      return <Hiring user={user} />;
    case 'payroll':
      return <Payroll user={user} />;
    case 'leave':
      return <LeaveAdmin user={user} />;
    case 'attendance':
      return <AttendanceAdmin user={user} />;
    case 'performance':
      return <PerformanceAdmin user={user} />;
    case 'expenses':
      return <ExpensesAdmin user={user} />;
    case 'projects':
      return <ProjectsAdmin user={user} />;
    case 'assets':
      return <AssetsAdmin user={user} />;
    case 'helpdesk':
      return <HelpdeskAdmin user={user} />;
    case 'reports':
      return <Reports user={user} />;
    case 'settings':
      return <Settings user={user} />;
    default:
      return <Employees user={user} />;
  }
}

export function newEmployeeFields(db) {
  return [
    ...PRIMARY_FIELDS.map((f) => ({ ...f, section: 'Personal details' })),
    ...CONTACT_FIELDS.map((f) => ({ ...f, section: 'Contact details' })),
    ...jobFields(db).map((f) => ({ ...f, section: 'Job details' })),
    ...timeFields(db).map((f) => ({ ...f, section: 'Time, leave & expense policies' })),
    ...FINANCE_FIELDS,
    { key: 'password', label: 'Initial HRMS password', type: 'text', required: true, default: 'Welcome@123', section: 'HRMS login', help: 'Share this with the employee; they can change it after logging in.' },
  ];
}

const COLORS = ['#5746af', '#0d9488', '#d97706', '#2563eb', '#db2777', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

export function createEmployee(v) {
  const db = getDB();
  const data = unflatten(v, {});
  const id = uid('emp');
  addItem('employees', {
    middleName: '', displayName: '', skills: [], family: [], education: [], experience: [], carryForward: {}, about: '',
    currentAddress: {}, permanentAddress: {}, bank: {}, ...data,
    id,
    color: COLORS[db.employees.length % COLORS.length],
  });
  return id;
}

function Employees({ user }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('current');
  const [dept, setDept] = useState('');
  const [adding, setAdding] = useState(false);
  const [pw, setPw] = useState(null);
  useEffect(() => {
    if (window.location.hash.includes('add')) setAdding(true);
  }, []);
  const rows = db.employees.filter(
    (e) =>
      (status === 'all' || (status === 'current' ? e.status !== 'Exited' : e.status === status)) &&
      (!dept || e.department === dept) &&
      (!q || [fullName(e), e.empNo, e.workEmail, e.designation].join(' ').toLowerCase().includes(q.toLowerCase())),
  );
  const nextNo = `IFE${Math.max(...db.employees.map((e) => Number(e.empNo.replace(/\D/g, '')) || 0)) + 1}`;
  const cols = [
    { key: 'name', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} />, csv: (e) => fullName(e) },
    { key: 'empNo', label: 'Emp no.' },
    { key: 'department', label: 'Department' },
    { key: 'dateOfJoining', label: 'Joined', render: (e) => fmtDate(e.dateOfJoining) },
    { key: 'reportingTo', label: 'Manager', render: (e) => fullName(empById(db, e.reportingTo)), csv: (e) => fullName(empById(db, e.reportingTo)) },
    { key: 'ctc', label: 'CTC', render: (e) => money(e.ctc) },
    { key: 'role', label: 'Access' },
    { key: 'status', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
  ];
  return (
    <div>
      <PageHead title="Manage employees" sub={`${db.employees.filter((e) => e.status !== 'Exited').length} current employees`}>
        <Btn kind="ghost" icon="download" onClick={() => exportCSV('employees', cols, rows)}>Export</Btn>
        <Btn icon="plus" onClick={() => setAdding(true)}>Add employee</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {['Active', 'Probation', 'Notice period', 'Pre-boarding'].map((s) => (
          <Stat key={s} label={s} value={db.employees.filter((e) => e.status === s).length} />
        ))}
      </div>
      <Card
        pad={false}
        title={
          <span className="row">
            <SearchBox value={q} onChange={setQ} placeholder="Search employees" />
            <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="current">Current employees</option>
              <option value="all">Everyone</option>
              {['Active', 'Probation', 'Notice period', 'Pre-boarding', 'Exited'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="select-sm" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {db.departments.map((d) => <option key={d.id}>{d.name}</option>)}
            </select>
          </span>
        }
      >
        <DataTable
          rows={rows}
          pageSize={25}
          onRowClick={(e) => go(`profile/${e.id}`)}
          columns={[
            ...cols,
            {
              key: 'act',
              label: '',
              sortable: false,
              render: (e) => (
                <span className="row-actions" onClick={(ev) => ev.stopPropagation()}>
                  <Btn kind="ghost" small onClick={() => go(`profile/${e.id}/job`)}>Edit</Btn>
                  <Btn kind="ghost" small onClick={() => setPw(e)}>Reset password</Btn>
                </span>
              ),
            },
          ]}
        />
      </Card>
      {adding && (
        <FormModal
          wide
          title="Add employee"
          fields={newEmployeeFields(db)}
          initial={{ empNo: nextNo, dateOfJoining: todayISO(), status: 'Pre-boarding', role: 'employee', ctc: 600000, legalEntity: db.company.legalName, attendanceNumber: `ATT${nextNo.replace(/\D/g, '')}`, nationality: 'Indian' }}
          validate={(v) => (db.employees.some((e) => e.workEmail.toLowerCase() === String(v.workEmail).toLowerCase()) ? 'That work email is already used.' : db.employees.some((e) => e.empNo === v.empNo) ? 'That employee number is already used.' : '')}
          submitLabel="Add employee"
          onClose={() => {
            setAdding(false);
            if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/admin/employees');
          }}
          onSave={(v) => {
            const id = createEmployee({ ...v, probationEndDate: v.probationEndDate || addDays(v.dateOfJoining, 180) });
            ['Collect signed offer letter', 'Collect ID, address and education documents', 'Issue laptop and access card', 'Create email account', 'Induction & HSE training'].forEach((task, i) =>
              addItem('onboardingTasks', { empId: id, task, owner: user.id, dueDate: addDays(v.dateOfJoining, i - 2), stage: i < 2 ? 'Pre-boarding' : i < 4 ? 'Day 1' : 'Week 1', done: false }),
            );
            if (v.reportingTo) notify(v.reportingTo, `${v.firstName} ${v.lastName} will join your team on ${fmtDate(v.dateOfJoining)}.`);
            setAdding(false);
            toast('Employee added with an onboarding checklist');
          }}
        />
      )}
      {pw && (
        <FormModal
          title={`Reset password for ${fullName(pw)}`}
          fields={[{ key: 'password', label: 'New password', required: true, full: true }]}
          initial={{ password: 'Welcome@123' }}
          onClose={() => setPw(null)}
          onSave={(v) => {
            patchItem('employees', pw.id, { password: v.password });
            notify(pw.id, 'HR reset your HRMS password.');
            setPw(null);
            toast('Password reset');
          }}
        />
      )}
    </div>
  );
}

// ---------- onboarding & exit ----------
export function fnfFor(db, exit) {
  const emp = empById(db, exit.empId);
  const b = salaryBreakup(emp.ctc, db.payrollSettings);
  const basic = b.earnings[0][1];
  const lwd = exit.lastWorkingDay;
  const ym = lwd.slice(0, 7);
  const days = Number(lwd.slice(8));
  const salary = (b.gross / daysInMonth(ym)) * days;
  const el = leaveBalances(db, emp.id).find((x) => x.type.encashable === 'Yes');
  const encash = el ? Math.max(el.available, 0) * (basic / 26) : 0;
  const years = (parseISO(lwd) - parseISO(emp.dateOfJoining)) / (365.25 * 864e5);
  const gratuity = years >= 5 ? (15 / 26) * basic * Math.floor(years + (years % 1 >= 0.5 ? 1 : 0)) : 0;
  const served = Math.round((parseISO(lwd) - parseISO(exit.resignationDate)) / 864e5);
  const shortfall = Math.max(Number(emp.noticePeriodDays || 0) - served, 0);
  const recovery = exit.waiveNotice === 'Yes' ? 0 : (b.gross / 30) * shortfall;
  const loans = db.loans.filter((l) => l.empId === emp.id && l.status === 'Active').reduce((s, l) => s + Number(l.amount) / Number(l.tenureMonths), 0);
  const items = [
    ['Salary for final month', salary],
    [`Leave encashment (${el ? Math.max(el.available, 0) : 0} days)`, encash],
    [`Gratuity (${years.toFixed(1)} years)`, gratuity],
    [`Notice shortfall recovery (${shortfall} days)`, -recovery],
    ['Outstanding loan recovery', -loans],
  ];
  return { emp, items, net: items.reduce((s, [, v]) => s + v, 0) };
}

function Lifecycle({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('onboarding');
  const [task, setTask] = useState(null);
  const [exit, setExit] = useState(null);
  const [fnf, setFnf] = useState(null);
  const joining = db.employees.filter((e) => ['Pre-boarding', 'Probation'].includes(e.status));
  const CHECK = [
    ['handover', 'Knowledge handover'],
    ['assets', 'Assets returned'],
    ['accessRevoked', 'System access revoked'],
    ['exitInterview', 'Exit interview done'],
    ['noDues', 'No-dues from all departments'],
  ];
  return (
    <div>
      <PageHead title="Onboarding & exit">
        {tab === 'onboarding' ? <Btn icon="plus" onClick={() => setTask({ stage: 'Pre-boarding', dueDate: todayISO() })}>Add task</Btn> : <Btn icon="plus" onClick={() => setExit({ exitType: 'Resignation', resignationDate: todayISO() })}>Initiate exit</Btn>}
      </PageHead>
      <Tabs tabs={[{ key: 'onboarding', label: 'Onboarding' }, { key: 'probation', label: 'Probation' }, { key: 'exits', label: 'Exits & full and final' }]} active={tab} onChange={setTab} />
      {tab === 'onboarding' && (
        <div className="stack">
          {joining.filter((e) => db.onboardingTasks.some((t) => t.empId === e.id)).map((e) => {
            const tasks = db.onboardingTasks.filter((t) => t.empId === e.id);
            const done = tasks.filter((t) => t.done).length;
            return (
              <Card
                key={e.id}
                title={<span className="row"><EmpChip emp={e} sub={`Joins ${fmtDate(e.dateOfJoining)} · ${e.designation}`} /> <Badge>{e.status}</Badge></span>}
                actions={
                  <span className="row">
                    <span style={{ width: 120 }}><Progress value={(done / tasks.length) * 100} tone="green" /></span>
                    <span className="muted">{done}/{tasks.length}</span>
                    {e.status === 'Pre-boarding' && <Btn small onClick={() => (patchItem('employees', e.id, { status: 'Probation' }), toast(`${fullName(e)} marked as joined`))}>Mark as joined</Btn>}
                  </span>
                }
              >
                <ul className="list">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <label className="check">
                        <input type="checkbox" checked={t.done} onChange={(ev) => patchItem('onboardingTasks', t.id, { done: ev.target.checked })} />
                        <span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.task}</span>
                      </label>
                      <span className="row">
                        <Badge tone="grey">{t.stage}</Badge>
                        <span className="muted">{fullName(empById(db, t.owner))} · due {fmtDate(t.dueDate)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {joining.filter((e) => db.onboardingTasks.some((t) => t.empId === e.id)).length === 0 && <Card><p className="muted">No one is onboarding right now. Add an employee to start a checklist.</p></Card>}
        </div>
      )}
      {tab === 'probation' && (
        <Card pad={false}>
          <DataTable
            rows={db.employees.filter((e) => e.status === 'Probation')}
            empty="No one is on probation."
            columns={[
              { key: 'name', label: 'Employee', render: (e) => <EmpChip emp={e} /> },
              { key: 'dateOfJoining', label: 'Joined', render: (e) => fmtDate(e.dateOfJoining) },
              { key: 'probationEndDate', label: 'Probation ends', render: (e) => fmtDate(e.probationEndDate) },
              { key: 'reportingTo', label: 'Manager', render: (e) => fullName(empById(db, e.reportingTo)) },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (e) => (
                  <span className="row">
                    <Btn small kind="success" onClick={() => (patchItem('employees', e.id, { status: 'Active', confirmedOn: todayISO() }), notify(e.id, 'Congratulations! Your employment has been confirmed.'), toast('Confirmed'))}>Confirm</Btn>
                    <Btn small kind="ghost" onClick={() => (patchItem('employees', e.id, { probationEndDate: addDays(e.probationEndDate, 90) }), toast('Probation extended by 90 days'))}>Extend 90 days</Btn>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
      {tab === 'exits' && (
        <Card pad={false}>
          <DataTable
            rows={db.exits}
            empty="No exits."
            columns={[
              { key: 'empId', label: 'Employee', render: (x) => <EmpChip emp={empById(db, x.empId)} /> },
              { key: 'exitType', label: 'Type' },
              { key: 'resignationDate', label: 'Resigned on', render: (x) => fmtDate(x.resignationDate) },
              { key: 'lastWorkingDay', label: 'Last working day', render: (x) => fmtDate(x.lastWorkingDay) },
              { key: 'reason', label: 'Reason' },
              { key: 'check', label: 'Checklist', sortable: false, render: (x) => `${Object.values(x.checklist).filter(Boolean).length}/${CHECK.length}` },
              { key: 'status', label: 'Status', render: (x) => <Badge>{x.status}</Badge> },
              { key: 'act', label: '', sortable: false, render: (x) => <Btn small kind="ghost" onClick={() => setFnf(x)}>Manage</Btn> },
            ]}
          />
        </Card>
      )}
      {task && (
        <FormModal
          title="Add onboarding task"
          fields={[
            { key: 'empId', label: 'New joinee', type: 'select', required: true, full: true, options: (d) => d.employees.filter((e) => ['Pre-boarding', 'Probation'].includes(e.status)).map((e) => ({ value: e.id, label: fullName(e) })) },
            { key: 'task', label: 'Task', required: true, full: true },
            { key: 'owner', label: 'Owner', type: 'employee', required: true },
            { key: 'dueDate', label: 'Due date', type: 'date', required: true },
            { key: 'stage', label: 'Stage', type: 'select', options: ['Pre-boarding', 'Day 1', 'Week 1', 'Month 1'] },
          ]}
          initial={task}
          onClose={() => setTask(null)}
          onSave={(v) => {
            addItem('onboardingTasks', { ...v, done: false });
            notify(v.owner, `Onboarding task assigned to you: ${v.task}`, 'admin/lifecycle');
            setTask(null);
            toast('Task added');
          }}
        />
      )}
      {exit && (
        <FormModal
          title="Initiate exit"
          fields={[
            { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
            { key: 'exitType', label: 'Exit type', type: 'select', options: ['Resignation', 'Termination', 'Retirement', 'End of contract', 'Absconding'], required: true },
            { key: 'resignationDate', label: 'Resignation / notice date', type: 'date', required: true },
            { key: 'lastWorkingDay', label: 'Last working day', type: 'date', required: true },
            { key: 'waiveNotice', label: 'Waive notice shortfall', type: 'select', options: ['No', 'Yes'], default: 'No' },
            { key: 'reason', label: 'Reason', type: 'select', options: ['Better opportunity', 'Higher studies', 'Relocation', 'Personal reasons', 'Performance', 'Health', 'Other'], required: true },
            { key: 'rehire', label: 'Eligible for rehire', type: 'select', options: ['Yes', 'No'], default: 'Yes' },
            { key: 'notes', label: 'Notes', type: 'textarea', full: true },
          ]}
          initial={exit}
          validate={(v) => (v.lastWorkingDay < v.resignationDate ? 'Last working day is before the notice date.' : db.exits.some((x) => x.empId === v.empId && x.status !== 'Withdrawn') ? 'An exit is already in progress for this employee.' : '')}
          onClose={() => setExit(null)}
          onSave={(v) => {
            addItem('exits', { ...v, status: 'Approved', checklist: { handover: false, assets: false, accessRevoked: false, exitInterview: false, noDues: false } });
            patchItem('employees', v.empId, { status: 'Notice period' });
            setExit(null);
            setTab('exits');
            toast('Exit initiated');
          }}
        />
      )}
      {fnf && (() => {
        const x = db.exits.find((e) => e.id === fnf.id);
        const calc = fnfFor(db, x);
        return (
          <Modal
            wide
            title={`Exit — ${fullName(calc.emp)}`}
            onClose={() => setFnf(null)}
            footer={
              x.status !== 'Settled' && (
                <>
                  <Btn kind="ghost" onClick={() => (patchItem('exits', x.id, { status: 'Withdrawn' }), patchItem('employees', x.empId, { status: 'Active' }), setFnf(null), toast('Exit withdrawn'))}>Withdraw exit</Btn>
                  <Btn
                    onClick={() => {
                      if (!Object.values(x.checklist).every(Boolean) && !confirmAction('Some checklist items are still open. Settle anyway?')) return;
                      patchItem('exits', x.id, { status: 'Settled', fnfAmount: calc.net, settledOn: todayISO() });
                      update((d) => {
                        d.employees.find((e) => e.id === x.empId).status = 'Exited';
                        d.assets.forEach((a) => a.assignedTo === x.empId && Object.assign(a, { assignedTo: '', assignedOn: '' }));
                      });
                      setFnf(null);
                      toast('Full and final settled; employee marked as exited');
                    }}
                  >
                    Settle full & final
                  </Btn>
                </>
              )
            }
          >
            <div className="grid g2">
              <div>
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>Exit checklist</h4>
                {CHECK.map(([k, l]) => (
                  <label key={k} className="check" style={{ padding: '6px 0' }}>
                    <input type="checkbox" checked={!!x.checklist[k]} disabled={x.status === 'Settled'} onChange={(e) => update((d) => (d.exits.find((y) => y.id === x.id).checklist[k] = e.target.checked))} /> {l}
                  </label>
                ))}
                <KV items={[['Last working day', fmtDate(x.lastWorkingDay)], ['Notice period', `${calc.emp.noticePeriodDays} days`], ['Reason', x.reason], ['Rehire', x.rehire || '—']]} />
              </div>
              <div>
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>Full and final settlement (estimate)</h4>
                <ul className="list">
                  {calc.items.map(([k, v]) => (
                    <li key={k}><span>{k}</span><strong style={{ color: v < 0 ? 'var(--red)' : undefined }}>{money(v)}</strong></li>
                  ))}
                  <li><strong>Net payable</strong><strong>{money(calc.net)}</strong></li>
                </ul>
                {x.status === 'Settled' && <Badge tone="green">Settled on {fmtDate(x.settledOn)}</Badge>}
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ---------- reports ----------
function Reports() {
  const db = useDB();
  const [tab, setTab] = useState('headcount');
  const ym = ymOf();
  const current = db.employees.filter((e) => e.status !== 'Exited');
  const group = (arr, key) => Object.entries(arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {})).map(([label, value]) => ({ label, value }));
  const year = String(new Date().getFullYear());
  const leaveUse = db.leaveTypes.map((t) => ({ label: t.name, value: db.leaveRequests.filter((r) => r.typeId === t.id && r.status === 'Approved' && r.from.startsWith(year)).reduce((s, r) => s + Number(r.days), 0), color: t.color }));
  const cost = db.departments.map((d) => ({ label: d.name, value: current.filter((e) => e.department === d.name).reduce((s, e) => s + Number(e.ctc || 0), 0) }));
  const exited = db.employees.filter((e) => e.status === 'Exited').length + db.exits.filter((x) => x.status !== 'Withdrawn' && x.status !== 'Settled').length;
  const attRows = current.map((e) => ({ emp: e, st: attendanceStats(monthRecords(db, e.id, ym).filter((r) => r.date <= todayISO())) }));
  const lastRun = [...db.payrollRuns].sort((a, b) => b.month.localeCompare(a.month))[0];
  const payRows = lastRun ? current.filter((e) => e.dateOfJoining.slice(0, 7) <= lastRun.month).map((e) => payslipFor(db, e, lastRun.month)) : [];
  return (
    <div>
      <PageHead title="Reports" sub="Live analytics across people, time, leave and payroll." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Headcount" value={current.length} tone="brand" />
        <Stat label="Joined this year" value={db.employees.filter((e) => e.dateOfJoining.startsWith(year)).length} tone="green" />
        <Stat label="Exits (in progress + done)" value={exited} tone="red" sub={`Attrition ${current.length ? ((exited / current.length) * 100).toFixed(1) : 0}%`} />
        <Stat label="Annual payroll cost" value={money(current.reduce((s, e) => s + Number(e.ctc || 0), 0))} />
      </div>
      <Tabs tabs={[{ key: 'headcount', label: 'Headcount' }, { key: 'attendance', label: 'Attendance' }, { key: 'leave', label: 'Leave' }, { key: 'payroll', label: 'Payroll' }]} active={tab} onChange={setTab} />
      {tab === 'headcount' && (
        <div className="grid g2">
          <Card title="By department"><BarChart data={group(current, (e) => e.department)} /></Card>
          <Card title="By location"><BarChart data={group(current, (e) => db.locations.find((l) => l.id === e.locationId)?.name || '—')} /></Card>
          <Card title="By gender"><BarChart data={group(current, (e) => e.gender)} /></Card>
          <Card title="By employment status"><BarChart data={group(current, (e) => e.status)} /></Card>
          <Card title="By worker type"><BarChart data={group(current, (e) => e.workerType)} /></Card>
          <Card title="By tenure">
            <BarChart data={group(current, (e) => { const y = (Date.now() - parseISO(e.dateOfJoining)) / (365.25 * 864e5); return y < 1 ? '< 1 year' : y < 3 ? '1–3 years' : y < 5 ? '3–5 years' : y < 10 ? '5–10 years' : '10+ years'; })} />
          </Card>
        </div>
      )}
      {tab === 'attendance' && (
        <Card
          pad={false}
          title={`Attendance summary — ${monthLabel(ym)}`}
          actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV(`attendance-summary-${ym}`, [{ label: 'Employee', csv: (r) => fullName(r.emp) }, { label: 'Present', csv: (r) => r.st.present }, { label: 'WFH', csv: (r) => r.st.wfh }, { label: 'Leave', csv: (r) => r.st.leave }, { label: 'Absent', csv: (r) => r.st.absent }, { label: 'On time %', csv: (r) => r.st.onTimePct }], attRows)}>Export</Btn>}
        >
          <DataTable
            rows={attRows}
            rowKey={(r) => r.emp.id}
            pageSize={30}
            columns={[
              { key: 'emp', label: 'Employee', sortValue: (r) => fullName(r.emp), render: (r) => <EmpChip emp={r.emp} /> },
              { key: 'present', label: 'Present', sortValue: (r) => r.st.present, render: (r) => r.st.present },
              { key: 'wfh', label: 'WFH', sortValue: (r) => r.st.wfh, render: (r) => r.st.wfh },
              { key: 'leave', label: 'Leave', sortValue: (r) => r.st.leave, render: (r) => r.st.leave },
              { key: 'absent', label: 'Absent', sortValue: (r) => r.st.absent, render: (r) => r.st.absent },
              { key: 'ontime', label: 'On time', sortValue: (r) => r.st.onTimePct, render: (r) => `${r.st.onTimePct}%` },
            ]}
          />
        </Card>
      )}
      {tab === 'leave' && (
        <div className="grid g2">
          <Card title={`Leave days taken in ${year}`}><BarChart data={leaveUse} /></Card>
          <Card title="Pending leave requests">
            <BarChart data={group(db.leaveRequests.filter((r) => r.status === 'Pending'), (r) => empById(db, r.empId)?.department || '—')} />
          </Card>
        </div>
      )}
      {tab === 'payroll' && (
        <div className="stack">
          <Card title="Annual CTC by department"><BarChart data={cost} format={(v) => money(v)} /></Card>
          {lastRun && (
            <Card
              pad={false}
              title={`Payroll register — ${monthLabel(lastRun.month)}`}
              actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV(`payroll-register-${lastRun.month}`, [{ label: 'Employee', csv: (s) => fullName(s.emp) }, { label: 'Emp no', csv: (s) => s.emp.empNo }, { label: 'Gross', csv: (s) => Math.round(s.gross) }, { label: 'Deductions', csv: (s) => Math.round(s.totalDed) }, { label: 'Net', csv: (s) => Math.round(s.net) }], payRows)}>Export</Btn>}
            >
              <DataTable
                rows={payRows}
                rowKey={(s) => s.emp.id}
                columns={[
                  { key: 'emp', label: 'Employee', sortValue: (s) => fullName(s.emp), render: (s) => <EmpChip emp={s.emp} /> },
                  { key: 'gross', label: 'Gross', render: (s) => money(s.gross) },
                  { key: 'totalDed', label: 'Deductions', render: (s) => money(s.totalDed) },
                  { key: 'net', label: 'Net', render: (s) => money(s.net) },
                ]}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- settings ----------
const COMPANY_FIELDS = [
  { key: 'name', label: 'Company name', required: true, section: 'Company' },
  { key: 'legalName', label: 'Legal name', required: true, section: 'Company' },
  { key: 'entityType', label: 'Entity type', type: 'select', options: ['Partnership firm', 'LLP', 'Private limited', 'Proprietorship'], section: 'Company' },
  { key: 'website', label: 'Website', section: 'Company' },
  { key: 'email', label: 'HR email', type: 'email', section: 'Company' },
  { key: 'phone', label: 'Phone', type: 'tel', section: 'Company' },
  { key: 'address', label: 'Registered address', full: true, section: 'Address' },
  { key: 'city', label: 'City', section: 'Address' },
  { key: 'state', label: 'State', section: 'Address' },
  { key: 'country', label: 'Country', section: 'Address' },
  { key: 'pincode', label: 'PIN code', section: 'Address' },
  { key: 'pan', label: 'PAN', section: 'Statutory' },
  { key: 'tan', label: 'TAN', section: 'Statutory' },
  { key: 'gstin', label: 'GSTIN', section: 'Statutory' },
  { key: 'pfCode', label: 'PF establishment code', section: 'Statutory' },
  { key: 'esiCode', label: 'ESI code', section: 'Statutory' },
  { key: 'ptNumber', label: 'Professional tax number', section: 'Statutory' },
  { key: 'financialYearStart', label: 'Financial year starts', type: 'select', options: ['April', 'January'], section: 'Preferences' },
  { key: 'currency', label: 'Currency', type: 'select', options: ['INR', 'USD', 'AED'], section: 'Preferences' },
  { key: 'timezone', label: 'Time zone', section: 'Preferences' },
  { key: 'loginMessage', label: 'Message on the login page', type: 'textarea', full: true, section: 'Preferences' },
];

function CompanyForm() {
  const db = useDB();
  const [v, setV] = useState(db.company);
  return (
    <Card title="Company profile" actions={<Btn onClick={() => (update((d) => (d.company = { ...d.company, ...v })), toast('Company details saved'))}>Save</Btn>}>
      <FormGrid fields={COMPANY_FIELDS} values={v} setValues={setV} db={db} />
    </Card>
  );
}

function Settings() {
  const db = useDB();
  const [tab, setTab] = useState('company');
  const empOpt = { type: 'employee' };
  const name = (id) => fullName(empById(db, id));
  return (
    <div>
      <PageHead title="Company settings" />
      <Tabs
        tabs={[
          { key: 'company', label: 'Company' },
          { key: 'departments', label: 'Departments' },
          { key: 'locations', label: 'Locations' },
          { key: 'designations', label: 'Job titles' },
          { key: 'grades', label: 'Bands & grades' },
          { key: 'units', label: 'Business units' },
          { key: 'cost', label: 'Cost centres' },
          { key: 'data', label: 'Data & backup' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'company' && <CompanyForm />}
      {tab === 'departments' && (
        <Crud title="Departments" collection="departments" searchKeys={['name', 'code']} fields={[{ key: 'name', label: 'Name', required: true }, { key: 'code', label: 'Code' }, { key: 'head', label: 'Department head', ...empOpt }, { key: 'description', label: 'Description', type: 'textarea', full: true }]} columns={[{ key: 'name', label: 'Department' }, { key: 'code', label: 'Code' }, { key: 'head', label: 'Head', render: (d) => name(d.head) }, { key: 'count', label: 'People', sortable: false, render: (d) => db.employees.filter((e) => e.department === d.name && e.status !== 'Exited').length }]} />
      )}
      {tab === 'locations' && (
        <Crud title="Locations" collection="locations" fields={[{ key: 'name', label: 'Name', required: true }, { key: 'address', label: 'Address', full: true }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'country', label: 'Country', default: 'India' }, { key: 'timezone', label: 'Time zone', default: 'Asia/Kolkata' }]} columns={[{ key: 'name', label: 'Location' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'country', label: 'Country' }, { key: 'count', label: 'People', sortable: false, render: (l) => db.employees.filter((e) => e.locationId === l.id && e.status !== 'Exited').length }]} />
      )}
      {tab === 'designations' && (
        <Crud title="Job titles" collection="designations" searchKeys={['title']} fields={[{ key: 'title', label: 'Job title', required: true, full: true }, { key: 'department', label: 'Department', type: 'select', options: db.departments.map((d) => d.name) }]} columns={[{ key: 'title', label: 'Job title' }, { key: 'department', label: 'Department' }]} />
      )}
      {tab === 'grades' && (
        <Crud title="Bands & grades" collection="grades" fields={[{ key: 'name', label: 'Name', required: true, full: true }, { key: 'minCtc', label: 'Minimum CTC', type: 'number' }, { key: 'maxCtc', label: 'Maximum CTC', type: 'number' }]} columns={[{ key: 'name', label: 'Band' }, { key: 'minCtc', label: 'Min CTC', render: (g) => money(g.minCtc) }, { key: 'maxCtc', label: 'Max CTC', render: (g) => money(g.maxCtc) }]} />
      )}
      {tab === 'units' && <Crud title="Business units" collection="businessUnits" fields={[{ key: 'name', label: 'Name', required: true }, { key: 'head', label: 'Head', ...empOpt }]} columns={[{ key: 'name', label: 'Business unit' }, { key: 'head', label: 'Head', render: (b) => name(b.head) }]} />}
      {tab === 'cost' && <Crud title="Cost centres" collection="costCenters" fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }]} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]} />}
      {tab === 'data' && (
        <Card title="Data & backup">
          <p className="muted" style={{ marginBottom: 12 }}>This version keeps all HR data in this browser. Download a backup regularly, and restore it on another computer to move the data.</p>
          <div className="row">
            <Btn
              icon="download"
              onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([JSON.stringify(getDB(), null, 1)], { type: 'application/json' }));
                a.download = `ifluids-hrms-backup-${todayISO()}.json`;
                a.click();
              }}
            >
              Download backup
            </Btn>
            <label className="btn btn-ghost">
              Restore backup
              <input
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const data = JSON.parse(await f.text());
                    if (!data.employees || !data.company) throw new Error('bad');
                    if (!confirmAction('Replace all current data with this backup?')) return;
                    update((d) => {
                      Object.keys(d).forEach((k) => delete d[k]);
                      Object.assign(d, data);
                    });
                    toast('Backup restored');
                  } catch {
                    toast('That file is not an HRMS backup.', 'error');
                  }
                }}
              />
            </label>
            <Btn kind="danger" onClick={() => confirmAction('Erase all changes and reload the sample data?') && (resetDB(), toast('Sample data restored'))}>Reset to sample data</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
