import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

export type Theme = "dark" | "light";

/**
 * Force a theme without going through the UI toggle.
 *
 * Writes the next-themes storage key before navigation so the blocking script
 * next-themes injects picks it up on first paint — no flash, no post-hoc class
 * swap that would race the screenshot.
 */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("vectorbea-theme", value);
  }, theme);
}

/**
 * Capture a route in both themes at the current project's viewport.
 *
 * Run under both Playwright projects (desktop-1440, mobile-390) this yields the
 * four screenshots the Definition of Done asks for per screen.
 */
export async function captureBothThemes(
  page: Page,
  testInfo: TestInfo,
  path: string,
  name: string,
): Promise<void> {
  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot(`${name}-${theme}-${testInfo.project.name}.png`, {
      fullPage: true,
    });
  }
}
