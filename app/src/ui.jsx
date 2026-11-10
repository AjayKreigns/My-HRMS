// Shared UI building blocks: icons, cards, tables, forms, dialogs and toasts.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDB, addItem, patchItem, removeItem } from './store.js';
import { fullName, initials, fmtDate, activeEmployees } from './utils.js';

const PATHS = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm0 0h5l1 3h6l1-3h5',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6 6 0 0 1 4 6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 0V6a2 2 0 0 1 2-2h11v3M16 13.5h2',
  org: 'M9 3h6v5H9zM3 16h6v5H3zm12 0h6v5h-6zM12 8v4M6 16v-4h12v4',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.5a7.5 7.5 0 0 0-2 1.2l-2.5-1-2 3.5 2.1 1.6a7.4 7.4 0 0 0 0 2.4l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2-1.2l2.5 1 2-3.5-2.1-1.6c.1-.4.1-.8.1-1.2z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2',
  calendar: 'M4 5h16v16H4zm0 5h16M8 3v4m8-4v4',
  plane: 'M10.5 21l1.5-6-6-1-2 2-1-1 2-4-3-2 1-1 4 1 4-5c1-1 3-2 3.5-1.5S17 6 16 7l-5 4 1 4-1 1-2-3-4 2z',
  briefcase: 'M3 8h18v12H3zm6-3h6v3H9zM3 13h18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01',
  book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zm16 0h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.5-4.5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4h4',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zm9-13l4 4',
  trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11m-5-5l5 5 5-5M4 20h16',
  upload: 'M12 16V5m-5 5l5-5 5 5M4 20h16',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  message: 'M4 5h16v11H8l-4 4z',
  file: 'M6 3h8l5 5v13H6zm8 0v5h5',
  laptop: 'M5 5h14v10H5zM2 19h20',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm-4 0l-1 7 5-3 5 3-1-7',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  hire: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21a7 7 0 0 1 11-5.7M18 14v7m-3.5-3.5h7',
  money: 'M3 6h18v12H3zm9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-12v4l2 2M9 2h6',
  key: 'M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l6.1-6.1A4 4 0 0 1 15 7z',
  folder: 'M3 6h6l2 2h10v11H3z',
  pin: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  mail: 'M3 5h18v14H3zm0 0l9 8 9-8',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  gift: 'M3 9h18v4H3zm2 4h14v8H5zm7-4v12M12 9S10 3 7.5 4.5 9 9 12 9zm0 0s2-6 4.5-4.5S15 9 12 9z',
  megaphone: 'M3 10v4h4l8 5V5L7 10zm15-1a3 3 0 0 1 0 6',
  poll: 'M5 20V12m7 8V4m7 16v-9',
  calc: 'M4 7h6M7 4v6M14 7h6M4 17h6M14 15h6m-6 4h6M5 14l4 4m0-4l-4 4',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9',
  userPlus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M19 8v6m-3-3h6',
  userCheck: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 11l2 2 4-4',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2m-1.5-4.5L12 19l2.5-2.5V13l5-5A6 6 0 0 0 21 3a6 6 0 0 0-5 1.5l-5 5H7.5L5 12zM15 9.5a.5.5 0 1 0 0-1',
  alert: 'M12 3l10 18H2zm0 7v4m0 3v.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-10v6m0-9v.01',
  external: 'M8 16L17 7m-7 0h7v7',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  chat: 'M4 5h16v11H9l-5 4zm4 5h.01M12 10h.01M16 10h.01',
  arrowUp: 'M7 14l5-5 5 5',
};

export function Icon({ name, size = 18, className = '', style }) {
  return (
    <svg className={`icon ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.file} />
    </svg>
  );
}

export function Avatar({ emp, size = 32 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: emp?.color || '#94a3b8' }} title={fullName(emp)}>
      {initials(emp)}
    </span>
  );
}

export function EmpChip({ emp, sub, onClick }) {
  if (!emp) return <span className="muted">—</span>;
  return (
    <span className={`emp-chip ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <Avatar emp={emp} size={28} />
      <span>
        <span className="emp-chip-name">{fullName(emp)}</span>
        {sub !== false && <span className="emp-chip-sub">{sub || emp.designation}</span>}
      </span>
    </span>
  );
}

const STATUS_TONE = {
  Approved: 'green', Active: 'green', Completed: 'green', Paid: 'green', Present: 'green', 'On track': 'green', Hired: 'green', Resolved: 'green', Closed: 'grey', Open: 'blue', Submitted: 'blue', Finalized: 'blue', Scheduled: 'blue', 'In progress': 'blue', Sent: 'blue', Interview: 'blue', Screening: 'blue', Applied: 'grey', Offer: 'purple', Accepted: 'green',
  Pending: 'amber', Draft: 'grey', 'Manager review pending': 'amber', Behind: 'amber', 'On hold': 'amber', Probation: 'amber', 'Pre-boarding': 'purple', 'Notice period': 'amber', WFH: 'purple', Leave: 'amber', Holiday: 'blue', 'Weekly off': 'grey',
  Rejected: 'red', Cancelled: 'grey', Absent: 'red', Exited: 'grey', 'At risk': 'red', Declined: 'red', High: 'red', Medium: 'amber', Low: 'grey', Urgent: 'red', Settled: 'green', 'Not clocked in': 'grey', Returned: 'grey',
};
export function Badge({ children, tone }) {
  const t = tone || STATUS_TONE[children] || 'grey';
  return <span className={`badge badge-${t}`}>{children}</span>;
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="page-head-actions">{children}</div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const key = typeof t === 'string' ? t : t.key;
        const label = typeof t === 'string' ? t : t.label;
        return (
          <button key={key} role="tab" aria-selected={active === key} className={`tab ${active === key ? 'active' : ''}`} onClick={() => onChange(key)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? 'stat-' + tone : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ text = 'Nothing here yet.', icon = 'folder' }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p>{text}</p>
    </div>
  );
}

export function Btn({ children, kind = 'primary', icon, small, ...rest }) {
  return (
    <button type="button" className={`btn btn-${kind} ${small ? 'btn-sm' : ''}`} {...rest}>
      {icon && <Icon name={icon} size={small ? 14 : 16} />}
      {children}
    </button>
  );
}

// ---------- toasts ----------
let pushToast = () => {};
export function toast(text, tone = 'ok') {
  pushToast({ id: Math.random(), text, tone });
}
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((s) => [...s, t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 3200);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Portal to <body>: page containers use transform animations, which would otherwise
  // trap position:fixed and clip the dialog to the page content box.
  let dark = false;
  try {
    dark = localStorage.getItem('ifluids-hrms-theme') === 'dark';
  } catch {
    /* storage blocked: default to light */
  }
  return createPortal(
    <div style={{ display: 'contents' }} className={dark ? 'theme-dark' : 'theme-light'}>
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
    </div>,
    document.body
  );
}

export function confirmAction(text) {
  return window.confirm(text);
}

// ---------- form fields ----------
// field: { key, label, type, options, required, placeholder, full, section, help, min, max, step, show(values) }
function resolveOptions(field, db, values) {
  let opts = typeof field.options === 'function' ? field.options(db, values) : field.options || [];
  if (field.type === 'employee') opts = activeEmployees(db).map((e) => ({ value: e.id, label: `${fullName(e)} (${e.empNo})` }));
  return opts.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
}

export function Field({ field, value, onChange, db, values }) {
  const id = `f_${field.key}`;
  const common = { id, name: field.key, required: field.required, placeholder: field.placeholder || '', disabled: field.disabled };
  let input;
  switch (field.type) {
    case 'textarea':
      input = <textarea {...common} rows={field.rows || 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
    case 'employee': {
      const opts = resolveOptions(field, db, values);
      input = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.placeholder || 'Select'}</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    }
    case 'multiemployee': {
      const sel = Array.isArray(value) ? value : [];
      input = (
        <div className="multi">
          {activeEmployees(db).map((e) => (
            <label key={e.id} className={`multi-opt ${sel.includes(e.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={sel.includes(e.id)} onChange={(ev) => onChange(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} />
              {fullName(e)}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'checkbox':
      return (
        <label className={`check ${field.full ? 'full' : ''}`}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    case 'radio': {
      const opts = resolveOptions(field, db, values);
      input = (
        <div className="radios">
          {opts.map((o) => (
            <label key={o.value} className="radio">
              <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'file':
      input = (
        <div className="file-input">
          <input id={id} type="file" onChange={(e) => onChange(e.target.files?.[0]?.name || '')} />
          {value && <span className="muted">Attached: {value}</span>}
        </div>
      );
      break;
    default:
      input = (
        <input
          {...common}
          type={field.type || 'text'}
          min={field.min}
          max={field.max}
          step={field.step}
          value={value ?? ''}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        />
      );
  }
  return (
    <div className={`field ${field.full ? 'full' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required && <span className="req">*</span>}
      </label>
      {input}
      {field.help && <small className="muted">{field.help}</small>}
    </div>
  );
}

export function FormGrid({ fields, values, setValues, db }) {
  let lastSection = null;
  const out = [];
  fields.forEach((f) => {
    if (f.show && !f.show(values)) return;
    if (f.section && f.section !== lastSection) {
      lastSection = f.section;
      out.push(
        <h4 key={`s_${f.section}`} className="form-section full">
          {f.section}
        </h4>,
      );
    }
    out.push(<Field key={f.key} field={f} value={values[f.key]} db={db} values={values} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />);
  });
  return <div className="form-grid">{out}</div>;
}

export function FormModal({ title, fields, initial = {}, onSave, onClose, submitLabel = 'Save', wide, validate, children }) {
  const db = useDB();
  const [values, setValues] = useState(() => ({ ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...initial }));
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && (!f.show || f.show(values)) && (values[f.key] === undefined || values[f.key] === '' || values[f.key] === null));
    if (missing) return setError(`${missing.label} is required.`);
    const v = validate && validate(values);
    if (v) return setError(v);
    onSave(values);
  };
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={submit}>
        {children && children(values, setValues)}
        <FormGrid fields={fields} values={values} setValues={setValues} db={db} />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-foot inline">
          <Btn kind="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <button type="submit" className="btn btn-primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- table ----------
export function DataTable({ columns, rows, onRowClick, empty = 'No records found.', pageSize = 15, rowKey = (r) => r.id }) {
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = col.sortValue || ((r) => r[col.key]);
    return [...rows].sort((a, b) => {
      const x = val(a) ?? '';
      const y = val(b) ?? '';
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const shown = sorted.slice(p * pageSize, (p + 1) * pageSize);
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align }}
                className={c.sortable === false ? '' : 'sortable'}
                onClick={() => c.sortable !== false && setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))}
              >
                {c.label}
                {sort?.key === c.key && <span className="sort">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }} data-label={c.label}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <span className="muted">
            {p * pageSize + 1}–{Math.min((p + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <Btn kind="ghost" small icon="chevronLeft" disabled={p === 0} onClick={() => setPage(p - 1)} />
          <Btn kind="ghost" small icon="chevronRight" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} />
        </div>
      )}
    </div>
  );
}

export function exportCSV(name, columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="searchbox">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

// ---------- generic list + add/edit/delete page ----------
// A reusable screen for simple collections (settings lists, assets, clients...).
export function Crud({ title, collection, fields, columns, filter, searchKeys = [], canEdit = true, canDelete = true, canAdd = true, addLabel, defaults = {}, toolbar, rowActions, onRowClick, beforeSave, emptyText, exportName }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  let rows = db[collection] || [];
  if (filter) rows = rows.filter(filter);
  if (q) rows = rows.filter((r) => searchKeys.some((k) => String(typeof k === 'function' ? k(r, db) : r[k] ?? '').toLowerCase().includes(q.toLowerCase())));
  const cols = [...columns];
  if (canEdit || canDelete || rowActions) {
    cols.push({
      key: '_actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (r) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {rowActions && rowActions(r)}
          {canEdit && <Btn kind="icon" icon="edit" title="Edit" aria-label="Edit" onClick={() => setEditing(r)} />}
          {canDelete && (
            <Btn
              kind="icon"
              icon="trash"
              title="Delete"
              aria-label="Delete"
              onClick={() => {
                if (confirmAction('Delete this record?')) {
                  removeItem(collection, r.id);
                  toast('Deleted');
                }
              }}
            />
          )}
        </span>
      ),
    });
  }
  return (
    <Card
      title={title}
      pad={false}
      actions={
        <>
          {searchKeys.length > 0 && <SearchBox value={q} onChange={setQ} />}
          {toolbar}
          {exportName && <Btn kind="ghost" icon="download" onClick={() => exportCSV(exportName, columns.filter((c) => c.key !== '_actions'), rows)}>Export</Btn>}
          {canAdd && (
            <Btn icon="plus" onClick={() => setEditing({ ...defaults })}>
              {addLabel || 'Add'}
            </Btn>
          )}
        </>
      }
    >
      <DataTable columns={cols} rows={rows} empty={emptyText} onRowClick={onRowClick} />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${title.replace(/s$/, '').toLowerCase()}` : addLabel || `Add ${title.replace(/s$/, '').toLowerCase()}`}
          fields={fields}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(v) => {
            const data = beforeSave ? beforeSave(v, editing) : v;
            if (editing.id) patchItem(collection, editing.id, data);
            else addItem(collection, data);
            setEditing(null);
            toast('Saved');
          }}
        />
      )}
    </Card>
  );
}

export function DateRange({ from, to }) {
  return (
    <span>
      {fmtDate(from)}
      {to && to !== from ? ` – ${fmtDate(to)}` : ''}
    </span>
  );
}

export function Progress({ value, tone }) {
  return (
    <div className="progress" title={`${Math.round(value)}%`}>
      <div className={`progress-bar ${tone ? 'pb-' + tone : ''}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v === '' || v === undefined || v === null ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BarChart({ data, format = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="barchart">
      {data.map((d) => (
        <div key={d.label} className="bar-row">
          <span className="bar-label">{d.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
          </span>
          <span className="bar-val">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
