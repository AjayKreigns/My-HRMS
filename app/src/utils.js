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

// ---------- leave ----------
export function countLeaveDays(db, from, to, fromHalf, toHalf) {
  if (!from || !to || to < from) return 0;
  const hol = new Set(db.holidays.filter((h) => h.type !== 'Optional').map((h) => h.date));
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = parseISO(d).getDay();
    if (wd === 0 || wd === 6 || hol.has(d)) continue;
    n += 1;
  }
  if (n > 0 && fromHalf && fromHalf !== 'Full day') n -= 0.5;
  if (n > 0 && to !== from && toHalf && toHalf !== 'Full day') n -= 0.5;
  return Math.max(n, 0);
}

export function leaveBalances(db, empId, year = new Date().getFullYear()) {
  const emp = empById(db, empId);
  return db.leaveTypes
    .filter((t) => !t.gender || t.gender === 'All' || !emp || t.gender === emp.gender)
    .map((t) => {
      const taken = db.leaveRequests
        .filter((r) => r.empId === empId && r.typeId === t.id && r.status === 'Approved' && r.from.startsWith(String(year)))
        .reduce((s, r) => s + Number(r.days || 0), 0);
      const pending = db.leaveRequests
        .filter((r) => r.empId === empId && r.typeId === t.id && r.status === 'Pending')
        .reduce((s, r) => s + Number(r.days || 0), 0);
      const adj = (db.leaveAdjustments || [])
        .filter((a) => a.empId === empId && a.typeId === t.id)
        .reduce((s, a) => s + Number(a.days || 0), 0);
      const quota = Number(t.annualQuota || 0) + Number((emp?.carryForward || {})[t.id] || 0) + adj;
      return { type: t, quota, taken, pending, available: t.unlimited ? Infinity : quota - taken - pending };
    });
}

export function onLeave(db, empId, date) {
  return db.leaveRequests.find((r) => r.empId === empId && r.status === 'Approved' && r.from <= date && r.to >= date);
}
export function isHoliday(db, date) {
  return db.holidays.find((h) => h.date === date && h.type !== 'Optional');
}

// ---------- attendance ----------
// Past working days get a generated log unless the person recorded something real.
export function attendanceFor(db, empId, date) {
  const real = db.attendance.find((a) => a.empId === empId && a.date === date);
  const wd = parseISO(date).getDay();
  const hol = isHoliday(db, date);
  const lv = onLeave(db, empId, date);
  const emp = empById(db, empId);
  const shift = db.shifts.find((s) => s.id === emp?.shiftId) || db.shifts[0];
  const base = { date, empId, shift };
  if (real) return { ...base, ...real, status: real.clockIn ? (real.wfh ? 'WFH' : 'Present') : 'Absent' };
  if (wd === 0 || wd === 6) return { ...base, status: 'Weekly off' };
  if (hol) return { ...base, status: 'Holiday', note: hol.name };
  if (lv) return { ...base, status: 'Leave', note: db.leaveTypes.find((t) => t.id === lv.typeId)?.name };
  const today = todayISO();
  if (date >= today || (emp && date < emp.dateOfJoining)) return { ...base, status: date === today ? 'Not clocked in' : '' };
  const r = seeded(empId + date);
  const x = r();
  if (x < 0.03) return { ...base, status: 'Absent' };
  const inMin = 8 * 60 + 45 + Math.floor(r() * 80);
  const outMin = inMin + 8 * 60 + Math.floor(r() * 100);
  const t = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { ...base, clockIn: t(inMin), clockOut: t(outMin), status: x > 0.9 ? 'WFH' : 'Present', generated: true };
}

export function arrival(rec) {
  if (!rec.clockIn) return '';
  const late = minutesBetween(rec.shift?.start || '09:30', rec.clockIn) - Number(rec.shift?.grace || 0);
  return late > 0 ? `${hm(late)} late` : 'On time';
}

// ---------- payroll ----------
export function salaryBreakup(ctcAnnual, settings) {
  const s = settings || {};
  const monthly = Number(ctcAnnual || 0) / 12;
  const basic = monthly * (Number(s.basicPct ?? 40) / 100);
  const hra = basic * (Number(s.hraPct ?? 50) / 100);
  const pfWage = Math.min(basic, Number(s.pfCeiling ?? 15000));
  const employerPf = s.pfEnabled === false ? 0 : pfWage * 0.12;
  const conveyance = Math.min(Number(s.conveyance ?? 1600), monthly);
  const medical = Math.min(Number(s.medical ?? 1250), monthly);
  const gratuity = basic * 0.0481;
  const gross = monthly - employerPf - gratuity;
  const special = Math.max(gross - basic - hra - conveyance - medical, 0);
  return {
    monthly,
    earnings: [
      ['Basic', basic],
      ['House Rent Allowance', hra],
      ['Conveyance Allowance', conveyance],
      ['Medical Allowance', medical],
      ['Special Allowance', special],
    ],
    employer: [
      ['Employer PF', employerPf],
      ['Gratuity', gratuity],
    ],
    gross: basic + hra + conveyance + medical + special,
    pfWage,
  };
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
export const cycleDays = (ym, startDay) => {
  const [a, b] = cycleRange(ym, startDay);
  return Math.round((parseISO(b) - parseISO(a)) / 86400000) + 1;
};
export const payrollPeople = (db, ym) => {
  const end = cycleRange(ym, db.payrollSettings.cycleStartDay)[1];
  return db.employees.filter((e) => e.status !== 'Exited' && e.status !== 'Pre-boarding' && e.dateOfJoining <= end);
};

export function payslipFor(db, emp, ym) {
  const s = db.payrollSettings;
  const b = salaryBreakup(emp.ctc, s);
  const dim = cycleDays(ym, s.cycleStartDay);
  const lopType = db.leaveTypes.find((t) => t.code === 'LOP');
  let lop = 0;
  if (lopType) {
    db.leaveRequests
      .filter((r) => r.empId === emp.id && r.typeId === lopType.id && r.status === 'Approved' && r.from.startsWith(ym))
      .forEach((r) => (lop += Number(r.days || 0)));
  }
  const extra = (db.payrollAdjustments || []).filter((a) => a.empId === emp.id && a.month === ym);
  lop += extra.filter((a) => a.kind === 'LOP days').reduce((t, a) => t + Number(a.amount || 0), 0);
  // Joiners and leavers are paid only for the days they were employed in the cycle.
  const [cf, ct] = cycleRange(ym, s.cycleStartDay);
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
  const tax = incomeTax(b.gross * 12, regime, decl, b.earnings[0][1] * 12, b.earnings[1][1] * 12);
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
  return { emp, ym, dim, lop, paidDays: dim - lop, earnings, deductions, gross, totalDed, net: gross - totalDed, employer: b.employer, regime, tax, onHold };
}
