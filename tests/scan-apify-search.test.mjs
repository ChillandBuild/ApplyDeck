// tests/scan-apify-search.test.mjs — Unit tests for scan.mjs's runApifySearchScan fan-out.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan-apify-search.test.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const { runApifySearchScan } = mod;
const { normalizeCompany } = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);

const DOC_WITH_APIFY = {
  apify_search: {
    enabled: true,
    keywords: ['Machine Learning'],
    platforms: ['indeed'],
    location: 'Remote',
    max: 10,
  },
};

// runApifySearchScan returns [] when apify_search is disabled or missing
{
  const res = await runApifySearchScan({ apify_search: { enabled: false } }, 'tok');
  if (Array.isArray(res) && res.length === 0) {
    pass('runApifySearchScan() returns empty array when apify_search is disabled');
  } else {
    fail(`runApifySearchScan() disabled failed: ${JSON.stringify(res)}`);
  }
}

// runApifySearchScan fans out jobs and returns mapped/filtered offers
{
  const fakeRunActor = async (actor, input, opts) => {
    return [
      { title: 'Machine Learning Engineer', url: 'https://example.com/j/1', company: 'Acme', location: 'Remote' },
      { title: 'Sales Rep', url: 'https://example.com/j/2', company: 'Acme', location: 'Remote' },
    ];
  };

  const titleFilter = (t) => t.includes('Machine Learning');
  const offers = await runApifySearchScan(DOC_WITH_APIFY, 'tok', {
    runActorFn: fakeRunActor,
    titleFilter,
  });

  if (offers.length === 1 && offers[0].title === 'Machine Learning Engineer') {
    pass('runApifySearchScan() fans out jobs via registry and filters output by titleFilter');
  } else {
    fail(`runApifySearchScan() returned unexpected offers: ${JSON.stringify(offers)}`);
  }
}

// runApifySearchScan filters out blacklisted companies, matched via the same
// normalizeCompany() key loadBlacklist() uses — not a raw .toLowerCase(), so a
// punctuated company name ("Bad Corp, Inc.") still matches a blacklist row
// parsed from "Bad Corp, Inc." (#1742's normalization contract).
{
  const fakeRunActor = async (actor, input, opts) => {
    return [
      { title: 'Machine Learning Engineer', url: 'https://example.com/j/1', company: 'Acme', location: 'Remote' },
      { title: 'Machine Learning Lead', url: 'https://example.com/j/2', company: 'Bad Corp, Inc.', location: 'Remote' },
    ];
  };

  const blacklist = new Map([[normalizeCompany('Bad Corp, Inc.'), { company: 'Bad Corp, Inc.' }]]);
  const offers = await runApifySearchScan(DOC_WITH_APIFY, 'tok', {
    runActorFn: fakeRunActor,
    blacklist,
  });

  if (offers.length === 1 && offers[0].company === 'Acme') {
    pass('runApifySearchScan() filters out blacklisted companies via normalizeCompany()');
  } else {
    fail(`runApifySearchScan() failed blacklist filter: ${JSON.stringify(offers)}`);
  }
}
