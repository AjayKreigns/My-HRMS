import { useState } from 'react';
import { useDB } from '../store.js';
import { Card, Badge, Tabs, DataTable, PageHead, EmpChip, Stat, Progress, DateRange } from '../ui.jsx';
import { go } from '../App.jsx';
import { attendanceFor, todayISO, fmtTime, hm, minutesBetween, leaveBalances, fmtDate, money, ymOf, addDays } from '../utils.js';
import { monthRecords, attendanceStats } from './TimeOff.jsx';

export function teamOf(db, user, all = false) {
  if (all) return db.employees.filter((e) => e.status !== 'Exited' && e.id !== user.id);
  const out = [];
  const walk = (id) =>
    db.employees.filter((e) => e.reportingTo === id && e.status !== 'Exited').forEach((e) => {
      out.push(e);
      walk(e.id);
    });
  walk(user.id);
  return out;
}

export default function Team({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('summary');
  const [scope, setScope] = useState('direct');
  const today = todayISO();
  const team = scope === 'all' ? teamOf(db, user, true) : scope === 'reports' ? teamOf(db, user) : db.employees.filter((e) => e.reportingTo === user.id && e.status !== 'Exited');
  const ids = new Set(team.map((e) => e.id));
  const todayRecs = team.map((e) => ({ emp: e, rec: attendanceFor(db, e.id, today) }));
  const count = (s) => todayRecs.filter((x) => x.rec.status === s).length;
  const ym = ymOf();
  const upcoming = db.leaveRequests.filter((r) => ids.has(r.empId) && ['Approved', 'Pending'].includes(r.status) && r.to >= today && r.from <= addDays(today, 30));

  return (
    <div>
      <PageHead title="My Team" sub={`${team.length} people`}>
        <select className="select-sm" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Team scope">
          <option value="direct">Direct reports</option>
          <option value="reports">All reports (direct + indirect)</option>
          {user.role === 'admin' && <option value="all">Whole organisation</option>}
        </select>
      </PageHead>
      <Tabs tabs={[{ key: 'summary', label: 'Summary' }, { key: 'attendance', label: 'Attendance' }, { key: 'leave', label: 'Leave' }, { key: 'performance', label: 'Performance' }, { key: 'expenses', label: 'Expenses' }]} active={tab} onChange={setTab} />
      {tab === 'summary' && (
        <div className="stack">
          <div className="grid g4">
            <Stat label="In today" value={count('Present') + count('WFH')} tone="green" sub={`${count('WFH')} working remotely`} />
            <Stat label="On leave" value={count('Leave')} tone="amber" />
            <Stat label="Not clocked in yet" value={count('Not clocked in')} />
            <Stat label="Late arrivals today" value={todayRecs.filter((x) => x.rec.clockIn && x.rec.clockIn > (x.rec.shift?.start || '09:30')).length} tone="red" />
          </div>
          <Card pad={false} title="Today">
            <DataTable
              rows={todayRecs}
              rowKey={(r) => r.emp.id}
              onRowClick={(r) => go(`profile/${r.emp.id}`)}
              columns={[
                { key: 'emp', label: 'Employee', sortValue: (r) => r.emp.firstName, render: (r) => <EmpChip emp={r.emp} /> },
                { key: 'status', label: 'Status', sortValue: (r) => r.rec.status, render: (r) => <Badge>{r.rec.status || 'Not clocked in'}</Badge> },
                { key: 'in', label: 'Clock in', sortable: false, render: (r) => fmtTime(r.rec.clockIn) },
                { key: 'shift', label: 'Shift', sortable: false, render: (r) => r.rec.shift?.name },
                { key: 'note', label: 'Note', sortable: false, render: (r) => r.rec.note || '—' },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'attendance' && (
        <Card pad={false} title={`This month (${ym})`}>
          <DataTable
            rows={team.map((e) => ({ emp: e, st: attendanceStats(monthRecords(db, e.id, ym).filter((r) => r.date <= today)) }))}
            rowKey={(r) => r.emp.id}
            columns={[
              { key: 'emp', label: 'Employee', sortValue: (r) => r.emp.firstName, render: (r) => <EmpChip emp={r.emp} /> },
              { key: 'avg', label: 'Avg. hours', sortValue: (r) => r.st.avg, render: (r) => hm(r.st.avg) },
              { key: 'ontime', label: 'On time', sortValue: (r) => r.st.onTimePct, render: (r) => `${r.st.onTimePct}%` },
              { key: 'present', label: 'Present', sortValue: (r) => r.st.present, render: (r) => r.st.present },
              { key: 'wfh', label: 'WFH', sortValue: (r) => r.st.wfh, render: (r) => r.st.wfh },
              { key: 'leave', label: 'Leave', sortValue: (r) => r.st.leave, render: (r) => r.st.leave },
              { key: 'absent', label: 'Absent', sortValue: (r) => r.st.absent, render: (r) => r.st.absent },
            ]}
          />
        </Card>
      )}
      {tab === 'leave' && (
        <div className="stack">
          <Card pad={false} title="Who's away (next 30 days)">
            <DataTable
              rows={upcoming}
              empty="No one is away."
              columns={[
                { key: 'empId', label: 'Employee', render: (r) => <EmpChip emp={db.employees.find((e) => e.id === r.empId)} /> },
                { key: 'typeId', label: 'Type', render: (r) => db.leaveTypes.find((t) => t.id === r.typeId)?.name },
                { key: 'from', label: 'Dates', render: (r) => <DateRange from={r.from} to={r.to} /> },
                { key: 'days', label: 'Days' },
                { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              ]}
            />
          </Card>
          <Card pad={false} title="Leave balances">
            <DataTable
              rows={team}
              columns={[
                { key: 'emp', label: 'Employee', sortValue: (e) => e.firstName, render: (e) => <EmpChip emp={e} /> },
                ...db.leaveTypes.filter((t) => ['CL', 'SL', 'EL'].includes(t.code)).map((t) => ({ key: t.id, label: t.code, sortable: false, render: (e) => leaveBalances(db, e.id).find((b) => b.type.id === t.id)?.available ?? '—' })),
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'performance' && (
        <Card pad={false}>
          <DataTable
            rows={team}
            columns={[
              { key: 'emp', label: 'Employee', sortValue: (e) => e.firstName, render: (e) => <EmpChip emp={e} /> },
              { key: 'goals', label: 'Goals', sortable: false, render: (e) => db.goals.filter((g) => g.empId === e.id).length },
              {
                key: 'progress',
                label: 'Avg. progress',
                sortable: false,
                render: (e) => {
                  const g = db.goals.filter((x) => x.empId === e.id);
                  const v = g.length ? g.reduce((s, x) => s + Number(x.progress), 0) / g.length : 0;
                  return <div style={{ minWidth: 120 }}><Progress value={v} /><small className="muted">{Math.round(v)}%</small></div>;
                },
              },
              { key: 'review', label: 'Latest review', sortable: false, render: (e) => { const r = db.reviews.find((x) => x.empId === e.id); return r ? <Badge>{r.status}</Badge> : '—'; } },
              { key: 'fb', label: 'Feedback', sortable: false, render: (e) => db.feedback.filter((f) => f.toId === e.id).length },
            ]}
          />
        </Card>
      )}
      {tab === 'expenses' && (
        <Card pad={false}>
          <DataTable
            rows={db.expenses.filter((x) => ids.has(x.empId))}
            columns={[
              { key: 'empId', label: 'Employee', render: (x) => <EmpChip emp={db.employees.find((e) => e.id === x.empId)} /> },
              { key: 'title', label: 'Expense' },
              { key: 'date', label: 'Date', render: (x) => fmtDate(x.date) },
              { key: 'amount', label: 'Amount', render: (x) => money(x.amount) },
              { key: 'status', label: 'Status', render: (x) => <Badge>{x.status}</Badge> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
