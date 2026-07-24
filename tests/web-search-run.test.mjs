// tests/web-search-run.test.mjs — Unit tests for web-search-run.mjs.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nweb-search-run.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'web-search-run.mjs')).href);
const { mapSerperItem, processQuery, runAllQueries } = mod;

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
