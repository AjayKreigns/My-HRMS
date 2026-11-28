// Payroll settings (pay groups, structures, PF and ESI, PT and LWF, approvals, mail...). Opened from Payroll.jsx when needed.
import { useState } from 'react';
import { addItem, patchItem, update, uid } from '../store.js';
import { Btn, Badge, DataTable, FormModal, Modal, FormGrid, Tabs, toast, confirmAction } from '../ui.jsx';
import { empById, fullName, money, monthLabel, salaryBreakup, payGroupOf, structureOf, structureFromSettings, GRATUITY_DEFAULTS, gratuityPolicy, gratuityPayable, groupFromSettings, COMPONENT_TYPES, MONTHS } from '../utils.js';
import { EXIT_DEFAULTS, exitPolicy, WAGE_DEFAULTS, wagePolicy, wageShare, PF_DEFAULTS, ESI_DEFAULTS, PT_DEFAULTS, LWF_DEFAULTS, pfPolicy, esiPolicy, ptPolicy, lwfPolicy, ptHalfYear, ptMonthly, pfCeilingOn, pfOf } from '../statutory.js';
import { MAIL_DEFAULTS, mailSettings, smtpReady } from '../payslipMail.js';
import { approvalPolicy, approverIds, saveApprovalSettings } from '../payrollApproval.js';
import { lakh } from './payrollViews.jsx';
import { Panel, inr } from './payrollShared.jsx';
import '../payroll.css';
import '../payrollx.css';

// ---------- settings: pay cycle, pay groups, pay structures ----------
const GROUP_FIELDS = [
  { key: 'name', label: 'Pay group name', required: true, section: 'Pay group' },
  { key: 'structureId', label: 'Default pay structure', type: 'select', required: true, options: (db) => (db.payStructures || []).map((s) => ({ value: s.id, label: s.name })), help: 'An employee can have a different structure on their profile.' },
  { key: 'description', label: 'Description', full: true },
  { key: 'payDay', label: 'Pay day', type: 'select', options: ['Last working day', '1st of next month', '7th of next month'], section: 'Pay and lock' },
  { key: 'lockDay', label: 'Attendance & inputs lock day', type: 'number' },
  { key: 'pfEnabled', label: 'Provident Fund applies', type: 'checkbox', section: 'Statutory deductions' },
  { key: 'pfCeiling', label: 'PF wage ceiling (blank follows the statutory rules)', type: 'number', min: 0, show: (v) => v.pfEnabled, help: 'Leave empty to use the ceiling set under Settings > PF & ESI. Fill it in only if this group needs its own.' },
  { key: 'esiEnabled', label: 'ESI applies (wage limit is set under Settings > PF & ESI)', type: 'checkbox' },
  { key: 'ptEnabled', label: 'Professional tax applies', type: 'checkbox' },
  { key: 'ptAmount', label: 'Fixed Professional Tax / month (blank follows the state slabs)', type: 'number', min: 0, show: (v) => v.ptEnabled, help: 'Leave empty to use the slabs under Settings > PT & LWF. Fill it in only to charge one fixed amount to this group.' },
  { key: 'lwfEnabled', label: 'Labour welfare fund applies', type: 'checkbox' },
  { key: 'lwfEmployee', label: 'LWF employee share (each payment)', type: 'number', show: (v) => v.lwfEnabled },
  { key: 'lwfEmployer', label: 'LWF employer share (each payment)', type: 'number', show: (v) => v.lwfEnabled, help: 'Taken only in the months set under Settings > PT & LWF.' },
];

// Mark one pay group / structure as the default for employees who have none of their own.
function makeDefault(col, item) {
  update((d) => {
    d[col].forEach((x) => (x.isDefault = x.id === item.id));
  });
  toast(`${item.name} is now the default`);
}

function PayGroups({ db }) {
  const [editing, setEditing] = useState(null);
  const [members, setMembers] = useState(null);
  const groups = db.payGroups || [];
  const inGroup = (g, activeOnly = true) => db.employees.filter((e) => (!activeOnly || e.status !== 'Exited') && payGroupOf(db, e)?.id === g.id);

  const remove = (g) => {
    if (groups.length <= 1) return toast('At least one pay group is needed.', 'error');
    if (g.isDefault) return toast('This is the default pay group. Make another group the default first.', 'error');
    const n = inGroup(g, false).length;
    if (n > 0) return toast(`${n} employee(s) are in ${g.name}. Move them to another pay group first (Members).`, 'error');
    if (!confirmAction(`Delete the pay group ${g.name}?`)) return;
    update((d) => {
      d.payGroups = d.payGroups.filter((x) => x.id !== g.id);
    });
    toast('Pay group deleted');
  };
  const save = (v) => {
    // Leave the id out when adding: an `id: undefined` would overwrite the one addItem makes.
    const { id: _unused, isDefault: _d, ...data } = v;
    ['lockDay', 'pfCeiling', 'ptAmount', 'lwfEmployee', 'lwfEmployer'].forEach((k) => {
      if (data[k] !== '' && data[k] !== undefined) data[k] = Number(data[k]);
    });
    if (editing.id) patchItem('payGroups', editing.id, data);
    else addItem('payGroups', data);
    setEditing(null);
    toast('Pay group saved');
  };
  const saveMembers = (v) => {
    const sel = v.members || [];
    const fallback = groups.find((x) => x.id !== members.id)?.id;
    update((d) => {
      d.employees.forEach((e) => {
        if (e.status === 'Exited') return;
        if (sel.includes(e.id)) e.payGroupId = members.id;
        else if (payGroupOf(d, e)?.id === members.id && fallback) e.payGroupId = fallback;
      });
    });
    setMembers(null);
    toast('Members updated');
  };
  const statutory = (g) => [g.pfEnabled && 'PF', g.esiEnabled && 'ESI', g.ptEnabled && 'PT', g.lwfEnabled && 'LWF'].filter(Boolean).join(' · ') || 'None';

  return (
    <Panel
      title="Pay groups"
      right={
        <Btn small icon="plus" onClick={() => setEditing({ ...groupFromSettings(db.payrollSettings), id: undefined, name: '', description: '', structureId: (db.payStructures || [])[0]?.id })}>
          Add pay group
        </Btn>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        A pay group is a set of employees paid on the same terms: the same pay day and the same statutory deductions. All groups share the pay cycle.
      </p>
      <DataTable
        rows={groups}
        columns={[
          { key: 'name', label: 'Pay group', render: (g) => (<span>{g.name}{g.isDefault && <> <Badge tone="blue">Default</Badge></>}</span>) },
          { key: 'structure', label: 'Default structure', sortable: false, render: (g) => (db.payStructures || []).find((s) => s.id === g.structureId)?.name || '—' },
          { key: 'payDay', label: 'Pay day' },
          { key: 'stat', label: 'Statutory', sortable: false, render: statutory },
          { key: 'people', label: 'Employees', sortable: false, render: (g) => inGroup(g).length },
          {
            key: '_a',
            label: '',
            sortable: false,
            align: 'right',
            render: (g) => (
              <span className="row-actions">
                {!g.isDefault && (
                  <Btn kind="ghost" small onClick={() => makeDefault('payGroups', g)}>
                    Make default
                  </Btn>
                )}
                <Btn kind="ghost" small onClick={() => setMembers(g)}>
                  Members
                </Btn>
                <Btn kind="icon" icon="edit" title="Edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing({ ...g })} />
                <Btn kind="icon" icon="trash" title="Delete" aria-label={`Delete ${g.name}`} onClick={() => remove(g)} />
              </span>
            ),
          },
        ]}
      />
      {editing && <FormModal title={editing.id ? `Edit ${editing.name}` : 'Add pay group'} fields={GROUP_FIELDS} initial={editing} onClose={() => setEditing(null)} onSave={save} wide />}
      {members && (
        <FormModal
          title={`Members of ${members.name}`}
          fields={[{ key: 'members', label: 'Employees in this pay group', type: 'multiemployee', full: true, help: groups.length > 1 ? 'Anyone you untick moves to another pay group.' : '' }]}
          initial={{ members: inGroup(members).map((e) => e.id) }}
          onClose={() => setMembers(null)}
          onSave={saveMembers}
          wide
        />
      )}
    </Panel>
  );
}

const money0 = (n) => inr(n);

// Editor for one pay structure: the earning components and how each is worked out.
function StructureEditor({ db, st, onClose }) {
  const [v, setV] = useState(() => ({
    name: st.name || '',
    description: st.description || '',
    employerPf: st.employerPf !== false,
    gratuity: st.gratuity !== false,
    gratuityPct: st.gratuityPct ?? 4.81,
    components: (st.components || []).map((c) => ({ ...c })),
  }));
  const [sample, setSample] = useState(600000);
  const [error, setError] = useState('');
  const setComp = (i, ch) => setV((s) => ({ ...s, components: s.components.map((c, j) => (j === i ? { ...c, ...ch } : c)) }));
  const setHra = (i) => setV((s) => ({ ...s, components: s.components.map((c, j) => ({ ...c, role: j === 0 ? 'basic' : j === i ? (c.role === 'hra' ? '' : 'hra') : c.role === 'hra' ? '' : c.role })) }));
  const draft = { ...v, components: v.components.map((c, i) => ({ ...c, role: i === 0 ? 'basic' : c.role })) };
  const preview = salaryBreakup(Number(sample) || 0, { ...db.payrollSettings, pf: pfPolicy(db) }, draft);
  const balance = v.components.findIndex((c) => c.type === 'Balance');

  const validate = () => {
    if (!v.name.trim()) return 'Give the structure a name.';
    if ((db.payStructures || []).some((x) => x.id !== st.id && x.name.trim().toLowerCase() === v.name.trim().toLowerCase())) return 'Another structure already has that name.';
    if (!v.components.length) return 'Add at least one component.';
    if (v.components[0].type === 'Balance' || v.components[0].type === 'Percent of Basic') return 'The first component is Basic, so it must be a percent of CTC or a fixed amount.';
    const names = v.components.map((c) => c.name.trim().toLowerCase());
    if (names.some((n) => !n)) return 'Every component needs a name.';
    if (new Set(names).size !== names.length) return 'Two components have the same name.';
    if (v.components.filter((c) => c.type === 'Balance').length > 1) return 'Only one component can be the balance.';
    const bad = v.components.find((c) => c.type !== 'Balance' && (Number(c.value) < 0 || (c.type.startsWith('Percent') && Number(c.value) > 100) || c.value === '' || c.value === undefined));
    if (bad) return `Check the value of ${bad.name || 'a component'}.`;
    return '';
  };
  const save = () => {
    const err = validate();
    if (err) return setError(err);
    const components = v.components.map((c, i) => ({ id: c.id || uid('c'), name: c.name.trim(), type: c.type, value: c.type === 'Balance' ? 0 : Number(c.value), role: i === 0 ? 'basic' : c.role === 'hra' ? 'hra' : '' }));
    const data = { name: v.name.trim(), description: v.description, employerPf: v.employerPf, gratuity: v.gratuity, gratuityPct: Number(v.gratuityPct) || 0, components };
    if (st.id) patchItem('payStructures', st.id, data);
    else addItem('payStructures', data);
    toast('Pay structure saved');
    onClose();
  };

  return (
    <Modal
      title={st.id ? `Edit ${st.name}` : 'Add pay structure'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn kind="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={save}>Save structure</Btn>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ps_name">
            Structure name<span className="req">*</span>
          </label>
          <input id="ps_name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ps_desc">Description</label>
          <input id="ps_desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={v.employerPf} onChange={(e) => setV({ ...v, employerPf: e.target.checked })} /> Employer PF is part of the CTC (untick if the company pays it on top)
        </label>
        <label className="check">
          <input type="checkbox" checked={v.gratuity} onChange={(e) => setV({ ...v, gratuity: e.target.checked })} /> Gratuity is part of the CTC
        </label>
        {v.gratuity && (
          <div className="field">
            <label htmlFor="ps_grat">Gratuity (% of basic)</label>
            <input id="ps_grat" type="number" step="0.01" value={v.gratuityPct} onChange={(e) => setV({ ...v, gratuityPct: e.target.value })} />
          </div>
        )}
      </div>

      <h4 className="form-section" style={{ marginTop: 16 }}>
        Earning components
      </h4>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Component</th>
              <th>How it is worked out</th>
              <th>Value</th>
              <th title="Used for the HRA exemption under the old tax regime">HRA</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {v.components.map((c, i) => (
              <tr key={c.id || i}>
                <td data-label="Component">
                  <input className="input-sm" aria-label={`Component ${i + 1} name`} value={c.name} disabled={i === 0} onChange={(e) => setComp(i, { name: e.target.value })} />
                </td>
                <td data-label="How it is worked out">
                  <select className="select-sm" aria-label={`${c.name || 'Component'} type`} value={c.type} onChange={(e) => setComp(i, { type: e.target.value })}>
                    {COMPONENT_TYPES.filter((t) => i > 0 || (t !== 'Balance' && t !== 'Percent of Basic')).map((t) => (
                      <option key={t} value={t}>
                        {{ 'Percent of CTC': '% of CTC', 'Percent of Basic': '% of Basic', Fixed: 'Fixed per month', Balance: 'Balance of CTC' }[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Value">
                  {c.type === 'Balance' ? (
                    <span className="pr-muted">the rest</span>
                  ) : (
                    <input className="input-sm" type="number" min="0" step="any" aria-label={`${c.name || 'Component'} value`} value={c.value ?? ''} onChange={(e) => setComp(i, { value: e.target.value })} />
                  )}
                </td>
                <td data-label="HRA">{i > 0 ? <input type="checkbox" aria-label={`${c.name} is HRA`} checked={c.role === 'hra'} onChange={() => setHra(i)} /> : '—'}</td>
                <td>{i > 0 && <Btn kind="icon" icon="trash" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => setV((s) => ({ ...s, components: s.components.filter((_, j) => j !== i) }))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <Btn kind="ghost" small icon="plus" onClick={() => setV((s) => ({ ...s, components: [...s.components, { id: uid('c'), name: '', type: 'Fixed', value: 0, role: '' }] }))}>
          Add component
        </Btn>
      </div>

      <h4 className="form-section" style={{ marginTop: 16 }}>
        Check with a sample salary
      </h4>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="ps_sample">Annual CTC</label>
        <input id="ps_sample" type="number" value={sample} onChange={(e) => setSample(e.target.value)} />
      </div>
      <table className="pr-breakup" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Component</th>
            <th>Monthly</th>
            <th>Annual</th>
          </tr>
        </thead>
        <tbody>
          {[...preview.earnings, ...preview.employer].map(([k, x]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{money0(x)}</td>
              <td>{money0(x * 12)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Cost to company</td>
            <td>{money0(preview.monthly)}</td>
            <td>{money0(Number(sample) || 0)}</td>
          </tr>
        </tbody>
      </table>
      {(() => {
        const w = wageShare(preview.earnings, wagePolicy(db));
        return <p className={w.below ? 'pr-warn' : 'pr-muted'} style={{ marginTop: 10 }}>{`Wages are ${w.pct.toFixed(1)}% of pay at this CTC (rule: at least ${wagePolicy(db).minPct}%${wagePolicy(db).enabled === false ? ', switched off' : ''}).${w.below ? ' Raise basic or take components off the exclusion list in Settings > Wage rule.' : ''}`}</p>;
      })()}
      {balance >= 0 && preview.earnings[balance][1] === 0 && Number(sample) > 0 && <p className="pr-muted">The other components already use the whole CTC, so the balance component is zero.</p>}
      {balance < 0 && <p className="pr-muted">No balance component: gross pay may come out below the CTC less employer costs.</p>}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function PayStructures({ db }) {
  const [editing, setEditing] = useState(null);
  const list = db.payStructures || [];
  const users = (st) => db.employees.filter((e) => e.status !== 'Exited' && structureOf(db, e)?.id === st.id).length;
  const remove = (st) => {
    if (list.length <= 1) return toast('At least one pay structure is needed.', 'error');
    if (st.isDefault) return toast('This is the default pay structure. Make another structure the default first.', 'error');
    const groups = (db.payGroups || []).filter((g) => g.structureId === st.id);
    const people = db.employees.filter((e) => structureOf(db, e)?.id === st.id).length;
    if (groups.length || people) return toast(`${st.name} is used by ${groups.length ? `${groups.length} pay group(s)` : ''}${groups.length && people ? ' and ' : ''}${people ? `${people} employee(s)` : ''}. Move them to another structure first.`, 'error');
    if (!confirmAction(`Delete the pay structure ${st.name}?`)) return;
    update((d) => {
      d.payStructures = d.payStructures.filter((x) => x.id !== st.id);
    });
    toast('Pay structure deleted');
  };
  const duplicate = (st) => setEditing({ ...st, id: undefined, name: `${st.name} (copy)`, components: st.components.map((c) => ({ ...c, id: uid('c') })) });

  return (
    <Panel
      title="Pay structures"
      right={
        <Btn small icon="plus" onClick={() => setEditing({ ...structureFromSettings(db.payrollSettings), id: undefined, name: '', description: '' })}>
          Add pay structure
        </Btn>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        A pay structure says how a CTC is split into earning components. A pay group gives its employees a default structure, and a profile can pick a different one.
      </p>
      <DataTable
        rows={list}
        columns={[
          { key: 'name', label: 'Structure', render: (s) => (<span>{s.name}{s.isDefault && <> <Badge tone="blue">Default</Badge></>}</span>) },
          { key: 'components', label: 'Components', sortable: false, render: (s) => s.components.map((c) => c.name).join(', ') },
          { key: 'wages', label: 'Wages share', sortable: false, render: (s) => { const w = wageShare(salaryBreakup(1200000, { ...db.payrollSettings, pf: pfPolicy(db) }, s).earnings, wagePolicy(db)); return <span>{w.pct.toFixed(0)}% {w.below && <Badge tone="amber">Below {wagePolicy(db).minPct}%</Badge>}</span>; } },
          { key: 'pf', label: 'Employer PF', sortable: false, render: (s) => (s.employerPf === false ? 'No' : 'Yes') },
          { key: 'grat', label: 'Gratuity', sortable: false, render: (s) => (s.gratuity === false ? 'No' : `${s.gratuityPct ?? 4.81}% of basic`) },
          { key: 'people', label: 'Employees', sortable: false, render: users },
          {
            key: '_a',
            label: '',
            sortable: false,
            align: 'right',
            render: (s) => (
              <span className="row-actions">
                {!s.isDefault && (
                  <Btn kind="ghost" small onClick={() => makeDefault('payStructures', s)}>
                    Make default
                  </Btn>
                )}
                <Btn kind="ghost" small onClick={() => duplicate(s)}>
                  Duplicate
                </Btn>
                <Btn kind="icon" icon="edit" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ ...s })} />
                <Btn kind="icon" icon="trash" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => remove(s)} />
              </span>
            ),
          },
        ]}
      />
      {editing && <StructureEditor db={db} st={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// ---------- settings: gratuity on exit ----------
const GRATUITY_FIELDS = [
  { key: 'enabled', label: 'Use gratuity in this company', type: 'checkbox', help: 'Switch off if you do not give gratuity. Nothing is set aside in the CTC and nothing is paid on exit. Your settings below are kept.' },
  { key: 'eligibility', label: 'Who gets gratuity', type: 'select', options: [{ value: 'all', label: 'Everyone, once they have the years of service' }, { value: 'selected', label: 'Only the employees I choose' }], placeholder: 'Everyone', section: 'Who gets it', show: (v) => v.enabled !== false },
  { key: 'eligible', label: 'Employees who get gratuity', type: 'employeesearch', full: true, show: (v) => v.enabled !== false && v.eligibility === 'selected', help: 'Only the people added here have gratuity in their CTC and get it on exit. Anyone who joins later is left out until you add them here or set Gratuity applies on their profile. The years of service below still apply to them.' },
  { key: 'daysPerYear', label: 'Days of wages for each year of service', type: 'number', min: 1, section: 'Formula', help: 'The Act says 15.', show: (v) => v.enabled !== false },
  { key: 'monthDays', label: 'Days in a month for this calculation', type: 'number', min: 1, help: 'A month’s wages are divided by this to get a day’s wages. The Act says 26.', show: (v) => v.enabled !== false },
  { key: 'roundMonths', label: 'A part-year counts as a full year from (months)', type: 'number', min: 1, max: 12, help: '6 means 7 years 6 months is paid as 8 years. Use 12 to pay completed years only.', show: (v) => v.enabled !== false },
  { key: 'minYears', label: 'Years of service needed: permanent staff', type: 'number', min: 0, step: 0.5, section: 'Years of service needed', help: 'Nothing is paid below this. The Act says 5.', show: (v) => v.enabled !== false },
  { key: 'minYearsFixedTerm', label: 'Years of service needed: Contract (fixed-term) staff', type: 'number', min: 0, step: 0.5, help: 'Applies to anyone whose worker type is Contract.', show: (v) => v.enabled !== false },
  { key: 'cap', label: 'Most that can be paid (₹)', type: 'number', min: 0, section: 'Limit', help: 'The Act says ₹20,00,000. Enter 0 for no limit.', show: (v) => v.enabled !== false },
];

function GratuitySettings({ db }) {
  const saved = gratuityPolicy(db);
  // The list starts empty when everyone has gratuity; once "only chosen employees" is saved it holds those marked Yes.
  const eligibleNow = saved.eligibility === 'selected' ? db.employees.filter((e) => e.status !== 'Exited' && e.gratuityApplies === 'Yes').map((e) => e.id) : [];
  const [v, setV] = useState({ ...saved, eligible: eligibleNow });
  const [ex, setEx] = useState({ basic: 30000, years: 7.6 });
  const num = (k) => (k === 'enabled' ? v.enabled !== false : k === 'eligibility' ? (v.eligibility === 'selected' ? 'selected' : 'all') : v[k] === '' || v[k] === undefined ? GRATUITY_DEFAULTS[k] : Number(v[k]));
  const draft = Object.fromEntries(Object.keys(GRATUITY_DEFAULTS).map((k) => [k, num(k)]));
  const on = draft.enabled;
  const picked = v.eligible || [];
  const pickedChanged = draft.eligibility === 'selected' && (picked.length !== eligibleNow.length || picked.some((id) => !eligibleNow.includes(id)));
  const changed = Object.keys(GRATUITY_DEFAULTS).some((k) => draft[k] !== saved[k]) || pickedChanged;
  const isDefault = Object.keys(GRATUITY_DEFAULTS).every((k) => k === 'enabled' || k === 'eligibility' || draft[k] === GRATUITY_DEFAULTS[k]);
  const save = () => {
    if (on && (!(draft.daysPerYear > 0) || !(draft.monthDays > 0))) return toast('Days of wages and days in a month must be more than zero.', 'error');
    if (on && (draft.roundMonths < 1 || draft.roundMonths > 12)) return toast('The rounding month must be between 1 and 12.', 'error');
    if (on && (draft.minYears < 0 || draft.minYearsFixedTerm < 0 || draft.cap < 0)) return toast('Years and the limit cannot be negative.', 'error');
    update((d) => {
      d.payrollSettings.gratuityPolicy = draft;
      // The list is kept on each employee's profile (Gratuity applies), so the two always agree.
      if (on && draft.eligibility === 'selected') {
        d.employees.forEach((e) => {
          if (e.status === 'Exited') return;
          if (picked.includes(e.id)) e.gratuityApplies = 'Yes';
          else if (e.gratuityApplies === 'Yes') e.gratuityApplies = '';
        });
      }
    });
    setV({ ...draft, eligible: picked });
    toast('Gratuity settings saved');
  };
  const reset = () => setV({ ...GRATUITY_DEFAULTS, enabled: v.enabled !== false, eligibility: draft.eligibility, eligible: picked });
  const demoYears = Number(ex.years) || 0;
  const demoBasic = Number(ex.basic) || 0;
  const r = gratuityPayable(draft, demoBasic, demoYears, 'Permanent');
  const f = gratuityPayable(draft, demoBasic, demoYears, 'Contract');
  const accrual = ((draft.daysPerYear / draft.monthDays / 12) * 100).toFixed(2);
  return (
    <Panel
      title="Gratuity on exit"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the Act’s formula</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        {!on ? 'Gratuity is switched off. Nothing is set aside in the CTC and nothing is paid on exit. Your values below are kept for when you switch it on again.' : <>Gratuity paid in the full and final settlement = <strong>{draft.daysPerYear} ÷ {draft.monthDays} × last monthly basic × years of service</strong>
        {draft.cap > 0 ? <>, up to {money(draft.cap)}</> : <>, with no upper limit</>}. {draft.eligibility === 'selected' ? <>{picked.length ? `Only the ${picked.length} employee(s) chosen below get it. ` : 'No one is chosen yet, so no one gets it. Add employees below. '}</> : <>Everyone gets it. </>}It starts after {draft.minYears} year(s) of service, or {draft.minYearsFixedTerm} for Contract staff. {isDefault ? 'These are the standard values from the Payment of Gratuity Act.' : 'These differ from the Act’s standard values.'}</>}
      </p>
      <FormGrid fields={GRATUITY_FIELDS} values={v} setValues={setV} db={db} />
      {on && (
      <>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'basic', label: 'Monthly basic (₹)', type: 'number' }, { key: 'years', label: 'Years of service', type: 'number', step: 0.1 }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        Permanent: <strong>{money(Math.round(r.amount))}</strong> {r.amount ? `(${r.countedYears} years counted${r.capped ? ', limited by the cap' : ''})` : `(needs ${r.minYears} years)`}
        {' · '}
        Contract: <strong>{money(Math.round(f.amount))}</strong> {f.amount ? `(${f.countedYears} years counted${f.capped ? ', limited by the cap' : ''})` : `(needs ${f.minYears} years)`}
      </p>
      <p className="pr-muted" style={{ marginTop: 12 }}>
        The monthly amount set aside inside the CTC is separate. It is the percentage of basic on each Pay structure (the formula above works out to {accrual}%). An employee can also be switched off or on under Statutory on their profile.
      </p>
      </>
      )}
    </Panel>
  );
}

// ---------- settings: provident fund and ESI ----------
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
const PF_FIELDS = [
  { key: 'basis', label: 'PF is worked out on', type: 'select', options: [{ value: 'capped', label: 'Basic up to the wage ceiling' }, { value: 'actual', label: 'The full basic' }], section: 'Provident Fund', help: 'The company default. An employee can choose differently on their profile under Statutory.' },
  { key: 'employeeRate', label: 'Employee share (% of PF wage)', type: 'number', min: 0, max: 100, step: 0.01, section: 'Rates' },
  { key: 'employerRate', label: 'Employer share in all (% of PF wage)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'epsRate', label: 'Of this, pension fund / EPS (%)', type: 'number', min: 0, max: 100, step: 0.01, help: 'On wages up to the ceiling. The rest of the employer share goes to EPF.' },
  { key: 'edliRate', label: 'EDLI insurance, paid by employer (%)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'adminRate', label: 'EPF administration charge, paid by employer (%)', type: 'number', min: 0, max: 100, step: 0.01 },
  { key: 'adminMin', label: 'Administration charge: least for the whole month (₹)', type: 'number', min: 0 },
  { key: 'chargesInCtc', label: 'EDLI and administration charges come out of the CTC', type: 'checkbox', help: 'Off means the company pays them on top of the CTC and nobody’s pay changes. The employer’s PF share itself follows each pay structure (“Employer PF is part of the CTC”).' },
];
const ESI_FIELDS = [
  { key: 'enabled', label: 'Use ESI in this company', type: 'checkbox', help: 'Switch off if no one is covered. Your values below are kept. A pay group can also switch ESI off for its own people.' },
  { key: 'grossLimit', label: 'Covered if monthly wages are up to (₹)', type: 'number', min: 1, section: 'Who is covered', show: (v) => v.enabled !== false },
  { key: 'employeeRate', label: 'Employee share (% of wages)', type: 'number', min: 0, max: 100, step: 0.01, section: 'Rates', show: (v) => v.enabled !== false },
  { key: 'employerRate', label: 'Employer share (% of wages)', type: 'number', min: 0, max: 100, step: 0.01, show: (v) => v.enabled !== false },
  { key: 'periodStart1', label: 'First contribution period starts in', type: 'select', options: MONTH_OPTIONS, section: 'Contribution periods', show: (v) => v.enabled !== false },
  { key: 'periodStart2', label: 'Second contribution period starts in', type: 'select', options: MONTH_OPTIONS, help: 'Whether someone is covered is decided on their wages in the first month of the period they work in, and stays for the whole period even if pay rises past the limit. The law has April and October.', show: (v) => v.enabled !== false },
];

function PfEsiSettings({ db }) {
  const savedPf = pfPolicy(db);
  const savedEsi = esiPolicy(db);
  const [pf, setPf] = useState({ ...savedPf });
  const [esi, setEsi] = useState({ ...savedEsi, periodStart1: String(savedEsi.periodStart1), periodStart2: String(savedEsi.periodStart2) });
  const [ex, setEx] = useState({ basic: 30000 });
  const n = (x, d) => (x === '' || x === undefined || x === null ? d : Number(x));
  const pfDraft = {
    ...Object.fromEntries(['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate', 'adminMin'].map((k) => [k, n(pf[k], PF_DEFAULTS[k])])),
    basis: pf.basis === 'actual' ? 'actual' : 'capped',
    chargesInCtc: !!pf.chargesInCtc,
    rules: (pf.rules || []).map((r) => ({ from: r.from || '', ceiling: r.ceiling === '' ? '' : Number(r.ceiling) })),
  };
  const esiDraft = {
    enabled: esi.enabled !== false,
    ...Object.fromEntries(['grossLimit', 'employeeRate', 'employerRate'].map((k) => [k, n(esi[k], ESI_DEFAULTS[k])])),
    periodStart1: n(esi.periodStart1, ESI_DEFAULTS.periodStart1),
    periodStart2: n(esi.periodStart2, ESI_DEFAULTS.periodStart2),
  };
  const key = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const pfOnly = (o) => ({ ...Object.fromEntries(['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate', 'adminMin', 'basis', 'chargesInCtc'].map((k) => [k, o[k]])), rules: o.rules.map((r) => [r.from, r.ceiling]) });
  const esiOnly = (o) => Object.fromEntries(['enabled', 'grossLimit', 'employeeRate', 'employerRate'].map((k) => [k, o[k]]).concat([['periodStart1', Number(o.periodStart1)], ['periodStart2', Number(o.periodStart2)]]));
  const changed = key(pfOnly(pfDraft)) !== key(pfOnly(savedPf)) || key(esiOnly(esiDraft)) !== key(esiOnly(savedEsi));
  const isDefault = key(pfOnly(pfDraft)) === key(pfOnly(PF_DEFAULTS)) && key({ ...esiOnly(esiDraft), enabled: true }) === key(esiOnly(ESI_DEFAULTS));
  const setRule = (i, patch) => setPf({ ...pf, rules: pf.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () => {
    const bad = [...['employeeRate', 'employerRate', 'epsRate', 'edliRate', 'adminRate'].map((k) => pfDraft[k]), esiDraft.employeeRate, esiDraft.employerRate].some((x) => !(x >= 0 && x <= 100));
    if (bad) return toast('Every rate must be between 0 and 100.', 'error');
    if (pfDraft.epsRate > pfDraft.employerRate) return toast('The pension share cannot be more than the employer share.', 'error');
    if (pfDraft.adminMin < 0) return toast('The minimum administration charge cannot be negative.', 'error');
    if (!pfDraft.rules.length || pfDraft.rules.some((r) => !r.from || !(r.ceiling > 0))) return toast('Every wage ceiling needs a date and an amount.', 'error');
    if (new Set(pfDraft.rules.map((r) => r.from)).size !== pfDraft.rules.length) return toast('Two wage ceilings start on the same day.', 'error');
    if (esiDraft.enabled && !(esiDraft.grossLimit > 0)) return toast('The ESI wage limit must be more than zero.', 'error');
    const rules = [...pfDraft.rules].sort((a, b) => a.from.localeCompare(b.from));
    update((d) => {
      d.payrollSettings.pfPolicy = { ...pfDraft, rules };
      d.payrollSettings.esiPolicy = esiDraft;
    });
    setPf({ ...pfDraft, rules });
    toast('PF and ESI settings saved');
  };
  const reset = () => {
    setPf({ ...PF_DEFAULTS, rules: PF_DEFAULTS.rules.map((r) => ({ ...r })) });
    setEsi({ ...ESI_DEFAULTS, enabled: esi.enabled !== false, periodStart1: String(ESI_DEFAULTS.periodStart1), periodStart2: String(ESI_DEFAULTS.periodStart2) });
  };
  const demoBasic = Number(ex.basic) || 0;
  const today = pfCeilingOn(pfDraft);
  const sample = pfOf(pfDraft, { basic: demoBasic, ceiling: today, basis: pfDraft.basis });
  return (
    <Panel
      title="Provident Fund and ESI"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the statutory values</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        The values start as the ones the law sets and you can change any of them. Months already locked keep the figures they were paid with. Who is covered is set per pay group (Pay groups) and per employee (profile, Statutory).
      </p>
      <FormGrid fields={PF_FIELDS} values={pf} setValues={setPf} db={db} />
      <h4 className="form-section" style={{ marginTop: 18 }}>PF wage ceiling over time</h4>
      <p className="pr-muted" style={{ marginBottom: 10 }}>
        The ceiling that applies from each date. A pay cycle that holds the day a new ceiling starts uses each day’s own ceiling and the average of them. In force today: <strong>{money(today)}</strong>. A pay group can set a ceiling of its own instead.
      </p>
      {(pf.rules || []).map((r, i) => (
        <div className="row" key={i} style={{ gap: 12, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 170 }}>
            <label>From</label>
            <input type="date" value={r.from || ''} onChange={(e) => setRule(i, { from: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label>Wage ceiling (₹)</label>
            <input type="number" min="1" value={r.ceiling ?? ''} onChange={(e) => setRule(i, { ceiling: e.target.value === '' ? '' : Number(e.target.value) })} />
          </div>
          <Btn kind="icon" icon="trash" title="Remove" aria-label="Remove this ceiling" disabled={(pf.rules || []).length <= 1} onClick={() => setPf({ ...pf, rules: pf.rules.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Btn kind="ghost" small icon="plus" onClick={() => setPf({ ...pf, rules: [...(pf.rules || []), { from: '', ceiling: '' }] })}>Add a ceiling</Btn>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'basic', label: 'Monthly basic (₹)', type: 'number' }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        PF wage <strong>{money(sample.wage)}</strong>. Employee <strong>{money(Math.round(sample.employee))}</strong>. Employer <strong>{money(Math.round(sample.employer))}</strong> = EPS {money(Math.round(sample.eps))} + EPF {money(Math.round(sample.employer) - Math.round(sample.eps))}. EDLI {money(Math.round(sample.edli))}, administration {money(Math.round(sample.admin))}.
      </p>
      <h4 className="form-section" style={{ marginTop: 22 }}>Employees’ State Insurance</h4>
      <FormGrid fields={ESI_FIELDS} values={esi} setValues={setEsi} db={db} />
    </Panel>
  );
}

// ---------- settings: who approves payroll ----------
const APPROVAL_FIELDS = [
  { key: 'separate', label: 'A different person approves payroll', type: 'checkbox', help: 'Off: whoever processes payroll can lock it, and an admin can unlock it by giving a reason. On: the person who processes submits it, and someone else approves it. Approval is what locks the month, and unlocking also needs their approval.' },
  { key: 'approvers', label: 'Payroll approvers', type: 'employeesearch', full: true, show: (v) => !!v.separate, help: 'Anyone can be chosen, not only admins. Leave it empty to let every admin approve. The person who submitted a month or asked to unlock it can never be the one to approve it.' },
];

function ApprovalSettings({ db, user }) {
  const saved = approvalPolicy(db);
  const [v, setV] = useState({ separate: saved.separate, approvers: saved.approvers });
  const same = (a, b) => !!a.separate === !!b.separate && JSON.stringify([...(a.approvers || [])].sort()) === JSON.stringify([...(b.approvers || [])].sort());
  const save = () => {
    let res;
    update((d) => {
      res = saveApprovalSettings(d, user, v);
    });
    if (!res.ok) return toast(res.error, 'error');
    toast('Approval settings saved');
  };
  const pending = (db.payrollRuns || []).filter((r) => r.status === 'Submitted').length;
  const eligible = approverIds({ ...db, payrollSettings: { ...db.payrollSettings, approval: { separate: true, approvers: v.approvers || [] } } });
  return (
    <Panel title="Payroll approval" right={<Btn small onClick={save} disabled={same(v, saved)}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        {v.separate ? <>Payroll is submitted by the person who processes it and locked when an approver approves it. Approvers: <strong>{eligible.map((id) => fullName(empById(db, id))).join(', ') || 'none'}</strong>{(v.approvers || []).length === 0 ? ' (every admin)' : ''}. Each approver gets an item in their Inbox.</> : 'Payroll is locked directly by whoever processes it. Admins have full access, and unlocking asks for a reason that is logged.'}
      </p>
      {saved.separate && !v.separate && pending > 0 && <p className="pr-warn" style={{ marginBottom: 12 }}>{pending} month(s) are waiting for approval. Switching approval off sends them back to Processed so they can be locked directly.</p>}
      <FormGrid fields={APPROVAL_FIELDS} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: Professional Tax and Labour Welfare Fund ----------
const LWF_FIELDS = [
  { key: 'frequency', label: 'Paid', type: 'select', options: [{ value: 'yearly', label: 'Once a year' }, { value: 'half-yearly', label: 'Twice a year (half-yearly)' }], section: 'Labour Welfare Fund', help: 'The amounts are set on each pay group. They are taken only in the months below, not every month.' },
  { key: 'month', label: 'Taken in', type: 'select', options: MONTH_OPTIONS, help: 'Tamil Nadu: yearly, due by 31 January, so December payroll. For half-yearly this is the second of the two months and the other is six months before it.' },
];

function PtLwfSettings({ db }) {
  const savedPt = ptPolicy(db);
  const state = savedPt.defaultState;
  const [slabs, setSlabs] = useState((savedPt.states[state]?.slabs || []).map((r) => ({ ...r })));
  const savedLwf = lwfPolicy(db);
  const [lwf, setLwf] = useState({ frequency: savedLwf.frequency, month: String(savedLwf.month) });
  const [ex, setEx] = useState({ gross: 40000 });
  const clean = slabs.map((r) => ({ upTo: r.upTo === '' || r.upTo === null || r.upTo === undefined ? null : Number(r.upTo), amount: Number(r.amount) || 0 }));
  const lwfDraft = { frequency: lwf.frequency === 'half-yearly' ? 'half-yearly' : 'yearly', month: Number(lwf.month) || 12 };
  const key = (o) => JSON.stringify(o);
  const changed = key(clean) !== key(savedPt.states[state]?.slabs || []) || key(lwfDraft) !== key({ frequency: savedLwf.frequency, month: Number(savedLwf.month) });
  const isDefault = key(clean) === key(PT_DEFAULTS.states['Tamil Nadu'].slabs) && key(lwfDraft) === key(LWF_DEFAULTS);
  const set = (i, patch) => setSlabs(slabs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const limited = clean.filter((r) => r.upTo !== null);
    if (!clean.length) return toast('Add at least one slab.', 'error');
    if (clean.some((r) => r.amount < 0 || (r.upTo !== null && !(r.upTo > 0)))) return toast('Amounts and limits must be positive.', 'error');
    if (limited.some((r, i) => i > 0 && r.upTo <= limited[i - 1].upTo)) return toast('Each limit must be higher than the one before.', 'error');
    if (clean.findIndex((r) => r.upTo === null) !== -1 && clean.findIndex((r) => r.upTo === null) !== clean.length - 1) return toast('The slab with no limit must be the last one.', 'error');
    update((d) => {
      const cur = ptPolicy(d);
      d.payrollSettings.ptPolicy = { defaultState: cur.defaultState, states: { ...cur.states, [cur.defaultState]: { slabs: clean } } };
      d.payrollSettings.lwfPolicy = lwfDraft;
    });
    toast('PT and LWF settings saved');
  };
  const reset = () => {
    setSlabs(PT_DEFAULTS.states['Tamil Nadu'].slabs.map((r) => ({ ...r })));
    setLwf({ frequency: LWF_DEFAULTS.frequency, month: String(LWF_DEFAULTS.month) });
  };
  const preview = { ...savedPt, states: { ...savedPt.states, [state]: { slabs: clean } } };
  const g = Number(ex.gross) || 0;
  const half = ptHalfYear(preview, state, g);
  return (
    <Panel
      title="Professional Tax and Labour Welfare Fund"
      right={
        <span className="row">
          <Btn kind="ghost" small onClick={reset} disabled={isDefault}>Use the Tamil Nadu values</Btn>
          <Btn small onClick={save} disabled={!changed}>Save</Btn>
        </span>
      }
    >
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        Professional Tax for <strong>{state}</strong> (the company’s state) is charged on half-yearly income and taken monthly: a sixth of the half-yearly amount each month, with September and March making the total exact. Check the slab amounts with your CA. Months already locked keep what they were paid with. An employee who works in another state can be given a work state on their profile once that state’s slabs are added.
      </p>
      <h4 className="form-section">Slabs — half-yearly income</h4>
      {slabs.map((r, i) => (
        <div className="row" key={i} style={{ gap: 12, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Income up to (₹)</label>
            <input type="number" min="1" placeholder="No limit" value={r.upTo ?? ''} onChange={(e) => set(i, { upTo: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Tax for the half-year (₹)</label>
            <input type="number" min="0" value={r.amount ?? ''} onChange={(e) => set(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })} />
          </div>
          <Btn kind="icon" icon="trash" title="Remove" aria-label="Remove this slab" disabled={slabs.length <= 1} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Btn kind="ghost" small icon="plus" onClick={() => setSlabs([...slabs, { upTo: '', amount: '' }])}>Add a slab</Btn>
      <h4 className="form-section" style={{ marginTop: 18 }}>Try it</h4>
      <FormGrid fields={[{ key: 'gross', label: 'Monthly gross (₹)', type: 'number' }]} values={ex} setValues={setEx} db={db} />
      <p style={{ marginTop: 10 }}>
        Half-yearly income <strong>{money(g * 6)}</strong> → tax for the half-year <strong>{money(half)}</strong>. Deducted <strong>{money(ptMonthly(preview, state, g, '2026-11'))}</strong> a month, and <strong>{money(ptMonthly(preview, state, g, '2027-03'))}</strong> in September and March.
      </p>
      <FormGrid fields={LWF_FIELDS} values={lwf} setValues={setLwf} db={db} />
    </Panel>
  );
}

// ---------- settings: the wage rule ----------
function WageRuleSettings({ db }) {
  const saved = wagePolicy(db);
  const names = [...new Set([...(db.payStructures || []).flatMap((st) => st.components.slice(1).map((c) => c.name)), ...saved.exclusions])];
  const [v, setV] = useState({ enabled: saved.enabled !== false, minPct: saved.minPct, exclusions: [...saved.exclusions] });
  const draft = { enabled: !!v.enabled, minPct: v.minPct === '' ? '' : Number(v.minPct), exclusions: v.exclusions || [] };
  const changed = JSON.stringify(draft) !== JSON.stringify({ enabled: saved.enabled !== false, minPct: saved.minPct, exclusions: saved.exclusions });
  const save = () => {
    if (draft.enabled && !(draft.minPct > 0 && draft.minPct <= 100)) return toast('The share must be between 1 and 100.', 'error');
    update((d) => {
      d.payrollSettings.wagePolicy = { ...draft, minPct: draft.minPct === '' ? WAGE_DEFAULTS.minPct : draft.minPct };
    });
    toast('Wage rule saved');
  };
  const fields = [
    { key: 'enabled', label: 'Warn when wages are below the share', type: 'checkbox', help: 'The labour codes want wages (basic and similar pay) to be at least a set share of total pay. A pay structure that falls short is flagged. Nothing is blocked.' },
    { key: 'minPct', label: 'Wages must be at least this share of total pay (%)', type: 'number', min: 1, max: 100, show: (x) => x.enabled },
    { key: 'exclusions', label: 'Pay components that are not counted as wages', type: 'multiselect', full: true, options: names.map((n) => ({ value: n, label: n })), show: (x) => x.enabled, help: 'Basic always counts. Tick the allowances the law lets you leave out of wages (for example HRA or conveyance). Components you add to a pay structure later appear here.' },
  ];
  return (
    <Panel title="Wage rule" right={<Btn small onClick={save} disabled={!changed}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        Total pay is the earnings in a pay structure; employer PF and gratuity are not part of it. This only warns for now: PF and gratuity are still worked out on basic, as set under PF & ESI and Gratuity. The Pay structures tab shows each structure’s wages share at ₹12 lakh CTC.
      </p>
      <FormGrid fields={fields} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: full and final ----------
const EXIT_FIELDS = [
  { key: 'encashEnabled', label: 'Pay out unused leave on exit', type: 'checkbox', section: 'Leave encashment', help: 'Applies to the leave types marked encashable under Leave settings.' },
  { key: 'encashBasis', label: 'A day’s pay is worked out from', type: 'select', options: [{ value: 'basic', label: 'Basic' }, { value: 'gross', label: 'Gross pay' }], show: (v) => v.encashEnabled },
  { key: 'encashDivisor', label: 'Divided by this many days a month', type: 'number', min: 1, show: (v) => v.encashEnabled },
  { key: 'encashMaxDays', label: 'Most days paid out (0 for no limit)', type: 'number', min: 0, show: (v) => v.encashEnabled },
  { key: 'noticeBasis', label: 'A day’s pay is worked out from', type: 'select', options: [{ value: 'basic', label: 'Basic' }, { value: 'gross', label: 'Gross pay' }], section: 'Notice shortfall recovery', help: 'Taken when someone leaves before their notice period ends. An admin can waive it for an exit.' },
  { key: 'noticeDivisor', label: 'Divided by this many days a month', type: 'number', min: 1 },
  { key: 'noticeCapDays', label: 'Most days recovered (0 for no limit)', type: 'number', min: 0 },
];
function ExitSettings({ db }) {
  const saved = exitPolicy(db);
  const [v, setV] = useState({ ...saved });
  const num = (k) => (v[k] === '' || v[k] === undefined ? EXIT_DEFAULTS[k] : Number(v[k]));
  const draft = { encashEnabled: !!v.encashEnabled, encashBasis: v.encashBasis === 'gross' ? 'gross' : 'basic', encashDivisor: num('encashDivisor'), encashMaxDays: num('encashMaxDays'), noticeBasis: v.noticeBasis === 'basic' ? 'basic' : 'gross', noticeDivisor: num('noticeDivisor'), noticeCapDays: num('noticeCapDays') };
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = () => {
    if (!(draft.encashDivisor > 0) || !(draft.noticeDivisor > 0)) return toast('Days in a month must be more than zero.', 'error');
    if (draft.encashMaxDays < 0 || draft.noticeCapDays < 0) return toast('Limits cannot be negative.', 'error');
    update((d) => {
      d.payrollSettings.exitPolicy = draft;
    });
    toast('Full and final settings saved');
  };
  return (
    <Panel title="Full and final settlement" right={<span className="row"><Btn kind="ghost" small onClick={() => setV({ ...EXIT_DEFAULTS })} disabled={JSON.stringify(draft) === JSON.stringify(EXIT_DEFAULTS)}>Use the standard values</Btn><Btn small onClick={save} disabled={!changed}>Save</Btn></span>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        How leave encashment and notice recovery are worked out when someone leaves. Gratuity has its own tab. Settlements that are already added to payroll keep their amounts.
      </p>
      <FormGrid fields={EXIT_FIELDS} values={v} setValues={setV} db={db} />
    </Panel>
  );
}

// ---------- settings: payslip email ----------
const MAIL_FIELDS = [
  { key: 'enabled', label: 'The mail service is connected', type: 'checkbox', section: 'Mail service (SMTP)', help: 'Tick this once SMTP is set up. Until then payslips wait in the outbox below and nothing is sent. The SMTP password is not stored here; it belongs with the mail service.' },
  { key: 'host', label: 'SMTP server' },
  { key: 'port', label: 'Port', type: 'number' },
  { key: 'security', label: 'Security', type: 'select', options: ['STARTTLS', 'SSL/TLS', 'None'] },
  { key: 'user', label: 'User name' },
  { key: 'fromName', label: 'Sent from (name)', section: 'Message' },
  { key: 'fromEmail', label: 'Sent from (email)', type: 'email' },
  { key: 'subject', label: 'Subject', full: true, help: 'Use {month} and {name}.' },
  { key: 'body', label: 'Message', type: 'textarea', full: true, help: 'Use {month} and {name}. The payslip is attached as a PDF that opens with the employee number followed by the date of birth (DDMMYYYY).' },
];
function MailSettings({ db }) {
  const saved = mailSettings(db);
  const [v, setV] = useState({ ...saved });
  const changed = JSON.stringify({ ...saved, port: Number(v.port) || saved.port }) !== JSON.stringify({ ...v, port: Number(v.port) || saved.port }) || JSON.stringify(v) !== JSON.stringify(saved);
  const save = () => {
    update((d) => {
      d.payrollSettings.mail = { ...MAIL_DEFAULTS, ...v, port: Number(v.port) || 587 };
    });
    toast('Payslip email settings saved');
  };
  const outbox = db.payslipOutbox || [];
  const waiting = outbox.filter((x) => x.status !== 'Sent').length;
  return (
    <Panel title="Payslip email" right={<Btn small onClick={save} disabled={!changed}>Save</Btn>}>
      <p className="pr-muted" style={{ marginBottom: 12 }}>
        When payroll is released, each employee’s payslip is put in the outbox below, to be emailed as a password-protected PDF. {smtpReady(saved) ? 'The mail service is marked as connected, so new payslips are queued for sending.' : 'The mail service is not connected yet, so they wait in the outbox. Nothing is sent from the browser.'} {waiting} waiting.
      </p>
      <FormGrid fields={MAIL_FIELDS} values={v} setValues={setV} db={db} />
      <h4 className="form-section" style={{ marginTop: 18 }}>Outbox</h4>
      <DataTable
        rows={outbox.slice(0, 100)}
        empty="Nothing in the outbox yet. Payslips are added when you release payroll."
        pageSize={10}
        columns={[
          { key: 'emp', label: 'Employee', sortable: false, render: (x) => fullName(empById(db, x.empId)) },
          { key: 'to', label: 'To' },
          { key: 'month', label: 'Payslip for', render: (x) => monthLabel(x.month) },
          { key: 'status', label: 'Status', render: (x) => <Badge tone={x.status === 'Sent' ? 'green' : x.status === 'No email address' ? 'red' : 'amber'}>{x.status}</Badge> },
        ]}
      />
    </Panel>
  );
}

export function PayrollSettings({ db, user }) {
  const [tab, setTab] = useState('cycle');
  const [v, setV] = useState({ cycleStartDay: db.payrollSettings.cycleStartDay });
  const save = () => {
    update((d) => (d.payrollSettings.cycleStartDay = Math.min(28, Math.max(1, Number(v.cycleStartDay) || 1))));
    toast('Pay cycle saved');
  };
  return (
    <div className="pr-stack">
      <Tabs tabs={[{ key: 'cycle', label: 'Pay cycle' }, { key: 'groups', label: 'Pay groups' }, { key: 'structures', label: 'Pay structures' }, { key: 'pfesi', label: 'PF & ESI' }, { key: 'ptlwf', label: 'PT & LWF' }, { key: 'wage', label: 'Wage rule' }, { key: 'exit', label: 'Full & final' }, { key: 'mail', label: 'Payslip email' }, { key: 'gratuity', label: 'Gratuity' }, { key: 'approval', label: 'Approval' }]} active={tab} onChange={setTab} />
      {tab === 'cycle' && (
        <Panel title="Pay cycle" right={<Btn small onClick={save}>Save</Btn>}>
          <FormGrid fields={[{ key: 'cycleStartDay', label: 'Pay cycle starts on day', type: 'number', min: 1, max: 28, help: '26 means November payroll covers 26 Oct – 25 Nov. Use 1 for calendar months. Attendance uses the same cycle, so it is also shown in Attendance settings.' }]} values={v} setValues={setV} db={db} />
          <p className="pr-muted" style={{ marginTop: 12 }}>
            Pay day, statutory deductions and the salary split are set per pay group and pay structure.
          </p>
        </Panel>
      )}
      {tab === 'groups' && <PayGroups db={db} />}
      {tab === 'structures' && <PayStructures db={db} />}
      {tab === 'pfesi' && <PfEsiSettings db={db} />}
      {tab === 'ptlwf' && <PtLwfSettings db={db} />}
      {tab === 'wage' && <WageRuleSettings db={db} />}
      {tab === 'exit' && <ExitSettings db={db} />}
      {tab === 'mail' && <MailSettings db={db} />}
      {tab === 'gratuity' && <GratuitySettings db={db} />}
      {tab === 'approval' && <ApprovalSettings db={db} user={user} />}
    </div>
  );
}


export default PayrollSettings;
