/**
 * Capture the landing page and a frame sequence of the hero recovery loop.
 *
 * The loop is the argument, so the frames are chosen at the beats that carry it:
 * committing, the failure, the pause showing what survived, the resume, and the
 * finish. Each is reached by SCRUBBING to a known frame index rather than by
 * waiting, so the sequence is deterministic.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/landing");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open({ width, height, reduced = false }) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 20000 });
  // Reveals are IntersectionObserver-driven; scroll the whole page once so
  // every section has entered, then return to the top for the capture.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  return page;
}

async function shot(page, name, opts = {}) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...opts });
  console.log(`captured ${file}`);
}

/** Pause the loop and jump to an exact frame via the scrub control. */
async function setFrame(page, index) {
  const slider = page.getByLabel("Scrub the run simulation");
  await slider.evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, index);
  await page.waitForTimeout(180);
}

/* ── Full page, 1440 and 390 ───────────────────────────────────────────────── */
for (const [name, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
]) {
  const page = await open(size);
  await shot(page, `landing-${name}`, { fullPage: true });
  await shot(page, `landing-${name}-hero`);
  await page.close();
}

/* ── Hero recovery loop, frame by frame ───────────────────────────────────── */
{
  const page = await open({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Pause" }).click().catch(() => {});

  const beats = [
    [6, "1-committing"],
    [13, "2-executing-step-7"],
    [14, "3-failed"],
    [15, "4-what-survived"],
    [16, "5-resuming-from-checkpoint-6"],
    [18, "6-recovered"],
    [30, "7-complete"],
  ];

  for (const [frame, name] of beats) {
    await setFrame(page, frame);
    const hero = page.locator("section").first();
    await hero.screenshot({ path: join(outDir, `loop-${name}.png`) });
    console.log(`captured loop-${name}`);
  }
  await page.close();
}

/* ── Reduced motion: must render the post-recovery end state, paused ───────── */
{
  const page = await open({ width: 1440, height: 900, reduced: true });
  await shot(page, "landing-reduced-motion");
  await page.close();
}

await browser.close();
