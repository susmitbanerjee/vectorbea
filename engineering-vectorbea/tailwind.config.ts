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
        ink: "#0f172a",
        slate: {
          850: "#172033",
        },
        accent: {
          blue: "#3b82f6",
          violet: "#7c3aed",
        },
      },
      maxWidth: {
        article: "780px",
        page: "1180px",
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
