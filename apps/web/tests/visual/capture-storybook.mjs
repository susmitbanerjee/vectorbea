/**
 * Capture Storybook stories as PNGs, in both themes.
 *
 * Not a test — a screenshot harness for design review. The Definition of Done
 * requires both themes captured for every prompt, and reviewing a design system
 * from a description is exactly the failure this exists to prevent.
 *
 *   node tests/visual/capture-storybook.mjs [outDir]
 *
 * Expects Storybook on :6006 (npm run storybook) and a Chromium binary
 * (npx playwright install chromium).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

const BASE = process.env.STORYBOOK_URL ?? "http://localhost:6006";
const outDir = resolve(process.argv[2] ?? "screenshots");

const STORIES = [
  { id: "flows-auth--sign-in", name: "auth-signin" },
  { id: "flows-auth--sign-in-wrong-password", name: "auth-wrong-password" },
  { id: "flows-auth--sign-in-no-account", name: "auth-no-account" },
  { id: "flows-auth--sign-in-locked", name: "auth-locked" },
  { id: "flows-auth--sign-in-rate-limited", name: "auth-rate-limited" },
  { id: "flows-auth--sign-in-unverified", name: "auth-unverified" },
  { id: "flows-auth--sign-in-saml-domain", name: "auth-saml" },
  { id: "flows-auth--sign-in-loading", name: "auth-submitting" },
  { id: "flows-auth--sign-up", name: "auth-signup" },
  { id: "flows-auth--verify-email", name: "auth-verify-email" },
  { id: "flows-auth--verified", name: "auth-verified" },
  { id: "flows-auth--link-expired", name: "auth-link-expired" },
  { id: "flows-auth--link-already-used", name: "auth-link-used" },
  { id: "flows-auth--forgot-password", name: "auth-forgot-password" },
  { id: "flows-auth--choose-password", name: "auth-choose-password" },
  { id: "flows-auth--accept-invite", name: "auth-accept-invite" },
  { id: "flows-auth--locked-out", name: "auth-locked-out" },
  { id: "flows-auth--onboarding-flow", name: "onboarding" },
  { id: "signature-checkpoint-ribbon--ribbon", name: "ribbon" },
  { id: "primitives-actions--actions", name: "actions" },
  { id: "primitives-forms--forms", name: "forms" },
  { id: "foundation-iconography--icons", name: "iconography" },
  { id: "foundation-design-tokens--tokens", name: "tokens" },
];

const THEMES = ["dark", "light"];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

for (const story of STORIES) {
  for (const theme of THEMES) {
    const url = `${BASE}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`;
    await page.goto(url, { waitUntil: "networkidle" });
    // Fonts must be resolved before capture or the shot records the fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const file = join(outDir, `${story.name}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`captured ${file}`);
  }
}

await browser.close();
