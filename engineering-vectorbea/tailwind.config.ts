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
        ink: "#1c1408",
        slate: {
          50: "#fbf8f2",
          100: "#f3ede1",
          200: "#e6dccb",
          300: "#d3c4a8",
          400: "#a8987c",
          500: "#8a7a60",
          600: "#6b5d47",
          700: "#544838",
          800: "#3a3122",
          850: "#2a2010",
          900: "#1c1408",
        },
        accent: {
          blue: "#d97706",
          violet: "#b45309",
          teal: "#a16207",
        },
        honey: {
          50: "#fffaf0",
          100: "#fef3da",
          400: "#f5b942",
          500: "#f8d36a",
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
            color: "#1e293b",
            a: { color: "#3b82f6", textDecoration: "none" },
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
