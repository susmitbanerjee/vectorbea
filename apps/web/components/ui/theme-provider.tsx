"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme root — class strategy, no flash of the wrong theme.
 *
 * next-themes injects a blocking script that applies the stored class before
 * first paint; that only happens when the theme is not forced, so `forcedTheme`
 * has been removed. `suppressHydrationWarning` on <html> (app/layout.tsx) is what
 * lets that pre-paint class mutation pass hydration cleanly.
 *
 * Still defaulting to light with system detection off. The legacy presentation
 * layer has no dark styles at all (zero `dark:` classes — see
 * /docs/audit/CURRENT-STATE.md §9.1), so enabling system detection today would
 * hand a half-dark UI to anyone whose OS is dark. P02 builds the dark theme and
 * flips these two values.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="vectorbea-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
