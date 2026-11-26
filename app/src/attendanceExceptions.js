// Attendance exceptions: days marked Absent or Action Required in a pay cycle. HR decides each one in the payroll run
// (Paid, Loss of pay, or half a day of loss of pay) and can change the decision any time until the month is locked.
// A day leaves the list by itself when the employee applies leave or regularizes it. People marked as exception
// employees (MD, CEO...) are exempt from attendance and never appear here.
import { attendanceFor, cycleRange, cycleStartOf, addDays, todayISO, payrollPeople, RESOLUTION_LOP, uidLike } from './utils.js';
import { attendanceRemark } from './leave.js';

export const RESOLUTIONS = Object.keys(RESOLUTION_LOP);
export const isExempt = (emp) => emp?.attendanceExempt === 'Yes';
export const resolutionOf = (db, empId, date) => (db.attendanceResolutions || []).find((r) => r.empId === empId && r.date === date);

// Every Absent / Action Required day in the cycle for the people being paid, with HR's decision if there is one.
export function exceptionDays(db, ym) {
  const [from, to] = cycleRange(ym, cycleStartOf(db));
  const end = to < todayISO() ? to : todayISO();
  const out = [];
  payrollPeople(db, ym, true)
    .filter((e) => !isExempt(e))
    .forEach((emp) => {
      for (let d = from < emp.dateOfJoining ? emp.dateOfJoining : from; d <= end; d = addDays(d, 1)) {
        const rec = attendanceFor(db, emp.id, d);
        if (!['Absent', 'Action Required'].includes(rec.status)) continue;
        out.push({ emp, date: d, status: rec.status, note: rec.note || '', remark: attendanceRemark(db, emp.id, d, rec), resolution: resolutionOf(db, emp.id, d)?.resolution || '' });
      }
    });
  return out;
}
export const unresolvedDays = (db, ym) => exceptionDays(db, ym).filter((x) => !x.resolution);

// Record (or clear, with an empty value) HR's decision for one day. Returns { ok, error }.
export function setResolution(d, empId, date, resolution, user) {
  if (resolution && !RESOLUTIONS.includes(resolution)) return { ok: false, error: 'Unknown decision.' };
  d.attendanceResolutions = (d.attendanceResolutions || []).filter((r) => !(r.empId === empId && r.date === date));
  if (resolution) d.attendanceResolutions.push({ id: uidLike('res'), empId, date, resolution, by: user?.id, at: new Date().toISOString() });
  return { ok: true };
}
