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
