#!/usr/bin/env node
/**
 * check-design-tokens.mjs
 *
 * Mechanical enforcement of the design rules in /CLAUDE.md. Complements the
 * ESLint rules in apps/web/eslint.config.mjs by covering what ESLint cannot:
 * CSS files, and the legacy ratchet.
 *
 * ENFORCED (exit 1) — apps/web/src/**, excluding src/styles/tokens/:
 *   1. raw hex / rgb() / hsl() colour values
 *   2. default Tailwind palette class names (bg-slate-800, text-gray-500, …)
 *   3. imports from lucide-react
 *   4. emoji
 *
 * REPORTED ONLY — apps/web/{app,components}/**:
 *   the legacy baseline, so the migration can be tracked. See
 *   /docs/audit/CURRENT-STATE.md §5 and §11.
 *
 * Usage:
 *   node scripts/check-design-tokens.mjs            # enforce, then report
 *   node scripts/check-design-tokens.mjs --report   # report only, always exit 0
 *
 * Exit 0 if clean, exit 1 if src/** violates a rule.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname, sep } from "path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const WEB = join(ROOT, "apps", "web");
const SRC = join(WEB, "src");
const TOKENS = join(SRC, "styles", "tokens");

const REPORT_ONLY = process.argv.includes("--report");

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const STYLE_EXT = new Set([".css"]);

// ─── Patterns ─────────────────────────────────────────────────────────────────

const TW_PREFIX =
  "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow";
const TW_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const TW_STEP = "50|100|200|300|400|500|600|700|800|900|950";

const RULES = [
  {
    id: "raw-hex",
    label: "raw hex colour",
    pattern: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
    hint: "Move it to src/styles/tokens/colour.css and use a semantic token.",
  },
  {
    id: "colour-fn",
    label: "rgb()/hsl() colour",
    pattern: /\b(?:rgba?|hsla?)\(\s*[\d.]/g,
    hint: "Move it to src/styles/tokens/colour.css and use a semantic token.",
  },
  {
    id: "tw-palette",
    label: "default Tailwind palette class",
    pattern: new RegExp(String.raw`\b(?:${TW_PREFIX})-(?:${TW_PALETTE})-(?:${TW_STEP})\b`, "g"),
    hint: "Use a semantic token: bg-surface-raised, text-fg-secondary, bg-status-failed.",
  },
  {
    id: "lucide",
    label: "lucide-react import",
    pattern: /from\s+["']lucide-react["']/g,
    hint: "Use @phosphor-icons/react or a bespoke mark from ~/components/icons.",
  },
  {
    id: "emoji",
    label: "emoji",
    pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
    hint: "No emoji anywhere in the UI (CLAUDE.md rule 4).",
  },
  {
    /**
     * An invented `z-*` name compiles to NOTHING under Tailwind v4 — no class,
     * no warning, no visual difference until something silently paints in the
     * wrong order. `z-raised` shipped a broken sticky column on Control exactly
     * this way. Only the named layers from layout.css and the numeric core
     * utilities are valid.
     */
    id: "z-index",
    label: "unknown z-index utility",
    pattern: /\bz-(?!base\b|sticky\b|dropdown\b|overlay\b|modal\b|popover\b|toast\b|tooltip\b|auto\b|index\b|\d+\b|\[)[a-z][\w-]*/g,
    hint: "Use a layer from src/styles/tokens/layout.css (z-sticky, z-modal…) or a numeric z-10.",
  },
];

// ─── Walk ─────────────────────────────────────────────────────────────────────

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else {
      const ext = extname(entry);
      if (CODE_EXT.has(ext) || STYLE_EXT.has(ext)) yield full;
    }
  }
}

/**
 * Blank out comments so documentation and prose cannot trip the rules, while
 * preserving line numbering so reported positions stay accurate.
 *
 * Block comments are cleared FIRST — clearing `//` lines first would delete a
 * `/*` opener and leave the rest of the block looking like live code.
 */
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

function scan(files, { skipRule } = {}) {
  const violations = [];
  const counts = Object.fromEntries(RULES.map((r) => [r.id, 0]));
  const filesWith = Object.fromEntries(RULES.map((r) => [r.id, new Set()]));

  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = strip(raw).split("\n");

    for (const rule of RULES) {
      if (skipRule?.(rule, file)) continue;
      lines.forEach((line, i) => {
        const matches = line.match(rule.pattern);
        if (!matches) return;
        counts[rule.id] += matches.length;
        filesWith[rule.id].add(file);
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          rule,
          sample: matches[0],
          content: line.trim().slice(0, 120),
        });
      });
    }
  }
  return { violations, counts, filesWith };
}

// ─── Enforce: src/** ──────────────────────────────────────────────────────────

/** Third-party brand colours — trademarks, not tokens. See the file's header. */
const BRAND_COLOURS = join(SRC, "components", "ui", "provider-brand-colours.ts");

const srcFiles = [...walk(SRC)];
const { violations } = scan(srcFiles, {
  skipRule: (rule, file) => {
    const isColourRule = rule.id === "raw-hex" || rule.id === "colour-fn";
    // Token files are the one place OUR colour may be authored.
    if (file.startsWith(TOKENS) && isColourRule) return true;
    // Vendor brand colours are quarantined to a single exempt file.
    if (file === BRAND_COLOURS && isColourRule) return true;
    return false;
  },
});

// ─── Report: legacy baseline ──────────────────────────────────────────────────

const legacyFiles = [
  ...walk(join(WEB, "app")),
  ...walk(join(WEB, "components")),
];
const legacy = scan(legacyFiles);

// ─── Output ───────────────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} design-token violation(s) in apps/web/src:\n`);
  const byFile = {};
  for (const v of violations) (byFile[v.file] ??= []).push(v);
  for (const [file, vs] of Object.entries(byFile)) {
    console.error(`  ${file}`);
    for (const v of vs) {
      console.error(`    line ${v.line}: [${v.rule.label}] ${v.sample}`);
      console.error(`      > ${v.content}`);
      console.error(`      ${v.rule.hint}`);
    }
    console.error("");
  }
} else {
  console.log(`✓ apps/web/src is clean (${srcFiles.length} files scanned).`);
}

console.log("\nLegacy baseline — apps/web/{app,components}, migration target 0:");
for (const rule of RULES) {
  const n = legacy.counts[rule.id];
  const f = legacy.filesWith[rule.id].size;
  console.log(`  ${rule.label.padEnd(30)} ${String(n).padStart(6)} in ${String(f).padStart(4)} files`);
}
console.log("\n  Tracked in /docs/audit/CURRENT-STATE.md §11.\n");

process.exit(!REPORT_ONLY && violations.length > 0 ? 1 : 0);
