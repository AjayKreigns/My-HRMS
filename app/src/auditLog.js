// Change audit: who changed the pay-related details of an employee, or a payroll setting, and when.
// store.js calls recordChanges on every save. Account and Aadhaar numbers are kept to their last four digits.
const EMP_FIELDS = [
  ['ctc', 'CTC'], ['designation', 'Job title'], ['status', 'Employment status'], ['dateOfJoining', 'Date of joining'],
  ['payGroupId', 'Pay group'], ['structureId', 'Pay structure'], ['taxRegime', 'Tax regime'],
  ['pan', 'PAN'], ['uan', 'UAN'], ['pfNumber', 'PF number'], ['esiNumber', 'ESI number'], ['aadhaar', 'Aadhaar'],
  ['pfApplies', 'Availing PF'], ['pfBasis', 'PF worked out on'], ['epsApplies', 'EPS share'], ['gratuityApplies', 'Gratuity applies'],
  ['workState', 'Work state'], ['attendanceExempt', 'Exception employee'], ['prevIncome', 'Previous employer income'], ['prevTds', 'Previous employer TDS'],
];
const BANK_FIELDS = [['bankName', 'Bank'], ['accountNumber', 'Bank account number'], ['ifsc', 'IFSC'], ['accountHolder', 'Name on bank account']];
const SETTINGS = ['cycleStartDay', 'pfPolicy', 'esiPolicy', 'ptPolicy', 'lwfPolicy', 'wagePolicy', 'exitPolicy', 'gratuityPolicy', 'approval'];
export const AUDIT_LIMIT = 5000; // newest entries kept (browser storage is small; a server would keep them all)

const mask = (field, v) => {
  const s = String(v ?? '');
  return ['accountNumber', 'aadhaar'].includes(field) && s.length > 4 ? `••••${s.slice(-4)}` : s;
};
const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

export function recordChanges(before, after, by) {
  if (!before || !after || !Array.isArray(after.employees)) return;
  const found = [];
  const was = new Map((before.employees || []).map((e) => [e.id, e]));
  after.employees.forEach((e) => {
    const o = was.get(e.id);
    if (!o) return;
    EMP_FIELDS.forEach(([k, label]) => {
      if (String(o[k] ?? '') !== String(e[k] ?? '')) found.push({ kind: 'Employee', empId: e.id, field: label, from: mask(k, o[k]), to: mask(k, e[k]) });
    });
    BANK_FIELDS.forEach(([k, label]) => {
      if (String(o.bank?.[k] ?? '') !== String(e.bank?.[k] ?? '')) found.push({ kind: 'Employee', empId: e.id, field: label, from: mask(k, o.bank?.[k]), to: mask(k, e.bank?.[k]) });
    });
  });
  SETTINGS.forEach((k) => {
    const a = JSON.stringify(before.payrollSettings?.[k] ?? null);
    const b = JSON.stringify(after.payrollSettings?.[k] ?? null);
    if (a !== b) found.push({ kind: 'Setting', field: k, from: short(a), to: short(b) });
  });
  ['payGroups', 'payStructures'].forEach((col) => {
    const old = new Map((before[col] || []).map((x) => [x.id, JSON.stringify(x)]));
    (after[col] || []).forEach((x) => {
      const j = JSON.stringify(x);
      if (!old.has(x.id)) found.push({ kind: 'Setting', field: `${col === 'payGroups' ? 'Pay group' : 'Pay structure'} added: ${x.name}`, from: '', to: short(j) });
      else if (old.get(x.id) !== j) found.push({ kind: 'Setting', field: `${col === 'payGroups' ? 'Pay group' : 'Pay structure'}: ${x.name}`, from: short(old.get(x.id)), to: short(j) });
    });
  });
  if (!found.length) return;
  const at = new Date().toISOString();
  const rows = found.map((f, i) => ({ id: `aud_${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`, at, by: by || '', ...f }));
  after.auditLog = [...rows, ...(after.auditLog || [])].slice(0, AUDIT_LIMIT);
}
