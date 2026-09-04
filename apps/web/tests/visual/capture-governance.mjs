/** Capture Approvals and Incidents: all states, both themes. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/governance");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function open(path, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addCookies([
    { name: "vectorbea-access-token", value: "capture-harness", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("vectorbea-theme", t); } catch {}
  }, theme);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("h1", { timeout: 60000 });
  await page.waitForTimeout(1100);
  return page;
}

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...opts });
  console.log(`  ${name}.png`);
};

/* ── Approvals ───────────────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\napprovals ${theme}:`);
  const page = await open("/approvals?frozen=1", { theme });
  await shot(page, `approvals-${theme}`);
  await shot(page, `approvals-${theme}-full`, { fullPage: true });

  // Evidence expanded.
  await page.getByRole("button", { name: /Evidence/ }).first().click();
  await page.waitForTimeout(400);
  await shot(page, `approvals-${theme}-evidence`, { fullPage: true });
  await page.close();
}

console.log("\napprovals states:");
for (const tab of ["approved", "rejected", "all"]) {
  const page = await open(`/approvals?frozen=1&tab=${tab}`, { theme: "dark" });
  await shot(page, `approvals-tab-${tab}`, { fullPage: true });
  await page.close();
}

console.log("\napprovals dialogs:");
{
  const page = await open("/approvals?frozen=1", { theme: "dark" });
  await page.getByRole("button", { name: "Reject", exact: true }).first().click();
  await page.waitForTimeout(400);
  await shot(page, "approvals-reject-dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Select both pending gates → the policy guard should refuse (critical + mixed).
  const boxes = page.locator('input[type="checkbox"][aria-label^="Select gate"]');
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) await boxes.nth(i).click();
  await page.waitForTimeout(400);
  await shot(page, "approvals-bulk-blocked");

  await page.getByRole("button", { name: /Approve \d+ selected/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "approvals-bulk-dialog");
  await page.close();
}

/* ── Incidents ───────────────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\nincidents ${theme}:`);
  const list = await open("/incidents", { theme });
  await shot(list, `incidents-${theme}`, { fullPage: true });
  await list.close();

  const detail = await open("/incidents/inc_7c2f18ab90de", { theme });
  await shot(detail, `incident-detail-${theme}`);
  await shot(detail, `incident-detail-${theme}-full`, { fullPage: true });
  await detail.close();
}

console.log("\nincidents filtered + mobile:");
{
  const page = await open("/incidents?status=open&severity=critical", { theme: "dark" });
  await shot(page, "incidents-filtered", { fullPage: true });
  await page.close();

  const mobile = await open("/approvals?frozen=1", { theme: "dark", width: 390, height: 844 });
  await shot(mobile, "approvals-390", { fullPage: true });
  await mobile.close();

  const mobileInc = await open("/incidents/inc_7c2f18ab90de", { theme: "dark", width: 390, height: 844 });
  await shot(mobileInc, "incident-detail-390", { fullPage: true });
  await mobileInc.close();
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
