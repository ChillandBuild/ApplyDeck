# Autonomous Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic autonomy gate + audit log + orchestrator mode so career-ops can scan → evaluate → draft → (safely) auto-submit on a schedule, with every cap/threshold decision made by script, not by LLM judgment.

**Architecture:** Two new zero-dependency Node ESM modules (`autonomy-log.mjs` for the append-only audit trail, `autonomy-gate.mjs` for the verdict engine) plus one new mode file (`modes/autonomous-pipeline.md`) that instructs the agent how to orchestrate existing scripts around them. No existing script is modified except `.gitignore` and `config/profile.example.yml`.

**Tech Stack:** Node.js ≥ 20, plain `.mjs` ESM, `js-yaml` (already a dependency), no new packages. Tests follow the repo's standalone-file convention (`node <file>.test.mjs`, plain `eq()` harness, exit 1 on failure — see `followup-cadence.test.mjs` for the reference shape).

## Global Constraints

- Repo root: all paths relative to the career-ops checkout root (where `package.json` lives).
- User-layer vs system-layer (from `AGENTS.md`): `data/*` and `config/profile.yml` are user layer (gitignored where listed); `modes/*.md` and `*.mjs` scripts are system layer.
- The score sentinel values `N/A`, `—`, `-` may appear where a score is expected; treat any non-numeric score as failing the threshold check.
- Canonical tracker states come from `templates/states.yml`; this plan only ever sets `Applied` and only via `node set-status.mjs`.
- **Never** bypass a captcha, never auto-answer legal/visa/demographic/salary/disability/veteran/background-check fields that are not explicitly present in `config/profile.yml`. These rules are restated inside the mode file in Task 4 — do not soften them.
- All new human-facing output in English.
- Commit after every task with the exact message given; do not push.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `autonomy-log.mjs` | create | Append-only TSV audit log: append entries, count today's submits. CLI + importable functions. |
| `autonomy-log.test.mjs` | create | Tests for the log module. |
| `autonomy-gate.mjs` | create | Pure verdict function + CLI wrapper reading `config/profile.yml` and the log. |
| `autonomy-gate.test.mjs` | create | Tests for the gate logic. |
| `modes/autonomous-pipeline.md` | create | Orchestrator instructions for the agent (prose, no code). |
| `.gitignore` | modify | Ignore `data/autonomy-log.tsv`. |
| `config/profile.example.yml` | modify | Add commented `automation:` block. |
| `AGENTS.md` | modify | One row in the Skill Modes table + one row in the Main Files table. |

---

### Task 1: Audit log module (`autonomy-log.mjs`)

**Files:**
- Create: `autonomy-log.mjs`
- Test: `autonomy-log.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 2 and Task 4):
  - `LOG_PATH` — constant string `'data/autonomy-log.tsv'`
  - `LOG_HEADER` — constant string (TSV header line)
  - `formatEntry(entry) → string` — one TSV line (no trailing newline); throws on missing required fields
  - `appendEntry(entry, {root = '.', now = new Date()} = {}) → {line}` — appends to the log (creates file + header if absent)
  - `countTodaySubmitted(text, today) → number` — pure: counts lines whose `outcome` is `submitted` and whose timestamp date (YYYY-MM-DD prefix) equals `today`
  - `readLogText(root = '.') → string` — file contents or `''` if absent
  - Valid outcomes: `submitted | drafted | blocked | submit_failed_captcha | submit_failed_error | submit_aborted_knockout | submit_aborted_sensitive_field`
  - CLI: `node autonomy-log.mjs add --report 042 --company "Acme" --verdict auto_submit --reason ok --score 4.7 --vendor greenhouse --outcome submitted` → prints the appended line as JSON `{"ok":true,"line":"..."}`

- [ ] **Step 1: Write the failing test**

Create `autonomy-log.test.mjs`:

```js
/**
 * autonomy-log.test.mjs — tests for the autonomy audit log module.
 * Run: node autonomy-log.test.mjs
 */
import { formatEntry, countTodaySubmitted, LOG_HEADER } from './autonomy-log.mjs';

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

// formatEntry produces 8 tab-separated columns in header order.
const entry = {
  timestamp: '2026-07-22T02:03:00',
  report_num: '042',
  company: 'Acme Corp',
  verdict: 'auto_submit',
  reason: 'ok',
  score: '4.7',
  vendor: 'greenhouse',
  outcome: 'submitted',
};
eq('formatEntry column count', formatEntry(entry).split('\t').length, 8);
eq('formatEntry order', formatEntry(entry),
  '2026-07-22T02:03:00\t042\tAcme Corp\tauto_submit\tok\t4.7\tgreenhouse\tsubmitted');

// Tabs/newlines inside a field are flattened to spaces (TSV safety).
eq('formatEntry strips tabs',
  formatEntry({ ...entry, company: 'Acme\tCorp\nInc' }).split('\t')[2],
  'Acme Corp Inc');

// Missing required field throws.
let threw = false;
try { formatEntry({ ...entry, outcome: undefined }); } catch { threw = true; }
eq('formatEntry throws on missing field', threw, true);

// Unknown outcome throws.
threw = false;
try { formatEntry({ ...entry, outcome: 'yolo' }); } catch { threw = true; }
eq('formatEntry throws on unknown outcome', threw, true);

// countTodaySubmitted counts only submitted lines dated today.
const text = [
  LOG_HEADER,
  '2026-07-22T02:03:00\t042\tAcme\tauto_submit\tok\t4.7\tgreenhouse\tsubmitted',
  '2026-07-22T02:10:00\t043\tGlobex\tdraft_only\tnot_allowlisted\t4.6\tlever\tdrafted',
  '2026-07-22T02:20:00\t044\tInitech\tauto_submit\tok\t4.6\tlever\tsubmit_failed_captcha',
  '2026-07-21T22:00:00\t041\tHooli\tauto_submit\tok\t4.9\tashby\tsubmitted',
  '2026-07-22T03:00:00\t045\tUmbrella\tauto_submit\tok\t4.8\tashby\tsubmitted',
].join('\n') + '\n';
eq('countTodaySubmitted counts todays submitted only', countTodaySubmitted(text, '2026-07-22'), 2);
eq('countTodaySubmitted empty text', countTodaySubmitted('', '2026-07-22'), 0);
eq('countTodaySubmitted header only', countTodaySubmitted(LOG_HEADER + '\n', '2026-07-22'), 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('Failures:', failures.join(' | ')); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node autonomy-log.test.mjs`
Expected: FAIL — `Cannot find module ... autonomy-log.mjs` (exit non-zero).

- [ ] **Step 3: Write the implementation**

Create `autonomy-log.mjs`:

```js
#!/usr/bin/env node
/**
 * autonomy-log.mjs — append-only audit log for the autonomous pipeline.
 *
 * Every gate verdict AND every submit outcome gets one TSV line here. The
 * daily submit cap in autonomy-gate.mjs is derived by counting today's
 * `submitted` lines, so the counter can never drift from reality.
 *
 * User layer: data/autonomy-log.tsv is gitignored, never auto-updated.
 *
 * CLI:
 *   node autonomy-log.mjs add --report 042 --company "Acme" \
 *     --verdict auto_submit --reason ok --score 4.7 \
 *     --vendor greenhouse --outcome submitted
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const LOG_PATH = 'data/autonomy-log.tsv';
export const LOG_HEADER = 'timestamp\treport_num\tcompany\tverdict\treason\tscore\tvendor\toutcome';

export const OUTCOMES = new Set([
  'submitted', 'drafted', 'blocked',
  'submit_failed_captcha', 'submit_failed_error',
  'submit_aborted_knockout', 'submit_aborted_sensitive_field',
]);

const COLUMNS = ['timestamp', 'report_num', 'company', 'verdict', 'reason', 'score', 'vendor', 'outcome'];

/** Flatten tabs/newlines so a field can never break the TSV shape. */
function clean(value) {
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

/** One TSV line (no trailing newline). Throws on missing field or unknown outcome. */
export function formatEntry(entry) {
  for (const col of COLUMNS) {
    if (entry[col] === undefined || entry[col] === null || entry[col] === '') {
      throw new Error(`autonomy-log entry missing required field "${col}"`);
    }
  }
  if (!OUTCOMES.has(entry.outcome)) {
    throw new Error(`unknown outcome "${entry.outcome}" (allowed: ${[...OUTCOMES].join(', ')})`);
  }
  return COLUMNS.map(col => clean(entry[col])).join('\t');
}

/** Log file contents, or '' when the file does not exist yet. */
export function readLogText(root = '.') {
  const file = path.join(root, LOG_PATH);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/**
 * Count `submitted` outcomes whose timestamp date equals `today` (YYYY-MM-DD).
 * Pure function over the raw file text so tests need no filesystem.
 */
export function countTodaySubmitted(text, today) {
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('timestamp\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 8) continue;
    if (cols[7] === 'submitted' && cols[0].slice(0, 10) === today) count++;
  }
  return count;
}

/**
 * Append an entry. Creates data/ and the header line on first write.
 * `now` is injectable for tests. Timestamp is local time ISO-ish without zone
 * (matches how the repo's other TSVs record dates).
 */
export function appendEntry(entry, { root = '.', now = new Date() } = {}) {
  const stamp = entry.timestamp ?? [
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    'T',
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
  ].join('');
  const line = formatEntry({ ...entry, timestamp: stamp });
  const file = path.join(root, LOG_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, LOG_HEADER + '\n');
  appendFileSync(file, line + '\n');
  return { line };
}

// ── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'add') {
    console.error('Usage: node autonomy-log.mjs add --report N --company X --verdict V --reason R --score S --vendor V --outcome O');
    process.exit(2);
  }
  const a = parseArgs(rest);
  try {
    const { line } = appendEntry({
      report_num: a.report, company: a.company, verdict: a.verdict,
      reason: a.reason, score: a.score, vendor: a.vendor, outcome: a.outcome,
    });
    console.log(JSON.stringify({ ok: true, line }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node autonomy-log.test.mjs`
Expected: `8 passed, 0 failed`, exit 0.

- [ ] **Step 5: Smoke-test the CLI (uses a temp root, not the repo's data/)**

```bash
cd /tmp && mkdir -p autonomy-smoke && cd autonomy-smoke
node - <<'EOF'
import { appendEntry, readLogText } from '<ABSOLUTE-REPO-ROOT>/autonomy-log.mjs';
appendEntry({ report_num: '001', company: 'Smoke Co', verdict: 'draft_only', reason: 'tier_off', score: '4.6', vendor: 'lever', outcome: 'drafted' }, { root: '.' });
console.log(readLogText('.'));
EOF
cd - && rm -rf /tmp/autonomy-smoke
```

(Replace `<ABSOLUTE-REPO-ROOT>` with the checkout's absolute path.)
Expected: two lines printed — the header and one `Smoke Co` row.

- [ ] **Step 6: Commit**

```bash
git add autonomy-log.mjs autonomy-log.test.mjs
git commit -m "feat: autonomy audit log module (append-only TSV, daily submit counter)"
```

---

### Task 2: Verdict engine (`autonomy-gate.mjs`)

**Files:**
- Create: `autonomy-gate.mjs`
- Test: `autonomy-gate.test.mjs`

**Interfaces:**
- Consumes (from Task 1): `readLogText`, `countTodaySubmitted` from `./autonomy-log.mjs`.
- Produces (used by Task 4):
  - `DEFAULT_AUTOMATION` — exported defaults object
  - `evaluateGate(input, automationCfg) → {verdict, reason, checks}` — pure function
    - `input`: `{ score: number|string, company: string, vendor: string, runCount: number, todayCount: number, blacklistedCompanies: string[] }`
    - `verdict`: `'auto_submit' | 'draft_only' | 'blocked'`
    - `checks`: array of `{check, pass, detail}` in evaluation order (evaluation stops at first failure)
  - `normalizeCompanyName(name) → string` — lowercase, strip punctuation/whitespace (used for blacklist + allowlist matching)
  - CLI: `node autonomy-gate.mjs --report 042 --company "Acme Corp" --vendor greenhouse --score 4.7 --run-count 0 [--dry-run]` → prints the verdict JSON on stdout. `--dry-run` adds `"dryRun": true` to the output and is otherwise identical (the gate never writes anything anyway; the flag exists so orchestration transcripts are self-documenting).

- [ ] **Step 1: Write the failing test**

Create `autonomy-gate.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node autonomy-gate.test.mjs`
Expected: FAIL — `Cannot find module ... autonomy-gate.mjs` (exit non-zero).

- [ ] **Step 3: Write the implementation**

Create `autonomy-gate.mjs`:

```js
#!/usr/bin/env node
/**
 * autonomy-gate.mjs — deterministic verdict engine for the autonomous pipeline.
 *
 * The gate decides whether ONE evaluated application may be auto-submitted.
 * It reads config/profile.yml (automation: block) + data/blacklist.md +
 * data/autonomy-log.tsv, applies fixed checks in a fixed order, and prints a
 * verdict. It NEVER reads a JD, NEVER calls a model, NEVER touches the network,
 * and NEVER writes anything. All ambiguity degrades to draft_only.
 *
 * Verdict order (first failure wins):
 *   1 tier            → draft_only: tier_off
 *   2 score_threshold → draft_only: below_threshold
 *   3 blacklist       → blocked:    blacklisted
 *   4 allowlist       → draft_only: not_allowlisted
 *   5 vendor          → draft_only: unsafe_vendor
 *   6 daily_cap       → draft_only: daily_cap
 *   7 run_cap         → draft_only: run_cap
 *
 * CLI:
 *   node autonomy-gate.mjs --report 042 --company "Acme Corp" \
 *     --vendor greenhouse --score 4.7 --run-count 0 [--dry-run]
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readLogText, countTodaySubmitted } from './autonomy-log.mjs';

export const DEFAULT_AUTOMATION = {
  tier: 'draft',
  score_threshold: 4.5,
  daily_submit_cap: 3,
  per_run_cap: 2,
  company_allowlist: [],
  safe_vendors: ['greenhouse', 'ashby'],
  schedule_hours: 6,
};

/** Lowercase, strip punctuation, collapse whitespace — for company matching. */
export function normalizeCompanyName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Merge user config over defaults, coercing every field defensively. */
function resolveConfig(automationCfg) {
  const cfg = automationCfg && typeof automationCfg === 'object' ? automationCfg : {};
  return {
    tier: cfg.tier === 'autonomous' ? 'autonomous' : 'draft',
    score_threshold: toNumber(cfg.score_threshold, DEFAULT_AUTOMATION.score_threshold),
    daily_submit_cap: toNumber(cfg.daily_submit_cap, DEFAULT_AUTOMATION.daily_submit_cap),
    per_run_cap: toNumber(cfg.per_run_cap, DEFAULT_AUTOMATION.per_run_cap),
    company_allowlist: Array.isArray(cfg.company_allowlist)
      ? cfg.company_allowlist.filter(x => typeof x === 'string') : [],
    safe_vendors: Array.isArray(cfg.safe_vendors) && cfg.safe_vendors.length > 0
      ? cfg.safe_vendors.filter(x => typeof x === 'string').map(v => v.toLowerCase())
      : DEFAULT_AUTOMATION.safe_vendors,
  };
}

/**
 * Pure verdict function. `input`:
 *   score (number|string), company (string), vendor (string),
 *   runCount (number: submits already made THIS run),
 *   todayCount (number: `submitted` lines dated today in the log),
 *   blacklistedCompanies (string[]: raw names from data/blacklist.md)
 */
export function evaluateGate(input, automationCfg) {
  const cfg = resolveConfig(automationCfg);
  const checks = [];
  const fail = (check, verdict, reason, detail) => {
    checks.push({ check, pass: false, detail });
    return { verdict, reason, checks };
  };
  const pass = (check, detail) => checks.push({ check, pass: true, detail });

  // 1. tier
  if (cfg.tier !== 'autonomous') return fail('tier', 'draft_only', 'tier_off', cfg.tier);
  pass('tier', cfg.tier);

  // 2. score (non-numeric sentinels N/A, —, - fail here)
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < cfg.score_threshold) {
    return fail('score_threshold', 'draft_only', 'below_threshold', `${input.score} < ${cfg.score_threshold}`);
  }
  pass('score_threshold', `${score} >= ${cfg.score_threshold}`);

  // 3. blacklist (blocked, not draft_only — the user said never)
  const company = normalizeCompanyName(input.company);
  const blacklisted = (input.blacklistedCompanies ?? []).map(normalizeCompanyName);
  if (company && blacklisted.includes(company)) {
    return fail('blacklist', 'blocked', 'blacklisted', input.company);
  }
  pass('blacklist', 'not listed');

  // 4. allowlist (empty = disabled)
  const allow = cfg.company_allowlist.map(normalizeCompanyName);
  if (allow.length > 0 && !allow.includes(company)) {
    return fail('allowlist', 'draft_only', 'not_allowlisted', input.company);
  }
  pass('allowlist', allow.length === 0 ? 'disabled' : 'listed');

  // 5. vendor
  const vendor = String(input.vendor ?? '').toLowerCase();
  if (!vendor || !cfg.safe_vendors.includes(vendor)) {
    return fail('vendor', 'draft_only', 'unsafe_vendor', input.vendor || '(unknown)');
  }
  pass('vendor', vendor);

  // 6. daily cap
  const todayCount = toNumber(input.todayCount, Number.MAX_SAFE_INTEGER);
  if (todayCount >= cfg.daily_submit_cap) {
    return fail('daily_cap', 'draft_only', 'daily_cap', `${todayCount}/${cfg.daily_submit_cap}`);
  }
  pass('daily_cap', `${todayCount}/${cfg.daily_submit_cap}`);

  // 7. per-run cap
  const runCount = toNumber(input.runCount, Number.MAX_SAFE_INTEGER);
  if (runCount >= cfg.per_run_cap) {
    return fail('run_cap', 'draft_only', 'run_cap', `${runCount}/${cfg.per_run_cap}`);
  }
  pass('run_cap', `${runCount}/${cfg.per_run_cap}`);

  return { verdict: 'auto_submit', reason: 'ok', checks };
}

// ── filesystem wiring (CLI only) ────────────────────────────────────

function loadAutomationConfig(root = '.') {
  const file = path.join(root, 'config', 'profile.yml');
  if (!existsSync(file)) return undefined; // resolves to tier: draft
  try {
    const profile = yaml.load(readFileSync(file, 'utf8'));
    return profile?.automation;
  } catch {
    return undefined; // unreadable config degrades to draft — never to submit
  }
}

/** Company names from data/blacklist.md: first cell of each table row. */
export function loadBlacklistCompanies(root = '.') {
  const file = path.join(root, 'data', 'blacklist.md');
  if (!existsSync(file)) return [];
  const names = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const cell = m[1].trim();
    if (!cell || /^-+$/.test(cell) || /^company$/i.test(cell)) continue;
    names.push(cell);
  }
  return names;
}

function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.company || a.score === undefined || a['run-count'] === undefined) {
    console.error('Usage: node autonomy-gate.mjs --report N --company X --vendor V --score S --run-count N [--dry-run]');
    process.exit(2);
  }
  const result = evaluateGate({
    score: a.score,
    company: a.company,
    vendor: a.vendor ?? '',
    runCount: Number(a['run-count']),
    todayCount: countTodaySubmitted(readLogText('.'), localToday()),
    blacklistedCompanies: loadBlacklistCompanies('.'),
  }, loadAutomationConfig('.'));
  console.log(JSON.stringify({ report: a.report ?? null, ...result, ...(a.dryRun ? { dryRun: true } : {}) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node autonomy-gate.test.mjs`
Expected: `25 passed, 0 failed`, exit 0.

- [ ] **Step 5: Smoke-test the CLI against the real repo (no config yet ⇒ tier off)**

Run from the repo root:
```bash
node autonomy-gate.mjs --report 001 --company "Acme" --vendor greenhouse --score 4.9 --run-count 0
```
Expected stdout (single line): `{"report":"001","verdict":"draft_only","reason":"tier_off","checks":[{"check":"tier","pass":false,"detail":"draft"}]}` — proving the gate is inert until the user opts in.

- [ ] **Step 6: Commit**

```bash
git add autonomy-gate.mjs autonomy-gate.test.mjs
git commit -m "feat: deterministic autonomy gate (7 ordered checks, fail-to-draft)"
```

---

### Task 3: Config plumbing (`.gitignore`, `config/profile.example.yml`)

**Files:**
- Modify: `.gitignore` (the `data/` block — find it with `grep -n "^data/" .gitignore`)
- Modify: `config/profile.example.yml` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: the documented `automation:` YAML shape that Task 2's `loadAutomationConfig` reads and Task 4's mode file references.

- [ ] **Step 1: Add the log file to `.gitignore`**

In `.gitignore`, find the existing `data/` entries (e.g. the line `data/scan-history.tsv`) and add this line alongside them:

```
data/autonomy-log.tsv
```

- [ ] **Step 2: Verify git ignores it**

```bash
touch data/autonomy-log.tsv
git check-ignore data/autonomy-log.tsv && echo IGNORED
rm data/autonomy-log.tsv
```
Expected: prints `data/autonomy-log.tsv` then `IGNORED`.

- [ ] **Step 3: Append the automation block to `config/profile.example.yml`**

Append verbatim at the end of the file:

```yaml

# -- Autonomous pipeline (optional) --------------------------------
# Controls unattended auto-submission. With this block absent, or with
# tier: draft, NOTHING is ever submitted automatically — identical to
# default career-ops behavior. Flip tier to "autonomous" only after
# reading modes/autonomous-pipeline.md and dry-running the gate.
#
# automation:
#   tier: draft            # draft | autonomous — the master kill switch
#   score_threshold: 4.5   # min evaluation score for auto-submit eligibility
#   daily_submit_cap: 3    # max auto-submits per calendar day
#   per_run_cap: 2         # max auto-submits per scheduled run
#   company_allowlist: []  # empty = any company eligible; non-empty = ONLY these
#   safe_vendors: [greenhouse, ashby]  # ATS vendors proven scriptable end-to-end
#   schedule_hours: 6      # suggested cadence for /loop or cron
```

- [ ] **Step 4: Verify the example file still parses as YAML**

```bash
node -e "import('js-yaml').then(y => { y.default.load(require('fs').readFileSync('config/profile.example.yml','utf8')); console.log('YAML OK'); })" 2>/dev/null || node --input-type=module -e "import yaml from 'js-yaml'; import {readFileSync} from 'fs'; yaml.load(readFileSync('config/profile.example.yml','utf8')); console.log('YAML OK');"
```
Expected: `YAML OK`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore config/profile.example.yml
git commit -m "chore: gitignore autonomy log, document automation config block"
```

---

### Task 4: Orchestrator mode (`modes/autonomous-pipeline.md`)

**Files:**
- Create: `modes/autonomous-pipeline.md`

**Interfaces:**
- Consumes: `autonomy-gate.mjs` CLI and `autonomy-log.mjs` CLI exactly as specified in Tasks 1–2; existing scripts `scan.mjs`, `reserve-report-num.mjs`, `set-status.mjs`, `followup-seed.mjs`, `merge-tracker.mjs`, `application-answers.mjs`; existing modes `auto-pipeline.md`, `apply.md`, `pdf.md`.
- Produces: the mode the user (or a cron/`/loop` entry) invokes as "Run career-ops autonomous-pipeline mode".

This task is prose, not code — there is no test file. Verification is Step 2's checklist.

- [ ] **Step 1: Create `modes/autonomous-pipeline.md` with exactly this content**

````markdown
# Mode: autonomous-pipeline — Scheduled Scan → Evaluate → Gated Auto-Submit

Runs the full pipeline unattended on a schedule. The agent does judgment
(reading, scoring, drafting, driving the browser); `autonomy-gate.mjs` does
every cap/threshold/allow-list decision. **The gate's verdict is final for the
run — the agent never overrides `draft_only` or `blocked`, and never retries a
gated application within the same run.**

Enabled only when `config/profile.yml` has `automation.tier: autonomous`.
If the block is absent or `tier` is `draft`, run steps 1–2 only (scan +
evaluate + draft) and stop — that is the zero-touch-until-submit tier.

## Per-tick flow

1. **Scan.** Run `node scan.mjs`. New matches land in `data/pipeline.md`.
2. **Evaluate.** For each pending `data/pipeline.md` entry, run the full
   `auto-pipeline` mode (`modes/auto-pipeline.md`): liveness gate, blacklist
   gate, A–G evaluation, report, PDF, tracker TSV. Reserve report numbers via
   `node reserve-report-num.mjs` exactly as `modes/batch.md` prescribes.
   Respect the batch pre-screen gate and spend tier.
3. **Gate.** For each evaluation that produced a report, determine the ATS
   vendor from the APPLICATION form's hostname (after following any Apply
   redirect — see `modes/apply.md` "Job-board host ≠ application host"):
   `greenhouse.io`/`job-boards.greenhouse.io` → `greenhouse` ·
   `ashbyhq.com` → `ashby` · `lever.co` → `lever` ·
   `myworkdayjobs.com` → `workday` · anything else → `other`.
   Then run:

   ```bash
   node autonomy-gate.mjs --report {num} --company "{company}" \
     --vendor {vendor} --score {score} --run-count {submits_so_far_this_run}
   ```

4. **Act on the verdict.**
   - **`auto_submit`** → attempt a headless Playwright submission following
     `modes/apply.md` in full (preflight, blacklist, cross-channel, knock-out
     pre-scan, ATS quirks). The following are HARD ABORT conditions — abort
     the submit, keep safely-filled fields, and treat the application as
     `draft_only`:
       - any knock-out question detected (`submit_aborted_knockout`)
       - any legal / demographic / work-authorization / visa / sponsorship /
         salary / disability / veteran / background-check / self-identification
         field whose answer is not explicitly present in `config/profile.yml`
         (`submit_aborted_sensitive_field`)
       - any captcha (`submit_failed_captcha`) — NEVER attempt to bypass
       - any vendor-quirk failure or Playwright error (`submit_failed_error`)
     On successful submission:
       1. `node set-status.mjs {num} Applied`
       2. `node followup-seed.mjs {num} --json`
       3. `node application-answers.mjs --report reports/{file} --input {answers}.json --state submitted`
   - **`draft_only`** → save the report + `## H) Draft Application Answers`
     (per `modes/auto-pipeline.md` Step 4) and leave status `Evaluated`.
   - **`blocked`** → do nothing further with this application.
5. **Log.** After EVERY verdict, append the outcome:

   ```bash
   node autonomy-log.mjs add --report {num} --company "{company}" \
     --verdict {verdict} --reason {reason} --score {score} \
     --vendor {vendor} --outcome {outcome}
   ```

   `outcome` is `submitted`, `drafted`, `blocked`, or one of the abort codes
   above. **If this log append fails while a submit is pending, DO NOT
   submit** — an unauditable submission must not happen. Log verdicts you
   could not act on with the closest matching outcome.
6. **Merge.** `node merge-tracker.mjs` once at end of run.
7. **Summary.** End the run with a two-pile summary for the user's next
   check-in: "Sent for you" (submitted, with scores and times) and "Waiting
   on you" (drafts, each with its hold reason from the gate/abort).

## Failure posture

Every failure degrades toward LESS automation, never more. Unreadable config,
gate error, log error, browser crash → the application stays a draft. There
is no retry-of-submit within a run. A posting that failed submission is
eligible again only after the user reviews it.

## Scheduling

- `/loop`-capable CLI: recurring tick every `automation.schedule_hours` hours.
- cron: `0 */6 * * * cd <repo-root> && <headless-cmd> "Run career-ops autonomous-pipeline mode"`
  (see AGENTS.md → Headless / Batch Mode for the per-CLI command).
- Assumption: ONE tick at a time. Do not schedule overlapping runs; the
  per-run counter is per-invocation and the daily counter is derived from the
  log at gate time.

## Optional discovery source: Apify

With `APIFY_TOKEN` in `.env`, `config/plugins.yml` enabling `apify`, and a
`provider: apify` entry in `portals.yml` (see `plugins/apify/skill.md`),
step 1 automatically includes Apify results. Cap the actor's `maxItems`
conservatively — every scheduled tick costs actor-run money.
````

- [ ] **Step 2: Verify the mode file's cross-references all exist**

```bash
for f in scan.mjs reserve-report-num.mjs set-status.mjs followup-seed.mjs merge-tracker.mjs application-answers.mjs autonomy-gate.mjs autonomy-log.mjs modes/auto-pipeline.md modes/apply.md modes/batch.md plugins/apify/skill.md; do
  [ -e "$f" ] && echo "OK  $f" || echo "MISSING  $f"
done
```
Expected: twelve `OK` lines, zero `MISSING`.

- [ ] **Step 3: Commit**

```bash
git add modes/autonomous-pipeline.md
git commit -m "feat: autonomous-pipeline orchestrator mode (gated auto-submit)"
```

---

### Task 5: Register the mode in `AGENTS.md`

**Files:**
- Modify: `AGENTS.md` — two single-row insertions.

**Interfaces:**
- Consumes: the mode name `autonomous-pipeline` from Task 4 and the two script names from Tasks 1–2.
- Produces: discoverability — the agent-facing router now routes to the new mode.

- [ ] **Step 1: Add a Skill Modes row**

In `AGENTS.md`, find the Skill Modes table (`grep -n "Skill Modes" AGENTS.md`). Add this row directly after the `batch` row (`| Batch processes offers | \`batch\` |`):

```markdown
| Wants scheduled unattended runs with gated auto-submit | `autonomous-pipeline` — scan → evaluate → draft; submits only what passes `autonomy-gate.mjs` (opt-in via `automation.tier: autonomous`) |
```

- [ ] **Step 2: Add a Main Files row**

In the Main Files table (`grep -n "Main Files" AGENTS.md`), add after the `set-status.mjs` row:

```markdown
| `autonomy-gate.mjs` | Deterministic auto-submit verdict: 7 ordered checks (tier, score, blacklist, allowlist, vendor, daily cap, run cap), fail-to-draft (JSON) |
| `autonomy-log.mjs` | Append-only autonomy audit log (`data/autonomy-log.tsv`); daily submit counter source for the gate |
```

- [ ] **Step 3: Verify the tables still render (pipe balance)**

```bash
grep -n "autonomy-gate.mjs\|autonomous-pipeline" AGENTS.md
```
Expected: 3 matching lines (one mode row, two file rows).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: register autonomous-pipeline mode and autonomy scripts in AGENTS.md"
```

---

### Task 6: End-to-end dry-run verification

**Files:** none created — this task validates the integrated behavior.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: recorded evidence (command output) that the default posture is inert and the gate + log round-trip works.

- [ ] **Step 1: Run both test suites**

```bash
node autonomy-log.test.mjs && node autonomy-gate.test.mjs
```
Expected: both end `... 0 failed`, overall exit 0.

- [ ] **Step 2: Verify default posture is inert (no `automation:` block exists yet)**

```bash
node autonomy-gate.mjs --report 999 --company "Anywhere Inc" --vendor greenhouse --score 5.0 --run-count 0
```
Expected: verdict `draft_only`, reason `tier_off` — a perfect-score application still cannot auto-submit until the user opts in.

- [ ] **Step 3: Round-trip the counter**

```bash
node autonomy-log.mjs add --report 998 --company "Counter Test" --verdict auto_submit --reason ok --score 4.8 --vendor greenhouse --outcome submitted
node --input-type=module -e "import {readLogText, countTodaySubmitted} from './autonomy-log.mjs'; const t=new Date(); const d=\`\${t.getFullYear()}-\${String(t.getMonth()+1).padStart(2,'0')}-\${String(t.getDate()).padStart(2,'0')}\`; console.log('today submitted:', countTodaySubmitted(readLogText('.'), d));"
```
Expected: `today submitted: 1`.

- [ ] **Step 4: Clean the test artifact**

```bash
rm data/autonomy-log.tsv
git status --short
```
Expected: `git status` shows a clean tree (the log was gitignored anyway; removing it keeps the checkout pristine for the user's first real run).

- [ ] **Step 5: Commit any straggler and finish**

```bash
git status --short   # expect empty; nothing to commit for this task
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** config block → Task 3; gate order 1–7 → Task 2 (tests assert each reason string and the ordering); audit log schema + counter-from-log → Task 1; orchestrator flow incl. hard aborts, log-before-submit rule, two-pile summary → Task 4; scheduling + single-tick assumption → Task 4; Apify config steps → Task 4 (mode file) — no code, per spec; AGENTS.md registration → Task 5; inert-by-default proof → Tasks 2/6.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; the one `<ABSOLUTE-REPO-ROOT>` token in Task 1 Step 5 is an instruction to substitute a path, with the substitution stated.
- **Type consistency:** `formatEntry/appendEntry/countTodaySubmitted/readLogText` names match between Task 1 definition, Task 2 imports, and Task 4 CLI usage; reason strings (`tier_off`, `below_threshold`, `blacklisted`, `not_allowlisted`, `unsafe_vendor`, `daily_cap`, `run_cap`) are identical in Task 2 code, tests, and Task 4 prose; outcome strings match `OUTCOMES` exactly.
