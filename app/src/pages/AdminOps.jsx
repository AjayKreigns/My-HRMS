import { useState } from 'react';
import { useDB, patchItem, update, uid, notify } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, EmpChip, Stat, Crud, FormGrid, toast, confirmAction, exportCSV, DateRange, BarChart } from '../ui.jsx';
import { ApplyLeave, ATT_REQUEST_FIELDS } from './TimeOff.jsx';
import { TicketDetail } from './Requests.jsx';
import { GOAL_FIELDS } from './Performance.jsx';
import { decide } from './Inbox.jsx';
import {
  empById, fullName, fmtDate, fmtTime, money, monthLabel, todayISO, attendanceFor, minutesBetween, hm, leaveBalances, activeEmployees, arrival, addDays,
} from '../utils.js';

export const empCol = (db, key = 'empId', label = 'Employee') => ({ key, label, sortValue: (r) => fullName(empById(db, r[key])), render: (r) => <EmpChip emp={empById(db, r[key])} />, csv: (r) => fullName(empById(db, r[key])) });

export function ApproveButtons({ db, user, col, row, kind }) {
  if (row.status !== 'Pending' && row.status !== 'Submitted') return null;
  const act = (status) => {
    let comment = '';
    if (status === 'Rejected') {
      comment = window.prompt('Reason for rejecting?') || '';
      if (!comment) return;
    }
    decide(db, { src: { col, kind }, row }, status, comment, user);
    toast(`${kind} ${status.toLowerCase()}`);
  };
  return (
    <span className="row-actions">
      <Btn kind="ghost" small onClick={() => act('Rejected')}>Reject</Btn>
      <Btn kind="success" small onClick={() => act('Approved')}>Approve</Btn>
    </span>
  );
}

// ---------- leave ----------
export function LeaveAdmin({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('requests');
  const [onBehalf, setOnBehalf] = useState(null);
  const [pick, setPick] = useState('');
  const year = new Date().getFullYear();
  const yearEnd = () => {
    if (!confirmAction(`Carry forward unused leave into ${year + 1}? Leave types marked "carry forward" move up to their limit.`)) return;
    update((d) => {
      d.employees.forEach((e) => {
        const bal = leaveBalances(d, e.id, year);
        e.carryForward = {};
        bal.forEach((b) => {
          if (b.type.carryForward === 'Yes') e.carryForward[b.type.id] = Math.min(Math.max(b.available, 0), Number(b.type.maxCarryForward || 0));
        });
      });
    });
    toast('Year-end carry forward done');
  };
  return (
    <div>
      <PageHead title="Leave settings">
        <Btn kind="ghost" onClick={yearEnd}>Run year-end carry forward</Btn>
        <select className="select-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Employee for leave">
          <option value="">Add leave for…</option>
          {activeEmployees(db).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
        </select>
        <Btn disabled={!pick} onClick={() => setOnBehalf(empById(db, pick))}>Add leave</Btn>
      </PageHead>
      <Tabs tabs={[{ key: 'requests', label: 'Leave requests' }, { key: 'balances', label: 'Balances' }, { key: 'types', label: 'Leave types' }, { key: 'holidays', label: 'Holidays' }, { key: 'adjust', label: 'Adjustments' }, { key: 'compoff', label: 'Comp off' }]} active={tab} onChange={setTab} />
      {tab === 'requests' && (
        <Card pad={false}>
          <DataTable
            rows={[...db.leaveRequests].sort((a, b) => b.from.localeCompare(a.from))}
            pageSize={25}
            columns={[
              empCol(db),
              { key: 'typeId', label: 'Type', render: (r) => db.leaveTypes.find((t) => t.id === r.typeId)?.name },
              { key: 'from', label: 'Dates', render: (r) => <DateRange from={r.from} to={r.to} /> },
              { key: 'days', label: 'Days' },
              { key: 'reason', label: 'Reason' },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col="leaveRequests" row={r} kind="Leave" /> },
            ]}
          />
        </Card>
      )}
      {tab === 'balances' && (
        <Card pad={false} actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('leave-balances', [{ label: 'Employee', csv: (e) => fullName(e) }, ...db.leaveTypes.filter((t) => !t.unlimited).map((t) => ({ label: t.code, csv: (e) => leaveBalances(db, e.id).find((b) => b.type.id === t.id)?.available ?? '' }))], activeEmployees(db))}>Export</Btn>} title="Available balances">
          <DataTable
            rows={activeEmployees(db)}
            pageSize={30}
            columns={[
              { key: 'name', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} /> },
              ...db.leaveTypes.filter((t) => !t.unlimited).map((t) => ({ key: t.id, label: t.code, sortable: false, render: (e) => leaveBalances(db, e.id).find((b) => b.type.id === t.id)?.available ?? '—' })),
            ]}
          />
        </Card>
      )}
      {tab === 'types' && (
        <Crud
          title="Leave types"
          collection="leaveTypes"
          canDelete={false}
          defaults={{ accrual: 'Yearly', carryForward: 'No', encashable: 'No', paid: 'Paid', gender: 'All', color: '#5746af', annualQuota: 0, maxCarryForward: 0 }}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'code', label: 'Code', required: true },
            { key: 'annualQuota', label: 'Yearly quota (days)', type: 'number', required: true },
            { key: 'accrual', label: 'Accrual', type: 'select', options: ['Yearly', 'Monthly', 'Quarterly', 'On request', 'None'] },
            { key: 'carryForward', label: 'Carry forward', type: 'select', options: ['No', 'Yes'] },
            { key: 'maxCarryForward', label: 'Max carry forward (days)', type: 'number' },
            { key: 'encashable', label: 'Encashable', type: 'select', options: ['No', 'Yes'] },
            { key: 'paid', label: 'Paid / unpaid', type: 'select', options: ['Paid', 'Unpaid'] },
            { key: 'gender', label: 'Applicable to', type: 'select', options: ['All', 'Female', 'Male'] },
            { key: 'color', label: 'Colour', type: 'color' },
            { key: 'description', label: 'Description', type: 'textarea', full: true },
          ]}
          columns={[
            { key: 'name', label: 'Leave type', render: (t) => <span className="row"><span style={{ width: 10, height: 10, borderRadius: 5, background: t.color }} />{t.name}</span> },
            { key: 'code', label: 'Code' },
            { key: 'annualQuota', label: 'Quota', render: (t) => (t.unlimited ? 'Unlimited' : t.annualQuota) },
            { key: 'accrual', label: 'Accrual' },
            { key: 'carryForward', label: 'Carry fwd' },
            { key: 'encashable', label: 'Encash' },
            { key: 'paid', label: 'Paid' },
            { key: 'gender', label: 'For' },
          ]}
        />
      )}
      {tab === 'holidays' && (
        <Crud
          title="Holidays"
          collection="holidays"
          searchKeys={['name']}
          defaults={{ type: 'Mandatory', location: 'All locations' }}
          fields={[
            { key: 'name', label: 'Holiday', required: true, full: true },
            { key: 'date', label: 'Date', type: 'date', required: true },
            { key: 'type', label: 'Type', type: 'select', options: ['Mandatory', 'Optional'] },
            { key: 'location', label: 'Applies to', type: 'select', options: ['All locations', ...db.locations.map((l) => l.name)] },
          ]}
          columns={[{ key: 'date', label: 'Date', render: (h) => fmtDate(h.date) }, { key: 'name', label: 'Holiday' }, { key: 'type', label: 'Type', render: (h) => <Badge tone={h.type === 'Optional' ? 'grey' : 'blue'}>{h.type}</Badge> }, { key: 'location', label: 'Applies to' }]}
        />
      )}
      {tab === 'adjust' && (
        <Crud
          title="Leave balance adjustments"
          collection="leaveAdjustments"
          fields={[
            { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
            { key: 'typeId', label: 'Leave type', type: 'select', options: db.leaveTypes.map((t) => ({ value: t.id, label: t.name })), required: true },
            { key: 'days', label: 'Days (+ to add, − to deduct)', type: 'number', required: true, step: 0.5 },
            { key: 'reason', label: 'Reason', full: true, required: true },
          ]}
          columns={[empCol(db), { key: 'typeId', label: 'Type', render: (a) => db.leaveTypes.find((t) => t.id === a.typeId)?.name }, { key: 'days', label: 'Days' }, { key: 'reason', label: 'Reason' }]}
        />
      )}
      {tab === 'compoff' && (
        <Card pad={false}>
          <DataTable
            rows={db.compOffRequests}
            columns={[empCol(db), { key: 'workedOn', label: 'Worked on', render: (r) => fmtDate(r.workedOn) }, { key: 'days', label: 'Days' }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col="compOffRequests" row={r} kind="Comp off" /> }]}
          />
        </Card>
      )}
      {onBehalf && <ApplyLeave emp={onBehalf} byAdmin onClose={() => (setOnBehalf(null), setPick(''))} />}
    </div>
  );
}

// ---------- attendance ----------
export function AttendanceAdmin({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('register');
  const [date, setDate] = useState(todayISO());
  const [settings, setSettings] = useState(db.attendanceSettings);
  const [mark, setMark] = useState(null);
  const recs = activeEmployees(db).filter((e) => e.dateOfJoining <= date).map((e) => ({ emp: e, rec: attendanceFor(db, e.id, date) }));
  const count = (s) => recs.filter((r) => r.rec.status === s).length;
  return (
    <div>
      <PageHead title="Attendance settings" />
      <Tabs tabs={[{ key: 'register', label: 'Daily register' }, { key: 'requests', label: 'Requests' }, { key: 'overtime', label: 'Overtime' }, { key: 'shifts', label: 'Shifts' }, { key: 'policy', label: 'Policy' }]} active={tab} onChange={setTab} />
      {tab === 'register' && (
        <div className="stack">
          <div className="row between">
            <div className="row">
              <Btn kind="ghost" small icon="chevronLeft" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))} />
              <input type="date" className="input-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <Btn kind="ghost" small icon="chevronRight" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} />
            </div>
            <Btn kind="ghost" icon="download" onClick={() => exportCSV(`attendance-${date}`, [{ label: 'Employee', csv: (r) => fullName(r.emp) }, { label: 'Status', csv: (r) => r.rec.status }, { label: 'In', csv: (r) => r.rec.clockIn }, { label: 'Out', csv: (r) => r.rec.clockOut }], recs)}>Export</Btn>
          </div>
          <div className="grid g4">
            <Stat label="Present" value={count('Present')} tone="green" />
            <Stat label="Work from home" value={count('WFH')} tone="brand" />
            <Stat label="On leave" value={count('Leave')} tone="amber" />
            <Stat label="Absent / not in" value={count('Absent') + count('Not clocked in')} tone="red" />
          </div>
          <Card pad={false}>
            <DataTable
              rows={recs}
              rowKey={(r) => r.emp.id}
              pageSize={30}
              columns={[
                { key: 'emp', label: 'Employee', sortValue: (r) => fullName(r.emp), render: (r) => <EmpChip emp={r.emp} /> },
                { key: 'status', label: 'Status', sortValue: (r) => r.rec.status, render: (r) => (r.rec.status ? <Badge>{r.rec.status}</Badge> : '—') },
                { key: 'in', label: 'In', sortable: false, render: (r) => fmtTime(r.rec.clockIn) },
                { key: 'out', label: 'Out', sortable: false, render: (r) => fmtTime(r.rec.clockOut) },
                { key: 'hrs', label: 'Hours', sortable: false, render: (r) => (r.rec.clockIn && r.rec.clockOut ? hm(minutesBetween(r.rec.clockIn, r.rec.clockOut)) : '—') },
                { key: 'arr', label: 'Arrival', sortable: false, render: (r) => arrival(r.rec) || r.rec.note || '—' },
                { key: 'act', label: '', sortable: false, render: (r) => <Btn kind="ghost" small onClick={() => setMark({ emp: r.emp, clockIn: r.rec.clockIn || r.rec.shift.start, clockOut: r.rec.clockOut || r.rec.shift.end })}>Edit</Btn> },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'requests' && (
        <Card pad={false}>
          <DataTable
            rows={db.attendanceRequests}
            columns={[empCol(db), { key: 'type', label: 'Type' }, { key: 'date', label: 'Date', render: (r) => <DateRange from={r.date} to={r.to} /> }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col="attendanceRequests" row={r} kind="Attendance" /> }]}
          />
        </Card>
      )}
      {tab === 'overtime' && (
        <Card pad={false}>
          <DataTable
            rows={db.overtime}
            columns={[empCol(db), { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'hours', label: 'Hours' }, { key: 'pay', label: 'Est. OT pay', sortable: false, render: (r) => { const e = empById(db, r.empId); return money(((e?.ctc || 0) / 12 / 30 / 8) * r.hours * db.attendanceSettings.overtimeRate); } }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col="overtime" row={r} kind="Overtime" /> }]}
          />
        </Card>
      )}
      {tab === 'shifts' && (
        <Crud
          title="Shifts"
          collection="shifts"
          defaults={{ grace: 15, breakMinutes: 60, fullDayHours: 8, halfDayHours: 4 }}
          fields={[
            { key: 'name', label: 'Shift name', required: true, full: true },
            { key: 'start', label: 'Starts', type: 'time', required: true },
            { key: 'end', label: 'Ends', type: 'time', required: true },
            { key: 'grace', label: 'Grace (minutes)', type: 'number' },
            { key: 'breakMinutes', label: 'Break (minutes)', type: 'number' },
            { key: 'fullDayHours', label: 'Hours for full day', type: 'number' },
            { key: 'halfDayHours', label: 'Hours for half day', type: 'number' },
          ]}
          columns={[{ key: 'name', label: 'Shift' }, { key: 'start', label: 'Timing', render: (s) => `${fmtTime(s.start)} – ${fmtTime(s.end)}` }, { key: 'grace', label: 'Grace', render: (s) => `${s.grace} min` }, { key: 'breakMinutes', label: 'Break', render: (s) => `${s.breakMinutes} min` }, { key: 'people', label: 'People', sortable: false, render: (s) => db.employees.filter((e) => e.shiftId === s.id && e.status !== 'Exited').length }]}
        />
      )}
      {tab === 'policy' && (
        <Card title="Attendance policy" actions={<Btn onClick={() => (update((d) => (d.attendanceSettings = { ...settings })), toast('Policy saved'))}>Save</Btn>}>
          <FormGrid
            db={db}
            values={settings}
            setValues={setSettings}
            fields={[
              { key: 'allowWebClockIn', label: 'Allow web clock-in', type: 'checkbox' },
              { key: 'allowRemote', label: 'Allow remote clock-in', type: 'checkbox' },
              { key: 'autoClockOutHours', label: 'Auto clock-out after (hours)', type: 'number' },
              { key: 'overtimeAfterHours', label: 'Overtime after (hours/day)', type: 'number' },
              { key: 'overtimeRate', label: 'Overtime pay multiplier', type: 'number', step: 0.25 },
              { key: 'lateMarksForHalfDay', label: 'Late marks that make a half-day deduction', type: 'number' },
            ]}
          />
        </Card>
      )}
      {mark && (
        <FormModal
          title={`Edit attendance — ${fullName(mark.emp)} — ${fmtDate(date)}`}
          fields={[
            { key: 'clockIn', label: 'Clock in', type: 'time' },
            { key: 'clockOut', label: 'Clock out', type: 'time' },
            { key: 'wfh', label: 'Work from home', type: 'checkbox' },
            { key: 'note', label: 'Note', full: true },
          ]}
          initial={mark}
          onClose={() => setMark(null)}
          onSave={(v) => {
            update((d) => {
              const a = d.attendance.find((x) => x.empId === mark.emp.id && x.date === date);
              const data = { clockIn: v.clockIn || '', clockOut: v.clockOut || '', wfh: !!v.wfh, note: v.note || '', source: 'HR edit' };
              if (a) Object.assign(a, data);
              else d.attendance.push({ id: uid('att'), empId: mark.emp.id, date, ...data });
            });
            setMark(null);
            toast('Attendance updated');
          }}
        />
      )}
    </div>
  );
}

// ---------- performance ----------
export function PerformanceAdmin() {
  const db = useDB();
  const [tab, setTab] = useState('cycles');
  const launch = (c) => {
    const people = activeEmployees(db).filter((e) => e.reportingTo && !db.reviews.some((r) => r.cycleId === c.id && r.empId === e.id));
    if (!people.length) return toast('Everyone already has a review in this cycle.');
    update((d) => {
      people.forEach((e) => d.reviews.push({ id: uid('rv'), cycleId: c.id, empId: e.id, reviewerId: e.reportingTo, selfRating: 0, selfComments: '', managerRating: 0, managerComments: '', status: 'Self review pending' }));
      d.reviewCycles.find((x) => x.id === c.id).status = 'In progress';
    });
    people.forEach((e) => notify(e.id, `${c.name} has started. Please complete your self review.`, 'me/performance?reviews'));
    toast(`Review launched for ${people.length} employees`);
  };
  const ratings = db.reviews.filter((r) => r.status === 'Completed');
  return (
    <div>
      <PageHead title="Performance" />
      <Tabs tabs={[{ key: 'cycles', label: 'Review cycles' }, { key: 'reviews', label: 'All reviews' }, { key: 'goals', label: 'All goals' }, { key: 'competencies', label: 'Competencies' }, { key: 'pip', label: 'Improvement plans' }]} active={tab} onChange={setTab} />
      {tab === 'cycles' && (
        <Crud
          title="Review cycles"
          collection="reviewCycles"
          defaults={{ status: 'Draft' }}
          fields={[{ key: 'name', label: 'Cycle name', required: true, full: true }, { key: 'from', label: 'Review period from', type: 'date', required: true }, { key: 'to', label: 'Review period to', type: 'date', required: true }, { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'In progress', 'Closed'] }]}
          columns={[{ key: 'name', label: 'Cycle' }, { key: 'from', label: 'Period', render: (c) => <DateRange from={c.from} to={c.to} /> }, { key: 'count', label: 'Reviews', sortable: false, render: (c) => `${db.reviews.filter((r) => r.cycleId === c.id && r.status === 'Completed').length} / ${db.reviews.filter((r) => r.cycleId === c.id).length} done` }, { key: 'status', label: 'Status', render: (c) => <Badge>{c.status}</Badge> }]}
          rowActions={(c) => c.status !== 'Closed' && <Btn small kind="ghost" onClick={() => launch(c)}>Launch</Btn>}
        />
      )}
      {tab === 'reviews' && (
        <div className="stack">
          <Card title="Rating distribution (completed reviews)">
            <BarChart data={[1, 2, 3, 4, 5].map((n) => ({ label: `${n} star`, value: ratings.filter((r) => r.managerRating === n).length }))} />
          </Card>
          <Card pad={false}>
            <DataTable rows={db.reviews} columns={[empCol(db), { key: 'cycleId', label: 'Cycle', render: (r) => db.reviewCycles.find((c) => c.id === r.cycleId)?.name }, empCol(db, 'reviewerId', 'Reviewer'), { key: 'selfRating', label: 'Self' }, { key: 'managerRating', label: 'Manager' }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }]} />
          </Card>
        </div>
      )}
      {tab === 'goals' && <Crud title="Goals" collection="goals" searchKeys={['title', (r, d) => fullName(empById(d, r.empId))]} fields={[{ key: 'empId', label: 'Employee', type: 'employee', required: true, full: true }, ...GOAL_FIELDS, { key: 'progress', label: 'Progress %', type: 'number' }]} columns={[empCol(db), { key: 'title', label: 'Goal' }, { key: 'progress', label: 'Progress', render: (g) => `${Math.round(g.progress)}%` }, { key: 'dueDate', label: 'Due', render: (g) => fmtDate(g.dueDate) }, { key: 'status', label: 'Status', render: (g) => <Badge>{g.status}</Badge> }]} />}
      {tab === 'competencies' && <Crud title="Competencies" collection="competencies" fields={[{ key: 'name', label: 'Name', required: true }, { key: 'type', label: 'Type', type: 'select', options: ['Behavioural', 'Functional', 'Leadership'] }, { key: 'description', label: 'Description', type: 'textarea', full: true }]} columns={[{ key: 'name', label: 'Competency' }, { key: 'type', label: 'Type' }, { key: 'description', label: 'Description' }]} />}
      {tab === 'pip' && (
        <Crud
          title="Improvement plans"
          collection="pips"
          defaults={{ status: 'Active' }}
          fields={[{ key: 'empId', label: 'Employee', type: 'employee', required: true, full: true }, { key: 'startDate', label: 'Start', type: 'date', required: true }, { key: 'endDate', label: 'End', type: 'date', required: true }, { key: 'reason', label: 'Reason', type: 'textarea', full: true, required: true }, { key: 'goals', label: 'Expected improvements', type: 'textarea', full: true, required: true }, { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Extended', 'Successful', 'Unsuccessful'] }]}
          columns={[empCol(db), { key: 'startDate', label: 'Period', render: (p) => <DateRange from={p.startDate} to={p.endDate} /> }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
        />
      )}
    </div>
  );
}

// ---------- expenses ----------
export function ExpensesAdmin({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('claims');
  const [cat, setCat] = useState('');
  const payAll = () => {
    const n = db.expenses.filter((e) => e.status === 'Approved').length;
    if (!n) return toast('No approved expenses to pay.');
    update((d) => d.expenses.forEach((e) => e.status === 'Approved' && (e.status = 'Paid')));
    toast(`${n} expense(s) marked as reimbursed`);
  };
  return (
    <div>
      <PageHead title="Expenses & claims">
        <Btn kind="success" onClick={payAll}>Reimburse all approved</Btn>
      </PageHead>
      <Tabs tabs={[{ key: 'claims', label: 'Expense claims' }, { key: 'advances', label: 'Advances' }, { key: 'travel', label: 'Travel' }, { key: 'components', label: 'Reimbursement claims' }, { key: 'categories', label: 'Categories' }]} active={tab} onChange={setTab} />
      {tab === 'claims' && (
        <Card pad={false} actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('expenses', [{ label: 'Employee', csv: (e) => fullName(empById(db, e.empId)) }, { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' }, { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' }], db.expenses)}>Export</Btn>} title="All expenses">
          <DataTable rows={db.expenses} pageSize={25} columns={[empCol(db), { key: 'title', label: 'Expense' }, { key: 'category', label: 'Category' }, { key: 'date', label: 'Date', render: (e) => fmtDate(e.date) }, { key: 'amount', label: 'Amount', render: (e) => money(e.amount, e.currency) }, { key: 'status', label: 'Status', render: (e) => <Badge>{e.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (e) => (e.status === 'Approved' ? <Btn small kind="ghost" onClick={() => patchItem('expenses', e.id, { status: 'Paid' })}>Mark paid</Btn> : <ApproveButtons db={db} user={user} col="expenses" row={e} kind="Expense" />) }]} />
        </Card>
      )}
      {tab === 'advances' && (
        <Card pad={false}>
          <DataTable rows={db.advances} columns={[empCol(db), { key: 'purpose', label: 'Purpose' }, { key: 'amount', label: 'Amount', render: (a) => money(a.amount) }, { key: 'requiredBy', label: 'Needed by', render: (a) => fmtDate(a.requiredBy) }, { key: 'status', label: 'Status', render: (a) => <Badge>{a.status}</Badge> }, { key: 'settled', label: 'Settled' }, { key: 'act', label: '', sortable: false, render: (a) => (a.status === 'Approved' && a.settled !== 'Yes' ? <Btn small kind="ghost" onClick={() => patchItem('advances', a.id, { settled: 'Yes' })}>Mark settled</Btn> : <ApproveButtons db={db} user={user} col="advances" row={a} kind="Advance" />) }]} />
        </Card>
      )}
      {tab === 'travel' && (
        <Card pad={false}>
          <DataTable rows={db.travel} columns={[empCol(db), { key: 'purpose', label: 'Purpose' }, { key: 'route', label: 'Route', sortable: false, render: (t) => `${t.fromCity} → ${t.toCity}` }, { key: 'departDate', label: 'Dates', render: (t) => <DateRange from={t.departDate} to={t.returnDate} /> }, { key: 'estimatedCost', label: 'Est. cost', render: (t) => money(t.estimatedCost) }, { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (t) => <ApproveButtons db={db} user={user} col="travel" row={t} kind="Travel" /> }]} />
        </Card>
      )}
      {tab === 'components' && (
        <Card pad={false}>
          <DataTable rows={db.claims} columns={[empCol(db), { key: 'component', label: 'Component' }, { key: 'month', label: 'Month', render: (c) => monthLabel(c.month) }, { key: 'amount', label: 'Amount', render: (c) => money(c.amount) }, { key: 'status', label: 'Status', render: (c) => <Badge>{c.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (c) => <ApproveButtons db={db} user={user} col="claims" row={c} kind="Claim" /> }]} />
        </Card>
      )}
      {tab === 'categories' && (
        <Card title="Expense categories">
          <ul className="list">
            {db.expenseCategories.map((c) => (
              <li key={c}>
                <span>{c}</span>
                <Btn kind="icon" icon="trash" aria-label={`Remove ${c}`} onClick={() => confirmAction(`Remove ${c}?`) && update((d) => (d.expenseCategories = d.expenseCategories.filter((x) => x !== c)))} />
              </li>
            ))}
          </ul>
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => (e.preventDefault(), cat.trim() && (update((d) => d.expenseCategories.push(cat.trim())), setCat('')))}>
            <input className="input-sm" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="New category" aria-label="New category" />
            <button className="btn btn-primary btn-sm" type="submit">Add</button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ---------- projects ----------
export function ProjectsAdmin({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('projects');
  const hours = (pid) => db.timesheets.filter((t) => t.status !== 'Draft').reduce((s, t) => s + t.rows.filter((r) => r.projectId === pid).reduce((a, r) => a + r.hours.reduce((x, y) => x + Number(y || 0), 0), 0), 0);
  return (
    <div>
      <PageHead title="Projects & clients" />
      <Tabs tabs={[{ key: 'projects', label: 'Projects' }, { key: 'clients', label: 'Clients' }, { key: 'timesheets', label: 'Timesheets' }]} active={tab} onChange={setTab} />
      {tab === 'projects' && (
        <Crud
          title="Projects"
          collection="projects"
          searchKeys={['name', 'code']}
          defaults={{ status: 'Active', billing: 'Fixed price', members: [] }}
          fields={[
            { key: 'name', label: 'Project name', required: true, full: true },
            { key: 'code', label: 'Project code', required: true },
            { key: 'clientId', label: 'Client', type: 'select', options: db.clients.map((c) => ({ value: c.id, label: c.name })) },
            { key: 'manager', label: 'Project manager', type: 'employee', required: true },
            { key: 'billing', label: 'Billing', type: 'select', options: ['Fixed price', 'Time & material', 'Internal', 'Non-billable'] },
            { key: 'startDate', label: 'Start date', type: 'date' },
            { key: 'endDate', label: 'End date', type: 'date' },
            { key: 'budgetHours', label: 'Budget hours', type: 'number' },
            { key: 'status', label: 'Status', type: 'select', options: ['Active', 'On hold', 'Completed', 'Cancelled'] },
            { key: 'members', label: 'Team members', type: 'multiemployee', full: true },
          ]}
          columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Project' }, { key: 'clientId', label: 'Client', render: (p) => db.clients.find((c) => c.id === p.clientId)?.name || 'Internal' }, empCol(db, 'manager', 'Manager'), { key: 'hours', label: 'Hours logged', sortable: false, render: (p) => `${hours(p.id)}${p.budgetHours ? ` / ${p.budgetHours}` : ''}` }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
        />
      )}
      {tab === 'clients' && <Crud title="Clients" collection="clients" searchKeys={['name']} fields={[{ key: 'name', label: 'Client name', required: true, full: true }, { key: 'industry', label: 'Industry' }, { key: 'country', label: 'Country' }, { key: 'contactPerson', label: 'Contact person' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'tel' }]} columns={[{ key: 'name', label: 'Client' }, { key: 'industry', label: 'Industry' }, { key: 'contactPerson', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'projects', label: 'Projects', sortable: false, render: (c) => db.projects.filter((p) => p.clientId === c.id).length }]} />}
      {tab === 'timesheets' && (
        <Card pad={false}>
          <DataTable rows={db.timesheets} empty="No timesheets submitted yet." columns={[empCol(db), { key: 'weekStart', label: 'Week of', render: (t) => fmtDate(t.weekStart) }, { key: 'hours', label: 'Hours', sortable: false, render: (t) => t.rows.reduce((s, r) => s + r.hours.reduce((a, b) => a + Number(b || 0), 0), 0) }, { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> }, { key: 'act', label: '', sortable: false, render: (t) => <ApproveButtons db={db} user={user} col="timesheets" row={t} kind="Timesheet" /> }]} />
        </Card>
      )}
    </div>
  );
}

// ---------- assets ----------
export function AssetsAdmin() {
  const db = useDB();
  const [assign, setAssign] = useState(null);
  const free = db.assets.filter((a) => !a.assignedTo).length;
  return (
    <div>
      <PageHead title="Assets" sub={`${db.assets.length} assets · ${free} available`} />
      <Crud
        title="Asset inventory"
        collection="assets"
        searchKeys={['name', 'serialNo', 'type', (r, d) => fullName(empById(d, r.assignedTo))]}
        exportName="assets"
        defaults={{ condition: 'New', purchaseDate: todayISO() }}
        fields={[
          { key: 'type', label: 'Asset type', type: 'select', options: db.assetTypes, required: true },
          { key: 'name', label: 'Make / model', required: true },
          { key: 'serialNo', label: 'Serial / tag number', required: true },
          { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
          { key: 'cost', label: 'Cost (INR)', type: 'number' },
          { key: 'warrantyTill', label: 'Warranty till', type: 'date' },
          { key: 'condition', label: 'Condition', type: 'select', options: ['New', 'Good', 'Fair', 'Needs repair', 'Needs calibration', 'Retired'] },
          { key: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]}
        columns={[
          { key: 'type', label: 'Type' },
          { key: 'name', label: 'Asset' },
          { key: 'serialNo', label: 'Serial no.' },
          { key: 'assignedTo', label: 'Assigned to', sortValue: (a) => fullName(empById(db, a.assignedTo)), render: (a) => (a.assignedTo ? <EmpChip emp={empById(db, a.assignedTo)} /> : <Badge tone="green">Available</Badge>), csv: (a) => fullName(empById(db, a.assignedTo)) },
          { key: 'condition', label: 'Condition' },
          { key: 'cost', label: 'Cost', render: (a) => money(a.cost) },
        ]}
        rowActions={(a) =>
          a.assignedTo ? (
            <Btn small kind="ghost" onClick={() => (patchItem('assets', a.id, { assignedTo: '', assignedOn: '', history: [...(a.history || []), { empId: a.assignedTo, from: a.assignedOn, to: todayISO() }] }), toast('Asset returned'))}>Return</Btn>
          ) : (
            <Btn small kind="ghost" onClick={() => setAssign(a)}>Assign</Btn>
          )
        }
      />
      {assign && (
        <FormModal
          title={`Assign ${assign.name}`}
          fields={[{ key: 'assignedTo', label: 'Employee', type: 'employee', required: true, full: true }, { key: 'assignedOn', label: 'Assigned on', type: 'date', required: true }]}
          initial={{ assignedOn: todayISO() }}
          onClose={() => setAssign(null)}
          onSave={(v) => {
            patchItem('assets', assign.id, v);
            notify(v.assignedTo, `${assign.type} “${assign.name}” (${assign.serialNo}) has been assigned to you.`);
            setAssign(null);
            toast('Asset assigned');
          }}
        />
      )}
    </div>
  );
}

// ---------- helpdesk ----------
export function HelpdeskAdmin({ user }) {
  const db = useDB();
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState(null);
  const rows = db.tickets.filter((t) => (status === 'all' ? true : status === 'open' ? !['Resolved', 'Closed'].includes(t.status) : status === 'mine' ? t.assignee === user.id : ['Resolved', 'Closed'].includes(t.status)));
  return (
    <div>
      <PageHead title="Helpdesk tickets" />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Open" value={db.tickets.filter((t) => t.status === 'Open').length} tone="amber" />
        <Stat label="In progress" value={db.tickets.filter((t) => t.status === 'In progress').length} tone="brand" />
        <Stat label="Resolved" value={db.tickets.filter((t) => t.status === 'Resolved').length} tone="green" />
        <Stat label="Assigned to me" value={db.tickets.filter((t) => t.assignee === user.id && !['Resolved', 'Closed'].includes(t.status)).length} />
      </div>
      <Tabs tabs={[{ key: 'open', label: 'Open' }, { key: 'mine', label: 'Assigned to me' }, { key: 'done', label: 'Resolved & closed' }, { key: 'all', label: 'All' }]} active={status} onChange={setStatus} />
      <Card pad={false}>
        <DataTable rows={rows} onRowClick={setOpen} empty="No tickets." columns={[{ key: 'id', label: 'Ticket', render: (t) => `#${t.id.slice(-5).toUpperCase()}` }, { key: 'subject', label: 'Subject' }, empCol(db, 'empId', 'Raised by'), { key: 'category', label: 'Category' }, { key: 'priority', label: 'Priority', render: (t) => <Badge>{t.priority}</Badge> }, { key: 'assignee', label: 'Assignee', render: (t) => fullName(empById(db, t.assignee)) }, { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> }]} />
      </Card>
      {open && <TicketDetail ticket={open} user={user} admin onClose={() => setOpen(null)} />}
    </div>
  );
}
