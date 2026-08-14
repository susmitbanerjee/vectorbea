/** Capture the node inspector: every tab, both themes. The Inputs tab is the deliverable. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/inspector");
mkdirSync(outDir, { recursive: true });

const RENEWALS = "wf_ded1287b";

const browser = await chromium.launch();

async function open({ theme = "dark", width = 1600, height = 1000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addCookies([
    { name: "vectorbea-access-token", value: "capture-harness", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("vectorbea-theme", t);
      // A persisted inspector width would make every capture a different shape.
      window.localStorage.removeItem("vectorbea-inspector-width");
    } catch {}
  }, theme);
  await page.goto(`${BASE}/workflows/${RENEWALS}/builder`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1, .react-flow", { timeout: 60000 });
  /* React Flow measures nodes through a ResizeObserver and culls edges until it
     has — screenshotting before that lands captures a canvas with no edges.

     `waitForFunction(fn, arg, options)`: the options are the THIRD argument.
     Passing them second made them the page function's argument and left the
     default 30s timeout in place. Non-fatal either way — the inspector is what
     these captures are of, and an edgeless canvas behind it is a worse
     screenshot rather than a failed run. */
  await page
    .waitForFunction(() => document.querySelectorAll(".react-flow__edge").length > 0, undefined, { timeout: 90000 })
    .catch(() => console.log("  (edges had not rendered before the timeout)"));
  await page.waitForTimeout(800);
  return page;
}

const done = (page) => page.context().close();

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...opts });
  console.log(`  ${name}.png`);
};

/**
 * Select a node by walking the graph with the keyboard, which also exercises it.
 *
 * Tabs until the inspector's own aria-label reports the node we want, rather
 * than pressing Tab a fixed number of times: the traversal is topological, so a
 * fixed count is only correct for one particular graph and breaks the moment a
 * node is added ahead of the target.
 */
async function selectNode(page, match) {
  const tab = () => page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));

  for (let i = 0; i < 30; i += 1) {
    await tab();
    await page.waitForTimeout(220);
    const label = await page
      .locator('aside[aria-label^="Inspector for"]')
      .first()
      .getAttribute("aria-label")
      .catch(() => null);
    if (label && new RegExp(match, "i").test(label)) {
      await page.waitForTimeout(400);
      return true;
    }
  }
  console.log(`  (never reached a node matching ${match})`);
  return false;
}

const openTab = async (page, label) => {
  await page.locator(`aside[aria-label^="Inspector for"] [role=tab]`).filter({ hasText: label }).first().click();
  await page.waitForTimeout(500);
};

for (const theme of ["dark", "light"]) {
  console.log(`\ninspector ${theme}:`);
  const page = await open({ theme });

  // Two Tabs lands on contracts.getUpcomingRenewals — the tool node the whole
  // demo narrative runs through, and the one with real upstream data to bind.
  await selectNode(page, "getUpcomingRenewals");

  await openTab(page, "Configure");
  await shot(page, `configure-${theme}`);

  /* ── The Inputs tab, the deliverable ────────────────────────────────────
     Captured three ways: unbound, bound with a live resolved value, and with a
     type mismatch plus its coercion — because the resolved preview is the whole
     point and a screenshot of an empty mapping panel does not show it. */
  await openTab(page, "Inputs");
  await shot(page, `inputs-${theme}-unbound`);

  await page.locator('aside[aria-label^="Inspector for"] button[draggable=true]')
    .filter({ hasText: "cause" }).first().click();
  await page.waitForTimeout(600);
  await shot(page, `inputs-${theme}`);

  // Expand the transform and null-handling controls under the bound input.
  await page.locator('aside[aria-label^="Inspector for"] button')
    .filter({ hasText: "Transform, default and null handling" }).first().click();
  await page.waitForTimeout(500);
  await shot(page, `inputs-${theme}-transform`);

  await openTab(page, "Output");
  await shot(page, `output-${theme}`);

  await openTab(page, "Advanced");
  await shot(page, `advanced-${theme}`);

  await openTab(page, "Test");
  await shot(page, `test-${theme}`);

  await done(page);
}

console.log("\nvariants:");
{
  // Expanded to full screen — the layout the mapping UI is designed for.
  const page = await open({ theme: "dark" });
  await selectNode(page, "getUpcomingRenewals");
  await openTab(page, "Inputs");
  await page.getByRole("button", { name: /Expand the inspector/ }).click();
  await page.waitForTimeout(600);
  await page.locator('button[draggable=true]').filter({ hasText: "cause" }).first().click();
  await page.waitForTimeout(600);
  await shot(page, "inputs-expanded");
  await done(page);

  // An approval node: the decision-context template editor that feeds the
  // Approvals page's resolved context.
  const approval = await open({ theme: "dark" });
  await selectNode(approval, "approval");
  await openTab(approval, "Configure");
  await shot(approval, "configure-approval", { fullPage: true });
  await done(approval);

  // The retry timeline with a multi-attempt policy.
  const retry = await open({ theme: "dark" });
  await selectNode(retry, "getUpcomingRenewals");
  await openTab(retry, "Advanced");
  await retry.locator('aside[aria-label^="Inspector for"] input[type=number]').first().fill("5");
  await retry.waitForTimeout(600);
  await shot(retry, "advanced-retry-timeline");
  await done(retry);
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
