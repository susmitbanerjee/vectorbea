/**
 * Capture Runs: every state, both themes, 1440 and 390.
 *
 * AUTH. /runs is behind `AUTH_PROTECTED_PREFIXES` in middleware.ts, which only
 * checks that the session cookie is present. The harness sets a placeholder so
 * the presentation layer can be captured without standing up a real session.
 * This is a test-only cookie on localhost — the middleware is not modified.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/runs");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open(query, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await context.addCookies([
    {
      name: "vectorbea-access-token",
      value: "capture-harness-placeholder",
      domain: "localhost",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("vectorbea-theme", t);
      window.localStorage.removeItem("vectorbea-table:runs");
    } catch {}
  }, theme);
  await page.goto(`${BASE}/runs${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 40000 });
  await page.waitForTimeout(1100);
  return page;
}

async function shot(page, name, { full = false } = {}) {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log(`  ${name}.png`);
}

const FROZEN = "?frozen=1";

/* ── Ready, both themes, both widths ──────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\n${theme}:`);
  const page = await open(FROZEN, { theme });
  await shot(page, `${theme}-1440`);
  await shot(page, `${theme}-1440-full`, { full: true });
  await page.close();

  const mobile = await open(FROZEN, { theme, width: 390, height: 844 });
  await shot(mobile, `${theme}-390`, { full: true });
  await mobile.close();
}

/* ── States ──────────────────────────────────────────────────────────────── */
console.log("\nstates:");
for (const [query, name] of [
  ["?frozen=1&state=loading", "loading"],
  ["?frozen=1&state=empty", "empty"],
  ["?frozen=1&state=error", "error"],
  ["?frozen=1&q=status%3Afailed%20workflow%3Anothing-matches", "no-results"],
]) {
  const page = await open(query, { theme: "dark" });
  await shot(page, `dark-${name}`);
  await page.close();
}

/* ── Query bar ───────────────────────────────────────────────────────────── */
console.log("\nquery bar:");
{
  const page = await open(FROZEN, { theme: "dark" });
  const input = page.getByRole("combobox", { name: "Filter runs" });

  await input.click();
  await input.type("status:", { delay: 20 });
  await page.waitForTimeout(300);
  await shot(page, "query-autocomplete");

  await input.fill("status:failed since:24h cost:>0.005");
  await page.waitForTimeout(300);
  await shot(page, "query-valid");

  await input.fill("statuz:failed sinse:24h");
  await page.waitForTimeout(300);
  await shot(page, "query-invalid");
  await page.close();
}

/* ── Selection and bulk bar ──────────────────────────────────────────────── */
console.log("\nbulk:");
{
  const page = await open("?frozen=1&q=status%3Afailed", { theme: "dark" });
  const boxes = page.locator('[role="row"][aria-rowindex] input[type="checkbox"]');
  await boxes.nth(0).click();
  await page.waitForTimeout(120);
  await boxes.nth(5).click({ modifiers: ["Shift"] });
  await page.waitForTimeout(350);
  await shot(page, "bulk-bar");

  await page.getByRole("button", { name: /^Retry/ }).first().click();
  await page.waitForTimeout(400);
  await shot(page, "bulk-retry-estimate");
  await page.close();
}

/* ── Quick peek ──────────────────────────────────────────────────────────── */
console.log("\npeek:");
{
  const page = await open("?frozen=1&q=status%3Afailed", { theme: "dark" });
  await page.locator('[role="row"][aria-rowindex]').nth(2).hover();
  await page.waitForTimeout(700);
  await shot(page, "quick-peek");
  await page.close();
}

/* ── Density and saved views ─────────────────────────────────────────────── */
console.log("\ncontrols:");
{
  const page = await open(FROZEN, { theme: "light" });
  await page.getByRole("button", { name: "Compact" }).click();
  await page.waitForTimeout(400);
  await shot(page, "light-compact");

  await page.getByRole("button", { name: /Views/ }).click();
  await page.waitForTimeout(350);
  await shot(page, "saved-views");
  await page.close();
}

/* ── 10k ─────────────────────────────────────────────────────────────────── */
console.log("\nscale:");
{
  const page = await open("?frozen=1&scale=10000&range=30d", { theme: "dark" });
  await shot(page, "scale-10k");
  await page.close();
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
