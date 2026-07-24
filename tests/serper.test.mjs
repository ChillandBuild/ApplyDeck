// tests/serper.test.mjs — Unit tests for plugins/serper/index.mjs Serper search provider.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nplugins/serper/index.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'plugins/serper/index.mjs')).href);
const { runSerperQuery } = mod;

// Throws error if apiKey is missing
{
  try {
    await runSerperQuery('site:greenhouse.io "Data Engineer"', { apiKey: '' });
    fail('runSerperQuery() should throw error when apiKey is empty');
  } catch (err) {
    if (/SERPER_API_KEY is required/i.test(err.message)) {
      pass('runSerperQuery() throws error when apiKey is missing');
    } else {
      fail(`runSerperQuery() error message mismatch: ${err.message}`);
    }
  }
}

// Returns [] when query is empty
{
  const res = await runSerperQuery('', { apiKey: 'test_key' });
  if (Array.isArray(res) && res.length === 0) {
    pass('runSerperQuery() returns empty array for empty query string');
  } else {
    fail(`runSerperQuery() empty query failed: ${JSON.stringify(res)}`);
  }
}
