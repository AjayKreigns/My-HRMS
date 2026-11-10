import { useState } from 'react';
import { useDB, update, uid } from '../store.js';
import { Card, Btn, Badge, Tabs, KV, FormModal, Avatar, EmpChip, DataTable, Empty, toast, confirmAction, Icon } from '../ui.jsx';
import { go } from '../App.jsx';
import { empById, fullName, fmtDate, money, salaryBreakup, parseISO } from '../utils.js';

const opt = (arr) => arr;
export const PRIMARY_FIELDS = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'middleName', label: 'Middle name' },
  { key: 'lastName', label: 'Last name', required: true },
  { key: 'displayName', label: 'Display name' },
  { key: 'gender', label: 'Gender', type: 'select', options: opt(['Male', 'Female', 'Other']), required: true },
  { key: 'dob', label: 'Date of birth', type: 'date', required: true },
  { key: 'maritalStatus', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
  { key: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { key: 'nationality', label: 'Nationality', default: 'Indian' },
  { key: 'physicallyChallenged', label: 'Physically challenged', type: 'select', options: ['No', 'Yes'], default: 'No' },
];
export const CONTACT_FIELDS = [
  { key: 'workEmail', label: 'Work email', type: 'email', required: true },
  { key: 'personalEmail', label: 'Personal email', type: 'email' },
  { key: 'mobile', label: 'Mobile phone', type: 'tel', required: true },
  { key: 'workPhone', label: 'Work phone', type: 'tel' },
  { key: 'residencePhone', label: 'Residence phone', type: 'tel' },
  { key: 'skype', label: 'Teams / Skype ID' },
];
const addr = (p, label) => [
  { key: `${p}_line1`, label: 'Address line 1', section: label, full: true },
  { key: `${p}_line2`, label: 'Address line 2', section: label, full: true },
  { key: `${p}_city`, label: 'City', section: label },
  { key: `${p}_state`, label: 'State', section: label },
  { key: `${p}_country`, label: 'Country', section: label },
  { key: `${p}_pincode`, label: 'PIN code', section: label },
];
export const ADDRESS_FIELDS = [...addr('cur', 'Current address'), ...addr('per', 'Permanent address')];
export const IDENTITY_FIELDS = [
  { key: 'pan', label: 'PAN number' },
  { key: 'aadhaar', label: 'Aadhaar number' },
  { key: 'passport', label: 'Passport number' },
  { key: 'passportExpiry', label: 'Passport expiry', type: 'date' },
  { key: 'voterId', label: 'Voter ID' },
  { key: 'drivingLicense', label: 'Driving licence' },
];
export const jobFields = (db) => [
  { key: 'empNo', label: 'Employee number', required: true },
  { key: 'dateOfJoining', label: 'Date of joining', type: 'date', required: true },
  { key: 'designation', label: 'Job title (primary)', type: 'select', options: db.designations.map((d) => d.title), required: true },
  { key: 'secondaryTitle', label: 'Job title (secondary)' },
  { key: 'department', label: 'Department', type: 'select', options: db.departments.map((d) => d.name), required: true },
  { key: 'locationId', label: 'Location', type: 'select', options: db.locations.map((l) => ({ value: l.id, label: l.name })), required: true },
  { key: 'legalEntity', label: 'Legal entity', default: db.company.legalName },
  { key: 'businessUnit', label: 'Business unit', type: 'select', options: db.businessUnits.map((b) => b.name) },
  { key: 'costCenter', label: 'Cost centre', type: 'select', options: db.costCenters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })) },
  { key: 'reportingTo', label: 'Reporting manager', type: 'employee' },
  { key: 'hrManager', label: 'HR manager', type: 'employee' },
  { key: 'workerType', label: 'Worker type', type: 'select', options: ['Permanent', 'Contract', 'Intern', 'Consultant'], default: 'Permanent' },
  { key: 'timeType', label: 'Time type', type: 'select', options: ['Full time', 'Part time'], default: 'Full time' },
  { key: 'gradeId', label: 'Band / grade', type: 'select', options: db.grades.map((g) => ({ value: g.id, label: g.name })) },
  { key: 'probationEndDate', label: 'Probation end date', type: 'date' },
  { key: 'noticePeriodDays', label: 'Notice period (days)', type: 'number', default: 60 },
  { key: 'status', label: 'Employment status', type: 'select', options: ['Pre-boarding', 'Probation', 'Active', 'Notice period', 'Exited'], default: 'Probation' },
  { key: 'role', label: 'HRMS access role', type: 'select', options: [{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'HR / Admin' }], default: 'employee' },
];
export const timeFields = (db) => [
  { key: 'shiftId', label: 'Shift', type: 'select', options: db.shifts.map((s) => ({ value: s.id, label: s.name })), default: db.shifts[0]?.id },
  { key: 'weeklyOff', label: 'Weekly off', type: 'select', options: ['Saturday & Sunday', 'Sunday', 'Alternate Saturdays & Sunday', 'Friday'], default: 'Saturday & Sunday' },
  { key: 'leavePlan', label: 'Leave plan', type: 'select', options: ['Standard Leave Plan', 'Intern Leave Plan', 'Site Leave Plan'], default: 'Standard Leave Plan' },
  { key: 'holidayCalendar', label: 'Holiday calendar', type: 'select', options: ['India - Tamil Nadu', 'India - Maharashtra', 'Client site'], default: 'India - Tamil Nadu' },
  { key: 'attendanceNumber', label: 'Attendance number' },
  { key: 'attendanceScheme', label: 'Attendance capture', type: 'select', options: ['Web clock-in', 'Biometric', 'Web + Mobile (Remote)'], default: 'Web clock-in' },
  { key: 'expensePolicy', label: 'Expense policy', type: 'select', options: ['Standard Expense Policy', 'Site Travel Policy'], default: 'Standard Expense Policy' },
];
export const FINANCE_FIELDS = [
  { key: 'ctc', label: 'Annual CTC (INR)', type: 'number', required: true, section: 'Salary' },
  { key: 'taxRegime', label: 'Tax regime', type: 'select', options: ['New', 'Old'], default: 'New', section: 'Salary' },
  { key: 'bank_bankName', label: 'Bank name', section: 'Bank account' },
  { key: 'bank_accountNumber', label: 'Account number', section: 'Bank account' },
  { key: 'bank_ifsc', label: 'IFSC code', section: 'Bank account' },
  { key: 'bank_accountHolder', label: 'Name on account', section: 'Bank account' },
  { key: 'bank_branch', label: 'Branch', section: 'Bank account' },
  { key: 'uan', label: 'UAN', section: 'Statutory' },
  { key: 'pfNumber', label: 'PF number', section: 'Statutory' },
  { key: 'esiNumber', label: 'ESI number', section: 'Statutory' },
];
const FAMILY_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'relation', label: 'Relation', type: 'select', options: ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'], required: true },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'profession', label: 'Profession' },
  { key: 'emergency', label: 'Emergency contact', type: 'select', options: ['No', 'Yes'], default: 'No' },
];
const EDU_FIELDS = [
  { key: 'degree', label: 'Degree', required: true },
  { key: 'branch', label: 'Branch / specialisation' },
  { key: 'university', label: 'University / college', required: true, full: true },
  { key: 'yearOfJoining', label: 'Year of joining' },
  { key: 'yearOfCompletion', label: 'Year of completion' },
  { key: 'score', label: 'CGPA / percentage' },
];
const EXP_FIELDS = [
  { key: 'company', label: 'Company', required: true },
  { key: 'jobTitle', label: 'Job title', required: true },
  { key: 'from', label: 'From', type: 'date', required: true },
  { key: 'to', label: 'To', type: 'date', required: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
];

// nested objects (address, bank) are edited as flat prefixed keys
export function flatten(emp) {
  const v = { ...emp };
  ['line1', 'line2', 'city', 'state', 'country', 'pincode'].forEach((k) => {
    v[`cur_${k}`] = emp.currentAddress?.[k] || '';
    v[`per_${k}`] = emp.permanentAddress?.[k] || '';
  });
  ['bankName', 'accountNumber', 'ifsc', 'accountHolder', 'branch'].forEach((k) => (v[`bank_${k}`] = emp.bank?.[k] || ''));
  return v;
}
export function unflatten(v, base = {}) {
  const out = { ...v };
  const cur = { ...(base.currentAddress || {}) };
  const per = { ...(base.permanentAddress || {}) };
  const bank = { ...(base.bank || {}) };
  let a = false;
  let b = false;
  Object.keys(v).forEach((k) => {
    if (k.startsWith('cur_')) (cur[k.slice(4)] = v[k]), (a = true), delete out[k];
    if (k.startsWith('per_')) (per[k.slice(4)] = v[k]), (a = true), delete out[k];
    if (k.startsWith('bank_')) (bank[k.slice(5)] = v[k]), (b = true), delete out[k];
  });
  if (a) Object.assign(out, { currentAddress: cur, permanentAddress: per });
  if (b) out.bank = bank;
  return out;
}

function show(emp, fields, db) {
  const f = flatten(emp);
  return fields.map((x) => {
    let v = f[x.key];
    if (x.type === 'date') v = v ? fmtDate(v) : '';
    if (x.type === 'employee') v = v ? fullName(empById(db, v)) : '';
    if (x.type === 'select' && Array.isArray(x.options) && typeof x.options[0] === 'object') v = x.options.find((o) => o.value === v)?.label || v;
    if (x.key === 'ctc') v = money(v);
    return [/^(cur|per)_/.test(x.key) ? `${x.section.split(' ')[0]}: ${x.label}` : x.label, v];
  });
}

function ListSection({ title, items, fields, cols, canEdit, onChange }) {
  const [edit, setEdit] = useState(null);
  return (
    <Card title={title} pad={false} actions={canEdit && <Btn small kind="ghost" icon="plus" onClick={() => setEdit({})}>Add</Btn>}>
      {items.length === 0 ? (
        <Empty text="Nothing added." />
      ) : (
        <DataTable
          rows={items}
          columns={[
            ...cols,
            ...(canEdit
              ? [{ key: 'act', label: '', sortable: false, render: (r) => <span className="row-actions"><Btn kind="icon" icon="edit" aria-label="Edit" onClick={() => setEdit(r)} /><Btn kind="icon" icon="trash" aria-label="Delete" onClick={() => confirmAction('Remove this entry?') && onChange(items.filter((x) => x.id !== r.id))} /></span> }]
              : []),
          ]}
        />
      )}
      {edit && (
        <FormModal
          title={`${edit.id ? 'Edit' : 'Add'} ${title.toLowerCase()}`}
          fields={fields}
          initial={edit}
          onClose={() => setEdit(null)}
          onSave={(v) => {
            onChange(edit.id ? items.map((x) => (x.id === edit.id ? { ...x, ...v } : x)) : [...items, { ...v, id: uid('row') }]);
            setEdit(null);
            toast('Saved');
          }}
        />
      )}
    </Card>
  );
}

export default function Profile({ user, empId, tab: initialTab }) {
  const db = useDB();
  const emp = empById(db, empId);
  const [tab, setTab] = useState(initialTab || 'about');
  const [edit, setEdit] = useState(null);
  if (!emp) return <Card><Empty text="Employee not found." /></Card>;
  const self = emp.id === user.id;
  const admin = user.role === 'admin';
  const isManager = emp.reportingTo === user.id;
  const canPersonal = self || admin;
  const canSensitive = self || admin;
  const manager = empById(db, emp.reportingTo);
  const reports = db.employees.filter((e) => e.reportingTo === emp.id && e.status !== 'Exited');
  const loc = db.locations.find((l) => l.id === emp.locationId);
  const assets = db.assets.filter((a) => a.assignedTo === emp.id);
  const docs = db.documents.filter((d) => d.empId === emp.id);
  const save = (v) => {
    update((d) => {
      const i = d.employees.findIndex((e) => e.id === emp.id);
      d.employees[i] = { ...d.employees[i], ...unflatten(v, d.employees[i]) };
    });
    setEdit(null);
    toast('Profile updated');
  };
  const setList = (key) => (items) => update((d) => (d.employees.find((e) => e.id === emp.id)[key] = items));
  const section = (title, fields, editable) => (
    <Card title={title} actions={editable && <Btn small kind="ghost" icon="edit" onClick={() => setEdit({ title, fields })}>Edit</Btn>}>
      <KV items={show(emp, fields, db)} />
    </Card>
  );
  const tenure = (() => {
    const d = parseISO(emp.dateOfJoining);
    const m = (new Date().getFullYear() - d.getFullYear()) * 12 + new Date().getMonth() - d.getMonth();
    return m < 0 ? 'Yet to join' : `${Math.floor(m / 12)}y ${m % 12}m`;
  })();
  const tabs = [
    { key: 'about', label: 'About' },
    { key: 'profile', label: 'Profile' },
    { key: 'job', label: 'Job' },
    ...(canSensitive || isManager ? [{ key: 'documents', label: 'Documents' }, { key: 'assets', label: 'Assets' }] : []),
    ...(canSensitive ? [{ key: 'finances', label: 'Finances' }] : []),
  ];
  const b = salaryBreakup(emp.ctc, db.payrollSettings);

  return (
    <div>
      <Card>
        <div className="profile-head">
          <Avatar emp={emp} size={76} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row">
              <h2>{fullName(emp)}</h2>
              <Badge>{emp.status}</Badge>
            </div>
            <p className="muted">
              {emp.designation} · {emp.department} · {emp.empNo}
            </p>
            <div className="row" style={{ marginTop: 8, gap: 18 }}>
              <span className="row" style={{ gap: 4 }}><Icon name="mail" size={14} /> {emp.workEmail}</span>
              <span className="row" style={{ gap: 4 }}><Icon name="phone" size={14} /> {emp.mobile}</span>
              <span className="row" style={{ gap: 4 }}><Icon name="pin" size={14} /> {loc?.name}</span>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Reporting to</span>
            {manager ? <EmpChip emp={manager} onClick={() => go(`profile/${manager.id}`)} /> : <span>—</span>}
          </div>
        </div>
      </Card>
      <div style={{ height: 12 }} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'about' && (
        <div className="grid g2">
          <Card title="About" actions={canPersonal && <Btn small kind="ghost" icon="edit" onClick={() => setEdit({ title: 'About', fields: [{ key: 'about', label: 'About me', type: 'textarea', full: true, rows: 5 }] })}>Edit</Btn>}>
            <p>{emp.about || <span className="muted">No introduction yet.</span>}</p>
            <h4 style={{ fontSize: 12.5, margin: '14px 0 6px' }}>Skills</h4>
            {(emp.skills || []).map((s) => <span key={s} className="chip">{s}</span>)}
          </Card>
          <Card title="At a glance">
            <KV items={[['Date of joining', fmtDate(emp.dateOfJoining)], ['Time with company', tenure], ['Birthday', fmtDate(emp.dob, { year: undefined })], ['Location', loc?.name], ['Business unit', emp.businessUnit], ['Worker type', `${emp.workerType} · ${emp.timeType}`]]} />
          </Card>
          <Card title={`Direct reports (${reports.length})`} className="span2">
            {reports.length === 0 ? <p className="muted">No direct reports.</p> : <div className="row" style={{ gap: 16 }}>{reports.map((r) => <EmpChip key={r.id} emp={r} onClick={() => go(`profile/${r.id}`)} />)}</div>}
          </Card>
        </div>
      )}

      {tab === 'profile' && (
        <div className="stack">
          <div className="grid g2">
            {section('Primary details', PRIMARY_FIELDS, canPersonal)}
            {section('Contact details', CONTACT_FIELDS.map((f) => (f.key === 'workEmail' && !admin ? { ...f, disabled: true } : f)), canPersonal)}
            {section('Addresses', ADDRESS_FIELDS, canPersonal)}
            {canSensitive && section('Identity information', IDENTITY_FIELDS, canPersonal)}
          </div>
          <ListSection title="Family & relations" items={emp.family || []} fields={FAMILY_FIELDS} canEdit={canPersonal} onChange={setList('family')} cols={[{ key: 'name', label: 'Name' }, { key: 'relation', label: 'Relation' }, { key: 'dob', label: 'Date of birth', render: (r) => fmtDate(r.dob) }, { key: 'phone', label: 'Phone' }, { key: 'emergency', label: 'Emergency contact' }]} />
          <ListSection title="Education" items={emp.education || []} fields={EDU_FIELDS} canEdit={canPersonal} onChange={setList('education')} cols={[{ key: 'degree', label: 'Degree' }, { key: 'branch', label: 'Branch' }, { key: 'university', label: 'University' }, { key: 'yearOfCompletion', label: 'Completed' }, { key: 'score', label: 'Score' }]} />
          <ListSection title="Previous experience" items={emp.experience || []} fields={EXP_FIELDS} canEdit={canPersonal} onChange={setList('experience')} cols={[{ key: 'company', label: 'Company' }, { key: 'jobTitle', label: 'Job title' }, { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) }]} />
        </div>
      )}

      {tab === 'job' && (
        <div className="grid g2">
          {section('Job details', jobFields(db), admin)}
          {section('Time, leave & expense policies', timeFields(db), admin)}
        </div>
      )}

      {tab === 'documents' && (
        <Card pad={false} title="Documents">
          <DataTable rows={docs} empty="No documents uploaded." columns={[{ key: 'name', label: 'Document' }, { key: 'category', label: 'Category' }, { key: 'fileName', label: 'File' }, { key: 'uploadedOn', label: 'Uploaded', render: (d) => fmtDate(d.uploadedOn) }]} />
        </Card>
      )}

      {tab === 'assets' && (
        <Card pad={false} title="Assigned assets">
          <DataTable rows={assets} empty="No assets assigned." columns={[{ key: 'type', label: 'Type' }, { key: 'name', label: 'Asset' }, { key: 'serialNo', label: 'Serial no.' }, { key: 'assignedOn', label: 'Assigned on', render: (a) => fmtDate(a.assignedOn) }, { key: 'condition', label: 'Condition' }]} />
        </Card>
      )}

      {tab === 'finances' && (
        <div className="grid g2">
          {section('Bank, salary & statutory details', FINANCE_FIELDS, admin)}
          <Card title="Monthly salary structure">
            <ul className="list">
              {b.earnings.map(([k, v]) => (
                <li key={k}><span>{k}</span><strong>{money(v)}</strong></li>
              ))}
              <li><span>Gross monthly</span><strong>{money(b.gross)}</strong></li>
              {b.employer.map(([k, v]) => (
                <li key={k}><span className="muted">{k} (employer)</span><span>{money(v)}</span></li>
              ))}
              <li><span>Annual CTC</span><strong>{money(emp.ctc)}</strong></li>
            </ul>
          </Card>
        </div>
      )}

      {edit && <FormModal title={`Edit ${edit.title.toLowerCase()}`} fields={edit.fields} initial={flatten(emp)} onClose={() => setEdit(null)} onSave={save} wide={edit.fields.length > 8} />}
    </div>
  );
}
