// Payroll register: one row per employee with every earning, deduction and employer cost
// of the month, and a totals row. Pure function, so it can be tested and reused.
import { payrollPeople, payslipFor, fullName } from './utils.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const union = (lists) => {
  const out = [];
  lists.forEach((l) => l.forEach((k) => out.includes(k) || out.push(k)));
  return out;
};

// groupId '' means every pay group.
export function payrollRegister(db, ym, groupId = '') {
  const slips = payrollPeople(db, ym)
    .map((e) => payslipFor(db, e, ym))
    .filter((s) => !groupId || s.payGroupId === groupId);
  const earnNames = union(slips.map((s) => s.earnings.map(([k]) => k)));
  const dedNames = union(slips.map((s) => s.deductions.map(([k]) => k)));
  const erNames = union(slips.map((s) => s.employer.map(([k]) => k)));
  const get = (list, name) => (s) => list(s).find(([k]) => k === name)?.[1] || 0;

  const text = (label, f) => ({ label, csv: (s) => (s.total ? '' : f(s)) });
  const num = (label, f) => ({ label, num: true, csv: (s) => r2(f(s)) });
  const columns = [
    { label: 'Emp no', csv: (s) => (s.total ? 'Total' : s.emp.empNo) },
    text('Employee', (s) => fullName(s.emp)),
    text('Department', (s) => s.emp.department),
    text('Designation', (s) => s.emp.designation),
    text('Date of joining', (s) => s.emp.dateOfJoining),
    text('Pay group', (s) => s.payGroup),
    text('Pay structure', (s) => s.structure),
    text('PAN', (s) => s.emp.pan),
    text('UAN', (s) => s.emp.uan),
    text('Bank', (s) => s.emp.bank?.bankName),
    text('Account number', (s) => s.emp.bank?.accountNumber),
    text('IFSC', (s) => s.emp.bank?.ifsc),
    num('Annual CTC', (s) => s.emp.ctc),
    num('Calendar days', (s) => s.dim),
    num('LOP days', (s) => s.lop),
    num('Paid days', (s) => s.paidDays),
    ...earnNames.map((k) => num(k, get((s) => s.earnings, k))),
    num('Gross earnings', (s) => s.gross),
    ...dedNames.map((k) => num(k, get((s) => s.deductions, k))),
    num('Total deductions', (s) => s.totalDed),
    num('Net pay', (s) => s.net),
    ...erNames.map((k) => num(`Employer: ${k}`, get((s) => s.employer, k))),
    text('On hold', (s) => (s.onHold ? 'Yes' : 'No')),
  ];
  // Rows read their numbers from the payslip; the totals row sums every numeric column.
  const total = { total: true };
  columns.forEach((c) => {
    if (c.num) total[c.label] = slips.reduce((t, s) => t + (Number(c.csv(s)) || 0), 0);
  });
  const withTotal = columns.map((c) => (c.num ? { ...c, csv: (s) => (s.total ? r2(total[c.label]) : c.csv(s)) } : c));
  // 'Annual CTC', calendar and paid days are not meaningful as totals.
  const blankTotals = new Set(['Calendar days']);
  const finalCols = withTotal.map((c) => (blankTotals.has(c.label) ? { ...c, csv: (s) => (s.total ? '' : c.csv(s)) } : c));
  return { columns: finalCols, rows: [...slips, total], count: slips.length, totals: { gross: total['Gross earnings'] || 0, deductions: total['Total deductions'] || 0, net: total['Net pay'] || 0 } };
}
