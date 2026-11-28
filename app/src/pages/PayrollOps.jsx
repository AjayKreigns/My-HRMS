// Payroll admin, approvals, loans, benefits and reports. Opened from Payroll.jsx when needed.
import { useMemo, useState } from 'react';
import { addItem, patchItem, removeItem, notify } from '../store.js';
import { Btn, Badge, DataTable, FormModal, EmpChip, Crud, Modal, toast, confirmAction, exportCSV, exportText } from '../ui.jsx';
import { PayslipView, DECLARATION_FIELDS } from './Finances.jsx';
import { ApproveButtons, empCol } from './adminShared.jsx';
import { empById, fullName, fmtDate, money, monthLabel, payslipFor, ymOf, addMonths, addDays, todayISO, declarationTotal, cycleRange, attendanceFor, taxProjection, fyOf, cycleStartOf, loanEmi, loanOutstanding, loanPaidBefore, breakupFor, payGroupOf, structureOf, settingsFor } from '../utils.js';
import { esiPolicy, esiPeriodOf } from '../statutory.js';
import { ecrFile, esiRows, pfTotals, ESI_COLUMNS } from '../statutoryFiles.js';
import { payrollRegister } from '../register.js';
import { downloadPayslipPdf } from '../payslipPdf.js';
import { MonthSelect, Panel, bandOf, currentPayMonth, goto, inr, isDone, monthTotals, shortMonth, stamp, sumOf } from './payrollShared.jsx';
import '../payroll.css';
import '../payrollx.css';

// ---------- payroll admin ----------

const runLabel = (r) => (r.status === 'Finalized' ? 'Locked' : r.status === 'Submitted' ? 'Awaiting approval' : r.status);

export function PayrollAdmin({ db, user, sub }) {
  const cur = currentPayMonth(db);
  const months = [...new Set([cur, ...db.payrollRuns.map((r) => r.month)])].sort().reverse();
  const [ym, setYm] = useState(months.find((m) => isDone(db.payrollRuns.find((r) => r.month === m))) || cur);
  const t = useMemo(() => monthTotals(db, ym), [db, ym]);
  const [slip, setSlip] = useState(null);
  const [decl, setDecl] = useState(null);
  const [emp, setEmp] = useState(null);
  const [revise, setRevise] = useState(null);
  const [challan, setChallan] = useState(null);
  const sumDed = (prefix) => sumOf(t.slips, (x) => x.deductions.find((d) => d[0].startsWith(prefix))?.[1] || 0);
  const run = db.payrollRuns.find((r) => r.month === ym);
  const br = (e) => breakupFor(db, e);

  let body;
  if (sub === 'history') {
    body = (
      <Panel title="Payroll history">
        <DataTable
          rows={[...db.payrollRuns].sort((a, b) => b.month.localeCompare(a.month))}
          onRowClick={(r) => goto(`run/${r.month}`)}
          columns={[
            { key: 'month', label: 'Month', render: (r) => monthLabel(r.month) },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={isDone(r) ? 'green' : 'blue'}>{runLabel(r)}</Badge> },
            { key: 'processedOn', label: 'Processed on', render: (r) => (r.processedAt ? stamp(r.processedAt) : fmtDate(r.processedOn)) },
            { key: 'processedBy', label: 'By', render: (r) => fullName(empById(db, r.processedBy)) },
            { key: 'cost', label: 'Payroll cost', sortable: false, render: (r) => inr(monthTotals(db, r.month).cost) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'salaries') {
    const people = db.employees.filter((e) => e.status !== 'Exited');
    // Components differ between structures, so the columns are the union of every structure's components.
    const compNames = [...new Set(people.flatMap((e) => br(e).earnings.map(([k]) => k)))];
    const cols = [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Pay group', csv: (e) => payGroupOf(db, e)?.name }, { label: 'Structure', csv: (e) => structureOf(db, e)?.name }, { label: 'Annual CTC', csv: (e) => e.ctc }, ...compNames.map((k) => ({ label: k, csv: (e) => Math.round(br(e).earnings.find(([n]) => n === k)?.[1] || 0) }))];
    body = (
      <Panel title="Employee salaries" right={<Btn kind="ghost" small icon="download" onClick={() => exportCSV('employee-salaries', cols, people)}>Export</Btn>}>
        <DataTable
          rows={people}
          pageSize={30}
          onRowClick={setEmp}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} sub={e.empNo} /> },
            { key: 'band', label: 'Band', render: (e) => bandOf(db, e)?.name || '—' },
            { key: 'group', label: 'Pay group', sortable: false, render: (e) => payGroupOf(db, e)?.name || '—' },
            { key: 'structure', label: 'Structure', sortable: false, render: (e) => structureOf(db, e)?.name || '—' },
            { key: 'ctc', label: 'Annual CTC', render: (e) => inr(e.ctc) },
            { key: 'gross', label: 'Monthly gross', sortable: false, render: (e) => inr(br(e).gross) },
            { key: 'basic', label: 'Basic', sortable: false, render: (e) => inr(br(e).earnings[0][1]) },
            { key: 'pf', label: 'Employer PF', sortable: false, render: (e) => inr(br(e).employer[0][1]) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'payslips') {
    body = (
      <Panel
        title={`Payslips — ${monthLabel(ym)}`}
        right={
          <div className="row">
            <MonthSelect value={ym} onChange={setYm} months={months} />
            {run && <Badge tone={isDone(run) ? 'green' : 'blue'}>{runLabel(run)}</Badge>}
          </div>
        }
      >
        <DataTable
          rows={t.slips}
          rowKey={(x) => x.emp.id}
          pageSize={30}
          onRowClick={setSlip}
          columns={[
            { key: 'emp', label: 'Employee', sortValue: (x) => fullName(x.emp), render: (x) => <EmpChip emp={x.emp} sub={x.emp.empNo} /> },
            { key: 'gross', label: 'Gross', render: (x) => money(x.gross) },
            { key: 'totalDed', label: 'Deductions', render: (x) => money(x.totalDed) },
            { key: 'net', label: 'Net pay', render: (x) => <strong>{money(x.net)}</strong> },
            { key: 'v', label: '', sortable: false, render: (x) => (x.onHold ? <Badge tone="amber">On hold</Badge> : run?.status === 'Paid' ? <Badge tone="green">Released</Badge> : null) },
          ]}
        />
      </Panel>
    );
  } else if (sub === 'statutory') {
    const ee = (x) => x.deductions.find((d) => d[0].startsWith('Provident'))?.[1] || 0;
    const pft = pfTotals(db, t.slips);
    const ecr = ecrFile(db, t.slips);
    const esiList = esiRows(db, t.slips);
    const esiEmployer = sumOf(t.slips, (x) => x.esi?.employer || 0);
    const esiNow = esiPolicy(db);
    const period = esiPeriodOf(esiNow, ym);
    body = (
      <div className="pr-stack">
        <div className="row">
          <MonthSelect value={ym} onChange={setYm} months={months} />
        </div>
        <div className="pr-cards4">
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>PF (employee)</span><em>{`ER ${inr(pft.employer)}`}</em></div>
            <strong>{inr(sumDed('Provident'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>ESI (employee)</span><em>{`ER ${inr(esiEmployer)}`}</em></div>
            <strong>{inr(sumDed('ESI'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>Professional tax</span><em>{`LWF ${inr(sumDed('Labour'))}`}</em></div>
            <strong>{inr(sumDed('Professional'))}</strong>
          </div>
          <div className="pr-kpi">
            <div className="pr-kpi-top"><span>TDS deducted</span></div>
            <strong>{inr(sumDed('Income'))}</strong>
          </div>
        </div>
        <Panel title="PF ECR summary" right={<Btn kind="ghost" small icon="download" onClick={() => downloadEcr(db, t.slips, ym)}>Download ECR</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>
            {pft.members} member(s). Employee {money(pft.employee)} + employer EPF {money(pft.epf)} + employer EPS {money(pft.eps)} + EDLI {money(pft.edli)} + administration {money(pft.admin)}{pft.adminSum > 0 && pft.admin > Math.round(pft.adminSum) ? ' (raised to the minimum)' : ''} = <strong>{money(pft.remit)}</strong> to pay with the challan. The file follows the ECR 2.0 layout.
          </p>
          {ecr.missing.length > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>No UAN on the profile, so left out of the file: {ecr.missing.map(fullName).join(', ')}.</p>}
          <DataTable
            rows={ecr.rows}
            empty="No employee has PF deducted this month."
            rowKey={(r) => r.slip.emp.id}
            pageSize={30}
            columns={[
              { key: 'uan', label: 'UAN', sortable: false, render: (r) => r.slip.emp.uan || '—' },
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => fullName(r.slip.emp) },
              { key: 'gross', label: 'Gross wages', render: (r) => money(r.slip.gross) },
              { key: 'epf', label: 'EPF wages', sortable: false, render: (r) => money(r.pf.wage) },
              { key: 'eps', label: 'EPS wages', sortable: false, render: (r) => money(r.pf.epsWage) },
              { key: 'ee', label: 'Employee EPF', sortable: false, render: (r) => money(r.pf.employee) },
              { key: 'er1', label: 'Employer EPS', sortable: false, render: (r) => money(r.pf.eps) },
              { key: 'er2', label: 'Employer EPF', sortable: false, render: (r) => money(r.pf.employer - r.pf.eps) },
              { key: 'ncp', label: 'Days not paid', sortable: false, render: (r) => Math.round(r.slip.lop || 0) },
            ]}
          />
        </Panel>
        <Panel title="ESI contribution" right={<Btn kind="ghost" small icon="download" onClick={() => downloadEsi(db, t.slips, ym)}>Download ESI file</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>
            {esiNow.enabled === false
              ? 'ESI is switched off for the company (Payroll > Settings > PF & ESI).'
              : <>Contribution period {monthLabel(period.start)} – {monthLabel(period.end)}. Covered for the whole period if wages in its first month are up to {money(esiNow.grossLimit)}. Employee {esiNow.employeeRate}% and employer {esiNow.employerRate}% of wages, without overtime, rounded up to the rupee. Total to pay: <strong>{money(sumDed('ESI') + esiEmployer)}</strong>.</>}
          </p>
          {esiList.missing.length > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>No ESI number on the profile, so left out of the file: {esiList.missing.map(fullName).join(', ')}.</p>}
          <DataTable
            rows={esiList.rows}
            empty="No employee is covered by ESI this month."
            rowKey={(r) => r.slip.emp.id}
            pageSize={30}
            columns={[
              { key: 'ip', label: 'ESI number', sortable: false, render: (r) => r.cols[0] },
              { key: 'emp', label: 'Employee', sortable: false, render: (r) => fullName(r.slip.emp) },
              { key: 'days', label: 'Days paid', sortable: false, render: (r) => r.cols[2] },
              { key: 'wages', label: 'ESI wages', sortable: false, render: (r) => money(r.cols[3]) },
              { key: 'ee', label: 'Employee', sortable: false, render: (r) => money(r.slip.esi?.employee ?? 0) },
              { key: 'er', label: 'Employer', sortable: false, render: (r) => money(r.slip.esi?.employer ?? 0) },
            ]}
          />
        </Panel>
        <Panel title="Challan register" right={<Btn small icon="plus" onClick={() => setChallan({ month: ym, paidOn: todayISO() })}>Record a payment</Btn>}>
          <p className="pr-muted" style={{ marginBottom: 12 }}>What is due for {monthLabel(ym)} against the payments you record. Record each challan after you pay it at the portal.</p>
          <DataTable
            rows={CHALLAN_TYPES.map((tp) => {
              const due = { PF: pft.remit, ESI: sumDed('ESI') + esiEmployer, 'Professional Tax': sumDed('Professional'), LWF: sumDed('Labour') + sumOf(t.slips, (x) => (x.employer.find(([k]) => k === 'Employer LWF') || [0, 0])[1]), TDS: sumDed('Income') }[tp];
              const paid = sumOf((db.challans || []).filter((c) => c.type === tp && c.month === ym), (c) => c.amount);
              return { id: tp, type: tp, due, paid };
            })}
            columns={[
              { key: 'type', label: 'Payment' },
              { key: 'due', label: `Due for ${monthLabel(ym)}`, render: (r) => money(r.due) },
              { key: 'paid', label: 'Recorded as paid', render: (r) => money(r.paid) },
              { key: 'st', label: 'Status', sortable: false, render: (r) => (r.due <= 0 ? <Badge tone="grey">Nothing due</Badge> : r.paid >= r.due ? <Badge tone="green">Paid</Badge> : r.paid > 0 ? <Badge tone="amber">Part paid</Badge> : <Badge tone="red">Not paid</Badge>) },
            ]}
          />
          <h4 className="form-section" style={{ marginTop: 18 }}>Payments recorded</h4>
          <DataTable
            rows={[...(db.challans || [])].sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || ''))}
            empty="No payments recorded yet."
            columns={[
              { key: 'type', label: 'Payment' },
              { key: 'month', label: 'For', render: (c) => monthLabel(c.month) },
              { key: 'amount', label: 'Amount', render: (c) => money(c.amount) },
              { key: 'paidOn', label: 'Paid on', render: (c) => fmtDate(c.paidOn) },
              { key: 'ref', label: 'Challan / reference no.' },
              { key: 'bank', label: 'Bank' },
              { key: '_a', label: '', sortable: false, align: 'right', render: (c) => <Btn kind="icon" icon="trash" title="Delete" aria-label="Delete this payment" onClick={() => { if (confirmAction('Delete this recorded payment?')) removeItem('challans', c.id); }} /> },
            ]}
          />
        </Panel>
      </div>
    );
  } else if (sub === 'tax') {
    body = (
      <Panel title="Investment declarations">
        <DataTable
          rows={db.taxDeclarations}
          empty="No declarations submitted."
          columns={[
            empCol(db),
            { key: 'fy', label: 'FY' },
            { key: 'regime', label: 'Regime' },
            { key: 'c80', label: '80C', sortable: false, render: (d) => money(declarationTotal(d).c80) },
            { key: 'rent', label: 'Rent / year', sortable: false, render: (d) => money(declarationTotal(d).hraRent) },
            { key: 'status', label: 'Status', render: (d) => <Badge>{d.status}</Badge> },
            { key: 'act', label: '', sortable: false, render: (d) => <Btn kind="ghost" small onClick={() => setDecl(d)}>View</Btn> },
          ]}
        />
      </Panel>
    );
  } else {
    body = (
      <Crud
        title="Salary revisions & promotions"
        collection="promotions"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ effectiveFrom: todayISO(), status: 'Pending' }}
        beforeSave={(v) => ({ ...v, oldCtc: v.oldCtc || empById(db, v.empId)?.ctc, oldDesignation: v.oldDesignation || empById(db, v.empId)?.designation })}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'newDesignation', label: 'New job title', type: 'select', options: db.designations.map((d) => d.title), required: true },
          { key: 'newGradeId', label: 'New band', type: 'select', options: db.grades.map((g) => ({ value: g.id, label: g.name })) },
          { key: 'newCtc', label: 'New annual CTC', type: 'number', required: true },
          { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
          { key: 'reason', label: 'Reason', type: 'textarea', full: true },
        ]}
        columns={[empCol(db), { key: 'oldDesignation', label: 'From' }, { key: 'newDesignation', label: 'To' }, { key: 'newCtc', label: 'New CTC', render: (p) => `${money(p.newCtc)}${p.oldCtc ? ` (+${Math.round(((p.newCtc - p.oldCtc) / p.oldCtc) * 100)}%)` : ''}` }, { key: 'effectiveFrom', label: 'Effective', render: (p) => fmtDate(p.effectiveFrom) }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
        rowActions={(p) => <ApproveButtons db={db} user={user} col="promotions" row={p} kind="Promotion" />}
      />
    );
  }
  const b = emp && br(emp);
  return (
    <>
      {body}
      {slip && (
        <Modal title={`Payslip — ${fullName(slip.emp)} — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<><Btn kind="ghost" icon="download" onClick={() => downloadPayslipPdf(db, slip)} title="Password: employee number followed by date of birth (DDMMYYYY)">PDF (password protected)</Btn><Btn icon="print" onClick={() => window.print()}>Print</Btn></>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
      {challan && (
        <FormModal
          title="Record a payment"
          fields={[
            { key: 'type', label: 'Payment', type: 'select', options: CHALLAN_TYPES, required: true },
            { key: 'month', label: 'For the payroll month', type: 'select', options: months.map((m) => ({ value: m, label: monthLabel(m) })), required: true },
            { key: 'amount', label: 'Amount paid (₹)', type: 'number', required: true },
            { key: 'paidOn', label: 'Paid on', type: 'date', required: true },
            { key: 'ref', label: 'Challan / reference number' },
            { key: 'bank', label: 'Bank' },
          ]}
          initial={challan}
          onClose={() => setChallan(null)}
          onSave={(v) => {
            addItem('challans', { ...v, amount: Number(v.amount) });
            setChallan(null);
            toast('Payment recorded');
          }}
        />
      )}
      {decl && <FormModal title={`Declaration — ${fullName(empById(db, decl.empId))}`} fields={DECLARATION_FIELDS.map((f) => ({ ...f, disabled: true }))} initial={{ regime: decl.regime, ...decl.items }} submitLabel="Close" onClose={() => setDecl(null)} onSave={() => setDecl(null)} wide />}
      {emp && (
        <Modal title={`Salary structure — ${fullName(emp)}`} onClose={() => setEmp(null)} footer={<Btn onClick={() => (setRevise(emp), setEmp(null))}>Revise salary</Btn>}>
          <table className="pr-breakup">
            <thead>
              <tr>
                <th>Component</th>
                <th>Monthly</th>
                <th>Annual</th>
              </tr>
            </thead>
            <tbody>
              {[...b.earnings, ...b.employer].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{inr(v)}</td>
                  <td>{inr(v * 12)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Cost to company</td>
                <td>{inr(b.monthly)}</td>
                <td>{inr(emp.ctc)}</td>
              </tr>
            </tbody>
          </table>
        </Modal>
      )}
      {revise && (
        <FormModal
          title={`Revise salary — ${fullName(revise)}`}
          initial={{ newCtc: revise.ctc, newDesignation: revise.designation, effectiveFrom: todayISO() }}
          fields={[
            { key: 'newDesignation', label: 'Job title', type: 'select', options: db.designations.map((d) => d.title), required: true },
            { key: 'newCtc', label: 'New annual CTC', type: 'number', required: true },
            { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
            { key: 'reason', label: 'Reason', type: 'textarea', full: true },
          ]}
          onClose={() => setRevise(null)}
          onSave={(v) => {
            addItem('promotions', { ...v, empId: revise.id, oldCtc: revise.ctc, oldDesignation: revise.designation, newCtc: Number(v.newCtc), status: 'Pending' });
            setRevise(null);
            toast('Revision sent for approval');
          }}
        />
      )}
    </>
  );
}

// ---------- approvals ----------
export function Approvals({ db, user, sub }) {
  const [all, setAll] = useState(false);
  const show = (rows) => (all ? rows : rows.filter((r) => r.status === 'Pending' || r.status === 'Submitted'));
  const toggle = (
    <label className="check">
      <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show decided requests too
    </label>
  );
  const status = { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> };
  if (sub === 'proofs') {
    const verify = (d) => {
      patchItem('taxDeclarations', d.id, { status: 'Verified' });
      notify(d.empId, 'Your investment proofs were verified.');
      toast('Verified');
    };
    return (
      <Panel title="Investment proofs" right={toggle}>
        <DataTable
          rows={show(db.taxDeclarations)}
          empty="No proofs waiting for verification."
          columns={[empCol(db), { key: 'fy', label: 'FY' }, { key: 'regime', label: 'Regime' }, { key: 'c80', label: '80C', sortable: false, render: (d) => money(declarationTotal(d).c80) }, status, { key: 'act', label: '', sortable: false, render: (d) => d.status === 'Submitted' && <Btn kind="success" small onClick={() => verify(d)}>Verify</Btn> }]}
        />
      </Panel>
    );
  }
  const cfg = {
    loans: { col: 'loans', kind: 'Loan', title: 'Loan requests', cols: [{ key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'tenureMonths', label: 'Months' }, { key: 'reason', label: 'Reason' }] },
    claims: { col: 'claims', kind: 'Claim', title: 'Reimbursement claims', cols: [{ key: 'component', label: 'Component' }, { key: 'month', label: 'For', render: (r) => (r.month ? monthLabel(r.month) : '—') }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'billName', label: 'Bill' }] },
    advances: { col: 'advances', kind: 'Advance', title: 'Salary & expense advances', cols: [{ key: 'purpose', label: 'Purpose' }, { key: 'amount', label: 'Amount', render: (r) => money(r.amount) }, { key: 'requiredBy', label: 'Needed by', render: (r) => fmtDate(r.requiredBy) }] },
    revisions: { col: 'promotions', kind: 'Promotion', title: 'Salary revisions', cols: [{ key: 'newDesignation', label: 'Job title' }, { key: 'oldCtc', label: 'Current CTC', render: (r) => money(r.oldCtc) }, { key: 'newCtc', label: 'New CTC', render: (r) => money(r.newCtc) }, { key: 'effectiveFrom', label: 'Effective', render: (r) => fmtDate(r.effectiveFrom) }] },
  }[sub];
  return (
    <Panel title={cfg.title} right={toggle}>
      <DataTable rows={show(db[cfg.col] || [])} empty="Nothing waiting for approval." columns={[empCol(db), ...cfg.cols, status, { key: 'act', label: '', sortable: false, render: (r) => <ApproveButtons db={db} user={user} col={cfg.col} row={r} kind={cfg.kind} /> }]} />
    </Panel>
  );
}

// ---------- loans ----------
export function Loans({ db, user }) {
  const ym = currentPayMonth(db);
  const paidMonths = (l) => loanPaidBefore(l, ym);
  const emi = loanEmi;
  const active = db.loans.filter((l) => l.status === 'Active');
  return (
    <div className="pr-stack">
      <div className="pr-cards4">
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Active loans</span></div><strong>{active.length}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Amount lent</span></div><strong>{inr(sumOf(active, (l) => l.amount))}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>Outstanding</span></div><strong>{inr(sumOf(active, (l) => loanOutstanding(l, ym)))}</strong></div>
        <div className="pr-kpi"><div className="pr-kpi-top"><span>EMI this month</span><em>{shortMonth(ym)}</em></div><strong>{inr(sumOf(active.filter((l) => l.startMonth <= ym && paidMonths(l) < l.tenureMonths), emi))}</strong></div>
      </div>
      <Crud
        title="Loans & advances"
        collection="loans"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ status: 'Active', startMonth: addMonths(ymOf(), 1), tenureMonths: 6, interestRate: 0 }}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Salary Advance', 'Personal Loan', 'Vehicle Loan', 'Emergency Loan'], required: true },
          { key: 'amount', label: 'Amount', type: 'number', required: true },
          { key: 'interestRate', label: 'Interest rate (%)', type: 'number' },
          { key: 'tenureMonths', label: 'Tenure (months)', type: 'number', required: true },
          { key: 'startMonth', label: 'Deduction starts', type: 'month', required: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Active', 'Closed', 'Rejected'] },
          { key: 'reason', label: 'Reason', type: 'textarea', full: true },
        ]}
        columns={[empCol(db), { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount', render: (l) => money(l.amount) }, { key: 'emi', label: 'EMI', sortable: false, render: (l) => money(emi(l)) }, { key: 'paid', label: 'EMIs paid', sortable: false, render: (l) => `${paidMonths(l)}/${l.tenureMonths}` }, { key: 'startMonth', label: 'From', render: (l) => (l.startMonth ? monthLabel(l.startMonth) : '—') }, { key: 'status', label: 'Status', render: (l) => <Badge>{l.status}</Badge> }]}
        rowActions={(l) => <ApproveButtons db={db} user={user} col="loans" row={l} kind="Loan" />}
      />
    </div>
  );
}

// ---------- benefits ----------
export function Benefits({ db }) {
  const plan = (id) => db.benefitPlans.find((p) => p.id === id);
  return (
    <div className="pr-stack">
      <Crud
        title="Benefit plans"
        collection="benefitPlans"
        searchKeys={['name', 'provider']}
        defaults={{ status: 'Active', type: 'Health insurance' }}
        fields={[
          { key: 'name', label: 'Plan name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Health insurance', 'Life insurance', 'Accident insurance', 'Retirement', 'Meal card', 'Fuel & vehicle', 'Wellness', 'Other'], required: true },
          { key: 'provider', label: 'Provider' },
          { key: 'policyNumber', label: 'Policy number' },
          { key: 'coverage', label: 'Cover amount', type: 'number' },
          { key: 'employerMonthly', label: 'Company pays / month', type: 'number' },
          { key: 'employeeMonthly', label: 'Employee pays / month', type: 'number' },
          { key: 'eligibility', label: 'Who is eligible', full: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Closed'] },
        ]}
        columns={[{ key: 'name', label: 'Plan' }, { key: 'type', label: 'Type' }, { key: 'provider', label: 'Provider' }, { key: 'coverage', label: 'Cover', render: (p) => (Number(p.coverage) ? money(p.coverage) : '—') }, { key: 'employerMonthly', label: 'Company / month', render: (p) => money(p.employerMonthly) }, { key: 'enrolled', label: 'Enrolled', sortable: false, render: (p) => db.benefitEnrollments.filter((x) => x.planId === p.id && x.status === 'Enrolled').length }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]}
      />
      <Crud
        title="Enrolments"
        collection="benefitEnrollments"
        searchKeys={[(r, d) => fullName(empById(d, r.empId))]}
        defaults={{ status: 'Enrolled', tier: 'Employee only', startDate: todayISO() }}
        fields={[
          { key: 'empId', label: 'Employee', type: 'employee', required: true, full: true },
          { key: 'planId', label: 'Plan', type: 'select', options: db.benefitPlans.map((p) => ({ value: p.id, label: p.name })), required: true },
          { key: 'tier', label: 'Cover for', type: 'select', options: ['Employee only', 'Employee + spouse', 'Employee + family', 'Employee + family + parents'] },
          { key: 'dependents', label: 'Dependents covered', full: true },
          { key: 'startDate', label: 'Start date', type: 'date', required: true },
          { key: 'status', label: 'Status', type: 'select', options: ['Enrolled', 'Opted out', 'Ended'] },
        ]}
        columns={[empCol(db), { key: 'planId', label: 'Plan', render: (r) => plan(r.planId)?.name || '—' }, { key: 'tier', label: 'Cover for' }, { key: 'startDate', label: 'Since', render: (r) => fmtDate(r.startDate) }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Enrolled' ? 'green' : 'grey'}>{r.status}</Badge> }]}
      />
    </div>
  );
}

const CHALLAN_TYPES = ['PF', 'ESI', 'Professional Tax', 'LWF', 'TDS'];

// ---------- PF and ESI files ----------
// The ECR 2.0 file. Members with no UAN cannot be put in it, so say who was left out.
function downloadEcr(db, slips, ym) {
  const f = ecrFile(db, slips);
  if (!f.lines.length) return toast('No employee has PF this month.', 'error');
  exportText(`ECR_${ym}`, f.text);
  toast(f.missing.length ? `ECR downloaded with ${f.lines.length} member(s). Left out, no UAN: ${f.missing.map(fullName).join(', ')}.` : `ECR downloaded with ${f.lines.length} member(s).`, f.missing.length ? 'error' : undefined);
}
function downloadEsi(db, slips, ym) {
  const f = esiRows(db, slips);
  if (!f.rows.length) return toast('No employee is covered by ESI this month.', 'error');
  exportCSV(`ESI_${ym}`, ESI_COLUMNS.map((label, i) => ({ label, csv: (r) => r.cols[i] })), f.rows);
  toast(f.missing.length ? `ESI file downloaded with ${f.rows.length} employee(s). Left out, no ESI number: ${f.missing.map(fullName).join(', ')}.` : `ESI file downloaded with ${f.rows.length} employee(s).`, f.missing.length ? 'error' : undefined);
}

// ---------- reports ----------
export function Reports({ db }) {
  const cur = currentPayMonth(db);
  const months = [...new Set([cur, ...db.payrollRuns.map((r) => r.month)])].sort().reverse();
  const [ym, setYm] = useState(months[1] || months[0]);
  const ded = (prefix) => (x) => Math.round(x.deductions.find((d) => d[0].startsWith(prefix))?.[1] || 0);
  const base = [{ label: 'Employee', csv: (x) => fullName(x.emp) }, { label: 'Emp no', csv: (x) => x.emp.empNo }];
  const slips = () => monthTotals(db, ym).slips;
  const prevNet = (prev, x) => prev.find((p) => p.emp.id === x.emp.id)?.net || 0;
  const variance = () => {
    const prev = monthTotals(db, addMonths(ym, -1)).slips;
    exportCSV(`variance-${ym}`, [...base, { label: 'Previous net', csv: (x) => Math.round(prevNet(prev, x)) }, { label: 'This month net', csv: (x) => Math.round(x.net) }, { label: 'Difference', csv: (x) => Math.round(x.net - prevNet(prev, x)) }], slips());
  };
  const REPORTS = [
    ['Payroll register', 'Every earning, deduction and employer cost for each employee, with totals.', () => { const reg = payrollRegister(db, ym); exportCSV(`payroll-register-${ym}`, reg.columns, reg.rows); }],
    ['Bank transfer statement', 'Account details and net pay for the bank upload.', () => exportCSV(`bank-transfer-${ym}`, [...base, { label: 'Account holder', csv: (x) => x.emp.bank?.accountHolder }, { label: 'Bank', csv: (x) => x.emp.bank?.bankName }, { label: 'Account number', csv: (x) => x.emp.bank?.accountNumber }, { label: 'IFSC', csv: (x) => x.emp.bank?.ifsc }, { label: 'Net pay', csv: (x) => Math.round(x.net) }, { label: 'Payment mode', csv: () => 'NEFT' }, { label: 'Narration', csv: () => `Salary ${monthLabel(ym)}` }], slips().filter((x) => !x.onHold))],
    ['PF ECR', 'The ECR 2.0 text file for the EPFO upload, with EPF, EPS and EDLI wages and contributions.', () => downloadEcr(db, slips(), ym)],
    ['ESI contribution', 'The monthly contribution file for the ESIC upload: days worked and wages of every covered employee.', () => downloadEsi(db, slips(), ym)],
    ['Form 130 data (annual salary and tax)', 'For your CA: each employee’s pay, PF, Professional Tax, taxable income, tax for the year and TDS so far in this financial year. Unlocked months use current figures.', () => {
      const months = Array.from({ length: 12 }, (_, i) => addMonths(`${fyOf(ym)}-04`, i)).filter((m) => m <= ym);
      const ded = (sl, p) => sumOf(sl, (s) => (s.deductions.find((d) => d[0].startsWith(p)) || [0, 0])[1]);
      const rows = monthTotals(db, ym).people.map((e) => {
        const sl = months.map((m) => payslipFor(db, e, m));
        return { e, gross: sumOf(sl, (s) => s.gross), pf: ded(sl, 'Provident'), pt: ded(sl, 'Professional'), tds: ded(sl, 'Income'), tp: taxProjection(db, e, ym) };
      });
      exportCSV(`form130-data-${fyOf(ym)}-${ym}`, [{ label: 'Employee', csv: (r) => fullName(r.e) }, { label: 'Emp no', csv: (r) => r.e.empNo }, { label: 'PAN', csv: (r) => r.e.pan }, { label: 'Tax regime', csv: (r) => r.tp.regime }, { label: 'Gross pay to date', csv: (r) => Math.round(r.gross) }, { label: 'Employee PF', csv: (r) => Math.round(r.pf) }, { label: 'Professional Tax', csv: (r) => Math.round(r.pt) }, { label: 'Taxable income (year)', csv: (r) => Math.round(r.tp.taxable) }, { label: 'Tax for the year', csv: (r) => Math.round(r.tp.annualTax) }, { label: 'TDS deducted to date', csv: (r) => Math.round(r.tds) }], rows);
    }],
    ['Form 138 data (quarterly TDS)', 'For your CA: TDS deducted each month of the quarter that holds this month, with PAN.', () => {
      const qStart = [`${fyOf(ym)}-04`, `${fyOf(ym)}-07`, `${fyOf(ym)}-10`, `${fyOf(ym) + 1}-01`].filter((m) => m <= ym).pop();
      const months = [0, 1, 2].map((i) => addMonths(qStart, i)).filter((m) => m <= ym);
      const rows = months.flatMap((m) => monthTotals(db, m).slips.map((s) => ({ m, s })));
      exportCSV(`form138-data-${qStart}`, [{ label: 'Employee', csv: (r) => fullName(r.s.emp) }, { label: 'PAN', csv: (r) => r.s.emp.pan }, { label: 'Month', csv: (r) => monthLabel(r.m) }, { label: 'Gross pay', csv: (r) => Math.round(r.s.gross) }, { label: 'TDS deducted', csv: (r) => Math.round((r.s.deductions.find((d) => d[0].startsWith('Income')) || [0, 0])[1]) }], rows);
    }],
    ['Form 124 data (tax declarations)', 'The investment declarations employees have made, with regime, rent and landlord details.', () =>
      exportCSV('form124-declarations', [{ label: 'Employee', csv: (d) => fullName(empById(db, d.empId)) }, { label: 'PAN', csv: (d) => empById(db, d.empId)?.pan }, { label: 'Financial year', csv: (d) => d.fy }, { label: 'Regime', csv: (d) => d.regime }, { label: '80C', csv: (d) => declarationTotal(d).c80 }, { label: '80D', csv: (d) => declarationTotal(d).d80 }, { label: 'Other deductions', csv: (d) => declarationTotal(d).other }, { label: 'Annual rent', csv: (d) => declarationTotal(d).hraRent }, { label: 'Landlord', csv: (d) => d.items?.landlordName }, { label: 'Landlord PAN', csv: (d) => d.items?.landlordPan }, { label: 'Status', csv: (d) => d.status }], db.taxDeclarations)],
    ['Muster roll', 'Attendance of every employee for each day of the pay cycle (P present, W work from home, L leave, A absent, AR action required, WO weekly off, H holiday).', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const code = { Present: 'P', WFH: 'W', Leave: 'L', Absent: 'A', 'Action Required': 'AR', 'Weekly off': 'WO', Holiday: 'H' };
      exportCSV(`muster-roll-${ym}`, [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, ...days.map((d) => ({ label: d.slice(8) + '/' + d.slice(5, 7), csv: (e) => (e.attendanceExempt === 'Yes' ? 'EX' : d < e.dateOfJoining ? '' : code[attendanceFor(db, e.id, d).status] || '') }))], monthTotals(db, ym).people);
    }],
    ['Leave register', 'Approved leave taken in this pay cycle.', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      exportCSV(`leave-register-${ym}`, [{ label: 'Employee', csv: (r) => fullName(empById(db, r.empId)) }, { label: 'Emp no', csv: (r) => empById(db, r.empId)?.empNo }, { label: 'Leave type', csv: (r) => db.leaveTypes.find((t) => t.id === r.typeId)?.name }, { label: 'From', csv: (r) => r.from }, { label: 'To', csv: (r) => r.to }, { label: 'Days', csv: (r) => r.days }, { label: 'Loss of pay days', csv: (r) => r.lopDays || 0 }], db.leaveRequests.filter((r) => r.status === 'Approved' && r.from >= from && r.from <= to));
    }],
    ['Change audit', 'Who changed pay-related details (salary, bank, statutory numbers, pay group) and payroll settings in this pay cycle.', () => {
      const [from, to] = cycleRange(ym, cycleStartOf(db));
      const rows = (db.auditLog || []).filter((a) => a.at.slice(0, 10) >= from && a.at.slice(0, 10) <= to);
      if (!rows.length) return toast('No changes were recorded in this pay cycle.');
      exportCSV(`change-audit-${ym}`, [{ label: 'When', csv: (a) => a.at.replace('T', ' ').slice(0, 19) }, { label: 'Changed by', csv: (a) => fullName(empById(db, a.by)) || a.by }, { label: 'Type', csv: (a) => a.kind }, { label: 'Employee', csv: (a) => (a.empId ? fullName(empById(db, a.empId)) : '') }, { label: 'What changed', csv: (a) => a.field }, { label: 'From', csv: (a) => a.from }, { label: 'To', csv: (a) => a.to }], rows);
    }],
    ['Professional tax', 'PT deducted for each employee.', () => exportCSV(`pt-${ym}`, [...base, { label: 'Gross', csv: (x) => Math.round(x.gross) }, { label: 'PT', csv: ded('Professional') }], slips())],
    ['Labour welfare fund', 'LWF deducted this month.', () => exportCSV(`lwf-${ym}`, [...base, { label: 'Employee LWF', csv: ded('Labour') }, { label: 'Employer LWF', csv: (x) => Number(settingsFor(db, x.emp).lwfEmployer || 0) }], slips().filter((x) => ded('Labour')(x) > 0))],
    ['TDS summary', 'Income tax deducted, with PAN and tax regime.', () => exportCSV(`tds-${ym}`, [...base, { label: 'PAN', csv: (x) => x.emp.pan }, { label: 'Regime', csv: (x) => x.regime }, { label: 'TDS', csv: ded('Income') }], slips())],
    ['CTC report', 'Annual CTC, band and department of every employee.', () => exportCSV('ctc-report', [{ label: 'Employee', csv: (e) => fullName(e) }, { label: 'Emp no', csv: (e) => e.empNo }, { label: 'Department', csv: (e) => e.department }, { label: 'Band', csv: (e) => bandOf(db, e)?.name }, { label: 'Annual CTC', csv: (e) => e.ctc }], db.employees.filter((e) => e.status !== 'Exited'))],
    ['Variance report', 'Change in net pay against the month before.', variance],
    ['Loan outstanding', 'Active loans with EMI and tenure.', () => exportCSV('loans', [{ label: 'Employee', csv: (l) => fullName(empById(db, l.empId)) }, { label: 'Type', csv: (l) => l.type }, { label: 'Amount', csv: (l) => l.amount }, { label: 'EMI', csv: (l) => Math.round(loanEmi(l)) }, { label: 'Start', csv: (l) => l.startMonth }, { label: 'Status', csv: (l) => l.status }], db.loans)],
    ['Salaries on hold', 'Employees whose pay is held this month.', () => exportCSV(`holds-${ym}`, [...base, { label: 'Net pay held', csv: (x) => Math.round(x.net) }], slips().filter((x) => x.onHold))],
    ['Reimbursements paid', 'Claims and expenses paid through payroll.', () => exportCSV(`reimbursements-${ym}`, [{ label: 'Employee', csv: (a) => fullName(empById(db, a.empId)) }, { label: 'Type', csv: (a) => a.kind }, { label: 'Amount', csv: (a) => a.amount }, { label: 'Note', csv: (a) => a.note }], db.payrollAdjustments.filter((a) => a.month === ym && a.kind === 'Reimbursement'))],
  ];
  return (
    <div className="pr-stack">
      <div className="pr-section-head">
        <h2>Payroll reports</h2>
        <MonthSelect value={ym} onChange={setYm} months={months} />
      </div>
      <div className="pr-reports">
        {REPORTS.map(([name, about, download]) => (
          <section key={name} className="pr-panel pr-report">
            <h3>{name}</h3>
            <p className="pr-muted">{about}</p>
            <Btn kind="ghost" small icon="download" onClick={download}>
              Download
            </Btn>
          </section>
        ))}
      </div>
    </div>
  );
}
