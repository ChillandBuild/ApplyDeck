#!/usr/bin/env node

/**
 * run-scheduled-automation.mjs — Standing runner for scheduled job search discovery.
 *
 * Executes both scan.mjs (ATS network + scheduled Apify search) and
 * web-search-run.mjs --write (scheduled Serper web search) on the configured schedule.
 *
 * Usage:
 *   node run-scheduled-automation.mjs
 *   node run-scheduled-automation.mjs --dry-run
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

function runSubscript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const child = spawn(process.execPath, [path.join(root, scriptName), ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

export async function runScheduledAutomation(options = {}) {
  const args = options.dryRun ? ['--dry-run'] : [];

  console.log('🤖 Starting scheduled automation run...');

  // 1. Run scan.mjs (ATS scan + scheduled Apify fan-out)
  console.log('\n--- Step 1: ATS Network & Scheduled Apify Scan ---');
  try {
    await (options.runScanFn ? options.runScanFn(args) : runSubscript('scan.mjs', args));
  } catch (err) {
    console.error(`Warning: ATS/Apify scan encountered error: ${err.message}`);
  }

  // 2. Run web-search-run.mjs --write (Scheduled web search)
  console.log('\n--- Step 2: Scheduled Serper Web Search ---');
  try {
    const webArgs = ['--write', ...args];
    await (options.runWebSearchFn ? options.runWebSearchFn(webArgs) : runSubscript('web-search-run.mjs', webArgs));
  } catch (err) {
    console.error(`Warning: Web search run encountered error: ${err.message}`);
  }

  console.log('\n✅ Scheduled automation run complete.');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  runScheduledAutomation({ dryRun }).catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
