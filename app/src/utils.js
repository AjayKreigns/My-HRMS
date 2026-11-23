// Shared helpers: dates, money, payroll maths, attendance and leave calculations.

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

export function money(n, cur = 'INR') {
  const v = Math.round(Number(n) || 0);
  return (cur === 'INR' ? '₹' : cur + ' ') + v.toLocaleString('en-IN');
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
    pfCeiling: s.pfCeiling ?? 15000,
    esiEnabled: s.esiEnabled !== false,
    ptEnabled: s.ptEnabled !== false,
    ptAmount: s.ptAmount ?? 208,
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
  const pfWage = Math.min(basic, Number(s.pfCeiling ?? 15000));
  const employerPf = s.pfEnabled === false || st.employerPf === false ? 0 : pfWage * 0.12;
  const gratuity = st.gratuity === false ? 0 : basic * (Number(st.gratuityPct ?? 4.81) / 100);
  const amounts = comps.map((c, i) => (c.type === 'Balance' ? null : i === 0 ? basic : val(c, basic)));
  const fixedSum = amounts.reduce((t, a) => t + (a || 0), 0);
  const balance = Math.max(monthly - employerPf - gratuity - fixedSum, 0);
  const earnings = comps.map((c, i) => [c.name, amounts[i] === null ? balance : amounts[i]]);
  const hraAt = comps.findIndex((c) => c.role === 'hra');
  return {
    monthly,
    earnings,
    employer: [
      ['Employer PF', employerPf],
      ['Gratuity', gratuity],
    ],
    gross: earnings.reduce((t, [, v]) => t + v, 0),
    pfWage,
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
  return list.find((x) => x.id === emp?.structureId) || list.find((x) => x.id === payGroupOf(db, emp)?.structureId) || defaultOf(list);
};
// Company payroll settings with the pay group's statutory switches laid over them.
export function settingsFor(db, emp) {
  const g = payGroupOf(db, emp) || {};
  const over = {};
  GROUP_KEYS.forEach((k) => {
    if (g[k] !== undefined && g[k] !== '') over[k] = g[k];
  });
  return { ...db.payrollSettings, ...over };
}
export const breakupFor = (db, emp) => salaryBreakup(emp?.ctc, settingsFor(db, emp), structureOf(db, emp));

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

export function incomeTax(annualGross, regime = 'New', decl, basicAnnual = 0, hraAnnual = 0) {
  let taxable;
  if (regime === 'Old') {
    const d = declarationTotal(decl);
    const hraEx = d.hraRent ? Math.max(Math.min(hraAnnual, d.hraRent - basicAnnual * 0.1, basicAnnual * 0.4), 0) : 0;
    taxable = Math.max(annualGross - 50000 - 2400 - hraEx - d.c80 - d.d80 - d.other, 0);
    let tax = slabTax(taxable, OLD_SLABS);
    if (taxable <= 500000) tax = 0;
    return { taxable, tax: tax * 1.04 };
  }
  taxable = Math.max(annualGross - 75000, 0);
  let tax = slabTax(taxable, NEW_SLABS);
  if (taxable <= 1200000) tax = 0;
  return { taxable, tax: tax * 1.04 };
}

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
  const end = cycleRange(ym, db.payrollSettings.cycleStartDay)[1];
  return db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding' && e.dateOfJoining <= end);
};
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
  const s = settingsFor(db, emp);
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
  const decl = db.taxDeclarations.find((d) => d.empId === emp.id);
  const regime = decl?.regime || emp.taxRegime || 'New';
  const tax = incomeTax(b.gross * 12, regime, decl, b.basic * 12, b.hra * 12);
  const ov = (db.payrollOverrides || []).find((o) => o.empId === emp.id && o.month === ym) || {};
  const pick = (k, v) => (ov[k] === '' || ov[k] === undefined || ov[k] === null ? v : Number(ov[k]));
  const deductions = [];
  if (s.pfEnabled !== false) deductions.push(['Provident Fund (Employee)', Math.min(basic, Number(s.pfCeiling ?? 15000)) * 0.12]);
  const pt = pick('pt', s.ptEnabled !== false && gross > 15000 ? Number(s.ptAmount ?? 208) : 0);
  if (pt) deductions.push(['Professional Tax', pt]);
  const esi = pick('esi', s.esiEnabled !== false && gross <= 21000 ? gross * 0.0075 : 0);
  if (esi) deductions.push(['ESI (Employee)', esi]);
  const lwf = pick('lwf', s.lwfEnabled ? Number(s.lwfEmployee ?? 0) : 0);
  if (lwf) deductions.push(['Labour Welfare Fund', lwf]);
  deductions.push(['Income Tax (TDS)', pick('tds', tax.tax / 12)]);
  db.loans
    .filter((l) => l.empId === emp.id && l.status === 'Active' && l.startMonth <= ym && addMonths(l.startMonth, Number(l.tenureMonths) - 1) >= ym)
    .forEach((l) => deductions.push([`${l.type} EMI`, Number(l.amount) / Number(l.tenureMonths || 1)]));
  extra.filter((a) => a.kind === 'Deduction').forEach((a) => deductions.push([`Other deduction${a.note ? ` (${a.note})` : ''}`, Number(a.amount)]));
  const totalDed = deductions.reduce((t, [, v]) => t + v, 0);
  const onHold = (db.payrollHolds || []).some((h) => h.empId === emp.id && h.month === ym);
  return { emp, ym, dim, lop, paidDays: dim - lop, earnings, deductions, gross, totalDed, net: gross - totalDed, employer: b.employer, regime, tax, onHold, payGroup: group?.name || '', payGroupId: group?.id || '', structure: structure?.name || '' };
}
