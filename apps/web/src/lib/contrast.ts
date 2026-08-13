/**
 * WCAG 2.1 contrast maths, and resolution of CSS custom properties to hex.
 *
 * Used by the token gallery to report the CONTRAST AS RENDERED, rather than as
 * declared — it reads from getComputedStyle, so what the gallery grades is the
 * value the browser actually paints in the active theme.
 *
 * The build-time gate is scripts/check-contrast.mjs, which performs the same
 * checks by parsing colour.css. That script is authoritative for CI; this module
 * is what makes the numbers visible to a human.
 */

/** WCAG 2.1 minimum contrast ratios. */
export const AA_BODY = 4.5;
export const AA_LARGE = 3;

export type Requirement = "text" | "ui" | "decorative";

export const MINIMUM: Record<Requirement, number> = {
  text: AA_BODY,
  ui: AA_LARGE,
  decorative: 0,
};

/** Expand #rgb / #rrggbbaa to a six-digit hex. Returns null if unparseable. */
function normaliseHex(input: string): string | null {
  const m = input.trim().match(/^#([0-9a-fA-F]{3,8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return h.length === 6 ? `#${h.toLowerCase()}` : null;
}

/** Parse `rgb(r g b / a)` and `rgb(r, g, b)`, which is what some browsers return. */
function parseRgb(input: string): string | null {
  const m = input.trim().match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  const hex = parts
    .slice(0, 3)
    .map((n) => Math.round(n).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/**
 * Resolve a custom property to a hex string, following `var()` chains.
 *
 * Browsers usually substitute variables when computing a custom property, but
 * not always at every nesting depth, so the chain is walked explicitly. `depth`
 * guards against a cyclic definition.
 */
export function resolveToken(
  name: string,
  el: Element = document.documentElement,
  depth = 0,
): string | null {
  if (depth > 12) return null;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return null;

  const hex = normaliseHex(raw);
  if (hex) return hex;

  const rgb = parseRgb(raw);
  if (rgb) return rgb;

  const ref = raw.match(/^var\(\s*(--[\w-]+)/);
  if (ref) return resolveToken(ref[1], el, depth + 1);

  return null;
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => channelLuminance(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

export function passes(ratio: number, requirement: Requirement): boolean {
  return ratio >= MINIMUM[requirement];
}
