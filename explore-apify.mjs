#!/usr/bin/env node

/**
 * explore-apify.mjs — spawned by the web app's /api/explore/apify route to
 * run selected provider:apify portals.yml entries live, on demand, and
 * stream NDJSON progress to stdout.
 *
 * Why this exists instead of importing plugins/apify/_apify.mjs directly
 * into the Next.js route: web/next.config.mjs pins Turbopack's root to
 * web/, which refuses to bundle modules outside it (see the identical
 * problem already documented in web/src/lib/tracker-table.mjs). Spawning a
 * separate process is how the web app already crosses this boundary — see
 * runDiscovery() in web/src/lib/core/scan.ts spawning scan-ats-full.mjs.
 *
 * Deliberately NOT scan.mjs and NOT plugins/apify/index.mjs's default
 * fetch() export: that fetch() unconditionally writes JD-cache files to
 * jds/ (saveJd()) with no --dry-run awareness. This script only calls
 * runActor() + the pure mapping helpers, so an Explore "preview" click
 * never writes to disk — see docs/superpowers/specs/
 * 2026-07-24-explore-apify-mode-design.md.
 *
 * Usage:
 *   node explore-apify.mjs --entries <path-to-json-file>
 *
 * The entries file is a JSON array of portals.yml provider:apify entries
 * (already filtered by the caller): [{ name, actor, input, field_map,
 * timeout_ms? }, ...]. Emits one JSON object per line to stdout:
 *   {"kind":"sourceStart","source":"..."}
 *   {"kind":"offer","offer":{...}}
 *   {"kind":"sourceDone","source":"...","count":N}
 *   {"kind":"sourceError","source":"...","message":"..."}
 *   {"kind":"done","count":N,"offers":[...]}
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { runActor } from './plugins/apify/_apify.mjs';
import { normalizeItem, isHttpsUrl } from './plugins/apify/index.mjs';

/** Map one raw Apify dataset item to a DiscoveredOffer, or null if unusable.
 *  ats = the full portals.yml entry name (specific and unambiguous — e.g.
 *  "LinkedIn — India (via Apify)"); source = "apify" (the discovery
 *  MECHANISM, mirroring how AI-search offers set source: "ai-search"). */
export function mapItem(item, entry) {
  const normalized = normalizeItem(item, entry.field_map, entry.defaults);
  if (!normalized.title || !normalized.url || !isHttpsUrl(normalized.url)) return null;
  return { ...normalized, postedAt: '', ats: entry.name, source: 'apify' };
}

/** Run one entry's actor and emit its events. Never throws — a failing
 *  source becomes a sourceError event so runAll's other entries proceed. */
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

/** Run every entry IN PARALLEL (one failing source must not block the
 *  others), returning only the offers from entries that succeeded. */
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
  try {
    const { config } = await import('dotenv');
    // quiet: this script's stdout is a strict NDJSON contract the web route
    // parses line-by-line — dotenv's banner would corrupt it.
    config({ quiet: true });
  } catch {
    // dotenv is optional — fall back to ambient process.env
  }

  const args = process.argv.slice(2);
  const entriesFlagIdx = args.indexOf('--entries');
  const entriesPath = entriesFlagIdx >= 0 ? args[entriesFlagIdx + 1] : null;
  if (!entriesPath) {
    process.stderr.write('explore-apify.mjs: missing required --entries <path>\n');
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('entries file must contain a JSON array');
  } catch (err) {
    process.stderr.write(`explore-apify.mjs: could not read --entries file: ${err.message}\n`);
    process.exit(1);
  }

  const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');
  const token = process.env.APIFY_TOKEN || '';
  const offers = await runAll(entries, token, emit);
  emit({ kind: 'done', count: offers.length, offers });
}
