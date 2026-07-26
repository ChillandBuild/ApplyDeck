#!/usr/bin/env node

/**
 * explore-apify.mjs — spawned by the web app's /api/explore/apify route to
 * run selected Apify discovery jobs live, on demand, and stream NDJSON progress.
 *
 * Supports:
 *   node explore-apify.mjs --platforms
 *     Prints platform metadata JSON array for the web UI composer.
 *
 *   node explore-apify.mjs --jobs <path-to-json-file>
 *     Takes a JSON array of job descriptors [{ platform, query, location, country, max }].
 *     Resolves actor/input/field_map from apify-platforms.mjs registry and runs them.
 *
 *   node explore-apify.mjs --entries <path-to-json-file>
 *     Legacy mode: takes pre-built portals.yml provider:apify entries.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { runActor } from './plugins/apify/_apify.mjs';
import { normalizeItem, isHttpsUrl } from './plugins/apify/index.mjs';
import { PLATFORMS, platformMeta } from './apify-platforms.mjs';

/** Map one raw Apify dataset item to a DiscoveredOffer, or null if unusable. */
export function mapItem(item, entry) {
  const normalized = normalizeItem(item, entry.field_map, entry.defaults, entry.urlBase);
  if (!normalized.title || !normalized.url || !isHttpsUrl(normalized.url)) return null;
  return { ...normalized, postedAt: '', ats: entry.name, source: 'apify' };
}

/** Convert a job descriptor { platform, query, location, country, max } to an executable entry. */
export function jobToEntry(job) {
  const p = PLATFORMS[job.platform];
  if (!p) throw new Error(`Unknown platform: ${job.platform}`);
  const name = `${p.label} — "${job.query}"`;
  const input = p.buildInput(job);
  return {
    name,
    actor: p.actor,
    input,
    field_map: p.field_map,
    urlBase: p.urlBase,
  };
}

/** Run one entry's actor and emit its events. Never throws. */
export async function processEntry(entry, token, emit, deps = {}) {
  const runActorFn = deps.runActorFn || runActor;
  emit({ kind: 'sourceStart', source: entry.name });
  try {
    const opts = { token };
    if (entry.timeout_ms != null) opts.timeoutMs = entry.timeout_ms;
    const items = await runActorFn(entry.actor, entry.input || {}, opts);
    let count = 0;
    for (const item of items) {
      const offer = mapItem(item, entry);
      if (offer) {
        emit({ kind: 'offer', offer });
        count++;
      }
    }
    emit({ kind: 'sourceDone', source: entry.name, count });
    return count;
  } catch (err) {
    emit({ kind: 'sourceError', source: entry.name, message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** Run every entry IN PARALLEL. */
export async function runAll(entries, token, emit, deps = {}) {
  const collected = [];
  const collectingEmit = (e) => {
    if (e.kind === 'offer') collected.push(e.offer);
    emit(e);
  };
  await Promise.allSettled(entries.map((entry) => processEntry(entry, token, collectingEmit, deps)));
  return collected;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);

  if (args.includes('--platforms')) {
    process.stdout.write(JSON.stringify(platformMeta()) + '\n');
    process.exit(0);
  }

  try {
    const { config } = await import('dotenv');
    config({ quiet: true });
  } catch {
    // dotenv is optional
  }

  const jobsFlagIdx = args.indexOf('--jobs');
  const jobsPath = jobsFlagIdx >= 0 ? args[jobsFlagIdx + 1] : null;

  const entriesFlagIdx = args.indexOf('--entries');
  const entriesPath = entriesFlagIdx >= 0 ? args[entriesFlagIdx + 1] : null;

  if (!jobsPath && !entriesPath) {
    process.stderr.write('explore-apify.mjs: missing required --jobs <path> or --entries <path> or --platforms\n');
    process.exit(1);
  }

  let entries = [];
  try {
    if (jobsPath) {
      const rawJobs = JSON.parse(readFileSync(jobsPath, 'utf8'));
      if (!Array.isArray(rawJobs)) throw new Error('jobs file must contain a JSON array');
      entries = rawJobs.map(jobToEntry);
    } else if (entriesPath) {
      entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('entries file must contain a JSON array');
    }
  } catch (err) {
    process.stderr.write(`explore-apify.mjs: could not read input file: ${err.message}\n`);
    process.exit(1);
  }

  const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');
  const token = process.env.APIFY_TOKEN || '';
  const offers = await runAll(entries, token, emit);
  emit({ kind: 'done', count: offers.length, offers });
}
