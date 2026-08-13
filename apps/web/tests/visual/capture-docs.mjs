/**
 * Capture the docs in both themes, plus the print rendering and the ⌘K palette.
 *
 * Print is captured with emulateMedia("print") rather than by generating a PDF,
 * because a PDF cannot be eyeballed in a review. The screenshot shows exactly
 * what the print stylesheet does: rails dropped, ink re-pointed, anchors and the
 * feedback widget gone.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/docs");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open(path, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  // Set the persisted theme before first paint so nothing flashes.
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("vectorbea-theme", t);
    } catch {}
  }, theme);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 25000 });
  // The shell hydrates the scroll spy and progress bar on mount; wait for a
  // frame past that so the on-this-page rail has an active entry.
  await page.waitForTimeout(700);
  return page;
}

async function shot(page, name, { full = false } = {}) {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log(`  ${name}.png`);
}

const PAGES = [
  ["/docs", "introduction"],
  ["/docs/durability", "durability"],
  ["/docs/io-mapping", "io-mapping"],
  ["/docs/first-workflow", "first-workflow"],
  ["/docs/api-reference", "api-reference"],
];

for (const theme of ["dark", "light"]) {
  console.log(`\n${theme}:`);
  for (const [path, name] of PAGES) {
    const page = await open(path, { theme });
    await shot(page, `${theme}-${name}`);
    await shot(page, `${theme}-${name}-full`, { full: true });
    await page.close();
  }
}

/* ── ⌘K ───────────────────────────────────────────────────────────────────── */
console.log("\nsearch:");
{
  const page = await open("/docs/durability", { theme: "dark" });
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(350);
  await shot(page, "search-empty");
  await page.keyboard.type("idempo");
  await page.waitForTimeout(250);
  await shot(page, "search-query");
  await page.close();
}

/* ── Print ────────────────────────────────────────────────────────────────── */
console.log("\nprint:");
for (const [path, name] of [["/docs/durability", "durability"], ["/docs/security", "security"]]) {
  // Captured from the DARK theme deliberately: that is the failure case the
  // print block exists to fix.
  const page = await open(path, { theme: "dark", width: 820, height: 1160 });
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  await shot(page, `print-${name}`, { full: true });
  await page.pdf({ path: join(outDir, `print-${name}.pdf`), format: "A4", printBackground: true });
  console.log(`  print-${name}.pdf`);
  await page.close();
}

/* ── Narrow ───────────────────────────────────────────────────────────────── */
console.log("\nresponsive:");
{
  const page = await open("/docs/durability", { theme: "dark", width: 390, height: 844 });
  await shot(page, "mobile-durability", { full: true });
  await page.close();
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
