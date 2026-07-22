/**
 * autonomy-gate.test.mjs — tests for the deterministic autonomy verdict engine.
 * Run: node autonomy-gate.test.mjs
 */
import { evaluateGate, DEFAULT_AUTOMATION, normalizeCompanyName } from './autonomy-gate.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const CFG_ON = {
  ...DEFAULT_AUTOMATION,
  tier: 'autonomous',
  company_allowlist: [],
};

const BASE = {
  score: 4.7,
  company: 'Acme Corp',
  vendor: 'greenhouse',
  runCount: 0,
  todayCount: 0,
  blacklistedCompanies: [],
};

// Happy path: everything passes.
eq('all checks pass', evaluateGate(BASE, CFG_ON).verdict, 'auto_submit');

// 1. tier off → draft_only, and it is the FIRST failure even if others would fail too.
eq('tier draft wins first',
  evaluateGate({ ...BASE, score: 1.0 }, { ...CFG_ON, tier: 'draft' }).reason,
  'tier_off');

// 2. below threshold.
eq('below threshold', evaluateGate({ ...BASE, score: 4.4 }, CFG_ON).reason, 'below_threshold');
eq('threshold boundary passes', evaluateGate({ ...BASE, score: 4.5 }, CFG_ON).verdict, 'auto_submit');

// Non-numeric score sentinels (N/A, —, -) fail the threshold check.
eq('sentinel score fails threshold', evaluateGate({ ...BASE, score: 'N/A' }, CFG_ON).reason, 'below_threshold');
eq('dash sentinel fails threshold', evaluateGate({ ...BASE, score: '—' }, CFG_ON).reason, 'below_threshold');

// 3. blacklist → blocked (not draft_only), case/punctuation-insensitive.
eq('blacklisted is blocked',
  evaluateGate({ ...BASE, blacklistedCompanies: ['acme corp'] }, CFG_ON).verdict,
  'blocked');
eq('blacklist match ignores punctuation',
  evaluateGate({ ...BASE, company: 'Acme, Corp.', blacklistedCompanies: ['acme corp'] }, CFG_ON).verdict,
  'blocked');

// 4. allowlist: empty = disabled; non-empty = must match.
eq('empty allowlist passes anyone', evaluateGate(BASE, { ...CFG_ON, company_allowlist: [] }).verdict, 'auto_submit');
eq('non-empty allowlist blocks strangers',
  evaluateGate(BASE, { ...CFG_ON, company_allowlist: ['Globex'] }).reason,
  'not_allowlisted');
eq('allowlist match is normalized',
  evaluateGate({ ...BASE, company: 'ACME corp.' }, { ...CFG_ON, company_allowlist: ['Acme Corp'] }).verdict,
  'auto_submit');

// 5. vendor safety.
eq('unsafe vendor', evaluateGate({ ...BASE, vendor: 'lever' }, CFG_ON).reason, 'unsafe_vendor');
eq('vendor match case-insensitive', evaluateGate({ ...BASE, vendor: 'Greenhouse' }, CFG_ON).verdict, 'auto_submit');
eq('unknown vendor is unsafe', evaluateGate({ ...BASE, vendor: '' }, CFG_ON).reason, 'unsafe_vendor');

// 6. daily cap.
eq('daily cap reached', evaluateGate({ ...BASE, todayCount: 3 }, CFG_ON).reason, 'daily_cap');
eq('daily cap boundary passes', evaluateGate({ ...BASE, todayCount: 2 }, CFG_ON).verdict, 'auto_submit');

// 7. per-run cap.
eq('run cap reached', evaluateGate({ ...BASE, runCount: 2 }, CFG_ON).reason, 'run_cap');
eq('run cap boundary passes', evaluateGate({ ...BASE, runCount: 1 }, CFG_ON).verdict, 'auto_submit');

// Ordering: blacklist (3) outranks allowlist (4).
eq('blacklist beats allowlist',
  evaluateGate(
    { ...BASE, blacklistedCompanies: ['acme corp'] },
    { ...CFG_ON, company_allowlist: ['Globex'] },
  ).reason,
  'blacklisted');

// checks array records evaluation order and stops at first failure.
const r = evaluateGate({ ...BASE, score: 4.0 }, CFG_ON);
eq('checks stop at first failure', r.checks[r.checks.length - 1].check, 'score_threshold');
eq('checks include the pass before it', r.checks[0], { check: 'tier', pass: true, detail: 'autonomous' });

// normalizeCompanyName.
eq('normalize strips punct + case', normalizeCompanyName('  Acme, Corp. Inc!  '), 'acme corp inc');

// Malformed config values fall back to safe defaults (draft tier ⇒ never submits).
eq('garbage tier is off', evaluateGate(BASE, { ...CFG_ON, tier: 'yolo' }).reason, 'tier_off');
eq('missing config is off', evaluateGate(BASE, undefined).reason, 'tier_off');
eq('garbage threshold falls back to default 4.5',
  evaluateGate({ ...BASE, score: 4.4 }, { ...CFG_ON, score_threshold: 'high' }).reason,
  'below_threshold');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('Failures:', failures.join(' | ')); process.exit(1); }
