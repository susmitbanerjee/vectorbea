import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { BootstrapProvider } from "@/components/BootstrapProvider";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "~/components/ui/toaster";
import { SITE } from "@/lib/seo";
import { fontVariables } from "~/styles/fonts";
import "@/app/globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Bumped whenever an icon file in /public changes. See `icons` below for why.
 * 2 — the amber bee gave way to the iris checkpoint mark.
 */
const ICON_VERSION = "2";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.defaultTitle,
    template: SITE.titleTemplate,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    url: SITE.url,
    title: SITE.defaultTitle,
    description: SITE.description,
    images: [{ url: SITE.ogImagePath, width: 1200, height: 630, alt: SITE.defaultTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.defaultTitle,
    description: SITE.description,
    images: [SITE.ogImagePath],
  },
  manifest: "/manifest.json",
  /**
   * Order matters. A browser takes the LAST icon it understands, so the SVG is
   * listed after the .ico: modern browsers get the scalable mark, and anything
   * that only knows `image/x-icon` — including the crawlers and chat unfurlers
   * that still request /favicon.ico by convention — falls back cleanly.
   *
   * The 48px entry inside favicon.ico is what Windows uses for a pinned
   * shortcut, which is why the .ico carries three sizes rather than just 16.
   *
   * `?v=` IS LOAD-BEARING. Favicons live in a cache of their own, keyed by URL
   * and honoured far more stubbornly than any other asset — a hard reload does
   * not clear it, and neither does redeploying. Every one of these files was
   * replaced with the current mark and browsers went on drawing the previous
   * one from that cache. Bumping the version changes the URL, which is the only
   * reliable way to make a browser go and look again.
   *
   * BUMP THIS whenever an icon file's contents change.
   */
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: `/icon-192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png" },
      { url: `/icon.svg?v=${ICON_VERSION}`, type: "image/svg+xml" },
    ],
    shortcut: `/favicon.ico?v=${ICON_VERSION}`,
    apple: [{ url: `/apple-touch-icon-180.png?v=${ICON_VERSION}`, sizes: "180x180", type: "image/png" }],
  },
};

/**
 * Brand colour for the browser's own chrome — iris, never a status hue.
 *
 * The two entries are the accent token resolved in each theme: `--iris-400` is
 * `--accent` on dark, `--iris-600` on light. They are literals because a meta
 * tag cannot read a CSS custom property; if the accent tokens move in
 * `src/styles/tokens/colour.css`, these move with them.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#7E82F2" },
    { media: "(prefers-color-scheme: light)", color: "#4644D6" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    // geist.* still feed --font-sans / --font-mono for the legacy layer;
    // fontVariables adds --ff-display / --ff-ui / --ff-code for Ink & Iris.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${fontVariables}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider>
          <BootstrapProvider />
          <div className="min-h-screen bg-background text-foreground">
            {children}
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
