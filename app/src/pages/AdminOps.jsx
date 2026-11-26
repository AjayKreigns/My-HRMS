import { useState } from 'react';
import { useDB, patchItem, addItem, update, uid, notify } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, EmpChip, Stat, Crud, FormGrid, toast, confirmAction, exportCSV, DateRange, BarChart } from '../ui.jsx';
import { ApplyLeave, ATT_REQUEST_FIELDS, Attendance, MonthPicker, Leave } from './TimeOff.jsx';
import { TicketDetail } from './Requests.jsx';
import { GOAL_FIELDS } from './Performance.jsx';
import { decide } from './Inbox.jsx';
import {
  empById, cycleLabel, fullName, fmtDate, fmtTime, money, monthLabel, todayISO, attendanceFor, minutesBetween, hm, activeEmployees, arrival, addDays, parseISO, cycleStartOf, scheduleOfShift, cycleMonthOf, cycleRange,
} from '../utils.js';
import { leaveBalances, countRange, describeRules, rulesOf, creditMode, RULE_DEFAULTS, attendanceRemark, isHours, backdateRule } from '../leave.js';

// ---------- leave types: editor, rule tester, delete ----------
const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
const trimNum = (n) => String(Math.round(n * 100) / 100);

function creditSummary(t) {
  if (isHours(t)) return `In hours · ${t.timesPerCycle === '' || t.timesPerCycle == null ? 'no limit' : `${t.timesPerCycle} per cycle`}`;
  if (t.unlimited) return 'Unlimited';
  const m = creditMode(t);
  const r = rulesOf(t);
  const q = Number(t.annualQuota || 0);
  const day = Number(r.creditDay) === 0 ? 'month end' : ord(Number(r.creditDay));
  if (m === 'Manual') return 'Added by HR';
  if (m === 'Monthly') return `${q}/yr · ${trimNum(q / 12)} on ${day}`;
  if (m === 'Quarterly') return `${q}/yr · ${trimNum(q / 4)} per quarter`;
  return `${q} at year start`;
}
function sandwichSummary(t) {
  if (isHours(t)) return '—';
  const r = rulesOf(t);
  if (!r.sw_enabled) return 'Off';
  return `More than ${r.sw_minDays} ${r.sw_basis === 'Calendar days' ? 'calendar' : 'working'} days${r.sw_holidayBlock === 'Skip the block' ? ' · skips holiday block' : ''}`;
}

// The "apply within" choice of a leave type as the editor shows it.
const basisOf = (v) => ({ days: 'Days', cycle: 'Cycle', none: 'None' })[backdateRule(v).mode];

const TYPE_FIELDS = [
  { key: 'name', label: 'Name', required: true, section: 'Basics' },
  { key: 'code', label: 'Code', required: true, help: 'Short code, for example CL or PL.' },
  { key: 'color', label: 'Colour', type: 'color' },
  { key: 'paid', label: 'Paid / unpaid', type: 'select', options: ['Paid', 'Unpaid'] },
  { key: 'gender', label: 'Applicable to', type: 'select', options: ['All', 'Female', 'Male'] },
  { key: 'active', label: 'Active (employees can use it)', type: 'checkbox' },
  { key: 'unlimited', label: 'No limit on the balance (like Loss of Pay)', type: 'checkbox', full: true },
  { key: 'description', label: 'Note shown to employees', type: 'textarea', full: true },
  { key: 'unit', label: 'Leave is counted in', type: 'select', options: [{ value: 'Days', label: 'Days (a balance of days)' }, { value: 'Hours', label: 'Hours (a permission, with a From and To time)' }], default: 'Days', full: true, help: 'Choose Hours for a permission: it is taken in hours and limited to a number of times in each attendance cycle.' },

  { key: 'timesPerCycle', label: 'Times it can be used in each attendance cycle', type: 'number', min: 0, section: 'Hours (permission)', show: (v) => v.unit === 'Hours', help: 'For example 2. Leave blank for no limit.' },
  { key: 'maxHoursEach', label: 'Longest each time (hours)', type: 'number', min: 0, step: 0.25, show: (v) => v.unit === 'Hours', help: 'Leave blank to allow up to a full working day.' },
  { key: 'maxHoursPerCycle', label: 'Most hours in one cycle (total)', type: 'number', min: 0, step: 0.25, show: (v) => v.unit === 'Hours', help: 'Leave blank for no cap on the total.' },
  { key: 'insufficientAction', label: 'When the limit is used up', type: 'select', options: [{ value: 'Block', label: 'Do not accept the request' }, { value: 'Convert excess to LOP', label: 'Count the request as Loss of Pay' }], show: (v) => v.unit === 'Hours' },

  { key: 'accrual', label: 'How balance is credited', type: 'select', options: ['Monthly', 'Quarterly', 'Yearly', 'Manual'], section: 'Credit', help: 'Manual means HR adds the balance (comp off, maternity, paternity).', show: (v) => !v.unlimited },
  { key: 'annualQuota', label: 'Days credited per year', type: 'number', step: 0.5, show: (v) => !v.unlimited && v.accrual !== 'Manual' },
  { key: 'creditDay', label: 'Credited on day of month', type: 'number', min: 0, max: 28, help: '0 = last day of the month.', show: (v) => !v.unlimited && ['Monthly', 'Quarterly'].includes(v.accrual) },
  { key: 'leaveYearStart', label: 'Leave year starts in month', type: 'number', min: 1, max: 12, help: '1 = January. Credits restart and unused balance lapses at the year end.', show: (v) => !v.unlimited && v.accrual !== 'Manual' },
  { key: 'eligibleAfter', label: 'Can be used from', type: 'select', options: [{ value: 'Joining', label: 'Joining date' }, { value: 'Probation end', label: 'End of probation' }], show: (v) => !v.unlimited && v.accrual !== 'Manual' },
  { key: 'accrueFrom', label: 'Credits count from', type: 'select', options: ['Joining date', 'Eligibility date'], show: (v) => !v.unlimited && v.accrual !== 'Manual', help: 'Joining date: credits for months before probation ends are given once it ends.' },
  { key: 'joinCutoffDay', label: 'Joining cut-off day', type: 'number', min: 0, max: 31, help: 'Joiners after this day of the month start from next month. 0 = no cut-off.', show: (v) => !v.unlimited && ['Monthly', 'Quarterly'].includes(v.accrual) },
  { key: 'carryForward', label: 'Carry forward', type: 'select', options: ['No', 'Yes'], show: (v) => !v.unlimited },
  { key: 'maxCarryForward', label: 'Max carry forward (days)', type: 'number', show: (v) => !v.unlimited && v.carryForward === 'Yes' },
  { key: 'encashable', label: 'Encashable', type: 'select', options: ['No', 'Yes'], show: (v) => !v.unlimited },
  { key: 'allowEmployeeRequest', label: 'Employees can raise comp-off requests', type: 'checkbox', full: true, show: (v) => v.code === 'CO' },

  { key: 'needsApproval', label: "Needs the reporting manager's approval", type: 'checkbox', section: 'Applying', full: true },
  { key: 'allowPartial', label: 'Allow partial-day (From and To time) leave', type: 'checkbox', full: true },
  { key: 'insufficientAction', label: 'When the balance is not enough', type: 'select', options: [{ value: 'Block', label: 'Do not accept the request' }, { value: 'Convert excess to LOP', label: 'Count the extra days as Loss of Pay' }], show: (v) => !v.unlimited },
  { key: 'backdateBasis', label: 'Time allowed to apply for leave', type: 'select', options: [{ value: 'None', label: 'No limit: leave can be applied any time' }, { value: 'Days', label: 'A number of days after the leave' }, { value: 'Cycle', label: 'Until the end of the attendance cycle' }], help: 'The cycle option follows the attendance cycle set in Attendance settings (for example the 26th to the 25th), whatever the length of the month.', show: (v) => !v.unlimited },
  { key: 'backdateDays', label: 'Apply within (days after the leave)', type: 'number', min: 0, show: (v) => !v.unlimited && basisOf(v) === 'Days' },
  { key: 'backdateAction', label: 'If applied later than that', type: 'select', options: [{ value: 'Convert to LOP', label: 'Count the leave as Loss of Pay' }, { value: 'Block', label: 'Do not accept the request' }], help: 'Used only when a time limit is set above.', show: (v) => !v.unlimited && basisOf(v) !== 'None' },
  { key: 'cutoffTime', label: 'Same-day leave must be informed by', type: 'time', help: 'Leave blank for no rule.', show: (v) => !v.unlimited },
  { key: 'lateInformLop', label: 'If informed later, days counted as LOP', type: 'number', step: 0.5, show: (v) => !v.unlimited && !!v.cutoffTime },
  { key: 'certificateAfterDays', label: 'Medical certificate needed beyond (days)', type: 'number', min: 0, help: 'Leave blank if never needed.' },
  { key: 'certificateEnforce', label: 'Do not accept the request without an attachment', type: 'checkbox', full: true, show: (v) => v.certificateAfterDays !== '' && v.certificateAfterDays !== undefined },

  { key: 'noCombineWith', label: 'Cannot be taken directly next to', type: 'multiselect', section: 'Combining with other leave', full: true, options: (db, v) => db.leaveTypes.filter((t) => t.id !== v.id && !t.unlimited).map((t) => ({ value: t.id, label: t.name })), show: (v) => !v.unlimited },
  { key: 'combineAction', label: 'If it is taken next to them', type: 'select', options: [{ value: 'Convert to LOP', label: 'Count this leave as Loss of Pay' }, { value: 'Block', label: 'Do not accept the request' }], show: (v) => !v.unlimited && (v.noCombineWith || []).length > 0 },

  { key: 'sw_enabled', label: 'Sandwich rule: count weekly offs and holidays as leave', type: 'checkbox', section: 'Sandwich rule', full: true },
  { key: 'sw_basis', label: 'Compare with the minimum using', type: 'select', options: [{ value: 'Working days', label: 'Working days of leave taken' }, { value: 'Calendar days', label: 'All calendar days of the request' }], show: (v) => v.sw_enabled },
  { key: 'sw_minDays', label: 'Counted when leave is more than (days)', type: 'number', min: 0, step: 0.5, show: (v) => v.sw_enabled },
  { key: 'sw_scope', label: 'Which weekly offs / holidays', type: 'select', options: [{ value: 'Whole request', label: 'Any inside the request' }, { value: 'Between leave days only', label: 'Only between two leave days' }], show: (v) => v.sw_enabled },
  { key: 'sw_holidayBlock', label: 'If a weekend block includes a holiday', type: 'select', options: [{ value: 'Count', label: 'Count it like the rest' }, { value: 'Skip the block', label: 'Do not count that whole block' }], show: (v) => v.sw_enabled },
  { key: 'sw_weeklyOffs', label: 'Count weekly offs', type: 'checkbox', show: (v) => v.sw_enabled },
  { key: 'sw_holidays', label: 'Count holidays', type: 'checkbox', show: (v) => v.sw_enabled },
  { key: 'sw_edges', label: 'Also count those directly before and after the request', type: 'checkbox', full: true, show: (v) => v.sw_enabled },
  { key: 'sw_merge', label: 'Count separate requests together when only weekly offs / holidays lie between them', type: 'checkbox', full: true, show: (v) => v.sw_enabled },
].map((f) => {
  // An hours-based type has no credit, carry forward, sandwich or day-balance rules.
  const dayOnly = ['unlimited', 'accrual', 'annualQuota', 'creditDay', 'leaveYearStart', 'eligibleAfter', 'accrueFrom', 'joinCutoffDay', 'carryForward', 'maxCarryForward', 'encashable', 'allowEmployeeRequest', 'allowPartial', 'certificateAfterDays', 'certificateEnforce', 'noCombineWith', 'combineAction'].includes(f.key) || f.key.startsWith('sw_') || (f.key === 'insufficientAction' && f.label === 'When the balance is not enough');
  return dayOnly ? { ...f, show: (v) => v.unit !== 'Hours' && (f.show ? f.show(v) : true) } : f;
});

// Next date after `from` (inclusive) that falls on weekday `wd` (0 = Sunday).
const nextWeekday = (from, wd) => {
  let d = from;
  while (parseISO(d).getDay() !== wd) d = addDays(d, 1);
  return d;
};
const shortDay = (d) => parseISO(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// Try the rules being edited on any dates before saving them.
function RuleTester({ db, rule }) {
  const fri = nextWeekday(addDays(todayISO(), 1), 5);
  const [from, setFrom] = useState(fri);
  const [to, setTo] = useState(addDays(fri, 3));
  const emp = { weeklyOff: 'Saturday & Sunday' };
  const ok = from && to && to >= from;
  const c = ok ? countRange(db, emp, rule, from, to, 'Full day', 'Full day') : null;
  const preset = (a, b) => {
    const f = nextWeekday(addDays(todayISO(), 1), a);
    setFrom(f);
    setTo(addDays(f, b));
  };
  return (
    <div className="rule-test">
      <h4 className="form-section">Test these rules</h4>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <input type="date" className="input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Test from date" />
        <span>to</span>
        <input type="date" className="input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Test to date" />
        <Btn kind="ghost" small onClick={() => preset(5, 3)}>Fri → Mon</Btn>
        <Btn kind="ghost" small onClick={() => preset(5, 4)}>Fri → Tue</Btn>
        <Btn kind="ghost" small onClick={() => preset(1, 6)}>Mon → Sun</Btn>
      </div>
      <p aria-live="polite">
        {c ? (
          <>
            <strong>{c.days} day(s)</strong>
            {` · ${c.workDays} working day(s)`}
            {c.extraDates.length ? ` + ${c.extraDates.length} counted: ${c.extraDates.map(shortDay).join(', ')}` : ''}
          </>
        ) : (
          'Pick the dates.'
        )}
      </p>
      <p className="muted">Uses Saturday and Sunday as weekly offs and the company holiday list. Balance and approval checks are not part of this test.</p>
    </div>
  );
}

const NEW_TYPE = { ...RULE_DEFAULTS, backdateBasis: 'None', unit: 'Days', accrual: 'Monthly', annualQuota: 12, carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'All', color: '#5746af', unlimited: false, description: '' };

function LeaveTypes() {
  const db = useDB();
  const [editing, setEditing] = useState(null);

  const remove = (t) => {
    if (t.code === 'LOP') return toast('Loss of Pay is used by payroll, so it cannot be deleted.', 'error');
    const used = db.leaveRequests.filter((r) => r.typeId === t.id).length + (db.leaveAdjustments || []).filter((a) => a.typeId === t.id).length + db.compOffRequests.filter(() => t.code === 'CO').length;
    if (used > 0) {
      if (confirmAction(`${t.name} is used by ${used} leave record(s), so deleting it would erase that history.\n\nDeactivate it instead? Employees stop seeing it and the history stays.`)) {
        patchItem('leaveTypes', t.id, { active: false });
        toast(`${t.name} deactivated`);
      }
      return;
    }
    if (!confirmAction(`Delete ${t.name}? This cannot be undone.`)) return;
    update((d) => {
      d.leaveTypes = d.leaveTypes.filter((x) => x.id !== t.id);
      d.leaveTypes.forEach((x) => {
        if (x.noCombineWith) x.noCombineWith = x.noCombineWith.filter((id) => id !== t.id);
      });
      d.employees.forEach((e) => {
        if (e.carryForward) delete e.carryForward[t.id];
      });
    });
    toast(`${t.name} deleted`);
  };

  const save = (v) => {
    const data = { ...v };
    ['annualQuota', 'maxCarryForward', 'creditDay', 'leaveYearStart', 'joinCutoffDay', 'sw_minDays', 'lateInformLop', 'timesPerCycle', 'maxHoursEach', 'maxHoursPerCycle'].forEach((k) => {
      if (data[k] !== '' && data[k] !== undefined) data[k] = Number(data[k]);
    });
    if (data.backdateBasis !== 'Days') data.backdateDays = '';
    if (data.unlimited) data.accrual = 'None';
    if (data.unit === 'Hours') {
      data.unlimited = false;
      data.accrual = 'Manual';
      data.annualQuota = 0;
    }
    if (editing.id) patchItem('leaveTypes', editing.id, data);
    else addItem('leaveTypes', data);
    setEditing(null);
    toast('Leave type saved');
  };

  return (
    <Card
      title="Leave types"
      pad={false}
      actions={
        <Btn icon="plus" onClick={() => setEditing({ ...NEW_TYPE })}>
          Add leave type
        </Btn>
      }
    >
      <DataTable
        pageSize={20}
        rows={db.leaveTypes}
        columns={[
          { key: 'name', label: 'Leave type', render: (t) => <span className="row"><span style={{ width: 10, height: 10, borderRadius: 5, background: t.color }} />{t.name}</span> },
          { key: 'code', label: 'Code' },
          { key: 'credit', label: 'Credit', sortable: false, render: creditSummary },
          { key: 'sandwich', label: 'Sandwich rule', sortable: false, render: sandwichSummary },
          { key: 'approval', label: 'Approval', sortable: false, render: (t) => (rulesOf(t).needsApproval ? 'Manager' : 'Automatic') },
          { key: 'active', label: 'Status', sortable: false, render: (t) => <Badge tone={rulesOf(t).active === false ? 'grey' : 'green'}>{rulesOf(t).active === false ? 'Inactive' : 'Active'}</Badge> },
          {
            key: '_a',
            label: '',
            sortable: false,
            align: 'right',
            render: (t) => (
              <span className="row-actions">
                <Btn kind="icon" icon="edit" title="Edit rules" aria-label={`Edit ${t.name}`} onClick={() => setEditing({ ...RULE_DEFAULTS, ...t, backdateBasis: basisOf({ ...RULE_DEFAULTS, ...t }) })} />
                <Btn kind="icon" icon="trash" title="Delete" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} />
              </span>
            ),
          },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add leave type'}
          wide
          fields={TYPE_FIELDS}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          validate={(v) => (db.leaveTypes.some((t) => t.id !== editing.id && t.code?.toLowerCase() === String(v.code).toLowerCase()) ? 'Another leave type already uses that code.' : '')}
          after={(v) => (
            <>
              {v.unit !== 'Hours' && <RuleTester db={db} rule={v} />}
              <div className="rule-summary">
                <h4 className="form-section">In plain words</h4>
                <ul className="rules">
                  {describeRules(v, db).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        />
      )}
    </Card>
  );
}

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
  const [viewEmp, setViewEmp] = useState(null); // an employee opened from the Balances list
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
  if (viewEmp) return <Leave user={db.employees.find((e) => e.id === viewEmp) || db.employees[0]} admin={user} onBack={() => setViewEmp(null)} />;
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
      <Tabs tabs={[{ key: 'requests', label: 'Leave requests' }, { key: 'balances', label: 'Balances' }, { key: 'types', label: 'Leave types' }, { key: 'holidays', label: 'Holidays' }, { key: 'adjust', label: 'Balances & grants' }, { key: 'compoff', label: 'Comp off requests' }]} active={tab} onChange={setTab} />
      {tab === 'requests' && (
        <Card pad={false}>
          <DataTable
            rows={[...db.leaveRequests].sort((a, b) => b.from.localeCompare(a.from))}
            pageSize={25}
            columns={[
              empCol(db),
              { key: 'typeId', label: 'Type', render: (r) => db.leaveTypes.find((t) => t.id === r.typeId)?.name },
              { key: 'from', label: 'Dates', render: (r) => (r.partial ? `${fmtDate(r.from)} · ${fmtTime(r.fromTime)} – ${fmtTime(r.toTime)}` : <DateRange from={r.from} to={r.to} />) },
              { key: 'days', label: 'Days', render: (r) => <span>{r.partial ? hm(minutesBetween(r.fromTime, r.toTime)) : r.days}{r.lopDays > 0 && <span className="muted"> ({r.lopDays} LOP)</span>}{(r.sandwichDates || []).length > 0 && <span className="muted"> incl. {r.sandwichDates.length} off day(s)</span>}</span> },
              { key: 'reason', label: 'Reason', render: (r) => <span>{r.reason}{r.certificateDue && <Badge tone="amber">Certificate due</Badge>}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
              { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col="leaveRequests" row={r} kind="Leave" /> },
            ]}
          />
        </Card>
      )}
      {tab === 'balances' && (
        <Card pad={false} actions={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('leave-balances', [{ label: 'Employee', csv: (e) => fullName(e) }, ...db.leaveTypes.filter((t) => !t.unlimited && rulesOf(t).active !== false).map((t) => ({ label: t.code, csv: (e) => leaveBalances(db, e.id).find((b) => b.type.id === t.id)?.available ?? '' }))], activeEmployees(db))}>Export</Btn>} title="Available balances">
          <DataTable
            rows={activeEmployees(db)}
            pageSize={30}
            onRowClick={(e) => setViewEmp(e.id)}
            columns={[
              { key: 'name', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} /> },
              ...db.leaveTypes.filter((t) => !t.unlimited && rulesOf(t).active !== false).map((t) => ({ key: t.id, label: t.code, sortable: false, render: (e) => leaveBalances(db, e.id).find((b) => b.type.id === t.id)?.available ?? '—' })),
              { key: 'open', label: '', sortable: false, render: () => <span className="muted">View leave</span> },
            ]}
          />
        </Card>
      )}
      {tab === 'types' && <LeaveTypes />}
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
          title="Leave balance grants & adjustments"
          collection="leaveAdjustments"
          addLabel="Add balance"
          defaults={{ date: todayISO() }}
          fields={[
            { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
            { key: 'typeId', label: 'Leave type', type: 'select', options: db.leaveTypes.filter((t) => !t.unlimited && !isHours(t)).map((t) => ({ value: t.id, label: `${t.name}${creditMode(t) === 'Manual' ? ' (added by HR)' : ''}` })), required: true, help: 'Comp off, maternity (90 days) and paternity balances are added here.' },
            { key: 'days', label: 'Days (+ to add, − to deduct)', type: 'number', required: true, step: 0.5 },
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'reason', label: 'Reason', full: true, required: true },
          ]}
          columns={[empCol(db), { key: 'typeId', label: 'Type', render: (a) => db.leaveTypes.find((t) => t.id === a.typeId)?.name }, { key: 'days', label: 'Days' }, { key: 'date', label: 'Date', render: (a) => fmtDate(a.date) }, { key: 'reason', label: 'Reason' }]}
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
const clock12 = (t) => fmtTime(t);
// Plain-words reading of the working day being edited, with the example from the policy.
function WorkingDaySummary({ db, s }) {
  const e = scheduleOfShift({ ...db, attendanceSettings: s }, { followsPolicy: true });
  const lateAfter = (() => {
    const [h, m] = (s.workStart || '09:00').split(':').map(Number);
    const x = h * 60 + m + Number(e.grace || 0);
    return clock12(`${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`);
  })();
  if (!s.workStart || !s.workEnd) return null;
  return (
    <div className="rule-summary">
      <h4 className="form-section">In plain words</h4>
      <ul className="rules">
        <li>
          The working day is {clock12(s.workStart)} to {clock12(s.workEnd)}: {hm(Math.round(e.requiredHours * 60))} {s.requiredHours ? 'needed (set above)' : 'in all'}.
        </li>
        <li>An employee is present when the time between the first punch-in and the last punch-out reaches {hm(Math.round(e.requiredHours * 60))}.</li>
        <li>If there is a punch but the day is not complete (fewer hours, only a punch-in, or only a punch-out), the day shows Action Required, not Absent. It is absent only when there is no punch-in and no punch-out.</li>
        <li>Starting and finishing times are flexible. Punching in after {lateAfter} adds a Late mark in the calendar, and the day stays present if the hours are met.</li>
        <li>A day with approved partial leave needs that many hours less. Times approved through a regularization request count as they are.</li>
        <li>A past day with a punch-in but no punch-out is {s.missingPunchOut === 'Present' ? 'marked present' : 'shown as Action Required until it is regularized'}.</li>
      </ul>
    </div>
  );
}

export function AttendanceAdmin({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('register');
  const [date, setDate] = useState(todayISO());
  // The register opens as the policy says (a whole attendance cycle by default) and can be switched.
  const [view, setView] = useState(db.attendanceSettings.registerView === 'Daily' ? 'day' : 'month');
  const [ym, setYm] = useState(cycleMonthOf(todayISO(), cycleStartOf(db)));
  const [onlyOpen, setOnlyOpen] = useState(false);
  // The attendance cycle is the same setting as the payroll cycle, so the two never disagree.
  const [settings, setSettings] = useState({ ...db.attendanceSettings, cycleStartDay: cycleStartOf(db) });
  const [mark, setMark] = useState(null);
  const [viewEmp, setViewEmp] = useState(null); // an employee opened from the register
  const otOn = !!db.attendanceSettings.overtimeEnabled;
  const savePolicy = () => {
    const { cycleStartDay, ...rest } = settings;
    update((d) => {
      d.attendanceSettings = rest;
      d.payrollSettings.cycleStartDay = Math.min(28, Math.max(1, Number(cycleStartDay) || 1));
    });
    toast('Policy saved');
  };
  // Day view: one date for everyone, with the remark for each unsettled day.
  const cycle = cycleRange(cycleMonthOf(date, cycleStartOf(db)), cycleStartOf(db));
  const openDays = (empId) => {
    const out = { update: 0, lop: 0, pending: 0 };
    for (let d = cycle[0]; d <= cycle[1] && d <= todayISO(); d = addDays(d, 1)) {
      const k = attendanceRemark(db, empId, d)?.kind;
      if (k) out[k] += 1;
    }
    return out;
  };
  const recs = view !== 'day' ? [] : activeEmployees(db)
    .filter((e) => e.dateOfJoining <= date && e.attendanceExempt !== 'Yes')
    .map((e) => ({ emp: e, rec: attendanceFor(db, e.id, date) }))
    .map((r) => ({ ...r, remark: attendanceRemark(db, r.emp.id, date, r.rec), open: openDays(r.emp.id) }));
  const count = (s) => recs.filter((r) => r.rec.status === s).length;
  const needUpdate = recs.filter((r) => r.remark?.kind === 'update').length;
  const lopDays = recs.filter((r) => r.remark?.kind === 'lop').length;
  // Month view: one attendance cycle, one row per employee.
  const [cFrom, cTo] = cycleRange(ym, cycleStartOf(db));
  const cEnd = cTo < todayISO() ? cTo : todayISO();
  const monthRows = view !== 'month' ? [] : activeEmployees(db)
    .filter((e) => e.dateOfJoining <= cEnd && e.attendanceExempt !== 'Yes')
    .map((emp) => {
      const o = { present: 0, wfh: 0, leave: 0, late: 0, update: 0, lop: 0, pending: 0 };
      for (let d = cFrom; d <= cEnd; d = addDays(d, 1)) {
        const rec = attendanceFor(db, emp.id, d);
        if (rec.status === 'Present') o.present += 1;
        else if (rec.status === 'WFH') o.wfh += 1;
        else if (rec.status === 'Leave') o.leave += 1;
        if (rec.late && ['Present', 'WFH'].includes(rec.status)) o.late += 1;
        const k = attendanceRemark(db, emp.id, d, rec)?.kind;
        if (k) o[k] += 1;
      }
      return { emp, ...o, open: o.update + o.lop + o.pending };
    });
  const shownMonth = onlyOpen ? monthRows.filter((r) => r.open > 0) : monthRows;
  const sum = (k) => monthRows.reduce((t, r) => t + r[k], 0);
  if (viewEmp) return <Attendance user={db.employees.find((e) => e.id === viewEmp) || db.employees[0]} admin={user} onBack={() => setViewEmp(null)} />;
  return (
    <div>
      <PageHead title="Attendance settings" />
      <Tabs tabs={[{ key: 'register', label: 'Attendance register' }, { key: 'requests', label: 'Requests' }, ...(otOn ? [{ key: 'overtime', label: 'Overtime' }] : []), { key: 'shifts', label: 'Shifts' }, { key: 'policy', label: 'Policy' }]} active={tab} onChange={setTab} />
      {tab === 'register' && (
        <div className="stack">
          <div className="row between">
            <div className="row">
              <select className="select-sm" value={view} onChange={(e) => setView(e.target.value)} aria-label="Register view">
                <option value="month">Monthly (attendance cycle)</option>
                <option value="day">Daily</option>
              </select>
              {view === 'day' ? (
                <>
                  <Btn kind="ghost" small icon="chevronLeft" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))} />
                  <input type="date" className="input-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                  <Btn kind="ghost" small icon="chevronRight" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} />
                </>
              ) : (
                <>
                  <MonthPicker ym={ym} setYm={setYm} />
                  <label className="row" style={{ gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only people with days to update
                  </label>
                </>
              )}
            </div>
            {view === 'day' ? (
            <Btn kind="ghost" icon="download" onClick={() => exportCSV(`attendance-${date}`, [{ label: 'Employee', csv: (r) => fullName(r.emp) }, { label: 'Status', csv: (r) => r.rec.status }, { label: 'In', csv: (r) => r.rec.clockIn }, { label: 'Out', csv: (r) => r.rec.clockOut }, { label: 'Remark', csv: (r) => r.remark?.text || '' }, { label: 'Open days this cycle', csv: (r) => r.open.update + r.open.lop + r.open.pending }], recs)}>Export</Btn>
            ) : (
              <Btn kind="ghost" icon="download" onClick={() => exportCSV(`attendance-register-${ym}`, [{ label: 'Employee', csv: (r) => fullName(r.emp) }, { label: 'Present', csv: (r) => r.present }, { label: 'WFH', csv: (r) => r.wfh }, { label: 'Leave', csv: (r) => r.leave }, { label: 'Late', csv: (r) => r.late }, { label: 'To update', csv: (r) => r.update }, { label: 'LOP (no balance)', csv: (r) => r.lop }, { label: 'Waiting for approval', csv: (r) => r.pending }], shownMonth)}>Export</Btn>
            )}
          </div>
          {view === 'day' ? (
            <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <Stat label="Present" value={count('Present')} tone="green" />
            <Stat label="Work from home" value={count('WFH')} tone="brand" />
            <Stat label="On leave" value={count('Leave')} tone="amber" />
            <Stat label="Employee to update" value={needUpdate} tone={needUpdate ? 'amber' : undefined} sub="Action Required, or absent with leave balance" />
            <Stat label="Absent with no balance" value={lopDays} tone={lopDays ? 'red' : undefined} sub="Counts as Loss of Pay" />
          </div>
          <Card pad={false}>
            <DataTable
              rows={recs}
              rowKey={(r) => r.emp.id}
              pageSize={30}
              onRowClick={(r) => setViewEmp(r.emp.id)}
              columns={[
                { key: 'emp', label: 'Employee', sortValue: (r) => fullName(r.emp), render: (r) => <EmpChip emp={r.emp} /> },
                { key: 'status', label: 'Status', sortValue: (r) => r.rec.status, render: (r) => (r.rec.status ? <Badge>{r.rec.status}</Badge> : '—') },
                { key: 'in', label: 'In', sortable: false, render: (r) => fmtTime(r.rec.clockIn) },
                { key: 'out', label: 'Out', sortable: false, render: (r) => fmtTime(r.rec.clockOut) },
                { key: 'hrs', label: 'Hours', sortable: false, render: (r) => (r.rec.clockIn && r.rec.clockOut ? hm(minutesBetween(r.rec.clockIn, r.rec.clockOut)) : '—') },
                { key: 'arr', label: 'Arrival', sortable: false, render: (r) => [arrival(r.rec), r.rec.note].filter(Boolean).join(' · ') || '—' },
                { key: 'remark', label: 'Remark for HR', sortValue: (r) => r.remark?.kind || '', render: (r) => (r.remark ? <span><Badge tone={r.remark.tone}>{r.remark.kind === 'lop' ? 'LOP' : r.remark.kind === 'pending' ? 'Pending' : 'Update needed'}</Badge> <span className="muted" style={{ fontSize: 12.5 }}>{r.remark.text}</span></span> : '—') },
                { key: 'open', label: 'Open this cycle', sortValue: (r) => r.open.update + r.open.lop + r.open.pending, render: (r) => { const n = r.open.update + r.open.lop + r.open.pending; return n ? <span title="Days in this cycle still showing Action Required or Absent">{n} day{n === 1 ? '' : 's'}{r.open.lop ? <span className="muted"> ({r.open.lop} LOP)</span> : ''}</span> : '—'; } },
                { key: 'act', label: '', sortable: false, render: (r) => <Btn kind="ghost" small onClick={(e) => { e.stopPropagation(); setMark({ emp: r.emp, forcePresent: !!r.rec.forcePresent, clockIn: r.rec.clockIn || r.rec.shift.start, clockOut: r.rec.clockOut || r.rec.shift.end }); }}>Edit</Btn> },
              ]}
            />
          </Card>
            </>
          ) : (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <Stat label="Employees" value={monthRows.length} sub={`${cFrom.slice(8)}/${cFrom.slice(5, 7)} to ${cEnd.slice(8)}/${cEnd.slice(5, 7)}`} />
                <Stat label="Days to update" value={sum('update')} tone={sum('update') ? 'amber' : undefined} sub={`${monthRows.filter((r) => r.update).length} people need to regularize or apply leave`} />
                <Stat label="Absent with no balance" value={sum('lop')} tone={sum('lop') ? 'red' : undefined} sub="Days that count as Loss of Pay" />
                <Stat label="Waiting for approval" value={sum('pending')} tone={sum('pending') ? 'brand' : undefined} sub="Leave or regularization requests" />
                <Stat label="Late arrivals" value={sum('late')} />
              </div>
              <Card pad={false} title={`${monthLabel(ym)} · ${cycleLabel(ym, cycleStartOf(db))}`}>
                <DataTable
                  rows={shownMonth}
                  rowKey={(r) => r.emp.id}
                  pageSize={30}
                  empty={onlyOpen ? 'No one has days to update in this cycle.' : 'No employees.'}
                  onRowClick={(r) => setViewEmp(r.emp.id)}
                  columns={[
                    { key: 'emp', label: 'Employee', sortValue: (r) => fullName(r.emp), render: (r) => <EmpChip emp={r.emp} /> },
                    { key: 'present', label: 'Present', sortValue: (r) => r.present, render: (r) => r.present },
                    { key: 'wfh', label: 'WFH', sortValue: (r) => r.wfh, render: (r) => r.wfh },
                    { key: 'leave', label: 'Leave', sortValue: (r) => r.leave, render: (r) => r.leave },
                    { key: 'late', label: 'Late', sortValue: (r) => r.late, render: (r) => r.late },
                    { key: 'update', label: 'To update', sortValue: (r) => r.update, render: (r) => (r.update ? <Badge tone="amber">{r.update} day{r.update === 1 ? '' : 's'}</Badge> : '—') },
                    { key: 'lop', label: 'LOP (no balance)', sortValue: (r) => r.lop, render: (r) => (r.lop ? <Badge tone="red">{r.lop} day{r.lop === 1 ? '' : 's'}</Badge> : '—') },
                    { key: 'pending', label: 'Waiting', sortValue: (r) => r.pending, render: (r) => (r.pending ? <Badge tone="blue">{r.pending} day{r.pending === 1 ? '' : 's'}</Badge> : '—') },
                    { key: 'open', label: '', sortable: false, render: () => <span className="muted">View days</span> },
                  ]}
                />
              </Card>
            </>
          )}
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
      {tab === 'overtime' && otOn && (
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
          defaults={{ grace: 15, breakMinutes: 60, fullDayHours: 8, halfDayHours: 4, followsPolicy: false }}
          fields={[
            { key: 'name', label: 'Shift name', required: true, full: true },
            { key: 'followsPolicy', label: 'Use the working day from the Policy tab', type: 'checkbox', full: true },
            { key: 'start', label: 'Starts', type: 'time', required: true, show: (v) => !v.followsPolicy },
            { key: 'end', label: 'Ends', type: 'time', required: true, show: (v) => !v.followsPolicy },
            { key: 'grace', label: 'Late after (minutes past the start)', type: 'number', show: (v) => !v.followsPolicy },
            { key: 'requiredHours', label: 'Hours needed for a present day', type: 'number', step: 0.25, show: (v) => !v.followsPolicy, help: 'Leave blank to use the whole shift, from start to end.' },
            { key: 'breakMinutes', label: 'Break (minutes)', type: 'number' },
          ]}
          columns={[{ key: 'name', label: 'Shift' }, { key: 'start', label: 'Timing', render: (s) => { const e = scheduleOfShift(db, s); return `${fmtTime(e.start)} – ${fmtTime(e.end)}${e.followsPolicy ? ' (company working day)' : ''}`; } }, { key: 'hours', label: 'Hours needed', sortable: false, render: (s) => { const e = scheduleOfShift(db, s); return e.ruleOn ? hm(Math.round(e.requiredHours * 60)) : 'Not applied'; } }, { key: 'grace', label: 'Late after', render: (s) => `${scheduleOfShift(db, s).grace} min` }, { key: 'breakMinutes', label: 'Break', render: (s) => `${s.breakMinutes} min` }, { key: 'people', label: 'People', sortable: false, render: (s) => db.employees.filter((e) => e.shiftId === s.id && e.status !== 'Exited').length }]}
        />
      )}
      {tab === 'policy' && (
        <Card title="Attendance policy" actions={<Btn onClick={savePolicy}>Save</Btn>}>
          <FormGrid
            db={db}
            values={settings}
            setValues={setSettings}
            fields={[
              { key: 'hoursRuleEnabled', label: 'Mark each day present or absent by the hours worked', type: 'checkbox', full: true, section: 'Working day' },
              { key: 'workStart', label: 'Day starts at', type: 'time', show: (v) => v.hoursRuleEnabled },
              { key: 'workEnd', label: 'Day ends at', type: 'time', show: (v) => v.hoursRuleEnabled },
              { key: 'requiredHours', label: 'Hours needed for a present day', type: 'number', step: 0.25, min: 0, show: (v) => v.hoursRuleEnabled, help: 'Leave blank to use the whole day, from the start time to the end time.' },
              { key: 'graceMinutes', label: 'Late after (minutes past the start time)', type: 'number', min: 0, show: (v) => v.hoursRuleEnabled, help: 'Arriving later than this adds a Late mark. The day is still present if the hours are met.' },
              { key: 'missingPunchOut', label: 'A past day with a punch-in but no punch-out', type: 'select', options: [{ value: 'Action required', label: 'Show Action Required (until it is regularized)' }, { value: 'Present', label: 'Mark present' }], show: (v) => v.hoursRuleEnabled },
              { key: 'registerView', label: 'The attendance register opens as', type: 'select', options: [{ value: 'Monthly', label: 'Monthly: one attendance cycle, a row per employee' }, { value: 'Daily', label: 'Daily: one date for everyone' }], section: 'Attendance register', full: true, help: 'You can still switch between the two views on the register itself.' },
              { key: 'regularizeLimit', label: 'Regularizations allowed per employee in each attendance cycle', type: 'number', min: 0, section: 'Regularization', full: true, help: 'Each request to fix a day (pending or approved) uses one. Rejected and cancelled requests give it back. Leave blank for no limit. HR can still correct any day directly from the attendance register.' },
              { key: 'regularizeWithinDays', label: 'Only days from the last (N) days can be regularized', type: 'number', min: 0, full: true, help: 'Leave blank to allow any past day in the current cycle.' },
              { key: 'lockPastCycles', label: 'Employees can fix only the current attendance cycle (earlier cycles are locked)', type: 'checkbox', full: true, help: 'Applies to regularization and to leave applied from the attendance log. HR can still correct any day from the attendance register.' },
              { key: 'cycleStartDay', label: 'Attendance cycle starts on day', type: 'number', min: 1, max: 28, section: 'Attendance cycle', help: '26 means each cycle runs from the 26th of one month to the 25th of the next, and the calendar shows it that way. Payroll uses the same cycle. Use 1 for calendar months.' },
              { key: 'allowWebClockIn', label: 'Allow web clock-in', type: 'checkbox', section: 'Clock-in' },
              { key: 'allowRemote', label: 'Allow remote clock-in', type: 'checkbox' },
              { key: 'autoClockOutHours', label: 'Auto clock-out after (hours)', type: 'number' },
              { key: 'lateMarksForHalfDay', label: 'Late marks that make a half-day deduction', type: 'number' },
              { key: 'overtimeEnabled', label: 'Overtime applies (off by default: the company pays no overtime)', type: 'checkbox', full: true, section: 'Overtime' },
              { key: 'overtimeAfterHours', label: 'Overtime after (hours/day)', type: 'number', show: (v) => v.overtimeEnabled },
              { key: 'overtimeRate', label: 'Overtime pay multiplier', type: 'number', step: 0.25, show: (v) => v.overtimeEnabled },
            ]}
          />
          {settings.hoursRuleEnabled && <WorkingDaySummary db={db} s={settings} />}
        </Card>
      )}
      {mark && (
        <FormModal
          title={`Edit attendance — ${fullName(mark.emp)} — ${fmtDate(date)}`}
          fields={[
            { key: 'clockIn', label: 'Clock in', type: 'time' },
            { key: 'clockOut', label: 'Clock out', type: 'time' },
            { key: 'wfh', label: 'Work from home', type: 'checkbox' },
            { key: 'forcePresent', label: 'Mark present even if the hours are short', type: 'checkbox', full: true },
            { key: 'note', label: 'Note', full: true },
          ]}
          initial={mark}
          onClose={() => setMark(null)}
          onSave={(v) => {
            update((d) => {
              const a = d.attendance.find((x) => x.empId === mark.emp.id && x.date === date);
              const data = { clockIn: v.clockIn || '', clockOut: v.clockOut || '', wfh: !!v.wfh, forcePresent: !!v.forcePresent, note: v.note || '', source: 'HR edit' };
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
