import { useState } from 'react';
import { useDB, addItem, patchItem, removeItem, notify, update } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, EmpChip, Progress, Empty, toast, confirmAction, Icon, Stat } from '../ui.jsx';
import { empById, fullName, fmtDate, todayISO } from '../utils.js';

export const GOAL_FIELDS = [
  { key: 'title', label: 'Goal title', required: true, full: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
  { key: 'metric', label: 'Measured by', type: 'select', options: ['Percent', 'Number', 'Currency', 'Milestone'], required: true, default: 'Percent' },
  { key: 'target', label: 'Target value', type: 'number', required: true, default: 100 },
  { key: 'current', label: 'Current value', type: 'number', default: 0 },
  { key: 'weight', label: 'Weightage (%)', type: 'number', default: 25 },
  { key: 'dueDate', label: 'Due date', type: 'date', required: true },
  { key: 'status', label: 'Status', type: 'select', options: ['On track', 'Behind', 'At risk', 'Completed'], default: 'On track' },
  { key: 'visibility', label: 'Visibility', type: 'select', options: ['Public', 'Private'], default: 'Public' },
];

const Stars = ({ value }) => (
  <span className="row" style={{ gap: 1, color: '#f59e0b' }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Icon key={i} name="star" size={14} style={{ fill: i <= value ? '#f59e0b' : 'none' }} />
    ))}
  </span>
);

const RATING = [
  { value: '1', label: '1 — Needs improvement' },
  { value: '2', label: '2 — Partially meets' },
  { value: '3', label: '3 — Meets expectations' },
  { value: '4', label: '4 — Exceeds expectations' },
  { value: '5', label: '5 — Outstanding' },
];

export default function Performance({ user }) {
  const db = useDB();
  const [tab, setTab] = useState(window.location.hash.includes('reviews') ? 'reviews' : 'goals');
  const [goal, setGoal] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [fb, setFb] = useState(null);
  const [rev, setRev] = useState(null);
  const [oo, setOo] = useState(null);
  const [skill, setSkill] = useState('');
  const goals = db.goals.filter((g) => g.empId === user.id);
  const received = db.feedback.filter((f) => f.toId === user.id);
  const given = db.feedback.filter((f) => f.fromId === user.id);
  const myReviews = db.reviews.filter((r) => r.empId === user.id);
  const toReview = db.reviews.filter((r) => r.reviewerId === user.id);
  const meetings = db.oneOnOnes.filter((m) => m.empId === user.id || m.managerId === user.id);
  const pips = db.pips.filter((p) => p.empId === user.id);
  const cycle = (id) => db.reviewCycles.find((c) => c.id === id)?.name || '—';
  const avg = goals.length ? Math.round(goals.reduce((s, g) => s + Number(g.progress || 0), 0) / goals.length) : 0;

  return (
    <div>
      <PageHead title="Performance" sub="Goals, reviews, feedback and one-on-one meetings.">
        <Btn kind="ghost" icon="message" onClick={() => setFb({ type: 'Feedback' })}>Give feedback</Btn>
        <Btn icon="plus" onClick={() => setGoal({})}>Add goal</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Goals" value={goals.length} sub={`${avg}% average progress`} tone="brand" />
        <Stat label="Feedback received" value={received.length} />
        <Stat label="Reviews" value={myReviews.length} sub={myReviews.find((r) => r.status !== 'Completed')?.status || 'No pending reviews'} />
        <Stat label="Upcoming 1:1s" value={meetings.filter((m) => m.status === 'Scheduled').length} />
      </div>
      <Tabs
        tabs={[
          { key: 'goals', label: 'Goals' },
          { key: 'reviews', label: 'Reviews' },
          { key: 'feedback', label: 'Feedback' },
          { key: '1on1', label: '1:1 Meetings' },
          { key: 'skills', label: 'Skills & competencies' },
          ...(pips.length ? [{ key: 'pip', label: 'Improvement plan' }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'goals' && (
        <Card pad={false}>
          <DataTable
            rows={goals}
            empty="No goals yet. Add your first goal."
            columns={[
              { key: 'title', label: 'Goal', render: (g) => <div><strong>{g.title}</strong><div className="muted" style={{ fontSize: 12 }}>{g.description}</div></div> },
              { key: 'progress', label: 'Progress', render: (g) => <div style={{ minWidth: 120 }}><Progress value={g.progress} tone={g.status === 'At risk' ? 'red' : g.status === 'Behind' ? 'amber' : g.status === 'Completed' ? 'green' : undefined} /><small className="muted">{g.current} / {g.target} {g.metric === 'Percent' ? '%' : ''} · {Math.round(g.progress)}%</small></div> },
              { key: 'weight', label: 'Weight', render: (g) => `${g.weight}%` },
              { key: 'dueDate', label: 'Due', render: (g) => fmtDate(g.dueDate) },
              { key: 'status', label: 'Status', render: (g) => <Badge>{g.status}</Badge> },
              {
                key: 'act',
                label: '',
                sortable: false,
                render: (g) => (
                  <span className="row-actions">
                    <Btn kind="ghost" small onClick={() => setCheckin(g)}>Check in</Btn>
                    <Btn kind="icon" icon="edit" aria-label="Edit goal" onClick={() => setGoal(g)} />
                    <Btn kind="icon" icon="trash" aria-label="Delete goal" onClick={() => confirmAction('Delete this goal?') && removeItem('goals', g.id)} />
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
      {tab === 'reviews' && (
        <div className="stack">
          <Card pad={false} title="My reviews">
            <DataTable
              rows={myReviews}
              columns={[
                { key: 'cycleId', label: 'Review cycle', render: (r) => cycle(r.cycleId) },
                { key: 'reviewerId', label: 'Reviewer', render: (r) => fullName(empById(db, r.reviewerId)) },
                { key: 'selfRating', label: 'Self rating', render: (r) => (r.selfRating ? <Stars value={r.selfRating} /> : '—') },
                { key: 'managerRating', label: 'Manager rating', render: (r) => (r.status === 'Completed' ? <Stars value={r.managerRating} /> : '—') },
                { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
                { key: 'act', label: '', sortable: false, render: (r) => (r.status === 'Self review pending' ? <Btn small onClick={() => setRev({ r, as: 'self' })}>Write self review</Btn> : <Btn kind="ghost" small onClick={() => setRev({ r, as: 'view' })}>View</Btn>) },
              ]}
            />
          </Card>
          {toReview.length > 0 && (
            <Card pad={false} title="Reviews for my team">
              <DataTable
                rows={toReview}
                columns={[
                  { key: 'empId', label: 'Employee', render: (r) => <EmpChip emp={empById(db, r.empId)} /> },
                  { key: 'cycleId', label: 'Cycle', render: (r) => cycle(r.cycleId) },
                  { key: 'selfRating', label: 'Self rating', render: (r) => (r.selfRating ? <Stars value={r.selfRating} /> : '—') },
                  { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
                  { key: 'act', label: '', sortable: false, render: (r) => (r.status === 'Manager review pending' ? <Btn small onClick={() => setRev({ r, as: 'manager' })}>Rate</Btn> : <Btn kind="ghost" small onClick={() => setRev({ r, as: 'view' })}>View</Btn>) },
                ]}
              />
            </Card>
          )}
        </div>
      )}
      {tab === 'feedback' && (
        <div className="grid g2">
          <Card title={`Received (${received.length})`} actions={<Btn kind="ghost" small onClick={() => setFb({ type: 'Request' })}>Request feedback</Btn>}>
            {received.length === 0 && <Empty text="No feedback yet." icon="message" />}
            {received.map((f) => (
              <div key={f.id} className="post">
                <EmpChip emp={empById(db, f.fromId)} sub={`${f.type} · ${fmtDate(f.date)}`} />
                <p style={{ marginTop: 8 }}>{f.text}</p>
              </div>
            ))}
          </Card>
          <Card title={`Given (${given.length})`} actions={<Btn small icon="plus" onClick={() => setFb({ type: 'Feedback' })}>Give feedback</Btn>}>
            {given.length === 0 && <Empty text="You haven't given feedback yet." icon="message" />}
            {given.map((f) => (
              <div key={f.id} className="post">
                <EmpChip emp={empById(db, f.toId)} sub={`${f.type} · ${f.visibility} · ${fmtDate(f.date)}`} />
                <p style={{ marginTop: 8 }}>{f.text}</p>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === '1on1' && (
        <Card pad={false} title="One-on-one meetings" actions={<Btn icon="plus" onClick={() => setOo({ date: todayISO(), time: '16:00' })}>Schedule 1:1</Btn>}>
          <DataTable
            rows={meetings}
            columns={[
              { key: 'with', label: 'With', sortable: false, render: (m) => <EmpChip emp={empById(db, m.managerId === user.id ? m.empId : m.managerId)} /> },
              { key: 'date', label: 'When', render: (m) => `${fmtDate(m.date)} · ${m.time}` },
              { key: 'agenda', label: 'Agenda' },
              { key: 'notes', label: 'Notes' },
              { key: 'status', label: 'Status', render: (m) => <Badge>{m.status}</Badge> },
              { key: 'act', label: '', sortable: false, render: (m) => <Btn kind="icon" icon="edit" aria-label="Edit meeting" onClick={() => setOo(m)} /> },
            ]}
          />
        </Card>
      )}
      {tab === 'skills' && (
        <div className="grid g2">
          <Card title="My skills">
            <div>
              {(user.skills || []).map((s) => (
                <span key={s} className="chip">
                  {s}{' '}
                  <button className="btn-icon" style={{ height: 16, width: 16, border: 0, cursor: 'pointer' }} aria-label={`Remove ${s}`} onClick={() => update((d) => (d.employees.find((e) => e.id === user.id).skills = user.skills.filter((x) => x !== s)))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="row"
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!skill.trim()) return;
                update((d) => {
                  const me = d.employees.find((x) => x.id === user.id);
                  me.skills = [...new Set([...(me.skills || []), skill.trim()])];
                });
                setSkill('');
              }}
            >
              <input className="input-sm" placeholder="Add a skill" value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Add a skill" />
              <button className="btn btn-primary btn-sm" type="submit">Add</button>
            </form>
          </Card>
          <Card title="Competencies">
            <ul className="list">
              {db.competencies.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{c.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{c.description}</div>
                  </span>
                  <Badge tone="grey">{c.type}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {tab === 'pip' && (
        <Card pad={false} title="Performance improvement plan">
          <DataTable rows={pips} columns={[{ key: 'startDate', label: 'From', render: (p) => fmtDate(p.startDate) }, { key: 'endDate', label: 'To', render: (p) => fmtDate(p.endDate) }, { key: 'reason', label: 'Reason' }, { key: 'goals', label: 'Expectations' }, { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> }]} />
        </Card>
      )}

      {goal && (
        <FormModal
          title={goal.id ? 'Edit goal' : 'Add goal'}
          fields={GOAL_FIELDS}
          initial={goal}
          onClose={() => setGoal(null)}
          onSave={(v) => {
            const progress = v.metric === 'Milestone' ? (Number(v.current) >= Number(v.target) ? 100 : Number(goal.progress || 0)) : Math.min(100, (Number(v.current || 0) / Number(v.target || 1)) * 100);
            if (goal.id) patchItem('goals', goal.id, { ...v, progress });
            else addItem('goals', { ...v, empId: user.id, progress });
            setGoal(null);
            toast('Goal saved');
          }}
        />
      )}
      {checkin && (
        <FormModal
          title={`Check in: ${checkin.title}`}
          fields={[
            { key: 'current', label: `Current value (target ${checkin.target})`, type: 'number', required: true },
            { key: 'progress', label: 'Progress %', type: 'number', min: 0, max: 100, required: true },
            { key: 'status', label: 'Status', type: 'select', options: ['On track', 'Behind', 'At risk', 'Completed'] },
            { key: 'note', label: 'Check-in note', type: 'textarea', full: true },
          ]}
          initial={{ current: checkin.current, progress: Math.round(checkin.progress), status: checkin.status }}
          onClose={() => setCheckin(null)}
          onSave={(v) => {
            patchItem('goals', checkin.id, { current: v.current, progress: Number(v.progress), status: v.status, lastNote: v.note, lastCheckin: todayISO() });
            setCheckin(null);
            toast('Progress updated');
          }}
        />
      )}
      {fb && (
        <FormModal
          title={fb.type === 'Request' ? 'Request feedback' : 'Give feedback'}
          fields={[
            { key: 'toId', label: fb.type === 'Request' ? 'Ask' : 'To', type: 'employee', required: true, full: true },
            ...(fb.type === 'Request'
              ? [{ key: 'text', label: 'What would you like feedback on?', type: 'textarea', required: true, full: true }]
              : [
                  { key: 'type', label: 'Type', type: 'select', options: ['Feedback', 'Appreciation', 'Suggestion'], default: 'Feedback' },
                  { key: 'visibility', label: 'Visibility', type: 'select', options: ['Private', 'Shared with manager'], default: 'Shared with manager' },
                  { key: 'text', label: 'Feedback', type: 'textarea', required: true, full: true },
                ]),
          ]}
          validate={(v) => (v.toId === user.id ? 'Choose someone other than yourself.' : '')}
          onClose={() => setFb(null)}
          onSave={(v) => {
            if (fb.type === 'Request') {
              notify(v.toId, `${fullName(user)} asked for your feedback: “${v.text}”`, 'me/performance');
              toast('Feedback request sent');
            } else {
              addItem('feedback', { ...v, fromId: user.id, date: todayISO() });
              notify(v.toId, `${fullName(user)} shared feedback with you.`, 'me/performance');
              toast('Feedback shared');
            }
            setFb(null);
          }}
        />
      )}
      {rev && <ReviewForm rev={rev} db={db} onClose={() => setRev(null)} user={user} />}
      {oo && (
        <FormModal
          title={oo.id ? 'Update 1:1 meeting' : 'Schedule 1:1 meeting'}
          fields={[
            { key: 'withId', label: 'With', type: 'employee', required: true, full: true },
            { key: 'date', label: 'Date', type: 'date', required: true },
            { key: 'time', label: 'Time', type: 'time', required: true },
            { key: 'agenda', label: 'Agenda', type: 'textarea', full: true },
            { key: 'notes', label: 'Meeting notes', type: 'textarea', full: true },
            { key: 'status', label: 'Status', type: 'select', options: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled' },
          ]}
          initial={{ ...oo, withId: oo.id ? (oo.managerId === user.id ? oo.empId : oo.managerId) : user.reportingTo || '' }}
          onClose={() => setOo(null)}
          onSave={(v) => {
            const iAmManager = empById(db, v.withId)?.reportingTo === user.id;
            const data = { date: v.date, time: v.time, agenda: v.agenda, notes: v.notes, status: v.status, managerId: iAmManager ? user.id : v.withId, empId: iAmManager ? v.withId : user.id };
            if (oo.id) patchItem('oneOnOnes', oo.id, data);
            else {
              addItem('oneOnOnes', data);
              notify(v.withId, `${fullName(user)} scheduled a 1:1 on ${fmtDate(v.date)} at ${v.time}.`, 'me/performance');
            }
            setOo(null);
            toast('Saved');
          }}
        />
      )}
    </div>
  );
}

function ReviewForm({ rev, db, onClose, user }) {
  const { r, as } = rev;
  if (as === 'view') {
    return (
      <FormModal title="Review" fields={[]} onClose={onClose} onSave={onClose} submitLabel="Close">
        {() => (
          <div className="stack">
            <div><strong>Self rating:</strong> {r.selfRating || '—'} / 5<p className="muted">{r.selfComments || 'No comments.'}</p></div>
            <div><strong>Manager rating:</strong> {r.status === 'Completed' ? `${r.managerRating} / 5` : 'Pending'}<p className="muted">{r.status === 'Completed' ? r.managerComments : ''}</p></div>
          </div>
        )}
      </FormModal>
    );
  }
  const self = as === 'self';
  return (
    <FormModal
      title={self ? 'Self review' : `Review for ${fullName(empById(db, r.empId))}`}
      fields={[
        { key: 'rating', label: 'Overall rating', type: 'select', options: RATING, required: true, full: true },
        ...db.competencies.map((c) => ({ key: `c_${c.id}`, label: c.name, type: 'select', options: RATING })),
        { key: 'comments', label: self ? 'Your achievements and challenges' : 'Comments for the employee', type: 'textarea', required: true, full: true, rows: 5 },
      ]}
      initial={{}}
      submitLabel="Submit review"
      onClose={onClose}
      onSave={(v) => {
        const comps = Object.fromEntries(db.competencies.map((c) => [c.id, Number(v[`c_${c.id}`] || 0)]));
        if (self) patchItem('reviews', r.id, { selfRating: Number(v.rating), selfComments: v.comments, selfCompetencies: comps, status: 'Manager review pending' });
        else {
          patchItem('reviews', r.id, { managerRating: Number(v.rating), managerComments: v.comments, managerCompetencies: comps, status: 'Completed' });
          notify(r.empId, `${fullName(user)} completed your performance review.`, 'me/performance?reviews');
        }
        onClose();
        toast('Review submitted');
      }}
    />
  );
}
