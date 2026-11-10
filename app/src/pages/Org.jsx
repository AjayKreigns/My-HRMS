import { useState } from 'react';
import { useDB, addItem, update, uid, notify, removeItem } from '../store.js';
import { Card, Btn, Badge, DataTable, FormModal, PageHead, EmpChip, Avatar, SearchBox, Tabs, Icon, Empty, toast, confirmAction, exportCSV } from '../ui.jsx';
import { go } from '../App.jsx';
import { empById, fullName, fmtDate, fmtDateTime } from '../utils.js';

export function Directory({ user }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [loc, setLoc] = useState('');
  const [view, setView] = useState('cards');
  const rows = db.employees.filter(
    (e) =>
      e.status !== 'Exited' &&
      (!dept || e.department === dept) &&
      (!loc || e.locationId === loc) &&
      (!q || [fullName(e), e.empNo, e.designation, e.workEmail, (e.skills || []).join(' ')].join(' ').toLowerCase().includes(q.toLowerCase())),
  );
  const locName = (id) => db.locations.find((l) => l.id === id)?.name;
  const cols = [
    { key: 'name', label: 'Employee', sortValue: (e) => fullName(e), render: (e) => <EmpChip emp={e} />, csv: (e) => fullName(e) },
    { key: 'empNo', label: 'Emp no.' },
    { key: 'department', label: 'Department' },
    { key: 'locationId', label: 'Location', render: (e) => locName(e.locationId), csv: (e) => locName(e.locationId) },
    { key: 'workEmail', label: 'Email' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'reportingTo', label: 'Reports to', render: (e) => fullName(empById(db, e.reportingTo)), csv: (e) => fullName(empById(db, e.reportingTo)) },
  ];
  return (
    <div>
      <PageHead title="Employees" sub={`${rows.length} people in ${db.company.name}`}>
        <Btn kind="ghost" icon="download" onClick={() => exportCSV('employee-directory', cols, rows)}>Export</Btn>
        {user.role === 'admin' && <Btn icon="plus" onClick={() => go('admin/employees?add')}>Add employee</Btn>}
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ flex: '1 1 240px' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, title, skill or number" />
        </div>
        <select className="select-sm" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {db.departments.map((d) => <option key={d.id}>{d.name}</option>)}
        </select>
        <select className="select-sm" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Location">
          <option value="">All locations</option>
          {db.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <Btn kind={view === 'cards' ? 'primary' : 'ghost'} small onClick={() => setView('cards')}>Cards</Btn>
        <Btn kind={view === 'table' ? 'primary' : 'ghost'} small onClick={() => setView('table')}>Table</Btn>
      </div>
      {view === 'cards' ? (
        rows.length === 0 ? (
          <Card><Empty text="No one matches." /></Card>
        ) : (
          <div className="dir-grid">
            {rows.map((e) => (
              <div key={e.id} className="dir-card" onClick={() => go(`profile/${e.id}`)}>
                <div className="row">
                  <Avatar emp={e} size={44} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{fullName(e)}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{e.designation}</div>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  <div className="row" style={{ gap: 6 }}><Icon name="briefcase" size={13} /> {e.department}</div>
                  <div className="row" style={{ gap: 6 }}><Icon name="pin" size={13} /> {locName(e.locationId)}</div>
                  <div className="row" style={{ gap: 6 }}><Icon name="mail" size={13} /> {e.workEmail}</div>
                </div>
                {e.status !== 'Active' && <Badge>{e.status}</Badge>}
              </div>
            ))}
          </div>
        )
      ) : (
        <Card pad={false}>
          <DataTable rows={rows} columns={cols} onRowClick={(e) => go(`profile/${e.id}`)} pageSize={25} />
        </Card>
      )}
    </div>
  );
}

function Node({ emp, db, depth, open, toggle }) {
  const kids = db.employees.filter((e) => e.reportingTo === emp.id && e.status !== 'Exited');
  const isOpen = open[emp.id] ?? depth < 1;
  return (
    <li>
      <div className="org-node" onClick={() => go(`profile/${emp.id}`)}>
        <Avatar emp={emp} size={40} />
        <div className="nm">{fullName(emp)}</div>
        <div className="ds">{emp.designation}</div>
        {kids.length > 0 && (
          <div
            className="toggle"
            onClick={(ev) => {
              ev.stopPropagation();
              toggle(emp.id, !isOpen);
            }}
          >
            {isOpen ? '▲ Hide' : `▼ ${kids.length} report${kids.length > 1 ? 's' : ''}`}
          </div>
        )}
      </div>
      {isOpen && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} emp={k} db={db} depth={depth + 1} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgTree() {
  const db = useDB();
  const [open, setOpen] = useState({});
  const [dept, setDept] = useState('');
  const roots = db.employees.filter((e) => e.status !== 'Exited' && (!e.reportingTo || !empById(db, e.reportingTo)));
  const toggle = (id, v) => setOpen((s) => ({ ...s, [id]: v }));
  const expandAll = () => setOpen(Object.fromEntries(db.employees.map((e) => [e.id, true])));
  const deptPeople = dept ? db.employees.filter((e) => e.department === dept && e.status !== 'Exited') : [];
  return (
    <div>
      <PageHead title="Organisation chart">
        <select className="select-sm" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department view">
          <option value="">Reporting hierarchy</option>
          {db.departments.map((d) => <option key={d.id}>{d.name}</option>)}
        </select>
        {!dept && <Btn kind="ghost" onClick={expandAll}>Expand all</Btn>}
        {!dept && <Btn kind="ghost" onClick={() => setOpen({})}>Collapse</Btn>}
      </PageHead>
      <Card>
        {dept ? (
          <div className="dir-grid">
            {deptPeople.map((e) => (
              <div key={e.id} className="dir-card" onClick={() => go(`profile/${e.id}`)}>
                <EmpChip emp={e} />
                {db.departments.find((d) => d.name === dept)?.head === e.id && <Badge tone="purple">Department head</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <div className="org-tree">
            <ul style={{ paddingTop: 0 }}>
              {roots.map((r) => (
                <Node key={r.id} emp={r} db={db} depth={0} open={open} toggle={toggle} />
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

const BADGES = ['Team Player', 'Above & Beyond', 'Safety Champion', 'Problem Solver', 'Client Hero', 'Mentor'];

export function Engage({ user }) {
  const db = useDB();
  const [filter, setFilter] = useState('All');
  const [compose, setCompose] = useState(null);
  const [comment, setComment] = useState({});
  const admin = user.role === 'admin';
  const posts = db.posts.filter((p) => filter === 'All' || p.type === filter);

  const like = (p) =>
    update((d) => {
      const x = d.posts.find((y) => y.id === p.id);
      x.likes = x.likes.includes(user.id) ? x.likes.filter((i) => i !== user.id) : [...x.likes, user.id];
    });
  const vote = (p, i) =>
    update((d) => {
      d.posts.find((y) => y.id === p.id).votes[user.id] = i;
    });
  const addComment = (p) => {
    const text = (comment[p.id] || '').trim();
    if (!text) return;
    update((d) => d.posts.find((y) => y.id === p.id).comments.push({ id: uid('c'), empId: user.id, text, date: new Date().toISOString() }));
    if (p.authorId !== user.id) notify(p.authorId, `${fullName(user)} commented on your post.`, 'org/engage');
    setComment((s) => ({ ...s, [p.id]: '' }));
  };

  const fields = {
    Post: [{ key: 'text', label: 'What would you like to share?', type: 'textarea', required: true, full: true, rows: 4 }],
    Announcement: [
      { key: 'title', label: 'Title', required: true, full: true },
      { key: 'text', label: 'Announcement', type: 'textarea', required: true, full: true, rows: 5 },
    ],
    Praise: [
      { key: 'praiseTo', label: 'Who are you praising?', type: 'multiemployee', required: true, full: true },
      { key: 'badge', label: 'Badge', type: 'select', options: BADGES, required: true, full: true },
      { key: 'text', label: 'Why?', type: 'textarea', required: true, full: true },
    ],
    Poll: [
      { key: 'text', label: 'Question', required: true, full: true },
      { key: 'o1', label: 'Option 1', required: true },
      { key: 'o2', label: 'Option 2', required: true },
      { key: 'o3', label: 'Option 3' },
      { key: 'o4', label: 'Option 4' },
    ],
  };

  return (
    <div>
      <PageHead title="Engage" sub="Announcements, praise, polls and posts from across the company.">
        <Btn kind="ghost" icon="award" onClick={() => setCompose('Praise')}>Praise</Btn>
        <Btn kind="ghost" icon="poll" onClick={() => setCompose('Poll')}>Poll</Btn>
        {admin && <Btn kind="ghost" icon="megaphone" onClick={() => setCompose('Announcement')}>Announcement</Btn>}
        <Btn icon="plus" onClick={() => setCompose('Post')}>Post</Btn>
      </PageHead>
      <Tabs tabs={['All', 'Announcement', 'Praise', 'Poll', 'Post']} active={filter} onChange={setFilter} />
      <Card>
        {posts.length === 0 && <Empty text="Nothing posted yet." icon="megaphone" />}
        {posts.map((p) => {
          const totalVotes = Object.keys(p.votes || {}).length;
          const myVote = p.votes?.[user.id];
          return (
            <div key={p.id} className="post">
              <div className="row between">
                <EmpChip emp={empById(db, p.authorId)} sub={fmtDateTime(p.date)} />
                <span className="row">
                  <Badge tone="purple">{p.type}</Badge>
                  {(p.authorId === user.id || admin) && <Btn kind="icon" icon="trash" aria-label="Delete post" onClick={() => confirmAction('Delete this post?') && removeItem('posts', p.id)} />}
                </span>
              </div>
              {p.title && <h3 style={{ fontSize: 15, marginTop: 10 }}>{p.title}</h3>}
              {p.type === 'Praise' ? (
                <div className="praise">
                  <div className="row"><Icon name="award" /> <strong>{p.badge}</strong> — {p.praiseTo.map((id) => fullName(empById(db, id))).join(', ')}</div>
                  <p style={{ marginTop: 6 }}>{p.text}</p>
                </div>
              ) : (
                <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{p.text}</p>
              )}
              {p.type === 'Poll' &&
                p.options.map((o, i) => {
                  const n = Object.values(p.votes).filter((v) => v === i).length;
                  const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
                  return (
                    <button key={i} className="poll-opt" onClick={() => vote(p, i)}>
                      {myVote !== undefined && <span className="fill" style={{ width: `${pct}%` }} />}
                      <span>{o} {myVote === i && '✓'}</span>
                      {myVote !== undefined && <span style={{ float: 'right' }}>{pct}%</span>}
                    </button>
                  );
                })}
              {p.type === 'Poll' && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{totalVotes} vote(s)</p>}
              <div className="row" style={{ marginTop: 10 }}>
                <Btn kind="ghost" small icon="heart" onClick={() => like(p)} style={p.likes.includes(user.id) ? { color: '#db2777', borderColor: '#f5b5cf' } : undefined}>
                  {p.likes.length}
                </Btn>
                <span className="muted">{p.comments.length} comment(s)</span>
              </div>
              {p.comments.map((c) => (
                <div key={c.id} className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <Avatar emp={empById(db, c.empId)} size={24} />
                  <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '6px 10px' }}>
                    <strong style={{ fontSize: 12 }}>{fullName(empById(db, c.empId))}</strong>
                    <div>{c.text}</div>
                  </div>
                </div>
              ))}
              <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => (e.preventDefault(), addComment(p))}>
                <input className="input-sm" style={{ flex: 1 }} placeholder="Write a comment" aria-label="Write a comment" value={comment[p.id] || ''} onChange={(e) => setComment((s) => ({ ...s, [p.id]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" type="submit">Comment</button>
              </form>
            </div>
          );
        })}
      </Card>
      {compose && (
        <FormModal
          title={`New ${compose.toLowerCase()}`}
          fields={fields[compose]}
          submitLabel="Publish"
          onClose={() => setCompose(null)}
          onSave={(v) => {
            const base = { authorId: user.id, type: compose, date: new Date().toISOString(), likes: [], comments: [] };
            if (compose === 'Poll') addItem('posts', { ...base, text: v.text, options: [v.o1, v.o2, v.o3, v.o4].filter(Boolean), votes: {} });
            else addItem('posts', { ...base, ...v });
            if (compose === 'Praise') v.praiseTo.forEach((id) => notify(id, `${fullName(user)} praised you: ${v.badge}!`, 'org/engage'));
            if (compose === 'Announcement') db.employees.forEach((e) => e.id !== user.id && notify(e.id, `New announcement: ${v.title}`, 'org/engage'));
            setCompose(null);
            toast('Published');
          }}
        />
      )}
    </div>
  );
}
