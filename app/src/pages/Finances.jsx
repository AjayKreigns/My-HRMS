import { useState } from 'react';
import { useDB, addItem, update, uid, notify } from '../store.js';
import { Card, Btn, Badge, DataTable, FormModal, PageHead, KV, Stat, Modal, Empty, toast } from '../ui.jsx';
import { go } from '../App.jsx';
import { money, monthLabel, payslipFor, salaryBreakup, incomeTax, declarationTotal, fullName, fmtDate, todayISO, ymOf, addMonths, empById } from '../utils.js';

const TABS = [
  ['summary', 'Summary'],
  ['pay', 'My Pay'],
  ['payslips', 'Payslips'],
  ['tax', 'Manage Tax'],
  ['loans', 'Loans & Advances'],
  ['claims', 'Reimbursement Claims'],
];

export const DECLARATION_FIELDS = [
  { key: 'regime', label: 'Tax regime for this year', type: 'radio', options: [{ value: 'New', label: 'New regime' }, { value: 'Old', label: 'Old regime' }], full: true, section: 'Regime' },
  { key: 'ppf', label: 'Public Provident Fund (PPF)', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'elss', label: 'ELSS mutual funds', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'lic', label: 'Life insurance premium', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'tuition', label: "Children's tuition fees", type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'homeLoanPrincipal', label: 'Home loan principal', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'nsc', label: 'NSC', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'fd5yr', label: '5-year tax saving FD', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'epfVoluntary', label: 'Voluntary PF', type: 'number', section: 'Section 80C (max ₹1,50,000)' },
  { key: 'mediclaimSelf', label: 'Medical insurance – self & family (80D)', type: 'number', section: 'Other deductions' },
  { key: 'mediclaimParents', label: 'Medical insurance – parents (80D)', type: 'number', section: 'Other deductions' },
  { key: 'nps', label: 'NPS – 80CCD(1B)', type: 'number', section: 'Other deductions' },
  { key: 'eduLoanInterest', label: 'Education loan interest (80E)', type: 'number', section: 'Other deductions' },
  { key: 'donations', label: 'Donations (80G)', type: 'number', section: 'Other deductions' },
  { key: 'homeLoanInterest', label: 'Home loan interest (Sec 24b)', type: 'number', section: 'Other deductions' },
  { key: 'rentMonthly', label: 'Monthly rent paid', type: 'number', section: 'House rent (HRA)' },
  { key: 'landlordName', label: 'Landlord name', section: 'House rent (HRA)' },
  { key: 'landlordPan', label: 'Landlord PAN (rent over ₹1 lakh/year)', section: 'House rent (HRA)' },
  { key: 'rentAddress', label: 'Rented property address', section: 'House rent (HRA)', full: true },
  { key: 'proof', label: 'Upload proofs', type: 'file', section: 'Proofs', full: true },
];

export function PayslipView({ slip, company }) {
  const e = slip.emp;
  return (
    <div className="payslip">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: 17 }}>{company.name}</h3>
          <p className="muted">{company.address}{company.city ? `, ${company.city}` : ''}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <strong>Payslip for {monthLabel(slip.ym)}</strong>
          <p className="muted">Generated {fmtDate(todayISO())}</p>
        </div>
      </div>
      <div style={{ height: 14 }} />
      <KV
        items={[
          ['Employee', fullName(e)],
          ['Employee number', e.empNo],
          ['Designation', e.designation],
          ['Department', e.department],
          ['Date of joining', fmtDate(e.dateOfJoining)],
          ['PAN', e.pan],
          ['UAN', e.uan],
          ['Bank account', `${e.bank?.bankName || ''} ${e.bank?.accountNumber ? '•••• ' + e.bank.accountNumber.slice(-4) : ''}`],
          ['Days in month', slip.dim],
          ['Paid days / LOP', `${slip.paidDays} / ${slip.lop}`],
        ]}
      />
      <div className="grid g2" style={{ marginTop: 18 }}>
        <div>
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Earnings</h4>
          <table>
            <tbody>
              {slip.earnings.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{money(v)}</td></tr>
              ))}
              <tr className="total-row"><td>Gross earnings</td><td>{money(slip.gross)}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Deductions</h4>
          <table>
            <tbody>
              {slip.deductions.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{money(v)}</td></tr>
              ))}
              <tr className="total-row"><td>Total deductions</td><td>{money(slip.totalDed)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="net-pay">
        <span>Net pay</span>
        <strong>{money(slip.net)}</strong>
      </div>
      <p className="muted" style={{ marginTop: 10, fontSize: 11.5 }}>Tax regime: {slip.regime}. This is a system-generated payslip and does not need a signature.</p>
    </div>
  );
}

export default function Finances({ user, tab }) {
  const db = useDB();
  const [slip, setSlip] = useState(null);
  const [decl, setDecl] = useState(false);
  const [loan, setLoan] = useState(false);
  const [claim, setClaim] = useState(false);
  const b = salaryBreakup(user.ctc, db.payrollSettings);
  const runs = db.payrollRuns.filter((r) => ['Finalized', 'Paid'].includes(r.status) && r.month >= user.dateOfJoining.slice(0, 7)).sort((a, z) => z.month.localeCompare(a.month));
  const latest = runs[0] && payslipFor(db, user, runs[0].month);
  const myDecl = db.taxDeclarations.find((d) => d.empId === user.id);
  const regime = myDecl?.regime || user.taxRegime || 'New';
  const annual = b.gross * 12;
  const taxNew = incomeTax(annual, 'New', myDecl);
  const taxOld = incomeTax(annual, 'Old', myDecl, b.earnings[0][1] * 12, b.earnings[1][1] * 12);
  const year = new Date().getFullYear();
  const fy = new Date().getMonth() >= 3 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
  const ytd = runs.filter((r) => r.month >= `${fy.slice(0, 4)}-04`).map((r) => payslipFor(db, user, r.month));

  return (
    <div>
      <PageHead title="My Finances" sub={`Financial year ${fy}`} />
      <div className="subnav">
        {TABS.map(([k, l]) => (
          <a key={k} href={`#/finances/${k}`} className={tab === k ? 'active' : ''}>{l}</a>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="stack">
          <div className="grid g4">
            <Stat label="Annual CTC" value={money(user.ctc)} tone="brand" />
            <Stat label="Monthly gross" value={money(b.gross)} />
            <Stat label="Last net pay" value={latest ? money(latest.net) : '—'} tone="green" sub={latest ? monthLabel(latest.ym) : 'No payroll yet'} />
            <Stat label="Tax regime" value={regime} sub={`Est. annual tax ${money(regime === 'Old' ? taxOld.tax : taxNew.tax)}`} />
          </div>
          <div className="grid g2">
            <Card title="Payment information">
              <KV items={[['Bank', user.bank?.bankName], ['Account number', user.bank?.accountNumber ? `•••• ${user.bank.accountNumber.slice(-4)}` : ''], ['IFSC', user.bank?.ifsc], ['Name on account', user.bank?.accountHolder], ['Salary payment mode', 'Bank transfer'], ['Pay day', db.payrollSettings.payDay]]} />
            </Card>
            <Card title="Identity & statutory">
              <KV items={[['PAN', user.pan], ['Aadhaar', user.aadhaar], ['UAN', user.uan], ['PF number', user.pfNumber], ['ESI number', user.esiNumber], ['PF enabled', db.payrollSettings.pfEnabled ? 'Yes' : 'No']]} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'pay' && (
        <div className="grid g2">
          <Card title="Current salary structure (monthly)">
            <ul className="list">
              {b.earnings.map(([k, v]) => (
                <li key={k}><span>{k}</span><strong>{money(v)}</strong></li>
              ))}
              <li><span><strong>Gross</strong></span><strong>{money(b.gross)}</strong></li>
              {b.employer.map(([k, v]) => (
                <li key={k}><span className="muted">{k} (employer contribution)</span><span>{money(v)}</span></li>
              ))}
              <li><span><strong>Cost to company (monthly)</strong></span><strong>{money(b.monthly)}</strong></li>
            </ul>
          </Card>
          <Card title={`Year to date (${fy})`}>
            {ytd.length === 0 ? (
              <Empty text="No payroll processed this year yet." />
            ) : (
              <KV items={[['Months paid', ytd.length], ['Gross earnings', money(ytd.reduce((s, x) => s + x.gross, 0))], ['Total deductions', money(ytd.reduce((s, x) => s + x.totalDed, 0))], ['Net paid', money(ytd.reduce((s, x) => s + x.net, 0))], ['Tax deducted', money(ytd.reduce((s, x) => s + (x.deductions.find((d) => d[0].startsWith('Income Tax'))?.[1] || 0), 0))], ['PF contributed', money(ytd.reduce((s, x) => s + (x.deductions.find((d) => d[0].startsWith('Provident'))?.[1] || 0), 0))]]} />
            )}
          </Card>
          <Card title="Salary revision history" className="span2">
            <DataTable
              rows={[{ id: 'cur', effectiveFrom: user.dateOfJoining, ctc: user.ctc, note: 'Current' }, ...db.promotions.filter((p) => p.empId === user.id && p.status === 'Approved').map((p) => ({ id: p.id, effectiveFrom: p.effectiveFrom, ctc: p.newCtc, note: `Promotion to ${p.newDesignation}` }))]}
              columns={[{ key: 'effectiveFrom', label: 'Effective from', render: (r) => fmtDate(r.effectiveFrom) }, { key: 'ctc', label: 'Annual CTC', render: (r) => money(r.ctc) }, { key: 'note', label: 'Note' }]}
            />
          </Card>
        </div>
      )}

      {tab === 'payslips' && (
        <Card pad={false} title="Payslips">
          <DataTable
            rows={runs.map((r) => payslipFor(db, user, r.month))}
            rowKey={(s) => s.ym}
            empty="No payslips yet."
            onRowClick={setSlip}
            columns={[
              { key: 'ym', label: 'Month', render: (s) => monthLabel(s.ym) },
              { key: 'paidDays', label: 'Paid days' },
              { key: 'gross', label: 'Gross', render: (s) => money(s.gross) },
              { key: 'totalDed', label: 'Deductions', render: (s) => money(s.totalDed) },
              { key: 'net', label: 'Net pay', render: (s) => <strong>{money(s.net)}</strong> },
              { key: 'act', label: '', sortable: false, render: () => <Btn kind="ghost" small>View</Btn> },
            ]}
          />
        </Card>
      )}

      {tab === 'tax' && (
        <div className="stack">
          <div className="grid g3">
            <Stat label="Estimated taxable income" value={money(regime === 'Old' ? taxOld.taxable : taxNew.taxable)} />
            <Stat label="Tax – new regime" value={money(taxNew.tax)} tone={regime === 'New' ? 'brand' : undefined} sub={regime === 'New' ? 'Selected' : ''} />
            <Stat label="Tax – old regime" value={money(taxOld.tax)} tone={regime === 'Old' ? 'brand' : undefined} sub={regime === 'Old' ? 'Selected' : ''} />
          </div>
          <Card
            title="Investment declaration"
            actions={
              <>
                {myDecl && <Badge>{myDecl.status}</Badge>}
                <Btn icon="edit" onClick={() => setDecl(true)}>{myDecl ? 'Update declaration' : 'Declare investments'}</Btn>
              </>
            }
          >
            {myDecl ? (
              <KV items={[['Regime', myDecl.regime], ['80C total (capped)', money(declarationTotal(myDecl).c80)], ['80D total', money(declarationTotal(myDecl).d80)], ['Other deductions', money(declarationTotal(myDecl).other)], ['Annual rent', money(declarationTotal(myDecl).hraRent)], ['Submitted on', fmtDate(myDecl.submittedOn)]]} />
            ) : (
              <p className="muted">You haven't declared investments for {fy}. Without a declaration tax is deducted under the {regime.toLowerCase()} regime with no deductions.</p>
            )}
          </Card>
          <Card pad={false} title="Tax forms">
            <DataTable
              rows={[{ id: 'f16', name: `Form 16 — FY ${Number(fy.slice(0, 4)) - 1}-${fy.slice(2, 4)}`, note: 'Issued by the payroll team after year end' }, { id: 'f12bb', name: `Form 12BB — FY ${fy}`, note: 'Created from your investment declaration' }]}
              columns={[{ key: 'name', label: 'Document' }, { key: 'note', label: 'Notes' }, { key: 'act', label: '', sortable: false, render: (r) => <Btn kind="ghost" small icon="print" onClick={() => (r.id === 'f12bb' ? (myDecl ? window.print() : toast('Declare your investments first.', 'error')) : go('me/helpdesk'))}>{r.id === 'f12bb' ? 'Print' : 'Request'}</Btn> }]}
            />
          </Card>
        </div>
      )}

      {tab === 'loans' && (
        <Card pad={false} title="Loans & salary advances" actions={<Btn icon="plus" onClick={() => setLoan(true)}>Apply for loan</Btn>}>
          <DataTable
            rows={db.loans.filter((l) => l.empId === user.id)}
            empty="No loans."
            columns={[
              { key: 'type', label: 'Type' },
              { key: 'amount', label: 'Amount', render: (l) => money(l.amount) },
              { key: 'tenureMonths', label: 'Tenure', render: (l) => `${l.tenureMonths} months` },
              { key: 'emi', label: 'EMI', sortable: false, render: (l) => money(l.amount / l.tenureMonths) },
              { key: 'startMonth', label: 'Deduction from', render: (l) => (l.startMonth ? monthLabel(l.startMonth) : '—') },
              { key: 'status', label: 'Status', render: (l) => <Badge>{l.status}</Badge> },
            ]}
          />
        </Card>
      )}

      {tab === 'claims' && (
        <Card pad={false} title="Reimbursement claims" actions={<Btn icon="plus" onClick={() => setClaim(true)}>New claim</Btn>}>
          <DataTable
            rows={db.claims.filter((c) => c.empId === user.id)}
            empty="No claims."
            columns={[
              { key: 'component', label: 'Component' },
              { key: 'month', label: 'For month', render: (c) => monthLabel(c.month) },
              { key: 'amount', label: 'Amount', render: (c) => money(c.amount) },
              { key: 'billName', label: 'Bills' },
              { key: 'status', label: 'Status', render: (c) => <Badge>{c.status}</Badge> },
            ]}
          />
        </Card>
      )}

      {slip && (
        <Modal title={`Payslip — ${monthLabel(slip.ym)}`} onClose={() => setSlip(null)} wide footer={<Btn icon="print" onClick={() => window.print()}>Print / save as PDF</Btn>}>
          <PayslipView slip={slip} company={db.company} />
        </Modal>
      )}
      {decl && (
        <FormModal
          wide
          title={`Investment declaration ${fy}`}
          fields={DECLARATION_FIELDS}
          initial={{ regime, ...(myDecl?.items || {}) }}
          submitLabel="Submit declaration"
          onClose={() => setDecl(false)}
          onSave={(v) => {
            const { regime: r, ...items } = v;
            update((d) => {
              const x = d.taxDeclarations.find((t) => t.empId === user.id);
              if (x) Object.assign(x, { regime: r, items, status: 'Submitted', submittedOn: todayISO() });
              else d.taxDeclarations.push({ id: uid('td'), empId: user.id, fy, regime: r, items, status: 'Submitted', submittedOn: todayISO() });
              d.employees.find((e) => e.id === user.id).taxRegime = r;
            });
            setDecl(false);
            toast('Declaration submitted');
          }}
        />
      )}
      {loan && (
        <FormModal
          title="Apply for loan / salary advance"
          fields={[
            { key: 'type', label: 'Type', type: 'select', options: ['Salary Advance', 'Personal Loan', 'Vehicle Loan', 'Emergency Loan'], required: true },
            { key: 'amount', label: 'Amount (INR)', type: 'number', required: true, min: 1000 },
            { key: 'tenureMonths', label: 'Repay over (months)', type: 'number', required: true, min: 1, max: 36, default: 6 },
            { key: 'startMonth', label: 'Start deduction from', type: 'month', required: true, default: addMonths(ymOf(), 1) },
            { key: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
          ]}
          validate={(v) => (Number(v.amount) > user.ctc / 4 ? 'The amount cannot exceed three months of salary.' : '')}
          onClose={() => setLoan(false)}
          onSave={(v) => {
            addItem('loans', { ...v, empId: user.id, interestRate: 0, status: 'Pending', appliedOn: todayISO() });
            if (user.reportingTo) notify(user.reportingTo, `${fullName(user)} applied for a ${v.type}.`, 'inbox');
            setLoan(false);
            toast('Loan application submitted');
          }}
        />
      )}
      {claim && (
        <FormModal
          title="New reimbursement claim"
          fields={[
            { key: 'component', label: 'Component', type: 'select', options: ['Fuel Reimbursement', 'Telephone & Internet', 'Leave Travel Allowance', 'Books & Periodicals', 'Medical Reimbursement'], required: true },
            { key: 'month', label: 'For month', type: 'month', required: true, default: ymOf() },
            { key: 'amount', label: 'Amount (INR)', type: 'number', required: true },
            { key: 'billName', label: 'Upload bills', type: 'file' },
          ]}
          onClose={() => setClaim(false)}
          onSave={(v) => {
            addItem('claims', { ...v, empId: user.id, status: 'Pending' });
            const approver = empById(db, user.reportingTo);
            if (approver) notify(approver.id, `${fullName(user)} submitted a ${v.component} claim.`, 'inbox');
            setClaim(false);
            toast('Claim submitted');
          }}
        />
      )}
    </div>
  );
}
