// Income tax for the financial year, as payroll works it out: projected from pay so far, what has been
// deducted, and what will be deducted each month from now. Shown on My Finances and on the employee's profile.
import { Card, KV, Stat } from '../ui.jsx';
import { taxProjection, cycleMonthOf, cycleStartOf, todayISO, money, monthLabel } from '../utils.js';

export default function TaxStatement({ db, emp }) {
  const ym = cycleMonthOf(todayISO(), cycleStartOf(db));
  const t = taxProjection(db, emp, ym);
  if (!t.months.length) {
    return (
      <Card title="Income tax statement">
        <p className="muted">No pay falls in this financial year for this employee, so no tax is worked out.</p>
      </Card>
    );
  }
  return (
    <Card title={`Income tax statement — FY ${t.fy}-${String(t.fy + 1).slice(2)}`}>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Tax regime" value={t.regime} sub={t.declared ? 'From the declaration' : 'Default regime'} />
        <Stat label="Taxable income (year)" value={money(t.taxable)} />
        <Stat label="Tax for the year" value={money(t.annualTax)} tone="brand" sub={t.surcharge > 0 ? 'includes surcharge and cess' : 'includes 4% cess'} />
        <Stat label={`TDS this month (${monthLabel(ym)})`} value={money(Math.round(t.monthly))} tone="green" sub={t.monthsLeft > 1 ? `${t.monthsLeft} months left, including this one` : t.monthsLeft === 1 ? 'Last month: settles the year' : 'No months left'} />
      </div>
      <KV
        items={[
          ['Months of pay in the year', `${t.months.length} (${monthLabel(t.months[0])} to ${monthLabel(t.months[t.months.length - 1])})`],
          ['Pay counted for the year', money(t.grossYear)],
          ...(t.prevIncome || t.prevTds ? [['Previous employer: income / TDS', `${money(t.prevIncome)} / ${money(t.prevTds)}`]] : []),
          ['Tax deducted so far', money(t.paid)],
          ['Still to be deducted', money(t.remaining)],
        ]}
      />
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Worked out from the pay in locked months, this month’s pay and the usual pay for the months left. A bonus or arrears raises the year’s tax, and the extra is spread over the months that remain. Declarations are taken as given (no proofs), and house rent uses the metro-city rate.
      </p>
    </Card>
  );
}
