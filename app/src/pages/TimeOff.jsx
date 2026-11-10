import { useEffect, useState } from 'react';
import { useDB, addItem, patchItem, notify } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, Stat, KV, toast, DateRange, confirmAction, exportCSV } from '../ui.jsx';
import { useClock } from '../App.jsx';
import {
  todayISO, ymOf, addMonths, monthLabel, daysInMonth, pad, attendanceFor, arrival, minutesBetween, hm, fmtTime, fmtDate, parseISO, DAYS,
  leaveBalances, countLeaveDays, empById, fullName, addDays,
} from '../utils.js';

export function MonthPicker({ ym, setYm }) {
  return (
    <div className="row">
      <Btn kind="ghost" small icon="chevronLeft" aria-label="Previous month" onClick={() => setYm(addMonths(ym, -1))} />
      <strong style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(ym)}</strong>
      <Btn kind="ghost" small icon="chevronRight" aria-label="Next month" onClick={() => setYm(addMonths(ym, 1))} />
    </div>
  );
}

export function monthRecords(db, empId, ym) {
  const n = daysInMonth(ym);
  const out = [];
  for (let d = 1; d <= n; d++) out.push(attendanceFor(db, empId, `${ym}-${pad(d)}`));
  return out;
}

export function attendanceStats(recs) {
  const worked = recs.filter((r) => r.clockIn && r.clockOut);
  const mins = worked.map((r) => minutesBetween(r.clockIn, r.clockOut));
  const onTime = worked.filter((r) => arrival(r) === 'On time').length;
  return {
    avg: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0,
    onTimePct: worked.length ? Math.round((onTime / worked.length) * 100) : 0,
    present: recs.filter((r) => r.status === 'Present' || r.status === 'WFH').length,
    leave: recs.filter((r) => r.status === 'Leave').length,
    absent: recs.filter((r) => r.status === 'Absent').length,
    wfh: recs.filter((r) => r.status === 'WFH').length,
  };
}

export const ATT_REQUEST_FIELDS = [
  { key: 'type', label: 'Request type', type: 'select', required: true, options: ['Regularization', 'Work From Home', 'On Duty', 'Partial Day', 'Remote Clock In'], full: true },
  { key: 'date', label: 'Date (from)', type: 'date', required: true },
  { key: 'to', label: 'To date', type: 'date', show: (v) => ['Work From Home', 'On Duty'].includes(v.type) },
  { key: 'clockIn', label: 'Clock-in time', type: 'time', show: (v) => ['Regularization', 'Partial Day', 'Remote Clock In'].includes(v.type) },
  { key: 'clockOut', label: 'Clock-out time', type: 'time', show: (v) => ['Regularization', 'Partial Day'].includes(v.type) },
  { key: 'location', label: 'Location / client site', type: 'text', show: (v) => ['On Duty', 'Remote Clock In'].includes(v.type) },
  { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
];

export function Attendance({ user }) {
  const db = useDB();
  const clock = useClock(user);
  const [ym, setYm] = useState(ymOf());
  const [tab, setTab] = useState('log');
  const [req, setReq] = useState(null);
  const [ot, setOt] = useState(false);
  const recs = monthRecords(db, user.id, ym);
  const st = attendanceStats(recs);
  const shift = db.shifts.find((s) => s.id === user.shiftId) || db.shifts[0];
  const myReqs = db.attendanceRequests.filter((r) => r.empId === user.id);
  const myOt = db.overtime.filter((r) => r.empId === user.id);
  const today = todayISO();
  const first = parseISO(`${ym}-01`).getDay();

  const submitReq = (v) => {
    addItem('attendanceRequests', { ...v, empId: user.id, status: 'Pending', createdAt: today });
    if (user.reportingTo) notify(user.reportingTo, `${fullName(user)} raised a ${v.type} request for ${fmtDate(v.date)}.`, 'inbox');
    setReq(null);
    toast('Request submitted for approval');
  };

  const logCols = [
    { key: 'date', label: 'Date', render: (r) => `${fmtDate(r.date)} · ${DAYS[parseISO(r.date).getDay()]}` },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Badge>{r.status}</Badge> : '—') },
    { key: 'clockIn', label: 'In', render: (r) => fmtTime(r.clockIn) },
    { key: 'clockOut', label: 'Out', render: (r) => (r.clockIn && !r.clockOut ? <Badge tone="blue">Working</Badge> : fmtTime(r.clockOut)) },
    { key: 'eff', label: 'Effective hours', sortValue: (r) => minutesBetween(r.clockIn, r.clockOut), render: (r) => (r.clockIn && r.clockOut ? hm(minutesBetween(r.clockIn, r.clockOut) - (minutesBetween(r.clockIn, r.clockOut) > 300 ? Number(r.shift.breakMinutes || 0) : 0)) : '—') },
    { key: 'gross', label: 'Gross hours', sortable: false, render: (r) => (r.clockIn && r.clockOut ? hm(minutesBetween(r.clockIn, r.clockOut)) : '—') },
    { key: 'arrival', label: 'Arrival', sortable: false, render: (r) => arrival(r) || r.note || '—' },
    {
      key: 'act',
      label: '',
      sortable: false,
      render: (r) =>
        r.date <= today && !['Weekly off', 'Holiday'].includes(r.status) ? (
          <Btn kind="ghost" small onClick={() => setReq({ type: 'Regularization', date: r.date, clockIn: r.clockIn || shift.start, clockOut: r.clockOut || shift.end })}>
            Regularize
          </Btn>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHead title="Attendance" sub={`${shift.name} · ${fmtTime(shift.start)} – ${fmtTime(shift.end)} · Weekly off: ${user.weeklyOff}`}>
        <Btn kind="ghost" onClick={() => setReq({ type: 'Work From Home', date: today, to: today })}>Work from home</Btn>
        <Btn kind="ghost" onClick={() => setReq({ type: 'On Duty', date: today, to: today })}>On duty</Btn>
        <Btn kind="ghost" onClick={() => setOt(true)}>Overtime</Btn>
        <Btn icon="clock" onClick={() => clock.toggle()}>{clock.clockedIn ? `Clock out (${clock.label})` : 'Web clock in'}</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Avg. hours / day" value={hm(st.avg)} tone="brand" />
        <Stat label="On-time arrival" value={`${st.onTimePct}%`} tone="green" />
        <Stat label="Days present" value={st.present} sub={`${st.wfh} work from home`} />
        <Stat label="Leave / absent" value={`${st.leave} / ${st.absent}`} tone={st.absent ? 'red' : undefined} />
      </div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <Tabs tabs={[{ key: 'log', label: 'Attendance log' }, { key: 'cal', label: 'Calendar' }, { key: 'req', label: `Requests (${myReqs.length})` }, { key: 'ot', label: 'Overtime' }, { key: 'policy', label: 'Shift & policy' }]} active={tab} onChange={setTab} />
        {(tab === 'log' || tab === 'cal') && <MonthPicker ym={ym} setYm={setYm} />}
      </div>
      {tab === 'log' && (
        <Card pad={false} title={`Logs for ${monthLabel(ym)}`} actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV(`attendance-${ym}`, [{ key: 'date', label: 'Date' }, { key: 'status', label: 'Status' }, { key: 'clockIn', label: 'In' }, { key: 'clockOut', label: 'Out' }], recs)}>Export</Btn>}>
          <DataTable columns={logCols} rows={[...recs].reverse().filter((r) => r.date <= addDays(today, 7))} rowKey={(r) => r.date} pageSize={31} />
        </Card>
      )}
      {tab === 'cal' && (
        <Card>
          <div className="cal">
            {DAYS.map((d) => (
              <div key={d} className="cal-h">{d}</div>
            ))}
            {Array.from({ length: first }).map((_, i) => (
              <div key={'e' + i} />
            ))}
            {recs.map((r) => (
              <div key={r.date} className={`cal-d ${['Weekly off', 'Holiday'].includes(r.status) ? 'off' : ''} ${r.date === today ? 'today' : ''}`}>
                <div className="n">{Number(r.date.slice(8))}</div>
                {r.status && <Badge>{r.status}</Badge>}
                {r.clockIn && r.clockOut && <div className="muted">{hm(minutesBetween(r.clockIn, r.clockOut))}</div>}
                {r.note && <div className="muted">{r.note}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === 'req' && (
        <Card pad={false} title="My attendance requests" actions={<Btn icon="plus" onClick={() => setReq({ type: 'Regularization', date: today })}>New request</Btn>}>
          <DataTable
            rows={myReqs}
            columns={[
              { key: 'type', label: 'Type' },
              { key: 'date', label: 'Date', render: (r) => <DateRange from={r.date} to={r.to} /> },
              { key: 'time', label: 'Time', sortable: false, render: (r) => (r.clockIn ? `${fmtTime(r.clockIn)} – ${fmtTime(r.clockOut)}` : '—') },
              { key: 'reason', label: 'Reason' },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'act', label: '', sortable: false, render: (r) => r.status === 'Pending' && <Btn kind="ghost" small onClick={() => confirmAction('Cancel this request?') && patchItem('attendanceRequests', r.id, { status: 'Cancelled' })}>Cancel</Btn> },
            ]}
          />
        </Card>
      )}
      {tab === 'ot' && (
        <Card pad={false} title="Overtime" actions={<Btn icon="plus" onClick={() => setOt(true)}>Log overtime</Btn>}>
          <DataTable
            rows={myOt}
            columns={[
              { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'hours', label: 'Hours' },
              { key: 'reason', label: 'Reason' },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
            ]}
          />
        </Card>
      )}
      {tab === 'policy' && (
        <Card title="Shift & attendance policy">
          <KV
            items={[
              ['Shift', shift.name],
              ['Shift timing', `${fmtTime(shift.start)} – ${fmtTime(shift.end)}`],
              ['Grace period', `${shift.grace} minutes`],
              ['Break', `${shift.breakMinutes} minutes`],
              ['Full day', `${shift.fullDayHours} hours`],
              ['Half day', `${shift.halfDayHours} hours`],
              ['Weekly off', user.weeklyOff],
              ['Attendance capture', user.attendanceScheme],
              ['Attendance number', user.attendanceNumber],
              ['Overtime after', `${db.attendanceSettings.overtimeAfterHours} hours/day`],
              ['Late marks for half-day', db.attendanceSettings.lateMarksForHalfDay],
              ['Holiday calendar', user.holidayCalendar],
            ]}
          />
        </Card>
      )}
      {req && <FormModal title="Attendance request" fields={ATT_REQUEST_FIELDS} initial={req} onClose={() => setReq(null)} onSave={submitReq} submitLabel="Submit request" />}
      {ot && (
        <FormModal
          title="Log overtime"
          fields={[
            { key: 'date', label: 'Date', type: 'date', required: true },
            { key: 'hours', label: 'Extra hours', type: 'number', required: true, min: 0.5, step: 0.5 },
            { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
          ]}
          initial={{ date: today }}
          onClose={() => setOt(false)}
          onSave={(v) => {
            addItem('overtime', { ...v, empId: user.id, status: 'Pending' });
            if (user.reportingTo) notify(user.reportingTo, `${fullName(user)} logged ${v.hours}h overtime.`, 'inbox');
            setOt(false);
            toast('Overtime submitted');
          }}
        />
      )}
    </div>
  );
}

export function leaveFields(db, emp) {
  const bal = leaveBalances(db, emp.id);
  return [
    { key: 'typeId', label: 'Leave type', type: 'select', required: true, full: true, options: bal.map((b) => ({ value: b.type.id, label: `${b.type.name} — ${b.type.unlimited ? 'unlimited' : `${b.available} day(s) available`}` })) },
    { key: 'from', label: 'From date', type: 'date', required: true },
    { key: 'fromHalf', label: 'From session', type: 'select', options: ['Full day', 'First half', 'Second half'], default: 'Full day' },
    { key: 'to', label: 'To date', type: 'date', required: true },
    { key: 'toHalf', label: 'To session', type: 'select', options: ['Full day', 'First half', 'Second half'], default: 'Full day' },
    { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
    { key: 'notify', label: 'Notify (optional)', type: 'employee', full: true },
    { key: 'attachment', label: 'Attachment (e.g. medical certificate)', type: 'file', full: true },
  ];
}

export function submitLeave(db, emp, v, byAdmin = false) {
  const days = countLeaveDays(db, v.from, v.to, v.fromHalf, v.toHalf);
  const bal = leaveBalances(db, emp.id).find((b) => b.type.id === v.typeId);
  if (days <= 0) return 'The selected dates fall on weekly offs or holidays.';
  if (bal && !bal.type.unlimited && days > bal.available) return `Only ${bal.available} day(s) of ${bal.type.name} are available.`;
  const clash = db.leaveRequests.find((r) => r.empId === emp.id && ['Pending', 'Approved'].includes(r.status) && r.from <= v.to && r.to >= v.from);
  if (clash) return 'You already have leave applied on these dates.';
  addItem('leaveRequests', { ...v, empId: emp.id, days, status: byAdmin ? 'Approved' : 'Pending', appliedOn: todayISO(), approverComment: '' });
  if (!byAdmin && emp.reportingTo) notify(emp.reportingTo, `${fullName(emp)} applied for ${days} day(s) of ${bal?.type.name}.`, 'inbox');
  if (v.notify) notify(v.notify, `${fullName(emp)} will be on leave ${fmtDate(v.from)} – ${fmtDate(v.to)}.`);
  return '';
}

export function Leave({ user }) {
  const db = useDB();
  const [apply, setApply] = useState(false);
  const [tab, setTab] = useState(window.location.hash.includes('holidays') ? 'holidays' : 'history');
  const [compOff, setCompOff] = useState(false);
  const year = new Date().getFullYear();
  useEffect(() => {
    if (window.location.hash.includes('apply')) setApply(true);
  }, []);
  const bal = leaveBalances(db, user.id);
  const mine = db.leaveRequests.filter((r) => r.empId === user.id).sort((a, b) => b.from.localeCompare(a.from));
  const leaveType = (id) => db.leaveTypes.find((t) => t.id === id);
  const optionalTaken = mine.filter((r) => r.optionalHoliday && r.status !== 'Cancelled' && r.status !== 'Rejected');

  return (
    <div>
      <PageHead title="Leave" sub={`Leave plan: ${user.leavePlan} · Holiday calendar: ${user.holidayCalendar}`}>
        <Btn kind="ghost" onClick={() => setCompOff(true)}>Request comp off</Btn>
        <Btn icon="plus" onClick={() => setApply(true)}>Apply leave</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {bal.map((b) => (
          <div key={b.type.id} className="stat" style={{ borderTop: `3px solid ${b.type.color}` }}>
            <div className="stat-value">{b.type.unlimited ? '∞' : b.available}</div>
            <div className="stat-label">{b.type.name}</div>
            <div className="stat-sub">{b.type.unlimited ? `${b.taken} day(s) taken this year` : `Quota ${b.quota} · Taken ${b.taken} · Pending ${b.pending}`}</div>
          </div>
        ))}
      </div>
      <Tabs tabs={[{ key: 'history', label: 'Leave history' }, { key: 'holidays', label: `Holidays ${year}` }, { key: 'compoff', label: 'Comp off' }, { key: 'policy', label: 'Leave policy' }]} active={tab} onChange={setTab} />
      {tab === 'history' && (
        <Card pad={false}>
          <DataTable
            rows={mine}
            empty="You haven't applied for leave yet."
            columns={[
              { key: 'from', label: 'Dates', render: (r) => <DateRange from={r.from} to={r.to} /> },
              { key: 'typeId', label: 'Type', render: (r) => leaveType(r.typeId)?.name || '—' },
              { key: 'days', label: 'Days' },
              { key: 'reason', label: 'Reason' },
              { key: 'appliedOn', label: 'Applied on', render: (r) => fmtDate(r.appliedOn) },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'approverComment', label: 'Approver note', render: (r) => r.approverComment || '—' },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (r) =>
                  (r.status === 'Pending' || (r.status === 'Approved' && r.from > todayISO())) && (
                    <Btn kind="ghost" small onClick={() => confirmAction('Cancel this leave?') && (patchItem('leaveRequests', r.id, { status: 'Cancelled' }), toast('Leave cancelled'))}>
                      Cancel
                    </Btn>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {tab === 'holidays' && (
        <Card pad={false} title="Holiday calendar" actions={<span className="muted">Optional holidays you can pick: 2 per year ({optionalTaken.length} used)</span>}>
          <DataTable
            pageSize={40}
            rows={db.holidays.filter((h) => h.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date))}
            columns={[
              { key: 'date', label: 'Date', render: (h) => fmtDate(h.date) },
              { key: 'day', label: 'Day', sortable: false, render: (h) => parseISO(h.date).toLocaleDateString('en-GB', { weekday: 'long' }) },
              { key: 'name', label: 'Holiday' },
              { key: 'type', label: 'Type', render: (h) => <Badge tone={h.type === 'Optional' ? 'grey' : 'blue'}>{h.type}</Badge> },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (h) =>
                  h.type === 'Optional' && h.date >= todayISO() && !optionalTaken.some((r) => r.from === h.date) && optionalTaken.length < 2 ? (
                    <Btn
                      kind="ghost"
                      small
                      onClick={() => {
                        addItem('leaveRequests', { empId: user.id, typeId: db.leaveTypes[0].id, from: h.date, to: h.date, fromHalf: 'Full day', toHalf: 'Full day', days: 0, optionalHoliday: true, reason: `Optional holiday: ${h.name}`, status: 'Pending', appliedOn: todayISO() });
                        toast('Optional holiday requested');
                      }}
                    >
                      Request
                    </Btn>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
      {tab === 'compoff' && (
        <Card pad={false} title="Comp off requests" actions={<Btn icon="plus" onClick={() => setCompOff(true)}>Request comp off</Btn>}>
          <DataTable
            rows={db.compOffRequests.filter((r) => r.empId === user.id)}
            columns={[
              { key: 'workedOn', label: 'Worked on', render: (r) => fmtDate(r.workedOn) },
              { key: 'days', label: 'Days' },
              { key: 'reason', label: 'Reason' },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
            ]}
          />
        </Card>
      )}
      {tab === 'policy' && (
        <Card pad={false}>
          <DataTable
            rows={db.leaveTypes}
            columns={[
              { key: 'name', label: 'Leave type' },
              { key: 'annualQuota', label: 'Yearly quota', render: (t) => (t.unlimited ? 'Unlimited' : `${t.annualQuota} days`) },
              { key: 'accrual', label: 'Accrual' },
              { key: 'carryForward', label: 'Carry forward', render: (t) => (t.carryForward === 'Yes' ? `Yes (max ${t.maxCarryForward})` : 'No') },
              { key: 'encashable', label: 'Encashable' },
              { key: 'paid', label: 'Paid' },
              { key: 'description', label: 'Notes' },
            ]}
          />
        </Card>
      )}
      {apply && (
        <ApplyLeave
          emp={user}
          onClose={() => {
            setApply(false);
            if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/me/leave');
          }}
        />
      )}
      {compOff && (
        <FormModal
          title="Request compensatory off"
          fields={[
            { key: 'workedOn', label: 'Date worked (holiday / weekly off)', type: 'date', required: true },
            { key: 'days', label: 'Days', type: 'select', options: ['0.5', '1'], required: true, default: '1' },
            { key: 'reason', label: 'Work done', type: 'textarea', required: true, full: true },
          ]}
          onClose={() => setCompOff(false)}
          onSave={(v) => {
            addItem('compOffRequests', { ...v, days: Number(v.days), empId: user.id, status: 'Pending' });
            if (user.reportingTo) notify(user.reportingTo, `${fullName(user)} requested comp off for ${fmtDate(v.workedOn)}.`, 'inbox');
            setCompOff(false);
            toast('Comp off requested');
          }}
        />
      )}
    </div>
  );
}

export function ApplyLeave({ emp, onClose, byAdmin }) {
  const db = useDB();
  return (
    <FormModal
      title={byAdmin ? `Add leave for ${fullName(emp)}` : 'Apply leave'}
      fields={leaveFields(db, emp)}
      initial={{ from: todayISO(), to: todayISO() }}
      submitLabel={byAdmin ? 'Add leave' : 'Apply'}
      validate={(v) => (v.to < v.from ? 'The end date is before the start date.' : submitLeave(db, emp, v, byAdmin))}
      onClose={onClose}
      onSave={() => {
        toast(byAdmin ? 'Leave added' : 'Leave applied — waiting for approval');
        onClose();
      }}
    >
      {(v) => (
        <p className="muted" style={{ marginBottom: 12 }}>
          {v.from && v.to && v.to >= v.from ? `This request is for ${countLeaveDays(db, v.from, v.to, v.fromHalf, v.toHalf)} working day(s). Weekly offs and holidays are not counted.` : 'Pick the dates.'}
          {emp.reportingTo && !byAdmin ? ` Approver: ${fullName(empById(db, emp.reportingTo))}.` : ''}
        </p>
      )}
    </FormModal>
  );
}
