#!/usr/bin/env node
/**
 * check-consistency.mjs — the P21 anti-template audit (design §14).
 *
 * Complements check-design-tokens.mjs, which already covers raw colour, default
 * Tailwind palette names, Lucide and emoji. This adds the rules §14 lists that
 * nothing was checking:
 *
 *   1. radii outside the six-step scale (xs sm md lg xl full)
 *   2. spacing off the 4px lattice
 *   3. numeric table/metric cells without tabular figures
 *   4. icon-only buttons with no accessible name
 *   5. shadows that are not the tinted elevation tokens
 *
 * Scope: apps/web/src/** only. The legacy layer in apps/web/{app,components}
 * predates the rules and is tracked separately in CURRENT-STATE §11.
 *
 * Usage:
 *   node scripts/check-consistency.mjs            # report, exit 1 on violations
 *   node scripts/check-consistency.mjs --report   # report only, always exit 0
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const SRC = join(ROOT, "apps", "web", "src");
const TOKENS = join(SRC, "styles", "tokens");
const REPORT_ONLY = process.argv.includes("--report");

const CODE_EXT = new Set([".ts", ".tsx"]);

/* ── Rules ────────────────────────────────────────────────────────────────── */

/** The six-step scale from CLAUDE.md rule 5, plus `none`. */
const ALLOWED_RADII = "xs|sm|md|lg|xl|full|none";

/**
 * The lattice, as §8 actually defines it.
 *
 * "Component padding steps 4 / 6 / 8 / 12 / 16 / 20 / 24" — so SIX pixels is on
 * the lattice, which in Tailwind's 0.25rem scale is `1.5`. An earlier version of
 * this rule flagged every `py-1.5` in the codebase and reported 428 violations;
 * the rule was wrong, not the code. The values genuinely off the scale are 2px
 * (`0.5`), 10px (`2.5`), 14px (`3.5`) and anything arbitrary.
 *
 * `0.5` is tolerated on gap/space only, where a 4px gap is visibly too wide for
 * an inline run of small text — that exception is why this matches p/m alone.
 */
const OFF_LATTICE = String.raw`\b(?:[pm][trblxy]?)-(?!1\.5(?![\d.]))(?:\d*\.\d+|\[[^\]]+\])(?![\w.])`;

/* ── Fatal rules ──────────────────────────────────────────────────────────────
   Only rules with an unambiguous right answer are fatal. `radius` and `spacing`
   are reported as advisory below: both currently flag a CONSISTENT convention
   used across the whole codebase rather than scattered mistakes, and resolving
   whether the convention or the rule is wrong is a design decision, not a
   mechanical one. See /docs/QUALITY-REPORT.md § Consistency audit. */
const RULES = [
  {
    id: "radius-arbitrary",
    label: "arbitrary radius value",
    /* `rounded-[7px]` is unambiguously off the scale. Side variants drawing from
       the scale (`rounded-t-lg`) are fine and are not matched. */
    pattern: /\brounded-(?:(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee)-)?\[[^\]]+\]/g,
    hint: "Use rounded-xs|sm|md|lg|xl|full. §8: “Nothing else.”",
  },
  {
    id: "shadow",
    label: "shadow that is not a tinted elevation token",
    pattern: /\bshadow-(?!1\b|2\b|3\b|none\b|focus\b|glow)(?:\[[^\]]+\]|[a-z0-9-]+)/g,
    hint: "Use shadow-1|2|3. §14 requires shadows tinted with the base hue, never pure black.",
  },
  {
    id: "arbitrary-colour",
    label: "arbitrary colour value in a utility",
    pattern: /\b(?:bg|text|border|fill|stroke|ring|shadow)-\[(?:#|rgb|hsl)/g,
    hint: "Move it to src/styles/tokens/colour.css and use a semantic token.",
  },
];

/* ── Advisory checks — reported, never fatal ──────────────────────────────── */

const ADVISORY = [
  {
    id: "tabular",
    label: "numeric cell without tabular figures",
    /* A DataColumn marked `numeric: true` renders right-aligned digits. Rule 7
       requires tabular-nums on those, and the <Text> primitive only applies it
       by default to mono and display variants — so a caption-variant number in a
       numeric column needs it explicitly. */
    test: (source) => {
      const hits = [];
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (!/numeric:\s*true/.test(line)) return;
        // Look ahead for the cell renderer belonging to this column.
        const window = lines.slice(i, i + 12).join("\n");
        if (/<Text[^>]*\btabular\b/.test(window)) return;
        if (/tabular/.test(window)) return;
        // Cells that render a bespoke component carry it internally.
        if (/<(RateCell|SuccessRateCell|StepsCell|VersionCell|LastRunCell|RiskBadge|Sparkline)/.test(window)) return;
        hits.push(i + 1);
      });
      return hits;
    },
    hint: "Add `tabular` to the <Text> in the cell, or render a component that carries it.",
  },
  {
    id: "icon-button",
    label: "icon-only button with no accessible name",
    test: (source) => {
      const hits = [];
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (!/<button\b/.test(line)) return;
        const window = lines.slice(i, i + 14).join("\n");
        // Has a label, or has text content beyond an svg.
        if (/aria-label=|aria-labelledby=|sr-only/.test(window)) return;
        // Heuristic: a button whose body is only an <svg> needs a name.
        if (/<svg/.test(window) && !/>\s*\{?\s*[A-Za-z]/.test(window.replace(/<svg[\s\S]*?<\/svg>/g, ""))) {
          hits.push(i + 1);
        }
      });
      return hits;
    },
    hint: "Add aria-label. An icon-only control is unusable to a screen reader without one.",
  },
];

/* ── Walk ─────────────────────────────────────────────────────────────────── */

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full);
    else if (CODE_EXT.has(extname(entry))) yield full;
  }
}

/** Blank comments so prose cannot trip the rules, preserving line numbers. */
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

const files = [...walk(SRC)].filter((f) => !f.startsWith(TOKENS));

const violations = [];
const counts = Object.fromEntries([...RULES, ...ADVISORY].map((r) => [r.id, 0]));

for (const file of files) {
  let raw;
  try { raw = readFileSync(file, "utf-8"); } catch { continue; }
  const source = strip(raw);
  const lines = source.split("\n");

  for (const rule of RULES) {
    lines.forEach((line, i) => {
      const matches = line.match(rule.pattern);
      if (!matches) return;
      counts[rule.id] += matches.length;
      violations.push({
        file: relative(ROOT, file), line: i + 1, rule, sample: matches[0],
        content: line.trim().slice(0, 110), fatal: true,
      });
    });
  }

  for (const rule of ADVISORY) {
    for (const line of rule.test(source)) {
      counts[rule.id] += 1;
      violations.push({
        file: relative(ROOT, file), line, rule, sample: rule.label,
        content: (lines[line - 1] ?? "").trim().slice(0, 110), fatal: false,
      });
    }
  }
}

/* ── Output ───────────────────────────────────────────────────────────────── */

const fatal = violations.filter((v) => v.fatal);
const advisory = violations.filter((v) => !v.fatal);

console.log(`\nConsistency audit — apps/web/src (${files.length} files)\n`);

for (const rule of RULES) {
  const n = counts[rule.id];
  console.log(`  ${n === 0 ? "✓" : "✗"} ${rule.label.padEnd(46)} ${String(n).padStart(4)}`);
}
console.log("");
for (const rule of ADVISORY) {
  const n = counts[rule.id];
  console.log(`  ${n === 0 ? "✓" : "·"} ${rule.label.padEnd(46)} ${String(n).padStart(4)}  (advisory)`);
}

if (fatal.length > 0) {
  console.error(`\n✗ ${fatal.length} violation(s):\n`);
  const byFile = {};
  for (const v of fatal) (byFile[v.file] ??= []).push(v);
  for (const [file, vs] of Object.entries(byFile)) {
    console.error(`  ${file}`);
    for (const v of vs.slice(0, 12)) {
      console.error(`    line ${v.line}: [${v.rule.label}] ${v.sample}`);
      console.error(`      > ${v.content}`);
    }
    if (vs.length > 12) console.error(`    …and ${vs.length - 12} more`);
    console.error("");
  }
  console.error(`  Fix: ${[...new Set(fatal.map((v) => v.rule.hint))].join("\n       ")}\n`);
}

if (advisory.length > 0) {
  console.log(`\n· ${advisory.length} advisory finding(s), first 20:\n`);
  for (const v of advisory.slice(0, 20)) {
    console.log(`  ${v.file}:${v.line} — ${v.rule.label}`);
  }
  console.log("");
}

process.exit(!REPORT_ONLY && fatal.length > 0 ? 1 : 0);
