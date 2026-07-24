// tests/apify-platforms.test.mjs — Unit tests for apify-platforms.mjs platform registry and fan-out expander.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\napify-platforms.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'apify-platforms.mjs')).href);
const { PLATFORMS, platformMeta, expand } = mod;

// PLATFORMS contains expected platforms
{
  if (PLATFORMS.indeed && PLATFORMS.linkedin && PLATFORMS.glassdoor && PLATFORMS.naukri) {
    pass('PLATFORMS exports expected 4 platform definitions (indeed, linkedin, glassdoor, naukri)');
  } else {
    fail(`PLATFORMS keys missing: ${Object.keys(PLATFORMS).join(', ')}`);
  }
}

// platformMeta returns cost-labeled metadata
{
  const meta = platformMeta();
  if (Array.isArray(meta) && meta.length === 4) {
    const linkedin = meta.find((p) => p.id === 'linkedin');
    const indeed = meta.find((p) => p.id === 'indeed');
    if (linkedin && linkedin.cost === 'rental' && indeed && indeed.cost === 'usage') {
      pass('platformMeta() returns correct platform metadata array with cost labels');
    } else {
      fail(`platformMeta() content error: ${JSON.stringify(meta)}`);
    }
  } else {
    fail(`platformMeta() did not return 4 items: ${JSON.stringify(meta)}`);
  }
}

// expand fans out keywords × platforms
{
  const jobs = expand(['Software Engineer', 'Data Scientist'], ['indeed', 'linkedin'], { location: 'Remote', country: 'US', max: 15 });
  if (jobs.length === 4) {
    const job0 = jobs[0];
    if (job0.platform === 'indeed' && job0.query === 'Software Engineer' && job0.location === 'Remote' && job0.max === 15) {
      pass('expand() fans out N keywords × M platforms correctly into job definitions');
    } else {
      fail(`expand() job shape error: ${JSON.stringify(job0)}`);
    }
  } else {
    fail(`expand() expected 4 jobs, got ${jobs.length}`);
  }
}

// expand handles edge cases (empty input, invalid platform)
{
  const jobs = expand([''], ['invalid_platform', 'indeed'], {});
  if (jobs.length === 0) {
    pass('expand() filters empty keywords and invalid platform IDs gracefully');
  } else {
    fail(`expand() unexpected output for invalid inputs: ${JSON.stringify(jobs)}`);
  }
}
