/** Capture Workflows: list, overview, version history and publish flow — all states, both themes. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/workflows");
mkdirSync(outDir, { recursive: true });

/* The signature workflow: renewals-daily. Its v6 raised a timeout and cut the
   retry budget on contracts.getUpcomingRenewals, and its success rate went from
   86% to 21% — which is what makes the reliability comparison worth capturing.
   contract-sync carries the half-finished draft that the Validate gate blocks. */
const RENEWALS = "wf_ded1287b";
const CONTRACT_SYNC = "wf_ed32ed03";
const DRAFT_ONLY = "wf_f01b9b16";

const browser = await chromium.launch();

async function open(path, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  // App routes sit behind AUTH_PROTECTED_PREFIXES in middleware.ts; the
  // placeholder token is what gets the harness past the redirect to /signin.
  await context.addCookies([
    { name: "vectorbea-access-token", value: "capture-harness", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("vectorbea-theme", t);
      // Pin the list to the table view regardless of what a previous run left
      // in localStorage, so a capture diff is never a preference diff.
      window.localStorage.removeItem("vectorbea-workflows-view");
    } catch {}
  }, theme);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 60000 });
  // A settle for fonts, the boot skeleton and hydration. `clickUntil` covers
  // whatever is left, because hydration timing is not something to guess at.
  await page.waitForTimeout(2000);
  return page;
}

/**
 * Close the CONTEXT, not just the page.
 *
 * `open` creates a context per capture. Closing only the page leaks the context
 * and its renderer process — forty of them starved the dev server until a table
 * that renders in 200ms standalone could not paint inside a 60-second wait, and
 * the failure surfaced as a locator timeout half a script away from the cause.
 */
const done = (page) => page.context().close();

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...opts });
  console.log(`  ${name}.png`);
};

/**
 * Wait for the virtualised table to have rows before touching one.
 *
 * The 1.1s settle in `open` is enough for a warm route and not enough for a
 * cold Next.js recompile, which is exactly the difference between a green run
 * and a 30-second timeout on a locator that was fine a minute ago.
 */
async function waitForRows(page) {
  try {
    await page.waitForSelector('[role="row"][aria-rowindex]', { timeout: 20000 });
    return;
  } catch {
    // One reload, then report what the page actually showed. A bare locator
    // timeout says "no rows" and nothing about why, which is the difference
    // between a two-minute fix and an afternoon.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1", { timeout: 60000 });
    await page.waitForTimeout(2000);
    try {
      await page.waitForSelector('[role="row"][aria-rowindex]', { timeout: 20000 });
      return;
    } catch (error) {
      const state = await page.evaluate(() => ({
        url: location.href,
        grid: !!document.querySelector('[role="grid"]'),
        rows: document.querySelectorAll('[role="row"]').length,
        text: document.querySelector("main")?.innerText.slice(0, 400).replace(/\n+/g, " | "),
      }));
      throw new Error(`No table rows after reload. ${JSON.stringify(state)}`);
    }
  }
}

/**
 * Click a control and confirm it took effect, retrying until it does.
 *
 * `waitForSelector("h1")` resolves against the SERVER-rendered HTML, so a click
 * issued a moment later can land before React has attached its handlers: the
 * DOM takes it, nothing happens, and the screenshot silently captures the
 * previous state. That is how a "simulate" capture ended up showing the Draft
 * panel. Asserting the effect is the only version that is not timing-dependent.
 */
async function clickUntil(page, locator, settled, label, { reloadOnStall = false } = {}) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (await settled(page)) return;

    // Half way through, reload once. Over a long run the dev server degrades
    // until a page can be painted but not yet interactive, and a fresh document
    // hydrates cleanly. Only safe where the step is addressable — reloading a
    // page whose state is not in the URL would throw that state away.
    if (reloadOnStall && attempt === 8) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 60000 });
      await page.waitForTimeout(2000);
    }

    const target = locator(page).first();
    // The label changes while an action is in flight ("Run simulation" becomes
    // "Simulating"), so a locator that no longer matches means the click landed
    // — wait for the effect rather than treating the miss as a failure.
    if (await target.count()) await target.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  throw new Error(`Never settled: ${label}`);
}

/* ── Warm-up ──────────────────────────────────────────────────────────────────
   Next dev compiles a route on first request. Against a cold server that
   compile lands inside the first capture's wait budget, so a table that renders
   in 200ms once warm can miss a 60-second wait — and the failure shows up as a
   locator timeout with no hint that compilation was the cause. One pass through
   every route first takes the compile off the critical path. */
console.log("warming routes:");
{
  const page = await open("/workflows?frozen=1");
  for (const path of [
    `/workflows/${RENEWALS}`,
    `/workflows/${RENEWALS}/versions`,
    `/workflows/${RENEWALS}/publish`,
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector("h1", { timeout: 120000 });
    console.log(`  ${path}`);
  }
  await done(page);
}

/* ── List: both themes, table and cards ───────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\nlist ${theme}:`);
  const page = await open("/workflows?frozen=1", { theme });
  await shot(page, `list-${theme}`);
  await shot(page, `list-${theme}-full`, { fullPage: true });
  await done(page);

  const cards = await open("/workflows?frozen=1&view=cards", { theme });
  await shot(cards, `cards-${theme}`, { fullPage: true });
  await done(cards);
}

/* ── List: every collection state ─────────────────────────────────────────── */
console.log("\nlist states:");
for (const state of ["loading", "empty", "no-results", "error"]) {
  const page = await open(`/workflows?frozen=1&state=${state}&q=nothing-matches-this`, { theme: "dark" });
  await shot(page, `list-state-${state}`);
  await done(page);
}

/* ── List: search that reaches inside the graph ───────────────────────────── */
console.log("\nlist search and filters:");
{
  const page = await open("/workflows?frozen=1&q=node:postgres", { theme: "dark" });
  await shot(page, "list-search-node", { fullPage: true });
  await done(page);

  const failing = await open("/workflows?frozen=1&q=health:failing", { theme: "dark" });
  await shot(failing, "list-filter-failing", { fullPage: true });
  await done(failing);
}

/* ── List: bulk bar and the delete confirmation ───────────────────────────── */
console.log("\nlist bulk and delete:");
{
  const page = await open("/workflows?frozen=1", { theme: "dark" });
  await waitForRows(page);
  // Row checkboxes only — the header's "Select all rows" also starts with
  // "Select " and would select the whole table on the first click.
  const boxes = page.locator(
    'input[type="checkbox"][aria-label^="Select "]:not([aria-label="Select all rows"])',
  );
  for (const i of [0, 1, 2]) await boxes.nth(i).click();
  await page.waitForTimeout(400);
  await shot(page, "list-bulk-bar");

  await page.getByRole("button", { name: /^Move/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "list-bulk-move");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // The delete confirmation names what breaks: the schedule that stops firing,
  // the endpoint that starts 404ing, and the history that goes with it.
  await page.getByRole("button", { name: /^Actions for / }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.waitForTimeout(500);
  await shot(page, "list-delete-confirm");
  await done(page);
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\noverview ${theme}:`);
  const page = await open(`/workflows/${RENEWALS}`, { theme });
  await shot(page, `overview-${theme}`);
  await shot(page, `overview-${theme}-full`, { fullPage: true });
  await done(page);
}

console.log("\noverview variants:");
{
  // A workflow whose only version is an unpublished draft — the version banner
  // has to say "nothing published yet" rather than reporting a live version.
  const draftOnly = await open(`/workflows/${DRAFT_ONLY}`, { theme: "dark" });
  await shot(draftOnly, "overview-draft-only", { fullPage: true });
  await done(draftOnly);

  const mobile = await open(`/workflows/${RENEWALS}`, { theme: "dark", width: 390, height: 844 });
  await shot(mobile, "overview-390", { fullPage: true });
  await done(mobile);
}

/* ── Version history and the diff ─────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\nversions ${theme}:`);
  // v5 → v6 is the regression: success rate 86% → 21%.
  const page = await open(`/workflows/${RENEWALS}/versions?a=5&b=6`, { theme });
  await shot(page, `versions-${theme}`);
  await shot(page, `versions-${theme}-full`, { fullPage: true });
  await done(page);
}

console.log("\ndiff modes:");
{
  // v3 → v4 is the only comparison with an added AND a removed node, so it is
  // the one that shows what overlay mode is for.
  const side = await open(`/workflows/${RENEWALS}/versions?a=3&b=4`, { theme: "dark" });
  await shot(side, "diff-side-by-side", { fullPage: true });
  await done(side);

  const overlay = await open(`/workflows/${RENEWALS}/versions?a=3&b=4&mode=overlay`, { theme: "dark" });
  await shot(overlay, "diff-overlay", { fullPage: true });
  await done(overlay);

  const overlayLight = await open(`/workflows/${RENEWALS}/versions?a=3&b=4&mode=overlay`, { theme: "light" });
  await shot(overlayLight, "diff-overlay-light", { fullPage: true });
  await done(overlayLight);

  // Config diff expanded on the modified node.
  const config = await open(`/workflows/${RENEWALS}/versions?a=5&b=6`, { theme: "dark" });
  await config.getByRole("button", { name: /contracts\.getUpcomingRenewals/ }).first().click();
  await config.waitForTimeout(400);
  await shot(config, "diff-config-expanded", { fullPage: true });
  await done(config);

  // Restore creates a new draft; it never overwrites history.
  const restore = await open(`/workflows/${RENEWALS}/versions?a=5&b=6`, { theme: "dark" });
  await restore.getByRole("button", { name: "Restore" }).nth(2).click();
  await restore.waitForTimeout(500);
  await shot(restore, "versions-restore-dialog");
  await done(restore);

  // Identical versions: the diff has to say so rather than render an empty panel.
  const same = await open(`/workflows/${RENEWALS}/versions?a=6&b=6`, { theme: "dark" });
  await shot(same, "diff-identical", { fullPage: true });
  await done(same);

  const mobile = await open(`/workflows/${RENEWALS}/versions?a=5&b=6`, { theme: "dark", width: 390, height: 844 });
  await shot(mobile, "versions-390", { fullPage: true });
  await done(mobile);
}

/* ── Publish flow ─────────────────────────────────────────────────────────── */
console.log("\npublish flow:");
for (const theme of ["dark", "light"]) {
  // Steps 1–3 are addressable, so the harness navigates rather than clicking.
  // Step 4 is not, deliberately: reaching Publish requires a simulation that
  // actually ran, and that is a fact about this session rather than a URL.
  const draft = await open(`/workflows/${RENEWALS}/publish`, { theme });
  await shot(draft, `publish-1-draft-${theme}`, { fullPage: true });
  await done(draft);

  const validate = await open(`/workflows/${RENEWALS}/publish?step=validate`, { theme });
  await shot(validate, `publish-2-validate-${theme}`, { fullPage: true });
  await done(validate);

  const page = await open(`/workflows/${RENEWALS}/publish?step=simulate`, { theme });
  await shot(page, `publish-3-simulate-idle-${theme}`, { fullPage: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: /Run simulation|Simulating/ }),
    async (p) => (await p.getByText("Estimated cost", { exact: true }).count()) > 0,
    "run simulation",
    { reloadOnStall: true },
  );
  await page.waitForTimeout(600);
  await shot(page, `publish-3-simulate-${theme}`, { fullPage: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Step 4: Publish" }),
    async (p) => (await p.getByText("Change summary", { exact: true }).count()) > 0,
    "step 4",
  );
  await shot(page, `publish-4-publish-${theme}`, { fullPage: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: /^Publish v\d+ to/ }),
    async (p) => (await p.getByText(/is live in/).count()) > 0,
    "publish",
  );
  await shot(page, `publish-5-published-${theme}`, { fullPage: true });
  await done(page);
}

console.log("\npublish blocked:");
{
  // contract-sync's draft adds a fan-out with no merge, so Validate blocks and
  // Simulate stays shut. A gate nobody has seen hold is a gate nobody trusts.
  const page = await open(`/workflows/${CONTRACT_SYNC}/publish?step=validate`, { theme: "dark" });
  await shot(page, "publish-blocked-validate", { fullPage: true });
  await done(page);

  const mobile = await open(`/workflows/${RENEWALS}/publish`, { theme: "dark", width: 390, height: 844 });
  await shot(mobile, "publish-390", { fullPage: true });
  await done(mobile);
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
