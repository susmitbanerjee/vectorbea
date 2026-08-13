"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme root — class strategy, three choices, no flash, persisted.
 *
 * NO FLASH: next-themes injects a blocking inline script that applies the stored
 * class to <html> before first paint. That only runs when the theme is not
 * forced, so `forcedTheme` must stay off. `suppressHydrationWarning` on <html>
 * (app/layout.tsx) is what lets that pre-paint mutation past hydration.
 *
 * DARK IS THE DEFAULT, in two places that must agree:
 *   - here, via defaultTheme="dark" — what a visitor with no stored choice gets
 *   - in CSS, where :root IS the dark theme and :root.light is the override
 *     (src/styles/tokens/colour.css §2)
 * So even in the instant before the script runs, the painted default is dark.
 *
 * `enableSystem` keeps "system" selectable alongside light and dark; the stored
 * choice persists under `vectorbea-theme`.
 *
 * MIGRATION NOTE: the legacy layer in app/** and components/** has no dark
 * styles and is hard-coded light, so it does not follow the theme. Its variables
 * were renamed to --legacy-* precisely so the new tokens cannot alter it. The
 * visible effect of dark mode on a not-yet-migrated screen is limited to native
 * chrome (scrollbars, form controls) picking up `color-scheme: dark`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      themes={["light", "dark"]}
      enableSystem
      storageKey="vectorbea-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
