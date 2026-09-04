/*
 * FROZEN LEGACY CONFIG — DO NOT ADD TO THIS FILE.
 *
 * Loaded by app/globals.css via `@config` purely so the pre-revamp application
 * keeps rendering under Tailwind v4. It backs ~1,490 default-palette classes and
 * every `vbgreen` / `surface` / `sidebar` class in apps/web/{app,components}.
 *
 * New design tokens belong in src/styles/tokens/*.css under `@theme`.
 * This file is deleted at the end of the revamp — see
 * /docs/audit/CURRENT-STATE.md §10, Stage 6.
 */
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  // `darkMode` is intentionally absent. Tailwind v4 types reject the v3
  // `["class"]` form, and the dark variant is now declared in CSS instead:
  //   @custom-variant dark (&:where(.dark, .dark *));
  // in src/styles/tokens/colour.css.
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./mdx-components.tsx",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "Geist Mono", "JetBrains Mono", "Fira Code", "Menlo", "Consolas", "monospace"],
      },
      fontWeight: {
        "450": "450",
        "550": "550",
        "650": "650",
      },
      fontSize: {
        "10": ["10px", { lineHeight: "14px" }],
        "11": ["11px", { lineHeight: "16px" }],
        "12": ["12px", { lineHeight: "18px" }],
        "13": ["13px", { lineHeight: "20px" }],
        "14": ["14px", { lineHeight: "20px" }],
        "15": ["15px", { lineHeight: "22px" }],
      },
      colors: {
        background:         "hsl(var(--background))",
        foreground:         "hsl(var(--foreground))",
        card:               "hsl(var(--card))",
        "card-foreground":  "hsl(var(--card-foreground))",
        popover:            "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary:            "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary:          "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted:              "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent:             "hsl(var(--legacy-accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        border:             "hsl(var(--border))",
        input:              "hsl(var(--input))",
        ring:               "hsl(var(--ring))",
        destructive:        "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        success:     "hsl(var(--success))",
        warning:     "hsl(var(--warning))",

        // Sidebar semantic tokens
        sidebar: {
          DEFAULT:    "#FFFFFF",
          fg:         "#0B0D0F",
          muted:      "#4B5563",
          border:     "#E0E3E6",
          active:     "#E6F4EF",
          hover:      "#F3F4F5",
        },

        // NOTE: the legacy `surface` scale was removed during the v4 migration.
        // It had zero usages across apps/web (verified by grep) and its
        // `surface-hover` key shadowed the new themed `bg-surface-hover` token
        // in src/styles/tokens/colour.css. Surfaces now come from @theme only.

        // Brand green scale
        vbgreen: {
          DEFAULT: "#007F4E",
          hover:   "#006B45",
          bright:  "#00A65A",
          soft:    "#E6F4EF",
          border:  "#9CCFBB",
        },

        // Chart colors
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        // v3→v4 compat: v4 renames `rounded` → `rounded-sm`. Pinning DEFAULT keeps
        // the 81 bare `rounded` utilities in legacy code rendering at 4px.
        DEFAULT: "0.25rem",
        "2xl": "1rem",
        xl:    "0.75rem",
        lg:    "0.625rem", // 10px — primary card radius
        md:    "0.4375rem", // 7px — button/input radius
        sm:    "0.25rem",  // 4px — badge/tag radius
      },
      blur: {
        // v3→v4 compat: v4 renames `blur` → `blur-sm`. 6 bare uses in legacy code.
        DEFAULT: "8px",
      },
      boxShadow: {
        // v3→v4 compat: v4 renames `shadow` → `shadow-sm`. 5 bare uses in legacy code.
        DEFAULT: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        xs:     "0 1px 2px rgba(0,0,0,0.04)",
        sm:     "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        md:     "0 4px 8px -1px rgba(0,0,0,0.06), 0 2px 4px -1px rgba(0,0,0,0.04)",
        lg:     "0 10px 18px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)",
        xl:     "0 20px 28px -5px rgba(0,0,0,0.10), 0 8px 12px -6px rgba(0,0,0,0.04)",
        card:   "0 0 0 1px #E5E7EB, 0 1px 3px rgba(0,0,0,0.04)",
        "card-hover": "0 0 0 1px #D1D5DB, 0 2px 6px rgba(0,0,0,0.06)",
        panel:  "0 0 0 1px #E5E7EB, 0 4px 12px rgba(0,0,0,0.06)",
        glow:   "none",
        "glow-sm": "none",
        sidebar: "1px 0 0 #E2E8F0",
      },
      backgroundImage: {
        "hero-glow": "radial-gradient(ellipse 80% 50% at 50% -10%, hsl(var(--primary)/0.08), transparent 65%)",
        "card-warm": "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 100%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-scale": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to:   { backgroundPosition: "200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "counter-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "row-in":         "fade-in 0.18s ease-out both",
        "fade-in":        "fade-in 0.25s ease-out both",
        "fade-in-scale":  "fade-in-scale 0.2s ease-out both",
        "slide-in-right": "slide-in-right 0.2s ease-out both",
        "slide-in-left":  "slide-in-left 0.2s ease-out both",
        "slide-up":       "slide-up 0.25s ease-out both",
        shimmer:          "shimmer 1.8s ease-in-out infinite",
        "pulse-dot":      "pulse-dot 1.8s ease-in-out infinite",
        "counter-up":     "counter-up 0.4s ease-out both",
        pulse_dot:        "pulse-dot 1.8s ease-in-out infinite",
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "68ch",
            color: "hsl(var(--muted-foreground))",
            "--tw-prose-headings": "#111111",
            h1: { color: "#111111", fontWeight: "650", letterSpacing: "-0.03em" },
            h2: { color: "#111111", fontWeight: "600", letterSpacing: "-0.025em" },
            h3: { color: "#111111", fontWeight: "600", letterSpacing: "-0.02em" },
            p: { lineHeight: "1.8" },
            a: { color: "hsl(var(--ring))", textDecorationColor: "hsl(var(--ring) / 0.25)", fontWeight: "500" },
            strong: { color: "#111111" },
            code: {
              color: "#111111",
              backgroundColor: "hsl(var(--muted))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.25rem",
              padding: "0.1rem 0.35rem",
              fontWeight: "450",
            },
            "code::before": { content: '""' },
            "code::after":  { content: '""' },
            pre: {
              color: "#F8F5EF",
              backgroundColor: "#111111",
              borderRadius: "0.5rem",
              border: "1px solid #2A2A2A",
              boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            },
            "pre code": { backgroundColor: "transparent", border: "none", padding: "0", color: "inherit" },
            blockquote: {
              color: "#111111",
              borderLeftColor: "hsl(var(--ring))",
              backgroundColor: "hsl(var(--muted) / 0.5)",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.25rem",
              fontStyle: "normal",
            },
            hr: { borderColor: "hsl(var(--border))" },
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
