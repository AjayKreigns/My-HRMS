import { useDB } from '../store.js';
import { Card, Btn, Avatar, EmpChip, Badge, Empty, Icon } from '../ui.jsx';
import { useClock, go } from '../App.jsx';
import { pendingFor } from './Inbox.jsx';
import { fullName, fmtDate, todayISO, leaveBalances, onLeave, activeEmployees, parseISO, fmtTime, addDays, attendanceFor, empById } from '../utils.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home({ user }) {
  const db = useDB();
  const clock = useClock(user);
  const today = todayISO();
  const now = new Date();
  const shift = db.shifts.find((s) => s.id === user.shiftId) || db.shifts[0];
  const balances = leaveBalances(db, user.id).filter((b) => !b.type.unlimited && b.quota > 0);
  const holidays = db.holidays.filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const people = activeEmployees(db);
  const offToday = people.filter((e) => onLeave(db, e.id, today));
  const wfhToday = people.filter((e) => {
    const r = db.attendance.find((a) => a.empId === e.id && a.date === today);
    return (r && r.wfh) || db.attendanceRequests.some((q) => q.empId === e.id && q.type === 'Work From Home' && q.status === 'Approved' && q.date <= today && (q.to || q.date) >= today);
  });
  const m = now.getMonth();
  const birthdays = people.filter((e) => e.dob && parseISO(e.dob).getMonth() === m).sort((a, b) => parseISO(a.dob).getDate() - parseISO(b.dob).getDate());
  const anniversaries = people.filter((e) => e.dateOfJoining && parseISO(e.dateOfJoining).getMonth() === m && parseISO(e.dateOfJoining).getFullYear() < now.getFullYear());
  const joinees = db.employees.filter((e) => e.dateOfJoining >= addDays(today, -30) && e.dateOfJoining <= addDays(today, 30));
  const pending = pendingFor(db, user);
  const posts = db.posts.slice(0, 3);
  const team = db.employees.filter((e) => e.reportingTo === user.id && e.status !== 'Exited');

  return (
    <div className="stack">
      <div className="grid g3">
        <div className="hero span2">
          <div className="row between">
            <div>
              <h1 style={{ fontSize: 22 }}>
                {greeting()}, {user.firstName}
              </h1>
              <p className="muted">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <Icon name="sun" size={36} />
          </div>
          <div className="row" style={{ marginTop: 18, gap: 24, alignItems: 'flex-end' }}>
            <div>
              <div className="muted">Time today</div>
              <div className="big-time">{clock.rec?.clockIn ? clock.label : '0h 00m'}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {shift.name}: {fmtTime(shift.start)} – {fmtTime(shift.end)}
                {clock.rec?.clockIn && ` · In at ${fmtTime(clock.rec.clockIn)}`}
              </div>
            </div>
            <div className="row">
              <button className="btn" style={{ background: '#fff', color: 'var(--brand)' }} onClick={() => clock.toggle()}>
                <Icon name="clock" size={16} /> {clock.clockedIn ? 'Clock out' : clock.rec?.clockOut ? 'Clock in again' : 'Web clock in'}
              </button>
              {!clock.rec && (
                <button className="btn" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={() => clock.toggle(true)}>
                  Work from home
                </button>
              )}
            </div>
          </div>
        </div>
        <Card title="Quick actions">
          <div className="grid g2" style={{ gap: 8 }}>
            <Btn kind="ghost" icon="calendar" onClick={() => go('me/leave?apply')}>Apply leave</Btn>
            <Btn kind="ghost" icon="clock" onClick={() => go('me/attendance')}>Attendance</Btn>
            <Btn kind="ghost" icon="plane" onClick={() => go('me/expenses')}>Add expense</Btn>
            <Btn kind="ghost" icon="wallet" onClick={() => go('finances/payslips')}>Payslips</Btn>
            <Btn kind="ghost" icon="help" onClick={() => go('me/helpdesk')}>Raise ticket</Btn>
            <Btn kind="ghost" icon="timer" onClick={() => go('me/timesheets')}>Timesheet</Btn>
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Inbox" actions={<a href="#/inbox">View all</a>}>
          {pending.length === 0 ? (
            <Empty text="No pending approvals." icon="check" />
          ) : (
            <ul className="list">
              {pending.slice(0, 5).map((p) => (
                <li key={p.key}>
                  <EmpChip emp={empById(db, p.empId)} sub={p.title} />
                  <Badge>Pending</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Leave balances" actions={<a href="#/me/leave">Apply</a>}>
          <ul className="list">
            {balances.slice(0, 5).map((b) => (
              <li key={b.type.id}>
                <span>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: b.type.color, marginRight: 8 }} />
                  {b.type.name}
                </span>
                <strong>
                  {b.available} <span className="muted" style={{ fontWeight: 400 }}>/ {b.quota} days</span>
                </strong>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Upcoming holidays" actions={<a href="#/me/leave?holidays">All holidays</a>}>
          <ul className="list">
            {holidays.map((h) => (
              <li key={h.id}>
                <span>
                  <strong>{h.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {parseISO(h.date).toLocaleDateString('en-GB', { weekday: 'long' })}
                  </div>
                </span>
                <span className="row">
                  {fmtDate(h.date, { year: undefined })}
                  {h.type === 'Optional' && <Badge tone="grey">Optional</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid g3">
        <Card title={`On leave today (${offToday.length})`}>
          {offToday.length === 0 ? <p className="muted">Everyone is in today.</p> : <div className="row">{offToday.map((e) => <EmpChip key={e.id} emp={e} onClick={() => go(`profile/${e.id}`)} />)}</div>}
          <h4 style={{ fontSize: 12.5, margin: '16px 0 8px' }}>Working remotely ({wfhToday.length})</h4>
          {wfhToday.length === 0 ? <p className="muted">No one is working remotely.</p> : <div className="row">{wfhToday.map((e) => <Avatar key={e.id} emp={e} />)}</div>}
        </Card>
        <Card title="Celebrations this month">
          {birthdays.length + anniversaries.length === 0 && <p className="muted">No celebrations this month.</p>}
          <ul className="list">
            {birthdays.map((e) => (
              <li key={'b' + e.id}>
                <EmpChip emp={e} sub={`Birthday · ${fmtDate(e.dob, { year: undefined })}`} onClick={() => go(`profile/${e.id}`)} />
                <Icon name="gift" />
              </li>
            ))}
            {anniversaries.map((e) => (
              <li key={'a' + e.id}>
                <EmpChip emp={e} sub={`${now.getFullYear() - parseISO(e.dateOfJoining).getFullYear()} year work anniversary`} onClick={() => go(`profile/${e.id}`)} />
                <Icon name="award" />
              </li>
            ))}
          </ul>
          {joinees.length > 0 && (
            <>
              <h4 style={{ fontSize: 12.5, margin: '12px 0 4px' }}>New joinees</h4>
              <ul className="list">
                {joinees.map((e) => (
                  <li key={'j' + e.id}>
                    <EmpChip emp={e} sub={`Joins ${fmtDate(e.dateOfJoining)}`} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Announcements & posts" actions={<a href="#/org/engage">Engage</a>}>
          {posts.map((p) => (
            <div key={p.id} className="post">
              <div className="row between">
                <EmpChip emp={empById(db, p.authorId)} sub={fmtDate(p.date.slice(0, 10))} />
                <Badge tone="purple">{p.type}</Badge>
              </div>
              <p style={{ marginTop: 8 }}>{p.title ? <strong>{p.title}: </strong> : null}{p.text.length > 140 ? p.text.slice(0, 140) + '…' : p.text}</p>
            </div>
          ))}
        </Card>
      </div>

      {team.length > 0 && (
        <Card title="My team today" actions={<a href="#/team">Team view</a>}>
          <div className="dir-grid">
            {team.map((e) => {
              const r = attendanceFor(db, e.id, today);
              return (
                <div key={e.id} className="dir-card" onClick={() => go(`profile/${e.id}`)}>
                  <EmpChip emp={e} />
                  <div className="row between">
                    <Badge>{r.status || 'Not clocked in'}</Badge>
                    <span className="muted">{r.clockIn ? `In ${fmtTime(r.clockIn)}` : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Signed in as {fullName(user)} ({user.role}). {db.company.name}
      </p>
    </div>
  );
}
