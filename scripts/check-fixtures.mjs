#!/usr/bin/env node
/**
 * Fixture debt report, and the production-bundle guard.
 *
 * Two jobs:
 *
 *  1. Count how many `src/**` files still import `~/mocks/**`, and compare that
 *     against the baseline recorded in eslint.config.mjs. The ESLint rule stops
 *     the number GROWING; this prints how far there is left to go, so the debt
 *     is a number someone can watch fall rather than a vague "still on mocks".
 *
 *  2. If a production build exists, fail when fixture data is found in the
 *     client bundle. That is the actual requirement — not "fixtures are tidy"
 *     but "fabricated data cannot reach a user". Verified by searching the
 *     built chunks for fixture-only string literals, because a tree-shaking
 *     assumption is exactly the kind of thing that quietly stops being true.
 *
 * Exit codes: 0 clean or debt unchanged · 1 debt grew, or fixtures in the bundle.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const webRoot = join(root, "apps", "web");
const srcRoot = join(webRoot, "src");

/**
 * String literals that exist ONLY in fixtures.
 *
 * Chosen to be things no real API response and no UI copy would contain: a mock
 * incident id and a fabricated workspace name. A generic word like "renewals"
 * would match legitimate copy and produce false alarms.
 */
const FIXTURE_MARKERS = ["inc_7c2f18ab90de", "Acme Platform", "ws_acme_eu", "run_01JBQZ8XK4"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ── 1. Source debt ───────────────────────────────────────────────────────── */

const sourceFiles = walk(srcRoot).filter((f) => /\.tsx?$/.test(f));

const importers = sourceFiles
  .filter((f) => {
    const rel = relative(webRoot, f).split(sep).join("/");
    if (rel.startsWith("src/mocks/")) return false;
    if (rel.endsWith(".stories.tsx")) return false;
    if (rel === "src/lib/api/mock-transport.ts") return false;
    return /from\s+["']~\/mocks/.test(readFileSync(f, "utf8"));
  })
  .map((f) => relative(webRoot, f).split(sep).join("/"))
  .sort();

// The baseline is the ignore list in the ESLint config — one source of truth.
// Scoped to the block after the migration marker so the other `ignores` arrays
// in the config (token files, brand colours) are not mistaken for fixture debt.
const eslintConfig = readFileSync(join(webRoot, "eslint.config.mjs"), "utf8");
const MARKER = "Migration baseline. Shrinks as screens are wired.";
const markerAt = eslintConfig.indexOf(MARKER);
const baselineBlock =
  markerAt === -1 ? "" : eslintConfig.slice(markerAt, eslintConfig.indexOf("]", markerAt));
const baseline = new Set(
  [...baselineBlock.matchAll(/"(src\/[^"]+\.tsx?)"/g)].map((m) => m[1]),
);

const unlisted = importers.filter((f) => !baseline.has(f));
const cleared = [...baseline].filter((f) => !importers.includes(f));

console.log(`Fixture importers in src/**: ${importers.length}`);
console.log(`Baseline recorded:           ${baseline.size}`);
if (cleared.length > 0) {
  console.log(`\n  ✓ ${cleared.length} file(s) migrated since the baseline was taken:`);
  for (const f of cleared.slice(0, 10)) console.log(`      ${f}`);
  if (cleared.length > 10) console.log(`      … and ${cleared.length - 10} more`);
  console.log("\n  Remove them from the ignores list in eslint.config.mjs to lock the gain in.");
}

let failed = false;

if (unlisted.length > 0) {
  console.error(`\n  ✗ ${unlisted.length} file(s) import fixtures and are NOT in the baseline:`);
  for (const f of unlisted) console.error(`      ${f}`);
  console.error("\n  Fixture debt must only shrink. Read from the API instead.");
  failed = true;
}

/* ── 2. Production bundle guard ───────────────────────────────────────────── */

const chunkDir = join(webRoot, ".next", "static", "chunks");

if (!existsSync(chunkDir)) {
  console.log("\nNo production build found — skipping the bundle check.");
  console.log("Run `npm run build` first to verify fixtures are excluded.");
} else {
  const contaminated = new Map();
  for (const file of walk(chunkDir).filter((f) => f.endsWith(".js"))) {
    const content = readFileSync(file, "utf8");
    const hits = FIXTURE_MARKERS.filter((marker) => content.includes(marker));
    if (hits.length > 0) contaminated.set(relative(webRoot, file).split(sep).join("/"), hits);
  }

  if (contaminated.size === 0) {
    console.log("\n  ✓ No fixture data found in the production client bundle.");
  } else {
    console.error(`\n  ✗ Fixture data found in ${contaminated.size} production chunk(s):`);
    for (const [file, hits] of contaminated) {
      console.error(`      ${file}  →  ${hits.join(", ")}`);
    }
    console.error("\n  Fabricated domain data is being shipped to users.");
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
