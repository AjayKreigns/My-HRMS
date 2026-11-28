// Run Payroll: the monthly cycle, its input steps, the register and the tour. Opened from Payroll.jsx when needed.
import { useEffect, useMemo, useState } from 'react';
import { useDB, addItem, patchItem, removeItem, update, uid, notify } from '../store.js';
import { Icon, Btn, Badge, DataTable, FormModal, EmpChip, Modal, toast, confirmAction, exportCSV, ReasonModal } from '../ui.jsx';
import { PayslipView } from './Finances.jsx';
import { empCol } from './adminShared.jsx';
import { empById, fullName, fmtDate, money, monthLabel, addMonths, todayISO, cycleRange, cycleDays, MONTHS, pad } from '../utils.js';
import { payrollRegister } from '../register.js';
import { downloadPayslipPdf } from '../payslipPdf.js';
import { queuePayslipMail } from '../payslipMail.js';
import { exceptionDays, unresolvedDays, setResolution, RESOLUTIONS } from '../attendanceExceptions.js';
import { approvalPolicy, approverIds, canApproveRun, canApproveUnlock, lockRun, submitRun, withdrawRun, approveRun, rejectRun, unlockRun, requestUnlock, approveUnlock, rejectUnlock, cancelUnlock, markInputsChanged } from '../payrollApproval.js';
import { MonthRail, GateLine, CostTape } from './payrollViews.jsx';
import { currentPayMonth, fyStart, goto, inputsChanged, inr, isDone, logActivity, monthTotals, payrollErrors, shortMonth, shortName, stamp, sumOf, touchRun } from './payrollShared.jsx';
import '../payroll.css';
import '../payrollx.css';

// ---------- run payroll ----------
const STEPS = [
  { key: 'attendance', title: 'Leave, Attendance & Payable Units', icon: 'calendar', tone: '#62c1d1' },
  { key: 'joinees', title: 'New Joinees & Exits', icon: 'userPlus', tone: '#c47bc4' },
  { key: 'bonus', title: 'Bonus & Salary Revisions', icon: 'briefcase', tone: '#8d93d8' },
  { key: 'reimbursement', title: 'Reimbursement, Adhoc Payment, Deduction', icon: 'calc', tone: '#5ea9e0' },
  { key: 'hold', title: 'Salaries on Hold & Arrears', icon: 'hourglass', tone: '#a5bf3a' },
  { key: 'override', title: 'Override (PT, ESI, TDS, LWF)', icon: 'userCheck', tone: '#e2b84b' },
];

const HELP = [
  ['How to override statutory contributions & deductions?', 'Open the "Override (PT, ESI, TDS, LWF)" step, pick the employee and enter the amount to use this month. Leave a box empty to keep the calculated value. Process payroll again afterwards.'],
  ['How to release payslips?', 'Process payroll, fix any errors, then lock it. Once it is locked, "Release Payslips" sends every employee a notification and their payslip appears under My Finances.'],
  ['How to download salary bulk upload format of your bank?', "Go to Reports and download \"Bank transfer statement\" for the month. It lists each employee's bank, account number, IFSC and net pay, ready to paste into your bank's bulk upload sheet."],
  ['How to run off cycle payroll?', "Add the payment as an adhoc payment in the \"Reimbursement, Adhoc Payment, Deduction\" step of the month it should be paid in, then process that month's payroll again."],
  ['How to check if my payroll values are calculated correctly?', 'Use "Review all employees" to open each payslip, or compare this month with the last one under Payroll Analytics → Compare Compensation Cost.'],
];

export function RunPayroll({ user, month }) {
  const db = useDB();
  const s = db.payrollSettings;
  const cur = currentPayMonth(db);
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : cur;
  const [fy, setFy] = useState(fyStart(ym));
  const [step, setStep] = useState(null);
  const [modal, setModal] = useState(null);
  const [slip, setSlip] = useState(null);
  const [panels, setPanels] = useState({ activity: false, help: false });
  const [reason, setReason] = useState(null);
  useEffect(() => setFy(fyStart(ym)), [ym]);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const prev = useMemo(() => monthTotals(db, addMonths(ym, -1)), [db, ym]);
  const [from, to] = cycleRange(ym, s.cycleStartDay);
  const days = cycleDays(ym, s.cycleStartDay);
  const joiners = t.people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
  const exits = db.exits.filter((x) => x.lastWorkingDay >= from && x.lastWorkingDay <= to);
  const undecided = useMemo(() => unresolvedDays(db, ym), [db, ym]);
  const errors = payrollErrors(t.people, t.slips, undecided);
  const done = isDone(run);
  const upcoming = ym > cur;
  const stepsDone = STEPS.filter((st) => run?.steps?.[st.key]).length;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(fy, i));
  const payable = t.slips.filter((x) => !x.onHold).length;
  const canLock = run?.status === 'Processed' && !run.dirty && errors.length === 0;
  const activity = (db.payrollActivity || []).filter((a) => a.month === ym);
  const prevYm = addMonths(ym, -1);

  const stateOf = (m) => {
    const r = db.payrollRuns.find((x) => x.month === m);
    if (isDone(r)) return 'completed';
    if (m === cur) return 'current';
    return m > cur ? 'upcoming' : 'pending';
  };
  const process = () => {
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Processed', processedAt: new Date().toISOString(), processedOn: todayISO(), processedBy: user.id, processedCount: payable, dirty: false });
      logActivity(d, ym, user, `Processed payroll for ${payable} employees`);
    });
    toast(`Payroll processed for ${payable} employees`);
  };
  // Run one approval action; show its error, or the message when it worked.
  const act = (fn, okText) => {
    let res;
    update((d) => {
      res = fn(d);
    });
    if (!res.ok) toast(res.error, 'error');
    else if (okText) toast(okText);
    return res.ok;
  };
  const sep = approvalPolicy(db).separate;
  const who = (id) => shortName(empById(db, id));
  const waitingOn = approverIds(db).filter((id) => id !== run?.submittedBy).map(who).join(', ');
  const lock = () => {
    if (!confirmAction(`Lock payroll for ${monthLabel(ym)}? Inputs can't be changed after this.`)) return;
    act((d) => lockRun(d, ym, user), `Payroll locked for ${monthLabel(ym)}`);
  };
  const submit = () => {
    if (!confirmAction(`Submit payroll for ${monthLabel(ym)} for approval?`)) return;
    act((d) => submitRun(d, ym, user), 'Submitted for approval');
  };
  const approve = () => {
    if (!confirmAction(`Approve and lock payroll for ${monthLabel(ym)}? Inputs can't be changed after this.`)) return;
    act((d) => approveRun(d, ym, user), `Payroll approved and locked for ${monthLabel(ym)}`);
  };
  const release = () => {
    update((d) => {
      Object.assign(touchRun(d, ym), { status: 'Paid', releasedAt: new Date().toISOString() });
      logActivity(d, ym, user, 'Released payslips');
      const queued = queuePayslipMail(d, ym, t.slips.filter((x) => !x.onHold).map((x) => x.emp));
      if (queued) logActivity(d, ym, user, `Put ${queued} payslip email(s) in the outbox`);
    });
    t.slips.filter((x) => !x.onHold).forEach((x) => notify(x.emp.id, `Your payslip for ${monthLabel(ym)} is ready.`, 'finances/payslips'));
    toast('Payslips released');
  };
  const processed = run?.processedAt ? new Date(run.processedAt) : null;
  let footNote;
  if (done) footNote = `Payroll was locked${run.lockedAt ? ` on ${stamp(run.lockedAt)}` : ''}${run.lockedBy ? ` by ${who(run.lockedBy)}` : ''}${run.approvedBy && run.submittedBy ? ` (submitted by ${who(run.submittedBy)}, approved by ${who(run.approvedBy)})` : ''}${run.status === 'Paid' ? ' and payslips were released' : ''}`;
  else if (run?.status === 'Submitted') footNote = `Submitted for approval on ${stamp(run.submittedAt)} by ${who(run.submittedBy)}`;
  else if (processed) footNote = `Payroll was last processed on ${pad(processed.getDate())} ${MONTHS[processed.getMonth()].slice(0, 3)} at ${stamp(run.processedAt).slice(-8)} by ${shortName(empById(db, run.processedBy))}`;
  else if (upcoming) footNote = `Payroll for ${monthLabel(ym)} opens once ${monthLabel(cur)} is locked`;
  else footNote = 'Payroll has not been processed for this month yet';

  // Where the month stands: five gates, and the one thing to do at the gate it has reached.
  const processedOk = !!run?.processedAt && !run.dirty;
  const hasErrors = errors.length > 0;
  const submitted = run?.status === 'Submitted';
  const gates = [
    { key: 'inputs', label: 'Inputs', state: stepsDone === STEPS.length ? 'cleared' : 'open', note: `${stepsDone} of ${STEPS.length} saved` },
    { key: 'process', label: 'Process', state: upcoming ? 'idle' : processedOk ? 'cleared' : 'active', note: processedOk ? `${run.processedCount ?? payable} employees` : run?.dirty ? 'Inputs changed' : 'Not run yet' },
    { key: 'review', label: 'Review', state: !processedOk ? 'idle' : hasErrors ? 'blocked' : 'cleared', note: !processedOk ? 'After processing' : hasErrors ? `${errors.length} to fix` : 'Nothing in the way' },
    { key: 'lock', label: sep ? 'Approve and lock' : 'Lock', state: done ? 'cleared' : submitted ? 'waiting' : processedOk && !hasErrors ? 'active' : 'idle', note: done ? (run.lockedBy ? `By ${who(run.lockedBy)}` : 'Locked') : submitted ? `Waiting for ${waitingOn || 'an approver'}` : sep ? 'Needs a second person' : 'Freezes the payslips' },
    { key: 'release', label: 'Release', state: run?.status === 'Paid' ? 'cleared' : run?.status === 'Finalized' ? 'active' : 'idle', note: run?.status === 'Paid' ? 'Payslips released' : 'Payslips reach staff' },
  ];
  let now;
  if (upcoming) now = { title: 'Not open yet', text: `${monthLabel(ym)} opens once ${monthLabel(cur)} is locked.` };
  else if (run?.status === 'Paid') now = { title: 'Done. Payslips are released', text: 'Everyone has been notified, and their payslip emails are in the outbox.' };
  else if (run?.status === 'Finalized') now = { title: 'Locked. Payslips are not released yet', text: 'Releasing notifies every employee and queues their payslip emails.' };
  else if (submitted) now = { title: 'Waiting for approval', text: run.submittedBy === user.id ? `Waiting for ${waitingOn || 'an approver'} to approve it. You submitted it, so you cannot.` : `${who(run.submittedBy)} submitted it. ${canApproveRun(db, user, run) ? 'You can approve or send it back.' : `Waiting for ${waitingOn || 'an approver'}.`}` };
  else if (!processedOk) now = { title: run?.dirty ? 'Inputs changed since the last run' : 'Ready to process', text: run?.dirty ? 'Save the steps you changed, then process again so the payslips match.' : `Processing works out a payslip for each of the ${payable} employees.` };
  else if (hasErrors) now = { title: errors.length === 1 ? 'One thing is in the way' : `${errors.length} things are in the way`, text: 'The month cannot lock until these are clear. Process again after you fix them.' };
  else now = { title: sep ? 'Ready to submit for approval' : 'Ready to lock', text: `${sep ? 'A second person approves, and approval locks the month.' : 'Locking freezes every payslip. Inputs cannot change after this.'} Look over every employee’s pay first.` };

  let primaryKey = null;
  if (!upcoming) {
    if (done) primaryKey = run.status === 'Finalized' ? (run.unlockRequest && canApproveUnlock(db, user, run) ? 'approveUnlock' : 'release') : null;
    else if (submitted) primaryKey = canApproveRun(db, user, run) ? 'approve' : null;
    else if (!processedOk) primaryKey = 'process';
    else if (hasErrors) primaryKey = 'fix';
    else primaryKey = sep ? 'submit' : 'lock';
  }
  const locked = run?.status === 'Finalized';
  const acts = [
    { k: 'process', show: !done, label: processedOk ? 'Process again' : 'Process payroll', onClick: process, disabled: upcoming || submitted },
    { k: 'fix', show: !done && hasErrors && processedOk, label: errors.length === 1 ? 'Fix the issue' : `Fix ${errors.length} issues`, onClick: () => setModal('errors') },
    { k: 'lock', show: !done && !sep, label: 'Lock payroll', onClick: lock, disabled: !canLock || upcoming, title: canLock ? '' : 'Process payroll and fix everything in the way first' },
    { k: 'submit', show: !done && sep && !submitted, label: 'Submit for approval', onClick: submit, disabled: !canLock || upcoming, title: canLock ? '' : 'Process payroll and fix everything in the way first' },
    { k: 'approve', show: !done && sep && submitted && canApproveRun(db, user, run), label: 'Approve and lock', onClick: approve },
    { k: 'sendBack', show: !done && sep && submitted && canApproveRun(db, user, run), label: 'Send back', onClick: () => setReason('sendBack') },
    { k: 'withdraw', show: !done && sep && submitted && (run.submittedBy === user.id || user.role === 'admin'), label: 'Withdraw', onClick: () => act((d) => withdrawRun(d, ym, user), 'Withdrawn from approval') },
    { k: 'release', show: locked, label: 'Release payslips', onClick: release },
    { k: 'approveUnlock', show: locked && run.unlockRequest && canApproveUnlock(db, user, run), label: 'Approve unlock', onClick: () => act((d) => approveUnlock(d, ym, user), 'Payroll unlocked') },
    { k: 'declineUnlock', show: locked && run.unlockRequest && canApproveUnlock(db, user, run), label: 'Decline unlock', onClick: () => setReason('declineUnlock') },
    { k: 'cancelUnlock', show: locked && run.unlockRequest && run.unlockRequest.by === user.id, label: 'Withdraw unlock request', onClick: () => act((d) => cancelUnlock(d, ym, user), 'Unlock request withdrawn') },
    { k: 'unlock', show: locked && !run.unlockRequest, label: sep ? 'Request unlock' : 'Unlock payroll', onClick: () => setReason('unlock') },
    { k: 'review', show: true, label: 'Review all employees', onClick: () => setModal('review'), review: true },
    { k: 'register', show: true, label: 'Payroll register', onClick: () => setModal('register'), quiet: true },
  ].filter((a) => a.show);
  // The main action first, then the review of every employee's pay (the check that matters before locking), then the rest.
  const ordered = [...acts.filter((a) => a.k === primaryKey), ...acts.filter((a) => a.k === 'review' && a.k !== primaryKey), ...acts.filter((a) => a.k !== primaryKey && a.k !== 'review')];
  const dm = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
  const [cf0, ct0] = cycleRange(ym, s.cycleStartDay);
  const joined = joiners.length;
  const left = exits.length;
  const againstPrev = shortMonth(prevYm);

  return (
    <div className="px">
      <MonthRail
        months={months}
        ym={ym}
        stateOf={stateOf}
        short={(m) => MONTHS[Number(m.slice(5)) - 1].slice(0, 3)}
        hint={(m) => `${shortMonth(m)}, ${cycleRange(m, s.cycleStartDay).map(dm).join(' to ')}`}
        onPick={(m) => goto(`run/${m}`)}
        onPrev={() => setFy(addMonths(fy, -12))}
        onNext={() => setFy(addMonths(fy, 12))}
      />

      <header className="px-head">
        <h2 className="px-month">{monthLabel(ym)}</h2>
        <span className="px-cycle">{`${dm(cf0)} to ${dm(ct0)}, ${days} days`}</span>
      </header>

      <div className="px-run">
        <div className="px-main">
          <section aria-label="Where this month stands">
            <GateLine gates={gates} />
            <div className="px-now">
              <h3>{now.title}</h3>
              <p>{now.text}</p>
              {(run?.rejection && run.status === 'Processed' && !done) || (run?.unlockRequest && locked) ? (
                <div className="px-notes">
                  {run?.rejection && run.status === 'Processed' && !done && <p>{`Sent back by ${who(run.rejection.by)}: “${run.rejection.reason}”`}</p>}
                  {run?.unlockRequest && locked && <p>{`${who(run.unlockRequest.by)} asked to unlock this month: “${run.unlockRequest.reason}”${canApproveUnlock(db, user, run) ? '' : `. Waiting for ${approverIds(db).filter((id) => id !== run.unlockRequest.by).map(who).join(', ')}.`}`}</p>}
                </div>
              ) : null}
              <div className="px-actions">
                {ordered.map((a) => (
                  <button key={a.k} className={`px-btn ${a.k === primaryKey ? 'primary' : a.review ? 'review' : a.quiet ? 'quiet' : ''}`} onClick={a.onClick} disabled={a.disabled} title={a.title}>
                    {a.review && <Icon name="team" size={16} />}
                    {a.label}
                    {a.review && <span className="px-count">{t.people.length}</span>}
                  </button>
                ))}
              </div>
              <p className="px-foot">{footNote}</p>
              {hasErrors && !done && (
                <div className="px-block">
                  <h4 className="px-block-title">{`In the way (${errors.length})`}</h4>
                  {errors.slice(0, 4).map((e, i) => (
                    <div className="px-block-row" key={i}>
                      <b>{fullName(e.emp)}</b>
                      <span>{e.text}</span>
                    </div>
                  ))}
                  <button className="px-btn quiet px-block-more" onClick={() => setModal('errors')}>
                    {errors.length > 4 ? `See all ${errors.length} and fix them` : 'Open and fix'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section aria-label="Inputs">
            <h3 className="px-title">
              Inputs<small>{`${stepsDone} of ${STEPS.length} saved. Open one to check or change it.`}</small>
            </h3>
            <ul className="px-ledger">
              {STEPS.map((st) => {
                const info = run?.steps?.[st.key];
                return (
                  <li key={st.key}>
                    <button className={info ? 'saved' : ''} onClick={() => setStep(st)}>
                      <span className="px-mark">{info && <Icon name="check" size={11} />}</span>
                      <span>
                        <span className="px-ledger-title">{st.title}</span>
                        <span className="px-ledger-sub">{info ? `Saved ${stamp(info.at)} by ${shortName(empById(db, info.by))}` : 'Nothing saved yet'}</span>
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="px-side">
          <CostTape
            against={againstPrev}
            parts={[
              { label: 'Take-home pay', value: t.deposit, delta: t.deposit - prev.deposit },
              { label: 'Deductions', value: t.deductions, delta: t.deductions - prev.deductions },
              { label: 'Employer contributions', value: t.contributions, delta: t.contributions - prev.contributions },
            ]}
            total={{ value: t.cost, delta: t.cost - prev.cost }}
          >
            <div className="px-people">
              <span>
                <b>{t.people.length}</b> employees{joined || left ? `, ${joined} joined and ${left} left this cycle` : ''}
              </span>
              <span>
                <b>{run?.processedAt ? run.processedCount ?? payable : 0}</b> of {t.people.length} processed
              </span>
            </div>
          </CostTape>

          <section aria-label="Activity">
            <h3 className="px-title">Activity</h3>
            {activity.length === 0 ? (
              <p className="px-muted">Nothing has happened to this month yet.</p>
            ) : (
              <ul className="px-feed">
                {activity.slice(0, panels.activity ? 30 : 6).map((a) => (
                  <li key={a.id}>
                    <span>{a.text}</span>
                    <small>{`${stamp(a.at)}, ${shortName(empById(db, a.by))}`}</small>
                  </li>
                ))}
              </ul>
            )}
            {activity.length > 6 && (
              <button className="px-btn quiet" style={{ paddingInline: 0 }} onClick={() => setPanels({ ...panels, activity: !panels.activity })}>
                {panels.activity ? 'Show fewer' : `Show all ${Math.min(activity.length, 30)}`}
              </button>
            )}
          </section>

          <section aria-label="Help">
            <h3 className="px-title">Need a hand?</h3>
            <div className="px-links">
              <button onClick={() => setModal('tour')}>Take the guided tour</button>
              {HELP.map(([q], i) => (
                <button key={q} onClick={() => setModal(i)}>
                  {q}
                </button>
              ))}
              <a href="#/me/helpdesk">Raise a helpdesk ticket</a>
            </div>
          </section>
        </aside>
      </div>

      {reason === 'unlock' && (
        <ReasonModal
          title={sep ? 'Request to unlock payroll' : 'Unlock payroll'}
          label="Why does this month need to be unlocked?"
          help={sep ? `${monthLabel(ym)} stays locked until an approver agrees. The reason is kept in the activity log.` : `${monthLabel(ym)} goes back to being editable and its payslips are worked out again from live data. The reason is kept in the activity log.`}
          confirmText={sep ? 'Send request' : 'Unlock'}
          danger={!sep}
          onClose={() => setReason(null)}
          onConfirm={(text) => (sep ? act((d) => requestUnlock(d, ym, user, text), 'Unlock request sent') : act((d) => unlockRun(d, ym, user, text), 'Payroll unlocked'))}
        />
      )}
      {reason === 'sendBack' && <ReasonModal title="Send payroll back" label="What needs to be fixed?" confirmText="Send back" danger onClose={() => setReason(null)} onConfirm={(text) => act((d) => rejectRun(d, ym, user, text), 'Sent back')} />}
      {reason === 'declineUnlock' && <ReasonModal title="Decline the unlock request" label="Why not?" confirmText="Decline" danger onClose={() => setReason(null)} onConfirm={(text) => act((d) => rejectUnlock(d, ym, user, text), 'Request declined')} />}
      {step && <StepModal step={step} ym={ym} user={user} t={t} locked={done || upcoming} range={[from, to]} onClose={() => setStep(null)} />}
      {modal === 'tour' && <Tour onClose={() => setModal(null)} />}
      {typeof modal === 'number' && (
        <Modal title={HELP[modal][0]} onClose={() => setModal(null)}>
          <p>{HELP[modal][1]}</p>
        </Modal>
      )}
      {modal === 'errors' && (
        <Modal title="Payroll errors" onClose={() => setModal(null)} wide>
          <DataTable
            rows={errors.map((e, i) => ({ ...e, id: i }))}
            columns={[
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => <EmpChip emp={r.emp} sub={r.emp.empNo} /> },
              { key: 'text', label: 'Problem', sortable: false },
              { key: 'fix', label: '', sortable: false, render: (r) => (r.fixStep ? <Btn kind="ghost" small onClick={() => { setModal(null); setStep(STEPS.find((x) => x.key === r.fixStep)); }}>Decide</Btn> : <a className="btn btn-ghost btn-sm" href={`#/profile/${r.emp.id}`}>Fix in profile</a>) },
            ]}
          />
        </Modal>
      )}
      {modal === 'register' && <RegisterModal db={db} ym={ym} onClose={() => setModal(null)} />}
      {modal === 'review' && (
        <Modal
          title={`Review all employees — ${monthLabel(ym)}`}
          onClose={() => setModal(null)}
          wide
          footer={
            <Btn kind="ghost" icon="download" onClick={() => exportCSV(`payroll-${ym}`, [{ label: 'Employee', csv: (x) => fullName(x.emp) }, { label: 'Emp no', csv: (x) => x.emp.empNo }, { label: 'Paid days', csv: (x) => x.paidDays }, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'Deductions', csv: (x) => Math.round(x.totalDed) }, { label: 'Net pay', csv: (x) => Math.round(x.net) }, { label: 'On hold', csv: (x) => (x.onHold ? 'Yes' : 'No') }], t.slips)}>
              Export
            </Btn>
          }
        >
          <DataTable
            rows={t.slips}
            rowKey={(x) => x.emp.id}
            pageSize={25}
            onRowClick={setSlip}
            columns={[
              { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
              { key: 'paidDays', label: 'Paid days', render: (x) => `${x.paidDays}${x.lop ? ` (LOP ${x.lop})` : ''}` },
              { key: 'gross', label: 'Gross', render: (x) => money(x.gross) },
              { key: 'totalDed', label: 'Deductions', render: (x) => money(x.totalDed) },
              { key: 'net', label: 'Net pay', render: (x) => <strong>{money(x.net)}</strong> },
              { key: 'onHold', label: '', sortable: false, render: (x) => (x.onHold ? <Badge tone="amber">On hold</Badge> : null) },
            ]}
          />
        </Modal>
      )}
      {slip && (
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<><Btn kind="ghost" icon="download" onClick={() => downloadPayslipPdf(db, slip)} title="Password: employee number followed by date of birth (DDMMYYYY)">PDF (password protected)</Btn><Btn icon="print" onClick={() => window.print()}>Print</Btn></>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
    </div>
  );
}

// Download the payroll register for the month, for all pay groups or one.
function RegisterModal({ db, ym, onClose }) {
  const [groupId, setGroupId] = useState('');
  const reg = useMemo(() => payrollRegister(db, ym, groupId), [db, ym, groupId]);
  const group = (db.payGroups || []).find((g) => g.id === groupId);
  const download = () => exportCSV(`payroll-register-${ym}${group ? `-${group.name.replace(/\s+/g, '-').toLowerCase()}` : ''}`, reg.columns, reg.rows);
  return (
    <Modal
      title={`Payroll register — ${monthLabel(ym)}`}
      onClose={onClose}
      footer={
        <Btn icon="download" disabled={!reg.count} onClick={download}>
          Download register (CSV)
        </Btn>
      }
    >
      <div className="field">
        <label htmlFor="reg_group">Pay group</label>
        <select id="reg_group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">All pay groups</option>
          {(db.payGroups || []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <table className="pr-breakup" style={{ marginTop: 12 }}>
        <tbody>
          <tr>
            <td>Employees</td>
            <td>{reg.count}</td>
          </tr>
          <tr>
            <td>Gross earnings</td>
            <td>{inr(reg.totals.gross)}</td>
          </tr>
          <tr>
            <td>Total deductions</td>
            <td>{inr(reg.totals.deductions)}</td>
          </tr>
          <tr className="total-row">
            <td>Net pay</td>
            <td>{inr(reg.totals.net)}</td>
          </tr>
        </tbody>
      </table>
      <p className="pr-muted" style={{ marginTop: 12 }}>
        One row per employee with every earning, deduction and employer cost, and a totals row. Opens in Excel.
        {isDone(db.payrollRuns.find((r) => r.month === ym)) ? ' This month is locked, so the register matches the payslips that were issued.' : ' This month is not locked yet, so the numbers can still change.'}
      </p>
    </Modal>
  );
}

function Tour({ onClose }) {
  const [i, setI] = useState(0);
  const ABOUT = {
    attendance: 'Check paid days and loss-of-pay for everyone in the cycle.',
    joinees: 'Confirm who joined or left during the cycle; their pay is worked out for the days they were here.',
    bonus: 'Add bonuses and check salary revisions that take effect this month.',
    reimbursement: 'Pay approved claims and expenses through payroll, and add one-off payments or deductions.',
    hold: "Hold an employee's salary for this month or add arrears from earlier months.",
    override: 'Replace the calculated PT, ESI, TDS or LWF for an employee when needed.',
  };
  const pages = [
    ['Pick the month', 'The strip at the top shows every month of the financial year. Completed months are locked; the current month is the one to run.'],
    ...STEPS.map((st, n) => [`Step ${n + 1}: ${st.title}`, ABOUT[st.key]]),
    ['Process, lock and release', 'Process payroll to calculate every payslip, fix any errors, lock it, then release payslips so employees can see them.'],
  ];
  return (
    <Modal
      title="Running payroll"
      onClose={onClose}
      footer={
        <>
          <Btn kind="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </Btn>
          {i < pages.length - 1 ? <Btn onClick={() => setI(i + 1)}>Next</Btn> : <Btn onClick={onClose}>Done</Btn>}
        </>
      }
    >
      <p className="pr-muted">{`${i + 1} of ${pages.length}`}</p>
      <h4 style={{ margin: '6px 0' }}>{pages[i][0]}</h4>
      <p>{pages[i][1]}</p>
    </Modal>
  );
}

const ADJ_FIELDS = (kinds) => [
  { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
  { key: 'kind', label: 'Type', type: 'select', options: kinds, required: true },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'note', label: 'Note', full: true },
];

function AdjList({ db, ym, kinds, title, locked, changed }) {
  const [add, setAdd] = useState(false);
  const rows = db.payrollAdjustments.filter((a) => a.month === ym && kinds.includes(a.kind));
  return (
    <div className="pr-sec">
      <div className="pr-sec-head">
        <h4>{title}</h4>
        {!locked && (
          <Btn small kind="ghost" icon="plus" onClick={() => setAdd(true)}>
            Add
          </Btn>
        )}
      </div>
      <DataTable
        rows={rows}
        empty="Nothing added for this month."
        columns={[
          empCol(db),
          { key: 'kind', label: 'Type' },
          { key: 'amount', label: 'Amount', render: (a) => money(a.amount) },
          { key: 'note', label: 'Note' },
          { key: 'x', label: '', sortable: false, render: (a) => !locked && <Btn small kind="icon" icon="trash" aria-label="Remove" onClick={() => (removeItem('payrollAdjustments', a.id), changed(`Removed ${a.kind.toLowerCase()} for ${fullName(empById(db, a.empId))}`))} /> },
        ]}
      />
      {add && (
        <FormModal
          title={`Add ${title.toLowerCase()}`}
          fields={ADJ_FIELDS(kinds)}
          initial={{ kind: kinds[0] }}
          onClose={() => setAdd(false)}
          onSave={(v) => {
            addItem('payrollAdjustments', { ...v, amount: Number(v.amount), month: ym });
            setAdd(false);
            changed(`Added ${v.kind.toLowerCase()} of ${money(v.amount)} for ${fullName(empById(db, v.empId))}`);
          }}
        />
      )}
    </div>
  );
}

function PayNowButton({ onClick }) {
  return (
    <Btn small kind="ghost" onClick={onClick}>
      Pay in this payroll
    </Btn>
  );
}

function StepModal({ step, ym, user, t, locked, range, onClose }) {
  const db = useDB();
  const [from, to] = range;
  const [holdForm, setHoldForm] = useState(false);
  const [ovForm, setOvForm] = useState(null);
  const changed = (text) => inputsChanged(ym, user, text);
  const save = () => {
    update((d) => {
      const r = touchRun(d, ym);
      r.steps[step.key] = { at: new Date().toISOString(), by: user.id };
      markInputsChanged(d, ym, user);
      logActivity(d, ym, user, `Saved "${step.title}"`);
    });
    toast('Step saved');
    onClose();
  };
  const lopAdj = (id) => sumOf(db.payrollAdjustments.filter((a) => a.empId === id && a.month === ym && a.kind === 'LOP days'), (a) => a.amount);
  const setLop = (emp, v) => {
    if (Number(v || 0) === lopAdj(emp.id)) return;
    update((d) => {
      d.payrollAdjustments = d.payrollAdjustments.filter((a) => !(a.empId === emp.id && a.month === ym && a.kind === 'LOP days'));
      if (Number(v)) d.payrollAdjustments.push({ id: uid('adj'), empId: emp.id, month: ym, kind: 'LOP days', amount: Number(v), note: 'Payable units' });
    });
    changed(`Set loss-of-pay adjustment for ${fullName(emp)} to ${Number(v) || 0} day(s)`);
  };
  const hourly = (e) => Number(e?.ctc || 0) / 12 / 30 / 8;

  let content;
  if (step.key === 'attendance') {
    const exc = exceptionDays(db, ym);
    const decide = (x, value) => {
      update((d) => {
        setResolution(d, x.emp.id, x.date, value, user);
      });
      changed(`${value ? `Marked ${fmtDate(x.date)} for ${fullName(x.emp)} as ${value.toLowerCase()}` : `Cleared the decision for ${fmtDate(x.date)} for ${fullName(x.emp)}`}`);
    };
    content = (
      <>
      <h4 className="form-section" style={{ marginTop: 0 }}>Attendance exceptions ({exc.filter((x) => !x.resolution).length} without a decision)</h4>
      <p className="pr-muted" style={{ marginBottom: 10 }}>
        Days marked Absent or Action Required in this cycle. Choose what happens to each: paid, loss of pay, or half a day of loss of pay. Every day needs a decision before payroll can be locked, and you can change any of them until then. A day leaves this list when the employee applies leave or regularizes it. Exception employees are not listed.
      </p>
      <DataTable
        rows={exc.map((x) => ({ ...x, id: `${x.emp.id}-${x.date}` }))}
        empty="No attendance exceptions in this cycle."
        pageSize={20}
        columns={[
          { key: 'emp', label: 'Employee', sortable: false, render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
          { key: 'date', label: 'Date', render: (x) => fmtDate(x.date) },
          { key: 'status', label: 'What happened', sortable: false, render: (x) => <span><Badge tone={x.status === 'Absent' ? 'red' : 'amber'}>{x.status}</Badge>{x.note ? <span className="muted"> {x.note}</span> : null}{x.remark?.kind === 'pending' ? <span className="muted"> · {x.remark.text}</span> : null}</span> },
          { key: 'decision', label: 'Decision', sortable: false, render: (x) => (
            <select value={x.resolution} disabled={locked} onChange={(e) => decide(x, e.target.value)} aria-label={`Decision for ${fullName(x.emp)} on ${x.date}`}>
              <option value="">Not decided</option>
              {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          ) },
        ]}
      />
      <h4 className="form-section" style={{ marginTop: 20 }}>Payable days</h4>
      <DataTable
        rows={t.slips}
        rowKey={(x) => x.emp.id}
        pageSize={50}
        columns={[
          { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
          { key: 'dim', label: 'Cycle days' },
          { key: 'leave', label: 'Unpaid leave / not employed', sortable: false, render: (x) => x.lop - lopAdj(x.emp.id) },
          { key: 'adj', label: 'LOP adjustment', sortable: false, render: (x) => <input key={`${x.emp.id}-${lopAdj(x.emp.id)}`} className="pr-num" type="number" min="0" step="0.5" defaultValue={lopAdj(x.emp.id) || ''} placeholder="0" disabled={locked} onBlur={(e) => setLop(x.emp, e.target.value)} aria-label={`Loss of pay for ${fullName(x.emp)}`} /> },
          { key: 'paidDays', label: 'Payable days', render: (x) => <strong>{x.paidDays}</strong> },
        ]}
      />
      </>
    );
  } else if (step.key === 'joinees') {
    const joiners = t.people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
    const exits = db.exits.filter((x) => x.lastWorkingDay >= from && x.lastWorkingDay <= to);
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>New joinees</h4>
          </div>
          <DataTable rows={joiners} empty="Nobody joined in this cycle." columns={[{ key: 'emp', label: 'Employee', sortable: false, render: (e) => <EmpChip emp={e} sub={e.empNo} /> }, { key: 'dateOfJoining', label: 'Joined on', render: (e) => fmtDate(e.dateOfJoining) }, { key: 'paid', label: 'Payable days', sortable: false, render: (e) => t.slips.find((x) => x.emp.id === e.id)?.paidDays }, { key: 'ctc', label: 'Annual CTC', render: (e) => money(e.ctc) }]} />
        </div>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Exits</h4>
            <a className="btn btn-ghost btn-sm" href="#/admin/lifecycle">
              Open exits & settlement
            </a>
          </div>
          <DataTable rows={exits} empty="Nobody leaves in this cycle." columns={[empCol(db), { key: 'exitType', label: 'Exit type' }, { key: 'lastWorkingDay', label: 'Last working day', render: (x) => fmtDate(x.lastWorkingDay) }, { key: 'status', label: 'Exit status', render: (x) => <Badge>{x.status}</Badge> }, { key: 'fnf', label: 'Full & final', sortable: false, render: (x) => <Badge>{db.fnf.find((f) => f.empId === x.empId)?.status || 'Not started'}</Badge> }]} />
        </div>
      </>
    );
  } else if (step.key === 'bonus') {
    const revisions = db.promotions.filter((p) => p.effectiveFrom >= from && p.effectiveFrom <= to);
    const ot = db.overtime.filter((o) => o.status === 'Approved' && o.date >= from && o.date <= to);
    const rate = Number(db.attendanceSettings?.overtimeRate || 1.5);
    const otPay = (o) => Math.round(o.hours * hourly(empById(db, o.empId)) * rate);
    const payOt = (o) => {
      addItem('payrollAdjustments', { empId: o.empId, month: ym, kind: 'Overtime', amount: otPay(o), note: fmtDate(o.date) });
      patchItem('overtime', o.id, { paidIn: ym });
      changed(`Added overtime pay for ${fullName(empById(db, o.empId))}`);
    };
    content = (
      <>
        <AdjList db={db} ym={ym} kinds={['Bonus', 'Incentive']} title="Bonus" locked={locked} changed={changed} />
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Salary revisions taking effect</h4>
            <a className="btn btn-ghost btn-sm" href="#/admin/payroll/admin/revisions">
              Manage revisions
            </a>
          </div>
          <DataTable rows={revisions} empty="No revisions take effect in this cycle." columns={[empCol(db), { key: 'newDesignation', label: 'Job title' }, { key: 'oldCtc', label: 'Old CTC', render: (p) => money(p.oldCtc) }, { key: 'newCtc', label: 'New CTC', render: (p) => money(p.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]} />
        </div>
        {db.attendanceSettings?.overtimeEnabled ? (
          <>
            <div className="pr-sec">
              <div className="pr-sec-head">
                <h4>Approved overtime</h4>
              </div>
              <DataTable
                rows={ot}
                empty="No approved overtime in this cycle."
                columns={[
                  empCol(db),
                  { key: 'date', label: 'Date', render: (o) => fmtDate(o.date) },
                  { key: 'hours', label: 'Hours' },
                  { key: 'amt', label: `Pay at ${rate}×`, sortable: false, render: (o) => money(otPay(o)) },
                  { key: 'act', label: '', sortable: false, render: (o) => (o.paidIn ? <Badge tone="green">{`Added to ${shortMonth(o.paidIn)}`}</Badge> : !locked && <PayNowButton onClick={() => payOt(o)} />) },
                ]}
              />
            </div>
            <AdjList db={db} ym={ym} kinds={['Overtime']} title="Overtime payouts" locked={locked} changed={changed} />
          </>
        ) : (
          <p className="pr-muted">Overtime is switched off in Attendance settings, so there is nothing to pay.</p>
        )}
      </>
    );
  } else if (step.key === 'reimbursement') {
    const waiting = [...db.claims.filter((c) => c.status === 'Approved' && !c.paidIn).map((c) => ({ ...c, src: 'claims', label: c.component })), ...db.expenses.filter((e) => e.status === 'Approved').map((e) => ({ ...e, src: 'expenses', label: e.title }))];
    const pay = (c) => {
      addItem('payrollAdjustments', { empId: c.empId, month: ym, kind: 'Reimbursement', amount: Number(c.amount), note: c.label });
      patchItem(c.src, c.id, c.src === 'claims' ? { paidIn: ym } : { status: 'Paid', paidIn: ym });
      changed(`Added reimbursement "${c.label}" for ${fullName(empById(db, c.empId))}`);
    };
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Approved claims and expenses waiting for payment</h4>
          </div>
          <DataTable rows={waiting} empty="Nothing waiting for payment." columns={[empCol(db), { key: 'label', label: 'Item' }, { key: 'amount', label: 'Amount', render: (c) => money(c.amount) }, { key: 'act', label: '', sortable: false, render: (c) => !locked && <PayNowButton onClick={() => pay(c)} /> }]} />
        </div>
        <AdjList db={db} ym={ym} kinds={['Reimbursement', 'Adhoc payment', 'Leave encashment', 'Gratuity', 'Deduction']} title="Reimbursements, adhoc payments and deductions" locked={locked} changed={changed} />
      </>
    );
  } else if (step.key === 'hold') {
    const holds = (db.payrollHolds || []).filter((h) => h.month === ym);
    content = (
      <>
        <div className="pr-sec">
          <div className="pr-sec-head">
            <h4>Salaries on hold</h4>
            {!locked && (
              <Btn small kind="ghost" icon="plus" onClick={() => setHoldForm(true)}>
                Hold salary
              </Btn>
            )}
          </div>
          <DataTable rows={holds} empty="No salaries are on hold this month." columns={[empCol(db), { key: 'reason', label: 'Reason' }, { key: 'x', label: '', sortable: false, render: (h) => !locked && <Btn small kind="ghost" onClick={() => (removeItem('payrollHolds', h.id), changed(`Released salary hold for ${fullName(empById(db, h.empId))}`))}>Release hold</Btn> }]} />
        </div>
        <AdjList db={db} ym={ym} kinds={['Arrears']} title="Arrears" locked={locked} changed={changed} />
        {holdForm && (
          <FormModal
            title="Hold salary"
            fields={[
              { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
              { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
            ]}
            onClose={() => setHoldForm(false)}
            onSave={(v) => {
              addItem('payrollHolds', { ...v, month: ym });
              setHoldForm(false);
              changed(`Held salary for ${fullName(empById(db, v.empId))}`);
            }}
          />
        )}
      </>
    );
  } else {
    const rows = (db.payrollOverrides || []).filter((o) => o.month === ym);
    const val = (v) => (v === '' || v === undefined || v === null ? 'Calculated' : money(v));
    content = (
      <div className="pr-sec">
        <div className="pr-sec-head">
          <h4>Statutory overrides</h4>
          {!locked && (
            <Btn small kind="ghost" icon="plus" onClick={() => setOvForm({})}>
              Add override
            </Btn>
          )}
        </div>
        <DataTable
          rows={rows}
          empty="All statutory amounts are calculated automatically this month."
          onRowClick={locked ? undefined : setOvForm}
          columns={[
            empCol(db),
            { key: 'pt', label: 'PT', render: (o) => val(o.pt) },
            { key: 'esi', label: 'ESI', render: (o) => val(o.esi) },
            { key: 'tds', label: 'TDS', render: (o) => val(o.tds) },
            { key: 'lwf', label: 'LWF', render: (o) => val(o.lwf) },
            { key: 'reason', label: 'Reason' },
            { key: 'x', label: '', sortable: false, render: (o) => !locked && <Btn small kind="icon" icon="trash" aria-label="Remove" onClick={(e) => (e.stopPropagation(), removeItem('payrollOverrides', o.id), changed(`Removed override for ${fullName(empById(db, o.empId))}`))} /> },
          ]}
        />
        {ovForm && (
          <FormModal
            title={ovForm.id ? 'Edit override' : 'Add override'}
            initial={ovForm}
            fields={[
              { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
              { key: 'pt', label: 'Professional tax', type: 'number', help: 'Leave empty to keep the calculated amount.' },
              { key: 'esi', label: 'ESI (employee)', type: 'number' },
              { key: 'tds', label: 'Income tax (TDS)', type: 'number' },
              { key: 'lwf', label: 'Labour welfare fund', type: 'number' },
              { key: 'reason', label: 'Reason', full: true },
            ]}
            onClose={() => setOvForm(null)}
            onSave={(v) => {
              if (ovForm.id) patchItem('payrollOverrides', ovForm.id, v);
              else addItem('payrollOverrides', { ...v, month: ym });
              setOvForm(null);
              changed(`Saved statutory override for ${fullName(empById(db, v.empId))}`);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <Modal
      title={`${step.title} — ${monthLabel(ym)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn kind="ghost" onClick={onClose}>
            Close
          </Btn>
          {!locked && <Btn onClick={save}>Save & mark complete</Btn>}
        </>
      }
    >
      {locked && <p className="pr-note">This payroll month is locked or not open yet, so its inputs can't be changed.</p>}
      {content}
    </Modal>
  );
}


export default RunPayroll;
