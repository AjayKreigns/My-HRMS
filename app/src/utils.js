// Shared helpers: dates, money, payroll maths, attendance and leave calculations.
import { PF_DEFAULTS, pfPolicy, esiPolicy, pfCeilingOn, pfCeilingForCycle, pfBasisOf, pfOf, esiPeriodOf, esiAmount, ESI_EXCLUDED, ptPolicy, ptStateOf, ptMonthly, lwfPolicy, lwfDue } from './statutory.js';

// HR's decision on an Absent / Action Required day, and the loss-of-pay days it means.
export const RESOLUTION_LOP = { Paid: 0, 'Loss of pay': 1, 'Half day loss of pay': 0.5 };
export const uidLike = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => iso(new Date());
export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(s, opts = {}) {
  if (!s) return '—';
  const d = s.length > 10 ? new Date(s) : parseISO(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}
export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return `${fmtDate(iso(d))}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
export function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${pad(m)} ${ap}`;
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const ymOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ymOf(d);
}
export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

// One formatter for the whole app: number.toLocaleString('en-IN') builds a new one on every call, which was a visible part of
// the first screen's work on a slow phone (a page can show hundreds of amounts). The output is the same.
const indianNumber = new Intl.NumberFormat('en-IN');
export const inNumber = (n) => indianNumber.format(n);

export function money(n, cur = 'INR') {
  const v = Math.round(Number(n) || 0);
  return (cur === 'INR' ? '₹' : cur + ' ') + inNumber(v);
}

export function minutesBetween(a, b) {
  if (!a || !b) return 0;
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}
export const hm = (mins) => (mins > 0 ? `${Math.floor(mins / 60)}h ${pad(Math.round(mins % 60))}m` : '0h 00m');

export function fullName(e) {
  if (!e) return '—';
  return e.displayName || [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ');
}
export const initials = (e) => (e ? `${(e.firstName || '?')[0]}${(e.lastName || '')[0] || ''}`.toUpperCase() : '?');
export const empById = (db, id) => db.employees.find((e) => e.id === id);
export const empName = (db, id) => fullName(empById(db, id));
export const activeEmployees = (db) => db.employees.filter((e) => e.status !== 'Exited');

// Deterministic pseudo-random numbers so generated history stays stable between visits.
export function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// ---------- calendar ----------
// Weekly off pattern of one employee (the Profile "Weekly off" field).
export function isWeeklyOff(emp, date) {
  const d = parseISO(date);
  const wd = d.getDay();
  const w = emp?.weeklyOff || 'Saturday & Sunday';
  if (/alternate/i.test(w)) return wd === 0 || (wd === 6 && [2, 4].includes(Math.ceil(d.getDate() / 7)));
  if (w === 'Sunday') return wd === 0;
  if (w === 'Friday') return wd === 5;
  return wd === 0 || wd === 6;
}
export function isHoliday(db, date) {
  return db.holidays.find((h) => h.date === date && h.type !== 'Optional');
}

// Which part of `date` a (non-partial) leave takes: 1 = the whole day, 0.5 = one half.
// A one-day leave uses the "From session"; on a longer leave each end day uses its own session.
export function leavePart(r, date) {
  if (r.partial) return 0;
  if (date === r.from && r.fromHalf && r.fromHalf !== 'Full day') return 0.5;
  if (date === r.to && r.to !== r.from && r.toHalf && r.toHalf !== 'Full day') return 0.5;
  return 1;
}
// Approved leave that covers a whole day. Partial (hour) leave and half-day leave do not make
// the day a leave day.
export function onLeave(db, empId, date) {
  return db.leaveRequests.find((r) => r.empId === empId && r.status === 'Approved' && !r.partial && ((r.from <= date && r.to >= date && leavePart(r, date) === 1) || (r.sandwichDates || []).includes(date)));
}
// Approved half-day leave on that date (the day then needs half the hours).
export function halfDayLeaveFor(db, empId, date) {
  const r = db.leaveRequests.find((x) => x.empId === empId && x.status === 'Approved' && !x.partial && x.from <= date && x.to >= date && leavePart(x, date) === 0.5);
  if (!r) return null;
  return { req: r, session: date === r.from ? r.fromHalf : r.toHalf };
}
// Leave waiting for approval that covers that date (full or half day).
export function pendingLeaveFor(db, empId, date) {
  return db.leaveRequests.find((r) => r.empId === empId && r.status === 'Pending' && !r.partial && r.from <= date && r.to >= date);
}
export function partialLeaveFor(db, empId, date) {
  return db.leaveRequests.find((r) => r.empId === empId && r.partial && ['Approved', 'Pending'].includes(r.status) && r.from === date);
}

// ---------- attendance ----------
// The working day that applies to one shift. A shift marked "follows policy" takes its times,
// grace and hours from Attendance settings > Policy; any other shift uses its own.
export function scheduleOfShift(db, shiftIn) {
  const shift = shiftIn || {};
  const a = db.attendanceSettings || {};
  const follows = !!shift.followsPolicy && !!a.workStart && !!a.workEnd;
  const start = follows ? a.workStart : shift.start;
  const end = follows ? a.workEnd : shift.end;
  const grace = follows ? (a.graceMinutes === '' || a.graceMinutes == null ? 15 : Number(a.graceMinutes)) : Number(shift.grace || 0);
  let span = start && end ? minutesBetween(start, end) : 0;
  if (start && end && span <= 0) span += 24 * 60; // a night shift ends after midnight
  const override = follows ? a.requiredHours : shift.requiredHours;
  const hasOverride = override !== '' && override != null && Number(override) > 0;
  const requiredHours = hasOverride ? Number(override) : span > 0 ? span / 60 : Number(shift.fullDayHours) || 8;
  return {
    ...shift,
    start,
    end,
    grace,
    requiredHours,
    followsPolicy: follows,
    ruleOn: a.hoursRuleEnabled !== false && span > 0,
    missingPunchOut: a.missingPunchOut === 'Present' ? 'Present' : 'Action required',
  };
}
export const scheduleFor = (db, emp) => scheduleOfShift(db, db.shifts.find((s) => s.id === emp?.shiftId) || db.shifts[0]);

// Status of one day from the punches. Gross hours between the first punch-in and the last
// punch-out must reach the hours the day needs:
//   hours met                                      -> Present (or WFH)
//   any punch there, but the day is not complete   -> Action Required (short hours, only a
//                                                     punch-in, or only a punch-out)
//   no punch-in and no punch-out                   -> Absent
// Arriving after start + grace only adds a "late" mark; it never changes the status.
function judgeDay(db, emp, date, rec, sched) {
  const hl = halfDayLeaveFor(db, emp?.id, date);
  // Arriving at midday after a first-half leave is not late.
  const late = rec.clockIn && hl?.session !== 'First half' ? minutesBetween(sched.start, rec.clockIn) - sched.grace : 0;
  const out = { late: late > 0, lateBy: late > 0 ? late : 0, requiredMin: 0, workedMin: 0 };
  let worked = rec.clockIn && rec.clockOut ? minutesBetween(rec.clockIn, rec.clockOut) : 0;
  if (rec.clockIn && rec.clockOut && worked <= 0) worked += 24 * 60;
  // Approved partial leave that day lowers the hours needed by the hours taken off.
  const off = db.leaveRequests
    .filter((r) => r.empId === emp?.id && r.partial && r.status === 'Approved' && r.from === date)
    .reduce((s, r) => s + Math.max(0, minutesBetween(r.fromTime, r.toTime)), 0);
  // Approved half-day leave takes half of the day's hours off.
  const half = hl ? Math.round(sched.requiredHours * 30) : 0;
  const need = Math.max(0, Math.round(sched.requiredHours * 60) - off - half);
  out.workedMin = worked;
  out.requiredMin = need;
  // Times that a manager approved (regularization) or HR marked present are taken as they are.
  const trusted = rec.regularized || rec.source === 'Regularized' || rec.forcePresent;
  const hasIn = !!rec.clockIn;
  const hasOut = !!rec.clockOut;
  if (!hasIn && !hasOut) {
    out.status = 'Absent';
    return out;
  }
  let present;
  if (trusted) present = true;
  else if (!hasIn) {
    present = false;
    out.note = 'Punch-in missing';
  } else if (!sched.ruleOn) present = true;
  else if (!hasOut) {
    present = date >= todayISO() ? true : sched.missingPunchOut === 'Present'; // today: still at work
    if (!present) out.note = 'Punch-out missing';
  } else {
    present = worked >= need;
    if (!present) out.note = `Worked ${hm(worked)} of ${hm(need)} needed`;
  }
  out.status = present ? (rec.wfh ? 'WFH' : 'Present') : 'Action Required';
  return out;
}

// Past working days get a generated log unless the person recorded something real.
export function attendanceFor(db, empId, date) {
  const rec = baseAttendance(db, empId, date);
  const pl = partialLeaveFor(db, empId, date);
  const hl = halfDayLeaveFor(db, empId, date);
  if (hl) rec.partial = `Half-day leave (${String(hl.session).toLowerCase()})`;
  const pend = pendingLeaveFor(db, empId, date);
  if (pend) rec.pendingLeave = pend;
  if (pl) rec.partial = `${pl.status === 'Pending' ? 'Partial leave (pending) ' : 'Partial leave '}${pl.fromTime}–${pl.toTime}`;
  return rec;
}

function baseAttendance(db, empId, date) {
  const real = db.attendance.find((a) => a.empId === empId && a.date === date);
  const hol = isHoliday(db, date);
  const lv = onLeave(db, empId, date);
  const emp = empById(db, empId);
  const sched = scheduleFor(db, emp);
  const base = { date, empId, shift: sched };
  if (real) {
    // Approved leave for the whole day holds until both a punch-in and a punch-out are logged.
    if (lv && !(real.clockIn && real.clockOut)) {
      return { ...base, ...real, status: 'Leave', late: false, lateBy: 0, requiredMin: 0, workedMin: 0, note: db.leaveTypes.find((t) => t.id === lv.typeId)?.name };
    }
    const j = judgeDay(db, emp, date, real, sched);
    return { ...base, ...real, ...j, note: j.note || real.note };
  }
  // Weekly offs or holidays that a leave rule counted as leave (sandwich) show as leave.
  if (lv && (lv.sandwichDates || []).includes(date)) return { ...base, status: 'Leave', note: `${db.leaveTypes.find((t) => t.id === lv.typeId)?.name} (counted)` };
  if (isWeeklyOff(emp, date)) return { ...base, status: 'Weekly off' };
  if (hol) return { ...base, status: 'Holiday', note: hol.name };
  if (lv) return { ...base, status: 'Leave', note: db.leaveTypes.find((t) => t.id === lv.typeId)?.name };
  const today = todayISO();
  if (date >= today || (emp && date < emp.dateOfJoining)) return { ...base, status: date === today ? 'Not clocked in' : '' };
  // Demo history: most days meet the hours, some start late, a few fall short or are absent.
  const r = seeded(empId + date);
  const x = r();
  if (x < 0.03) return { ...base, status: 'Absent' };
  const [sh, sm] = (sched.start || '09:30').split(':').map(Number);
  const u = r();
  const inMin = sh * 60 + sm - 20 + Math.floor(u * u * u * 50); // mostly on time, a few late
  const outMin = inMin + Math.round(sched.requiredHours * 60) + Math.floor(r() * 90) - 3;
  const t = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const gen = { clockIn: t(inMin), clockOut: t(outMin), wfh: x > 0.9, generated: true };
  return { ...base, ...gen, ...judgeDay(db, emp, date, gen, sched) };
}

export function arrival(rec) {
  if (!rec.clockIn) return '';
  const late = minutesBetween(rec.shift?.start || '09:30', rec.clockIn) - Number(rec.shift?.grace || 0);
  return late > 0 ? `${late < 60 ? `${late}m` : hm(late)} late` : 'On time';
}

// ---------- regularization limit ----------
// How many regularizations an employee has used in the current attendance cycle. Pending and
// approved requests count; rejected and cancelled ones give the use back. Counted by the cycle
// the request was made in. A blank limit means no limit.
export function regularizationUsage(db, empId, on = todayISO()) {
  const a = db.attendanceSettings || {};
  const limit = a.regularizeLimit === '' || a.regularizeLimit == null || Number.isNaN(Number(a.regularizeLimit)) ? null : Number(a.regularizeLimit);
  const sd = cycleStartOf(db);
  const ym = cycleMonthOf(on, sd);
  const [from, to] = cycleRange(ym, sd);
  const used = (db.attendanceRequests || []).filter((r) => r.empId === empId && r.type === 'Regularization' && !r.byAdmin && ['Pending', 'Approved'].includes(r.status) && (r.createdAt || r.date) >= from && (r.createdAt || r.date) <= to).length;
  return { limit, used, left: limit === null ? Infinity : Math.max(0, limit - used), from, to, ym };
}
// '' when the employee may regularize that day, otherwise the reason they may not.
export function checkRegularize(db, empId, date, on = todayISO()) {
  const a = db.attendanceSettings || {};
  if (!date) return 'Pick the day.';
  if (date > on) return 'A day that has not happened yet cannot be regularized.';
  const win = a.regularizeWithinDays === '' || a.regularizeWithinDays == null ? null : Number(a.regularizeWithinDays);
  if (win !== null && !Number.isNaN(win)) {
    const back = Math.round((parseISO(on) - parseISO(date)) / 86400000);
    if (back > win) return `Only the last ${win} day(s) can be regularized. Ask HR to correct older days.`;
  }
  const lock = checkCycleLock(db, date, on);
  if (lock) return lock;
  if (pendingLeaveFor(db, empId, date)) return 'A leave request for this day is waiting for approval. Cancel it first if you want to regularize instead.';
  const u = regularizationUsage(db, empId, on);
  if (u.left <= 0) return `You have used all ${u.limit} regularization${u.limit === 1 ? '' : 's'} for this cycle (${cycleLabel(u.ym, cycleStartOf(db))}). Ask HR to correct the log.`;
  return '';
}

// Employees can change only the current attendance cycle; earlier cycles are locked (HR can still
// correct them). Switch off in Attendance settings > Policy.
export function checkCycleLock(db, date, on = todayISO()) {
  const a = db.attendanceSettings || {};
  if (a.lockPastCycles === false || !date) return '';
  const sd = cycleStartOf(db);
  const ym = cycleMonthOf(date, sd);
  if (ym < cycleMonthOf(on, sd)) return `${cycleLabel(ym, sd)} is an earlier attendance cycle and is locked. Ask HR to correct it.`;
  return '';
}
// '' when the employee may apply leave for that day from the attendance log.
export function checkLeaveFromLog(db, empId, date, on = todayISO()) {
  if (!date) return 'Pick the day.';
  const lock = checkCycleLock(db, date, on);
  if (lock) return lock;
  if (pendingLeaveFor(db, empId, date)) return 'A leave request for this day is already waiting for approval.';
  if ((db.attendanceRequests || []).some((r) => r.empId === empId && r.type === 'Regularization' && r.status === 'Pending' && r.date === date)) return 'A regularization for this day is waiting for approval. Cancel it first if you want to apply leave instead.';
  return '';
}

// ---------- payroll ----------
// A pay structure lists the earning components of a salary. The first is always Basic.
// Component types: 'Percent of CTC', 'Percent of Basic', 'Fixed' (per month) and 'Balance'
// (whatever is left of the CTC after the others, employer PF and gratuity).
export const COMPONENT_TYPES = ['Percent of CTC', 'Percent of Basic', 'Fixed', 'Balance'];
export function structureFromSettings(s = {}) {
  return {
    id: 'ps1',
    isDefault: true,
    name: 'Standard structure',
    description: 'Basic 40% of CTC, HRA 50% of basic, fixed conveyance and medical, the rest as special allowance.',
    employerPf: true,
    gratuity: true,
    gratuityPct: 4.81,
    components: [
      { id: 'c_basic', name: 'Basic', type: 'Percent of CTC', value: Number(s.basicPct ?? 40), role: 'basic' },
      { id: 'c_hra', name: 'House Rent Allowance', type: 'Percent of Basic', value: Number(s.hraPct ?? 50), role: 'hra' },
      { id: 'c_conv', name: 'Conveyance Allowance', type: 'Fixed', value: Number(s.conveyance ?? 1600) },
      { id: 'c_med', name: 'Medical Allowance', type: 'Fixed', value: Number(s.medical ?? 1250) },
      { id: 'c_special', name: 'Special Allowance', type: 'Balance', value: 0 },
    ],
  };
}

// The pay group everyone starts in: the company's own statutory settings.
export function groupFromSettings(s = {}) {
  return {
    id: 'pg1',
    isDefault: true,
    name: s.payGroup || 'iFluids Monthly',
    description: 'Monthly salary paid to all employees.',
    structureId: 'ps1',
    payDay: s.payDay ?? 'Last working day',
    lockDay: s.lockDay ?? 25,
    pfEnabled: s.pfEnabled !== false,
    // No pfCeiling: the wage ceiling follows the statutory rules (Payroll > Settings > PF & ESI). Set one here only to override them.
    esiEnabled: s.esiEnabled !== false,
    ptEnabled: s.ptEnabled !== false,
    // No ptAmount: Professional Tax follows the state slabs (Payroll > Settings > PT & LWF). Set one here only for a fixed amount.
    lwfEnabled: !!s.lwfEnabled,
    lwfEmployee: s.lwfEmployee ?? 0,
    lwfEmployer: s.lwfEmployer ?? 0,
  };
}

export function salaryBreakup(ctcAnnual, settings, structure) {
  const s = settings || {};
  const st = structure || structureFromSettings(s);
  const comps = st.components || [];
  const monthly = Number(ctcAnnual || 0) / 12;
  const val = (c, basic) => {
    const v = Number(c.value || 0);
    if (c.type === 'Percent of CTC') return monthly * (v / 100);
    if (c.type === 'Percent of Basic') return basic * (v / 100);
    if (c.type === 'Fixed') return Math.min(v, monthly);
    return 0;
  };
  const basic = comps.length ? val(comps[0], 0) : 0;
  // Provident fund on this basic: the company's PF rules (settings.pf) with the employee's own choices laid over them.
  const pol = { ...PF_DEFAULTS, ...(s.pf || {}) };
  const pfd = s.pfEnabled === false ? null : pfOf(pol, { basic, ceiling: s.pfCeiling ?? pfCeilingOn(pol), basis: s.pfBasis || pol.basis, epsApplies: s.epsApplies !== false });
  const employerPf = pfd ? pfd.employer : 0;
  const edli = pfd ? pfd.edli : 0;
  const admin = pfd ? pfd.admin : 0;
  const gratuity = st.gratuity === false ? 0 : basic * (Number(st.gratuityPct ?? 4.81) / 100);
  const amounts = comps.map((c, i) => (c.type === 'Balance' ? null : i === 0 ? basic : val(c, basic)));
  const fixedSum = amounts.reduce((t, a) => t + (a || 0), 0);
  // The employer's PF share comes out of the CTC unless the pay structure says it is paid on top of it;
  // EDLI and the administration charge follow the company setting.
  const inCtc = (st.employerPf !== false ? employerPf : 0) + (pol.chargesInCtc ? edli + admin : 0);
  const balance = Math.max(monthly - inCtc - gratuity - fixedSum, 0);
  const earnings = comps.map((c, i) => [c.name, amounts[i] === null ? balance : amounts[i]]);
  const hraAt = comps.findIndex((c) => c.role === 'hra');
  return {
    monthly,
    earnings,
    employer: [
      ['Employer PF', employerPf],
      ['Gratuity', gratuity],
      ['EDLI (employer)', edli],
      ['EPF admin charges', admin],
    ],
    gross: earnings.reduce((t, [, v]) => t + v, 0),
    pfWage: pfd ? pfd.wage : 0,
    basic,
    hra: hraAt >= 0 ? earnings[hraAt][1] : 0,
  };
}

// ---- pay groups and structures: which settings and structure apply to an employee ----
const GROUP_KEYS = ['payDay', 'lockDay', 'pfEnabled', 'pfCeiling', 'esiEnabled', 'ptEnabled', 'ptAmount', 'lwfEnabled', 'lwfEmployee', 'lwfEmployer'];
// Employees with no pay group (or structure) of their own get the one marked default.
export const defaultOf = (list) => (list || []).find((x) => x.isDefault) || (list || [])[0];
export const payGroupOf = (db, emp) => (db.payGroups || []).find((g) => g.id === emp?.payGroupId) || defaultOf(db.payGroups);
export const structureOf = (db, emp) => {
  const list = db.payStructures || [];
  const st = list.find((x) => x.id === emp?.structureId) || list.find((x) => x.id === payGroupOf(db, emp)?.structureId) || defaultOf(list);
  // Gratuity switched off for the company (Payroll > Settings > Gratuity) means none for anyone.
  if (st && gratuityPolicy(db).enabled === false) return { ...st, gratuity: false };
  // Only the employees HR picked (profile > Statutory > Gratuity applies = Yes).
  if (st && gratuityPolicy(db).eligibility === 'selected') return { ...st, gratuity: emp?.gratuityApplies === 'Yes' };
  // The employee's own gratuity choice (profile > Statutory) beats the structure; blank follows it.
  if (st && (emp?.gratuityApplies === 'Yes' || emp?.gratuityApplies === 'No')) return { ...st, gratuity: emp.gratuityApplies === 'Yes' };
  return st;
};
// Gratuity paid on exit. The company can change any of these in Payroll > Settings > Gratuity;
// until then the Payment of Gratuity Act formula applies.
export const GRATUITY_DEFAULTS = {
  enabled: true, // off means the company has no gratuity: nothing in the CTC and nothing paid on exit
  eligibility: 'all', // 'all': everyone with the years of service; 'selected': only employees whose profile says Yes
  daysPerYear: 15, // days of wages for each completed year
  monthDays: 26, // a month's wages are taken as this many days
  minYears: 5, // service needed before it is payable
  minYearsFixedTerm: 1, // the same for fixed-term (Contract) staff
  roundMonths: 6, // a part-year of at least this many months counts as a full year (12 = completed years only)
  cap: 2000000, // most that can be paid; 0 means no limit
};
export const gratuityPolicy = (db) => ({ ...GRATUITY_DEFAULTS, ...(db?.payrollSettings?.gratuityPolicy || {}) });
// What is payable for a monthly basic and years of service (fractions allowed).
export function gratuityPayable(policy, basic, years, workerType) {
  const p = { ...GRATUITY_DEFAULTS, ...(policy || {}) };
  const minYears = workerType === 'Contract' ? p.minYearsFixedTerm : p.minYears;
  if (p.enabled === false || !(years >= minYears)) return { amount: 0, minYears, countedYears: 0, capped: false };
  const whole = Math.floor(years);
  const countedYears = whole + ((years - whole) * 12 >= p.roundMonths - 1e-9 ? 1 : 0);
  const raw = (p.daysPerYear / p.monthDays) * basic * countedYears;
  const capped = p.cap > 0 && raw > p.cap;
  return { amount: capped ? p.cap : raw, minYears, countedYears, capped };
}
// Whether gratuity applies to this employee at all (it is part of their CTC and payable on exit).
export const gratuityApplies = (db, emp) => structureOf(db, emp)?.gratuity !== false;
// Company payroll settings with the pay group's statutory switches laid over them.
// Give the payroll month (ym) to get the PF wage ceiling for that pay cycle; without it, the ceiling in force today.
export function settingsFor(db, emp, ym) {
  const g = payGroupOf(db, emp) || {};
  const over = {};
  GROUP_KEYS.forEach((k) => {
    if (g[k] !== undefined && g[k] !== '') over[k] = g[k];
  });
  // The employee's own PF choice (profile > Statutory) beats the pay group; blank follows the group.
  if (emp?.pfApplies === 'No') over.pfEnabled = false;
  else if (emp?.pfApplies === 'Yes') over.pfEnabled = true;
  const pf = pfPolicy(db);
  const esi = esiPolicy(db);
  const merged = { ...db.payrollSettings, ...over };
  // The ceiling follows the dated statutory rules unless the pay group sets one of its own.
  const [cf, ct] = ym ? cycleRange(ym, merged.cycleStartDay) : [];
  const own = Number(g.pfCeiling) > 0 ? Number(g.pfCeiling) : 0;
  return {
    ...merged,
    pf,
    esi,
    pfCeiling: own || (ym ? pfCeilingForCycle(pf, cf, ct) : pfCeilingOn(pf)),
    pfBasis: pfBasisOf(pf, emp),
    epsApplies: emp?.epsApplies !== 'No',
    // ESI is off for everyone when the company switches it off; the pay group can switch it off for its own people.
    esiEnabled: esi.enabled !== false && merged.esiEnabled !== false,
  };
}
export const breakupFor = (db, emp, ym) => salaryBreakup(emp?.ctc, settingsFor(db, emp, ym), structureOf(db, emp));

// Monthly pay rate on a past or future date, from the approved salary revisions (the employee record holds today's CTC).
function ctcAsOf(db, emp, date) {
  const revs = (db.promotions || []).filter((p) => p.empId === emp.id && p.status === 'Approved' && p.effectiveFrom).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const past = revs.filter((p) => p.effectiveFrom <= date).pop();
  if (past && Number(past.newCtc) > 0) return Number(past.newCtc);
  const next = revs.find((p) => p.effectiveFrom > date);
  return next && Number(next.oldCtc) > 0 ? Number(next.oldCtc) : Number(emp.ctc);
}
// Whether the employee is covered by ESI for a payroll month. Coverage is decided on the wages in the first month
// of the contribution period they are working in (or the month they joined, if later) and then holds for the whole period.
export function esiCovered(db, emp, ym) {
  const s = settingsFor(db, emp, ym);
  if (s.esiEnabled === false) return { covered: false, period: null, wage: 0 };
  const sd = cycleStartOf(db);
  const period = esiPeriodOf(s.esi, ym);
  const joined = cycleMonthOf(emp.dateOfJoining || `${ym}-01`, sd);
  const decidedIn = joined > period.start ? joined : period.start;
  const wage = salaryBreakup(ctcAsOf(db, emp, cycleRange(decidedIn, sd)[1]), settingsFor(db, emp, decidedIn), structureOf(db, emp)).gross;
  return { covered: wage <= Number(s.esi.grossLimit), period, wage, decidedIn };
}

const NEW_SLABS = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]];
const OLD_SLABS = [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]];

function slabTax(income, slabs) {
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of slabs) {
    if (income > prev) tax += (Math.min(income, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}

export function declarationTotal(decl) {
  if (!decl) return { c80: 0, d80: 0, other: 0, hraRent: 0 };
  const it = decl.items || {};
  const c80 = Math.min(['ppf', 'elss', 'lic', 'tuition', 'homeLoanPrincipal', 'nsc', 'fd5yr', 'epfVoluntary'].reduce((s, k) => s + Number(it[k] || 0), 0), 150000);
  const d80 = Math.min(Number(it.mediclaimSelf || 0), 25000) + Math.min(Number(it.mediclaimParents || 0), 50000);
  const other = Math.min(Number(it.nps || 0), 50000) + Number(it.eduLoanInterest || 0) + Number(it.donations || 0) + Math.min(Number(it.homeLoanInterest || 0), 200000);
  return { c80, d80, other, hraRent: Number(it.rentMonthly || 0) * 12 };
}

// Tax on one year's pay. Section 87A rebate with marginal relief: just above the limit the tax can never be more than
// the income above it. Surcharge on very high incomes also has marginal relief. 4% cess. Taxable income and the final tax
// are rounded to the nearest ten rupees, as the Act says (sections 288A and 288B).
const SURCHARGE_NEW = [[5000000, 0], [10000000, 0.1], [20000000, 0.15], [Infinity, 0.25]];
const SURCHARGE_OLD = [[5000000, 0], [10000000, 0.1], [20000000, 0.15], [50000000, 0.25], [Infinity, 0.37]];
const round10 = (n) => Math.round(n / 10) * 10;
function taxOn(taxable, slabs, rebateLimit, surcharges) {
  const base = (x) => (x <= rebateLimit ? 0 : Math.min(slabTax(x, slabs), x - rebateLimit));
  const rateAt = (x) => surcharges.find(([cap]) => x <= cap)[1];
  let tax = base(taxable);
  let surcharge = tax * rateAt(taxable);
  // Marginal relief: over a surcharge threshold, tax plus surcharge cannot exceed the tax at the threshold plus the income above it.
  const crossed = surcharges.filter(([cap], i) => i < surcharges.length - 1 && taxable > cap).pop();
  if (crossed && surcharge > 0) {
    const [threshold, prevRate] = crossed;
    const atThreshold = base(threshold) * (1 + prevRate);
    surcharge = Math.max(Math.min(tax + surcharge, atThreshold + (taxable - threshold)) - tax, 0);
  }
  const cess = (tax + surcharge) * 0.04;
  return { tax: round10(tax + surcharge + cess), surcharge, cess };
}
// opts: months (months of pay in the year, default 12), ptAnnual (Professional Tax for the year, a deduction in the old
// regime), pfAnnual (the employee's own PF for the year, counted under 80C in the old regime).
export function incomeTax(annualGross, regime = 'New', decl, basicAnnual = 0, hraAnnual = 0, opts = {}) {
  const months = opts.months ?? 12;
  if (regime === 'Old') {
    const d = declarationTotal(decl);
    // House rent allowance: the least of the HRA received, rent over 10% of basic, and 50% of basic (metro city).
    const rent = (d.hraRent / 12) * months;
    const hraEx = rent ? Math.max(Math.min(hraAnnual, rent - basicAnnual * 0.1, basicAnnual * 0.5), 0) : 0;
    const c80 = Math.min(d.c80 + (opts.pfAnnual || 0), 150000);
    const taxable = round10(Math.max(annualGross - 50000 - (opts.ptAnnual ?? 2400) - hraEx - c80 - d.d80 - d.other, 0));
    return { taxable, ...taxOn(taxable, OLD_SLABS, 500000, SURCHARGE_OLD) };
  }
  const taxable = round10(Math.max(annualGross - 75000, 0));
  return { taxable, ...taxOn(taxable, NEW_SLABS, 1200000, SURCHARGE_NEW) };
}

// ---- tax for the year, projected from pay so far (financial year April to March) ----
export const fyOf = (ym) => (Number(ym.slice(5)) >= 4 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1);
const lineOf = (list, prefix) => (list.find(([k]) => k.startsWith(prefix)) || [0, 0])[1];
// What counts as pay for income tax in a payslip: everything except reimbursements.
const taxableOfSlip = (slip) => slip.earnings.reduce((t, [k, v]) => t + (k.startsWith('Reimbursement') ? 0 : v), 0);
// Tax for the financial year is worked out from the pay already given (locked months), this month's pay and the
// months still to come. What was deducted so far is taken off, and the rest is spread over the months left, so the
// last month (March) settles whatever the year turned out to be.
//   current: { taxable, pfEmployee } for this month, when payslipFor has already worked them out.
export function taxProjection(db, emp, ym, current = {}) {
  const sd = cycleStartOf(db);
  const fy = fyOf(ym);
  const first = `${fy}-04`;
  const last = `${fy + 1}-03`;
  const joined = cycleMonthOf(emp.dateOfJoining || `${first}-01`, sd);
  const exit = (db.exits || []).find((x) => x.empId === emp.id && x.status !== 'Withdrawn');
  const left = exit ? cycleMonthOf(exit.lastWorkingDay, sd) : last;
  const start = joined > first ? joined : first;
  const end = left < last ? left : last;
  const months = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m);
  const decl = (db.taxDeclarations || []).find((d) => d.empId === emp.id && d.fy === `${fy}-${String(fy + 1).slice(2)}`) || (db.taxDeclarations || []).find((d) => d.empId === emp.id);
  const regime = decl?.regime || emp.taxRegime || 'New';
  const b = breakupFor(db, emp, ym);
  const s = settingsFor(db, emp, ym);
  const pol = ptPolicy(db);
  const pfMonth = s.pfEnabled === false ? 0 : Math.round(pfOf(s.pf, { basic: b.basic, ceiling: s.pfCeiling, basis: s.pfBasis, epsApplies: s.epsApplies }).employee);
  const done = months.filter((m) => m < ym);
  const rest = months.filter((m) => m >= ym);
  let gross = Number(emp.prevIncome) || 0;
  let paid = Number(emp.prevTds) || 0;
  let pf = 0;
  let assumed = 0;
  done.forEach((m) => {
    const snap = frozenRun(db, m)?.snapshot?.[emp.id];
    if (snap) {
      gross += taxableOfSlip(snap);
      paid += lineOf(snap.deductions, 'Income Tax');
      pf += lineOf(snap.deductions, 'Provident');
    } else {
      // No locked payslip for that month: assume the usual pay and that tax was deducted evenly.
      gross += b.gross;
      pf += pfMonth;
      assumed++;
    }
  });
  const ahead = Math.max(rest.length - 1, 0);
  if (rest.length) {
    gross += (current.taxable ?? b.gross) + ahead * b.gross;
    pf += (current.pfEmployee ?? pfMonth) + ahead * pfMonth;
  }
  const n = months.length || 1;
  const ptMonth = s.ptEnabled === false ? 0 : ptMonthly(pol, ptStateOf(pol, emp), b.gross, ym);
  const opts = { months: n, ptAnnual: ptMonth * n, pfAnnual: pf };
  // Both regimes on the same pay, so an employee can compare them; the one they are in is the one used.
  const byRegime = { New: incomeTax(gross, 'New', decl, b.basic * n, b.hra * n, opts), Old: incomeTax(gross, 'Old', decl, b.basic * n, b.hra * n, opts) };
  const tax = byRegime[regime] || byRegime.New;
  // Months with no locked payslip are assumed to have had tax deducted evenly on normal pay (not on this month's bonus).
  const normal = incomeTax((Number(emp.prevIncome) || 0) + n * b.gross, regime, decl, b.basic * n, b.hra * n, { months: n, ptAnnual: ptMonth * n, pfAnnual: pfMonth * n });
  paid += (normal.tax * assumed) / n;
  const left_ = Math.max(tax.tax - paid, 0);
  const monthly = rest.length ? left_ / rest.length : 0;
  return { regime, fy, months, monthsDone: done.length, monthsLeft: rest.length, grossYear: gross, byRegime, taxable: tax.taxable, annualTax: tax.tax, surcharge: tax.surcharge, cess: tax.cess, paid, remaining: left_, monthly, prevIncome: Number(emp.prevIncome) || 0, prevTds: Number(emp.prevTds) || 0, declared: !!decl };
}

// ---- loans: instalment, balance and what is still owed ----
export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
// Equal monthly instalment. With an interest rate it is a reducing-balance loan; with none, the plain split.
export function loanEmi(l) {
  const n = Math.max(Number(l.tenureMonths) || 1, 1);
  const p = Number(l.amount) || 0;
  const r = (Number(l.interestRate) || 0) / 1200;
  if (!(r > 0)) return p / n;
  const f = Math.pow(1 + r, n);
  return (p * r * f) / (f - 1);
}
// What is still owed after k instalments have been paid.
export function loanBalanceAfter(l, k) {
  const n = Math.max(Number(l.tenureMonths) || 1, 1);
  const p = Number(l.amount) || 0;
  const paid = Math.min(Math.max(Math.floor(k), 0), n);
  if (paid >= n) return 0;
  const r = (Number(l.interestRate) || 0) / 1200;
  if (!(r > 0)) return p - (p / n) * paid;
  const f = Math.pow(1 + r, paid);
  return p * f - (loanEmi(l) * (f - 1)) / r;
}
// Instalments already deducted before payroll month ym.
export const loanPaidBefore = (l, ym) => (l.startMonth && l.startMonth < ym ? Math.min(Number(l.tenureMonths) || 1, monthsBetween(l.startMonth, ym)) : 0);
export const loanOutstanding = (l, ym) => loanBalanceAfter(l, loanPaidBefore(l, ym));
// True when payroll month ym deducts an instalment of this loan.
export const loanDueIn = (l, ym) => l.status === 'Active' && l.startMonth <= ym && addMonths(l.startMonth, (Number(l.tenureMonths) || 1) - 1) >= ym;

// One employee's pay for one month, including loss-of-pay days and loan EMIs.
// Pay cycle for a payroll month: with a start day of 26, November runs 26 Oct – 25 Nov.
export function cycleRange(ym, startDay = 1) {
  const sd = Number(startDay) || 1;
  if (sd <= 1) return [`${ym}-01`, `${ym}-${pad(daysInMonth(ym))}`];
  const prev = addMonths(ym, -1);
  const from = `${prev}-${pad(Math.min(sd, daysInMonth(prev)))}`;
  const to = addDays(`${ym}-${pad(Math.min(sd, daysInMonth(ym)))}`, -1);
  return [from, to];
}
// The cycle a date falls in, named by the month it ends in: with a start day of 26,
// 20 Nov is in the November cycle (26 Oct - 25 Nov) and 26 Nov starts the December cycle.
export const cycleMonthOf = (date = todayISO(), startDay = 1) => {
  const sd = Number(startDay) || 1;
  const ym = date.slice(0, 7);
  return sd > 1 && Number(date.slice(8)) >= sd ? addMonths(ym, 1) : ym;
};
// "26 Oct - 25 Nov"
export function cycleLabel(ym, startDay) {
  const [a, b] = cycleRange(ym, startDay);
  const f = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
  return `${f(a)} – ${f(b)}`;
}
export const cycleStartOf = (db) => Number(db?.payrollSettings?.cycleStartDay) || 1;
export const cycleDays = (ym, startDay) => {
  const [a, b] = cycleRange(ym, startDay);
  return Math.round((parseISO(b) - parseISO(a)) / 86400000) + 1;
};
// Once a month is locked its payslips are frozen (run.snapshot), so a later change to a
// structure, a leave rule or someone's salary cannot rewrite a month that was already paid.
const frozenRun = (db, ym) => {
  const r = (db.payrollRuns || []).find((x) => x.month === ym);
  return r && ['Finalized', 'Paid'].includes(r.status) && r.snapshot ? r : null;
};
export const payrollPeople = (db, ym, live = false) => {
  const run = live ? null : frozenRun(db, ym);
  if (run) return db.employees.filter((e) => run.snapshot[e.id]);
  const [start, end] = cycleRange(ym, db.payrollSettings.cycleStartDay);
  // Someone settled and marked Exited is still paid for the cycle their last working day falls in.
  const leftEarlier = (e) => e.status === 'Exited' && !(db.exits || []).some((x) => x.empId === e.id && x.status === 'Settled' && x.lastWorkingDay >= start);
  return db.employees.filter((e) => e.status !== 'Pre-boarding' && !leftEarlier(e) && e.dateOfJoining <= end);
};
// Pay for these kinds is taxed in the month it is paid (Reimbursement is not taxable).
export const TAXABLE_ONE_OFF = ['Bonus', 'Incentive', 'Overtime', 'Arrears'];
// The numbers to store when payroll is locked: every payslip, without the employee record.
export function snapshotPayroll(db, ym) {
  const out = {};
  payrollPeople(db, ym, true).forEach((e) => {
    const { emp, ...slip } = payslipFor(db, e, ym, true);
    out[e.id] = JSON.parse(JSON.stringify(slip));
  });
  return out;
}

// Freeze every locked month that has no snapshot yet (older saved data, fresh demo data).
export function freezeLockedRuns(db) {
  (db.payrollRuns || []).forEach((r) => {
    if (['Finalized', 'Paid'].includes(r.status) && !r.snapshot) r.snapshot = snapshotPayroll(db, r.month);
  });
  return db;
}

export function payslipFor(db, emp, ym, live = false) {
  if (!live) {
    const snap = frozenRun(db, ym)?.snapshot?.[emp.id];
    if (snap) return { emp, ...snap };
  }
  const s = settingsFor(db, emp, ym);
  const group = payGroupOf(db, emp);
  const structure = structureOf(db, emp);
  const b = salaryBreakup(emp.ctc, s, structure);
  const dim = cycleDays(ym, s.cycleStartDay);
  const [cf, ct] = cycleRange(ym, s.cycleStartDay);
  // Loss of pay in this cycle: approved LOP leave, plus any part of other leave that a rule
  // turned into LOP (late notice, back-dated, combined with PL...). Weekly offs and holidays
  // that the sandwich rule counted are already inside the request's day count.
  const lopType = db.leaveTypes.find((t) => t.code === 'LOP');
  let lop = 0;
  db.leaveRequests
    .filter((r) => r.empId === emp.id && r.status === 'Approved' && r.from >= cf && r.from <= ct)
    .forEach((r) => {
      if (lopType && r.typeId === lopType.id) lop += Number(r.days || 0);
      else lop += Number(r.lopDays || 0);
    });
  const extra = (db.payrollAdjustments || []).filter((a) => a.empId === emp.id && a.month === ym);
  lop += extra.filter((a) => a.kind === 'LOP days').reduce((t, a) => t + Number(a.amount || 0), 0);
  // Days HR decided were loss of pay (Attendance exceptions). Exception employees are exempt from attendance.
  if (emp.attendanceExempt !== 'Yes') (db.attendanceResolutions || []).filter((r) => r.empId === emp.id && r.date >= cf && r.date <= ct).forEach((r) => (lop += RESOLUTION_LOP[r.resolution] || 0));
  // Joiners and leavers are paid only for the days they were employed in the cycle.
  const gap = (a, b) => Math.max(0, Math.round((parseISO(b) - parseISO(a)) / 86400000));
  if (emp.dateOfJoining > cf) lop += gap(cf, emp.dateOfJoining);
  const exit = (db.exits || []).find((x) => x.empId === emp.id && x.status !== 'Withdrawn' && x.lastWorkingDay >= cf && x.lastWorkingDay < ct);
  if (exit) lop += gap(exit.lastWorkingDay, ct);
  lop = Math.min(lop, dim);
  const factor = Math.max(dim - lop, 0) / dim;
  const earnings = b.earnings.map(([k, v]) => [k, v * factor]);
  extra.filter((a) => a.kind !== 'Deduction' && a.kind !== 'LOP days').forEach((a) => earnings.push([a.kind + (a.note ? ` (${a.note})` : ''), Number(a.amount)]));
  const gross = earnings.reduce((t, [, v]) => t + v, 0);
  const basic = earnings[0][1];
  // Income tax: the year's tax is projected from pay so far plus this month and the months left (taxProjection).
  // A bonus or arrears raises the projection, so its tax is spread over the months that remain.
  const taxableNow = earnings.reduce((t, [k, v]) => t + (k.startsWith('Reimbursement') ? 0 : v), 0);
  const oneOff = extra.filter((a) => TAXABLE_ONE_OFF.includes(a.kind)).reduce((t, a) => t + Number(a.amount || 0), 0);
  const oneOffTax = 0;
  const ov = (db.payrollOverrides || []).find((o) => o.empId === emp.id && o.month === ym) || {};
  const pick = (k, v) => (ov[k] === '' || ov[k] === undefined || ov[k] === null ? v : Number(ov[k]));
  const deductions = [];
  // Provident fund on the basic actually earned, so loss of pay lowers the employee's and the employer's share alike.
  // Each amount is rounded to the rupee, as the ECR is.
  // Arrears from a back-dated revision carry their own basic, which PF is also due on.
  const arrearsBasic = extra.reduce((t, a) => t + Number(a.pfBasis || a.pfBasic || 0), 0);
  const pfRaw = s.pfEnabled === false ? null : pfOf(s.pf, { basic: basic + arrearsBasic, ceiling: s.pfCeiling, basis: s.pfBasis, epsApplies: s.epsApplies });
  const R = Math.round;
  const pf = pfRaw && { ceiling: pfRaw.ceiling, wage: R(pfRaw.wage), epsWage: R(pfRaw.epsWage), edliWage: R(pfRaw.edliWage), employee: R(pfRaw.employee), employer: R(pfRaw.employer), eps: R(pfRaw.eps), epf: R(pfRaw.employer) - R(pfRaw.eps), edli: R(pfRaw.edli), admin: pfRaw.admin };
  if (pf) deductions.push(['Provident Fund (Employee)', pf.employee]);
  const employer = b.employer.map(([k, v]) => (k === 'Employer PF' ? [k, pf ? pf.employer : 0] : k === 'EDLI (employer)' ? [k, pf ? pf.edli : 0] : k === 'EPF admin charges' ? [k, pf ? pf.admin : 0] : [k, v]));
  // Professional Tax: a fixed amount if the pay group sets one, otherwise the state's slab on half-yearly income, taken monthly.
  const ptp = ptPolicy(db);
  const ptSlab = ptMonthly(ptp, ptStateOf(ptp, emp), b.gross, ym);
  const pt = pick('pt', s.ptEnabled === false ? 0 : Number(s.ptAmount) > 0 ? Number(s.ptAmount) : ptSlab);
  if (pt) deductions.push(['Professional Tax', pt]);
  // ESI: wages exclude overtime and similar; coverage follows the contribution period (see esiCovered).
  const cover = esiCovered(db, emp, ym);
  const esiWages = Math.max(earnings.reduce((t, [k, v], i) => t + (i >= b.earnings.length && ESI_EXCLUDED.some((x) => k.startsWith(x)) ? 0 : v), 0), 0);
  const esiEmployee = cover.covered ? esiAmount(esiWages, s.esi.employeeRate) : 0;
  const esiEmployer = cover.covered ? esiAmount(esiWages, s.esi.employerRate) : 0;
  const esi = pick('esi', esiEmployee);
  if (esi) deductions.push(['ESI (Employee)', esi]);
  if (esiEmployer) employer.push(['Employer ESI', esiEmployer]);
  // Labour Welfare Fund is taken only in its due months (yearly or half-yearly), not every month.
  const lwfNow = s.lwfEnabled && lwfDue(lwfPolicy(db), ym);
  const lwf = pick('lwf', lwfNow ? Number(s.lwfEmployee ?? 0) : 0);
  if (lwf) deductions.push(['Labour Welfare Fund', lwf]);
  if (lwfNow && Number(s.lwfEmployer) > 0) employer.push(['Employer LWF', Number(s.lwfEmployer)]);
  const tax = taxProjection(db, emp, ym, { taxable: taxableNow, pfEmployee: pf ? pf.employee : 0 });
  const regime = tax.regime;
  deductions.push(['Income Tax (TDS)', pick('tds', Math.round(tax.monthly))]);
  db.loans.filter((l) => l.empId === emp.id && loanDueIn(l, ym)).forEach((l) => deductions.push([`${l.type} EMI`, loanEmi(l)]));
  extra.filter((a) => a.kind === 'Deduction').forEach((a) => deductions.push([`Other deduction${a.note ? ` (${a.note})` : ''}`, Number(a.amount)]));
  const totalDed = deductions.reduce((t, [, v]) => t + v, 0);
  const onHold = (db.payrollHolds || []).some((h) => h.empId === emp.id && h.month === ym);
  return { emp, ym, dim, lop, paidDays: dim - lop, earnings, deductions, gross, totalDed, net: gross - totalDed, employer, pf, tax, esi: { covered: cover.covered, wages: R(esiWages), employee: esi, employer: esiEmployer, period: cover.period }, regime, tax, oneOffTax, onHold, payGroup: group?.name || '', payGroupId: group?.id || '', structure: structure?.name || '' };
}
