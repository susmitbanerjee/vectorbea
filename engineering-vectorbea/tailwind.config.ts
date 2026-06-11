import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Vectorbea green control-plane palette (matches apps/web).
        ink: "#0B0D0F",
        // Neutral cool-gray ramp (kept the 50→900 lightness curve so existing
        // component contrast still holds after the warm→cool swap).
        slate: {
          50: "#F7F8F9",
          100: "#F3F4F5",
          200: "#E0E3E6",
          300: "#C9CED4",
          400: "#9CA3AF",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#1F2428",
          850: "#14171A",
          900: "#0B0D0F",
        },
        // accent.blue is the brand green primary; violet→teal signature; teal→bright green.
        accent: {
          blue: "#007F4E",
          violet: "#0F766E",
          teal: "#00A65A",
        },
        // Soft brand surfaces (was warm "honey").
        honey: {
          50: "#F7F8F9",
          100: "#E6F4EF",
          400: "#9CCFBB",
          500: "#34D399",
        },
      },
      maxWidth: {
        article: "780px",
        page: "1180px",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "ui-sans-serif",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      typography: () => ({
        DEFAULT: {
          css: {
            maxWidth: "none",
            color: "#1F2428",
            a: { color: "#007F4E", textDecoration: "none" },
            "a:hover": { textDecoration: "underline" },
            "code::before": { content: '""' },
            "code::after": { content: '""' },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
