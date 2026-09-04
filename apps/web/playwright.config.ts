import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression and screenshot capture.
 *
 * The Definition of Done requires both themes captured at 1440 and 390 for every
 * prompt (execution plan, "Running this well"). The two projects below are those
 * viewports; `captureBothThemes` in tests/visual/capture.ts drives the theme.
 *
 * First run on a new machine needs the browser binary:
 *   npx playwright install chromium
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/visual",
  snapshotDir: "./tests/visual/__screenshots__",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],

  expect: {
    toHaveScreenshot: {
      // Tolerate sub-pixel text rendering differences across platforms without
      // masking real regressions.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Freeze motion so screenshots are deterministic; also exercises the
    // reduced-motion path the DoD requires.
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-390",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
