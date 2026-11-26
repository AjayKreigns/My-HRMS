// Payroll checks. Run: node app/tests/payroll.test.mjs
import assert from 'node:assert/strict';
import { seed } from '../src/seed.js';
import { payslipFor, salaryBreakup, settingsFor, structureOf, breakupFor, gratuityPolicy, gratuityPayable, GRATUITY_DEFAULTS, incomeTax, loanEmi, loanBalanceAfter, loanOutstanding, payrollPeople, snapshotPayroll, cycleMonthOf, cycleStartOf, cycleRange, addMonths, addDays, todayISO } from '../src/utils.js';
import { fnfFor } from '../src/fnf.js';
import { pfPolicy, pfCeilingOn, pfCeilingForCycle, adminTotal, esiPeriodOf, ptPolicy, ptHalfYear, ptMonthly, wagePolicy, wageShare } from '../src/statutory.js';
import { ecrFile, esiRows, ESI_COLUMNS } from '../src/statutoryFiles.js';
import { revisionArrears } from '../src/arrears.js';
import { recordChanges } from '../src/auditLog.js';
import { queuePayslipMail, mailSettings, smtpReady } from '../src/payslipMail.js';
import { payslipPassword, payslipPdf } from '../src/payslipPdf.js';
import { exceptionDays, unresolvedDays, setResolution } from '../src/attendanceExceptions.js';
import { approvalPolicy, approverIds, canApproveRun, canApproveUnlock, lockRun, submitRun, withdrawRun, approveRun, rejectRun, unlockRun, requestUnlock, approveUnlock, rejectUnlock, cancelUnlock, markInputsChanged, saveApprovalSettings, runSummary } from '../src/payrollApproval.js';

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

const base = seed();
const ym = cycleMonthOf(todayISO(), cycleStartOf(base));
const mk = () => {
  const db = clone(base);
  db.payrollRuns = (db.payrollRuns || []).filter((r) => r.month !== ym);
  db.payrollAdjustments = [];
  db.leaveRequests = [];
  db.loans = [];
  db.exits = [];
  db.payrollOverrides = [];
  const emp = db.employees.find((e) => e.status === 'Active' && e.dateOfJoining < '2024-01-01' && e.ctc >= 600000 && e.ctc <= 1100000);
  assert.ok(emp, 'seed has a mid-salary active employee');
  return { db, emp };
};
const line = (list, name) => (list.find(([k]) => k.startsWith(name)) || [0, 0])[1];
const loanOf = (emp, extra = {}) => ({ id: 'l1', empId: emp.id, type: 'Personal Loan', amount: 120000, tenureMonths: 12, interestRate: 12, startMonth: ym, status: 'Active', ...extra });

console.log('loans');
ok('no interest splits evenly', () => near(loanEmi({ amount: 60000, tenureMonths: 6, interestRate: 0 }), 10000, 0.001));
ok('12% for 12 months is the standard EMI', () => near(loanEmi({ amount: 100000, tenureMonths: 12, interestRate: 12 }), 8884.88, 0.01));
ok('balance reaches zero after the last EMI', () => {
  const l = { amount: 100000, tenureMonths: 12, interestRate: 12 };
  assert.equal(loanBalanceAfter(l, 12), 0);
  near(loanBalanceAfter(l, 11), 8884.88 / 1.01, 0.5);
});
ok('paying every EMI clears the loan', () => {
  const l = { amount: 50000, tenureMonths: 10, interestRate: 9 };
  let bal = 50000;
  for (let k = 0; k < 10; k++) bal = bal * (1 + 0.09 / 12) - loanEmi(l);
  near(bal, 0, 0.01);
});
ok('outstanding follows the months paid', () => near(loanOutstanding({ amount: 60000, tenureMonths: 6, interestRate: 0, startMonth: '2026-01' }, '2026-04'), 30000, 0.001));
ok('payslip deducts the interest-bearing EMI', () => {
  const { db, emp } = mk();
  db.loans = [loanOf(emp)];
  near(line(payslipFor(db, emp, ym, true).deductions, 'Personal Loan EMI'), loanEmi(db.loans[0]), 0.01);
});

console.log('provident fund');
ok('employer PF follows loss of pay like the employee share', () => {
  const { db, emp } = mk();
  emp.ctc = 420000; // basic is under the PF ceiling, so a cut in pay shows up in PF
  const full = payslipFor(db, emp, ym, true);
  db.payrollAdjustments = [{ id: 'a1', empId: emp.id, month: ym, kind: 'LOP days', amount: 10 }];
  const cut = payslipFor(db, emp, ym, true);
  assert.ok(cut.lop >= 10);
  const pf = (s) => line(s.deductions, 'Provident Fund');
  assert.ok(pf(cut) < pf(full), 'employee PF falls');
  near(line(cut.employer, 'Employer PF'), pf(cut), 0.01);
  near(line(full.employer, 'Employer PF'), pf(full), 0.01);
});

console.log('tax');
ok('marginal relief just over the 12 lakh limit', () => {
  near(incomeTax(1200000 + 75000 + 10000, 'New').tax, 10000 * 1.04, 1);
  assert.equal(incomeTax(1200000 + 75000, 'New').tax, 0);
});
ok('well above the limit the normal slabs apply', () => near(incomeTax(2000000 + 75000, 'New').tax, 200000 * 1.04, 0.01));
ok('a bonus raises the year projection, so TDS rises by the extra tax spread over the months left', () => {
  const { db, emp } = mk();
  const plain = payslipFor(db, emp, ym, true);
  db.payrollAdjustments = [{ id: 'b1', empId: emp.id, month: ym, kind: 'Bonus', amount: 300000 }];
  const withBonus = payslipFor(db, emp, ym, true);
  const tds = (s) => line(s.deductions, 'Income Tax');
  assert.ok(withBonus.tax.annualTax > plain.tax.annualTax, 'a 3 lakh bonus is taxed');
  assert.ok(tds(withBonus) > tds(plain));
  near(tds(withBonus) - tds(plain), (withBonus.tax.annualTax - plain.tax.annualTax) / withBonus.tax.monthsLeft, 1);
});
ok('a reimbursement is not taxed', () => {
  const { db, emp } = mk();
  const a = line(payslipFor(db, emp, ym, true).deductions, 'Income Tax');
  db.payrollAdjustments = [{ id: 'r1', empId: emp.id, month: ym, kind: 'Reimbursement', amount: 50000 }];
  near(line(payslipFor(db, emp, ym, true).deductions, 'Income Tax'), a, 0.001);
});

console.log('locked months');
ok('a locked month does not change when pay rules change afterwards', () => {
  const { db, emp } = mk();
  db.payrollRuns.push({ id: 'run1', month: ym, status: 'Finalized', snapshot: snapshotPayroll(db, ym) });
  const before = JSON.stringify(payslipFor(db, emp, ym).deductions);
  db.loans = [loanOf(emp, { id: 'l2' })];
  db.payrollAdjustments = [{ id: 'b2', empId: emp.id, month: ym, kind: 'Bonus', amount: 90000 }];
  assert.equal(JSON.stringify(payslipFor(db, emp, ym).deductions), before);
});

console.log('full and final');
const withExit = (empPatch = {}, lwdOffset = null) => {
  const { db, emp } = mk();
  Object.assign(emp, empPatch);
  const [from, to] = cycleRange(ym, db.payrollSettings.cycleStartDay);
  const lwd = lwdOffset === null ? to : addDays(from, lwdOffset);
  db.exits = [{ id: 'x1', empId: emp.id, status: 'Approved', resignationDate: from, lastWorkingDay: lwd, waiveNotice: 'Yes', checklist: {} }];
  return { db, emp, exit: db.exits[0] };
};
ok('final month is prorated over the pay cycle, not the calendar month', () => {
  const { db, exit } = withExit({}, 9);
  const calc = fnfFor(db, exit);
  assert.match(calc.items[0][0], /10 of \d+ days/);
  assert.equal(calc.ym, ym);
});
ok('outstanding loan is the balance, not one EMI', () => {
  const { db, emp, exit } = withExit();
  db.loans = [loanOf(emp, { amount: 60000, tenureMonths: 6, interestRate: 0, startMonth: addMonths(ym, -2) })];
  const calc = fnfFor(db, exit);
  near(-calc.items[4][1], 40000, 0.01);
  near(calc.post.find((p) => p.note === 'Loan balance recovery').amount, 30000, 0.01);
});
ok('contract staff get gratuity after one year, permanent staff do not', () => {
  const a = withExit({ workerType: 'Contract', dateOfJoining: '2024-01-01' });
  const b = withExit({ workerType: 'Permanent', dateOfJoining: '2024-01-01' });
  assert.ok(fnfFor(a.db, a.exit).post.some((p) => p.kind === 'Gratuity'));
  assert.ok(!fnfFor(b.db, b.exit).post.some((p) => p.kind === 'Gratuity'));
});
ok('permanent staff with five years get gratuity', () => {
  const c = withExit({ workerType: 'Permanent', dateOfJoining: '2015-01-01' });
  assert.ok(fnfFor(c.db, c.exit).post.some((p) => p.kind === 'Gratuity'));
});
ok('someone settled and marked Exited is still paid for their last cycle', () => {
  const { db, emp, exit } = withExit();
  exit.status = 'Settled';
  emp.status = 'Exited';
  assert.ok(payrollPeople(db, ym, true).some((e) => e.id === emp.id));
  assert.ok(!payrollPeople(db, addMonths(ym, 1), true).some((e) => e.id === emp.id), 'but not the month after');
});

console.log('PF opt-out on the employee');
ok('blank follows the pay group, No removes PF, Yes forces it on', () => {
  const { db, emp } = mk();
  const slip = () => payslipFor(db, emp, ym);
  assert.ok(line(slip().deductions, 'Provident') > 0, 'PF is deducted by default');
  emp.pfApplies = 'No';
  assert.equal(line(slip().deductions, 'Provident'), 0);
  assert.equal(slip().employer[0][1], 0, 'employer PF is zero too');
  emp.pfApplies = '';
  assert.ok(line(slip().deductions, 'Provident') > 0, 'blank goes back to the group');
  db.payGroups.forEach((g) => (g.pfEnabled = false));
  assert.equal(line(slip().deductions, 'Provident'), 0, 'group with PF off');
  emp.pfApplies = 'Yes';
  assert.ok(line(slip().deductions, 'Provident') > 0, 'Yes overrides a group with PF off');
});

console.log('gratuity on the employee');
ok('No removes gratuity from the CTC and the full and final; Yes brings it back', () => {
  const { db, emp } = mk();
  const grat = () => line(breakupFor(db, emp).employer, 'Gratuity');
  assert.ok(grat() > 0, 'structure has gratuity by default');
  emp.gratuityApplies = 'No';
  assert.equal(grat(), 0);
  const exit = { id: 'x1', empId: emp.id, exitType: 'Resignation', resignationDate: addDays(todayISO(), -60), lastWorkingDay: todayISO(), status: 'Approved' };
  emp.dateOfJoining = '2010-01-01';
  assert.ok(!fnfFor(db, exit).post.some((p) => p.kind === 'Gratuity'), 'nothing paid on exit');
  emp.gratuityApplies = '';
  assert.ok(grat() > 0 && fnfFor(db, exit).post.some((p) => p.kind === 'Gratuity'), 'blank follows the structure');
  db.payStructures.forEach((s) => (s.gratuity = false));
  assert.equal(grat(), 0);
  emp.gratuityApplies = 'Yes';
  assert.ok(grat() > 0, 'Yes overrides a structure without gratuity');
});

console.log('gratuity policy');
ok('defaults are the Act: 15/26, 5 years (1 fixed-term), 6-month rounding, 20 lakh cap', () => {
  const p = gratuityPolicy({});
  assert.deepEqual(p, { enabled: true, eligibility: 'all', daysPerYear: 15, monthDays: 26, minYears: 5, minYearsFixedTerm: 1, roundMonths: 6, cap: 2000000 });
  near(gratuityPayable(p, 26000, 7.6, 'Permanent').amount, (15 / 26) * 26000 * 8, 0.01);
  near(gratuityPayable(p, 26000, 7.4, 'Permanent').amount, (15 / 26) * 26000 * 7, 0.01);
  assert.equal(gratuityPayable(p, 26000, 4.9, 'Permanent').amount, 0);
  assert.ok(gratuityPayable(p, 26000, 1.2, 'Contract').amount > 0);
  assert.equal(gratuityPayable(p, 500000, 30, 'Permanent').amount, 2000000, 'capped');
});
ok('every part of the formula can be changed', () => {
  const base = { ...GRATUITY_DEFAULTS };
  near(gratuityPayable({ ...base, daysPerYear: 30 }, 26000, 10, 'Permanent').amount, 300000, 0.01); // 30/26 x 26000 x 10
  near(gratuityPayable({ ...base, monthDays: 30 }, 30000, 10, 'Permanent').amount, 0.5 * 30000 * 10, 0.01);
  assert.equal(gratuityPayable({ ...base, minYears: 3 }, 26000, 3.2, 'Permanent').amount > 0, true);
  assert.equal(gratuityPayable({ ...base, roundMonths: 12 }, 26000, 7.9, 'Permanent').countedYears, 7);
  assert.equal(gratuityPayable({ ...base, cap: 0 }, 500000, 30, 'Permanent').amount > 2000000, true, 'no limit');
  assert.equal(gratuityPayable({ ...base, cap: 100000 }, 26000, 10, 'Permanent').amount, 100000);
});
ok('full and final uses the saved policy', () => {
  const { db, emp } = mk();
  emp.dateOfJoining = '2010-01-01';
  const exit = { id: 'x2', empId: emp.id, exitType: 'Resignation', resignationDate: addDays(todayISO(), -60), lastWorkingDay: todayISO(), status: 'Approved' };
  const paid = () => (fnfFor(db, exit).post.find((p) => p.kind === 'Gratuity') || { amount: 0 }).amount;
  const before = paid();
  assert.ok(before > 0);
  db.payrollSettings.gratuityPolicy = { cap: 50000 };
  assert.equal(paid(), 50000);
  db.payrollSettings.gratuityPolicy = { minYears: 40 };
  assert.equal(paid(), 0);
  db.payrollSettings.gratuityPolicy = { daysPerYear: 30 };
  near(paid(), Math.min(before * 2, 2000000), 2);
});

ok('switching gratuity off removes it everywhere and keeps the settings', () => {
  const { db, emp } = mk();
  emp.dateOfJoining = '2010-01-01';
  const exit = { id: 'x3', empId: emp.id, exitType: 'Resignation', resignationDate: addDays(todayISO(), -60), lastWorkingDay: todayISO(), status: 'Approved' };
  const grat = () => line(breakupFor(db, emp).employer, 'Gratuity');
  const paid = () => fnfFor(db, exit).post.some((p) => p.kind === 'Gratuity');
  assert.ok(gratuityPolicy(db).enabled && grat() > 0 && paid(), 'on by default');
  db.payrollSettings.gratuityPolicy = { enabled: false, cap: 123456 };
  assert.equal(grat(), 0, 'not in the CTC');
  assert.ok(!paid(), 'not paid on exit');
  emp.gratuityApplies = 'Yes';
  assert.equal(grat(), 0, 'an employee setting cannot turn it back on');
  assert.equal(gratuityPolicy(db).cap, 123456, 'other values kept');
  db.payrollSettings.gratuityPolicy = { enabled: true, cap: 123456 };
  assert.ok(grat() > 0 && paid());
});

ok('selected-employees mode gives gratuity only to those marked Yes', () => {
  const { db, emp } = mk();
  const other = db.employees.find((e) => e.id !== emp.id && e.status === 'Active' && e.ctc > 0);
  const grat = (e) => line(breakupFor(db, e).employer, 'Gratuity');
  assert.ok(grat(emp) > 0 && grat(other) > 0, 'everyone by default');
  db.payrollSettings.gratuityPolicy = { eligibility: 'selected' };
  assert.equal(grat(emp), 0, 'nobody until chosen');
  emp.gratuityApplies = 'Yes';
  assert.ok(grat(emp) > 0, 'chosen');
  assert.equal(grat(other), 0, 'not chosen');
  other.gratuityApplies = 'No';
  assert.equal(grat(other), 0);
  emp.dateOfJoining = '2010-01-01';
  const exit = (e) => ({ id: 'x4', empId: e.id, exitType: 'Resignation', resignationDate: addDays(todayISO(), -60), lastWorkingDay: todayISO(), status: 'Approved' });
  other.dateOfJoining = '2010-01-01';
  assert.ok(fnfFor(db, exit(emp)).post.some((p) => p.kind === 'Gratuity'));
  assert.ok(!fnfFor(db, exit(other)).post.some((p) => p.kind === 'Gratuity'));
  db.payrollSettings.gratuityPolicy = { eligibility: 'all' };
  assert.ok(grat(other) === 0 && grat(emp) > 0, 'back to all: No still means No, blank follows the structure');
});

console.log('provident fund rules');
const JAN = '2027-01'; // a cycle wholly after the ceiling change
const hi = (db, emp, patch = {}) => {
  Object.assign(emp, { ctc: 1200000, dateOfJoining: '2020-01-01', ...patch }); // basic 40,000 a month
  return emp;
};
ok('the ceiling follows the dated rules and a cycle that holds the change blends the days', () => {
  const pol = pfPolicy({});
  assert.equal(pfCeilingOn(pol, '2026-09-16'), 15000);
  assert.equal(pfCeilingOn(pol, '2026-09-17'), 25000);
  assert.equal(pfCeilingOn(pol, '2030-01-01'), 25000);
  near(pfCeilingForCycle(pol, '2026-08-26', '2026-09-25'), (22 * 15000 + 9 * 25000) / 31, 0.01);
  assert.equal(pfCeilingForCycle(pol, '2026-12-26', '2027-01-25'), 25000);
  assert.equal(pfCeilingForCycle(pol, '2026-05-26', '2026-06-25'), 15000);
});
ok('payslips use the ceiling of their own cycle', () => {
  const { db, emp } = mk();
  hi(db, emp);
  assert.equal(payslipFor(db, emp, JAN, true).pf.ceiling, 25000);
  assert.equal(payslipFor(db, emp, '2026-06', true).pf.ceiling, 15000);
  near(payslipFor(db, emp, '2026-09', true).pf.ceiling, (22 * 15000 + 9 * 25000) / 31, 0.01);
});
ok('capped basis: 12% of the ceiling, employer share split into EPS and EPF', () => {
  const { db, emp } = mk();
  hi(db, emp);
  const s = payslipFor(db, emp, JAN, true);
  assert.equal(s.pf.wage, 25000);
  assert.equal(s.pf.employee, 3000);
  assert.equal(s.pf.employer, 3000);
  assert.equal(s.pf.eps, 2083); // 8.33% of 25,000, rounded
  assert.equal(s.pf.epf, 917);
  assert.equal(s.pf.eps + s.pf.epf, s.pf.employer);
  assert.equal(line(s.deductions, 'Provident'), 3000);
});
ok('actual basis: 12% of the full basic, pension still on the ceiling', () => {
  const { db, emp } = mk();
  hi(db, emp, { pfBasis: 'Actual basic' });
  const s = payslipFor(db, emp, JAN, true);
  assert.equal(s.pf.wage, 40000);
  assert.equal(s.pf.employee, 4800);
  assert.equal(s.pf.epsWage, 25000);
  assert.equal(s.pf.eps, 2083);
  assert.equal(s.pf.epf, 4800 - 2083);
  emp.pfBasis = '';
  db.payrollSettings.pfPolicy = { basis: 'actual' };
  assert.equal(payslipFor(db, emp, JAN, true).pf.wage, 40000, 'blank follows the company setting');
  emp.pfBasis = 'Capped at ceiling';
  assert.equal(payslipFor(db, emp, JAN, true).pf.wage, 25000, 'the employee choice wins');
});
ok('a member with no pension share has the whole employer share in EPF', () => {
  const { db, emp } = mk();
  hi(db, emp, { epsApplies: 'No' });
  const s = payslipFor(db, emp, JAN, true);
  assert.equal(s.pf.eps, 0);
  assert.equal(s.pf.epsWage, 0);
  assert.equal(s.pf.epf, 3000);
});
ok('every rate, the ceiling and the charges can be changed', () => {
  const { db, emp } = mk();
  hi(db, emp);
  db.payrollSettings.pfPolicy = { employeeRate: 10, employerRate: 11, epsRate: 7, edliRate: 1, adminRate: 1, rules: [{ from: '2000-01-01', ceiling: 20000 }] };
  const s = payslipFor(db, emp, JAN, true);
  assert.equal(s.pf.wage, 20000);
  assert.equal(s.pf.employee, 2000);
  assert.equal(s.pf.employer, 2200);
  assert.equal(s.pf.eps, 1400);
  assert.equal(s.pf.edli, 200);
  assert.equal(s.pf.admin, 200);
  db.payGroups.forEach((g) => (g.pfCeiling = 18000));
  assert.equal(payslipFor(db, emp, JAN, true).pf.wage, 18000, 'a pay group can have its own ceiling');
});
ok('employer PF and charges come out of the CTC only when set so', () => {
  const { db, emp } = mk();
  hi(db, emp);
  const gross = () => breakupFor(db, emp, JAN).gross;
  const inside = gross();
  const pfAmt = line(breakupFor(db, emp, JAN).employer, 'Employer PF');
  assert.ok(pfAmt > 0);
  db.payStructures.forEach((s) => (s.employerPf = false));
  near(gross() - inside, pfAmt, 0.01); // paid on top, so the pay is higher by that much
  assert.ok(line(breakupFor(db, emp, JAN).employer, 'Employer PF') > 0, 'but still paid');
  const before = gross();
  db.payrollSettings.pfPolicy = { chargesInCtc: true };
  assert.ok(gross() < before, 'EDLI and admin now reduce the pay');
});
ok('the ECR file has the 11 fields of ECR 2.0 and leaves out members with no UAN', () => {
  const { db, emp } = mk();
  hi(db, emp, { uan: '100 2003 0040', firstName: 'Anita', middleName: '', lastName: "D'Souza" });
  const other = db.employees.find((e) => e.id !== emp.id && e.status === 'Active');
  other.uan = '';
  const f = ecrFile(db, [payslipFor(db, emp, JAN, true), payslipFor(db, other, JAN, true)]);
  assert.equal(f.lines.length, 1);
  assert.deepEqual(f.missing.map((e) => e.id), [other.id]);
  const parts = f.lines[0].split('#~#');
  assert.equal(parts.length, 11);
  assert.equal(parts[0], '10020030040');
  assert.equal(parts[1], 'ANITA D SOUZA');
  assert.deepEqual(parts.slice(3), ['25000', '25000', '25000', '3000', '2083', '917', '0', '0']);
  assert.ok(Number(parts[2]) > 25000, 'gross wages are the full gross');
});
ok('months locked before the PF split was stored still give an ECR line', () => {
  const { db, emp } = mk();
  hi(db, emp, { uan: '123456789012' });
  const slip = JSON.parse(JSON.stringify(payslipFor(db, emp, JAN, true)));
  delete slip.pf;
  const line1 = ecrFile(db, [{ ...slip, emp }]).lines[0].split('#~#');
  assert.deepEqual(line1.slice(3, 9), ['25000', '25000', '25000', '3000', '2083', '917']);
});
ok('the administration charge for the month never goes under the minimum', () => {
  assert.equal(adminTotal({ adminMin: 500 }, 120), 500);
  assert.equal(adminTotal({ adminMin: 500 }, 900), 900);
  assert.equal(adminTotal({ adminMin: 500 }, 0), 0);
});

console.log('ESI');
const lowPay = (db, emp, patch = {}) => Object.assign(emp, { ctc: 240000, dateOfJoining: '2020-01-01', ...patch }); // gross about 18,600
ok('covered up to the limit: employee 0.75% and employer 3.25%, rounded up', () => {
  const { db, emp } = mk();
  lowPay(db, emp);
  const s = payslipFor(db, emp, JAN, true);
  assert.ok(s.gross <= 21000 && s.esi.covered);
  assert.equal(line(s.deductions, 'ESI'), Math.ceil(s.gross * 0.0075 - 1e-9));
  assert.equal(line(s.employer, 'Employer ESI'), Math.ceil(s.gross * 0.0325 - 1e-9));
  const hiPay = payslipFor(db, hi(db, emp), JAN, true);
  assert.equal(line(hiPay.deductions, 'ESI'), 0);
  assert.equal(line(hiPay.employer, 'Employer ESI'), 0);
});
ok('overtime is not ESI wages', () => {
  const { db, emp } = mk();
  lowPay(db, emp);
  const plain = payslipFor(db, emp, JAN, true);
  db.payrollAdjustments = [{ id: 'o1', empId: emp.id, month: JAN, kind: 'Overtime', amount: 9000 }];
  const withOt = payslipFor(db, emp, JAN, true);
  assert.ok(withOt.gross > plain.gross + 8000);
  assert.equal(withOt.esi.wages, plain.esi.wages);
  assert.equal(line(withOt.deductions, 'ESI'), line(plain.deductions, 'ESI'));
});
ok('the contribution period decides: a raise keeps cover to the end of the period, not into the next', () => {
  const { db, emp } = mk();
  lowPay(db, emp, { ctc: 480000 }); // today's pay is above the limit
  db.promotions = [{ id: 'p1', empId: emp.id, status: 'Approved', effectiveFrom: '2026-12-01', oldCtc: 240000, newCtc: 480000, newDesignation: 'x' }];
  assert.ok(payslipFor(db, emp, JAN, true).esi.covered, 'January is in the October to March period, decided on October pay');
  assert.ok(payslipFor(db, emp, '2027-03', true).esi.covered);
  assert.ok(!payslipFor(db, emp, '2027-04', true).esi.covered, 'April starts a new period, decided on April pay');
  assert.ok(payslipFor(db, emp, '2026-11', true).esi.covered);
});
ok('a joiner is judged on their first month in the period', () => {
  const { db, emp } = mk();
  lowPay(db, emp, { dateOfJoining: '2026-12-10' });
  assert.ok(payslipFor(db, emp, '2027-02', true).esi.covered);
  lowPay(db, emp, { ctc: 480000, dateOfJoining: '2026-12-10' });
  assert.ok(!payslipFor(db, emp, '2027-02', true).esi.covered);
});
ok('the limit, rates, periods and the on/off switch are editable', () => {
  const { db, emp } = mk();
  lowPay(db, emp);
  db.payrollSettings.esiPolicy = { grossLimit: 15000 };
  assert.ok(!payslipFor(db, emp, JAN, true).esi.covered, 'limit lowered');
  db.payrollSettings.esiPolicy = { employeeRate: 1, employerRate: 4 };
  const s = payslipFor(db, emp, JAN, true);
  assert.equal(line(s.deductions, 'ESI'), Math.ceil(s.gross * 0.01 - 1e-9));
  assert.equal(line(s.employer, 'Employer ESI'), Math.ceil(s.gross * 0.04 - 1e-9));
  assert.deepEqual(esiPeriodOf({ periodStart1: 1, periodStart2: 7 }, '2027-03'), { start: '2027-01', end: '2027-06' });
  assert.deepEqual(esiPeriodOf({}, '2027-02'), { start: '2026-10', end: '2027-03' });
  assert.deepEqual(esiPeriodOf({}, '2026-06'), { start: '2026-04', end: '2026-09' });
  db.payrollSettings.esiPolicy = { enabled: false };
  assert.equal(line(payslipFor(db, emp, JAN, true).deductions, 'ESI'), 0, 'off for the company');
  db.payrollSettings.esiPolicy = {};
  db.payGroups.forEach((g) => (g.esiEnabled = false));
  assert.equal(line(payslipFor(db, emp, JAN, true).deductions, 'ESI'), 0, 'off for the pay group');
});
ok('the ESI file uses the ESIC template columns', () => {
  const { db, emp } = mk();
  lowPay(db, emp, { esiNumber: '3112345678' });
  const f = esiRows(db, [payslipFor(db, emp, JAN, true)]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].cols.length, ESI_COLUMNS.length);
  assert.equal(f.rows[0].cols[0], '3112345678');
  assert.equal(f.rows[0].cols[4], 0, 'reason code 0 when days were worked');
  emp.esiNumber = '';
  assert.deepEqual(esiRows(db, [payslipFor(db, emp, JAN, true)]).missing.map((e) => e.id), [emp.id]);
});
ok('locked months keep their PF and ESI when the rules change', () => {
  const { db, emp } = mk();
  lowPay(db, emp);
  db.payrollRuns.push({ id: 'run9', month: ym, status: 'Finalized', snapshot: snapshotPayroll(db, ym) });
  const before = JSON.stringify(payslipFor(db, emp, ym));
  db.payrollSettings.pfPolicy = { employeeRate: 20, rules: [{ from: '2000-01-01', ceiling: 99999 }] };
  db.payrollSettings.esiPolicy = { employeeRate: 5, grossLimit: 1 };
  assert.equal(JSON.stringify(payslipFor(db, emp, ym)), before);
});

console.log('locking and approval');
const staged = (status = 'Processed') => {
  const { db } = mk();
  const admins = db.employees.filter((e) => e.role === 'admin' && e.status === 'Active');
  const [a, b] = admins;
  const c = db.employees.find((e) => e.role === 'employee' && e.status === 'Active');
  assert.ok(a && b && c, 'seed has two admins and an employee');
  db.payrollRuns.push({ id: 'ra', month: ym, status, processedAt: new Date().toISOString(), processedBy: a.id, steps: {} });
  db.notifications = [];
  db.payrollActivity = [];
  const run = () => db.payrollRuns.find((r) => r.month === ym);
  return { db, a, b, c, admins, run };
};
const sep = (db, approvers = []) => (db.payrollSettings.approval = { separate: true, approvers });
ok('approval is off by default: the person who processes can lock, and a snapshot freezes the month', () => {
  const { db, a, run } = staged();
  assert.equal(approvalPolicy(db).separate, false);
  assert.ok(lockRun(db, ym, a).ok);
  assert.equal(run().status, 'Finalized');
  assert.equal(run().lockedBy, a.id);
  assert.ok(run().snapshot && Object.keys(run().snapshot).length > 0);
  assert.ok(db.payrollActivity[0].text.startsWith('Locked'));
});
ok('only a processed month with no pending changes can be locked', () => {
  const { db, a, run } = staged('Draft');
  assert.equal(lockRun(db, ym, a).ok, false);
  run().status = 'Processed';
  run().dirty = true;
  assert.equal(lockRun(db, ym, a).ok, false);
});
ok('with a second approver, locking directly is refused and submitting notifies every other admin', () => {
  const { db, a, admins, run } = staged();
  sep(db);
  assert.equal(lockRun(db, ym, a).ok, false);
  const r = submitRun(db, ym, a);
  assert.ok(r.ok);
  assert.equal(run().status, 'Submitted');
  assert.equal(run().submittedBy, a.id);
  const told = db.notifications.map((n) => n.empId).sort();
  assert.deepEqual(told, admins.filter((x) => x.id !== a.id).map((x) => x.id).sort());
  assert.ok(!told.includes(a.id), 'not the submitter');
});
ok('the submitter cannot approve; another admin can, and approval locks the month', () => {
  const { db, a, b, run } = staged();
  sep(db);
  submitRun(db, ym, a);
  const self = approveRun(db, ym, a);
  assert.equal(self.ok, false);
  assert.equal(run().status, 'Submitted');
  assert.ok(approveRun(db, ym, b).ok);
  assert.equal(run().status, 'Finalized');
  assert.equal(run().approvedBy, b.id);
  assert.equal(run().submittedBy, a.id);
  assert.ok(run().snapshot);
  assert.ok(db.notifications.some((x) => x.empId === a.id && /approved/.test(x.text)), 'submitter is told');
});
ok('chosen approvers replace the admin default and can be anyone, not only admins', () => {
  const { db, a, b, c, run } = staged();
  sep(db, [c.id]);
  assert.deepEqual(approverIds(db), [c.id]);
  submitRun(db, ym, a);
  assert.equal(canApproveRun(db, b, run()), false, 'an admin who is not chosen cannot approve');
  assert.equal(approveRun(db, ym, b).ok, false);
  assert.ok(db.notifications.some((x) => x.empId === c.id), 'the chosen approver is told');
  assert.ok(approveRun(db, ym, c).ok);
  assert.equal(run().status, 'Finalized');
});
ok('if the only approver is the submitter, submitting says so instead of getting stuck', () => {
  const { db, a } = staged();
  sep(db, [a.id]);
  const r = submitRun(db, ym, a);
  assert.equal(r.ok, false);
  assert.match(r.error, /No one else/);
});
ok('sending back needs a reason, keeps it on the month, and the same person can submit again', () => {
  const { db, a, b, run } = staged();
  sep(db);
  submitRun(db, ym, a);
  assert.equal(rejectRun(db, ym, b, '  ').ok, false);
  assert.ok(rejectRun(db, ym, b, 'Bonus for Priya is missing').ok);
  assert.equal(run().status, 'Processed');
  assert.equal(run().rejection.reason, 'Bonus for Priya is missing');
  assert.ok(db.notifications.some((x) => x.empId === a.id && /Bonus for Priya/.test(x.text)));
  assert.ok(submitRun(db, ym, a).ok);
  assert.equal(run().rejection, undefined, 'the note clears on resubmitting');
});
ok('a change after submitting withdraws the submission', () => {
  const { db, a, b, run } = staged();
  sep(db);
  submitRun(db, ym, a);
  markInputsChanged(db, ym, b);
  assert.equal(run().status, 'Processed');
  assert.equal(run().dirty, true);
  assert.ok(db.notifications.some((x) => x.empId === a.id && /changed after you submitted/.test(x.text)));
  assert.equal(approveRun(db, ym, b).ok, false);
});
ok('without an approver, an admin unlocks directly but must give a reason, and the snapshot is dropped', () => {
  const { db, a, run } = staged();
  lockRun(db, ym, a);
  assert.equal(unlockRun(db, ym, a, '').ok, false);
  assert.equal(run().status, 'Finalized');
  assert.ok(unlockRun(db, ym, a, 'Wrong LOP for Imran').ok);
  assert.equal(run().status, 'Processed');
  assert.equal(run().dirty, true);
  assert.equal(run().snapshot, undefined);
  assert.equal(run().unlockReason, 'Wrong LOP for Imran');
  assert.match(db.payrollActivity[0].text, /Wrong LOP for Imran/);
});
ok('a paid month cannot be unlocked', () => {
  const { db, a, run } = staged();
  lockRun(db, ym, a);
  run().status = 'Paid';
  assert.equal(unlockRun(db, ym, a, 'oops').ok, false);
});
ok('with an approver, unlocking is a request: reason needed, someone else decides', () => {
  const { db, a, b, run } = staged();
  lockRun(db, ym, a);
  sep(db);
  assert.equal(unlockRun(db, ym, a, 'x').ok, false, 'no direct unlock');
  assert.equal(requestUnlock(db, ym, a, '').ok, false);
  assert.ok(requestUnlock(db, ym, a, 'Missed a joiner').ok);
  assert.equal(requestUnlock(db, ym, a, 'again').ok, false, 'one request at a time');
  assert.equal(run().status, 'Finalized', 'still locked');
  assert.ok(db.notifications.some((x) => x.empId === b.id && /Missed a joiner/.test(x.text)));
  assert.equal(approveUnlock(db, ym, a).ok, false, 'the requester cannot approve');
  assert.ok(approveUnlock(db, ym, b).ok);
  assert.equal(run().status, 'Processed');
  assert.equal(run().snapshot, undefined);
  assert.equal(run().unlockRequest, undefined);
  assert.ok(db.notifications.some((x) => x.empId === a.id && /approved/.test(x.text)));
});
ok('an unlock request can be declined with a reason or withdrawn', () => {
  const { db, a, b, run } = staged();
  lockRun(db, ym, a);
  sep(db);
  requestUnlock(db, ym, a, 'Missed a joiner');
  assert.equal(rejectUnlock(db, ym, b, '').ok, false);
  assert.ok(rejectUnlock(db, ym, b, 'Pay it next month as arrears').ok);
  assert.equal(run().status, 'Finalized');
  assert.equal(run().unlockRequest, undefined);
  requestUnlock(db, ym, a, 'Second try');
  assert.ok(cancelUnlock(db, ym, a).ok);
  assert.equal(run().unlockRequest, undefined);
});
ok('switching approval off cancels what was waiting', () => {
  const { db, a, run } = staged();
  sep(db);
  submitRun(db, ym, a);
  assert.ok(saveApprovalSettings(db, a, { separate: false, approvers: [] }).ok);
  assert.equal(run().status, 'Processed');
  assert.ok(lockRun(db, ym, a).ok, 'and can now be locked directly');
});
ok('the approver summary adds up the month', () => {
  const { db } = staged();
  const sum = runSummary(db, ym);
  assert.ok(sum.people > 5 && sum.net > 0);
  near(sum.gross, sum.net + sum.deductions, 0.01);
});

console.log('income tax projection');
const tdsOf = (s) => line(s.deductions, 'Income Tax');
ok('tax is rounded to ten rupees and surcharge has marginal relief', () => {
  assert.equal(incomeTax(2075000, 'New').tax % 10, 0);
  const at = incomeTax(5075000, 'New').tax; // taxable exactly 50 lakh: no surcharge yet
  const over = incomeTax(5075000 + 100000, 'New').tax; // 1 lakh over the surcharge threshold
  assert.ok(over - at <= 100000 * 1.04 + 10, `surcharge relief: tax rose by ${over - at} for 1 lakh more income`);
  assert.ok(incomeTax(5075000 + 2000000, 'New').tax > over);
});
ok('old regime: HRA uses the metro 50% of basic, and PF counts under 80C', () => {
  const decl = { items: { rentMonthly: 30000 } };
  const none = incomeTax(1500000, 'Old', null, 600000, 300000).taxable;
  const withRent = incomeTax(1500000, 'Old', decl, 600000, 300000).taxable;
  assert.equal(none - withRent, 300000, 'least of HRA 3L, rent 3.6L-0.6L=3.0L, 50% basic 3L');
  const withPf = incomeTax(1500000, 'Old', null, 600000, 300000, { pfAnnual: 100000 }).taxable;
  assert.equal(none - withPf, 100000);
});
ok('with no history the monthly TDS is the year tax split into twelve', () => {
  const { db, emp } = mk();
  hi(db, emp);
  const s = payslipFor(db, emp, '2027-01', true);
  assert.equal(s.tax.monthsLeft, 3);
  near(tdsOf(s), s.tax.annualTax / 12, 1);
});
ok('a month locked with less tax deducted is made up in the months that follow', () => {
  const { db, emp } = mk();
  hi(db, emp);
  const even = tdsOf(payslipFor(db, emp, '2027-01', true));
  const snap = snapshotPayroll(db, '2026-12');
  const slip = snap[emp.id];
  slip.deductions = slip.deductions.map(([k, v]) => (k.startsWith('Income Tax') ? [k, 0] : [k, v]));
  db.payrollRuns.push({ id: 'rx', month: '2026-12', status: 'Finalized', snapshot: snap });
  const after = payslipFor(db, emp, '2027-01', true);
  assert.ok(tdsOf(after) > even, 'January deducts more');
  assert.ok(after.tax.paid < after.tax.annualTax);
  const march = payslipFor(db, emp, '2027-03', true);
  assert.equal(march.tax.monthsLeft, 1);
  near(march.tax.monthly, march.tax.remaining, 0.01);
});
ok('a joiner is taxed on the months worked, and previous employer income and TDS are counted', () => {
  const { db, emp } = mk();
  hi(db, emp, { dateOfJoining: '2026-10-05' });
  const s = payslipFor(db, emp, '2027-01', true);
  assert.equal(s.tax.months.length, 6); // Nov cycle (joined 5 Oct) .. Mar
  const base = s.tax.annualTax;
  emp.prevIncome = 600000;
  emp.prevTds = 20000;
  const more = payslipFor(db, emp, '2027-01', true);
  assert.ok(more.tax.annualTax > base);
  assert.equal(more.tax.paid >= 20000, true);
});
ok('the default regime is new and an employee can switch to old', () => {
  const { db, emp } = mk();
  hi(db, emp, { taxRegime: '' });
  db.taxDeclarations = [];
  assert.equal(payslipFor(db, emp, '2027-01', true).regime, 'New');
  emp.taxRegime = 'Old';
  assert.equal(payslipFor(db, emp, '2027-01', true).regime, 'Old');
});

console.log('professional tax and labour welfare fund');
ok('Tamil Nadu slabs: monthly sixths that add up to the half-yearly amount', () => {
  const pol = ptPolicy({});
  assert.equal(ptHalfYear(pol, 'Tamil Nadu', 3000), 0);
  assert.equal(ptHalfYear(pol, 'Tamil Nadu', 6000), 315);
  assert.equal(ptHalfYear(pol, 'Tamil Nadu', 40000), 1250);
  const total = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].reduce((t, m) => t + ptMonthly(pol, 'Tamil Nadu', 40000, m), 0);
  assert.equal(total, 1250);
  assert.equal(ptMonthly(pol, 'Tamil Nadu', 40000, '2026-11'), 208);
  assert.equal(ptMonthly(pol, 'Tamil Nadu', 40000, '2027-03'), 210, 'last month of the half-year settles the total');
});
ok('payslips deduct the slab, a pay group can fix an amount, and the slabs are editable', () => {
  const { db, emp } = mk();
  hi(db, emp);
  assert.equal(line(payslipFor(db, emp, '2027-01', true).deductions, 'Professional Tax'), 208);
  db.payGroups.forEach((g) => (g.ptAmount = 100));
  assert.equal(line(payslipFor(db, emp, '2027-01', true).deductions, 'Professional Tax'), 100);
  db.payGroups.forEach((g) => delete g.ptAmount);
  db.payrollSettings.ptPolicy = { states: { 'Tamil Nadu': { slabs: [{ upTo: null, amount: 600 }] } } };
  assert.equal(line(payslipFor(db, emp, '2027-01', true).deductions, 'Professional Tax'), 100);
  db.payrollSettings.ptPolicy = { states: { 'Tamil Nadu': { slabs: [{ upTo: null, amount: 600 }] }, Kerala: { slabs: [{ upTo: null, amount: 1200 }] } } };
  emp.workState = 'Kerala';
  assert.equal(line(payslipFor(db, emp, '2027-01', true).deductions, 'Professional Tax'), 200, 'another state uses its own table');
});
ok('the labour welfare fund is taken only in its due month, and half-yearly when set so', () => {
  const { db, emp } = mk();
  db.payGroups.forEach((g) => Object.assign(g, { lwfEnabled: true, lwfEmployee: 20, lwfEmployer: 40 }));
  const lwf = (m) => line(payslipFor(db, emp, m, true).deductions, 'Labour Welfare');
  assert.equal(lwf('2026-12'), 20);
  assert.equal(lwf('2026-11'), 0);
  assert.equal(lwf('2027-01'), 0);
  assert.equal(line(payslipFor(db, emp, '2026-12', true).employer, 'Employer LWF'), 40);
  db.payrollSettings.lwfPolicy = { frequency: 'half-yearly', month: 12 };
  assert.equal(lwf('2026-06'), 20);
  assert.equal(lwf('2026-12'), 20);
  assert.equal(lwf('2026-09'), 0);
});

console.log('attendance exceptions');
const PAST = '2026-10';
const withExceptions = () => {
  const { db } = mk();
  const list = exceptionDays(db, PAST);
  assert.ok(list.length > 0, 'the sample data has absent days in that cycle');
  return { db, list, first: list[0] };
};
ok('absent and action-required days are listed, undecided, and an undecided day blocks nothing in the pay itself', () => {
  const { db, first } = withExceptions();
  assert.ok(['Absent', 'Action Required'].includes(first.status));
  assert.equal(first.resolution, '');
  assert.ok(unresolvedDays(db, PAST).length >= 1);
});
ok('deciding a day: Paid costs nothing, Loss of pay one day, Half day half a day; decisions can change', () => {
  const { db, first } = withExceptions();
  const lop = () => payslipFor(db, first.emp, PAST, true).lop;
  const start = lop();
  setResolution(db, first.emp.id, first.date, 'Paid', { id: 'u' });
  assert.equal(lop(), start);
  setResolution(db, first.emp.id, first.date, 'Loss of pay', { id: 'u' });
  assert.equal(lop(), start + 1);
  setResolution(db, first.emp.id, first.date, 'Half day loss of pay', { id: 'u' });
  assert.equal(lop(), start + 0.5);
  assert.equal(exceptionDays(db, PAST).find((x) => x.emp.id === first.emp.id && x.date === first.date).resolution, 'Half day loss of pay');
  setResolution(db, first.emp.id, first.date, '', { id: 'u' });
  assert.equal(lop(), start);
  assert.equal(db.attendanceResolutions.length, 0);
  assert.equal(setResolution(db, first.emp.id, first.date, 'Whatever', { id: 'u' }).ok, false);
});
ok('an exception employee is never listed and loses no pay for attendance', () => {
  const { db, first } = withExceptions();
  setResolution(db, first.emp.id, first.date, 'Loss of pay', { id: 'u' });
  const withLop = payslipFor(db, first.emp, PAST, true).lop;
  first.emp.attendanceExempt = 'Yes';
  assert.ok(!exceptionDays(db, PAST).some((x) => x.emp.id === first.emp.id));
  assert.equal(payslipFor(db, first.emp, PAST, true).lop, withLop - 1);
});

console.log('wage rule');
ok('wages share counts basic plus anything not excluded; the share and exclusions are the admin’s', () => {
  const pol = wagePolicy({});
  assert.equal(pol.minPct, 50);
  const earnings = [['Basic', 40], ['House Rent Allowance', 20], ['Conveyance Allowance', 10], ['Special Allowance', 30]];
  const w = wageShare(earnings, pol);
  assert.equal(w.pct, 40);
  assert.equal(w.below, true);
  assert.equal(wageShare(earnings, { ...pol, minPct: 40 }).below, false, 'admin lowers the share');
  assert.equal(wageShare(earnings, { ...pol, exclusions: ['House Rent Allowance'] }).pct, 80, 'admin changes the exclusions');
  assert.equal(wageShare(earnings, { ...pol, enabled: false }).below, false, 'switched off');
});

console.log('arrears');
ok('a back-dated revision owes arrears for the locked months it covers, and PF is due on the basic part', () => {
  const { db, emp } = mk();
  hi(db, emp, { dateOfJoining: '2020-01-01' });
  const sd = cycleStartOf(db);
  // lock the two months before the open one
  const prev2 = addMonths(ym, -2);
  const prev1 = addMonths(ym, -1);
  db.payrollRuns = (db.payrollRuns || []).filter((r) => r.month >= ym);
  [prev2, prev1].forEach((m) => db.payrollRuns.push({ id: `a${m}`, month: m, status: 'Finalized', snapshot: snapshotPayroll(db, m) }));
  const eff = cycleRange(prev2, sd)[0];
  const a = revisionArrears(db, emp, 1200000, 1320000, eff);
  assert.equal(a.openMonth, ym);
  assert.equal(a.months.length, 2);
  const g = (c) => breakupFor(db, emp, prev1);
  const nb = salaryBreakup(1320000, settingsFor(db, emp, prev1), structureOf(db, emp));
  const ob = salaryBreakup(1200000, settingsFor(db, emp, prev1), structureOf(db, emp));
  near(a.amount, (nb.gross - ob.gross) * 2, 3);
  near(a.pfBasic, (nb.basic - ob.basic) * 2, 3);
  assert.ok(a.amount > 0);
  assert.equal(revisionArrears(db, emp, 1320000, 1200000, eff).amount, 0, 'a cut gives none');
  assert.equal(revisionArrears(db, emp, 1200000, 1320000, cycleRange(ym, sd)[0]).amount, 0, 'dated in the open month: none');
  // the arrears land on the payslip as pay and carry basic for PF
  db.payrollAdjustments = [{ id: 'ar1', empId: emp.id, month: ym, kind: 'Arrears', amount: a.amount, pfBasis: a.pfBasic }];
  const slip = payslipFor(db, emp, ym, true);
  assert.ok(slip.earnings.some(([k]) => k.startsWith('Arrears')));
});

console.log('full and final settings');
ok('leave encashment and notice recovery follow the exit settings', () => {
  const { db, emp } = mk();
  emp.dateOfJoining = '2022-01-01';
  const [from, to] = cycleRange(ym, db.payrollSettings.cycleStartDay);
  const exit = { id: 'xs', empId: emp.id, exitType: 'Resignation', resignationDate: from, lastWorkingDay: addDays(from, 10), waiveNotice: 'No', status: 'Approved' };
  db.exits = [exit];
  const base = fnfFor(db, exit);
  const rec = (c) => -c.items.find(([k]) => k.startsWith('Notice shortfall'))[1];
  const enc = (c) => c.items.find(([k]) => k.startsWith('Leave encashment'))[1];
  assert.ok(rec(base) > 0);
  db.payrollSettings.exitPolicy = { noticeBasis: 'basic' };
  assert.ok(rec(fnfFor(db, exit)) < rec(base), 'a day on basic is less than on gross');
  db.payrollSettings.exitPolicy = { noticeCapDays: 1 };
  near(rec(fnfFor(db, exit)), rec(base) / (Number(emp.noticePeriodDays) - 10), 0.5);
  exit.waiveNotice = 'Yes';
  assert.equal(rec(fnfFor(db, exit)), 0, 'an admin can waive it');
  if (enc(base) > 0) {
    db.payrollSettings.exitPolicy = { encashEnabled: false };
    assert.equal(enc(fnfFor(db, exit)), 0);
    db.payrollSettings.exitPolicy = { encashMaxDays: 1, encashDivisor: 30, encashBasis: 'gross' };
    near(enc(fnfFor(db, exit)), breakupFor(db, emp).gross / 30, 0.5);
  }
});

console.log('audit, mail and PDF');
ok('pay-related changes are logged with who made them; unrelated edits are not', () => {
  const { db, emp } = mk();
  const before = clone(db);
  const e = db.employees.find((x) => x.id === emp.id);
  e.ctc = e.ctc + 120000;
  e.bank = { ...(e.bank || {}), accountNumber: '123456789012', ifsc: 'HDFC0001234' };
  e.phone = '999';
  db.payrollSettings.pfPolicy = { employeeRate: 10 };
  recordChanges(before, db, 'E100');
  const log = db.auditLog;
  assert.ok(log.every((a) => a.by === 'E100' && a.at));
  assert.ok(log.some((a) => a.field === 'CTC' && Number(a.to) === Number(a.from) + 120000));
  assert.ok(log.some((a) => a.field === 'Bank account number' && a.to === '••••9012'), 'account number is masked');
  assert.ok(log.some((a) => a.kind === 'Setting' && a.field === 'pfPolicy'));
  assert.ok(!log.some((a) => /phone/i.test(a.field)), 'a phone number change is not pay-related');
  const again = clone(db);
  recordChanges(db, again, 'E100');
  assert.equal(again.auditLog.length, log.length, 'no change, no entry');
});
ok('releasing payroll queues one payslip email per paid employee, once', () => {
  const { db } = mk();
  const people = db.employees.filter((e) => e.status === 'Active').slice(0, 3);
  people[2].workEmail = '';
  people[2].personalEmail = '';
  assert.equal(queuePayslipMail(db, ym, people), 3);
  assert.equal(queuePayslipMail(db, ym, people), 0, 'not twice');
  assert.ok(db.payslipOutbox.some((x) => x.status === 'Waiting for mail service'));
  assert.ok(db.payslipOutbox.some((x) => x.status === 'No email address'));
  assert.equal(smtpReady(mailSettings(db)), false);
  db.payrollSettings.mail = { enabled: true, host: 'smtp.example.com', fromEmail: 'payroll@example.com' };
  assert.equal(smtpReady(mailSettings(db)), true);
  assert.equal(queuePayslipMail(db, addMonths(ym, 1), people.slice(0, 1)), 1);
  assert.equal(db.payslipOutbox[0].status, 'Queued');
});
{
  assert.equal(payslipPassword({ empNo: 'E102', dob: '1990-01-20' }), 'E10220011990');
  const { db, emp } = mk();
  emp.dob = '1990-01-20';
  const doc = await payslipPdf(db, payslipFor(db, emp, ym, true));
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(raw.startsWith('%PDF'));
  assert.ok(raw.includes('/Encrypt'), 'password protected');
  n++;
  console.log('  ok the payslip PDF opens with the employee number and date of birth, and is encrypted');
}

console.log(`\n${n} checks passed`);
