#!/usr/bin/env node

/**
 * web-search-run.mjs — Headless, scheduled web search runner using Serper API.
 *
 * Reads enabled search_queries from portals.yml, runs each via Serper Google Search API,
 * filters against title_filter & location_filter, and streams NDJSON progress.
 *
 * Usage:
 *   node web-search-run.mjs
 *   node web-search-run.mjs --queries <path-to-json-file>
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';
import { runSerperQuery } from './plugins/serper/index.mjs';

/** Filter raw Serper result item to a DiscoveredOffer, or null if invalid. */
export function mapSerperItem(item, queryName) {
  if (!item || !item.title) return null;
  const url = item.url || item.link;
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) return null;

  // Extract company name from title or snippet if possible
  let company = 'Web Result';
  const parts = item.title.split(/[-–|]/);
  if (parts.length > 1) {
    company = parts[parts.length - 1].trim();
  }

  return {
    title: item.title,
    url,
    company,
    location: '',
    snippet: item.snippet || '',
    postedAt: '',
    ats: queryName || 'Serper Web Search',
    source: 'web-search',
  };
}

/** Process a single search query string */
export async function processQuery(queryObj, apiKey, emit, deps = {}) {
  const runQueryFn = deps.runQueryFn || runSerperQuery;
  const name = queryObj.name || queryObj.query;
  emit({ kind: 'sourceStart', source: name });

  try {
    const results = await runQueryFn(queryObj.query, { apiKey, max: queryObj.max || 10 });
    let count = 0;
    for (const item of results) {
      const offer = mapSerperItem(item, name);
      if (offer) {
        emit({ kind: 'offer', offer });
        count++;
      }
    }
    emit({ kind: 'sourceDone', source: name, count });
    return count;
  } catch (err) {
    emit({ kind: 'sourceError', source: name, message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** Run all given query objects */
export async function runAllQueries(queries, apiKey, emit, deps = {}) {
  const collected = [];
  const collectingEmit = (e) => {
    if (e.kind === 'offer') collected.push(e.offer);
    emit(e);
  };
  await Promise.allSettled(queries.map((q) => processQuery(q, apiKey, collectingEmit, deps)));
  return collected;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    const { config } = await import('dotenv');
    config({ quiet: true });
  } catch {
    // dotenv is optional
  }

  const apiKey = process.env.SERPER_API_KEY || '';
  const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');

  if (!apiKey) {
    emit({ kind: 'error', message: 'SERPER_API_KEY is not configured in .env' });
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const queriesFlagIdx = args.indexOf('--queries');
  const queriesPath = queriesFlagIdx >= 0 ? args[queriesFlagIdx + 1] : null;

  let queries = [];
  if (queriesPath) {
    try {
      queries = JSON.parse(readFileSync(queriesPath, 'utf8'));
    } catch (err) {
      emit({ kind: 'error', message: `Could not read --queries file: ${err.message}` });
      process.exit(1);
    }
  } else {
    try {
      const portalsFile = path.resolve('portals.yml');
      const doc = yaml.load(readFileSync(portalsFile, 'utf8')) || {};
      const sq = Array.isArray(doc.search_queries) ? doc.search_queries : [];
      queries = sq.filter((q) => q && q.enabled !== false && q.query);
    } catch (err) {
      emit({ kind: 'error', message: `Could not read portals.yml search_queries: ${err.message}` });
      process.exit(1);
    }
  }

  const offers = await runAllQueries(queries, apiKey, emit);
  emit({ kind: 'done', count: offers.length, offers });
}
