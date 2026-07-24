/**
 * plugins/serper/index.mjs — Serper Google Search API Provider.
 *
 * Runs structured web searches (e.g. site: queries) via Serper API without LLM tokens.
 */

import http from 'node:https';
import { URL } from 'node:url';

/**
 * Execute a Google Search query via Serper API.
 *
 * @param {string} query
 * @param {{ apiKey: string, max?: number }} options
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
 */
export async function runSerperQuery(query, { apiKey, max = 10 } = {}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('SERPER_API_KEY is required');
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  const payload = JSON.stringify({
    q: query.trim(),
    num: typeof max === 'number' && max > 0 ? Math.min(max, 100) : 10,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey.trim(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Serper API error (HTTP ${res.statusCode}): ${body.slice(0, 200)}`));
          }
          try {
            const data = JSON.parse(body);
            const organic = Array.isArray(data.organic) ? data.organic : [];
            const results = organic
              .filter((item) => item && typeof item.title === 'string' && typeof item.link === 'string')
              .map((item) => ({
                title: item.title.trim(),
                url: item.link.trim(),
                snippet: typeof item.snippet === 'string' ? item.snippet.trim() : '',
              }));
            resolve(results);
          } catch (err) {
            reject(new Error(`Failed to parse Serper response: ${err.message}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(new Error(`Serper HTTP request failed: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}
