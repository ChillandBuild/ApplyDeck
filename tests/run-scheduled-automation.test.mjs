// tests/run-scheduled-automation.test.mjs — Unit tests for run-scheduled-automation.mjs.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrun-scheduled-automation.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'run-scheduled-automation.mjs')).href);
const { runScheduledAutomation } = mod;

{
  let scanCalled = false;
  let webCalled = false;

  const fakeRunScan = async (args) => {
    if (args.includes('--dry-run')) scanCalled = true;
  };
  const fakeRunWeb = async (args) => {
    if (args.includes('--write') && args.includes('--dry-run')) webCalled = true;
  };

  await runScheduledAutomation({
    dryRun: true,
    runScanFn: fakeRunScan,
    runWebSearchFn: fakeRunWeb,
  });

  if (scanCalled && webCalled) {
    pass('runScheduledAutomation() invokes both scan.mjs and web-search-run.mjs --write with options');
  } else {
    fail(`runScheduledAutomation() failed: scanCalled=${scanCalled}, webCalled=${webCalled}`);
  }
}
