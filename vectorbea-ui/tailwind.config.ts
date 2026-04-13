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
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
          muted: "hsl(var(--brand-muted))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
        },
      },
      borderRadius: {
        lg: "1rem",
        md: "0.75rem",
        sm: "0.5rem",
      },
      boxShadow: {
        panel: "0 18px 48px rgba(15, 23, 42, 0.08)",
        glow: "0 0 20px rgba(16, 128, 255, 0.14)",
        "glow-sm": "0 0 10px rgba(16, 128, 255, 0.1)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(circle at top, rgba(16,128,255,0.08), transparent 45%), linear-gradient(rgba(127,127,127,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,0.035) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "100% 100%, 24px 24px, 24px 24px",
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "65ch",
            color: "hsl(var(--muted-foreground))",
            h1: {
              color: "hsl(var(--foreground))",
              fontWeight: "650",
              letterSpacing: "-0.035em",
            },
            h2: {
              color: "hsl(var(--foreground))",
              fontWeight: "620",
              letterSpacing: "-0.03em",
            },
            h3: {
              color: "hsl(var(--foreground))",
              fontWeight: "600",
              letterSpacing: "-0.025em",
            },
            p: {
              lineHeight: "1.85",
            },
            a: {
              color: "hsl(var(--brand))",
              textDecorationColor: "hsl(var(--brand) / 0.28)",
              fontWeight: "500",
            },
            strong: {
              color: "hsl(var(--foreground))",
            },
            code: {
              color: "hsl(var(--foreground))",
              backgroundColor: "hsl(var(--muted))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.5rem",
              padding: "0.18rem 0.4rem",
              fontWeight: "500",
            },
            "code::before": { content: '""' },
            "code::after": { content: '""' },
            pre: {
              color: "#e2e8f0",
              backgroundColor: "#020617",
              borderRadius: "1rem",
              border: "1px solid rgba(148,163,184,0.18)",
              boxShadow: "0 24px 60px -40px rgba(2,6,23,0.85)",
            },
            "pre code": {
              backgroundColor: "transparent",
              border: "none",
              padding: "0",
              color: "inherit",
            },
            blockquote: {
              color: "hsl(var(--foreground))",
              borderLeftColor: "hsl(var(--brand))",
              backgroundColor: "hsl(var(--muted) / 0.6)",
              borderRadius: "0.75rem",
              padding: "1rem 1.25rem",
            },
            hr: {
              borderColor: "hsl(var(--border))",
            },
          },
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-scale": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
        pulse_dot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "counter-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "fade-in-scale": "fade-in-scale 0.3s ease-out both",
        "slide-in-right": "slide-in-right 0.3s ease-out both",
        "slide-in-left": "slide-in-left 0.3s ease-out both",
        "slide-up": "slide-up 0.4s ease-out both",
        shimmer: "shimmer 2s ease-in-out infinite",
        pulse_dot: "pulse_dot 2s ease-in-out infinite",
        "counter-up": "counter-up 0.5s ease-out both",
      },
    },
  },
  plugins: [typography],
};

export default config;
