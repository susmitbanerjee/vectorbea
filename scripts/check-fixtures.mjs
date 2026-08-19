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

/* ── 3. Deployed-bundle guard ─────────────────────────────────────────────── */

/**
 * Section 2 proves the bundle on THIS machine is clean. That is not the same
 * claim as "production is clean" — the deployed build came off CI, possibly
 * from a different commit, with different env. So this fetches the real
 * deployed page and every JS chunk it links, and greps those for the same four
 * markers.
 *
 * Usage:  node scripts/check-fixtures.mjs --url https://app.vectorbea.com/runs
 *         DEPLOY_URL=https://… node scripts/check-fixtures.mjs
 *
 * Unauthenticated, so a private route will usually answer with the login page.
 * That still proves something real — the login shell and the chunks it pulls
 * are exactly where a fixture import would leak first — but it does not cover
 * authenticated screens, so the final URL is printed rather than assumed.
 */

function parseUrlArg(argv) {
  const i = argv.indexOf("--url");
  if (i !== -1) {
    if (!argv[i + 1]) {
      console.error("--url requires a value");
      process.exit(1);
    }
    return argv[i + 1];
  }
  return process.env.DEPLOY_URL ?? null;
}

const deployUrl = parseUrlArg(process.argv.slice(2));

if (!deployUrl) {
  console.log("\nNo --url given — skipping the deployed-bundle check.");
  console.log("Run `node scripts/check-fixtures.mjs --url https://your-deployment/` to verify production.");
} else {
  console.log(`\n── Deployed bundle: ${deployUrl} ──`);

  const fetchText = async (url) => {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "vectorbea-check-fixtures" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), finalUrl: res.url };
  };

  let html;
  let finalUrl;
  try {
    ({ text: html, finalUrl } = await fetchText(deployUrl));
  } catch (err) {
    console.error(`  ✗ Could not fetch ${deployUrl} — ${err.message}`);
    console.error("    Production cannot be proven clean without a successful fetch.");
    process.exit(1);
  }

  if (finalUrl !== deployUrl) console.log(`  (redirected to ${finalUrl})`);

  // src="…" on <script>, plus preloaded/modulepreloaded chunks — Next.js links
  // its chunks both ways, and a chunk only referenced by a preload tag is still
  // shipped to the browser.
  const urls = new Set();
  for (const re of [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+(?:rel=["'](?:preload|modulepreload)["'][^>]*href|href)=["']([^"']+\.js)["']/gi,
  ]) {
    for (const m of html.matchAll(re)) {
      const raw = m[1];
      if (!raw || raw.startsWith("data:")) continue;
      try {
        urls.add(new URL(raw, finalUrl).href);
      } catch {
        /* unparseable src — nothing to fetch */
      }
    }
  }

  const contaminatedRemote = new Map();
  const unreachable = [];

  const htmlHits = FIXTURE_MARKERS.filter((marker) => html.includes(marker));
  if (htmlHits.length > 0) contaminatedRemote.set(finalUrl + " (HTML)", htmlHits);

  // Bounded concurrency — a big Next build links a lot of chunks, and firing
  // them all at once gets the request rate-limited, which reads as a false pass.
  const queue = [...urls];
  const CONCURRENCY = 8;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        try {
          const { text } = await fetchText(url);
          const hits = FIXTURE_MARKERS.filter((marker) => text.includes(marker));
          if (hits.length > 0) contaminatedRemote.set(url, hits);
        } catch (err) {
          unreachable.push(`${url} — ${err.message}`);
        }
      }
    }),
  );

  console.log(`  Scanned 1 HTML document and ${urls.size} linked JS chunk(s).`);

  if (unreachable.length > 0) {
    console.error(`\n  ✗ ${unreachable.length} chunk(s) could not be fetched:`);
    for (const u of unreachable.slice(0, 10)) console.error(`      ${u}`);
    console.error("\n  An unscanned chunk is an unproven chunk.");
    failed = true;
  }

  if (contaminatedRemote.size === 0) {
    console.log("  ✓ No fixture data found in the deployed HTML or its JS chunks.");
  } else {
    console.error(`\n  ✗ Fixture data found in ${contaminatedRemote.size} deployed asset(s):`);
    for (const [url, hits] of contaminatedRemote) console.error(`      ${url}  →  ${hits.join(", ")}`);
    console.error("\n  Fabricated domain data is live in production.");
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
