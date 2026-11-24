// Leave rules engine: how a leave type credits balance, how a request's days are counted
// (including the sandwich rule) and the checks each leave type can enforce.
// Every rule is a field on the leave type, so HR changes them in Leave settings.
// Pure functions with no React, so the examples in the policy can be tested in Node.
import { parseISO, addDays, addMonths, daysInMonth, pad, todayISO, empById, isHoliday, isWeeklyOff, minutesBetween, scheduleFor, attendanceFor, cycleStartOf, cycleMonthOf, cycleRange, cycleLabel } from './utils.js';

// ---------- rule fields and their defaults ----------
export const RULE_DEFAULTS = {
  active: true,
  // credit
  creditDay: 26, // day of month the credit lands; 0 means the last day of the month
  eligibleAfter: 'Joining', // 'Joining' | 'Probation end': balance can be used only from this date
  accrueFrom: 'Joining date', // 'Joining date' | 'Eligibility date': credits count from this date
  joinCutoffDay: 0, // joiners after this day of the month start accruing next month (0 = off)
  leaveYearStart: 1, // month the leave year starts (1 = January)
  allowEmployeeRequest: false, // manual balances (comp off): employees may raise a request
  // applying
  needsApproval: true,
  allowPartial: true,
  backdateBasis: '', // 'Days' | 'Cycle' | 'None'; '' = work it out from backdateDays (older saved types)
  backdateDays: '', // with basis 'Days': latest an application may be made after the leave ended
  backdateAction: 'Convert to LOP', // or 'Block'
  cutoffTime: '', // same-day leave must be informed by this time ('' = no rule)
  lateInformLop: 0.5, // days of the leave turned into LOP when informed after the cut-off
  certificateAfterDays: '', // medical certificate needed beyond this many days ('' = never)
  certificateEnforce: false, // block submission without an attachment instead of only flagging it
  insufficientAction: 'Block', // or 'Convert excess to LOP'
  noCombineWith: [], // leave types that may not sit directly next to this one
  combineAction: 'Convert to LOP', // or 'Block'
  // sandwich: weekly offs and holidays inside a request count as leave
  sw_enabled: false,
  sw_scope: 'Whole request', // or 'Between leave days only'
  sw_basis: 'Working days', // or 'Calendar days': what is compared with the minimum
  sw_minDays: 2, // counted only when leave taken is MORE than this
  sw_weeklyOffs: true,
  sw_holidays: true,
  sw_holidayBlock: 'Count', // or 'Skip the block': a weekend block that includes a holiday is not counted
  sw_edges: false, // also count weekly offs / holidays directly before or after the request
  sw_merge: true, // treat separate requests joined only by weekly offs / holidays as one
};
export const rulesOf = (t) => ({ ...RULE_DEFAULTS, ...(t || {}) });

// How late an application may be made, as set on the leave type:
//   days  -> within N days after the last day of the leave
//   cycle -> until the end of the attendance cycle that last day falls in (26 Oct - 25 Nov, however long the month)
//   none  -> no limit
export function backdateRule(r) {
  const days = r.backdateDays === '' || r.backdateDays == null || Number.isNaN(Number(r.backdateDays)) ? null : Number(r.backdateDays);
  const basis = r.backdateBasis || (days !== null ? 'Days' : 'None');
  if (basis === 'Cycle') return { mode: 'cycle', days: null };
  if (basis === 'Days' && days !== null) return { mode: 'days', days };
  return { mode: 'none', days: null };
}

const num = (x) => (x === '' || x === undefined || x === null || Number.isNaN(Number(x)) ? null : Number(x));
const on = (x) => x === true || x === 'true' || x === 'Yes';
const round2 = (n) => Math.round(n * 100) / 100;
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
const short = (d) => parseISO(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// A leave type counted in hours (a permission): taken with a From and To time, and limited by how
// many times (and optionally how many hours) it may be used in one attendance cycle.
export const isHours = (t) => t?.unit === 'Hours';
const hoursOf = (r) => Math.max(0, minutesBetween(r.fromTime, r.toTime)) / 60;
// What one employee has used of an hours-based type in the attendance cycle that contains `date`.
export function hoursUsage(db, empId, t, date) {
  const sd = cycleStartOf(db);
  const ym = cycleMonthOf(date, sd);
  const [from, to] = cycleRange(ym, sd);
  const mine = db.leaveRequests.filter((r) => r.empId === empId && r.typeId === t.id && r.partial && r.from >= from && r.from <= to);
  const of = (st) => mine.filter((r) => r.status === st);
  const sum = (l) => l.reduce((s, r) => s + hoursOf(r), 0);
  const used = [...of('Approved'), ...of('Pending')];
  return { ym, from, to, taken: of('Approved').length, pending: of('Pending').length, times: used.length, hours: round2(sum(used)) };
}

export const creditMode = (t) => (['Monthly', 'Quarterly', 'Yearly'].includes(t?.accrual) ? t.accrual : t?.accrual === undefined ? 'Yearly' : 'Manual');
export const isManual = (t) => !t?.unlimited && creditMode(t) === 'Manual';

// ---------- calendar kinds ----------
const kindOf = (db, emp, d) => (isWeeklyOff(emp, d) ? 'off' : isHoliday(db, d) ? 'holiday' : 'work');
function listDays(db, emp, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, kind: kindOf(db, emp, d) });
  return out;
}
// True when every day strictly between a and b is a weekly off or holiday.
function onlyOffBetween(db, emp, a, b) {
  for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (kindOf(db, emp, d) === 'work') return false;
  return true;
}
function adjacent(db, emp, r, a, b) {
  if (r.to < a) return onlyOffBetween(db, emp, r.to, a);
  if (r.from > b) return onlyOffBetween(db, emp, b, r.from);
  return false;
}
const wholeDayRequests = (db, empId, filter) =>
  db.leaveRequests.filter((r) => r.empId === empId && ['Pending', 'Approved'].includes(r.status) && !r.partial && !r.optionalHoliday && filter(r));

// ---------- day counting ----------
// Counts the days one request uses. `ctx` carries earlier requests that merge into it.
export function countRange(db, emp, rule, from, to, fromHalf, toHalf, ctx = {}) {
  const r = rulesOf(rule);
  const mine = listDays(db, emp, from, to);
  let work = mine.filter((x) => x.kind === 'work').length;
  const kf = mine[0]?.kind;
  const kt = mine[mine.length - 1]?.kind;
  if (work > 0 && fromHalf && fromHalf !== 'Full day' && kf === 'work') work -= 0.5;
  if (work > 0 && to !== from && toHalf && toHalf !== 'Full day' && kt === 'work') work -= 0.5;

  const spanFrom = ctx.spanFrom || from;
  const spanTo = ctx.spanTo || to;
  const prior = new Set(ctx.priorSandwich || []);
  let extra = [];
  let triggered = false;
  let metric = work;
  if (on(r.sw_enabled)) {
    const all = listDays(db, emp, spanFrom, spanTo);
    const W = work + (ctx.priorWork || 0);
    metric = r.sw_basis === 'Calendar days' ? daysBetween(spanFrom, spanTo) + 1 : W;
    triggered = metric > (num(r.sw_minDays) ?? 0);
    if (triggered) {
      const blocks = [];
      let cur = [];
      all.forEach((x) => {
        if (x.kind === 'work') {
          if (cur.length) blocks.push(cur);
          cur = [];
        } else cur.push(x);
      });
      if (cur.length) blocks.push(cur);
      let kept = blocks;
      if (r.sw_scope === 'Between leave days only') {
        const firstWork = all.findIndex((x) => x.kind === 'work');
        const lastWork = all.map((x) => x.kind).lastIndexOf('work');
        kept = blocks.filter((b) => {
          const i = all.indexOf(b[0]);
          const j = all.indexOf(b[b.length - 1]);
          return firstWork >= 0 && i > firstWork && j < lastWork;
        });
      }
      if (on(r.sw_edges)) {
        const before = [];
        for (let d = addDays(spanFrom, -1); kindOf(db, emp, d) !== 'work'; d = addDays(d, -1)) before.unshift({ date: d, kind: kindOf(db, emp, d) });
        const after = [];
        for (let d = addDays(spanTo, 1); kindOf(db, emp, d) !== 'work'; d = addDays(d, 1)) after.push({ date: d, kind: kindOf(db, emp, d) });
        // Only attach when the request itself starts / ends on a working day.
        if (before.length && all[0].kind === 'work') kept = [...kept, before];
        if (after.length && all[all.length - 1].kind === 'work') kept = [...kept, after];
      }
      kept.forEach((b) => {
        if (r.sw_holidayBlock === 'Skip the block' && b.some((x) => x.kind === 'holiday')) return;
        b.forEach((x) => {
          if ((x.kind === 'off' && on(r.sw_weeklyOffs)) || (x.kind === 'holiday' && on(r.sw_holidays))) extra.push(x.date);
        });
      });
      extra = extra.filter((d) => !prior.has(d));
    }
  }
  return { workDays: work, extraDates: extra, days: work + extra.length, triggered, metric };
}

// ---------- credit and balances ----------
export const leaveYearOf = (t, date) => {
  const sm = Number(t?.leaveYearStart) || 1;
  const [y, m] = date.split('-').map(Number);
  return m >= sm ? y : y - 1;
};
export function leavePeriod(t, startYear) {
  const sm = Number(t?.leaveYearStart) || 1;
  const from = `${startYear}-${pad(sm)}-01`;
  return { from, to: addDays(`${addMonths(`${startYear}-${pad(sm)}`, 12)}-01`, -1), startYm: `${startYear}-${pad(sm)}` };
}

export function creditInfo(emp, t, asOf = todayISO(), startYear) {
  const r = rulesOf(t);
  const period = leavePeriod(t, startYear ?? leaveYearOf(t, asOf));
  const mode = creditMode(t);
  const annual = Number(t.annualQuota || 0);
  const doj = emp?.dateOfJoining || '1900-01-01';
  const eligibleDate = r.eligibleAfter === 'Probation end' ? emp?.probationEndDate || doj : doj;
  const base = { period, annual, eligibleDate, eligible: asOf >= eligibleDate, credited: 0, perCredit: 0, nextCredit: '' };
  if (t.unlimited || mode === 'Manual') return { ...base, eligible: true };
  const accrueStart = r.accrueFrom === 'Eligibility date' ? eligibleDate : doj;
  const cd = Number(r.creditDay) || 0;
  const cutoff = num(r.joinCutoffDay) ?? 0;
  const dateIn = (ym) => `${ym}-${pad(cd === 0 ? daysInMonth(ym) : Math.min(cd, daysInMonth(ym)))}`;
  const counts = (date) => {
    if (cutoff > 0) {
      const a = accrueStart.slice(0, 7);
      const c = date.slice(0, 7);
      return c > a || (c === a && Number(accrueStart.slice(8)) <= cutoff);
    }
    return date >= accrueStart;
  };
  let dates = [];
  let per = 0;
  if (mode === 'Monthly') {
    per = annual / 12;
    for (let i = 0; i < 12; i++) dates.push(dateIn(addMonths(period.startYm, i)));
  } else if (mode === 'Quarterly') {
    per = annual / 4;
    for (let i = 0; i < 12; i += 3) dates.push(dateIn(addMonths(period.startYm, i)));
  } else {
    per = annual;
    dates = [period.from];
  }
  const ok = dates.filter((d) => (mode === 'Yearly' ? accrueStart <= period.to : counts(d)));
  const earned = ok.filter((d) => d <= asOf);
  const nextCredit = base.eligible ? ok.find((d) => d > asOf) || '' : '';
  return { ...base, perCredit: round2(per), credited: base.eligible ? round2(per * earned.length) : 0, nextCredit };
}

// Balance of each leave type for one employee. `asOf` is the date credits are counted to.
export function leaveBalances(db, empId, year, asOf = todayISO(), includeInactive = false) {
  const emp = empById(db, empId);
  return db.leaveTypes
    .filter((t) => (includeInactive || rulesOf(t).active !== false) && (!t.gender || t.gender === 'All' || !emp || t.gender === emp.gender))
    .map((t) => {
      if (isHours(t)) {
        // Counted in times per attendance cycle, not in days.
        const u = hoursUsage(db, empId, t, asOf);
        const limit = num(t.timesPerCycle);
        return { type: t, rules: rulesOf(t), unit: 'Hours', manual: false, eligible: true, eligibleDate: '', period: { from: u.from, to: u.to }, annual: 0, credited: 0, perCredit: 0, nextCredit: '', carry: 0, adj: 0, quota: limit ?? 0, taken: u.taken, pending: u.pending, hoursUsed: u.hours, ym: u.ym, available: limit === null ? Infinity : Math.max(0, limit - u.times) };
      }
      const manual = isManual(t);
      const ci = creditInfo(emp, t, asOf, year);
      const inPeriod = (d) => manual || (d >= ci.period.from && d <= ci.period.to);
      const mine = db.leaveRequests.filter((r) => r.empId === empId && inPeriod(r.from));
      const used = (status) =>
        t.unlimited
          ? mine.reduce((s, r) => s + (r.status !== status ? 0 : r.typeId === t.id ? Number(r.days || 0) : Number(r.lopDays || 0)), 0)
          : mine.filter((r) => r.typeId === t.id && r.status === status).reduce((s, r) => s + Number(r.days || 0) - Number(r.lopDays || 0), 0);
      const taken = used('Approved');
      const pending = used('Pending');
      const adj = (db.leaveAdjustments || []).filter((a) => a.empId === empId && a.typeId === t.id).reduce((s, a) => s + Number(a.days || 0), 0);
      const carry = Number((emp?.carryForward || {})[t.id] || 0);
      const quota = round2(ci.credited + carry + adj);
      return { type: t, rules: rulesOf(t), ...ci, manual, carry, adj, quota, taken, pending, available: t.unlimited ? Infinity : round2(quota - taken - pending) };
    });
}

// ---------- what HR should know about an unsettled day ----------
// Leave that does not stand in for a missing day: maternity and paternity are for those events
// only, and Loss of Pay is not a balance.
const NOT_A_FALLBACK = ['ML', 'PTL'];

// For a day showing Action Required or Absent: what HR should do about it.
//   Action Required -> the employee must update the log (regularize or apply leave)
//   Absent          -> with a leave balance (other than maternity / paternity) the employee must
//                      update the log; with none the day counts as Loss of Pay
//   a request already waiting for approval is shown as such
// Returns null for a day that needs nothing. kind: 'update' | 'lop' | 'pending'.
export function attendanceRemark(db, empId, date, recIn) {
  const rec = recIn || attendanceFor(db, empId, date);
  if (!['Action Required', 'Absent'].includes(rec.status)) return null;
  const waiting = rec.pendingLeave
    ? 'leave'
    : db.leaveRequests.some((r) => r.empId === empId && r.partial && r.status === 'Pending' && r.from === date)
      ? 'partial leave'
      : (db.attendanceRequests || []).some((r) => r.empId === empId && r.type === 'Regularization' && r.status === 'Pending' && r.date === date)
        ? 'regularization'
        : '';
  if (waiting) return { kind: 'pending', tone: 'blue', text: `Waiting for approval of the ${waiting}` };
  if (rec.status === 'Action Required') {
    return { kind: 'update', tone: 'amber', text: `Employee needs to update this day${rec.note ? ` (${rec.note})` : ''}: regularize or apply leave` };
  }
  const have = leaveBalances(db, empId, undefined, date)
    .filter((b) => !b.type.unlimited && b.unit !== 'Hours' && !NOT_A_FALLBACK.includes(b.type.code) && b.eligible !== false && b.available > 0)
    .map((b) => ({ code: b.type.code, available: b.available }));
  if (have.length) {
    return { kind: 'update', tone: 'amber', text: `Has leave balance (${have.map((b) => `${b.code} ${b.available}`).join(', ')}): employee needs to apply leave or regularize`, balances: have };
  }
  return { kind: 'lop', tone: 'red', text: 'No leave balance: counts as Loss of Pay' };
}

// ---------- sample data ----------
// Takes away all of one employee's leave: their requests, their carried-forward days and the balance
// credited so far (as a negative adjustment, which HR can see and undo under Balances & grants).
// It also leaves a few recent working days without any punch, so the attendance register shows
// how an absent day with no leave balance looks.
export function removeLeaveFor(db, empId, absentDays = 3) {
  const emp = empById(db, empId);
  if (!emp) return db;
  db.leaveRequests = db.leaveRequests.filter((r) => r.empId !== empId);
  db.leaveAdjustments = (db.leaveAdjustments || []).filter((a) => a.empId !== empId);
  emp.carryForward = {};
  const today = todayISO();
  leaveBalances(db, empId, undefined, today, true)
    .filter((b) => !b.type.unlimited && b.unit !== 'Hours' && b.credited > 0)
    .forEach((b) => db.leaveAdjustments.push({ id: `adj_${empId}_${b.type.id}`, empId, typeId: b.type.id, days: -b.credited, date: today, reason: 'All leave removed (sample data)' }));
  let n = 0;
  for (let d = addDays(today, -2); n < absentDays && d > addDays(today, -20); d = addDays(d, -1)) {
    if (isWeeklyOff(emp, d) || isHoliday(db, d) || d < emp.dateOfJoining) continue;
    db.attendance = db.attendance.filter((a) => !(a.empId === empId && a.date === d));
    db.attendance.push({ id: `att_${empId}_${d}`, empId, date: d, clockIn: '', clockOut: '' }); // no punch at all: Absent
    n += 1;
  }
  return db;
}

// Sample data: a year of believable leave for one employee, so the Leave page charts have something
// to show. Casual, sick and privilege leave spread over the months (one half day), two permissions,
// and one request still waiting for approval. Safe to run again: it replaces its own rows.
export function sampleLeaveFor(db, empId) {
  const emp = empById(db, empId);
  if (!emp) return db;
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const working = (d) => {
    let x = d;
    while (isWeeklyOff(emp, x) || isHoliday(db, x)) x = addDays(x, 1);
    return x;
  };
  const day = (mm, dd) => working(`${year}-${pad(mm)}-${pad(dd)}`);
  const full = scheduleFor(db, emp).requiredHours || 9.5;
  const mk = (n, typeId, from, to, days, status, reason, extra = {}) => ({ id: `smp_${empId}_${n}`, empId, typeId, from, to, fromHalf: 'Full day', toHalf: 'Full day', days, workDays: days, sandwichDates: [], lopDays: 0, certificateDue: false, status, reason, appliedOn: addDays(from, -3), approverComment: status === 'Approved' ? 'Approved' : '', notify: '', ...extra });
  const rows = [];
  const add = (typeId, mm, dd, span, reason, extra) => {
    const from = day(mm, dd);
    const to = span > 1 ? working(addDays(from, span - 1)) : from;
    if (to >= addDays(today, -1)) return; // only days that have passed
    rows.push(mk(rows.length + 1, typeId, from, to, span, 'Approved', reason, extra));
  };
  add('lt1', 2, 13, 1, 'Family function');
  add('lt2', 3, 27, 1, 'Fever');
  add('lt2', 4, 6, 2, 'Viral infection');
  add('lt1', 5, 8, 1, 'Personal work');
  add('lt1', 6, 19, 1, 'Long weekend trip');
  add('lt1', 8, 14, 1, 'Bank work');
  add('lt3', 9, 14, 3, 'Annual vacation');
  add('lt2', 10, 9, 1, 'Doctor appointment', { fromHalf: 'Second half', days: 0.5, workDays: 0.5 });
  add('lt1', 11, 13, 1, 'Personal work');
  // two permissions in hours: one in the current attendance cycle, one in the one before
  const perm = db.leaveTypes.find((t) => t.code === 'PRM');
  if (perm) {
    const hour = (n, date, a, b) => rows.push(mk(100 + n, perm.id, date, date, Math.round(((minutesBetween(a, b) / 60) / full) * 100) / 100, 'Approved', 'Permission', { partial: true, fromTime: a, toTime: b }));
    hour(1, working(addDays(today, -9)), '16:30', '17:30');
    hour(2, working(addDays(today, -40)), '10:00', '11:30');
  }
  // one request still waiting for the manager
  let from = working(addDays(today, 4));
  const to = isWeeklyOff(emp, addDays(from, 1)) || isHoliday(db, addDays(from, 1)) ? from : addDays(from, 1);
  rows.push(mk(200, 'lt3', from, to, to === from ? 1 : 2, 'Pending', 'Visiting family', { appliedOn: today }));
  db.leaveRequests = db.leaveRequests.filter((r) => !String(r.id).startsWith(`smp_${empId}_`));
  db.leaveRequests.push(...rows);
  return db;
}

// ---------- applying for leave ----------
const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Works out one request: days, what is turned into LOP, the status and any error.
// v: { typeId, from, to, fromHalf, toHalf, partial, fromTime, toTime, attachment }
export function evaluateLeave(db, emp, v, opts = {}) {
  const t = db.leaveTypes.find((x) => x.id === v.typeId);
  const fail = (error) => ({ ok: false, error, days: 0, workDays: 0, sandwichDates: [], lopDays: 0, notes: [] });
  if (!t) return fail('Choose a leave type.');
  if (!v.from) return fail('Pick the dates.');
  const r = rulesOf(t);
  const today = opts.today || todayISO();
  const time = opts.time || nowTime();
  const admin = !!opts.byAdmin;
  const hoursType = isHours(t);
  if (hoursType && !v.partial) return fail(`${t.name} is taken in hours. Enter the From and To time.`);
  const to = v.partial ? v.from : v.to;
  if (!to) return fail('Pick the dates.');
  if (to < v.from) return fail('The end date is before the start date.');
  const notes = [];
  let days = 0;
  let workDays = 0;
  let sandwichDates = [];
  let spanNote = '';

  if (v.partial) {
    if (!hoursType && !on(r.allowPartial)) return fail(`Partial-day leave is not allowed for ${t.name}.`);
    if (!v.fromTime || !v.toTime) return fail('Enter the From and To time.');
    const mins = minutesBetween(v.fromTime, v.toTime);
    if (mins <= 0) return fail('The To time must be after the From time.');
    const full = scheduleFor(db, emp).requiredHours || 8; // a full day is the working day set in Attendance policy
    if (kindOf(db, emp, v.from) !== 'work') return fail('That date is a weekly off or holiday.');
    if (mins / 60 > full) return fail(`That is more than a full day (${full} hours). Apply for a full day instead.`);
    days = round2(mins / 60 / full);
    workDays = days;
    const maxEach = num(t.maxHoursEach);
    if (hoursType && maxEach !== null && mins / 60 > maxEach + 1e-9) return fail(`${t.name} is up to ${maxEach} hour(s) each time.`);
    notes.push(hoursType ? `${round2(mins / 60)} hour(s) of ${t.name}.` : `${round2(mins / 60)} hour(s) is ${days} day of ${t.name} (full day = ${full} hours).`);
  } else {
    let ctx = {};
    let used = [];
    if (on(r.sw_enabled) && on(r.sw_merge)) {
      let a = v.from;
      let b = to;
      const cands = wholeDayRequests(db, emp.id, (x) => x.typeId === t.id && Number(x.days) > 0);
      let again = true;
      while (again) {
        again = false;
        cands.forEach((x) => {
          if (!used.includes(x) && adjacent(db, emp, x, a, b)) {
            used.push(x);
            a = x.from < a ? x.from : a;
            b = x.to > b ? x.to : b;
            again = true;
          }
        });
      }
      ctx = {
        spanFrom: a,
        spanTo: b,
        priorWork: used.reduce((s, x) => s + Number(x.workDays ?? x.days ?? 0), 0),
        priorSandwich: used.flatMap((x) => x.sandwichDates || []),
      };
      if (used.length) spanNote = `Counted together with your other ${t.name} on ${used.map((x) => short(x.from)).join(', ')}.`;
    }
    const c = countRange(db, emp, t, v.from, to, v.fromHalf, v.toHalf, ctx);
    days = c.days;
    workDays = c.workDays;
    sandwichDates = c.extraDates;
    if (spanNote) notes.push(spanNote);
    if (sandwichDates.length) notes.push(`${sandwichDates.map(short).join(', ')} ${sandwichDates.length > 1 ? 'are' : 'is'} counted as ${t.name} (sandwich rule).`);
  }
  if (days <= 0) return fail('The selected dates fall on weekly offs or holidays.');

  // an existing request on the same day(s)
  const clash = db.leaveRequests.find((x) => {
    if (x.empId !== emp.id || !['Pending', 'Approved'].includes(x.status)) return false;
    if (!(x.from <= to && x.to >= v.from)) return false;
    if (x.partial && v.partial) return x.fromTime < v.toTime && x.toTime > v.fromTime;
    return true;
  });
  if (clash) return fail('You already have leave applied on these dates.');

  // rules that turn the request, or part of it, into loss of pay
  let lopDays = 0;
  const convertible = !t.unlimited && !admin;
  if (convertible && (r.noCombineWith || []).length) {
    const near = wholeDayRequests(db, emp.id, (x) => r.noCombineWith.includes(x.typeId)).find((x) => adjacent(db, emp, x, v.from, to));
    if (near) {
      const nm = db.leaveTypes.find((x) => x.id === near.typeId)?.name || 'that leave';
      if (r.combineAction === 'Block') return fail(`${t.name} cannot be taken next to ${nm}.`);
      lopDays = days;
      notes.push(`${t.name} cannot be taken next to ${nm}, so these days are counted as Loss of Pay.`);
    }
  }
  const bd = backdateRule(r);
  if (convertible && bd.mode !== 'none' && to < today) {
    const sd = cycleStartOf(db);
    const ym = cycleMonthOf(to, sd);
    const cycleEnd = cycleRange(ym, sd)[1];
    if (bd.mode === 'days' && daysBetween(to, today) > bd.days) {
      if (r.backdateAction === 'Block') return fail(`${t.name} must be applied within ${bd.days} day(s) of the leave.`);
      lopDays = days;
      notes.push(`Applied more than ${bd.days} day(s) after the leave, so these days are counted as Loss of Pay.`);
    } else if (bd.mode === 'cycle' && today > cycleEnd) {
      if (r.backdateAction === 'Block') return fail(`${t.name} must be applied before the attendance cycle ends (${cycleLabel(ym, sd)}). That cycle has closed.`);
      lopDays = days;
      notes.push(`Applied after the attendance cycle (${cycleLabel(ym, sd)}) closed, so these days are counted as Loss of Pay.`);
    }
  }
  if (convertible && r.cutoffTime && !v.partial && v.from === today && time > r.cutoffTime && num(r.lateInformLop)) {
    const late = Math.min(days, Number(r.lateInformLop));
    if (late > lopDays) {
      lopDays = late;
      notes.push(`Informed after ${r.cutoffTime}, so ${late} day of this leave is counted as Loss of Pay.`);
    }
  }
  const lopType = db.leaveTypes.find((x) => x.code === 'LOP');

  // an hours-based type is limited by times (and hours) per attendance cycle, not by a day balance
  if (hoursType && !admin) {
    const u = hoursUsage(db, emp.id, t, v.from);
    const times = num(t.timesPerCycle);
    const cap = num(t.maxHoursPerCycle);
    const hrs = minutesBetween(v.fromTime, v.toTime) / 60;
    const overTimes = times !== null && u.times >= times;
    const overHours = cap !== null && u.hours + hrs > cap + 1e-9;
    if (overTimes || overHours) {
      const what = overTimes ? `all ${times} ${t.name} request(s)` : `the ${cap} hour(s) of ${t.name}`;
      if (r.insufficientAction === 'Convert excess to LOP') {
        lopDays = days;
        notes.push(`You have used ${what} for this cycle, so this is counted as Loss of Pay.`);
      } else return fail(`You have used ${what} for this attendance cycle (${cycleLabel(u.ym, cycleStartOf(db))}).`);
    } else if (times !== null) notes.push(`This is ${t.name} ${u.times + 1} of ${times} for this cycle (${cycleLabel(u.ym, cycleStartOf(db))}).`);
  }

  // balance
  if (!t.unlimited && !hoursType) {
    const asOf = v.from > today ? v.from : today;
    const b = leaveBalances(db, emp.id, undefined, asOf, true).find((x) => x.type.id === t.id);
    if (!b) return fail(`${t.name} does not apply to you.`);
    if (!b.eligible && !admin) return fail(`${t.name} is available only after ${r.eligibleAfter === 'Probation end' ? 'probation, from ' : ''}${short(b.eligibleDate)}.`);
    const need = days - lopDays;
    if (need > b.available + 1e-9) {
      if (r.insufficientAction === 'Convert excess to LOP' && !admin) {
        const excess = round2(need - Math.max(b.available, 0));
        lopDays = round2(lopDays + excess);
        notes.push(`Only ${Math.max(b.available, 0)} day(s) of ${t.name} are left, so ${excess} day(s) are counted as Loss of Pay.`);
      } else return fail(b.manual && b.quota <= 0 ? `You have no ${t.name} balance. HR adds this balance.` : `Only ${Math.max(b.available, 0)} day(s) of ${t.name} are available.`);
    }
  }
  if (lopDays > 0 && !lopType) return fail('Loss of Pay is not set up in Leave settings.');

  // certificate
  const cert = num(r.certificateAfterDays);
  let certificateDue = false;
  if (cert !== null && days > cert && !v.attachment) {
    if (on(r.certificateEnforce) && !admin) return fail(`Attach the medical certificate: ${t.name} of more than ${cert} day(s) needs one.`);
    certificateDue = true;
    notes.push(`A medical certificate is needed for ${t.name} of more than ${cert} day(s). Give it to HR when you return.`);
  }

  const status = admin || !on(r.needsApproval) ? 'Approved' : 'Pending';
  return { ok: true, error: '', days: round2(days), workDays, sandwichDates, lopDays: round2(lopDays), certificateDue, status, notes };
}

export function buildLeaveRequest(emp, v, ev, extra = {}) {
  const { notify, ...rest } = v;
  return {
    ...rest,
    to: v.partial ? v.from : v.to,
    empId: emp.id,
    days: ev.days,
    workDays: ev.workDays,
    sandwichDates: ev.sandwichDates,
    lopDays: ev.lopDays,
    certificateDue: ev.certificateDue,
    status: ev.status,
    appliedOn: todayISO(),
    approverComment: '',
    notify: notify || '',
    ...extra,
  };
}

// ---------- plain-language summary of a leave type's rules ----------
export function describeRules(t, db) {
  const r = rulesOf(t);
  const out = [];
  const nameOf = (id) => db.leaveTypes.find((x) => x.id === id)?.name || '?';
  const mode = creditMode(t);
  const annual = Number(t.annualQuota || 0);
  const trim = (n) => String(round2(n));
  if (isHours(t)) {
    const times = num(t.timesPerCycle);
    const each = num(t.maxHoursEach);
    const cap = num(t.maxHoursPerCycle);
    out.push('Taken in hours, with a From and To time on one working day.');
    out.push(times === null ? 'No limit on how many times it can be used.' : `Can be used ${times} time(s) in each attendance cycle.`);
    if (each !== null) out.push(`Up to ${each} hour(s) each time.`);
    if (cap !== null) out.push(`Up to ${cap} hour(s) in total in each cycle.`);
    out.push(r.insufficientAction === 'Convert excess to LOP' ? 'Beyond the limit, the request is counted as Loss of Pay.' : 'Beyond the limit, the request is not accepted.');
    out.push(on(r.needsApproval) ? "Needs the reporting manager's approval." : 'Approved automatically.');
    out.push('It does not use the day balance of any other leave. The hours taken lower the hours the day needs.');
    const bdh = backdateRule(r);
    if (bdh.mode !== 'none') out.push(`${bdh.mode === 'cycle' ? 'Apply until the end of the attendance cycle the leave falls in' : `Apply within ${bdh.days} day(s) after the leave`}; later is ${r.backdateAction === 'Block' ? 'not accepted' : 'counted as Loss of Pay'}.`);
    return out;
  }
  const when = Number(r.creditDay) === 0 ? 'on the last day of the month' : `on the ${ord(Number(r.creditDay))} of the month`;
  if (t.unlimited) out.push('No limit on the balance.');
  else if (mode === 'Manual') out.push(`No automatic credit. HR adds the balance${on(r.allowEmployeeRequest) ? '; employees can also raise a request' : ''}.`);
  else if (mode === 'Monthly') out.push(`${annual} day(s) a year, ${trim(annual / 12)} credited ${when}.`);
  else if (mode === 'Quarterly') out.push(`${annual} day(s) a year, ${trim(annual / 4)} credited every 3 months ${when}.`);
  else out.push(`${annual} day(s) credited at the start of the leave year.`);
  if (!t.unlimited && mode !== 'Manual') {
    const cut = num(r.joinCutoffDay);
    out.push(`Credit counts from the ${r.accrueFrom === 'Eligibility date' ? 'eligibility date' : 'joining date'}${cut ? `; joiners after the ${ord(cut)} start next month` : ''}.`);
    if (r.eligibleAfter === 'Probation end') out.push('Can be used only after probation ends.');
  }
  if (t.carryForward === 'Yes') out.push(`Unused balance carries forward (up to ${t.maxCarryForward || 0} days).`);
  else if (!t.unlimited && mode !== 'Manual') out.push('Unused balance lapses at the end of the leave year.');
  if (t.encashable === 'Yes') out.push('Can be encashed.');
  out.push(on(r.needsApproval) ? "Needs the reporting manager's approval." : 'Approved automatically.');
  if (!on(r.allowPartial)) out.push('Partial-day (hours) leave is not allowed.');
  if (on(r.sw_enabled)) {
    const kinds = [on(r.sw_weeklyOffs) && 'weekly offs', on(r.sw_holidays) && 'holidays'].filter(Boolean).join(' and ') || 'nothing';
    const basis = r.sw_basis === 'Calendar days' ? 'calendar days' : 'working days';
    out.push(
      `Sandwich: ${kinds} ${r.sw_scope === 'Between leave days only' ? 'between leave days' : 'inside the request'} count as leave when the leave is more than ${num(r.sw_minDays) ?? 0} ${basis}${r.sw_holidayBlock === 'Skip the block' ? '; a block that includes a holiday is not counted' : ''}${on(r.sw_edges) ? '; also those directly before or after' : ''}${on(r.sw_merge) ? '. Separate requests joined only by weekly offs or holidays are counted together' : ''}.`,
    );
  } else out.push('Weekly offs and holidays are never counted.');
  const bdr = backdateRule(r);
  if (bdr.mode !== 'none') out.push(`${bdr.mode === 'cycle' ? 'Apply until the end of the attendance cycle the leave falls in (whatever the length of the month)' : `Apply within ${bdr.days} day(s) after the leave`}; later is ${r.backdateAction === 'Block' ? 'not accepted' : 'counted as Loss of Pay'}.`);
  if (r.cutoffTime) out.push(`Same-day leave must be informed by ${r.cutoffTime}; later, ${num(r.lateInformLop) ?? 0} day is counted as Loss of Pay.`);
  if (num(r.certificateAfterDays) !== null) out.push(`Medical certificate needed beyond ${num(r.certificateAfterDays)} day(s)${on(r.certificateEnforce) ? ' (required to submit)' : ''}.`);
  if ((r.noCombineWith || []).length) out.push(`Cannot be taken next to ${r.noCombineWith.map(nameOf).join(', ')}; ${r.combineAction === 'Block' ? 'the request is not accepted' : 'the days are counted as Loss of Pay'}.`);
  if (r.insufficientAction === 'Convert excess to LOP' && !t.unlimited) out.push('Days beyond the balance are counted as Loss of Pay.');
  return out;
}
