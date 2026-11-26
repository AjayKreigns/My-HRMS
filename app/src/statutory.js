// Provident Fund and ESI rules. Everything the law fixes is a default here that the company can change
// in Payroll > Settings > PF & ESI. This file imports nothing so utils.js can use it without a loop.

// ---------- Provident Fund ----------
export const PF_DEFAULTS = {
  basis: 'capped', // 'capped': PF on basic up to the ceiling. 'actual': PF on the full basic. An employee can differ (profile > Statutory).
  employeeRate: 12, // % of PF wage deducted from the employee
  employerRate: 12, // % of PF wage the employer pays in all (EPS + EPF)
  epsRate: 8.33, // the part of the employer share that goes to the pension fund (EPS), on wages up to the ceiling
  edliRate: 0.5, // employer's insurance contribution (EDLI), % of wages up to the ceiling
  adminRate: 0.5, // employer's EPF administration charge, % of PF wage
  adminMin: 500, // the administration charge for the whole month is never less than this
  chargesInCtc: false, // false: EDLI and administration are paid on top of the CTC. true: they come out of the CTC like the employer's share
  // The wage ceiling over time. The rule with the latest "from" date on or before a day is the one in force that day.
  rules: [
    { from: '2014-09-01', ceiling: 15000 },
    { from: '2026-09-17', ceiling: 25000 },
  ],
};

const sortedRules = (rules) =>
  (rules || [])
    .filter((r) => r && r.from && Number(r.ceiling) > 0)
    .map((r) => ({ from: r.from, ceiling: Number(r.ceiling) }))
    .sort((a, b) => a.from.localeCompare(b.from));

export const pfPolicy = (db) => {
  const saved = db?.payrollSettings?.pfPolicy || {};
  const rules = sortedRules(saved.rules);
  return { ...PF_DEFAULTS, ...saved, rules: rules.length ? rules : PF_DEFAULTS.rules };
};

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};

// The ceiling in force on one day.
export function pfCeilingOn(policy, date) {
  const rules = sortedRules(policy?.rules).length ? sortedRules(policy.rules) : PF_DEFAULTS.rules;
  const day = date || isoOf(new Date());
  let ceiling = rules[0].ceiling;
  rules.forEach((r) => {
    if (r.from <= day) ceiling = r.ceiling;
  });
  return ceiling;
}

// The ceiling for a pay cycle. When the rule changes inside the cycle, each day uses the ceiling of
// its own day and the cycle gets the average (so 12 days at 15,000 and 19 at 25,000 is about 21,129).
export function pfCeilingForCycle(policy, from, to) {
  if (!from || !to) return pfCeilingOn(policy);
  let sum = 0;
  let days = 0;
  for (let d = dateOf(from); isoOf(d) <= to; d.setDate(d.getDate() + 1)) {
    sum += pfCeilingOn(policy, isoOf(d));
    days++;
  }
  return days ? sum / days : pfCeilingOn(policy, from);
}

// Employee profile choice: 'Capped at ceiling' / 'Actual basic'; blank follows the company.
export const PF_BASIS_OPTIONS = ['Capped at ceiling', 'Actual basic'];
export const pfBasisOf = (policy, emp) => (emp?.pfBasis === 'Actual basic' ? 'actual' : emp?.pfBasis === 'Capped at ceiling' ? 'capped' : policy?.basis === 'actual' ? 'actual' : 'capped');

// Every PF amount for one month, before rounding.
//   basic: the basic earned in the month; ceiling: the wage ceiling; basis: 'capped' | 'actual'; epsApplies: false for members who get no pension share
export function pfOf(policy, { basic, ceiling, basis = 'capped', epsApplies = true }) {
  const p = { ...PF_DEFAULTS, ...(policy || {}) };
  const b = Math.max(Number(basic) || 0, 0);
  const cap = Number(ceiling) > 0 ? Number(ceiling) : pfCeilingOn(p);
  const wage = basis === 'actual' ? b : Math.min(b, cap);
  const capped = Math.min(b, cap);
  const employee = (wage * p.employeeRate) / 100;
  const employer = (wage * p.employerRate) / 100;
  const epsWage = epsApplies === false ? 0 : capped;
  const eps = Math.min((epsWage * p.epsRate) / 100, employer);
  return {
    ceiling: cap,
    wage, // EPF wages
    epsWage,
    edliWage: capped,
    employee,
    employer, // EPS + EPF
    eps,
    epf: employer - eps,
    edli: (capped * p.edliRate) / 100,
    admin: (wage * p.adminRate) / 100, // the month's total is raised to the minimum for the whole company (see adminTotal)
  };
}
// The administration charge for the whole company: the sum, but never under the minimum (if anyone pays PF).
export const adminTotal = (policy, sum) => (sum > 0 ? Math.max(sum, Number(policy?.adminMin ?? PF_DEFAULTS.adminMin)) : 0);

// ---------- ESI ----------
export const ESI_DEFAULTS = {
  enabled: true, // off means no ESI for anyone
  grossLimit: 21000, // monthly wages up to this are covered
  employeeRate: 0.75, // % of wages
  employerRate: 3.25, // % of wages
  // Coverage is decided on the wages in the first month of each contribution period and holds for the whole
  // period, even if pay rises above the limit. Two periods a year starting in these months (April and October).
  periodStart1: 4,
  periodStart2: 10,
};
export const esiPolicy = (db) => ({ ...ESI_DEFAULTS, ...(db?.payrollSettings?.esiPolicy || {}) });

// The contribution period a payroll month falls in: { start: 'YYYY-MM', end: 'YYYY-MM' }.
export function esiPeriodOf(policy, ym) {
  const p = { ...ESI_DEFAULTS, ...(policy || {}) };
  const starts = [...new Set([Number(p.periodStart1), Number(p.periodStart2)].filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const list = starts.length ? starts : [4, 10];
  const [y, m] = ym.split('-').map(Number);
  const before = list.filter((s) => s <= m);
  const startMonth = before.length ? before[before.length - 1] : list[list.length - 1];
  const startYear = before.length ? y : y - 1;
  const next = list.find((s) => s > startMonth) ?? list[0] + 12;
  const endMonthIndex = startMonth - 1 + (next - startMonth) - 1; // zero-based months after startYear-01
  const endYear = startYear + Math.floor(endMonthIndex / 12);
  const endMonth = (endMonthIndex % 12) + 1;
  const f = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
  return { start: f(startYear, startMonth), end: f(endYear, endMonth) };
}

// Pay for these kinds is not ESI wages.
export const ESI_EXCLUDED = ['Overtime', 'Reimbursement', 'Leave encashment', 'Gratuity'];
// ESI is rounded up to the next rupee.
export const esiAmount = (wages, rate) => Math.ceil(Math.round(((Number(wages) || 0) * rate) / 100 * 1e6) / 1e6);

// ---------- Professional Tax ----------
// Tamil Nadu charges by half-yearly income. Each state has its own slab table; employees with no work state of their
// own use the company's default state. Only Tamil Nadu is set up; another state is added when it is needed.
export const PT_DEFAULTS = {
  defaultState: 'Tamil Nadu',
  states: {
    'Tamil Nadu': {
      // The half-yearly amount for half-yearly income up to "upTo" (null: no upper limit).
      slabs: [
        { upTo: 21000, amount: 0 },
        { upTo: 30000, amount: 135 },
        { upTo: 45000, amount: 315 },
        { upTo: 60000, amount: 690 },
        { upTo: 75000, amount: 1025 },
        { upTo: null, amount: 1250 },
      ],
    },
  },
};
export const ptPolicy = (db) => {
  const saved = db?.payrollSettings?.ptPolicy || {};
  return { ...PT_DEFAULTS, ...saved, states: { ...PT_DEFAULTS.states, ...(saved.states || {}) } };
};
export const ptStateOf = (policy, emp) => (emp?.workState && policy.states[emp.workState] ? emp.workState : policy.defaultState);
// The half-yearly Professional Tax for a monthly gross.
export function ptHalfYear(policy, state, monthlyGross) {
  const slabs = policy.states?.[state]?.slabs || [];
  const half = (Number(monthlyGross) || 0) * 6;
  const hit = slabs.find((s) => s.upTo === null || s.upTo === undefined || half <= Number(s.upTo));
  return hit ? Number(hit.amount) || 0 : 0;
}
// Deducted monthly: a sixth of the half-yearly amount each month, and the last month of the half-year (September, March)
// takes whatever makes the half-year total exact.
export function ptMonthly(policy, state, monthlyGross, ym) {
  const half = ptHalfYear(policy, state, monthlyGross);
  const m = Number(ym.slice(5));
  const idx = m >= 4 && m <= 9 ? m - 4 : m >= 10 ? m - 10 : m + 2; // 0..5 within the half-year
  const each = Math.round(half / 6);
  return idx === 5 ? half - each * 5 : each;
}

// ---------- Labour Welfare Fund ----------
// Deducted only in the due months, not every month. Amounts are the pay group's (employee and employer share per payment).
export const LWF_DEFAULTS = { frequency: 'yearly', month: 12 }; // Tamil Nadu: yearly, paid by 31 January, so taken in December
export const lwfPolicy = (db) => ({ ...LWF_DEFAULTS, ...(db?.payrollSettings?.lwfPolicy || {}) });
export const lwfDue = (policy, ym) => {
  const m = Number(ym.slice(5));
  const p = { ...LWF_DEFAULTS, ...(policy || {}) };
  const first = Number(p.month) || 12;
  return p.frequency === 'half-yearly' ? m === first || m === ((first + 5) % 12) + 1 : m === first;
};

// ---------- Wage rule (Code on Wages: wages should be at least a set share of total pay) ----------
// Wages are basic plus every component not on the exclusion list. The admin sets the share and the exclusions.
export const WAGE_DEFAULTS = {
  enabled: true,
  minPct: 50,
  exclusions: ['House Rent Allowance', 'Conveyance Allowance', 'Medical Allowance', 'Special Allowance'],
};
export const wagePolicy = (db) => {
  const saved = db?.payrollSettings?.wagePolicy || {};
  return { ...WAGE_DEFAULTS, ...saved, exclusions: Array.isArray(saved.exclusions) ? saved.exclusions : [...WAGE_DEFAULTS.exclusions] };
};
// earnings: [[name, monthly amount], ...] with Basic first. Employer PF and gratuity are not part of total pay.
export function wageShare(earnings, policy) {
  const p = { ...WAGE_DEFAULTS, ...(policy || {}) };
  const out = new Set(p.exclusions);
  const total = earnings.reduce((t, [, v]) => t + v, 0);
  const wages = earnings.reduce((t, [k, v], i) => t + (i === 0 || !out.has(k) ? v : 0), 0);
  const pct = total > 0 ? (wages / total) * 100 : 0;
  return { wages, total, pct, below: p.enabled !== false && pct < Number(p.minPct) - 1e-9 };
}

// ---------- Full and final settlement ----------
// Leave encashment and notice recovery. Management can change every part in Payroll > Settings > Full & final.
export const EXIT_DEFAULTS = {
  encashEnabled: true, // pay out unused leave of the types marked encashable
  encashBasis: 'basic', // a day's pay is worked out from: 'basic' or 'gross'
  encashDivisor: 26, // days a month is divided into for a day's pay
  encashMaxDays: 0, // most days paid out; 0 means no limit
  noticeBasis: 'gross', // notice shortfall is recovered at a day's: 'basic' or 'gross'
  noticeDivisor: 30,
  noticeCapDays: 0, // most days recovered; 0 means no limit
};
export const exitPolicy = (db) => ({ ...EXIT_DEFAULTS, ...(db?.payrollSettings?.exitPolicy || {}) });
