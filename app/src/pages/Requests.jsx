import { useState } from 'react';
import { useDB, addItem, patchItem, removeItem, notify, uid, update } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, EmpChip, Stat, Modal, Empty, toast, confirmAction, DateRange, Icon } from '../ui.jsx';
import { empById, fullName, fmtDate, fmtDateTime, money, todayISO } from '../utils.js';

export const expenseFields = (db) => [
  { key: 'title', label: 'Expense title', required: true, full: true },
  { key: 'category', label: 'Category', type: 'select', options: db.expenseCategories, required: true },
  { key: 'date', label: 'Expense date', type: 'date', required: true },
  { key: 'amount', label: 'Amount', type: 'number', required: true, min: 0 },
  { key: 'currency', label: 'Currency', type: 'select', options: ['INR', 'USD', 'AED', 'EUR', 'SAR'], default: 'INR' },
  { key: 'merchant', label: 'Merchant / vendor' },
  { key: 'project', label: 'Project', type: 'select', options: db.projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
  { key: 'billable', label: 'Billable to client', type: 'select', options: ['Yes', 'No'], default: 'No' },
  { key: 'receipt', label: 'Receipt', type: 'file' },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
];

export const travelFields = (db) => [
  { key: 'purpose', label: 'Purpose of travel', required: true, full: true },
  { key: 'fromCity', label: 'From', required: true },
  { key: 'toCity', label: 'To', required: true },
  { key: 'departDate', label: 'Departure date', type: 'date', required: true },
  { key: 'returnDate', label: 'Return date', type: 'date', required: true },
  { key: 'mode', label: 'Travel mode', type: 'select', options: ['Flight', 'Train', 'Bus', 'Cab', 'Own vehicle'], required: true },
  { key: 'accommodation', label: 'Accommodation needed', type: 'select', options: ['Yes', 'No'], default: 'No' },
  { key: 'estimatedCost', label: 'Estimated cost (INR)', type: 'number' },
  { key: 'project', label: 'Project', type: 'select', options: db.projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

export function Expenses({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('claims');
  const [exp, setExp] = useState(null);
  const [adv, setAdv] = useState(false);
  const [trip, setTrip] = useState(false);
  const mine = db.expenses.filter((e) => e.empId === user.id);
  const sum = (s) => mine.filter((e) => e.status === s).reduce((t, e) => t + Number(e.amount || 0), 0);
  const project = (id) => db.projects.find((p) => p.id === id)?.code || '—';
  const toManager = (what) => user.reportingTo && notify(user.reportingTo, `${fullName(user)} submitted ${what}.`, 'inbox');

  return (
    <div>
      <PageHead title="Expenses & Travel" sub={`Policy: ${user.expensePolicy}`}>
        <Btn kind="ghost" onClick={() => setTrip(true)}>Travel request</Btn>
        <Btn kind="ghost" onClick={() => setAdv(true)}>Request advance</Btn>
        <Btn icon="plus" onClick={() => setExp({ date: todayISO() })}>Add expense</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Pending approval" value={money(sum('Pending'))} tone="amber" />
        <Stat label="Approved, to be paid" value={money(sum('Approved'))} tone="brand" />
        <Stat label="Reimbursed" value={money(sum('Paid'))} tone="green" />
        <Stat label="Open advances" value={money(db.advances.filter((a) => a.empId === user.id && a.settled !== 'Yes' && a.status !== 'Rejected').reduce((t, a) => t + Number(a.amount), 0))} />
      </div>
      <Tabs tabs={[{ key: 'claims', label: 'Expense claims' }, { key: 'advances', label: 'Advances' }, { key: 'travel', label: 'Travel requests' }, { key: 'policy', label: 'Expense policy' }]} active={tab} onChange={setTab} />
      {tab === 'claims' && (
        <Card pad={false}>
          <DataTable
            rows={mine}
            empty="No expenses yet."
            columns={[
              { key: 'date', label: 'Date', render: (e) => fmtDate(e.date) },
              { key: 'title', label: 'Expense', render: (e) => <div><strong>{e.title}</strong><div className="muted" style={{ fontSize: 12 }}>{e.merchant}</div></div> },
              { key: 'category', label: 'Category' },
              { key: 'project', label: 'Project', render: (e) => project(e.project) },
              { key: 'amount', label: 'Amount', align: 'right', render: (e) => money(e.amount, e.currency) },
              { key: 'receipt', label: 'Receipt', render: (e) => e.receipt || <span className="muted">Missing</span> },
              { key: 'status', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (e) =>
                  e.status === 'Pending' && (
                    <span className="row-actions">
                      <Btn kind="icon" icon="edit" aria-label="Edit expense" onClick={() => setExp(e)} />
                      <Btn kind="icon" icon="trash" aria-label="Delete expense" onClick={() => confirmAction('Delete this expense?') && removeItem('expenses', e.id)} />
                    </span>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {tab === 'advances' && (
        <Card pad={false}>
          <DataTable
            rows={db.advances.filter((a) => a.empId === user.id)}
            columns={[
              { key: 'purpose', label: 'Purpose' },
              { key: 'amount', label: 'Amount', render: (a) => money(a.amount) },
              { key: 'requiredBy', label: 'Needed by', render: (a) => fmtDate(a.requiredBy) },
              { key: 'status', label: 'Status', render: (a) => <Badge>{a.status}</Badge> },
              { key: 'settled', label: 'Settled' },
            ]}
          />
        </Card>
      )}
      {tab === 'travel' && (
        <Card pad={false}>
          <DataTable
            rows={db.travel.filter((t) => t.empId === user.id)}
            columns={[
              { key: 'purpose', label: 'Purpose' },
              { key: 'route', label: 'Route', sortable: false, render: (t) => `${t.fromCity} → ${t.toCity}` },
              { key: 'departDate', label: 'Dates', render: (t) => <DateRange from={t.departDate} to={t.returnDate} /> },
              { key: 'mode', label: 'Mode' },
              { key: 'estimatedCost', label: 'Est. cost', render: (t) => money(t.estimatedCost) },
              { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> },
            ]}
          />
        </Card>
      )}
      {tab === 'policy' && (
        <Card title={user.expensePolicy}>
          <ul className="list">
            {db.expenseCategories.map((c) => (
              <li key={c}>
                <span>{c}</span>
                <span className="muted">Receipt required above ₹500</span>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 12 }}>Claims are approved by your reporting manager and reimbursed with the next payroll.</p>
        </Card>
      )}
      {exp && (
        <FormModal
          title={exp.id ? 'Edit expense' : 'Add expense'}
          fields={expenseFields(db)}
          initial={exp}
          onClose={() => setExp(null)}
          onSave={(v) => {
            if (exp.id) patchItem('expenses', exp.id, v);
            else {
              addItem('expenses', { ...v, empId: user.id, status: 'Pending' });
              toManager(`an expense of ${money(v.amount)}`);
            }
            setExp(null);
            toast('Expense submitted');
          }}
        />
      )}
      {adv && (
        <FormModal
          title="Request expense advance"
          fields={[
            { key: 'purpose', label: 'Purpose', required: true, full: true },
            { key: 'amount', label: 'Amount (INR)', type: 'number', required: true },
            { key: 'requiredBy', label: 'Needed by', type: 'date', required: true },
            { key: 'notes', label: 'Notes', type: 'textarea', full: true },
          ]}
          onClose={() => setAdv(false)}
          onSave={(v) => {
            addItem('advances', { ...v, empId: user.id, status: 'Pending', settled: 'No' });
            toManager(`an advance request of ${money(v.amount)}`);
            setAdv(false);
            toast('Advance requested');
          }}
        />
      )}
      {trip && (
        <FormModal
          title="Travel request"
          fields={travelFields(db)}
          validate={(v) => (v.returnDate < v.departDate ? 'Return date is before departure.' : '')}
          onClose={() => setTrip(false)}
          onSave={(v) => {
            addItem('travel', { ...v, empId: user.id, status: 'Pending' });
            toManager(`a travel request to ${v.toCity}`);
            setTrip(false);
            toast('Travel request submitted');
          }}
        />
      )}
    </div>
  );
}

export function TicketDetail({ ticket, onClose, user, admin }) {
  const db = useDB();
  const t = db.tickets.find((x) => x.id === ticket.id) || ticket;
  const [msg, setMsg] = useState('');
  const send = () => {
    if (!msg.trim()) return;
    update((d) => {
      d.tickets.find((x) => x.id === t.id).comments.push({ id: uid('tc'), empId: user.id, text: msg.trim(), date: new Date().toISOString() });
    });
    notify(user.id === t.empId ? t.assignee : t.empId, `New reply on ticket “${t.subject}”.`, user.id === t.empId ? 'admin/helpdesk' : 'me/helpdesk');
    setMsg('');
  };
  return (
    <Modal title={`#${t.id.slice(-5).toUpperCase()} · ${t.subject}`} onClose={onClose} wide>
      <div className="row" style={{ marginBottom: 12 }}>
        <Badge>{t.status}</Badge>
        <Badge>{t.priority}</Badge>
        <Badge tone="grey">{t.category}</Badge>
        <span className="muted">Raised {fmtDateTime(t.createdAt)}</span>
      </div>
      <div className="grid g2" style={{ marginBottom: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Raised by</div>
          <EmpChip emp={empById(db, t.empId)} />
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Assigned to</div>
          {admin ? (
            <select className="select-sm" value={t.assignee || ''} onChange={(e) => patchItem('tickets', t.id, { assignee: e.target.value })} aria-label="Assignee">
              <option value="">Unassigned</option>
              {db.employees.filter((e) => e.role !== 'employee').map((e) => (
                <option key={e.id} value={e.id}>{fullName(e)}</option>
              ))}
            </select>
          ) : (
            <EmpChip emp={empById(db, t.assignee)} />
          )}
        </div>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>
      {t.attachment && <p className="muted">Attachment: {t.attachment}</p>}
      <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>Conversation</h4>
      {t.comments.length === 0 && <p className="muted">No replies yet.</p>}
      <div className="timeline">
        {t.comments.map((c) => (
          <div key={c.id} className="tl">
            <strong>{fullName(empById(db, c.empId))}</strong> <span className="muted">{fmtDateTime(c.date)}</span>
            <p>{c.text}</p>
          </div>
        ))}
      </div>
      {t.status !== 'Closed' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="reply">Reply</label>
          <textarea id="reply" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
        </div>
      )}
      <div className="modal-foot inline">
        {admin && t.status !== 'Resolved' && t.status !== 'Closed' && <Btn kind="ghost" onClick={() => (patchItem('tickets', t.id, { status: 'In progress' }))}>Mark in progress</Btn>}
        {admin && t.status !== 'Resolved' && t.status !== 'Closed' && <Btn kind="success" onClick={() => (patchItem('tickets', t.id, { status: 'Resolved' }), notify(t.empId, `Your ticket “${t.subject}” was resolved.`, 'me/helpdesk'))}>Resolve</Btn>}
        {!admin && t.status === 'Resolved' && <Btn kind="ghost" onClick={() => patchItem('tickets', t.id, { status: 'Open' })}>Reopen</Btn>}
        {t.status !== 'Closed' && t.empId === user.id && <Btn kind="ghost" onClick={() => patchItem('tickets', t.id, { status: 'Closed' })}>Close ticket</Btn>}
        {t.status !== 'Closed' && <Btn onClick={send} disabled={!msg.trim()}>Send reply</Btn>}
      </div>
    </Modal>
  );
}

export function Helpdesk({ user }) {
  const db = useDB();
  const [raise, setRaise] = useState(false);
  const [open, setOpen] = useState(null);
  const mine = db.tickets.filter((t) => t.empId === user.id);
  return (
    <div>
      <PageHead title="Helpdesk" sub="Raise a ticket with HR, payroll, IT or admin.">
        <Btn icon="plus" onClick={() => setRaise(true)}>Raise ticket</Btn>
      </PageHead>
      <Card pad={false}>
        <DataTable
          rows={mine}
          empty="No tickets raised."
          onRowClick={setOpen}
          columns={[
            { key: 'id', label: 'Ticket', render: (t) => `#${t.id.slice(-5).toUpperCase()}` },
            { key: 'subject', label: 'Subject' },
            { key: 'category', label: 'Category' },
            { key: 'priority', label: 'Priority', render: (t) => <Badge>{t.priority}</Badge> },
            { key: 'assignee', label: 'Assigned to', render: (t) => fullName(empById(db, t.assignee)) },
            { key: 'createdAt', label: 'Raised', render: (t) => fmtDate(t.createdAt.slice(0, 10)) },
            { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> },
          ]}
        />
      </Card>
      {raise && (
        <FormModal
          title="Raise a ticket"
          fields={[
            { key: 'category', label: 'Category', type: 'select', options: db.ticketCategories, required: true },
            { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
            { key: 'subject', label: 'Subject', required: true, full: true },
            { key: 'description', label: 'Describe the issue', type: 'textarea', required: true, full: true, rows: 5 },
            { key: 'attachment', label: 'Attachment', type: 'file', full: true },
          ]}
          onClose={() => setRaise(false)}
          onSave={(v) => {
            const owner = { Payroll: 'Finance & Accounts', IT: 'Digital Solutions', 'Admin & Facilities': 'Administration' }[v.category];
            const assignee = (owner && db.departments.find((d) => d.name === owner)?.head) || db.employees.find((e) => e.role === 'admin' && e.department === 'Human Resources')?.id;
            addItem('tickets', { ...v, empId: user.id, status: 'Open', assignee, createdAt: new Date().toISOString(), comments: [] });
            if (assignee) notify(assignee, `New ${v.category} ticket from ${fullName(user)}: ${v.subject}`, 'admin/helpdesk');
            setRaise(false);
            toast('Ticket raised');
          }}
        />
      )}
      {open && <TicketDetail ticket={open} user={user} onClose={() => setOpen(null)} />}
    </div>
  );
}

export const DOC_CATEGORIES = ['Identity', 'Address proof', 'Education', 'Experience', 'Letters', 'Payroll', 'Medical', 'Policies', 'Forms', 'Other'];

export function Documents({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('mine');
  const [up, setUp] = useState(false);
  const mine = db.documents.filter((d) => d.empId === user.id);
  const org = db.documents.filter((d) => !d.empId);
  return (
    <div>
      <PageHead title="Documents" sub="Your personal documents and company policies.">
        <Btn icon="upload" onClick={() => setUp(true)}>Upload document</Btn>
      </PageHead>
      <Tabs tabs={[{ key: 'mine', label: `My documents (${mine.length})` }, { key: 'org', label: `Organisation documents (${org.length})` }]} active={tab} onChange={setTab} />
      <Card pad={false}>
        <DataTable
          rows={tab === 'mine' ? mine : org}
          empty="No documents."
          columns={[
            { key: 'name', label: 'Document', render: (d) => <span className="row"><Icon name="file" /> <span><strong>{d.name}</strong><div className="muted" style={{ fontSize: 12 }}>{d.fileName}</div></span></span> },
            { key: 'category', label: 'Category' },
            { key: 'description', label: 'Description' },
            { key: 'uploadedOn', label: 'Uploaded', render: (d) => fmtDate(d.uploadedOn) },
            {
              key: 'act',
              label: '',
              sortable: false,
              render: (d) =>
                tab === 'org' ? (
                  (d.ack || []).includes(user.id) ? <Badge tone="green">Acknowledged</Badge> : <Btn small kind="ghost" onClick={() => update((x) => x.documents.find((y) => y.id === d.id).ack.push(user.id))}>Acknowledge</Btn>
                ) : (
                  <Btn kind="icon" icon="trash" aria-label="Delete document" onClick={() => confirmAction('Delete this document?') && removeItem('documents', d.id)} />
                ),
            },
          ]}
        />
      </Card>
      {up && (
        <FormModal
          title="Upload document"
          fields={[
            { key: 'name', label: 'Document name', required: true, full: true },
            { key: 'category', label: 'Category', type: 'select', options: DOC_CATEGORIES, required: true },
            { key: 'fileName', label: 'File', type: 'file', required: true },
            { key: 'description', label: 'Description', type: 'textarea', full: true },
          ]}
          onClose={() => setUp(false)}
          onSave={(v) => {
            addItem('documents', { ...v, empId: user.id, uploadedOn: todayISO(), ack: [] });
            setUp(false);
            toast('Document uploaded');
          }}
        />
      )}
    </div>
  );
}

export function Learning({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('mine');
  const mine = db.courses.filter((c) => c.enrolled.includes(user.id));
  const rows = tab === 'mine' ? mine : db.courses;
  return (
    <div>
      <PageHead title="Learning" sub="Assigned and optional training courses." />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Enrolled" value={mine.length} tone="brand" />
        <Stat label="Completed" value={mine.filter((c) => c.completed.includes(user.id)).length} tone="green" />
        <Stat label="Mandatory pending" value={db.courses.filter((c) => c.mandatory === 'Yes' && !c.completed.includes(user.id)).length} tone="amber" />
      </div>
      <Tabs tabs={[{ key: 'mine', label: 'My learning' }, { key: 'catalog', label: 'Course catalogue' }]} active={tab} onChange={setTab} />
      {rows.length === 0 ? (
        <Card><Empty text="No courses here yet." icon="book" /></Card>
      ) : (
        <div className="dir-grid">
          {rows.map((c) => {
            const enrolled = c.enrolled.includes(user.id);
            const done = c.completed.includes(user.id);
            return (
              <div key={c.id} className="dir-card" style={{ cursor: 'default' }}>
                <div className="row between">
                  <Badge tone={c.mandatory === 'Yes' ? 'red' : 'grey'}>{c.category}</Badge>
                  <span className="muted">{c.duration}</span>
                </div>
                <strong>{c.title}</strong>
                <p className="muted">{c.description}</p>
                {done ? (
                  <Badge tone="green">Completed</Badge>
                ) : enrolled ? (
                  <Btn small onClick={() => (update((d) => d.courses.find((x) => x.id === c.id).completed.push(user.id)), toast('Course marked complete'))}>Mark complete</Btn>
                ) : (
                  <Btn small kind="ghost" onClick={() => (update((d) => d.courses.find((x) => x.id === c.id).enrolled.push(user.id)), toast('Enrolled'))}>Enrol</Btn>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
