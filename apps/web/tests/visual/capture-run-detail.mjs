/**
 * Capture run detail: every state, both themes, plus a frame sequence of the
 * replay scrubber driving the canvas.
 *
 * The scrub sequence is the deliverable the prompt calls the demo moment, so it
 * is captured by DRAGGING the ribbon for real — pointer down, move, move, move —
 * not by setting state directly. If the drag does not drive the panes, these
 * frames will show it.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const RUN = "run_01JBQZ8XK4T9V2M7N3P6R8S1W5";
const outDir = resolve(process.argv[2] ?? "screenshots/run-detail");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open(query = "?frozen=1", { theme = "dark", width = 1600, height = 1100 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addCookies([
    { name: "vectorbea-access-token", value: "capture-harness", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("vectorbea-theme", t); } catch {}
  }, theme);
  await page.goto(`${BASE}/runs/${RUN}${query}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 60000 });
  await page.waitForTimeout(1400);
  return page;
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...opts });
  console.log(`  ${name}.png`);
}

/* ── Both themes ─────────────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\n${theme}:`);
  const page = await open("?frozen=1", { theme });
  await shot(page, `${theme}-1600`);
  await shot(page, `${theme}-1600-full`, { fullPage: true });
  await page.close();
}

/* ── Run states ──────────────────────────────────────────────────────────── */
console.log("\nstates:");
for (const demo of ["running", "queued", "gated", "succeeded", "cancelled"]) {
  const page = await open(`?frozen=1&demo=${demo}`, { theme: "dark" });
  await shot(page, `state-${demo}`);
  await page.close();
}

/* ── Inspector tabs ──────────────────────────────────────────────────────── */
console.log("\ninspector:");
{
  const page = await open("?frozen=1", { theme: "dark" });
  for (const tab of ["Overview", "Input", "Output", "Tool call", "Error", "Cost"]) {
    const button = page.getByRole("tab", { name: tab });
    if ((await button.count()) === 0) continue;
    await button.click();
    await page.waitForTimeout(260);
    await shot(page, `inspector-${tab.toLowerCase().replace(/\s+/g, "-")}`);
  }
  await page.close();
}

/* ── Compare and events ──────────────────────────────────────────────────── */
console.log("\ncompare + events:");
{
  const page = await open("?frozen=1", { theme: "dark" });
  await page.getByRole("button", { name: "Compare" }).click();
  await page.waitForTimeout(400);
  await shot(page, "compare");

  await page.getByRole("button", { name: /Event history/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "event-history", { fullPage: true });
  await page.close();
}

/* ── THE SCRUB SEQUENCE ──────────────────────────────────────────────────── */
console.log("\nscrub sequence (real pointer drag):");
{
  const page = await open("?frozen=1", { theme: "dark" });

  // The lg ribbon is the interactive one in the header card.
  const ribbon = page.locator('[aria-label*="Checkpoint"], svg').first();
  const card = await page.locator("header >> css=.rounded-lg").last().boundingBox();
  const box = card ?? (await ribbon.boundingBox());

  const y = box.y + box.height - 26;
  const x0 = box.x + 16;
  const x1 = box.x + box.width - 16;

  await page.mouse.move(x0, y);
  await page.mouse.down();

  const FRAMES = 8;
  for (let i = 0; i <= FRAMES; i += 1) {
    const x = x0 + ((x1 - x0) * i) / FRAMES;
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(160);
    await shot(page, `scrub-${String(i).padStart(2, "0")}`);
  }

  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot(page, "scrub-released");
  await page.close();
}

/* ── Log full screen ─────────────────────────────────────────────────────── */
console.log("\nlog:");
{
  const page = await open("?frozen=1", { theme: "light" });
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.waitForTimeout(400);
  await shot(page, "light-log-fullscreen");
  await page.close();
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
