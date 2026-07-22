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
