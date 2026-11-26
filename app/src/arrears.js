// Arrears owed when a salary revision is approved with an effective date in months that are already locked.
import { salaryBreakup, settingsFor, structureOf, cycleStartOf, cycleMonthOf, cycleRange, cycleDays, addMonths, parseISO, ymOf } from './utils.js';

// The first month whose payroll is not locked yet.
export function openMonth(db) {
  const done = (db.payrollRuns || []).filter((r) => ['Finalized', 'Paid'].includes(r.status)).map((r) => r.month).sort();
  return done.length ? addMonths(done[done.length - 1], 1) : ymOf();
}

// For every locked month from the effective date up to the open one: the gross and basic the employee should have got on the new
// pay, less what they got on the old, for the days the revision covers and the days they were actually paid.
// Returns { amount, pfBasic, months, openMonth }. A revision that lowers pay gives no arrears.
export function revisionArrears(db, emp, oldCtc, newCtc, effectiveFrom) {
  const sd = cycleStartOf(db);
  const open = openMonth(db);
  const months = [];
  let amount = 0;
  let pfBasic = 0;
  for (let m = cycleMonthOf(effectiveFrom, sd); m < open; m = addMonths(m, 1)) {
    const [cf, ct] = cycleRange(m, sd);
    const days = cycleDays(m, sd);
    const from = effectiveFrom > cf ? effectiveFrom : cf;
    const covered = Math.min(Math.round((parseISO(ct) - parseISO(from)) / 86400000) + 1, days) / days;
    const snap = (db.payrollRuns || []).find((r) => r.month === m && ['Finalized', 'Paid'].includes(r.status))?.snapshot?.[emp.id];
    const paid = snap && snap.dim ? snap.paidDays / snap.dim : 1;
    const s = settingsFor(db, emp, m);
    const st = structureOf(db, emp);
    const nb = salaryBreakup(newCtc, s, st);
    const ob = salaryBreakup(oldCtc, s, st);
    amount += (nb.gross - ob.gross) * covered * paid;
    pfBasic += (nb.basic - ob.basic) * covered * paid;
    months.push(m);
  }
  return { amount: amount > 0 ? Math.round(amount) : 0, pfBasic: amount > 0 ? Math.round(pfBasic) : 0, months, openMonth: open };
}
