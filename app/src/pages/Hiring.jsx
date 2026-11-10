import { useState } from 'react';
import { useDB, addItem, patchItem, notify } from '../store.js';
import { Card, Btn, Badge, Tabs, DataTable, FormModal, PageHead, Crud, Modal, KV, Stat, EmpChip, toast, Icon } from '../ui.jsx';
import { go } from '../App.jsx';
import { createEmployee } from './Admin.jsx';
import { empById, fullName, fmtDate, money, todayISO, addDays } from '../utils.js';

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];

const CANDIDATE_FIELDS = (db) => [
  { key: 'name', label: 'Full name', required: true },
  { key: 'jobId', label: 'Job opening', type: 'select', options: db.jobs.map((j) => ({ value: j.id, label: j.title })), required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'source', label: 'Source', type: 'select', options: ['Careers page', 'Referral', 'LinkedIn', 'Job portal', 'Consultant', 'Campus', 'Walk-in'] },
  { key: 'experience', label: 'Experience (years)', type: 'number' },
  { key: 'currentCtc', label: 'Current CTC', type: 'number' },
  { key: 'expectedCtc', label: 'Expected CTC', type: 'number' },
  { key: 'noticePeriod', label: 'Notice period', type: 'select', options: ['Immediate', '15 days', '30 days', '60 days', '90 days'] },
  { key: 'stage', label: 'Stage', type: 'select', options: STAGES, default: 'Applied' },
  { key: 'resume', label: 'Resume', type: 'file', full: true },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

function Candidate({ c, onClose, user }) {
  const db = useDB();
  const cand = db.candidates.find((x) => x.id === c.id) || c;
  const job = db.jobs.find((j) => j.id === cand.jobId);
  const [iv, setIv] = useState(false);
  const [offer, setOffer] = useState(false);
  const [edit, setEdit] = useState(false);
  const interviews = db.interviews.filter((i) => i.candidateId === cand.id);
  const offers = db.offers.filter((o) => o.candidateId === cand.id);
  const hire = (o) => {
    const [firstName, ...rest] = cand.name.split(' ');
    const lastName = rest.join(' ') || '-';
    const nums = db.employees.map((e) => Number(e.empNo.replace(/\D/g, '')) || 0);
    const empNo = `IFE${Math.max(...nums) + 1}`;
    const id = createEmployee({
      firstName, lastName, gender: '', dob: '', workEmail: `${firstName}.${lastName}@ifluids.com`.toLowerCase().replace(/[^a-z.@-]/g, ''), personalEmail: cand.email, mobile: cand.phone,
      empNo, dateOfJoining: o.joiningDate, designation: job?.title, department: job?.department, locationId: job?.locationId, legalEntity: db.company.legalName,
      reportingTo: job?.hiringManager, hrManager: user.id, workerType: job?.employmentType === 'Internship' ? 'Intern' : 'Permanent', timeType: 'Full time', status: 'Pre-boarding', role: 'employee',
      ctc: o.ctc, shiftId: db.shifts[0].id, weeklyOff: 'Saturday & Sunday', leavePlan: 'Standard Leave Plan', holidayCalendar: 'India - Tamil Nadu', attendanceScheme: 'Web clock-in', expensePolicy: 'Standard Expense Policy', taxRegime: 'New',
      noticePeriodDays: 60, probationEndDate: addDays(o.joiningDate, 180), password: 'Welcome@123', nationality: 'Indian',
    });
    ['Collect signed offer letter', 'Collect ID, address and education documents', 'Issue laptop and access card', 'Create email account', 'Induction & HSE training'].forEach((task, i) =>
      addItem('onboardingTasks', { empId: id, task, owner: user.id, dueDate: addDays(o.joiningDate, i - 2), stage: i < 2 ? 'Pre-boarding' : i < 4 ? 'Day 1' : 'Week 1', done: false }),
    );
    patchItem('candidates', cand.id, { stage: 'Hired', employeeId: id });
    patchItem('offers', o.id, { status: 'Accepted' });
    toast('Candidate converted to a pre-boarding employee');
    onClose();
    go(`profile/${id}/profile`);
  };
  return (
    <Modal title={cand.name} onClose={onClose} wide>
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="row">
          <Badge>{cand.stage}</Badge>
          <span className="muted">{job?.title}</span>
          <span style={{ color: '#f59e0b' }}>{'★'.repeat(cand.rating || 0)}{'☆'.repeat(5 - (cand.rating || 0))}</span>
        </span>
        <span className="row">
          <select className="select-sm" value={cand.stage} onChange={(e) => patchItem('candidates', cand.id, { stage: e.target.value })} aria-label="Move to stage">
            {STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="select-sm" value={cand.rating || 0} onChange={(e) => patchItem('candidates', cand.id, { rating: Number(e.target.value) })} aria-label="Rating">
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${n} star` : 'Not rated'}</option>)}
          </select>
          <Btn kind="ghost" small icon="edit" onClick={() => setEdit(true)}>Edit</Btn>
        </span>
      </div>
      <KV items={[['Email', cand.email], ['Phone', cand.phone], ['Source', cand.source], ['Experience', `${cand.experience || 0} years`], ['Current CTC', money(cand.currentCtc)], ['Expected CTC', money(cand.expectedCtc)], ['Notice period', cand.noticePeriod], ['Applied on', fmtDate(cand.appliedOn)], ['Resume', cand.resume], ['Notes', cand.notes]]} />
      <div className="row between" style={{ margin: '18px 0 8px' }}>
        <h4 style={{ fontSize: 13 }}>Interviews</h4>
        <Btn small kind="ghost" icon="plus" onClick={() => setIv(true)}>Schedule interview</Btn>
      </div>
      <DataTable rows={interviews} empty="No interviews yet." columns={[{ key: 'round', label: 'Round' }, { key: 'date', label: 'When', render: (i) => `${fmtDate(i.date)} ${i.time}` }, { key: 'interviewers', label: 'Interviewer', render: (i) => fullName(empById(db, i.interviewers)) }, { key: 'mode', label: 'Mode' }, { key: 'result', label: 'Result', render: (i) => (
        <select className="select-sm" value={i.result} onChange={(e) => patchItem('interviews', i.id, { result: e.target.value })} aria-label="Interview result">
          {['Scheduled', 'Selected', 'On hold', 'Rejected', 'No show'].map((s) => <option key={s}>{s}</option>)}
        </select>
      ) }, { key: 'feedback', label: 'Feedback' }]} />
      <div className="row between" style={{ margin: '18px 0 8px' }}>
        <h4 style={{ fontSize: 13 }}>Offer</h4>
        {offers.length === 0 && <Btn small kind="ghost" icon="plus" onClick={() => setOffer(true)}>Create offer</Btn>}
      </div>
      {offers.length === 0 ? (
        <p className="muted">No offer yet.</p>
      ) : (
        offers.map((o) => (
          <div key={o.id} className="row between" style={{ padding: '8px 0' }}>
            <span>CTC {money(o.ctc)} · joining {fmtDate(o.joiningDate)} · valid till {fmtDate(o.validTill)} <Badge>{o.status}</Badge></span>
            <span className="row">
              {o.status === 'Sent' && <Btn small kind="ghost" onClick={() => patchItem('offers', o.id, { status: 'Declined' })}>Declined</Btn>}
              {['Sent', 'Accepted'].includes(o.status) && !cand.employeeId && <Btn small kind="success" onClick={() => hire(o)}>Accepted — create employee</Btn>}
              {cand.employeeId && <Btn small kind="ghost" onClick={() => (onClose(), go(`profile/${cand.employeeId}`))}>Open employee</Btn>}
            </span>
          </div>
        ))
      )}
      {iv && (
        <FormModal
          title="Schedule interview"
          fields={[
            { key: 'round', label: 'Round', type: 'select', options: ['HR screening', 'Technical round 1', 'Technical round 2', 'Manager round', 'Final round'], required: true },
            { key: 'interviewers', label: 'Interviewer', type: 'employee', required: true },
            { key: 'date', label: 'Date', type: 'date', required: true },
            { key: 'time', label: 'Time', type: 'time', required: true },
            { key: 'mode', label: 'Mode', type: 'select', options: ['In person', 'Video call', 'Phone'] },
            { key: 'feedback', label: 'Notes / feedback', type: 'textarea', full: true },
          ]}
          initial={{ date: addDays(todayISO(), 1), time: '11:00', mode: 'Video call' }}
          onClose={() => setIv(false)}
          onSave={(v) => {
            addItem('interviews', { ...v, candidateId: cand.id, result: 'Scheduled' });
            if (cand.stage === 'Applied' || cand.stage === 'Screening') patchItem('candidates', cand.id, { stage: 'Interview' });
            notify(v.interviewers, `Interview with ${cand.name} (${job?.title}) on ${fmtDate(v.date)} at ${v.time}.`);
            setIv(false);
            toast('Interview scheduled');
          }}
        />
      )}
      {offer && (
        <FormModal
          title="Create offer"
          fields={[
            { key: 'ctc', label: 'Offered annual CTC', type: 'number', required: true },
            { key: 'joiningDate', label: 'Joining date', type: 'date', required: true },
            { key: 'validTill', label: 'Offer valid till', type: 'date', required: true },
            { key: 'notes', label: 'Notes', type: 'textarea', full: true },
          ]}
          initial={{ ctc: cand.expectedCtc, joiningDate: addDays(todayISO(), 30), validTill: addDays(todayISO(), 7) }}
          onClose={() => setOffer(false)}
          onSave={(v) => {
            addItem('offers', { ...v, candidateId: cand.id, jobId: cand.jobId, status: 'Sent' });
            patchItem('candidates', cand.id, { stage: 'Offer' });
            setOffer(false);
            toast('Offer created');
          }}
        />
      )}
      {edit && <FormModal title="Edit candidate" fields={CANDIDATE_FIELDS(db)} initial={cand} onClose={() => setEdit(false)} onSave={(v) => (patchItem('candidates', cand.id, v), setEdit(false), toast('Saved'))} />}
    </Modal>
  );
}

export default function Hiring({ user }) {
  const db = useDB();
  const [tab, setTab] = useState('pipeline');
  const [job, setJob] = useState('');
  const [add, setAdd] = useState(false);
  const [open, setOpen] = useState(null);
  const cands = db.candidates.filter((c) => !job || c.jobId === job);
  return (
    <div>
      <PageHead title="Hiring">
        <Btn icon="plus" onClick={() => setAdd(true)}>Add candidate</Btn>
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Open positions" value={db.jobs.filter((j) => j.status === 'Open').reduce((s, j) => s + Number(j.openings || 0), 0)} tone="brand" />
        <Stat label="Active candidates" value={db.candidates.filter((c) => !['Hired', 'Rejected'].includes(c.stage)).length} />
        <Stat label="Interviews this week" value={db.interviews.filter((i) => i.date >= todayISO() && i.date <= addDays(todayISO(), 7)).length} tone="amber" />
        <Stat label="Offers out" value={db.offers.filter((o) => o.status === 'Sent').length} tone="green" />
      </div>
      <Tabs tabs={[{ key: 'pipeline', label: 'Candidate pipeline' }, { key: 'jobs', label: 'Job openings' }, { key: 'interviews', label: 'Interviews' }, { key: 'offers', label: 'Offers' }]} active={tab} onChange={setTab} />
      {tab === 'pipeline' && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <select className="select-sm" value={job} onChange={(e) => setJob(e.target.value)} aria-label="Job opening">
              <option value="">All job openings</option>
              {db.jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>
          <div className="kanban">
            {STAGES.map((s) => {
              const list = cands.filter((c) => c.stage === s);
              return (
                <div key={s} className="kan-col">
                  <h4>{s} <span className="muted">{list.length}</span></h4>
                  {list.map((c) => (
                    <div key={c.id} className="kan-card" onClick={() => setOpen(c)}>
                      <strong>{c.name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{db.jobs.find((j) => j.id === c.jobId)?.title}</div>
                      <div className="row between" style={{ marginTop: 6, fontSize: 12 }}>
                        <span>{c.experience} yrs · {c.source}</span>
                        <span style={{ color: '#f59e0b' }}>{c.rating ? '★'.repeat(c.rating) : ''}</span>
                      </div>
                      <div className="row" style={{ marginTop: 6, gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {STAGES.indexOf(s) > 0 && s !== 'Rejected' && <Btn kind="icon" icon="chevronLeft" aria-label="Move back" onClick={() => patchItem('candidates', c.id, { stage: STAGES[STAGES.indexOf(s) - 1] })} />}
                        {STAGES.indexOf(s) < 4 && <Btn kind="icon" icon="chevronRight" aria-label="Move forward" onClick={() => patchItem('candidates', c.id, { stage: STAGES[STAGES.indexOf(s) + 1] })} />}
                        {s !== 'Rejected' && s !== 'Hired' && <Btn kind="icon" icon="x" aria-label="Reject" onClick={() => patchItem('candidates', c.id, { stage: 'Rejected' })} />}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'jobs' && (
        <Crud
          title="Job openings"
          collection="jobs"
          searchKeys={['title', 'department']}
          defaults={{ status: 'Open', employmentType: 'Full time', openings: 1, postedOn: todayISO() }}
          fields={[
            { key: 'title', label: 'Job title', required: true, full: true },
            { key: 'department', label: 'Department', type: 'select', options: db.departments.map((d) => d.name), required: true },
            { key: 'locationId', label: 'Location', type: 'select', options: db.locations.map((l) => ({ value: l.id, label: l.name })), required: true },
            { key: 'employmentType', label: 'Employment type', type: 'select', options: ['Full time', 'Part time', 'Contract', 'Internship'] },
            { key: 'experience', label: 'Experience required' },
            { key: 'openings', label: 'Number of openings', type: 'number', required: true },
            { key: 'salaryRange', label: 'Salary range' },
            { key: 'hiringManager', label: 'Hiring manager', type: 'employee', required: true },
            { key: 'status', label: 'Status', type: 'select', options: ['Open', 'On hold', 'Closed'] },
            { key: 'postedOn', label: 'Posted on', type: 'date' },
            { key: 'description', label: 'Job description', type: 'textarea', full: true, rows: 5 },
          ]}
          columns={[
            { key: 'title', label: 'Job' },
            { key: 'department', label: 'Department' },
            { key: 'locationId', label: 'Location', render: (j) => db.locations.find((l) => l.id === j.locationId)?.name },
            { key: 'openings', label: 'Openings' },
            { key: 'cands', label: 'Candidates', sortable: false, render: (j) => db.candidates.filter((c) => c.jobId === j.id).length },
            { key: 'hiringManager', label: 'Hiring manager', render: (j) => fullName(empById(db, j.hiringManager)) },
            { key: 'status', label: 'Status', render: (j) => <Badge>{j.status}</Badge> },
          ]}
        />
      )}
      {tab === 'interviews' && (
        <Card pad={false}>
          <DataTable
            rows={[...db.interviews].sort((a, b) => a.date.localeCompare(b.date))}
            onRowClick={(i) => setOpen(db.candidates.find((c) => c.id === i.candidateId))}
            columns={[
              { key: 'candidateId', label: 'Candidate', render: (i) => db.candidates.find((c) => c.id === i.candidateId)?.name },
              { key: 'round', label: 'Round' },
              { key: 'date', label: 'When', render: (i) => `${fmtDate(i.date)} ${i.time}` },
              { key: 'interviewers', label: 'Interviewer', render: (i) => <EmpChip emp={empById(db, i.interviewers)} sub={false} /> },
              { key: 'mode', label: 'Mode' },
              { key: 'result', label: 'Result', render: (i) => <Badge>{i.result}</Badge> },
            ]}
          />
        </Card>
      )}
      {tab === 'offers' && (
        <Card pad={false}>
          <DataTable
            rows={db.offers}
            onRowClick={(o) => setOpen(db.candidates.find((c) => c.id === o.candidateId))}
            columns={[
              { key: 'candidateId', label: 'Candidate', render: (o) => db.candidates.find((c) => c.id === o.candidateId)?.name },
              { key: 'jobId', label: 'Job', render: (o) => db.jobs.find((j) => j.id === o.jobId)?.title },
              { key: 'ctc', label: 'CTC', render: (o) => money(o.ctc) },
              { key: 'joiningDate', label: 'Joining', render: (o) => fmtDate(o.joiningDate) },
              { key: 'validTill', label: 'Valid till', render: (o) => fmtDate(o.validTill) },
              { key: 'status', label: 'Status', render: (o) => <Badge>{o.status}</Badge> },
            ]}
          />
        </Card>
      )}
      {add && (
        <FormModal
          title="Add candidate"
          fields={CANDIDATE_FIELDS(db)}
          initial={{ jobId: job || db.jobs[0]?.id }}
          onClose={() => setAdd(false)}
          onSave={(v) => {
            addItem('candidates', { ...v, rating: 0, appliedOn: todayISO() });
            setAdd(false);
            toast('Candidate added');
          }}
        />
      )}
      {open && <Candidate c={open} user={user} onClose={() => setOpen(null)} />}
    </div>
  );
}
