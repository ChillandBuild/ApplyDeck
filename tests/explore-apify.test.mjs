// tests/explore-apify.test.mjs — DI-based tests for explore-apify.mjs's
// event-emission contract. No real Apify calls: runActorFn is stubbed.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nexplore-apify.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'explore-apify.mjs')).href);
const { processEntry, mapItem, runAll, jobToEntry } = mod;

const ENTRY = {
  name: 'LinkedIn — India (via Apify)',
  actor: 'bebity/linkedin-jobs-scraper',
  input: { keywords: 'Data Scientist' },
  field_map: { title: 'title', url: 'url', company: 'company', location: 'location' },
};

// jobToEntry — converts job spec to executable entry
{
  const entry = jobToEntry({ platform: 'indeed', query: 'Frontend Dev', location: 'Austin', country: 'US', max: 10 });
  if (entry.name === 'Indeed — "Frontend Dev"' && entry.actor === 'misceres/indeed-scraper' && entry.input.position === 'Frontend Dev' && entry.input.maxItems === 10) {
    pass('jobToEntry() maps job descriptor to executable entry using platform registry');
  } else {
    fail(`jobToEntry() generated unexpected entry: ${JSON.stringify(entry)}`);
  }
}

// mapItem — pure mapping, no network.
{
  const offer = mapItem({ title: 'ML Engineer', url: 'https://example.com/j/1', company: 'Acme', location: 'Remote' }, ENTRY);
  if (offer && offer.title === 'ML Engineer' && offer.url === 'https://example.com/j/1' && offer.ats === ENTRY.name && offer.source === 'apify') {
    pass('mapItem() maps a dataset item to a DiscoveredOffer with ats=entry.name, source="apify"');
  } else {
    fail(`mapItem() returned ${JSON.stringify(offer)}`);
  }
}
{
  const offer = mapItem({ title: 'No URL Here' }, ENTRY);
  if (offer === null) pass('mapItem() returns null for an item missing a usable url');
  else fail(`mapItem() should have rejected a url-less item, got ${JSON.stringify(offer)}`);
}
{
  const offer = mapItem({ title: 'Bad scheme', url: 'javascript:alert(1)' }, ENTRY);
  if (offer === null) pass('mapItem() rejects a non-https url');
  else fail(`mapItem() should have rejected a javascript: url, got ${JSON.stringify(offer)}`);
}

// processEntry — success path, injected runActorFn.
{
  const events = [];
  const fakeRunActor = async (actor, input, opts) => {
    if (actor === ENTRY.actor && opts.token === 'tok') {
      return [
        { title: 'A', url: 'https://x.example/a', company: 'X', location: 'Remote' },
        { title: 'B', url: 'https://x.example/b', company: 'X', location: 'Remote' },
      ];
    }
    throw new Error('unexpected call');
  };
  await processEntry(ENTRY, 'tok', (e) => events.push(e), { runActorFn: fakeRunActor });
  const kinds = events.map((e) => e.kind);
  if (kinds[0] === 'sourceStart' && kinds.includes('offer') && kinds.at(-1) === 'sourceDone') {
    pass('processEntry() emits sourceStart, offer(s), then sourceDone on success');
  } else {
    fail(`processEntry() success-path event kinds: ${JSON.stringify(kinds)}`);
  }
  const done = events.find((e) => e.kind === 'sourceDone');
  if (done && done.count === 2) pass('processEntry() sourceDone.count matches the number of mapped offers');
  else fail(`processEntry() sourceDone was ${JSON.stringify(done)}`);
}

// processEntry — failure path, one bad source must not throw.
{
  const events = [];
  const failingRunActor = async () => {
    throw new Error('Apify run failed: TIMED-OUT');
  };
  await processEntry(ENTRY, 'tok', (e) => events.push(e), { runActorFn: failingRunActor });
  const err = events.find((e) => e.kind === 'sourceError');
  if (err && /TIMED-OUT/.test(err.message) && err.source === ENTRY.name) {
    pass('processEntry() emits sourceError (not a throw) when runActorFn rejects');
  } else {
    fail(`processEntry() failure-path events: ${JSON.stringify(events)}`);
  }
}

// runAll — one entry fails, one succeeds; both must be represented, in parallel.
{
  const events = [];
  const entries = [ENTRY, { ...ENTRY, name: 'Naukri — India (via Apify)', actor: 'other/actor' }];
  const mixedRunActor = async (actor) => {
    if (actor === 'other/actor') throw new Error('boom');
    return [{ title: 'C', url: 'https://x.example/c', company: 'X', location: '' }];
  };
  const offers = await runAll(entries, 'tok', (e) => events.push(e), { runActorFn: mixedRunActor });
  const sourceDone = events.filter((e) => e.kind === 'sourceDone');
  const sourceError = events.filter((e) => e.kind === 'sourceError');
  if (sourceDone.length === 1 && sourceError.length === 1 && offers.length === 1) {
    pass('runAll() lets one source error while the other succeeds, returning only successful offers');
  } else {
    fail(`runAll() mixed-result: sourceDone=${sourceDone.length} sourceError=${sourceError.length} offers=${offers.length}`);
  }
}
