// tests/web-search-run.test.mjs — Unit tests for web-search-run.mjs.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nweb-search-run.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'web-search-run.mjs')).href);
const { mapSerperItem, processQuery, runAllQueries, writeWebSearchResults } = mod;
const { normalizeCompany } = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);

// mapSerperItem — pure mapping
{
  const offer = mapSerperItem({ title: 'Senior ML Engineer - Google', link: 'https://careers.google.com/jobs/1', snippet: 'Great role' }, 'Google Query');
  if (offer && offer.title === 'Senior ML Engineer - Google' && offer.company === 'Google' && offer.url === 'https://careers.google.com/jobs/1' && offer.source === 'web-search') {
    pass('mapSerperItem() maps Serper organic result to DiscoveredOffer with source="web-search"');
  } else {
    fail(`mapSerperItem() returned unexpected offer: ${JSON.stringify(offer)}`);
  }
}

{
  const offer = mapSerperItem({ title: 'Bad item', link: 'http://insecure.example.com/j/1' }, 'Query');
  if (offer === null) {
    pass('mapSerperItem() rejects non-HTTPS URLs');
  } else {
    fail(`mapSerperItem() accepted non-HTTPS URL: ${JSON.stringify(offer)}`);
  }
}

// processQuery — DI test with stubbed runQueryFn
{
  const events = [];
  const fakeRunQuery = async (query, opts) => {
    if (query === 'site:greenhouse.io "ML Engineer"' && opts.apiKey === 'key123') {
      return [{ title: 'ML Engineer - Acme', link: 'https://boards.greenhouse.io/acme/jobs/100', snippet: 'Job description' }];
    }
    throw new Error('Unexpected call');
  };

  const queryObj = { name: 'Greenhouse ML', query: 'site:greenhouse.io "ML Engineer"' };
  await processQuery(queryObj, 'key123', (e) => events.push(e), { runQueryFn: fakeRunQuery });

  const kinds = events.map((e) => e.kind);
  if (kinds[0] === 'sourceStart' && kinds.includes('offer') && kinds.at(-1) === 'sourceDone') {
    pass('processQuery() emits sourceStart, offer, and sourceDone on success');
  } else {
    fail(`processQuery() event sequence error: ${JSON.stringify(kinds)}`);
  }
}

// writeWebSearchResults — dedupe, blacklist (via normalizeCompany, not raw
// .toLowerCase()), note+status marked unverified, and both writers invoked
// with the unverified status so it actually lands in pipeline.md/scan-history.tsv
// (per AGENTS.md: web/Level-3 hits are stale-prone and must be marked).
{
  const rawOffers = [
    { title: 'ML Engineer', url: 'https://example.com/j/1', company: 'Acme' },
    { title: 'ML Engineer Dup', url: 'https://example.com/j/1', company: 'Acme' },
    { title: 'Blacklisted Job', url: 'https://example.com/j/2', company: 'Bad Corp, Inc.' },
    { title: 'Fresh Job', url: 'https://example.com/j/3', company: 'GoodCorp' },
  ];

  let pipeAppended = [];
  let histAppended = [];
  let histStatus = null;
  const fakeLoadSeen = () => new Set();
  const fakeLoadBlack = () => new Map([[normalizeCompany('Bad Corp, Inc.'), { company: 'Bad Corp, Inc.' }]]);
  const fakePipe = (items) => { pipeAppended = items; };
  const fakeHist = (items, date, status) => { histAppended = items; histStatus = status; };

  const survivors = writeWebSearchResults(rawOffers, {
    loadSeenUrlsFn: fakeLoadSeen,
    loadBlacklistFn: fakeLoadBlack,
    appendToPipelineFn: fakePipe,
    appendToScanHistoryFn: fakeHist,
    dryRun: false,
  });

  const marked = survivors.length === 2
    && survivors[0].company === 'Acme'
    && survivors[1].company === 'GoodCorp'
    && survivors[0].status === 'unverified'
    && typeof survivors[0].note === 'string' && survivors[0].note.includes('unverified');

  if (marked) {
    if (pipeAppended.length === 2 && histAppended.length === 2 && histStatus === 'unverified') {
      pass('writeWebSearchResults() dedupes URLs, filters blacklisted companies via normalizeCompany(), marks unverified, and writes it through to both writers');
    } else {
      fail(`writeWebSearchResults() failed to invoke writers correctly: pipe=${pipeAppended.length}, hist=${histAppended.length}, histStatus=${histStatus}`);
    }
  } else {
    fail(`writeWebSearchResults() returned unexpected survivors: ${JSON.stringify(survivors)}`);
  }
}
