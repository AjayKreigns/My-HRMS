// Locking, approving and unlocking a payroll month. Everything here changes a database draft `d` and returns
// { ok, error } so the screens (and the tests) can act on the result. Nothing imports React or the store.
import { snapshotPayroll, payrollPeople, payslipFor, empById, fullName, monthLabel } from './utils.js';

// separate: a second person approves, and approval is what locks the month. Off: whoever processes can lock.
// approvers: who may approve (any employee). Empty means every admin.
export const APPROVAL_DEFAULTS = { separate: false, approvers: [] };

export const approvalPolicy = (db) => {
  const a = db?.payrollSettings?.approval || {};
  return { separate: !!a.separate, approvers: Array.isArray(a.approvers) ? [...a.approvers] : [] };
};

const active = (e) => !!e && e.status !== 'Exited';
export function approverIds(db) {
  const chosen = approvalPolicy(db).approvers.filter((id) => active(empById(db, id)));
  return chosen.length ? chosen : db.employees.filter((e) => e.role === 'admin' && active(e)).map((e) => e.id);
}
export const isApprover = (db, user) => !!user && approverIds(db).includes(user.id);

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const runOf = (d, ym) => (d.payrollRuns || []).find((r) => r.month === ym);
const nameOf = (d, id) => fullName(empById(d, id));
export function logRun(d, ym, user, text) {
  d.payrollActivity = d.payrollActivity || [];
  d.payrollActivity.unshift({ id: uid('pa'), month: ym, at: new Date().toISOString(), by: user.id, text });
}
function tell(d, empId, text, link = '') {
  d.notifications = d.notifications || [];
  d.notifications.unshift({ id: uid('ntf'), empId, text, link, date: new Date().toISOString(), read: false });
}
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });
const runLink = (ym) => `admin/payroll/run/${ym}`;

// What the people in a month add up to (for the approver to see before deciding).
export function runSummary(db, ym) {
  const people = payrollPeople(db, ym);
  const slips = people.map((e) => payslipFor(db, e, ym));
  const net = slips.reduce((t, s) => t + s.net, 0);
  const deductions = slips.reduce((t, s) => t + s.totalDed, 0);
  const employer = slips.reduce((t, s) => t + s.employer.reduce((a, [, v]) => a + v, 0), 0);
  return { people: people.length, held: slips.filter((s) => s.onHold).length, net, gross: net + deductions, deductions, employer, cost: net + deductions + employer };
}

// ---- who can do what ----
// A pending submission can be approved by an approver who is not the one who submitted it.
export const canApproveRun = (db, user, run) => approvalPolicy(db).separate && run?.status === 'Submitted' && isApprover(db, user) && run.submittedBy !== user?.id;
export const canApproveUnlock = (db, user, run) => approvalPolicy(db).separate && !!run?.unlockRequest && isApprover(db, user) && run.unlockRequest.by !== user?.id;

// ---- locking ----
function lock(d, ym, user, text, extra = {}) {
  const r = runOf(d, ym);
  Object.assign(r, { status: 'Finalized', lockedAt: new Date().toISOString(), lockedBy: user.id, dirty: false, ...extra });
  delete r.rejection;
  // Freeze the payslips: later changes to salaries, structures or leave rules do not touch this month.
  r.snapshot = snapshotPayroll(d, ym);
  logRun(d, ym, user, text);
}

// Lock without a second person (only when separate approval is off).
export function lockRun(d, ym, user) {
  const r = runOf(d, ym);
  if (approvalPolicy(d).separate) return fail('Payroll needs a second person’s approval. Submit it for approval instead.');
  if (!r || r.status !== 'Processed' || r.dirty) return fail('Process payroll first.');
  lock(d, ym, user, 'Locked payroll');
  return ok();
}

export function submitRun(d, ym, user) {
  const r = runOf(d, ym);
  if (!approvalPolicy(d).separate) return fail('Approval is switched off. Lock payroll directly.');
  if (!r || r.status !== 'Processed' || r.dirty) return fail('Process payroll first.');
  const to = approverIds(d).filter((id) => id !== user.id);
  if (!to.length) return fail('No one else can approve. Add another approver in Payroll > Settings > Approval.');
  Object.assign(r, { status: 'Submitted', submittedBy: user.id, submittedAt: new Date().toISOString() });
  delete r.rejection;
  logRun(d, ym, user, 'Submitted payroll for approval');
  to.forEach((id) => tell(d, id, `Payroll for ${monthLabel(ym)} is waiting for your approval.`, 'inbox'));
  return ok({ notified: to });
}

export function withdrawRun(d, ym, user) {
  const r = runOf(d, ym);
  if (!r || r.status !== 'Submitted') return fail('Nothing is waiting for approval.');
  r.status = 'Processed';
  logRun(d, ym, user, 'Withdrew payroll from approval');
  return ok();
}

export function approveRun(d, ym, user) {
  const r = runOf(d, ym);
  if (!canApproveRun(d, user, r)) return fail(r?.submittedBy === user?.id ? 'You submitted this payroll, so someone else has to approve it.' : 'You are not an approver for payroll.');
  const by = r.submittedBy;
  lock(d, ym, user, `Approved and locked payroll (submitted by ${nameOf(d, by)})`, { approvedBy: user.id, approvedAt: new Date().toISOString() });
  tell(d, by, `Payroll for ${monthLabel(ym)} was approved by ${nameOf(d, user.id)} and is locked.`, runLink(ym));
  return ok();
}

export function rejectRun(d, ym, user, reason) {
  const r = runOf(d, ym);
  if (!canApproveRun(d, user, r)) return fail(r?.submittedBy === user?.id ? 'You submitted this payroll, so someone else has to decide on it.' : 'You are not an approver for payroll.');
  if (!String(reason || '').trim()) return fail('Give a reason so they know what to fix.');
  const by = r.submittedBy;
  r.status = 'Processed';
  r.rejection = { by: user.id, at: new Date().toISOString(), reason: reason.trim() };
  logRun(d, ym, user, `Sent payroll back: ${reason.trim()}`);
  tell(d, by, `${nameOf(d, user.id)} sent back payroll for ${monthLabel(ym)}: “${reason.trim()}”`, runLink(ym));
  return ok();
}

// ---- unlocking ----
function unlock(d, ym, user, reason, text) {
  const r = runOf(d, ym);
  Object.assign(r, { status: 'Processed', dirty: true, unlockedBy: user.id, unlockedAt: new Date().toISOString(), unlockReason: reason });
  delete r.snapshot; // payslips recalculate from live data again until it is locked
  delete r.unlockRequest;
  delete r.approvedBy;
  logRun(d, ym, user, text);
}

// Without a second approver an admin unlocks directly, but always says why.
export function unlockRun(d, ym, user, reason) {
  const r = runOf(d, ym);
  if (approvalPolicy(d).separate) return fail('Unlocking needs an approver. Send an unlock request instead.');
  if (!r || r.status !== 'Finalized') return fail('Only a locked month that is not paid yet can be unlocked.');
  if (!String(reason || '').trim()) return fail('A reason is needed to unlock payroll.');
  unlock(d, ym, user, reason.trim(), `Unlocked payroll: ${reason.trim()}`);
  return ok();
}

export function requestUnlock(d, ym, user, reason) {
  const r = runOf(d, ym);
  if (!approvalPolicy(d).separate) return fail('Approval is switched off. Unlock payroll directly.');
  if (!r || r.status !== 'Finalized') return fail('Only a locked month that is not paid yet can be unlocked.');
  if (r.unlockRequest) return fail('An unlock request is already waiting.');
  if (!String(reason || '').trim()) return fail('A reason is needed to unlock payroll.');
  const to = approverIds(d).filter((id) => id !== user.id);
  if (!to.length) return fail('No one else can approve. Add another approver in Payroll > Settings > Approval.');
  r.unlockRequest = { by: user.id, at: new Date().toISOString(), reason: reason.trim() };
  logRun(d, ym, user, `Asked to unlock payroll: ${reason.trim()}`);
  to.forEach((id) => tell(d, id, `${nameOf(d, user.id)} asked to unlock payroll for ${monthLabel(ym)}: “${reason.trim()}”`, 'inbox'));
  return ok({ notified: to });
}

export function approveUnlock(d, ym, user) {
  const r = runOf(d, ym);
  if (!canApproveUnlock(d, user, r)) return fail(r?.unlockRequest?.by === user?.id ? 'You asked for this unlock, so someone else has to approve it.' : 'You are not an approver for payroll.');
  const { by, reason } = r.unlockRequest;
  unlock(d, ym, user, reason, `Approved unlock of payroll (asked by ${nameOf(d, by)}): ${reason}`);
  tell(d, by, `Your request to unlock payroll for ${monthLabel(ym)} was approved.`, runLink(ym));
  return ok();
}

export function rejectUnlock(d, ym, user, reason) {
  const r = runOf(d, ym);
  if (!canApproveUnlock(d, user, r)) return fail(r?.unlockRequest?.by === user?.id ? 'You asked for this unlock, so someone else has to decide on it.' : 'You are not an approver for payroll.');
  if (!String(reason || '').trim()) return fail('Give a reason so they know why.');
  const by = r.unlockRequest.by;
  delete r.unlockRequest;
  logRun(d, ym, user, `Declined the request to unlock payroll: ${reason.trim()}`);
  tell(d, by, `${nameOf(d, user.id)} declined your request to unlock payroll for ${monthLabel(ym)}: “${reason.trim()}”`, runLink(ym));
  return ok();
}

export function cancelUnlock(d, ym, user) {
  const r = runOf(d, ym);
  if (!r?.unlockRequest) return fail('There is no unlock request.');
  delete r.unlockRequest;
  logRun(d, ym, user, 'Withdrew the unlock request');
  return ok();
}

// A change to inputs after processing means processing again. A month waiting for approval goes back to the
// person who submitted it, because what the approver was shown is no longer what will be locked.
export function markInputsChanged(d, ym, user) {
  const r = runOf(d, ym);
  if (!r) return;
  if (r.processedAt) r.dirty = true;
  if (r.status === 'Submitted') {
    r.status = 'Processed';
    logRun(d, ym, user, 'Payroll inputs changed, so the submission was withdrawn. Process and submit again');
    tell(d, r.submittedBy, `Payroll for ${monthLabel(ym)} changed after you submitted it. Process and submit it again.`, runLink(ym));
  }
}

// Saving the settings. Turning approval off sends anything waiting for approval back to Processed.
export function saveApprovalSettings(d, user, next) {
  const was = approvalPolicy(d);
  const approvers = [...new Set(next.approvers || [])];
  if (next.separate && !approverIds({ ...d, payrollSettings: { ...d.payrollSettings, approval: { separate: true, approvers } } }).length) return fail('Choose at least one approver.');
  d.payrollSettings.approval = { separate: !!next.separate, approvers };
  if (was.separate && !next.separate) {
    (d.payrollRuns || []).forEach((r) => {
      if (r.status === 'Submitted') {
        r.status = 'Processed';
        logRun(d, r.month, user, 'Approval was switched off, so the submission was cancelled');
      }
      delete r.unlockRequest;
    });
  }
  return ok();
}
