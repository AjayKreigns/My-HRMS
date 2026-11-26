// Files for the provident fund and ESI portals, built from a month's payslips.
import { fullName, cycleRange, cycleStartOf } from './utils.js';
import { pfPolicy, pfCeilingForCycle, adminTotal, PF_DEFAULTS } from './statutory.js';

const R = Math.round;
const deduction = (slip, prefix) => (slip.deductions.find((d) => d[0].startsWith(prefix)) || [0, 0])[1];
// Portals accept letters and spaces in a name.
export const portalName = (e) => fullName(e).replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

// The PF figures of a payslip. Months locked before PF was split into its parts hold only the totals, so rebuild the parts.
export function pfDetail(db, slip) {
  if (slip.pf) return slip.pf;
  const employee = R(deduction(slip, 'Provident'));
  if (!employee) return null;
  const pol = pfPolicy(db);
  const [from, to] = cycleRange(slip.ym, cycleStartOf(db));
  const ceiling = pfCeilingForCycle(pol, from, to);
  const wage = R((employee * 100) / pol.employeeRate);
  const epsWage = Math.min(wage, R(ceiling));
  const employer = R(slip.employer?.[0]?.[1] ?? employee);
  const eps = Math.min(R((epsWage * pol.epsRate) / 100), employer);
  return { ceiling, wage, epsWage, edliWage: epsWage, employee, employer, eps, epf: employer - eps, edli: R((epsWage * pol.edliRate) / 100), admin: (wage * pol.adminRate) / 100 };
}

// Standard ECR 2.0 text file: one line per member, fields joined by #~# in this order:
// UAN, member name, gross wages, EPF wages, EPS wages, EDLI wages, EPF contribution (employee), EPS contribution,
// EPF-EPS difference (employer), non-contributing days, refund of advances.
export function ecrFile(db, slips) {
  const lines = [];
  const missing = [];
  const rows = [];
  slips.forEach((slip) => {
    const pf = pfDetail(db, slip);
    if (!pf || (!pf.employee && !pf.employer)) return;
    const uan = String(slip.emp.uan || '').replace(/\D/g, '');
    if (!uan) {
      missing.push(slip.emp);
      return;
    }
    const f = [uan, portalName(slip.emp), R(slip.gross), R(pf.wage), R(pf.epsWage), R(pf.edliWage), R(pf.employee), R(pf.eps), R(pf.employer) - R(pf.eps), R(slip.lop || 0), 0];
    rows.push({ slip, pf, f });
    lines.push(f.join('#~#'));
  });
  return { text: lines.join('\n'), lines, rows, missing };
}

// Totals for the PF panel: what the employees and the employer pay, and how the employer share splits.
export function pfTotals(db, slips) {
  const pol = pfPolicy(db) || PF_DEFAULTS;
  const t = { members: 0, wage: 0, employee: 0, employer: 0, eps: 0, epf: 0, edli: 0, adminSum: 0 };
  slips.forEach((s) => {
    const pf = pfDetail(db, s);
    if (!pf || (!pf.employee && !pf.employer)) return;
    t.members++;
    t.wage += pf.wage;
    t.employee += pf.employee;
    t.employer += pf.employer;
    t.eps += pf.eps;
    t.epf += pf.epf;
    t.edli += pf.edli;
    t.adminSum += pf.admin;
  });
  t.admin = R(adminTotal(pol, t.adminSum));
  t.remit = t.employee + t.employer + R(t.edli) + t.admin; // EPF + EPS + EDLI + administration for the challan
  return t;
}

// ESI monthly contribution file with the columns of the ESIC upload template (save it as .xls in the template to upload).
const ddmmyyyy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
export const ESI_COLUMNS = ['IP Number (10 Digits)', 'IP Name (Only alphabets and space)', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)', 'Last Working Day (Format DD/MM/YYYY or DD-MM-YYYY)'];
export function esiRows(db, slips) {
  const rows = [];
  const missing = [];
  slips.forEach((slip) => {
    // Months locked before ESI was stored in full only show the deduction.
    const covered = slip.esi ? slip.esi.covered || slip.esi.employee > 0 : deduction(slip, 'ESI') > 0;
    if (!covered) return;
    const ip = String(slip.emp.esiNumber || '').replace(/\D/g, '');
    if (!ip) {
      missing.push(slip.emp);
      return;
    }
    const days = Math.max(R(slip.paidDays ?? 0), 0);
    const wages = days > 0 ? R(slip.esi?.wages ?? slip.gross) : 0;
    const exit = (db.exits || []).find((x) => x.empId === slip.emp.id && x.status !== 'Withdrawn' && x.lastWorkingDay >= cycleRange(slip.ym, cycleStartOf(db))[0] && x.lastWorkingDay <= cycleRange(slip.ym, cycleStartOf(db))[1]);
    // Reason codes of the template: 1 on leave without pay, 2 left service.
    const reason = days > 0 ? 0 : exit ? 2 : 1;
    rows.push({ slip, cols: [ip, portalName(slip.emp), days, wages, reason, ddmmyyyy(exit?.lastWorkingDay)] });
  });
  return { rows, missing };
}
