import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
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
        mono: ["JetBrains Mono", "Fira Code", "Menlo", "Consolas", "monospace"],
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
        accent:             "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        border:             "hsl(var(--border))",
        input:              "hsl(var(--input))",
        ring:               "hsl(var(--ring))",
        brand: {
          DEFAULT:    "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
          muted:      "hsl(var(--brand-muted))",
        },
        success:     "hsl(var(--success))",
        warning:     "hsl(var(--warning))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        // Sidebar design tokens — dark infra-SaaS
        sidebar: {
          DEFAULT:    "#050812",
          fg:         "#F8FAFC",
          muted:      "#64748B",
          border:     "#111D2C",
          active:     "#111D2C",
          hover:      "#0D1626",
        },
      },
      borderRadius: {
        "2xl": "1rem",
        xl:    "0.75rem",
        lg:    "0.625rem",
        md:    "0.5rem",
        sm:    "0.375rem",
      },
      boxShadow: {
        // Dark elevation system
        xs:    "0 1px 2px rgba(0,0,0,0.25)",
        sm:    "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
        md:    "0 4px 8px -1px rgba(0,0,0,0.35), 0 2px 4px -1px rgba(0,0,0,0.25)",
        lg:    "0 10px 18px -3px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.3)",
        xl:    "0 20px 28px -5px rgba(0,0,0,0.45), 0 8px 12px -6px rgba(0,0,0,0.3)",
        // Card-specific dark shadow
        card:  "0 0 0 1px rgba(148,163,184,0.1), 0 2px 8px rgba(0,0,0,0.3)",
        "card-hover": "0 0 0 1px rgba(148,163,184,0.2), 0 4px 16px rgba(0,0,0,0.4)",
        panel: "0 0 0 1px rgba(148,163,184,0.1), 0 8px 32px rgba(0,0,0,0.35)",
        // Sky-blue glow for primary actions
        glow:     "0 0 24px rgba(56,189,248,0.2), 0 0 8px rgba(56,189,248,0.1)",
        "glow-sm": "0 0 12px rgba(56,189,248,0.15)",
        // Sidebar elevation
        sidebar: "1px 0 0 rgba(148,163,184,0.08)",
      },
      backgroundImage: {
        "hero-glow": "radial-gradient(ellipse 80% 50% at 50% -10%, hsl(var(--primary)/0.10), transparent 65%)",
        "grid-fade":
          "radial-gradient(ellipse at top, hsl(var(--primary)/0.06), transparent 45%), " +
          "linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)",
        "auth-panel": "linear-gradient(135deg, hsl(var(--primary)/0.06) 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, rgba(37,99,235,0.08), transparent 50%)",
        // Neutral card surface
        "card-warm": "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 100%)",
      },
      backgroundSize: {
        grid: "100% 100%, 28px 28px, 28px 28px",
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
            a: {
              color: "hsl(var(--brand))",
              textDecorationColor: "hsl(var(--brand) / 0.25)",
              fontWeight: "500",
            },
            strong: { color: "#111111" },
            code: {
              color: "#111111",
              backgroundColor: "hsl(var(--muted))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.375rem",
              padding: "0.15rem 0.4rem",
              fontWeight: "450",
            },
            "code::before": { content: '""' },
            "code::after":  { content: '""' },
            pre: {
              color: "#F8F5EF",
              backgroundColor: "#111111",
              borderRadius: "0.75rem",
              border: "1px solid #2A2A2A",
              boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            },
            "pre code": { backgroundColor: "transparent", border: "none", padding: "0", color: "inherit" },
            blockquote: {
              color: "#111111",
              borderLeftColor: "hsl(var(--brand))",
              backgroundColor: "hsl(var(--muted) / 0.5)",
              borderRadius: "0.625rem",
              padding: "0.875rem 1.25rem",
              fontStyle: "normal",
            },
            hr: { borderColor: "hsl(var(--border))" },
          },
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-scale": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(10px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
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
          from: { opacity: "0", transform: "translateY(10px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "row-in":          "fade-in 0.2s ease-out both",
        "fade-in":         "fade-in 0.35s ease-out both",
        "fade-in-scale":   "fade-in-scale 0.25s ease-out both",
        "slide-in-right":  "slide-in-right 0.25s ease-out both",
        "slide-in-left":   "slide-in-left 0.25s ease-out both",
        "slide-up":        "slide-up 0.35s ease-out both",
        shimmer:           "shimmer 1.8s ease-in-out infinite",
        "pulse-dot":       "pulse-dot 1.8s ease-in-out infinite",
        "counter-up":      "counter-up 0.45s ease-out both",
        pulse_dot:         "pulse-dot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [typography],
};

export default config;
