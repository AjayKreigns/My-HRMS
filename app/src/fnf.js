// Full and final settlement for an exit.
import { empById, breakupFor, gratuityApplies, gratuityPolicy, gratuityPayable, parseISO, monthLabel, cycleMonthOf, cycleStartOf, cycleRange, cycleDays, loanEmi, loanOutstanding, loanDueIn } from './utils.js';
import { leaveBalances } from './leave.js';
import { exitPolicy } from './statutory.js';

// Full and final. The last month's salary is paid by the normal payroll run (prorated over the
// pay cycle the last working day falls in); `post` lists the other items to add to that month's payroll.
export function fnfFor(db, exit) {
  const emp = empById(db, exit.empId);
  const b = breakupFor(db, emp);
  const basic = b.earnings[0][1];
  const lwd = exit.lastWorkingDay;
  const startDay = cycleStartOf(db);
  const ym = cycleMonthOf(lwd, startDay);
  const [cycleFrom] = cycleRange(ym, startDay);
  const dim = cycleDays(ym, startDay);
  const paidDays = Math.min(Math.max(Math.round((parseISO(lwd) - parseISO(cycleFrom)) / 864e5) + 1, 0), dim);
  const salary = (b.gross / dim) * paidDays;
  const el = leaveBalances(db, emp.id).find((x) => x.type.encashable === 'Yes');
  // How a day's pay is worked out and how many days are paid or recovered are the company's exit settings (Payroll > Settings > Full & final).
  const ep = exitPolicy(db);
  const dayPay = (basis, divisor) => (basis === 'gross' ? b.gross : basic) / (Number(divisor) > 0 ? Number(divisor) : 1);
  const encashDays = el && ep.encashEnabled !== false ? (ep.encashMaxDays > 0 ? Math.min(Math.max(el.available, 0), ep.encashMaxDays) : Math.max(el.available, 0)) : 0;
  const encash = encashDays * dayPay(ep.encashBasis, ep.encashDivisor);
  const years = (parseISO(lwd) - parseISO(emp.dateOfJoining)) / (365.25 * 864e5);
  // The formula, the service needed (5 years; 1 for fixed-term staff), the rounding and the cap are the
  // company's gratuity policy (Payroll > Settings > Gratuity).
  const g = gratuityPayable(gratuityPolicy(db), basic, years, emp.workerType);
  const gratuity = gratuityApplies(db, emp) ? g.amount : 0;
  const served = Math.round((parseISO(lwd) - parseISO(exit.resignationDate)) / 864e5);
  const shortfall = Math.max(Number(emp.noticePeriodDays || 0) - served, 0);
  const recoveredDays = ep.noticeCapDays > 0 ? Math.min(shortfall, ep.noticeCapDays) : shortfall;
  const recovery = exit.waiveNotice === 'Yes' ? 0 : dayPay(ep.noticeBasis, ep.noticeDivisor) * recoveredDays;
  // Everything still owed on active loans. This month's instalment is already taken by the payroll run.
  const myLoans = db.loans.filter((l) => l.empId === emp.id && l.status === 'Active');
  const loanOwed = myLoans.reduce((t, l) => t + loanOutstanding(l, ym), 0);
  const loanInPayroll = myLoans.filter((l) => loanDueIn(l, ym)).reduce((t, l) => t + loanEmi(l), 0);
  const loanExtra = Math.max(loanOwed - loanInPayroll, 0);
  const items = [
    [`Salary for final month (${paidDays} of ${dim} days) — paid in the ${monthLabel(ym)} payroll`, salary],
    [`Leave encashment (${encashDays} days)`, encash],
    [`Gratuity (${years.toFixed(1)} years${emp.workerType === 'Contract' ? ', fixed-term' : ''}${g.capped ? ', capped' : ''})`, gratuity],
    [`Notice shortfall recovery (${exit.waiveNotice === 'Yes' ? 0 : recoveredDays} days)`, -recovery],
    [`Outstanding loan recovery${loanInPayroll ? ' (includes this month’s EMI)' : ''}`, -loanOwed],
  ];
  const post = [
    encash > 0 && { kind: 'Leave encashment', amount: Math.round(encash), note: 'Full and final' },
    gratuity > 0 && { kind: 'Gratuity', amount: Math.round(gratuity), note: 'Full and final' },
    recovery > 0 && { kind: 'Deduction', amount: Math.round(recovery), note: 'Notice shortfall recovery' },
    loanExtra > 0 && { kind: 'Deduction', amount: Math.round(loanExtra), note: 'Loan balance recovery' },
  ].filter(Boolean);
  return { emp, items, post, ym, net: items.reduce((s, [, v]) => s + v, 0) };
}
