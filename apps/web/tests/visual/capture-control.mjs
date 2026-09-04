/**
 * Capture Control: every state, both themes, 1440 and 390.
 *
 * The page freezes itself for capture via ?frozen=1 — the activity stream stops
 * ticking and the "updated N ago" label pins to "just now". Without that, every
 * screenshot diff is a clock and a scrolling log, and visual regression testing
 * is impossible.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/control");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open(query, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("vectorbea-theme", t); } catch {}
  }, theme);
  await page.goto(`${BASE}/control${query}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 30000 });
  await page.waitForTimeout(900);
  return page;
}

async function shot(page, name, { full = false } = {}) {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log(`  ${name}.png`);
}

const FROZEN = "?frozen=1";

/* ── Ready, both themes, both widths ──────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\n${theme} · 1440:`);
  const page = await open(FROZEN, { theme });
  await shot(page, `${theme}-1440`);
  await shot(page, `${theme}-1440-full`, { full: true });
  await page.close();

  console.log(`${theme} · 390:`);
  const mobile = await open(FROZEN, { theme, width: 390, height: 844 });
  await shot(mobile, `${theme}-390`);
  await shot(mobile, `${theme}-390-full`, { full: true });
  await mobile.close();
}

/* ── States ──────────────────────────────────────────────────────────────── */
console.log("\nstates:");
for (const [query, name] of [
  ["?frozen=1&state=loading", "loading"],
  ["?frozen=1&state=empty", "empty"],
]) {
  const page = await open(query, { theme: "dark" });
  await shot(page, `dark-${name}`, { full: true });
  await page.close();

  const light = await open(query, { theme: "light", width: 390, height: 844 });
  await shot(light, `light-390-${name}`, { full: true });
  await light.close();
}

/* ── Interactions ────────────────────────────────────────────────────────── */
console.log("\ninteractions:");
{
  // Dismiss-with-reason dialog.
  const page = await open(FROZEN, { theme: "dark" });
  await page.locator('button[aria-label^="Dismiss:"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, "dismiss-dialog");
  await page.keyboard.press("Escape");

  // Fleet sorted by spend, and a heatstrip cell focused.
  await page.getByRole("button", { name: "Spend" }).click();
  await page.waitForTimeout(300);
  await shot(page, "fleet-sorted-spend");
  await page.close();
}
{
  // All-clear: dismiss every item to reach the achievement state.
  const page = await open(FROZEN, { theme: "light" });
  for (let i = 0; i < 12; i += 1) {
    const button = page.locator('button[aria-label^="Dismiss:"]').first();
    if ((await button.count()) === 0) break;
    await button.click();
    await page.waitForTimeout(160);
    await page.getByRole("button", { name: "Dismiss item" }).click();
    await page.waitForTimeout(160);
  }
  await shot(page, "light-all-clear", { full: true });
  await page.close();
}

/* ── Time range ──────────────────────────────────────────────────────────── */
console.log("\nrange:");
for (const id of ["1h", "7d", "30d"]) {
  const page = await open(`?frozen=1&range=${id}`, { theme: "dark" });
  await shot(page, `range-${id}`);
  await page.close();
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
