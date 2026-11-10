// Browser-side database for iFluids HRMS. Everything lives in localStorage so the
// static build works without a server; "Reset demo data" in Settings restores the seed.
import { useEffect, useReducer } from 'react';
import { seed } from './seed.js';

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
  Object.keys(fresh).forEach((k) => {
    if (db[k] === undefined) db[k] = fresh[k];
  });
  db.payrollSettings = { ...fresh.payrollSettings, ...db.payrollSettings };
  return db;
}

const saved = load();
let state = saved ? upgrade(saved) : seed();
const listeners = new Set();

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
  state = seed();
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
