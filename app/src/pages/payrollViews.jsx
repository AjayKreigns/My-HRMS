// Pieces of the Run Payroll and Payroll Analytics screens. They only draw what they are given;
// the numbers and the actions come from Payroll.jsx. Styles are in payrollx.css.
import { Icon } from '../ui.jsx';
import { inNumber } from '../utils.js';

const inr = (n) => `₹${inNumber(Math.round(Number(n) || 0))}`;
// Big amounts the way people say them in India.
export function lakh(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${+(v / 1e7).toFixed(2)} crore`;
  if (a >= 1e5) return `₹${+(v / 1e5).toFixed(2)} lakh`;
  return inr(v);
}

// The twelve months of the financial year as a thin rail; the open month names its cycle and state.
export function MonthRail({ months, ym, stateOf, short, hint, onPick, onPrev, onNext }) {
  const word = { completed: 'Locked', current: 'Current', upcoming: 'Upcoming', pending: 'Not run' };
  return (
    <nav className="px-rail" aria-label="Payroll months">
      <button className="px-rail-nav" onClick={onPrev} aria-label="Previous financial year">
        <Icon name="chevronLeft" size={16} />
      </button>
      <ol>
        {months.map((m) => {
          const st = stateOf(m);
          return (
            <li key={m}>
              <button className={`px-tick ${st} ${m === ym ? 'on' : ''}`} onClick={() => onPick(m)} aria-current={m === ym ? 'true' : undefined} title={hint(m)}>
                <span className="px-tick-m">{short(m)}</span>
                <span className="px-tick-bar" />
                <span className="px-tick-s">{word[st]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <button className="px-rail-nav" onClick={onNext} aria-label="Next financial year">
        <Icon name="chevronRight" size={16} />
      </button>
    </nav>
  );
}

// Five gates a month passes through. The shape of each marker says its state as well as the colour.
//   cleared: done · active: next to do · waiting: someone else has to act · blocked: something is in the way
//   open: not required but not finished · idle: not reached yet
export function GateLine({ gates }) {
  return (
    <ol className="px-gates">
      {gates.map((g) => (
        <li key={g.key} className="px-gate" data-state={g.state}>
          <span className="px-node" aria-hidden="true">
            {g.state === 'cleared' && <Icon name="check" size={14} />}
            {g.state === 'blocked' && <Icon name="alert" size={13} />}
            {g.state === 'waiting' && <Icon name="refresh" size={12} />}
          </span>
          <span className="px-gate-name">{g.label}</span>
          <span className="px-gate-note">{g.note}</span>
        </li>
      ))}
    </ol>
  );
}

// "+₹12,000 on October" in words, so the sign never has to be guessed from a colour.
function DeltaText({ value, against, quiet }) {
  const v = Math.round(Number(value) || 0);
  if (v === 0) return quiet ? null : <small className="px-delta">Same as {against}</small>;
  return <small className={`px-delta ${v > 0 ? 'up' : 'down'}`}>{`${v > 0 ? '+' : '−'}${inr(Math.abs(v))} on ${against}`}</small>;
}

// Total cost as a till tape: the parts, dotted leaders, a double rule, the sum.
export function CostTape({ parts, total, against, children }) {
  return (
    <section className="px-tape" aria-label="Payroll cost">
      <h3>What this month costs</h3>
      {parts.map((p) => (
        <div key={p.label}>
          <div className="px-line">
            <span>{p.label}</span>
            <i className="px-dots" />
            <span className="px-fig">{inr(p.value)}</span>
          </div>
          <DeltaText value={p.delta} against={against} quiet />
        </div>
      ))}
      <div className="px-total">
        <div className="px-line">
          <span>Total cost</span>
          <i className="px-dots" />
          <span className="px-fig">{inr(total.value)}</span>
        </div>
        <DeltaText value={total.delta} against={against} />
      </div>
      {children}
    </section>
  );
}

// Where one rupee of last month's cost went.
export function SplitBar({ parts }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <div>
      <div className="px-split" role="img" aria-label={parts.map((p) => `${p.label} ${inr(p.value)}`).join(', ')}>
        {parts.map((p) => (
          <i key={p.label} style={{ flexBasis: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${inr(p.value)}`} />
        ))}
      </div>
      <div className="px-split-key" style={{ marginTop: 14 }}>
        {parts.map((p) => (
          <div key={p.label}>
            <span className="px-fig">{lakh(p.value)}</span>
            <span style={{ '--sw': p.color }}>{`${p.label}, ${Math.round((p.value / total) * 100)}%`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Departments or locations ranked by what they cost.
export function ShareTable({ rows, noun }) {
  const total = rows.reduce((t, r) => t + r.value, 0);
  const top = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="px-empty">No one is on payroll yet.</p>;
  return (
    <div>
      <div className="px-share-row head" aria-hidden="true">
        <span>{noun}</span>
        <span>Share of annual CTC</span>
        <span className="num opt">People</span>
        <span className="num">Annual CTC</span>
        <span className="num opt">Average</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.label} className={`px-share-row ${i === 0 ? 'top' : ''}`}>
          <span className="px-share-name">{r.label}</span>
          <span className="px-share-bar" role="img" aria-label={`${Math.round((r.value / (total || 1)) * 100)}% of the total`}>
            <i style={{ width: `${(r.value / top) * 100}%` }} />
          </span>
          <span className="num opt">{r.count}</span>
          <span className="num px-fig">
            {lakh(r.value)}
            <small>{`${Math.round((r.value / (total || 1)) * 100)}%`}</small>
          </span>
          <span className="num px-fig opt">{lakh(r.count ? r.value / r.count : 0)}</span>
        </div>
      ))}
      <div className="px-share-sum">
        <span>
          Total <b className="px-fig">{lakh(total)}</b>
        </span>
        <span>
          Highest <b>{rows[0].label}</b>
        </span>
        <span>
          Lowest <b>{rows[rows.length - 1].label}</b>
        </span>
      </div>
    </div>
  );
}

// Plan against actual, one row a month: a ring for the plan, a dot for what was paid, a line between.
export function VarianceRows({ rows, label }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual]));
  const pct = (v) => `${(v / max) * 100}%`;
  return (
    <div>
      {rows.map((r) => {
        const run = r.actual > 0;
        const diff = r.actual - r.planned;
        const lo = Math.min(r.planned, r.actual);
        return (
          <div key={r.ym} className="px-var-row">
            <b>{label(r.ym)}</b>
            <span className="px-var-track">
              {run && <i className={`px-var-link ${diff > 0 ? 'over' : ''}`} style={{ left: pct(lo), width: `${(Math.abs(diff) / max) * 100}%` }} />}
              <i className="px-var-plan" style={{ left: pct(r.planned) }} title={`Planned ${inr(r.planned)}`} />
              {run && <i className="px-var-act" style={{ left: pct(r.actual) }} title={`Paid ${inr(r.actual)}`} />}
            </span>
            <span className={`state ${!run ? '' : diff > 0 ? 'over' : 'under'}`}>
              {!run ? 'Not processed' : diff === 0 ? 'On plan' : `${inr(Math.abs(diff))} ${diff > 0 ? 'over plan' : 'under plan'}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
