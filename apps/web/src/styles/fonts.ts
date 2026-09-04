import localFont from "next/font/local";

/**
 * THE FONT LAYER — the single file to edit when swapping the typeface stack.
 *
 * Design direction §4 names a premium upgrade path (PP Neue Montreal / Söhne /
 * Berkeley Mono) and requires that it be a one-file change. It is: replace the
 * `src` arrays below and drop the new .woff2 files into ./fonts. Nothing else in
 * the codebase names a typeface — components reference `font-display`,
 * `font-ui` and `font-code`, which resolve through
 * src/styles/tokens/typography.css to the CSS variables exported here.
 *
 * SELF-HOSTED, NOT CDN. All three families are served from our own origin via
 * next/font/local: no third-party request on page load, no privacy leak to
 * Google or Fontshare, no extra DNS/TLS handshake on the critical path.
 * Files are subset to latin + latin-ext. Total 263 KB across 13 files.
 *
 * LICENSING
 *   Cabinet Grotesk, Switzer — Indian Type Foundry, ITF Free Font License
 *   JetBrains Mono          — SIL Open Font License 1.1
 * All three permit self-hosting and commercial use. See ./fonts/LICENSES.md.
 *
 * WEIGHT NOTE: Cabinet Grotesk ships Medium (500), Bold (700) and Extrabold
 * (800) — there is no true 600. §4.1 asks for Cabinet 600 at `display-md`, so
 * Medium is declared as 600. That is a real mapping, not a synthetic weight:
 * asking for 600 gets you the Medium cut rather than a browser-faked one.
 */

/** Display — Cabinet Grotesk. Marketing heroes and big telemetry numerals. */
export const fontDisplay = localFont({
  src: [
    { path: "./fonts/CabinetGrotesk-Medium.woff2", weight: "600", style: "normal" },
    { path: "./fonts/CabinetGrotesk-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/CabinetGrotesk-Extrabold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--ff-display",
  display: "swap",
  // Not preloaded: display type appears on marketing and page heroes, never in
  // the dense product chrome that dominates first paint.
  preload: false,
  fallback: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * UI — Switzer. Everything in the product chrome.
 *
 * This is the only preloaded family. next/font preloads a font object's files
 * as a unit, so the 600/700 cuts ride along with 400/500 rather than being
 * preloadable separately — splitting them into two `localFont` calls would
 * generate two different family names and make `font-weight: 600` synthesise a
 * fake bold from the 400 face. Four files, ~76 KB, is the correct trade.
 */
export const fontUI = localFont({
  src: [
    { path: "./fonts/Switzer-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Switzer-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Switzer-Semibold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Switzer-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--ff-ui",
  display: "swap",
  preload: true,
  fallback: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * Mono — JetBrains Mono. Logs, IDs, JSON, durations, costs.
 *
 * VARIABLE, and that matters. Google Fonts serves JetBrains Mono as a variable
 * font: the woff2 behind weight 400, 500 and 700 is the SAME FILE (verified by
 * hash — all three downloads were byte-identical). Declaring them as three
 * static faces would ship one file three times and, worse, leave the browser
 * with a single weight to synthesise 500 and 700 from — faux bold on the exact
 * face chosen for its legibility in log output.
 *
 * Declared once with a `100 800` range instead, so 400/500/700 are real
 * interpolated instances of one 30 KB file.
 *
 * LATIN ONLY, deliberately. next/font/local has no per-source unicode-range, so
 * a second subset cannot be attached as another `src` entry — and chaining it as
 * a second family only works if the primary gives up its metric-matched
 * fallback, which trades a real CLS improvement for coverage this face barely
 * needs: the mono stack renders IDs, timestamps, durations, costs and JSON keys,
 * which are ASCII in practice. `JetBrainsMono-latin-ext.woff2` is kept in
 * ./fonts for the day that changes; wire it up as a plain @font-face with an
 * explicit `unicode-range` rather than through next/font.
 */
export const fontCode = localFont({
  src: [{ path: "./fonts/JetBrainsMono-latin.woff2", weight: "100 800", style: "normal" }],
  variable: "--ff-code",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "Cascadia Code", "Menlo", "Consolas", "monospace"],
});

/** Apply to <html>. Exposes --ff-display, --ff-ui and --ff-code. */
export const fontVariables = [
  fontDisplay.variable,
  fontUI.variable,
  fontCode.variable,
].join(" ");
