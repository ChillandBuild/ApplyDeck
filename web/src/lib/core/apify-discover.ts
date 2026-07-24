import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Is the apify plugin turned on in config/plugins.yml? Mirrors the
 *  `configured` half of plugins/_engine.mjs's pluginStatus() for this one
 *  known plugin — that helper needs full manifest discovery machinery we
 *  don't otherwise need here, and can't be imported anyway (it's outside
 *  web/'s Turbopack root). Fail-closed (false) on any read/parse error. */
export function isApifyPluginEnabled(root: string): boolean {
  const file = path.join(root, "config", "plugins.yml");
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    if (!isObj(parsed) || !isObj(parsed.plugins)) return false;
    const apify = parsed.plugins.apify;
    return isObj(apify) && apify.enabled === true;
  } catch {
    return false;
  }
}

const TOKEN_KEY = "APIFY_TOKEN";

/** Is APIFY_TOKEN set (non-empty) in the root .env? Raw line read, same
 *  pattern as web/src/app/api/secrets/apify-token/route.ts's GET — never
 *  loads the value into this process's own process.env. */
export function isApifyTokenConfigured(root: string): boolean {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return false;
  try {
    const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
    return lines.some((l) => new RegExp(`^${TOKEN_KEY}=.+`).test(l.trim()));
  } catch {
    return false;
  }
}
