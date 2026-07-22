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
