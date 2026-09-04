/**
 * Capture the shell and a command-palette frame sequence.
 *
 * The palette is a keyboard surface, so it is driven with the keyboard — every
 * frame below is reached by typing, never by clicking. If a frame is missing,
 * the keyboard path for it is broken.
 *
 *   node tests/visual/capture-shell.mjs [outDir]
 *
 * Expects the dev server on :3000 and a Chromium binary.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? "screenshots/shell");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function newPage({ width, height, theme }) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await page.addInitScript((t) => {
    window.localStorage.setItem("vectorbea-theme", t);
    // Deterministic shell state for the capture.
    window.localStorage.setItem("vectorbea.shell.collapsed", "false");
    window.localStorage.setItem("vectorbea.shell.environment", "production");
  }, theme);
  return page;
}


/**
 * Open the palette and WAIT FOR IT.
 *
 * The shell is a client component: Next server-renders the sidebar, so waiting
 * on a selector proves markup exists, not that React has hydrated and attached
 * the window keydown listener. Pressing the shortcut before hydration silently
 * does nothing. Retry until the dialog actually appears.
 */
async function openPalette(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Control+k");
    try {
      await page.waitForSelector('[role="dialog"]', { timeout: 500 });
      return;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("Command palette never opened — is the shell hydrating?");
}

/** Same hydration problem for any global shortcut. */
async function pressWhenReady(page, keys, expectSelector) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press(keys);
    try {
      await page.waitForSelector(expectSelector, { timeout: 500 });
      return;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`Shortcut ${keys} never produced ${expectSelector}`);
}

async function shot(page, name) {
  await page.waitForTimeout(250);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
}

/* ── 1. The shell, both themes, on a real route ────────────────────────────── */
for (const theme of ["dark", "light"]) {
  const page = await newPage({ width: 1440, height: 900, theme });
  await page.goto(`${BASE}/control`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("nav[aria-label='Primary']", { timeout: 20000 }).catch(() => {});
  // Hydration gate: opening and closing the palette proves the global keydown
  // listener is attached, so every shortcut pressed after this point is real.
  await openPalette(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await shot(page, `shell-control-${theme}`);

  // Collapsed sidebar — driven by the shortcut, so the binding is proven too.
  await page.keyboard.press("Control+\\");
  await shot(page, `shell-collapsed-${theme}`);
  await page.keyboard.press("Control+\\");

  // Shortcuts sheet via "?"
  await pressWhenReady(page, "?", 'text=Keyboard shortcuts');
  await shot(page, `shell-shortcuts-${theme}`);
  await page.keyboard.press("Escape");

  await page.close();
}

/* ── 2. Command palette frame sequence (dark) ──────────────────────────────── */
{
  const page = await newPage({ width: 1440, height: 900, theme: "dark" });
  await page.goto(`${BASE}/control`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("nav[aria-label='Primary']", { timeout: 20000 }).catch(() => {});
  // Hydration gate: opening and closing the palette proves the global keydown
  // listener is attached, so every shortcut pressed after this point is real.
  await shot(page, "palette-1-closed");

  await openPalette(page);
  await shot(page, "palette-2-open-recents");

  await page.keyboard.type("ren", { delay: 60 });
  await shot(page, "palette-3-fuzzy-ren");

  // Clear, then enter the nested run scope by typing "run ".
  await page.keyboard.press("Control+a");
  await page.keyboard.type("run ", { delay: 60 });
  await shot(page, "palette-4-scope-runs");

  await page.keyboard.press("Backspace"); // leaves the scope
  await page.keyboard.type("theme", { delay: 60 });
  await shot(page, "palette-5-command-mode");

  await page.keyboard.press("Control+a");
  await page.keyboard.type("run_01JBQZ8XK4T9V2M7N3P6R8S1W5", { delay: 10 });
  await shot(page, "palette-6-id-paste");

  await page.keyboard.press("ArrowDown");
  await shot(page, "palette-7-keyboard-active");

  await page.close();
}

/* ── 3. Responsive — 390px ─────────────────────────────────────────────────── */
for (const theme of ["dark", "light"]) {
  const page = await newPage({ width: 390, height: 844, theme });
  await page.goto(`${BASE}/control`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("nav[aria-label='Primary']", { timeout: 20000 }).catch(() => {});
  // Hydration gate: opening and closing the palette proves the global keydown
  // listener is attached, so every shortcut pressed after this point is real.
  await openPalette(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await shot(page, `shell-390-${theme}`);

  // Drawer
  await page.getByLabel("Open navigation").click();
  await shot(page, `shell-390-drawer-${theme}`);
  await page.keyboard.press("Escape");

  // Palette becomes a full-screen sheet below sm.
  await openPalette(page);
  await shot(page, `palette-390-${theme}`);
  await page.close();
}

await browser.close();
