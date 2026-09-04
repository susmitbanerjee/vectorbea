/**
 * Fuzzy matching for the command palette.
 *
 * Hand-written rather than pulled from fuse.js/cmdk, for one reason that
 * matters: the ranking has to understand OUR data. A palette that ranks a
 * workflow named "renewals" below a settings page called "Renewal reminders"
 * because the latter has a shorter title is a palette people stop using.
 *
 * Scoring, highest first:
 *   - exact match
 *   - prefix match           "ren" → "renewals"
 *   - word-boundary match    "rd"  → "Run Detail"
 *   - contiguous substring   "new" → "renewals"
 *   - scattered subsequence  "rnw" → "renewals"
 *
 * Consecutive characters and matches at word boundaries score higher, so
 * initialisms rank above accidental letter soup.
 */

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters, for highlighting. */
  matches: number[];
}

const EXACT = 1000;
const PREFIX = 500;
const BOUNDARY_BONUS = 15;
const CONSECUTIVE_BONUS = 12;
const CAMEL_BONUS = 10;
const GAP_PENALTY = 2;

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".";
}

/** Returns null when the query does not match at all. */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (!query) return { score: 1, matches: [] };

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) {
    return { score: EXACT, matches: Array.from({ length: text.length }, (_, i) => i) };
  }
  if (haystack.startsWith(needle)) {
    return { score: PREFIX + needle.length, matches: Array.from({ length: needle.length }, (_, i) => i) };
  }

  // Greedy subsequence walk, scoring position quality as it goes.
  const matches: number[] = [];
  let score = 0;
  let from = 0;
  let lastIndex = -2;

  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index === -1) return null;

    matches.push(index);
    score += 1;
    if (isBoundary(text, index)) score += BOUNDARY_BONUS;
    if (index === lastIndex + 1) score += CONSECUTIVE_BONUS;
    // A lowercase→uppercase step is a word boundary in camelCase identifiers.
    if (index > 0 && text[index] === text[index].toUpperCase() && text[index - 1] !== text[index - 1].toUpperCase()) {
      score += CAMEL_BONUS;
    }
    score -= Math.min(index - from, 10) * GAP_PENALTY;

    lastIndex = index;
    from = index + 1;
  }

  // Shorter haystacks win ties — "Runs" beats "Run comparison" for "run".
  score += Math.max(0, 24 - text.length);
  return { score, matches };
}

/** Rank a list, dropping non-matches. Stable within equal scores. */
export function fuzzyRank<T>(
  items: T[],
  query: string,
  toText: (item: T) => string,
): { item: T; score: number; matches: number[] }[] {
  return items
    .map((item) => {
      const result = fuzzyMatch(toText(item), query);
      return result ? { item, score: result.score, matches: result.matches } : null;
    })
    .filter((x): x is { item: T; score: number; matches: number[] } => x !== null)
    .sort((a, b) => b.score - a.score);
}

/** Split text into matched/unmatched runs for highlighting. */
export function highlightRuns(text: string, matches: number[]): { text: string; hit: boolean }[] {
  if (matches.length === 0) return [{ text, hit: false }];
  const set = new Set(matches);
  const runs: { text: string; hit: boolean }[] = [];
  let buffer = "";
  let hit = set.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const isHit = set.has(i);
    if (isHit !== hit) {
      if (buffer) runs.push({ text: buffer, hit });
      buffer = "";
      hit = isHit;
    }
    buffer += text[i];
  }
  if (buffer) runs.push({ text: buffer, hit });
  return runs;
}

/** A v4 UUID, or one of our prefixed ids (run_…, wf_…). */
export const ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:run|wf|agt|tool|conn)_[0-9a-zA-Z]{6,})$/i;

export function looksLikeId(value: string): boolean {
  return ID_PATTERN.test(value.trim());
}
