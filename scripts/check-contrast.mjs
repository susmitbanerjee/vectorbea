#!/usr/bin/env node
/**
 * check-contrast.mjs
 *
 * Verifies every semantic colour pairing in the Ink & Iris token layer against
 * WCAG 2.1 contrast minima, in BOTH themes.
 *
 *   4.5:1  body text
 *   3.0:1  large text, UI components, graphical objects (WCAG 1.4.11)
 *
 * It parses apps/web/src/styles/tokens/colour.css directly, resolving var()
 * chains down to hex, so the report can never drift from the tokens themselves.
 *
 * Pairings are declared below with the requirement that actually applies to how
 * the token is used. Purely decorative separators are measured and printed but
 * not failed — WCAG 1.4.11 scopes to parts needed to identify a control or its
 * state, and a divider between two rows is not one. Those rows are labelled
 * DECORATIVE so nothing is hidden.
 *
 * Usage:
 *   node scripts/check-contrast.mjs            # enforce
 *   node scripts/check-contrast.mjs --report   # print only, always exit 0
 *
 * Exit 0 if every enforced pairing passes, 1 otherwise.
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const CSS = join(ROOT, "apps", "web", "src", "styles", "tokens", "colour.css");
const REPORT_ONLY = process.argv.includes("--report");

// ─── Parse ────────────────────────────────────────────────────────────────────

/** Strip comments so `/* --foo: #bar *​/` never registers as a declaration. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Excise `@media print { … }`, braces balanced.
 *
 * The print block re-points the ink tokens on `:root` so the dark theme's
 * near-white foregrounds do not print as nothing. Grading those against the
 * dark theme's screen surfaces is meaningless — paper is white whichever theme
 * the reader had on screen — and it would report ~44 phantom failures. The
 * values it uses are the light theme's, which this script already grades.
 */
function stripPrint(css) {
  const start = css.indexOf("@media print");
  if (start === -1) return css;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return stripPrint(css.slice(0, start) + css.slice(i + 1));
    }
  }
  return css.slice(0, start);
}

/**
 * Collect custom-property declarations per selector.
 * Returns { ':root': {name: value}, ':root.light': {...} }.
 */
/**
 * Collect custom-property declarations, bucketed into the dark and light themes.
 *
 * Selectors are classified rather than matched literally, because both themes
 * are declarable on any element: dark is `:root, .dark` and light is `.light`,
 * so a marketing section can invert the page theme. `@theme` and other at-rules
 * are skipped — they declare Tailwind's namespace, not theme values.
 */
function parseBlocks(css) {
  const out = { dark: {}, light: {} };
  // The selector must exclude `;` as well as braces, or it swallows the
  // preceding statement — e.g. the `@custom-variant …;` line above the first
  // :root block, whose `@` then causes the whole block to be skipped.
  const re = /([^{};]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith("@") || selector.includes("@")) continue;

    const isLight = /(^|,)\s*\.light\b/.test(selector);
    const isDark = /(^|,)\s*(:root|\.dark)\b/.test(selector);
    if (!isLight && !isDark) continue;

    const target = out[isLight ? "light" : "dark"];
    const dre = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = dre.exec(m[2])) !== null) target[d[1]] = d[2].trim();
  }
  return out;
}

const css = stripPrint(stripComments(readFileSync(CSS, "utf-8")));
const blocks = parseBlocks(css);

// The primitive scales live in the dark bucket (they are declared on :root and
// are theme-independent), so light inherits them and overrides only semantics.
const darkMap = { ...blocks.dark };
const lightMap = { ...blocks.dark, ...blocks.light };

// ─── Resolve ──────────────────────────────────────────────────────────────────

function resolve(name, map, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = map[name];
  if (!raw) return null;
  const hex = raw.match(/^#[0-9a-fA-F]{3,8}$/);
  if (hex) return raw.toLowerCase();
  const ref = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (ref) return resolve(ref[1], map, seen);
  return null; // shadows, numbers, anything non-colour
}

// ─── Contrast ─────────────────────────────────────────────────────────────────

function toRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Pairings ─────────────────────────────────────────────────────────────────

const READING_SURFACES = ["--bg-app", "--bg-base", "--bg-raised", "--bg-overlay", "--bg-sunken"];
const CARD_SURFACES = ["--bg-base", "--bg-raised"];
const STATUSES = ["success", "failed", "live", "waiting", "queued", "cancelled"];
// Free is absent on purpose: it has no tokens, because it draws nothing.
const PLAN_TIERS = ["pro", "team", "enterprise"];

/** @type {{fg:string,bg:string,min:number,kind:string,note?:string}[]} */
const PAIRS = [];

const add = (fg, bg, min, kind, note) => PAIRS.push({ fg, bg, min, kind, note });

// Body text on every reading surface.
for (const bg of READING_SURFACES) {
  for (const fg of ["--fg-max", "--fg-primary", "--fg-secondary", "--fg-muted"]) {
    add(fg, bg, 4.5, "text");
  }
}

// Brand.
add("--fg-on-accent", "--accent", 4.5, "text");
for (const bg of CARD_SURFACES) {
  add("--fg-link", bg, 4.5, "text");
  add("--accent", bg, 4.5, "text", "accent used as link/active label");
}
add("--accent-border", "--accent-subtle", 3.0, "ui");
add("--accent", "--bg-selected", 4.5, "text", "label on a selected row");

// Status: the badge label sits on its own tint; the dot sits on a card.
for (const s of STATUSES) {
  add(`--status-${s}`, `--status-${s}-subtle`, 4.5, "text", "badge label on tint");
  add(`--status-${s}-border`, `--status-${s}-subtle`, 3.0, "ui", "badge outline");
  for (const bg of CARD_SURFACES) {
    add(`--status-${s}`, bg, 3.0, "ui", "status dot / glyph");
  }
}

// Borders that carry state or boundary meaning.
for (const bg of CARD_SURFACES) {
  add("--border-default", bg, 3.0, "ui");
  add("--border-strong", bg, 3.0, "ui");
  add("--border-focus", bg, 3.0, "ui", "focus ring");
}
add("--border-focus", "--bg-app", 3.0, "ui", "focus ring on app bg");

// Risk and environment indicators.
for (const r of ["low", "medium", "high", "critical"]) {
  add(`--risk-${r}`, "--bg-raised", 3.0, "ui");
}
for (const e of ["production", "staging", "development"]) {
  add(`--env-${e}`, "--bg-app", 3.0, "ui", "environment rail / chip");
}

// Plan tier: the ring sits on chrome, the chip label sits on its own fill.
for (const t of PLAN_TIERS) {
  add(`--plan-${t}-chip-fg`, `--plan-${t}-chip-bg`, 4.5, "text", "plan chip label");
  for (const bg of [...CARD_SURFACES, "--bg-app", "--bg-overlay"]) {
    add(`--plan-${t}-ink`, bg, 3.0, "ui", "plan ring on an avatar");
  }
  // Enterprise's chip is a SOLID inversion, so its outline is its own fill and
  // measuring the two against each other asks a question with no answer. The
  // tinted tiers still have to clear 3:1, which is what this skips past.
  if (t !== "enterprise") {
    add(`--plan-${t}-ink`, `--plan-${t}-chip-bg`, 3.0, "ui", "plan chip outline");
  }
}

// Decorative and WCAG-exempt — measured and printed, never failed.
for (const bg of CARD_SURFACES) {
  add("--border-subtle", bg, 0, "decorative", "row/card separator — WCAG 1.4.11 exempt");
  add("--fg-disabled", bg, 0, "decorative", "disabled control — WCAG 1.4.3 exempt");
}
add("--bg-hover", "--bg-raised", 0, "decorative", "surface delta");
add("--bg-active", "--bg-raised", 0, "decorative", "surface delta");
add("--bg-selected", "--bg-raised", 0, "decorative", "surface delta");

const THEMES = [
  ["dark", darkMap],
  ["light", lightMap],
];

// ─── The governing rule, enforced ─────────────────────────────────────────────
//
// Brand and status are disjoint sets. This is the single most important
// invariant in the token layer and the specific regression that made the old
// UI unscannable, so it is checked mechanically rather than trusted to review.

const FAMILIES = {
  iris: ["--iris-50", "--iris-100", "--iris-200", "--iris-300", "--iris-400", "--iris-500",
    "--iris-600", "--iris-700", "--iris-800", "--iris-900", "--iris-950"],
  verdant: ["--verdant-50", "--verdant-400", "--verdant-500", "--verdant-600", "--verdant-700", "--verdant-950"],
  signal: ["--signal-50", "--signal-400", "--signal-500", "--signal-600", "--signal-700", "--signal-950"],
  pulse: ["--pulse-50", "--pulse-400", "--pulse-500", "--pulse-600", "--pulse-700", "--pulse-950"],
  ember: ["--ember-200", "--ember-300", "--ember-400", "--ember-500", "--ember-600", "--ember-700", "--ember-950"],
};

/** Hex set for a primitive family, in a given theme map. */
const familyHexes = (family, map) =>
  new Set(FAMILIES[family].map((n) => resolve(n, map)).filter(Boolean));

const ruleViolations = [];

for (const [theme, map] of THEMES) {
  const iris = familyHexes("iris", map);
  const statusHues = new Set(
    ["verdant", "signal", "pulse"].flatMap((f) => [...familyHexes(f, map)]),
  );

  // Brand tokens must live in iris and must never touch a status hue.
  for (const t of ["--accent", "--accent-hover", "--accent-active", "--accent-border", "--border-focus"]) {
    const hex = resolve(t, map);
    if (hex && statusHues.has(hex)) {
      ruleViolations.push(`[${theme}] ${t} resolves to ${hex}, which is a STATUS hue. Brand must be iris.`);
    }
  }

  // Status tokens must never be the brand hue.
  for (const s of STATUSES) {
    const hex = resolve(`--status-${s}`, map);
    if (hex && iris.has(hex)) {
      ruleViolations.push(`[${theme}] --status-${s} resolves to ${hex}, which is the BRAND hue. Status must never be iris.`);
    }
  }

  // A plan tier is neither. It must not borrow the brand — a gold ring that is
  // actually iris says "selected" on something nobody selected — and it must not
  // borrow a status, INCLUDING EMBER: gold and amber are eleven degrees apart,
  // so the one way this design fails silently is Team drifting into the colour
  // of a run that is waiting on a human.
  const planForbidden = new Map();
  for (const f of ["iris", "verdant", "signal", "pulse", "ember"]) {
    for (const hex of familyHexes(f, map)) planForbidden.set(hex, f);
  }
  for (const t of PLAN_TIERS) {
    for (const role of ["ink", "chip-fg"]) {
      const token = `--plan-${t}-${role}`;
      const hex = resolve(token, map);
      const family = hex ? planForbidden.get(hex) : undefined;
      if (family) {
        ruleViolations.push(
          `[${theme}] ${token} resolves to ${hex}, which is a ${family.toUpperCase()} step. ` +
          `A plan tier must not wear the brand or a status.`,
        );
      }
    }
  }

  // Success must be verdant specifically — the old UI collapsed it onto brand.
  const success = resolve("--status-success", map);
  if (success && !familyHexes("verdant", map).has(success)) {
    ruleViolations.push(`[${theme}] --status-success resolves to ${success}, which is not a verdant step.`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

let failures = 0;
let unresolved = 0;
const rows = [];

for (const [theme, map] of THEMES) {
  for (const p of PAIRS) {
    const fgHex = resolve(p.fg, map);
    const bgHex = resolve(p.bg, map);
    if (!fgHex || !bgHex) {
      unresolved++;
      rows.push({ theme, ...p, ratio: null, status: "UNRESOLVED", fgHex, bgHex });
      continue;
    }
    const ratio = contrast(fgHex, bgHex);
    const enforced = p.min > 0;
    const pass = !enforced || ratio >= p.min;
    if (enforced && !pass) failures++;
    rows.push({
      theme,
      ...p,
      fgHex,
      bgHex,
      ratio,
      status: !enforced ? "DECORATIVE" : pass ? "PASS" : "FAIL",
    });
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);

for (const [theme] of THEMES) {
  const set = rows.filter((r) => r.theme === theme);
  const enforced = set.filter((r) => r.min > 0);
  const failed = enforced.filter((r) => r.status === "FAIL");
  const passed = enforced.filter((r) => r.status === "PASS");
  console.log(
    `\n${"═".repeat(96)}\n  THEME: ${theme.toUpperCase()}   ` +
      `${passed.length}/${enforced.length} enforced pairings pass\n${"═".repeat(96)}`,
  );
  const show = failed.length > 0 ? failed : [];
  for (const r of show) {
    console.log(
      `  FAIL  ${pad(r.fg, 30)} on ${pad(r.bg, 28)} ` +
        `${r.ratio.toFixed(2)}:1  (needs ${r.min}:1)  ${r.fgHex} / ${r.bgHex}` +
        (r.note ? `  — ${r.note}` : ""),
    );
  }
  if (failed.length === 0) console.log("  All enforced pairings pass.");

  const dec = set.filter((r) => r.min === 0);
  if (dec.length) {
    console.log("\n  Decorative / exempt (measured, not enforced):");
    for (const r of dec) {
      console.log(
        `        ${pad(r.fg, 30)} on ${pad(r.bg, 28)} ${r.ratio ? r.ratio.toFixed(2) : "  ?  "}:1` +
          (r.note ? `  — ${r.note}` : ""),
      );
    }
  }
}

if (unresolved > 0) {
  console.error(`\n✗ ${unresolved} pairing(s) referenced a token that does not resolve to a colour.`);
  for (const r of rows.filter((x) => x.status === "UNRESOLVED")) {
    console.error(`    [${r.theme}] ${r.fg} on ${r.bg}`);
  }
}

if (ruleViolations.length > 0) {
  console.error(`\n✗ GOVERNING RULE VIOLATED — brand and status are not disjoint:\n`);
  for (const v of ruleViolations) console.error(`    ${v}`);
  console.error(
    `\n  See the rule block at the top of apps/web/src/styles/tokens/colour.css.\n`,
  );
} else {
  console.log("\n  ✓ Governing rule holds: brand (iris) and status hues are disjoint in both themes.");
}

const bad = failures + unresolved + ruleViolations.length;
console.log(
  `\n${"─".repeat(96)}\n  ${bad === 0 ? "✓" : "✗"} ${failures} contrast failure(s), ` +
    `${unresolved} unresolved token(s), ${ruleViolations.length} rule violation(s), across both themes.\n`,
);

process.exit(!REPORT_ONLY && bad > 0 ? 1 : 0);
