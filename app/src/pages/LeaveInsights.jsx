// The employee's leave overview: a balance wheel, a month-by-month rhythm chart, one capsule per
// leave type, a year-at-a-glance heat map, the weekdays leave falls on and what is coming up.
// Everything is drawn from the employee's own leave requests and balances; nothing is stored.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Icon } from '../ui.jsx';
import { addDays, parseISO, todayISO, fmtDate, hm, minutesBetween, isHoliday, isWeeklyOff, leavePart, cycleLabel, cycleStartOf, empById } from '../utils.js';
import { isHours } from '../leave.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const reduced = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const r1 = (n) => Math.round(n * 10) / 10;
const shortDate = (d) => parseISO(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const weekdayOf = (d) => (parseISO(d).getDay() + 6) % 7; // 0 = Monday

// ---------- motion helpers ----------
// True one moment after the first paint, so bars and rings can grow from nothing.
function useReady() {
  const [ready, setReady] = useState(reduced());
  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, [ready]);
  return ready;
}
// A number that counts up to its value, and from its current value to a new one (quicker).
function useCountUp(target, ms = 1000) {
  const [v, setV] = useState(reduced() ? target : 0);
  const cur = useRef(reduced() ? target : 0);
  const first = useRef(true);
  useEffect(() => {
    if (reduced() || !Number.isFinite(target)) {
      cur.current = target;
      setV(target);
      return undefined;
    }
    const from = cur.current;
    const dur = first.current ? ms : 350;
    first.current = false;
    let raf;
    let t0;
    const step = (t) => {
      if (t0 === undefined) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      cur.current = from + (target - from) * (1 - (1 - p) ** 3);
      setV(cur.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function Count({ value, className, style }) {
  const v = useCountUp(value);
  if (!Number.isFinite(value)) return <span className={className} style={style}>∞</span>;
  return <span className={className} style={style}>{Number.isInteger(value) ? Math.round(v) : r1(v).toFixed(1)}</span>;
}

// ---------- data ----------
// Every date of the year the employee has leave on: { typeId, part (1 or 0.5), pending, partial }.
function leaveDays(db, empId, year) {
  const emp = empById(db, empId);
  const map = new Map();
  db.leaveRequests
    .filter((r) => r.empId === empId && ['Approved', 'Pending'].includes(r.status) && !r.optionalHoliday && Number(r.days) > 0)
    .forEach((r) => {
      const pending = r.status === 'Pending';
      if (r.partial) {
        if (r.from.startsWith(String(year))) map.set(`${r.from}#${r.id}`, { date: r.from, typeId: r.typeId, part: Number(r.days) || 0, pending, partial: true });
        return;
      }
      for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
        if (!d.startsWith(String(year))) continue;
        const counted = (!isWeeklyOff(emp, d) && !isHoliday(db, d)) || (r.sandwichDates || []).includes(d);
        if (counted) map.set(`${d}#${r.id}`, { date: d, typeId: r.typeId, part: leavePart(r, d) || 1, pending, partial: false });
      }
    });
  return [...map.values()];
}

// ---------- 1. balance wheel ----------
function Wheel({ items }) {
  const ready = useReady();
  const [focus, setFocus] = useState(null);
  const total = items.reduce((s, b) => s + Math.max(0, b.available), 0);
  const f = items.find((b) => b.type.id === focus);
  const size = 232;
  const mid = size / 2;
  // The rings get thinner as more leave types are added, so the middle always has room for the text.
  const outer = mid - 8;
  const step = Math.min(17, (outer - 50) / Math.max(1, items.length));
  const stroke = Math.max(5, step - 4);
  const gap = step - stroke;
  const innerD = Math.max(60, 2 * (outer - Math.max(0, items.length - 1) * step - stroke / 2));
  const shown = f ? r1(f.available) : r1(total);
  const numSize = Math.min(34, innerD * (String(shown).length >= 4 ? 0.24 : 0.3));
  const inset = `${((size - innerD) / 2 / size) * 100}%`;
  return (
    <div className="lv-wheel">
      <div className="lv-wheel-art">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Leave left: ${r1(total)} days across ${items.length} leave types`}>
          {items.map((b, i) => {
            const r = outer - i * (stroke + gap);
            if (r < stroke) return null;
            const C = 2 * Math.PI * r;
            const share = b.quota > 0 ? Math.max(0, Math.min(1, b.available / b.quota)) : 0;
            const used = b.quota > 0 ? Math.max(0, Math.min(1, (b.taken + b.pending) / b.quota)) : 0;
            const dim = focus && focus !== b.type.id;
            return (
              <g key={b.type.id} className={`lv-ring ${dim ? 'dim' : ''}`} tabIndex={0} onMouseEnter={() => setFocus(b.type.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(b.type.id)} onBlur={() => setFocus(null)} aria-label={`${b.type.name}: ${r1(b.available)} of ${r1(b.quota)} days left`}>
                <circle cx={mid} cy={mid} r={r} fill="none" stroke={b.type.color} strokeOpacity="0.14" strokeWidth={stroke} />
                {used > 0 && (
                  <circle cx={mid} cy={mid} r={r} fill="none" stroke={b.type.color} strokeOpacity="0.3" strokeWidth={stroke} strokeDasharray={`2 ${(C * 0.012).toFixed(1)}`} transform={`rotate(${-90 + share * 360} ${mid} ${mid})`} style={{ strokeDasharray: `${ready ? C * used : 0} ${C}`, transition: `stroke-dasharray 1.1s cubic-bezier(.22,1,.36,1) ${i * 110 + 250}ms` }} />
                )}
                <circle
                  cx={mid}
                  cy={mid}
                  r={r}
                  fill="none"
                  stroke={b.type.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${mid} ${mid})`}
                  style={{ strokeDasharray: `${ready ? Math.max(share * C - (share > 0 && share < 1 ? 1 : 0), 0) : 0} ${C}`, transition: `stroke-dasharray 1.1s cubic-bezier(.22,1,.36,1) ${i * 110}ms`, opacity: share > 0 ? 1 : 0 }}
                />
              </g>
            );
          })}
        </svg>
        <div className="lv-wheel-core" aria-live="polite" style={{ inset }}>
          <Count value={shown} className="lv-wheel-num" style={{ fontSize: numSize }} />
          <span className="lv-wheel-cap" style={{ fontSize: innerD < 100 ? 11 : 12.5 }}>{f ? `${f.type.name} left` : 'days left'}</span>
          {innerD >= 96 && <small>{f ? `of ${r1(f.quota)} credited` : `${items.length} type${items.length === 1 ? '' : 's'}`}</small>}
        </div>
      </div>
      <ul className="lv-legend">
        {items.map((b, i) => (
          <li key={b.type.id} className={focus === b.type.id ? 'on' : ''} style={{ '--i': i }} onMouseEnter={() => setFocus(b.type.id)} onMouseLeave={() => setFocus(null)}>
            <i style={{ background: b.type.color }} />
            <span className="lv-legend-name">{b.type.name}</span>
            <b>
              {r1(b.available)}
              <small> / {r1(b.quota)}</small>
            </b>
          </li>
        ))}
        {items.length === 0 && <li className="muted">No leave balance has been credited yet.</li>}
      </ul>
    </div>
  );
}

// ---------- 2. monthly rhythm ----------
function Rhythm({ days, types, year }) {
  const ready = useReady();
  const [hover, setHover] = useState(null);
  const now = new Date();
  const thisMonth = now.getFullYear() === year ? now.getMonth() : -1;
  const per = useMemo(() => {
    const m = MONTHS.map(() => ({}));
    days.forEach((d) => {
      const i = Number(d.date.slice(5, 7)) - 1;
      const k = d.pending ? `${d.typeId}:p` : d.typeId;
      m[i][k] = (m[i][k] || 0) + d.part;
    });
    return m;
  }, [days]);
  const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
  const max = Math.max(4, Math.ceil(Math.max(...per.map(sum))));
  const usedTypes = types.filter((t) => days.some((d) => d.typeId === t.id));
  const yearTotal = r1(days.reduce((s, d) => s + d.part, 0));
  const readout = hover === null ? null : per[hover];
  return (
    <div className="lv-rhythm">
      <div className="lv-readout" aria-live="polite">
        {readout === null ? (
          <>
            <strong><Count value={yearTotal} /> day{yearTotal === 1 ? '' : 's'}</strong> of leave in {year}
            {yearTotal === 0 && <span className="muted"> · nothing taken yet</span>}
          </>
        ) : (
          <>
            <strong>{MONTHS[hover]} {year}</strong>
            {sum(readout) === 0 ? ' · no leave' : ` · ${r1(sum(readout))} day(s): ${Object.entries(readout).map(([k, v]) => `${types.find((t) => t.id === k.replace(':p', ''))?.code || '?'} ${r1(v)}${k.endsWith(':p') ? ' (pending)' : ''}`).join(', ')}`}
          </>
        )}
      </div>
      <div className="lv-bars" style={{ '--max': max }}>
        <div className="lv-bars-grid" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25, 0].map((p) => (
            <span key={p}><em>{p === 0 ? '' : r1(max * p)}</em></span>
          ))}
        </div>
        {per.map((o, i) => (
          <div key={MONTHS[i]} className={`lv-bar ${i === thisMonth ? 'now' : ''} ${hover === i ? 'hov' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${MONTHS[i]}: ${r1(sum(o))} days of leave`}>
            <div className="lv-bar-stack">
              {Object.entries(o).map(([k, v], j) => {
                const t = types.find((x) => x.id === k.replace(':p', ''));
                const pend = k.endsWith(':p');
                return <span key={k} className={`lv-seg ${pend ? 'pend' : ''}`} style={{ height: ready ? `${(v / max) * 100}%` : '0%', background: t?.color || '#64748b', transitionDelay: `${i * 45 + j * 60}ms` }} />;
              })}
            </div>
            <label>{MONTHS[i]}</label>
          </div>
        ))}
      </div>
      {usedTypes.length > 0 && (
        <div className="lv-chips">
          {usedTypes.map((t) => (
            <span key={t.id}><i style={{ background: t.color }} />{t.name}</span>
          ))}
          {days.some((d) => d.pending) && <span><i className="hatch" />Pending approval</span>}
        </div>
      )}
    </div>
  );
}

// ---------- 3. one capsule per leave type ----------
function Capsule({ b, i, sd }) {
  const ready = useReady();
  const t = b.type;
  const unlimited = t.unlimited;
  const hours = b.unit === 'Hours';
  const n = hours ? Math.max(1, Math.min(12, b.quota || b.taken + b.pending || 1)) : Math.max(1, Math.min(24, Math.round(b.quota) || 1));
  let usedSeg;
  let pendSeg;
  if (hours) {
    usedSeg = Math.min(n, b.taken);
    pendSeg = Math.min(n - usedSeg, b.pending);
  } else if (b.quota > 0) {
    usedSeg = Math.min(n, Math.round((b.taken / b.quota) * n));
    pendSeg = Math.min(n - usedSeg, Math.round((b.pending / b.quota) * n));
  } else {
    usedSeg = 0;
    pendSeg = 0;
  }
  const availSeg = Math.max(0, n - usedSeg - pendSeg);
  const kind = (k) => (k < usedSeg ? 'used' : k < usedSeg + pendSeg ? 'pend' : 'avail');
  const big = unlimited || (hours && b.available === Infinity) ? Infinity : r1(b.available);
  return (
    <article className="lv-cap" style={{ '--c': t.color, '--i': i }}>
      <header>
        <span className="lv-cap-dot" />
        <h4>{t.name}</h4>
        <Badge tone={t.paid === 'Unpaid' ? 'red' : 'green'}>{hours ? 'In hours' : t.paid}</Badge>
      </header>
      <div className="lv-cap-main">
        <Count value={big} className="lv-cap-num" />
        <span>{unlimited ? 'no limit' : hours ? 'times left this cycle' : 'days left'}</span>
      </div>
      {unlimited ? (
        <div className="lv-infinity" aria-hidden="true"><span /></div>
      ) : (
        <div className={`lv-pips ${hours ? 'hours' : ''}`} role="img" aria-label={`${availSeg} of ${n} left`}>
          {Array.from({ length: n }, (_, k) => (
            <span key={k} className={kind(k)} style={{ transitionDelay: `${i * 70 + k * 28}ms`, transform: ready ? 'scaleY(1)' : 'scaleY(0.15)', opacity: ready ? 1 : 0 }} />
          ))}
        </div>
      )}
      <footer>
        {unlimited ? (
          <span>{b.taken} day(s) taken this year</span>
        ) : hours ? (
          <>
            <span>Used {b.taken + b.pending}{b.quota ? ` of ${b.quota}` : ''}</span>
            <span>{hm(Math.round(b.hoursUsed * 60))} this cycle</span>
            <span className="muted">{cycleLabel(b.ym, sd)}</span>
          </>
        ) : !b.eligible ? (
          <span>Available from {fmtDate(b.eligibleDate)}</span>
        ) : (
          <>
            <span><i className="k used" />Used {r1(b.taken)}</span>
            {b.pending > 0 && <span><i className="k pend" />Pending {r1(b.pending)}</span>}
            <span>{b.manual ? 'Granted' : 'Credited'} {r1(b.quota)}</span>
            {b.carry > 0 && <span>Carried {r1(b.carry)}</span>}
            {b.nextCredit && (
              <span className="lv-next"><Icon name="calendar" size={13} />+{r1(b.perCredit)} on {shortDate(b.nextCredit)}</span>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

// ---------- 4. the year at a glance ----------
function YearMap({ db, emp, days, types, year }) {
  const today = todayISO();
  const first = `${year}-01-01`;
  const lead = weekdayOf(first);
  const total = (new Date(year, 11, 31) - new Date(year, 0, 1)) / 86400000 + 1;
  const cols = Math.ceil((lead + total) / 7);
  const byDate = new Map();
  days.forEach((d) => byDate.set(d.date, [...(byDate.get(d.date) || []), d]));
  const cells = [];
  for (let k = 0; k < lead; k += 1) cells.push({ blank: true, key: `b${k}` });
  for (let k = 0; k < total; k += 1) {
    const date = addDays(first, k);
    const lv = byDate.get(date);
    const hol = isHoliday(db, date);
    const off = isWeeklyOff(emp, date);
    let cls = 'work';
    let label = fmtDate(date);
    let style;
    if (lv) {
      const d = lv[0];
      const t = types.find((x) => x.id === d.typeId);
      cls = `leave${d.pending ? ' pend' : ''}${d.part < 1 ? ' half' : ''}`;
      style = { '--c': t?.color || '#64748b' };
      label += ` · ${t?.name || 'Leave'}${d.part < 1 ? ' (part of a day)' : ''}${d.pending ? ' · pending approval' : ''}`;
    } else if (hol) {
      cls = 'hol';
      label += ` · ${hol.name}`;
    } else if (off) {
      cls = 'off';
      label += ' · weekly off';
    } else if (date > today) cls = 'future';
    if (date === today) cls += ' today';
    cells.push({ key: date, cls, label, style, col: Math.floor((lead + k) / 7), date });
  }
  const monthAt = MONTHS.map((m, i) => ({ m, col: Math.floor((lead + (new Date(year, i, 1) - new Date(year, 0, 1)) / 86400000) / 7) }));
  return (
    <div className="lv-year">
      <div className="lv-year-scroll">
        <div className="lv-year-inner">
          <div className="lv-year-months" style={{ '--cols': cols }}>
            {monthAt.map((x) => (
              <span key={x.m} style={{ gridColumn: x.col + 1 }}>{x.m}</span>
            ))}
          </div>
          <div className="lv-year-body">
            <div className="lv-year-days" aria-hidden="true">
              {WEEKDAYS.map((d, i) => (
                <span key={d}>{i % 2 === 0 ? d : ''}</span>
              ))}
            </div>
            <div className="lv-year-grid" style={{ '--cols': cols }}>
              {cells.map((c, idx) => (c.blank ? <i key={c.key} className="blank" /> : <i key={c.key} className={c.cls} style={{ ...c.style, animationDelay: `${Math.min(900, c.col * 14 + (idx % 7) * 6)}ms` }} title={c.label} />))}
            </div>
          </div>
        </div>
      </div>
      <div className="lv-chips">
        <span><i className="k worked" />Working day</span>
        {types.filter((t) => days.some((d) => d.typeId === t.id)).map((t) => (
          <span key={t.id}><i style={{ background: t.color }} />{t.name}</span>
        ))}
        <span><i className="k pend" />Pending</span>
        <span><i className="k hol" />Holiday</span>
        <span><i className="k off" />Weekly off</span>
        <span><i className="k today" />Today</span>
      </div>
    </div>
  );
}

// ---------- 5. which weekdays ----------
function WeekdayBubbles({ days }) {
  const ready = useReady();
  const counts = WEEKDAYS.map(() => 0);
  days.filter((d) => !d.pending).forEach((d) => {
    counts[weekdayOf(d.date)] += d.part;
  });
  const max = Math.max(...counts);
  const topIdx = max > 0 ? counts.indexOf(max) : -1;
  return (
    <div className="lv-week">
      <div className="lv-bubbles">
        {counts.map((c, i) => {
          const size = 30 + (max ? (c / max) * 38 : 0);
          return (
            <div key={WEEKDAYS[i]} className={`lv-bubble-col ${c === max && max > 0 ? 'top' : ''}`}>
              <div className="lv-bubble-slot">
                <span className="lv-bubble" style={{ width: size, height: size, transform: ready ? 'scale(1)' : 'scale(0)', transitionDelay: `${i * 70}ms` }} title={`${WEEKDAYS[i]}: ${r1(c)} day(s)`}>
                  {c > 0 ? r1(c) : ''}
                </span>
              </div>
              <label>{WEEKDAYS[i]}</label>
            </div>
          );
        })}
      </div>
      <p className="muted lv-week-note">{max > 0 ? `Most of your approved leave falls on ${WEEKDAY_NAMES[topIdx]}${topIdx === 0 || topIdx === 4 ? ', next to the weekend' : ''}.` : 'Your leave pattern appears here once you take leave.'}</p>
    </div>
  );
}

// ---------- 6. coming up ----------
function ComingUp({ db, emp, bal }) {
  const today = todayISO();
  const next = db.leaveRequests
    .filter((r) => r.empId === emp.id && ['Approved', 'Pending'].includes(r.status) && r.to >= today && !r.optionalHoliday)
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  const hol = db.holidays.filter((h) => h.date >= today && h.type !== 'Optional').sort((a, b) => a.date.localeCompare(b.date))[0];
  const credit = bal.filter((b) => b.nextCredit).sort((a, b) => a.nextCredit.localeCompare(b.nextCredit))[0];
  const sameDay = credit ? bal.filter((b) => b.nextCredit === credit.nextCredit) : [];
  const pending = db.leaveRequests.filter((r) => r.empId === emp.id && r.status === 'Pending').length;
  const inDays = (d) => {
    const n = Math.round((parseISO(d) - parseISO(today)) / 86400000);
    return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  };
  const typeName = (id) => db.leaveTypes.find((t) => t.id === id)?.name || 'Leave';
  const rows = [
    next && { icon: 'calendar', tone: next.status === 'Pending' ? 'amber' : 'green', title: `${typeName(next.typeId)} · ${next.partial ? `${hm(minutesBetween(next.fromTime, next.toTime))} on ${shortDate(next.from)}` : next.from === next.to ? shortDate(next.from) : `${shortDate(next.from)} to ${shortDate(next.to)}`}`, sub: `${next.status === 'Pending' ? 'Waiting for approval' : 'Approved'} · ${inDays(next.from > today ? next.from : today)}` },
    hol && { icon: 'award', tone: 'blue', title: hol.name, sub: `${fmtDate(hol.date)} · ${inDays(hol.date)}` },
    credit && { icon: 'plus', tone: 'green', title: `+${r1(sameDay.reduce((s, b) => s + b.perCredit, 0))} day${sameDay.reduce((s, b) => s + b.perCredit, 0) === 1 ? '' : 's'} credited`, sub: `${sameDay.map((b) => b.type.code).join(', ')} · ${fmtDate(credit.nextCredit)} · ${inDays(credit.nextCredit)}` },
    pending > 0 && { icon: 'clock', tone: 'amber', title: `${pending} request${pending === 1 ? '' : 's'} waiting for approval`, sub: 'Your manager has been notified' },
  ].filter(Boolean);
  return (
    <ul className="lv-soon">
      {rows.length === 0 && <li className="muted">Nothing coming up.</li>}
      {rows.map((r, i) => (
        <li key={r.title} style={{ '--i': i }}>
          <span className={`lv-soon-ico ${r.tone}`}><Icon name={r.icon} size={16} /></span>
          <div>
            <strong>{r.title}</strong>
            <small className="muted">{r.sub}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- the whole section ----------
export default function LeaveInsights({ db, user, bal, tiles, year }) {
  const days = useMemo(() => leaveDays(db, user.id, year), [db, user.id, year]);
  const dayTypes = db.leaveTypes;
  const wheel = bal.filter((b) => !b.type.unlimited && b.unit !== 'Hours' && b.quota > 0);
  const sd = cycleStartOf(db);
  return (
    <div className="lv">
      <div className="lv-row lv-row-a">
        <section className="lv-card lv-rise" style={{ '--i': 0 }}>
          <h3>Leave balance</h3>
          <p className="muted lv-sub">What is left of each leave type. Hover a ring or a row to look closer.</p>
          <Wheel items={wheel} />
        </section>
        <section className="lv-card lv-rise" style={{ '--i': 1 }}>
          <h3>Leave rhythm</h3>
          <p className="muted lv-sub">Days of leave taken each month of {year}, by type. Hover a month for the details.</p>
          <Rhythm days={days} types={dayTypes} year={year} />
        </section>
      </div>

      <div className="lv-caps">
        {tiles.map((b, i) => (
          <Capsule key={b.type.id} b={b} i={i} sd={sd} />
        ))}
      </div>

      <div className="lv-row lv-row-b">
        <section className="lv-card lv-rise" style={{ '--i': 2 }}>
          <h3>{year} at a glance</h3>
          <p className="muted lv-sub">Every day of the year: where you worked, took leave, and what is still ahead.</p>
          <YearMap db={db} emp={user} days={days} types={dayTypes} year={year} />
        </section>
        <div className="lv-stack">
          <section className="lv-card lv-rise" style={{ '--i': 3 }}>
            <h3>Leave by weekday</h3>
            <WeekdayBubbles days={days} />
          </section>
          <section className="lv-card lv-rise" style={{ '--i': 4 }}>
            <h3>Coming up</h3>
            <ComingUp db={db} emp={user} bal={bal} />
          </section>
        </div>
      </div>
    </div>
  );
}
