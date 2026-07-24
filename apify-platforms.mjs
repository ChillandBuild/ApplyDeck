/**
 * apify-platforms.mjs — Root registry of supported Apify scraper platforms.
 *
 * Defines candidate actor slugs, input schemas, cost structures, and field mappings
 * for platforms (Indeed, LinkedIn, Glassdoor, Naukri).
 */

export const PLATFORMS = {
  indeed: {
    id: 'indeed',
    label: 'Indeed',
    cost: 'usage',
    actor: 'misceres/indeed-scraper',
    buildInput: ({ query, location, country, max }) => ({
      position: query,
      location: location || '',
      country: country || 'US',
      maxItems: max || 20,
    }),
    field_map: {
      title: ['positionName', 'title'],
      url: 'url',
      company: ['company', 'companyName'],
      location: ['location', 'formattedLocation'],
    },
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    cost: 'rental',
    actor: 'bebity/linkedin-jobs-scraper',
    buildInput: ({ query, location, country, max }) => ({
      title: query,
      location: location || '',
      limit: max || 20,
    }),
    field_map: {
      title: ['title', 'positionName', 'jobTitle'],
      url: ['url', 'link', 'jobUrl'],
      company: ['company', 'companyName', 'companyOrOrganization'],
      location: ['location', 'formattedLocation', 'place'],
    },
  },
  glassdoor: {
    id: 'glassdoor',
    label: 'Glassdoor',
    cost: 'usage',
    actor: 'bebity/glassdoor-jobs-scraper',
    buildInput: ({ query, location, country, max }) => ({
      keyword: query,
      location: location || '',
      limit: max || 20,
    }),
    field_map: {
      title: ['title', 'jobTitle', 'header'],
      url: ['url', 'jobUrl', 'link'],
      company: ['companyName', 'company', 'employerName'],
      location: ['location', 'formattedLocation', 'city'],
    },
  },
  naukri: {
    id: 'naukri',
    label: 'Naukri',
    cost: 'usage',
    actor: 'easyapi/naukri-jobs-scraper',
    buildInput: ({ query, location, country, max }) => ({
      keyword: query,
      location: location || '',
      maxItems: max || 20,
    }),
    field_map: {
      title: ['title', 'jobTitle', 'designation'],
      url: ['url', 'jdUrl', 'link'],
      company: ['company', 'companyName', 'companyLabel'],
      location: ['location', 'place', 'city'],
    },
  },
};

/**
 * Returns metadata list for all supported platforms.
 * Useful for web UI platform selection.
 * @returns {Array<{id: string, label: string, cost: string}>}
 */
export function platformMeta() {
  return Object.values(PLATFORMS).map((p) => ({
    id: p.id,
    label: p.label,
    cost: p.cost,
  }));
}

/**
 * Expands a list of keywords and selected platforms into executable job items.
 * Fan-out = keywords.length × platforms.length
 *
 * @param {string[]} keywords
 * @param {string[]} platformIds
 * @param {{ location?: string, country?: string, max?: number }} options
 * @returns {Array<{ platform: string, query: string, location: string, country: string, max: number }>}
 */
export function expand(keywords = [], platformIds = [], options = {}) {
  const validKeywords = (Array.isArray(keywords) ? keywords : []).map((k) => String(k).trim()).filter(Boolean);
  const validPlatforms = (Array.isArray(platformIds) ? platformIds : []).filter((id) => PLATFORMS[id]);
  const location = options.location ? String(options.location).trim() : '';
  const country = options.country ? String(options.country).trim() : 'US';
  const max = typeof options.max === 'number' && options.max > 0 ? options.max : 20;

  const jobs = [];
  for (const query of validKeywords) {
    for (const platform of validPlatforms) {
      jobs.push({
        platform,
        query,
        location,
        country,
        max,
      });
    }
  }
  return jobs;
}
