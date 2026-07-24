import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS, cleanChips, type ExploreFilters } from "@/lib/explore";

/**
 * ACL for portals.yml — the core's scan-filter config (a CONTRACT entry-point,
 * see reference_web_core_sync_protocol). The Explorer NEVER mutates the user's
 * real portals.yml: it writes an EPHEMERAL filter file and points the scanner at
 * it via CAREER_OPS_PORTALS, so an ad-hoc search can't clobber the curated config.
 * We also read the real portals.yml + config/profile.yml (tolerantly) only to
 * SEED sensible defaults for the first search.
 *
 * Filter semantics mirror scan.mjs::buildTitleFilter / buildLocationFilter:
 *   title positive → substring match (empty = everything matches)
 *   title negative → substring reject
 *   location always_allow > block > allow (case-insensitive substring)
 */
type FilterLists = Pick<ExploreFilters, "positive" | "negative" | "allow" | "block" | "alwaysAllow">;

import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export type PortalsDoc = { doc: Record<string, unknown>; exists: boolean; malformed: boolean };

export type ApifySearchConfig = {
  enabled: boolean;
  keywords: string[];
  platforms: string[];
  location: string;
  country: string;
  max: number;
};

export function getApifySearchConfig(root: string): ApifySearchConfig {
  const { doc } = readPortalsDoc(root);
  const cfg = (doc.apify_search ?? {}) as Record<string, unknown>;
  return {
    enabled: cfg.enabled !== false,
    keywords: Array.isArray(cfg.keywords) ? cfg.keywords.filter((k): k is string => typeof k === "string") : [],
    platforms: Array.isArray(cfg.platforms) ? cfg.platforms.filter((p): p is string => typeof p === "string") : ["indeed"],
    location: typeof cfg.location === "string" ? cfg.location : "",
    country: typeof cfg.country === "string" ? cfg.country : "US",
    max: typeof cfg.max === "number" && cfg.max > 0 ? cfg.max : 20,
  };
}

export function updateApifySearchConfig(root: string, update: Partial<ApifySearchConfig>): void {
  const file = path.join(root, "portals.yml");
  const { doc } = readPortalsDoc(root);
  const current = getApifySearchConfig(root);
  const updated: ApifySearchConfig = {
    ...current,
    ...update,
  };
  const newDoc = {
    ...doc,
    apify_search: updated,
  };
  atomicWriteWithBackup(file, yaml.dump(newDoc, { lineWidth: 100, noRefs: true }));
}

/** Tolerant portals.yml reader shared by every read-only consumer (the Config
 *  snapshot, the Explore Apify picker, …). Never throws. `malformed` is true
 *  ONLY when the file exists but fails to parse — a file that parses to a
 *  non-object (e.g. a bare YAML list) is treated as an empty doc, matching
 *  the behavior this replaces in the snapshot route. Callers that need to
 *  REFUSE to write over a malformed file (web/src/app/api/portals/route.ts's
 *  PUT) keep their own stricter inline check — this helper is for reads. */
export function readPortalsDoc(root: string): PortalsDoc {
  const file = path.join(root, "portals.yml");
  if (!fs.existsSync(file)) return { doc: {}, exists: false, malformed: false };
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    const doc = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { doc, exists: true, malformed: false };
  } catch {
    return { doc: {}, exists: true, malformed: true };
  }
}

function listFrom(v: unknown): string[] {
  return cleanChips(v);
}

/** Serialize filters into a minimal, valid portals.yml. Scalars go through
 *  JSON.stringify (a valid YAML double-quoted scalar) so arbitrary keywords —
 *  colons, quotes, leading dashes — can never break the document or inject YAML. */
export function serializePortals(f: FilterLists): string {
  const block = (key: string, items: string[]) =>
    items.length ? `  ${key}:\n` + items.map((k) => `    - ${JSON.stringify(k)}`).join("\n") + "\n" : "";

  let out = "# Ephemeral Explorer filters — generated per-search, safe to delete.\n";
  if (f.positive.length || f.negative.length) {
    out += "title_filter:\n";
    out += block("positive", f.positive);
    out += block("negative", f.negative);
  }
  if (f.allow.length || f.block.length || f.alwaysAllow.length) {
    out += "location_filter:\n";
    out += block("always_allow", f.alwaysAllow);
    out += block("allow", f.allow);
    out += block("block", f.block);
  }
  return out;
}

/** Write the ephemeral filter file to a temp path; caller cleans it up. */
export function writeTempPortals(f: FilterLists): string {
  const file = path.join(os.tmpdir(), `career-ops-explore-${randomUUID()}.yml`);
  fs.writeFileSync(file, serializePortals(f), "utf8");
  return file;
}

export function cleanupTempPortals(file: string): void {
  try {
    if (file.startsWith(os.tmpdir()) && file.includes("career-ops-explore-")) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

function loadYaml(rel: string): Record<string, unknown> | null {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8"));
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tolerantly seed first-search defaults from the user's real config. Reads
 * portals.yml (title_filter / location_filter) and falls back to
 * config/profile.yml (target_roles, location) for the positive keywords when
 * portals has none. Never throws — a bare checkout just yields DEFAULT_FILTERS.
 */
export function seedExploreFilters(): { filters: ExploreFilters; seededFrom: string[] } {
  const filters: ExploreFilters = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] };
  const seededFrom: string[] = [];

  const portals = loadYaml("portals.yml");
  if (portals) {
    const tf = (portals.title_filter ?? {}) as Record<string, unknown>;
    const lf = (portals.location_filter ?? {}) as Record<string, unknown>;
    filters.positive = listFrom(tf.positive);
    filters.negative = listFrom(tf.negative);
    filters.allow = listFrom(lf.allow);
    filters.block = listFrom(lf.block);
    filters.alwaysAllow = listFrom(lf.always_allow);
    if (filters.positive.length || filters.allow.length || filters.block.length) seededFrom.push("portals.yml");
  }

  if (filters.positive.length === 0) {
    const profile = loadYaml("config/profile.yml");
    const roles = (profile?.target_roles ?? {}) as Record<string, unknown>;
    const fromRoles = listFrom([
      ...(typeof roles.primary === "string" ? [roles.primary] : []),
      ...(Array.isArray(roles.archetypes) ? roles.archetypes : []),
    ]);
    if (fromRoles.length) {
      filters.positive = fromRoles;
      seededFrom.push("profile.yml");
    }
  }

  return { filters, seededFrom };
}

export { listFrom as normalizeKeywords };
