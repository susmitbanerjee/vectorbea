import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/* ══════════════════════════════════════════════════════════════════════════════
   Design-system guardrails.

   These make the hard rules in /CLAUDE.md mechanically enforceable rather than
   aspirational. They are scoped to src/** on purpose: the legacy presentation
   layer in app/** and components/** contains 4,698 raw hex values and 117 Lucide
   imports (see /docs/audit/CURRENT-STATE.md §5), so a repo-wide ban would fail on
   day one and get switched off. The scope widens as screens migrate; the ratchet
   in scripts/check-design-tokens.mjs stops the legacy count from growing.
══════════════════════════════════════════════════════════════════════════════ */

// #RGB #RGBA #RRGGBB #RRGGBBAA
const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
const FUNC_COLOUR = String.raw`\b(?:rgba?|hsla?)\(`;

const TW_PREFIX =
  "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow";
const TW_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const TW_STEP = "50|100|200|300|400|500|600|700|800|900|950";
const DEFAULT_PALETTE = String.raw`\b(?:${TW_PREFIX})-(?:${TW_PALETTE})-(?:${TW_STEP})\b`;

const messages = {
  hex: "Raw colour value. Hex, rgb() and hsl() may only appear in src/styles/tokens/*.css. Use a semantic token — bg-surface-raised, text-fg-secondary, bg-status-failed. (CLAUDE.md rule 1)",
  palette:
    "Default Tailwind palette class. `bg-slate-800` is a bug — use a semantic token such as bg-surface-raised or bg-status-live. (CLAUDE.md rule 2)",
};

/** Ban a regex in both plain string literals and template literal chunks. */
const banPattern = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
];

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "storybook-static/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "lib/generated/**",
    ],
  },

  ...compat.extends("next/core-web-vitals"),

  // ── Design-system rules — new code only ─────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...banPattern(HEX, messages.hex),
        ...banPattern(FUNC_COLOUR, messages.hex),
        ...banPattern(DEFAULT_PALETTE, messages.palette),
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message:
                "Lucide is banned — it is the generated-UI tell. Use @phosphor-icons/react, or a bespoke mark from ~/components/icons. (CLAUDE.md rule 3)",
            },
            {
              name: "framer-motion",
              message:
                "Use `motion` (motion/react) instead; framer-motion is legacy-only and is removed in Stage 6.",
            },
            {
              name: "recharts",
              message:
                "Recharts defaults are a template tell. Use visx (design direction §13).",
            },
          ],
        },
      ],
    },
  },

  // Token files are the one place colour literals are allowed to exist.
  {
    files: ["src/styles/**"],
    rules: { "no-restricted-syntax": "off" },
  },
];

export default config;
