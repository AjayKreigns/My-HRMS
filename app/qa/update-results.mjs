// Runs the project's tests and records the results in this folder.
//   npm run qa:update        Chromium only (fast)
//   npm run qa:update:all    Chromium, Firefox and WebKit
//   add --full               also run the slow full-frontend sweep (npm run qa:update:full does all three browsers plus the sweep)
// Writes: results/latest.json, results/history.md (one row appended per run) and test-register.md (every test, by name).
// Exits 1 if the payroll tests, the browser tests or the build fail. The dependency audit is informational.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const resultsDir = path.join(here, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const ALL = process.argv.includes('--all');
// The full-frontend sweep (every page and every tab, 3 roles) takes 6 to 13 minutes per browser, so it only runs with --full.
const FULL = process.argv.includes('--full');
const PROJECTS = ALL ? ['chromium', 'firefox', 'webkit'] : ['chromium'];
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: appDir, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 128 * 1024 * 1024, ...opts });
const git = (args) => run('git', args).stdout?.trim() || '';

// ---- payroll rules (node tests/payroll.test.mjs): "  ok <name>" lines under group headings ----
function runPayroll() {
  const r = run('node', ['tests/payroll.test.mjs']);
  const tests = [];
  let group = '';
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^ {2}ok (.+)$/);
    if (m) tests.push({ group, name: m[1], status: 'pass' });
    else if (!line.startsWith(' ') && !/checks passed$/.test(line)) group = line.trim();
  }
  let failure = null;
  if (r.status !== 0) {
    const msg = strip(r.stderr).split(/\r?\n/).filter(Boolean).slice(0, 6).join(' | ').slice(0, 400);
    failure = { after: tests.at(-1)?.name || '(start)', message: msg };
  }
  return { exitCode: r.status, passed: tests.length, tests, failure };
}

// ---- browser tests (Playwright JSON report) ----
function runE2E(previous) {
  const out = path.join(resultsDir, '.pw-report.json');
  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out };
  const args = ['playwright', 'test', '--reporter=json', ...PROJECTS.map((p) => `--project=${p}`)];
  if (ALL) args.push('--workers=3'); // fewer parallel browsers: Firefox times out when the dev server is swamped
  if (!FULL) args.push('--grep-invert=every.page'); // a regex: a space in the value would be split into two arguments on Windows
  const r = run('npx', args, { env });
  let report;
  try {
    report = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.rmSync(out, { force: true });
  } catch {
    return { error: strip(r.stderr || r.stdout).slice(0, 400) || 'Playwright produced no report', projects: PROJECTS, tests: previous?.tests || [] };
  }
  const rows = new Map();
  const walk = (suite, area) => {
    for (const spec of suite.specs || []) {
      const key = `${area.join(' › ')}|${spec.title}`;
      const row = rows.get(key) || { area: area.join(' › '), name: spec.title, file: `${spec.file}:${spec.line}`, byProject: {} };
      for (const t of spec.tests || []) {
        const last = t.results?.at(-1) || {};
        const status = { expected: 'pass', unexpected: 'fail', flaky: 'flaky', skipped: 'skipped' }[t.status] || t.status;
        row.byProject[t.projectName] = { status, ms: last.duration ?? 0, error: status === 'fail' ? strip(last.error?.message || '').split('\n')[0].slice(0, 200) : undefined };
      }
      rows.set(key, row);
    }
    for (const child of suite.suites || []) walk(child, [...area, child.title]);
  };
  for (const top of report.suites || []) walk(top, []); // top level suites are files
  const tests = [...rows.values()];
  if (!tests.length) return { error: 'Playwright ran no tests (check the test filter)', projects: PROJECTS, tests: previous?.tests || [] };
  // Keep earlier results for browsers that were not run this time, labelled with their own date.
  for (const t of tests) {
    const prev = (previous?.tests || []).find((p) => p.area === t.area && p.name === t.name);
    for (const proj of ['chromium', 'firefox', 'webkit']) {
      if (!t.byProject[proj] && prev?.byProject?.[proj]) t.byProject[proj] = { ...prev.byProject[proj], carried: true };
    }
  }
  return { exitCode: r.status, projects: PROJECTS, tests, stats: report.stats ? { expected: report.stats.expected, unexpected: report.stats.unexpected, flaky: report.stats.flaky, skipped: report.stats.skipped } : undefined };
}

// ---- production build ----
function runBuild() {
  const r = run('npx', ['vite', 'build']);
  const out = strip((r.stdout || '') + (r.stderr || ''));
  const m = out.match(/assets\/index-[\w-]+\.js\s+([\d.]+) kB\s*[│|]\s*gzip:\s*([\d.]+) kB/);
  return { exitCode: r.status, mainJsKB: m ? Number(m[1]) : null, mainJsGzipKB: m ? Number(m[2]) : null, chunkWarning: /larger than \d+ kB/.test(out) };
}

// ---- dependency audit (informational) ----
function runAudit() {
  const r = run('npm', ['audit', '--json']);
  try {
    const j = JSON.parse(r.stdout);
    return { counts: j.metadata.vulnerabilities, packages: Object.entries(j.vulnerabilities || {}).map(([name, v]) => ({ name, severity: v.severity, direct: v.isDirect })) };
  } catch {
    return { error: 'npm audit unavailable (offline?)' };
  }
}

const latestPath = path.join(resultsDir, 'latest.json');
const previous = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null;
const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

console.log(`Running tests (${PROJECTS.join(', ')}) ...`);
const payroll = runPayroll();
console.log(`  payroll rules: ${payroll.exitCode === 0 ? 'pass' : 'FAIL'} (${payroll.passed} checks)`);
const e2e = runE2E(previous?.e2e);
console.log(`  browser tests: ${e2e.error ? 'ERROR ' + e2e.error : e2e.exitCode === 0 ? 'pass' : 'FAIL'}`);
const build = runBuild();
console.log(`  build: ${build.exitCode === 0 ? 'pass' : 'FAIL'}`);
const audit = runAudit();
console.log(`  audit: ${audit.error || `${audit.counts.total} issues`}`);

const latest = { generatedAt: stamp, commit: git(['rev-parse', '--short', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0, node: process.version, projectsRun: PROJECTS, payroll, e2e, build, audit };
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');

// ---- history: one row per run ----
const histPath = path.join(resultsDir, 'history.md');
if (!fs.existsSync(histPath)) {
  fs.writeFileSync(histPath, '# Test run history\n\nOne row per `npm run qa:update` run, newest last.\n\n| Run | Commit | Payroll rules | Browser tests | Build | Audit (total / critical / high) |\n|---|---|---|---|---|---|\n');
}
const cell = (proj) => {
  const rs = e2e.tests.map((t) => t.byProject[proj]).filter((x) => x && !x.carried);
  if (!rs.length) return null;
  const bad = rs.filter((x) => x.status === 'fail').length;
  return `${proj} ${rs.length - bad}/${rs.length}`;
};
const e2eCell = e2e.error ? 'error' : PROJECTS.map(cell).filter(Boolean).join(', ');
const payCell = payroll.exitCode === 0 ? `${payroll.passed}/${payroll.passed}` : `FAIL after ${payroll.passed}`;
const auditCell = audit.error ? 'n/a' : `${audit.counts.total} / ${audit.counts.critical} / ${audit.counts.high}`;
fs.appendFileSync(histPath, `| ${stamp} | ${latest.commit}${latest.dirty ? '+changes' : ''} | ${payCell} | ${e2eCell} | ${build.exitCode === 0 ? 'pass' : 'FAIL'} | ${auditCell} |\n`);

// ---- register: every test by name ----
const label = (r) => (!r ? 'not run' : { pass: 'PASS', fail: 'FAIL', flaky: 'flaky', skipped: 'skipped' }[r.status] + (r.carried ? '*' : ''));
let md = '# Test register\n\nEvery automated test by name with its latest result. Generated by `npm run qa:update` (do not edit by hand; edit `scans-status.json` for the manual scans).\n\n';
md += `Last run: **${stamp}**, commit \`${latest.commit}\`${latest.dirty ? ' plus uncommitted changes' : ''}, Node ${latest.node}. Browsers run this time: ${PROJECTS.join(', ')}. A \`*\` marks a result carried over from an earlier run.\n\n`;
const failing = [payroll.exitCode !== 0 && 'payroll rules', e2e.tests.some((t) => Object.values(t.byProject).some((x) => x.status === 'fail')) && 'browser tests', build.exitCode !== 0 && 'build'].filter(Boolean);
md += `**Overall:** ${failing.length ? 'FAILING: ' + failing.join(', ') : 'all automated tests pass'}.\n\n`;

md += '## Summary\n\n| Suite | Command | Result |\n|---|---|---|\n';
md += `| Payroll rules | \`node tests/payroll.test.mjs\` | ${payroll.exitCode === 0 ? `PASS, ${payroll.passed} checks` : `FAIL after "${payroll.failure.after}": ${payroll.failure.message}`} |\n`;
md += `| Browser tests | \`npm run test:e2e:all\` | ${e2e.error ? 'ERROR: ' + e2e.error : ['chromium', 'firefox', 'webkit'].map((p) => { const rs = e2e.tests.map((t) => t.byProject[p]).filter(Boolean); if (!rs.length) return `${p}: not run`; const bad = rs.filter((x) => x.status === 'fail').length; return `${p}: ${bad ? `${bad} FAIL of ${rs.length}` : `PASS ${rs.length}/${rs.length}`}${rs.every((x) => x.carried) ? '*' : ''}`; }).join('; ')} |\n`;
md += `| Production build | \`npm run build\` | ${build.exitCode === 0 ? 'PASS' : 'FAIL'}${build.mainJsKB ? `, main script ${build.mainJsKB} kB (${build.mainJsGzipKB} kB gzip)${build.chunkWarning ? ', chunk-size warning' : ''}` : ''} |\n`;
md += `| Dependency audit | \`npm audit\` | ${audit.error || `${audit.counts.total} issues: ${audit.counts.critical} critical, ${audit.counts.high} high, ${audit.counts.moderate} moderate, ${audit.counts.low} low`} |\n\n`;

md += `## Browser tests (${e2e.tests.length}) — \`e2e/ife-hive.spec.js\`\n\n| ID | Area | Test | Chromium | Firefox | WebKit |\n|---|---|---|---|---|---|\n`;
e2e.tests.forEach((t, i) => {
  md += `| E-${String(i + 1).padStart(2, '0')} | ${t.area} | ${t.name.replace(/\|/g, '\\|')} | ${label(t.byProject.chromium)} | ${label(t.byProject.firefox)} | ${label(t.byProject.webkit)} |\n`;
});
const fails = e2e.tests.flatMap((t) => Object.entries(t.byProject).filter(([, r]) => r.status === 'fail').map(([p, r]) => `- **${t.name}** (${p}): ${r.error || 'failed'}`));
if (fails.length) md += `\n### Failures\n\n${fails.join('\n')}\n`;

md += `\n## Payroll rules (${payroll.passed}${payroll.exitCode === 0 ? '' : ' passed before the failure'}) — \`tests/payroll.test.mjs\`\n\n| ID | Group | Check | Result |\n|---|---|---|---|\n`;
payroll.tests.forEach((t, i) => {
  md += `| P-${String(i + 1).padStart(3, '0')} | ${t.group} | ${t.name.replace(/\|/g, '\\|')} | PASS |\n`;
});
if (payroll.failure) md += `| | | (checks after "${payroll.failure.after}" did not run) | not run |\n`;

// manual scans (hand-maintained until they are automated; see FIX-PLAN.md, T3)
const scansPath = path.join(here, 'scans-status.json');
if (fs.existsSync(scansPath)) {
  const scans = JSON.parse(fs.readFileSync(scansPath, 'utf8'));
  md += `\n## Scans run by hand\n\nThese are run with scripts or tools outside \`qa:update\` and recorded in \`scans-status.json\`. Update that file after each run.\n\n| ID | Scan | Tool | Last run | Result | Summary |\n|---|---|---|---|---|---|\n`;
  for (const s of scans) md += `| ${s.id} | ${s.name} | ${s.tool} | ${s.lastRun} | ${s.result} | ${s.summary}${s.details ? ` ([details](${s.details}))` : ''} |\n`;
}
fs.writeFileSync(path.join(here, 'test-register.md'), md);

console.log(`Wrote qa/test-register.md, qa/results/latest.json and a row in qa/results/history.md`);
process.exit(payroll.exitCode !== 0 || e2e.error || e2e.exitCode !== 0 || build.exitCode !== 0 ? 1 : 0);
