import { useState } from 'react';
import { useDB, update, notify, uid } from '../store.js';
import { Card, Btn, Badge, Tabs, EmpChip, Empty, PageHead, Modal, toast, DateRange } from '../ui.jsx';
import { empById, fmtDate, fmtTime, money, todayISO } from '../utils.js';

const SOURCES = [
  { col: 'leaveRequests', kind: 'Leave', title: (r, db) => `${db.leaveTypes.find((t) => t.id === r.typeId)?.name || 'Leave'} · ${r.days} day(s)`, detail: (r) => <><DateRange from={r.from} to={r.to} /> — {r.reason}</> },
  { col: 'attendanceRequests', kind: 'Attendance', title: (r) => r.type, detail: (r) => <><DateRange from={r.date} to={r.to} />{r.clockIn ? ` · ${fmtTime(r.clockIn)} – ${fmtTime(r.clockOut)}` : ''} — {r.reason}</> },
  { col: 'overtime', kind: 'Overtime', title: (r) => `Overtime · ${r.hours}h`, detail: (r) => `${fmtDate(r.date)} — ${r.reason}` },
  { col: 'compOffRequests', kind: 'Comp off', title: (r) => `Comp off · ${r.days} day(s)`, detail: (r) => `Worked on ${fmtDate(r.workedOn)} — ${r.reason}` },
  { col: 'expenses', kind: 'Expense', title: (r) => `${r.title} · ${money(r.amount)}`, detail: (r) => `${r.category} · ${fmtDate(r.date)}${r.receipt ? ` · receipt: ${r.receipt}` : ''}` },
  { col: 'advances', kind: 'Advance', title: (r) => `Expense advance · ${money(r.amount)}`, detail: (r) => `${r.purpose} · needed by ${fmtDate(r.requiredBy)}` },
  { col: 'travel', kind: 'Travel', title: (r) => `Travel · ${r.fromCity} → ${r.toCity}`, detail: (r) => <><DateRange from={r.departDate} to={r.returnDate} /> · {r.mode} · est. {money(r.estimatedCost)} — {r.purpose}</> },
  { col: 'loans', kind: 'Loan', title: (r) => `${r.type} · ${money(r.amount)}`, detail: (r) => `${r.tenureMonths} months — ${r.reason}` },
  { col: 'claims', kind: 'Claim', title: (r) => `${r.component} · ${money(r.amount)}`, detail: (r) => `For ${r.month}${r.billName ? ` · ${r.billName}` : ''}` },
  { col: 'timesheets', kind: 'Timesheet', status: 'Submitted', title: (r) => `Timesheet · week of ${fmtDate(r.weekStart)}`, detail: (r) => `${r.rows.reduce((s, x) => s + x.hours.reduce((a, b) => a + Number(b || 0), 0), 0)} hours logged` },
  { col: 'promotions', kind: 'Promotion', title: (r) => `Promotion to ${r.newDesignation}`, detail: (r) => `New CTC ${money(r.newCtc)} from ${fmtDate(r.effectiveFrom)}` },
];

function canAct(db, user, empId) {
  if (empId === user.id) return false;
  const emp = empById(db, empId);
  return user.role === 'admin' || emp?.reportingTo === user.id;
}

export function pendingFor(db, user) {
  const out = [];
  SOURCES.forEach((s) => {
    (db[s.col] || []).forEach((r) => {
      if (r.status === (s.status || 'Pending') && canAct(db, user, r.empId)) out.push({ key: `${s.col}:${r.id}`, src: s, row: r, empId: r.empId, title: s.title(r, db), date: r.appliedOn || r.createdAt || r.date || r.from });
    });
  });
  (db.reviews || []).forEach((r) => {
    if (r.reviewerId === user.id && r.status === 'Manager review pending') out.push({ key: `reviews:${r.id}`, src: { kind: 'Review', col: 'reviews' }, row: r, empId: r.empId, title: 'Performance review waiting for your rating', link: true });
  });
  return out;
}

export function decide(db, item, status, comment, user) {
  const { src, row } = item;
  update((d) => {
    const r = d[src.col].find((x) => x.id === row.id);
    r.status = status === 'Approved' && src.col === 'loans' ? 'Active' : status;
    r.approverComment = comment;
    r.actedBy = user.id;
    r.actedOn = todayISO();
    if (status === 'Approved' && src.col === 'compOffRequests') {
      const co = d.leaveTypes.find((t) => t.code === 'CO');
      if (co) d.leaveAdjustments.push({ id: uid('adj'), empId: r.empId, typeId: co.id, days: Number(r.days), reason: `Comp off for ${r.workedOn}` });
    }
    if (status === 'Approved' && src.col === 'attendanceRequests' && r.type === 'Regularization') {
      const a = d.attendance.find((x) => x.empId === r.empId && x.date === r.date);
      if (a) Object.assign(a, { clockIn: r.clockIn, clockOut: r.clockOut, regularized: true });
      else d.attendance.push({ id: uid('att'), empId: r.empId, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, source: 'Regularized' });
    }
    if (status === 'Approved' && src.col === 'promotions') {
      const e = d.employees.find((x) => x.id === r.empId);
      Object.assign(e, { designation: r.newDesignation, ctc: Number(r.newCtc), gradeId: r.newGradeId || e.gradeId });
    }
  });
  notify(row.empId, `Your ${src.kind.toLowerCase()} request was ${status.toLowerCase()}${comment ? `: “${comment}”` : '.'}`);
}

export default function Inbox({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('pending');
  const [acting, setActing] = useState(null);
  const [comment, setComment] = useState('');
  const pending = pendingFor(db, user);
  const archive = [];
  SOURCES.forEach((s) => (db[s.col] || []).forEach((r) => r.actedBy === user.id && archive.push({ key: `${s.col}:${r.id}`, src: s, row: r, empId: r.empId, title: s.title(r, db) })));
  const mine = [];
  SOURCES.forEach((s) => (db[s.col] || []).forEach((r) => r.empId === user.id && mine.push({ key: `${s.col}:${r.id}`, src: s, row: r, empId: r.empId, title: s.title(r, db) })));
  const list = tab === 'pending' ? pending : tab === 'archive' ? archive : mine;

  const act = (status) => {
    if (status === 'Rejected' && !comment.trim()) return toast('Add a note explaining the rejection.', 'error');
    decide(db, acting.item, status, comment.trim(), user);
    toast(`${acting.item.src.kind} ${status.toLowerCase()}`);
    setActing(null);
    setComment('');
  };

  return (
    <div>
      <PageHead title="Inbox" sub="Requests waiting for your action and the status of your own requests." />
      <Tabs tabs={[{ key: 'pending', label: `Take action (${pending.length})` }, { key: 'mine', label: 'My requests' }, { key: 'archive', label: 'Archive' }]} active={tab} onChange={setTab} />
      <Card pad={false}>
        {list.length === 0 ? (
          <Empty text={tab === 'pending' ? "You're all caught up." : 'Nothing to show.'} icon="inbox" />
        ) : (
          <ul className="list" style={{ padding: '0 16px' }}>
            {list.map((it) => (
              <li key={it.key} style={{ flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 14, minWidth: 0, flex: 1 }}>
                  <EmpChip emp={empById(db, it.empId)} />
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <Badge tone="purple">{it.src.kind}</Badge> <strong>{it.title}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {it.src.detail ? it.src.detail(it.row) : ''}
                    </div>
                  </div>
                </div>
                {tab === 'pending' ? (
                  it.link ? (
                    <a className="btn btn-ghost btn-sm" href="#/me/performance?reviews">Open review</a>
                  ) : (
                    <div className="row">
                      <Btn kind="ghost" small onClick={() => setActing({ item: it })}>Reject</Btn>
                      <Btn small kind="success" icon="check" onClick={() => setActing({ item: it, quick: true })}>Approve</Btn>
                    </div>
                  )
                ) : (
                  <Badge>{it.row.status}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {acting && (
        <Modal
          title={`${acting.item.src.kind}: ${acting.item.title}`}
          onClose={() => setActing(null)}
          footer={
            <>
              <Btn kind="danger" onClick={() => act('Rejected')}>Reject</Btn>
              <Btn kind="success" icon="check" onClick={() => act('Approved')}>Approve</Btn>
            </>
          }
        >
          <EmpChip emp={empById(db, acting.item.empId)} />
          <p style={{ margin: '12px 0' }}>{acting.item.src.detail ? acting.item.src.detail(acting.item.row) : ''}</p>
          <div className="field">
            <label htmlFor="comment">Note to the employee {acting.quick ? '(optional)' : '(needed to reject)'}</label>
            <textarea id="comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
