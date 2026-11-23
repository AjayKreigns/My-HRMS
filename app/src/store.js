// Browser-side database for iFluids HRMS. Everything lives in localStorage so the
// static build works without a server; "Reset demo data" in Settings restores the seed.
import { useEffect, useReducer } from 'react';
import { seed, seedLeaveTypes } from './seed.js';
import { structureFromSettings, groupFromSettings, freezeLockedRuns } from './utils.js';
import { removeLeaveFor, sampleLeaveFor } from './leave.js';

// Sample data: Imran Sheikh (E122) has no leave at all, to show absent days with no balance.
const NO_LEAVE_EMPLOYEE = 'E122';
// Sample data: Priya Raman (E101) has a year of leave history, so the Leave page charts are filled.
const SAMPLE_LEAVE_EMPLOYEE = 'E101';

const KEY = 'ifluids-hrms-v1';
const SESSION = 'ifluids-hrms-session';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Saved data from an older version gets any collections and settings added since.
function upgrade(db) {
  const fresh = seed();
  // Pay groups and structures start from the company's existing payroll settings, so
  // nobody's pay changes when this version first loads.
  if (db.payStructures === undefined) {
    db.payStructures = [structureFromSettings(db.payrollSettings)];
    db.payGroups = [groupFromSettings(db.payrollSettings)];
  }
  Object.keys(fresh).forEach((k) => {
    if (db[k] === undefined && k !== 'migrations') db[k] = fresh[k];
  });
  db.payrollSettings = { ...fresh.payrollSettings, ...db.payrollSettings };
  db.attendanceSettings = { ...fresh.attendanceSettings, ...db.attendanceSettings };
  db.migrations = db.migrations || [];
  // One-time changes to data saved by an older version. Each runs once and is recorded.
  if (!db.migrations.includes('leave-rules-1')) {
    // Leave types now carry their rules (credit, sandwich, approval...). Bring the standard
    // types up to the company policy and keep any type HR added themselves.
    const std = seedLeaveTypes();
    const ids = new Set(std.map((t) => t.id));
    db.leaveTypes = [...std, ...(db.leaveTypes || []).filter((t) => !ids.has(t.id))];
    db.migrations.push('leave-rules-1');
  }
  if (!db.migrations.includes('attendance-hours-1')) {
    // The General Shift now follows the company working day set in Attendance policy.
    (db.shifts || []).forEach((sh) => {
      if (sh.id === 'sh1') sh.followsPolicy = true;
    });
    db.migrations.push('attendance-hours-1');
  }
  if (!db.migrations.includes('attendance-action-1')) {
    // A day with an incomplete punch now shows Action Required instead of Absent.
    if (db.attendanceSettings.missingPunchOut !== 'Present') db.attendanceSettings.missingPunchOut = 'Action required';
    db.migrations.push('attendance-action-1');
  }
  if (!db.migrations.includes('permission-leave-1')) {
    // The hours-based Permission leave type (twice in an attendance cycle) is added once.
    const perm = seedLeaveTypes().find((t) => t.code === 'PRM');
    if (perm && !(db.leaveTypes || []).some((t) => t.code === 'PRM' || t.id === perm.id)) db.leaveTypes.splice(Math.max(0, db.leaveTypes.length - 1), 0, perm);
    db.migrations.push('permission-leave-1');
  }
  if (!db.migrations.includes('sample-leave-history-1')) {
    sampleLeaveFor(db, SAMPLE_LEAVE_EMPLOYEE);
    db.migrations.push('sample-leave-history-1');
  }
  if (!db.migrations.includes('sample-no-leave-1')) {
    removeLeaveFor(db, NO_LEAVE_EMPLOYEE);
    db.migrations.push('sample-no-leave-1');
  }
  // Months already locked keep the payslips they were paid with.
  freezeLockedRuns(db);
  return db;
}

const newDB = () => freezeLockedRuns(sampleLeaveFor(removeLeaveFor(seed(), NO_LEAVE_EMPLOYEE), SAMPLE_LEAVE_EMPLOYEE));
const saved = load();
let state = saved ? upgrade(saved) : newDB();
const listeners = new Set();
// Write an upgraded copy back at once, so the one-time changes do not run again on the next visit.
if (saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the upgrade simply runs again next time */
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  listeners.forEach((l) => l());
}

export function useDB() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  return state;
}

export function getDB() {
  return state;
}

const clone = typeof structuredClone === 'function' ? structuredClone : (x) => JSON.parse(JSON.stringify(x));

// Mutate a copy of the database and persist it.
export function update(fn) {
  const next = clone(state);
  fn(next);
  state = next;
  save();
}

export function resetDB() {
  state = newDB();
  save();
}

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function addItem(col, item) {
  const row = { id: uid(col.slice(0, 3)), ...item };
  update((db) => {
    db[col] = db[col] || [];
    db[col].unshift(row);
  });
  return row;
}

export function patchItem(col, id, changes) {
  update((db) => {
    const i = db[col].findIndex((r) => r.id === id);
    if (i >= 0) db[col][i] = { ...db[col][i], ...changes };
  });
}

export function removeItem(col, id) {
  update((db) => {
    db[col] = db[col].filter((r) => r.id !== id);
  });
}

export function notify(empId, text, link = '') {
  update((db) => {
    db.notifications.unshift({ id: uid('ntf'), empId, text, link, date: new Date().toISOString(), read: false });
  });
}

// ---- session ----
export function getSessionId() {
  return localStorage.getItem(SESSION);
}
export function setSession(id) {
  if (id) localStorage.setItem(SESSION, id);
  else localStorage.removeItem(SESSION);
  listeners.forEach((l) => l());
}
export function currentUser(db = state) {
  const id = getSessionId();
  return db.employees.find((e) => e.id === id) || null;
}
