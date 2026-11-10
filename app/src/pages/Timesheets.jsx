import { useState } from 'react';
import { useDB, update, uid, notify } from '../store.js';
import { Card, Btn, Badge, DataTable, PageHead, Tabs, toast } from '../ui.jsx';
import { addDays, fmtDate, parseISO, todayISO, DAYS, fullName } from '../utils.js';

const mondayOf = (s) => {
  const wd = parseISO(s).getDay();
  return addDays(s, wd === 0 ? -6 : 1 - wd);
};

export default function Timesheets({ user }) {
  const db = useDB();
  const [week, setWeek] = useState(mondayOf(todayISO()));
  const [tab, setTab] = useState('week');
  const sheet = db.timesheets.find((t) => t.empId === user.id && t.weekStart === week);
  const [draft, setDraft] = useState(null);
  const myProjects = db.projects.filter((p) => p.status === 'Active' && (p.members.includes(user.id) || p.manager === user.id || p.code.startsWith('INT')));
  const rows = draft?.week === week ? draft.rows : sheet?.rows || [{ projectId: myProjects[0]?.id || '', task: '', hours: ['', '', '', '', '', '', ''] }];
  const locked = sheet && ['Submitted', 'Approved'].includes(sheet.status);
  const setRows = (r) => setDraft({ week, rows: r });
  const dayTotal = (i) => rows.reduce((s, r) => s + Number(r.hours[i] || 0), 0);
  const total = rows.reduce((s, r) => s + r.hours.reduce((a, b) => a + Number(b || 0), 0), 0);

  const save = (status) => {
    if (status === 'Submitted' && rows.some((r) => !r.projectId)) return toast('Choose a project on every row.', 'error');
    update((d) => {
      const t = d.timesheets.find((x) => x.empId === user.id && x.weekStart === week);
      if (t) Object.assign(t, { rows, status, updatedOn: todayISO() });
      else d.timesheets.unshift({ id: uid('ts'), empId: user.id, weekStart: week, rows, status, updatedOn: todayISO() });
    });
    if (status === 'Submitted' && user.reportingTo) notify(user.reportingTo, `${fullName(user)} submitted a timesheet for the week of ${fmtDate(week)}.`, 'inbox');
    setDraft(null);
    toast(status === 'Submitted' ? 'Timesheet submitted' : 'Draft saved');
  };

  return (
    <div>
      <PageHead title="Timesheets" sub="Log hours against projects every week." />
      <Tabs tabs={[{ key: 'week', label: 'This week' }, { key: 'history', label: 'Past timesheets' }, { key: 'projects', label: 'My projects' }]} active={tab} onChange={setTab} />
      {tab === 'week' && (
        <Card
          pad={false}
          title={
            <span className="row">
              <Btn kind="ghost" small icon="chevronLeft" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} />
              Week of {fmtDate(week)}
              <Btn kind="ghost" small icon="chevronRight" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} />
              {sheet && <Badge>{sheet.status}</Badge>}
            </span>
          }
          actions={
            !locked && (
              <>
                <Btn kind="ghost" onClick={() => save('Draft')}>Save draft</Btn>
                <Btn onClick={() => save('Submitted')}>Submit</Btn>
              </>
            )
          }
        >
          <div className="table-wrap ts-grid">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Task</th>
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <th key={i} style={{ textAlign: 'center' }}>
                      {DAYS[(i + 1) % 7]} {addDays(week, i).slice(8)}
                    </th>
                  ))}
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    <td>
                      <select className="select-sm" disabled={locked} value={r.projectId} aria-label="Project" onChange={(e) => setRows(rows.map((x, j) => (j === ri ? { ...x, projectId: e.target.value } : x)))}>
                        <option value="">Select project</option>
                        {db.projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input-sm" disabled={locked} value={r.task} placeholder="Task" aria-label="Task" onChange={(e) => setRows(rows.map((x, j) => (j === ri ? { ...x, task: e.target.value } : x)))} />
                    </td>
                    {r.hours.map((h, hi) => (
                      <td key={hi} style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          disabled={locked}
                          value={h}
                          aria-label={`Hours ${DAYS[(hi + 1) % 7]}`}
                          onChange={(e) => setRows(rows.map((x, j) => (j === ri ? { ...x, hours: x.hours.map((y, k) => (k === hi ? e.target.value : y)) } : x)))}
                        />
                      </td>
                    ))}
                    <td><strong>{r.hours.reduce((a, b) => a + Number(b || 0), 0)}</strong></td>
                    <td>{!locked && rows.length > 1 && <Btn kind="icon" icon="trash" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== ri))} />}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    {!locked && <Btn kind="ghost" small icon="plus" onClick={() => setRows([...rows, { projectId: '', task: '', hours: ['', '', '', '', '', '', ''] }])}>Add row</Btn>}
                  </td>
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <td key={i} style={{ textAlign: 'center' }}><strong>{dayTotal(i)}</strong></td>
                  ))}
                  <td><strong>{total}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'history' && (
        <Card pad={false}>
          <DataTable
            rows={db.timesheets.filter((t) => t.empId === user.id)}
            empty="No timesheets yet."
            onRowClick={(t) => (setWeek(t.weekStart), setTab('week'))}
            columns={[
              { key: 'weekStart', label: 'Week', render: (t) => `${fmtDate(t.weekStart)} – ${fmtDate(addDays(t.weekStart, 6))}` },
              { key: 'hours', label: 'Hours', sortable: false, render: (t) => t.rows.reduce((s, r) => s + r.hours.reduce((a, b) => a + Number(b || 0), 0), 0) },
              { key: 'updatedOn', label: 'Updated', render: (t) => fmtDate(t.updatedOn) },
              { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> },
            ]}
          />
        </Card>
      )}
      {tab === 'projects' && (
        <Card pad={false}>
          <DataTable
            rows={myProjects}
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'name', label: 'Project' },
              { key: 'clientId', label: 'Client', render: (p) => db.clients.find((c) => c.id === p.clientId)?.name || 'Internal' },
              { key: 'manager', label: 'Manager', render: (p) => fullName(db.employees.find((e) => e.id === p.manager)) },
              { key: 'endDate', label: 'Ends', render: (p) => fmtDate(p.endDate) },
              { key: 'billing', label: 'Billing' },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
