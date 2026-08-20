/**
 * Capture Templates and the Architect, plus a RECORDING of the blueprint
 * materialising — the moment the product is remembered for.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, readdirSync } from "fs";
import { resolve, join } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/architect");
const videoDir = join(outDir, "video");
mkdirSync(outDir, { recursive: true });
mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch();

async function open(path, { theme = "dark", width = 1600, height = 1000, record = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: record ? 1 : 2,
    ...(record ? { recordVideo: { dir: videoDir, size: { width, height } } } : {}),
  });
  await context.addCookies([
    { name: "vectorbea-access-token", value: "capture-harness", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("vectorbea-theme", t);
      // A resumed session would start the flow mid-way and skip the reveal.
      window.localStorage.removeItem("vectorbea-architect-session");
    } catch {}
  }, theme);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1", { timeout: 60000 });
  await page.waitForTimeout(2000);
  return page;
}

const done = (page) => page.context().close();
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), ...opts });
  console.log(`  ${name}.png`);
};

/** Click a control and confirm it took effect — the app hydrates after paint. */
async function clickUntil(page, locate, settled, label) {
  for (let i = 0; i < 20; i += 1) {
    if (await settled(page)) return;
    const target = locate(page).first();
    if (await target.count()) await target.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  throw new Error(`Never settled: ${label}`);
}

/* ── Warm-up ──────────────────────────────────────────────────────────────────
   Next dev compiles a route on first request, and the Architect is the heaviest
   one here. Cold, `waitForSelector("h1")` matches the server-rendered HTML long
   before React has attached handlers — so the first click lands on a page that
   cannot respond, and the failure surfaces as a locator that never settles. */
console.log("warming routes:");
{
  const page = await open("/templates");
  for (const path of ["/workflows/new/architect"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForSelector("h1", { timeout: 120000 });
    await page.waitForTimeout(1500);
    console.log(`  ${path}`);
  }
  await done(page);
}

/* ── Templates ────────────────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\ntemplates ${theme}:`);
  const page = await open("/templates", { theme });
  await shot(page, `templates-${theme}`);
  await shot(page, `templates-${theme}-full`, { fullPage: true });

  await done(page);

  /* The preview and the use flow are addressable, so the harness navigates
     rather than clicking. Both live in the URL precisely so they can be linked,
     and driving them that way removes every hydration race from the capture. */
  const preview = await open("/templates?preview=tpl-renewal-outreach", { theme });
  await shot(preview, `template-preview-${theme}`);
  await done(preview);

  const use = await open("/templates?use=tpl-renewal-outreach", { theme });
  await shot(use, `template-use-1-where-${theme}`);
  for (const name of ["2-connections", "3-name", "4-review"]) {
    await use.getByRole("button", { name: "Continue" }).click().catch(() => {});
    await use.waitForTimeout(500);
    await shot(use, `template-use-${name}-${theme}`);
  }
  await done(use);
}

console.log("\ntemplates states:");
{
  const filtered = await open("/templates?category=billing", { theme: "dark" });
  await shot(filtered, "templates-filtered", { fullPage: true });
  await done(filtered);

  const empty = await open("/templates?q=zzzznothing", { theme: "dark" });
  await shot(empty, "templates-empty");
  await done(empty);

  const mobile = await open("/templates", { theme: "dark", width: 390, height: 844 });
  await shot(mobile, "templates-390", { fullPage: true });
  await done(mobile);
}

/* ── Architect: the seven stages ──────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  console.log(`\narchitect ${theme}:`);
  const page = await open("/workflows/new/architect", { theme });
  await shot(page, `architect-1-describe-${theme}`);

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Renewal outreach" }),
    async (p) => ((await p.locator("textarea").inputValue()) || "").length > 20,
    "populate prompt",
  );
  await shot(page, `architect-1-describe-filled-${theme}`);

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Analyse the description" }),
    async (p) => (await p.getByText("Designing the workflow").count()) > 0
      || (await p.getByText("Why each step").count()) > 0,
    "start analyze",
  );
  await page.waitForTimeout(1500);
  await shot(page, `architect-2-analyze-${theme}`);

  // Let the blueprint finish materialising.
  await page.waitForTimeout(5200);
  await shot(page, `architect-3-blueprint-${theme}`);
  await shot(page, `architect-3-blueprint-${theme}-full`, { fullPage: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Approve and continue" }),
    async (p) => (await p.getByText("Connections this workflow needs").count()) > 0
      || (await p.getByText("No connections needed").count()) > 0,
    "connect",
  );

  /* Every requirement has to be satisfied before Review unlocks — the button is
     disabled while anything the plan needs for simulation is unbound, which is
     the point of the stage rather than an obstacle to work around. */
  for (const button of await page.getByRole("button", { name: "Simulate instead" }).all()) {
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await shot(page, `architect-4-connect-${theme}`);

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Continue to review" }),
    async (p) => (await p.getByText("What will be created").count()) > 0,
    "review",
  );
  await shot(page, `architect-5-review-${theme}`, { fullPage: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Build it" }),
    async (p) => (await p.getByText("Building").count()) > 0,
    "build",
  );
  await page.waitForTimeout(900);
  await shot(page, `architect-6-build-${theme}`);

  await page.waitForSelector("text=exists as a draft", { timeout: 60000 }).catch(() => {});
  await shot(page, `architect-7-ready-${theme}`);
  await done(page);
}

console.log("\nnew workflow:");
for (const theme of ["dark", "light"]) {
  const page = await open("/workflows/new", { theme });
  await shot(page, `new-workflow-${theme}`, { fullPage: true });

  // The schedule trigger reveals the cron editor and its occurrence preview,
  // which is the half of this form worth looking at.
  await page.getByText("Schedule", { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, `new-workflow-schedule-${theme}`, { fullPage: true });
  await done(page);
}

/* ── The recording ────────────────────────────────────────────────────────────
   A real video of the blueprint assembling, plus a frame sequence at 150ms so
   the individual moments — nodes landing, edges drawing, the gate arriving last
   — are inspectable without scrubbing a file. */
console.log("\nrecording the blueprint materialising:");
{
  const page = await open("/workflows/new/architect", { theme: "dark", width: 1440, height: 900, record: true });

  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Renewal outreach" }),
    async (p) => ((await p.locator("textarea").inputValue()) || "").length > 20,
    "populate prompt",
  );
  await clickUntil(
    page,
    (p) => p.getByRole("button", { name: "Analyse the description" }),
    async (p) => (await p.getByText("Designing the workflow").count()) > 0
      || (await p.getByText("Why each step").count()) > 0,
    "start analyze",
  );

  // Frames across the analyse pass and the whole materialisation.
  const frameDir = join(outDir, "frames");
  mkdirSync(frameDir, { recursive: true });
  for (let i = 0; i < 48; i += 1) {
    await page.screenshot({ path: join(frameDir, `frame-${String(i).padStart(2, "0")}.png`) });
    await page.waitForTimeout(150);
  }
  console.log(`  48 frames in ${frameDir}`);

  await page.waitForTimeout(1200);
  const video = page.video();
  await done(page);

  if (video) {
    const saved = await video.path();
    const target = join(videoDir, "blueprint-materialising.webm");
    try { renameSync(saved, target); } catch {}
    console.log(`  ${target}`);
  }
}

await browser.close();
console.log(`\nWrote to ${outDir}`);
console.log(readdirSync(videoDir).join(", "));
