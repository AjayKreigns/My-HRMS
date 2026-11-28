// Helpers and small pieces that the Payroll screens share. Split out of Payroll.jsx so each part of Payroll loads only when it is opened.
import { useEffect, useState } from 'react';
import { useDB, update, uid } from '../store.js';
import { DataTable, Modal } from '../ui.jsx';
import { empCol } from './adminShared.jsx';
import { inNumber, fmtDate, money, monthLabel, payslipFor, ymOf, addMonths, payrollPeople, MONTHS, pad } from '../utils.js';
import { markInputsChanged } from '../payrollApproval.js';

// ---------- helpers ----------
export const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
export const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#64748b', '#2563eb', '#84cc16'];
export const inr = (n) => `INR ${inNumber(Math.round(Number(n) || 0))}`;
export const monOf = (ym) => MON[Number(ym.slice(5)) - 1];
export const shortMonth = (ym) => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
export const dayMon = (d) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
export const monDay = (d) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
export const fyStart = (ym) => {
  const y = Number(ym.slice(0, 4));
  return `${Number(ym.slice(5)) >= 4 ? y : y - 1}-04`;
};
export const fyName = (start) => `Financial Year ${start.slice(0, 4)} - ${Number(start.slice(0, 4)) + 1}`;
export const isDone = (run) => !!run && ['Finalized', 'Paid'].includes(run.status);
export const sumOf = (rows, f) => rows.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const stamp = (at) => {
  if (!at) return '';
  const d = new Date(at);
  const h = d.getHours();
  return `${fmtDate(at.slice(0, 10))} ${pad(((h + 11) % 12) + 1)}:${pad(d.getMinutes())} ${h >= 12 ? 'pm' : 'am'}`;
};
export const shortName = (e) => (e ? `${e.firstName} ${e.lastName ? e.lastName[0] : ''}`.trim() : '—');

// First month whose payroll is not locked yet.
export function currentPayMonth(db) {
  const done = db.payrollRuns.filter(isDone).map((r) => r.month).sort();
  return done.length ? addMonths(done[done.length - 1], 1) : ymOf();
}

export function monthTotals(db, ym) {
  const people = payrollPeople(db, ym);
  const slips = people.map((e) => payslipFor(db, e, ym));
  const deposit = sumOf(slips, (x) => x.net);
  const deductions = sumOf(slips, (x) => x.totalDed);
  const contributions = sumOf(slips, (x) => x.employer.reduce((t, [, v]) => t + v, 0));
  return { people, slips, deposit, deductions, contributions, gross: deposit + deductions, cost: deposit + deductions + contributions };
}

export function payrollErrors(people, slips, open = []) {
  const out = [];
  // Absent / Action Required days with no decision from HR yet (see Attendance exceptions).
  [...new Set(open.map((x) => x.emp.id))].forEach((id) => {
    const mine = open.filter((x) => x.emp.id === id);
    out.push({ emp: mine[0].emp, text: `${mine.length} attendance day(s) have no decision yet. Decide them in “Leave, Attendance & Payable Units”.`, fixStep: 'attendance' });
  });
  people.forEach((e) => {
    if (!Number(e.ctc)) out.push({ emp: e, text: 'No salary has been assigned.' });
    if (!e.bank?.accountNumber || !e.bank?.ifsc) out.push({ emp: e, text: 'Bank account number or IFSC is missing.' });
    if (!e.pan) out.push({ emp: e, text: 'PAN is missing, so tax must be deducted at the higher rate.' });
  });
  slips.forEach((x) => x.net < 0 && out.push({ emp: x.emp, text: 'Deductions are more than earnings (net pay is negative).' }));
  return out;
}

export function touchRun(d, ym) {
  let r = d.payrollRuns.find((x) => x.month === ym);
  if (!r) {
    r = { id: uid('run'), month: ym, status: 'Draft', steps: {} };
    d.payrollRuns.push(r);
  }
  r.steps = r.steps || {};
  return r;
}
export function logActivity(d, ym, user, text) {
  d.payrollActivity = d.payrollActivity || [];
  d.payrollActivity.unshift({ id: uid('pa'), month: ym, at: new Date().toISOString(), by: user.id, text });
}
// Any change to inputs after processing means payroll must be processed again.
export function inputsChanged(ym, user, text) {
  update((d) => {
    touchRun(d, ym);
    markInputsChanged(d, ym, user);
    logActivity(d, ym, user, text);
  });
}

export function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => setR(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const goto = (p) => {
  window.location.hash = `#/admin/payroll/${p}`;
};

export const MODULES = [
  { key: 'analytics', label: 'Payroll Analytics' },
  { key: 'run', label: 'Run Payroll' },
  { key: 'admin', label: 'Payroll Admin' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'loans', label: 'Loans' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];
export const SUBS = {
  analytics: [
    ['overview', 'Analytics'],
    ['planning', 'Compensation Planning'],
    ['budget', 'Budget Estimation'],
    ['compare', 'Compare Compensation Cost'],
    ['competitiveness', 'Employee Competitiveness'],
    ['geo', 'Geographical Differentials'],
  ],
  admin: [
    ['history', 'Payroll History'],
    ['salaries', 'Employee Salaries'],
    ['payslips', 'Payslips'],
    ['statutory', 'Statutory Filings'],
    ['tax', 'Tax Declarations'],
    ['revisions', 'Salary Revisions'],
  ],
  approvals: [
    ['loans', 'Loans'],
    ['claims', 'Reimbursement Claims'],
    ['advances', 'Advances'],
    ['revisions', 'Salary Revisions'],
    ['proofs', 'Investment Proofs'],
  ],
};

export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`pr-panel ${className}`}>
      {(title || right) && (
        <header className="pr-panel-head">
          <h3>{title}</h3>
          {right}
        </header>
      )}
      <div className="pr-panel-body">{children}</div>
    </section>
  );
}

export function EmployeeList({ title, rows, onClose }) {
  const db = useDB();
  return (
    <Modal title={title} onClose={onClose}>
      <DataTable rows={rows} empty="No employees." columns={[empCol(db), { key: 'newDesignation', label: 'Job title' }, { key: 'newCtc', label: 'New CTC', render: (p) => money(p.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }]} />
    </Modal>
  );
}

export function MonthSelect({ value, onChange, months, label = 'Payroll month' }) {
  return (
    <select className="pr-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  );
}

export function bandOf(db, e) {
  return db.grades.find((g) => g.id === e.gradeId) || db.grades.find((g) => e.ctc >= g.minCtc && e.ctc < g.maxCtc);
}
export const compa = (db, e) => {
  const g = bandOf(db, e);
  return g ? Number(e.ctc || 0) / ((g.minCtc + g.maxCtc) / 2) : 1;
};
