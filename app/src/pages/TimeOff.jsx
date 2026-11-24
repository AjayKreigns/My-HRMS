import { useEffect, useState } from 'react';
import { useDB, addItem, patchItem, notify, update, uid } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, Stat, KV, toast, DateRange, confirmAction, exportCSV } from '../ui.jsx';
import { useClock, ClockLabel } from '../App.jsx';
import {
  todayISO, addMonths, monthLabel, attendanceFor, arrival, minutesBetween, hm, fmtTime, fmtDate, parseISO, DAYS,
  empById, fullName, addDays, cycleRange, cycleLabel, cycleMonthOf, cycleStartOf, scheduleFor, regularizationUsage, checkRegularize, checkLeaveFromLog, checkCycleLock,
} from '../utils.js';
import LeaveInsights from './LeaveInsights.jsx';
import { decide } from './Inbox.jsx';
import { leaveBalances, evaluateLeave, buildLeaveRequest, describeRules, rulesOf, isHours } from '../leave.js';

const plusMinutes = (t, m) => {
  const [h, mm] = t.split(':').map(Number);
  const x = (h * 60 + mm + m) % (24 * 60);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

// Month picker for the attendance cycle. With a start day of 26, "Nov 2026" is 26 Oct - 25 Nov.
export function MonthPicker({ ym, setYm }) {
  const db = useDB();
  const sd = cycleStartOf(db);
  return (
    <div className="row">
      <Btn kind="ghost" small icon="chevronLeft" aria-label="Previous cycle" onClick={() => setYm(addMonths(ym, -1))} />
      <span style={{ minWidth: 150, textAlign: 'center' }}>
        <strong>{monthLabel(ym)}</strong>
        {sd > 1 && <div className="muted" style={{ fontSize: 12 }}>{cycleLabel(ym, sd)}</div>}
      </span>
      <Btn kind="ghost" small icon="chevronRight" aria-label="Next cycle" onClick={() => setYm(addMonths(ym, 1))} />
    </div>
  );
}

// Every day of the attendance cycle named by `ym` (the cycle that ends in that month).
export function monthRecords(db, empId, ym) {
  const [from, to] = cycleRange(ym, cycleStartOf(db));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(attendanceFor(db, empId, d));
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
    late: recs.filter((r) => r.late && (r.status === 'Present' || r.status === 'WFH')).length,
    action: recs.filter((r) => r.status === 'Action Required').length,
    leave: recs.filter((r) => r.status === 'Leave').length,
    absent: recs.filter((r) => r.status === 'Absent').length,
    wfh: recs.filter((r) => r.status === 'WFH').length,
  };
}

export const ATT_REQUEST_FIELDS = [
  { key: 'type', label: 'Request type', type: 'select', required: true, options: ['Regularization', 'Work From Home', 'On Duty', 'Remote Clock In'], full: true },
  { key: 'date', label: 'Date (from)', type: 'date', required: true },
  { key: 'to', label: 'To date', type: 'date', show: (v) => ['Work From Home', 'On Duty'].includes(v.type) },
  { key: 'clockIn', label: 'Clock-in time', type: 'time', show: (v) => ['Regularization', 'Remote Clock In'].includes(v.type) },
  { key: 'clockOut', label: 'Clock-out time', type: 'time', show: (v) => v.type === 'Regularization' },
  { key: 'location', label: 'Location / client site', type: 'text', show: (v) => ['On Duty', 'Remote Clock In'].includes(v.type) },
  { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
];

// How much of the day's hours is done. The bar counts from the first punch-in; 100% is the
// hours the day needs (for example 9h 30m). Today it fills as the clock runs, and the label shows
// when the day completes.
function DayBar({ rec, compact }) {
  if (!rec.clockIn || ['Weekly off', 'Holiday', 'Leave'].includes(rec.status)) return compact ? null : <span className="muted">—</span>;
  const need = rec.requiredMin || Math.round(Number(rec.shift?.requiredHours || 0) * 60);
  if (!need) return compact ? null : <span className="muted">—</span>;
  const live = rec.date === todayISO() && !rec.clockOut;
  const now = new Date();
  const nowT = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let worked = minutesBetween(rec.clockIn, rec.clockOut || (live ? nowT : rec.clockIn));
  if (rec.clockOut && worked <= 0) worked += 24 * 60;
  worked = Math.max(0, worked);
  const pct = Math.min(100, (worked / need) * 100);
  const tone = worked >= need ? 'green' : live ? 'blue' : 'amber';
  const done = Math.round(pct);
  const endsAt = live && worked < need ? ` · done at ${fmtTime(plusMinutes(rec.clockIn, need))}` : '';
  return (
    <div className={`day-bar ${compact ? 'compact' : ''}`} title={`${hm(worked)} of ${hm(need)} (${done}%)${endsAt}`}>
      <div className="day-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done}>
        <div className={`day-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <span className="day-bar-text">
          {hm(worked)} of {hm(need)}
          {endsAt && <span className="muted">{endsAt}</span>}
        </span>
      )}
    </div>
  );
}

// `user` is the employee whose attendance is shown. When an admin opens another employee from the
// Daily register, `admin` is the admin and `onBack` returns to the register: the admin can then
// regularize or apply leave on the employee's behalf, without the employee's limits and locks.
export function Attendance({ user, admin, onBack }) {
  const db = useDB();
  const byAdmin = !!admin;
  const clock = useClock(user, false);
  const sd = cycleStartOf(db);
  const [ym, setYm] = useState(cycleMonthOf(todayISO(), sd));
  const [tab, setTab] = useState('log');
  const [req, setReq] = useState(null);
  const [ot, setOt] = useState(false);
  const [partial, setPartial] = useState(false);
  const [leaveFor, setLeaveFor] = useState(null); // a day of the log to apply leave for
  const otOn = !!db.attendanceSettings.overtimeEnabled;
  const allRecs = monthRecords(db, user.id, ym);
  // Only the days that have happened (up to today) are shown and counted; later days stay empty.
  const recs = allRecs.filter((r) => r.date <= todayISO());
  const st = attendanceStats(recs);
  const shift = scheduleFor(db, user);
  const myReqs = db.attendanceRequests.filter((r) => r.empId === user.id);
  const usage = regularizationUsage(db, user.id);
  const regBlock = (date) => (byAdmin ? '' : checkRegularize(db, user.id, date));
  const usageText = usage.limit === null ? 'Regularizations: no limit' : `Regularizations left this cycle: ${usage.left} of ${usage.limit}`;
  const myOt = db.overtime.filter((r) => r.empId === user.id);
  const today = todayISO();
  const first = parseISO(allRecs[0]?.date || `${ym}-01`).getDay();

  const submitReq = (v) => {
    if (byAdmin) {
      // HR fixes the day directly: recorded as approved and applied to the log at once.
      addItem('attendanceRequests', { ...v, empId: user.id, status: 'Approved', createdAt: today, byAdmin: true, approvedBy: admin.id });
      if (v.type === 'Regularization') {
        update((d) => {
          const a = d.attendance.find((x) => x.empId === user.id && x.date === v.date);
          if (a) Object.assign(a, { clockIn: v.clockIn, clockOut: v.clockOut, regularized: true });
          else d.attendance.push({ id: uid('att'), empId: user.id, date: v.date, clockIn: v.clockIn, clockOut: v.clockOut, source: 'Regularized' });
        });
      }
      notify(user.id, `HR recorded a ${v.type} for ${fmtDate(v.date)} on your behalf.`, 'me/attendance');
      setReq(null);
      toast('Done: attendance updated');
      return;
    }
    addItem('attendanceRequests', { ...v, empId: user.id, status: 'Pending', createdAt: today });
    if (user.reportingTo) notify(user.reportingTo, `${fullName(user)} raised a ${v.type} request for ${fmtDate(v.date)}.`, 'inbox');
    setReq(null);
    toast('Request submitted for approval');
  };

  const logCols = [
    { key: 'date', label: 'Date', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{`${fmtDate(r.date)} · ${DAYS[parseISO(r.date).getDay()]}`}</span> },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Badge>{r.status}</Badge> : '—') },
    { key: 'clockIn', label: 'In', render: (r) => (!r.clockIn && r.clockOut && r.status !== 'Leave' ? <Badge tone="amber">Missing</Badge> : fmtTime(r.clockIn)) },
    { key: 'clockOut', label: 'Out', render: (r) => (r.clockIn && !r.clockOut && r.status !== 'Leave' ? (r.date === today ? <Badge tone="blue">Working</Badge> : <Badge tone="amber">Missing</Badge>) : fmtTime(r.clockOut)) },
    { key: 'eff', label: 'Effective hours', sortValue: (r) => minutesBetween(r.clockIn, r.clockOut), render: (r) => (r.clockIn && r.clockOut ? hm(minutesBetween(r.clockIn, r.clockOut) - (minutesBetween(r.clockIn, r.clockOut) > 300 ? Number(r.shift.breakMinutes || 0) : 0)) : '—') },
    { key: 'gross', label: 'Hours counted', sortable: false, render: (r) => (r.clockIn && r.clockOut ? hm(minutesBetween(r.clockIn, r.clockOut)) : '—') },
    { key: 'progress', label: 'Day progress', sortable: false, render: (r) => <DayBar rec={r} /> },
    { key: 'arrival', label: 'Arrival', sortable: false, render: (r) => [arrival(r), r.note, r.partial].filter(Boolean).join(' · ') || '—' },
    {
      key: 'act',
      label: '',
      sortable: false,
      render: (r) => {
        if (r.date > today || ['Weekly off', 'Holiday'].includes(r.status)) return null;
        if (!byAdmin && r.pendingLeave) return <Badge tone="amber">Leave pending approval</Badge>;
        const locked = byAdmin ? '' : checkCycleLock(db, r.date);
        if (locked) return <span className="muted" title={locked}>Locked</span>;
        const needsFix = ['Action Required', 'Absent'].includes(r.status);
        const leaveBlock = byAdmin ? '' : checkLeaveFromLog(db, user.id, r.date);
        return (
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <Btn kind="ghost" small disabled={!!regBlock(r.date)} title={regBlock(r.date)} onClick={() => setReq({ type: 'Regularization', date: r.date, clockIn: r.clockIn || shift.start, clockOut: r.clockOut || shift.end })}>
              Regularize
            </Btn>
            {needsFix && (
              <Btn kind="ghost" small disabled={!!leaveBlock} title={leaveBlock} onClick={() => setLeaveFor(r.date)}>
                Apply leave
              </Btn>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHead title={byAdmin ? `${fullName(user)} · Attendance` : 'Attendance'} sub={`${shift.name} · ${fmtTime(shift.start)} – ${fmtTime(shift.end)} · Weekly off: ${user.weeklyOff}`}>
        {byAdmin ? (
          <>
            <Btn kind="ghost" icon="chevronLeft" onClick={onBack}>Back to register</Btn>
            <Btn kind="ghost" onClick={() => setLeaveFor(today)}>Apply leave</Btn>
            <Btn onClick={() => setReq({ type: 'Regularization', date: today })}>Regularize</Btn>
          </>
        ) : (
          <>
            <Btn kind="ghost" onClick={() => setReq({ type: 'Work From Home', date: today, to: today })}>Work from home</Btn>
            <Btn kind="ghost" onClick={() => setReq({ type: 'On Duty', date: today, to: today })}>On duty</Btn>
            <Btn kind="ghost" onClick={() => setPartial(true)}>Partial leave</Btn>
            {otOn && <Btn kind="ghost" onClick={() => setOt(true)}>Overtime</Btn>}
            <Btn icon="clock" onClick={() => clock.toggle()}>{clock.clockedIn ? <>Clock out (<ClockLabel user={user} />)</> : 'Web clock in'}</Btn>
          </>
        )}
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Avg. hours / day" value={hm(st.avg)} tone="brand" />
        <Stat label="On-time arrival" value={`${st.onTimePct}%`} tone="green" sub={`${st.late} late arrival${st.late === 1 ? '' : 's'}`} />
        <Stat label="Days present" value={st.present} sub={`${st.wfh} work from home`} />
        <Stat label="Leave / absent" value={`${st.leave} / ${st.absent}`} tone={st.absent ? 'red' : undefined} sub={st.action ? `${st.action} action required` : undefined} />
      </div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <Tabs tabs={[{ key: 'log', label: 'Attendance log' }, { key: 'cal', label: 'Calendar' }, { key: 'req', label: `Requests (${myReqs.length})` }, ...(otOn ? [{ key: 'ot', label: 'Overtime' }] : []), { key: 'policy', label: 'Shift & policy' }]} active={tab} onChange={setTab} />
        {(tab === 'log' || tab === 'cal') && <MonthPicker ym={ym} setYm={setYm} />}
      </div>
      {tab === 'log' && (
        <Card pad={false} title={`Logs for ${monthLabel(ym)}${sd > 1 ? ` (${cycleLabel(ym, sd)})` : ''}`} actions={<><span className="muted" style={{ fontSize: 12.5 }}>{usageText}</span><Btn kind="ghost" small icon="download" onClick={() => exportCSV(`attendance-${ym}`, [{ key: 'date', label: 'Date' }, { key: 'status', label: 'Status' }, { key: 'clockIn', label: 'In' }, { key: 'clockOut', label: 'Out' }], recs)}>Export</Btn></>}>
          <DataTable columns={logCols} rows={[...recs].reverse()} rowKey={(r) => r.date} pageSize={31} />
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
            {allRecs.map((r) => r.date > today ? (
              <div key={r.date} className="cal-d off">
                <div className="n muted">{Number(r.date.slice(8))}</div>
              </div>
            ) : (
              <div key={r.date} className={`cal-d ${['Weekly off', 'Holiday'].includes(r.status) ? 'off' : ''} ${r.date === today ? 'today' : ''}`}>
                <div className="n">{Number(r.date.slice(8))}</div>
                {r.status && <Badge>{r.status}</Badge>}
                {r.late && <Badge tone="amber">Late {r.lateBy < 60 ? `${r.lateBy}m` : hm(r.lateBy)}</Badge>}
                <DayBar rec={r} compact />
                {r.clockIn && r.clockOut && <div className="muted">{hm(minutesBetween(r.clockIn, r.clockOut))}</div>}
                {r.note && <div className="muted">{r.note}</div>}
                {r.partial && <div className="muted">{r.partial}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === 'req' && (
        <Card pad={false} title="My attendance requests" actions={<><span className="muted" style={{ fontSize: 12.5 }}>{usageText}</span><Btn icon="plus" onClick={() => setReq({ type: 'Regularization', date: today })}>New request</Btn></>}>
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
      {tab === 'ot' && otOn && (
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
              ['Working day', `${fmtTime(shift.start)} – ${fmtTime(shift.end)}`],
              ['Hours needed for a present day', shift.ruleOn ? `${hm(Math.round(shift.requiredHours * 60))} between first punch-in and last punch-out. Fewer hours, or only one punch, shows Action Required. No punch at all is absent.` : 'Not applied: any punch-in is a present day'],
              ['Regularization', usage.limit === null ? 'No limit on regularization requests' : `${usage.limit} per attendance cycle (${usage.used} used in ${cycleLabel(usage.ym, sd)})`],
              ['Late mark', `Punching in after ${shift.grace} minutes past the start. The day stays present if the hours are met.`],
              ['Break', `${shift.breakMinutes} minutes`],
              ['Weekly off', user.weeklyOff],
              ['Attendance capture', user.attendanceScheme],
              ['Attendance number', user.attendanceNumber],
              ['Attendance cycle', sd > 1 ? `Day ${sd} of one month to day ${sd - 1} of the next (${cycleLabel(ym, sd)})` : 'Calendar month'],
              otOn ? ['Overtime after', `${db.attendanceSettings.overtimeAfterHours} hours/day`] : ['Overtime', 'Not applicable'],
              ['Late marks for half-day', db.attendanceSettings.lateMarksForHalfDay],
              ['Holiday calendar', user.holidayCalendar],
            ]}
          />
        </Card>
      )}
      {req && (
        <FormModal
          title={byAdmin ? `Attendance for ${fullName(user)}` : 'Attendance request'}
          fields={ATT_REQUEST_FIELDS}
          initial={req}
          onClose={() => setReq(null)}
          onSave={submitReq}
          submitLabel={byAdmin ? 'Save' : 'Submit request'}
          validate={(v) => (v.type === 'Regularization' && !byAdmin ? checkRegularize(db, user.id, v.date) : '')}
        >
          {(v) => {
            if (v.type !== 'Regularization') return null;
            const leaveBlock = byAdmin ? '' : checkLeaveFromLog(db, user.id, v.date);
            return (
              <>
                <p className="muted" style={{ marginBottom: 12 }}>
                  {byAdmin
                    ? `You are recording this for ${fullName(user)}. It is approved straight away and does not use up their regularizations (${usageText.toLowerCase()}).`
                    : `${usageText}. ${usage.limit !== null && usage.left <= 0 ? 'None left: HR can correct the log directly.' : 'This request uses one when you submit it, and gives it back if it is rejected or cancelled.'}`}
                </p>
                <div className="leave-instead">
                  <div>
                    <strong>Were you not at work, or short of hours?</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>{leaveBlock || 'Apply leave for this day instead. It does not use up a regularization.'}</div>
                  </div>
                  <Btn kind="ghost" small disabled={!!leaveBlock} onClick={() => { setReq(null); setLeaveFor(v.date); }}>
                    Apply leave for this day
                  </Btn>
                </div>
              </>
            );
          }}
        </FormModal>
      )}
      {partial && <ApplyLeave emp={user} partial onClose={() => setPartial(false)} />}
      {leaveFor && <ApplyLeave emp={user} byAdmin={byAdmin} fromLog={attendanceFor(db, user.id, leaveFor)} onClose={() => setLeaveFor(null)} />}
      {ot && otOn && (
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

const PARTIAL = 'Partial (hours)';
const FULL = 'Full / half days';

export function leaveFields(db, emp, byAdmin = false) {
  // A type is offered when it has a balance to use (HR-added types only once granted).
  const bal = leaveBalances(db, emp.id).filter((b) => byAdmin || !b.manual || b.available > 0);
  const hoursIds = new Set(db.leaveTypes.filter(isHours).map((t) => t.id));
  const label = (b) => {
    if (b.unit === 'Hours') return `${b.type.name} — in hours, ${b.available === Infinity ? 'no limit' : `${b.available} left this cycle`}`;
    if (b.type.unlimited) return `${b.type.name} — unlimited`;
    if (!b.eligible) return `${b.type.name} — available from ${fmtDate(b.eligibleDate)}`;
    return `${b.type.name} — ${b.available} day(s) available`;
  };
  const partialOn = (v) => v.mode === PARTIAL || hoursIds.has(v.typeId); // an hours-based type is always taken in hours
  return [
    { key: 'typeId', label: 'Leave type', type: 'select', required: true, full: true, options: bal.map((b) => ({ value: b.type.id, label: label(b) })) },
    { key: 'mode', label: 'Leave for', type: 'select', options: [FULL, PARTIAL], default: FULL, full: true, help: 'Pick "Partial (hours)" to take a few hours off on one day.', show: (v) => !hoursIds.has(v.typeId) },
    { key: 'from', label: 'From date', type: 'date', required: true, show: (v) => !partialOn(v) },
    { key: 'fromHalf', label: 'From session', type: 'select', options: ['Full day', 'First half', 'Second half'], default: 'Full day', show: (v) => !partialOn(v) },
    { key: 'to', label: 'To date', type: 'date', required: true, show: (v) => !partialOn(v) },
    { key: 'toHalf', label: 'To session', type: 'select', options: ['Full day', 'First half', 'Second half'], default: 'Full day', show: (v) => !partialOn(v) },
    { key: 'from', label: 'Date', type: 'date', required: true, show: partialOn },
    { key: 'fromTime', label: 'From time', type: 'time', required: true, show: partialOn },
    { key: 'toTime', label: 'To time', type: 'time', required: true, show: partialOn },
    { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
    { key: 'notify', label: 'Notify (optional)', type: 'employee', full: true },
    { key: 'attachment', label: 'Attachment (e.g. medical certificate)', type: 'file', full: true },
  ];
}

// Values from the form -> what the rules engine expects.
const asRequest = (db, v) => {
  const partial = v.mode === PARTIAL || isHours(db.leaveTypes.find((t) => t.id === v.typeId));
  return { ...v, partial, to: partial ? v.from : v.to };
};

export function submitLeave(db, emp, v, byAdmin = false, extra = {}) {
  const req = asRequest(db, v);
  const ev = evaluateLeave(db, emp, req, { byAdmin });
  if (!ev.ok) return ev.error;
  const t = db.leaveTypes.find((x) => x.id === v.typeId);
  addItem('leaveRequests', buildLeaveRequest(emp, { ...req, mode: undefined }, ev, { ...(req.partial ? { partial: true } : {}), ...extra }));
  const what = req.partial ? `${ev.days} day (${req.fromTime}–${req.toTime})` : `${ev.days} day(s)`;
  if (ev.status === 'Pending' && emp.reportingTo) notify(emp.reportingTo, `${fullName(emp)} applied for ${what} of ${t.name}.`, 'inbox');
  if (v.notify) notify(v.notify, `${fullName(emp)} will be on leave ${fmtDate(v.from)} – ${fmtDate(req.to)}.`);
  return '';
}

// A CSV of one employee's leave: the balance of each type, then every request.
function downloadLeaveReport(db, emp, bal, requests) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (cells) => cells.map(esc).join(',');
  const typeName = (id) => db.leaveTypes.find((t) => t.id === id)?.name || '';
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const lines = [row([`Leave report: ${fullName(emp)} (${emp.empNo})`]), row([`Generated on ${todayISO()}`]), ''];
  lines.push(row(['Leave type', 'Counted in', 'Credited / allowed', 'Used', 'Pending', 'Available', 'Next credit']));
  bal.forEach((b) => {
    const hours = b.unit === 'Hours';
    lines.push(row([b.type.name, hours ? 'times per attendance cycle' : 'days', b.type.unlimited ? 'No limit' : r2(b.quota), r2(b.taken), r2(b.pending), b.type.unlimited || b.available === Infinity ? 'No limit' : r2(b.available), b.nextCredit ? `${fmtDate(b.nextCredit)} (+${r2(b.perCredit)})` : '']));
  });
  lines.push('');
  lines.push(row(['Type', 'From', 'To', 'Days / hours', 'Loss of Pay days', 'Status', 'Reason', 'Applied on', 'Approver note']));
  requests.forEach((r) => lines.push(row([typeName(r.typeId), r.from, r.partial ? `${r.fromTime} - ${r.toTime}` : r.to, r.partial ? hm(minutesBetween(r.fromTime, r.toTime)) : r.days, r.lopDays || 0, r.status, r.reason, r.appliedOn, r.approverComment])));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `leave-report-${emp.empNo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// `user` is the employee whose leave is shown. When an admin opens an employee from Leave
// settings > Balances, `admin` is the admin and `onBack` returns to the list: the admin sees what the
// employee sees, can add leave for them, approve their pending requests and download a report.
export function Leave({ user, admin, onBack }) {
  const db = useDB();
  const byAdmin = !!admin;
  const [apply, setApply] = useState(false);
  const [tab, setTab] = useState(window.location.hash.includes('holidays') ? 'holidays' : 'history');
  const [compOff, setCompOff] = useState(false);
  const year = new Date().getFullYear();
  useEffect(() => {
    if (!byAdmin && window.location.hash.includes('apply')) setApply(true);
  }, [byAdmin]);
  const bal = leaveBalances(db, user.id);
  // HR-added balances (comp off, maternity...) show only once there is something to show.
  const tiles = bal.filter((b) => !b.manual || b.quota > 0 || b.taken > 0 || b.pending > 0);
  const mine = db.leaveRequests.filter((r) => r.empId === user.id).sort((a, b) => b.from.localeCompare(a.from));
  const leaveType = (id) => db.leaveTypes.find((t) => t.id === id);
  const optionalTaken = mine.filter((r) => r.optionalHoliday && r.status !== 'Cancelled' && r.status !== 'Rejected');
  const coType = byAdmin ? null : bal.find((b) => b.type.code === 'CO' && b.rules.allowEmployeeRequest);

  return (
    <div>
      <PageHead title={byAdmin ? `${fullName(user)} · Leave` : 'Leave'} sub={`Leave plan: ${user.leavePlan} · Holiday calendar: ${user.holidayCalendar}`}>
        {byAdmin && <Btn kind="ghost" icon="chevronLeft" onClick={onBack}>Back to balances</Btn>}
        {byAdmin && <Btn kind="ghost" icon="download" onClick={() => downloadLeaveReport(db, user, bal, mine)}>Download report</Btn>}
        {coType && <Btn kind="ghost" onClick={() => setCompOff(true)}>Request comp off</Btn>}
        <Btn icon="plus" onClick={() => setApply(true)}>{byAdmin ? 'Add leave' : 'Apply leave'}</Btn>
      </PageHead>
      <LeaveInsights db={db} user={user} year={year} />
      <Tabs tabs={[{ key: 'history', label: 'Leave history' }, { key: 'holidays', label: `Holidays ${year}` }, ...(coType ? [{ key: 'compoff', label: 'Comp off' }] : []), { key: 'policy', label: 'Leave policy' }]} active={tab} onChange={setTab} />
      {tab === 'history' && (
        <Card pad={false}>
          <DataTable
            rows={mine}
            empty="You haven't applied for leave yet."
            columns={[
              { key: 'from', label: 'Dates', render: (r) => (r.partial ? `${fmtDate(r.from)} · ${fmtTime(r.fromTime)} – ${fmtTime(r.toTime)}` : <DateRange from={r.from} to={r.to} />) },
              { key: 'typeId', label: 'Type', render: (r) => leaveType(r.typeId)?.name || '—' },
              {
                key: 'days',
                label: 'Days',
                render: (r) => (
                  <span>
                    {r.partial ? hm(minutesBetween(r.fromTime, r.toTime)) : r.days}
                    {r.lopDays > 0 && <span className="muted"> ({r.lopDays} LOP)</span>}
                    {(r.sandwichDates || []).length > 0 && <span className="muted"> incl. {r.sandwichDates.length} off day(s)</span>}
                  </span>
                ),
              },
              { key: 'reason', label: 'Reason' },
              { key: 'appliedOn', label: 'Applied on', render: (r) => fmtDate(r.appliedOn) },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'approverComment', label: 'Approver note', render: (r) => r.approverComment || '—' },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (r) => (
                  <span className="row-actions">
                    {byAdmin && r.status === 'Pending' && (
                      <>
                        <Btn kind="ghost" small onClick={() => { const c = window.prompt('Reason for rejecting?') || ''; if (c) { decide(db, { src: { col: 'leaveRequests', kind: 'Leave' }, row: r }, 'Rejected', c, admin); toast('Leave rejected'); } }}>Reject</Btn>
                        <Btn kind="success" small onClick={() => { decide(db, { src: { col: 'leaveRequests', kind: 'Leave' }, row: r }, 'Approved', '', admin); toast('Leave approved'); }}>Approve</Btn>
                      </>
                    )}
                    {(r.status === 'Pending' || (r.status === 'Approved' && r.from > todayISO())) && (
                      <Btn kind="ghost" small onClick={() => confirmAction('Cancel this leave?') && (patchItem('leaveRequests', r.id, { status: 'Cancelled' }), toast('Leave cancelled'))}>
                        Cancel
                      </Btn>
                    )}
                  </span>
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
                  !byAdmin && h.type === 'Optional' && h.date >= todayISO() && !optionalTaken.some((r) => r.from === h.date) && optionalTaken.length < 2 ? (
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
        <div className="stack">
          {db.leaveTypes
            .filter((t) => rulesOf(t).active !== false && (!t.gender || t.gender === 'All' || t.gender === user.gender))
            .map((t) => (
              <Card key={t.id} title={`${t.name} (${t.code})`} actions={<Badge tone={t.paid === 'Unpaid' ? 'red' : 'green'}>{t.paid}</Badge>}>
                <ul className="rules">
                  {describeRules(t, db).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
      {apply && (
        <ApplyLeave
          emp={user}
          byAdmin={byAdmin}
          onClose={() => {
            setApply(false);
            if (!byAdmin && window.location.hash.includes('?')) window.history.replaceState(null, '', '#/me/leave');
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

// Quick picks for a day of the attendance log that needs fixing.
function leaveShortcuts(rec) {
  const out = [
    { label: 'Full day', values: { mode: FULL, fromHalf: 'Full day', toHalf: 'Full day' } },
    { label: 'First half', values: { mode: FULL, fromHalf: 'First half', toHalf: 'Full day' } },
    { label: 'Second half', values: { mode: FULL, fromHalf: 'Second half', toHalf: 'Full day' } },
  ];
  if (rec.clockIn && rec.clockOut && rec.requiredMin > rec.workedMin && rec.workedMin > 0) {
    const short = rec.requiredMin - rec.workedMin;
    out.push({ label: `Only the missing ${hm(short)} (partial)`, values: { mode: PARTIAL, fromTime: rec.clockOut, toTime: plusMinutes(rec.clockOut, short) < rec.clockOut ? '23:59' : plusMinutes(rec.clockOut, short) } });
  }
  return out;
}

// `fromLog` is a day of the attendance log (from attendanceFor) when leave is applied as the
// second way of fixing that day, next to Regularize.
export function ApplyLeave({ emp, onClose, byAdmin, partial, fromLog }) {
  const db = useDB();
  const day = fromLog?.date;
  return (
    <FormModal
      title={byAdmin ? `Add leave for ${fullName(emp)}` : fromLog ? `Apply leave for ${fmtDate(day)}` : partial ? 'Partial leave' : 'Apply leave'}
      fields={leaveFields(db, emp, byAdmin)}
      initial={{ from: day || todayISO(), to: day || todayISO(), ...(partial ? { mode: PARTIAL, typeId: db.leaveTypes.find((t) => isHours(t) && rulesOf(t).active !== false)?.id || '' } : {}) }}
      submitLabel={byAdmin ? 'Add leave' : 'Apply'}
      validate={(v) => {
        if (!asRequest(db, v).partial && v.to < v.from) return 'The end date is before the start date.';
        if (fromLog && !byAdmin) {
          const block = checkLeaveFromLog(db, emp.id, v.from);
          if (block) return block;
        }
        return submitLeave(db, emp, v, byAdmin, fromLog ? { viaAttendance: day } : {});
      }}
      onClose={onClose}
      onSave={(v) => {
        const t = db.leaveTypes.find((x) => x.id === v.typeId);
        toast(byAdmin ? 'Leave added' : rulesOf(t).needsApproval === false ? 'Leave applied and approved' : 'Leave applied — waiting for approval');
        onClose();
      }}
    >
      {(v, setV) => {
        const isPartial = asRequest(db, v).partial;
        const inHours = isHours(db.leaveTypes.find((t) => t.id === v.typeId));
        const ready = v.typeId && v.from && (isPartial ? v.fromTime && v.toTime : v.to);
        const ev = ready ? evaluateLeave(db, emp, asRequest(db, v), { byAdmin }) : null;
        return (
          <>
          {fromLog && (
            <div className="leave-from-log">
              <p className="muted">
                The log for {fmtDate(day)} shows <strong>{fromLog.status || 'no record'}</strong>
                {fromLog.note ? ` (${fromLog.note})` : ''}. Pick what you are taking leave for:
              </p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {leaveShortcuts(fromLog).map((c) => (
                  <Btn key={c.label} kind="ghost" small onClick={() => setV((s) => ({ ...s, ...c.values }))}>
                    {c.label}
                  </Btn>
                ))}
              </div>
            </div>
          )}
          <div className="leave-preview" aria-live="polite">
            {!ev && <p className="muted">Pick the leave type and dates to see how the days are counted.</p>}
            {ev && !ev.ok && <p className="muted">{ev.error}</p>}
            {ev && ev.ok && (
              <>
                <p>
                  <strong>
                    {inHours ? hm(minutesBetween(v.fromTime, v.toTime)) : `${ev.days} day(s)`}
                  </strong>{' '}
                  {ev.lopDays > 0 ? (inHours ? '· counted as Loss of Pay' : `· ${round1(ev.days - ev.lopDays)} from the balance, ${ev.lopDays} as Loss of Pay`) : inHours ? '' : '· from the balance'}
                  {ev.status === 'Pending' && emp.reportingTo && !byAdmin ? ` · approver: ${fullName(empById(db, emp.reportingTo))}` : ev.status === 'Approved' && !byAdmin ? ' · approved automatically' : ''}
                </p>
                {ev.notes.map((n, i) => (
                  <p key={i} className="muted">{n}</p>
                ))}
              </>
            )}
          </div>
          </>
        );
      }}
    </FormModal>
  );
}
const round1 = (n) => Math.round(n * 100) / 100;
