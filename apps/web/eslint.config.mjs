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

  // Third-party brand colours are trademarks, not design tokens — they are fixed
  // by other companies' guidelines and must not be themed. Quarantined to one
  // file so the exception cannot spread. See the header in that file.
  {
    files: ["src/components/ui/provider-brand-colours.ts"],
    rules: { "no-restricted-syntax": "off" },
  },

  // ── Fixtures must not reach production ──────────────────────────────────
  //
  // `src/mocks/**` is design-review data. It is imported by 87 component files
  // (the redesign was built against fixtures before the API existed), and it
  // reaches three production chunks including `layout-*.js` — so fabricated
  // domain data is downloaded on every page load.
  //
  // This rule is a RATCHET, not a big-bang ban. Deleting the directory would
  // break 87 files at once; leaving the rule off lets the number grow. So the
  // existing importers are enumerated below and every other file is an error.
  // A file leaves the list when its screen is wired to the API, and the list is
  // the migration backlog — `npm run check:fixtures` prints what is left.
  //
  // The list only ever shrinks. Adding to it should be treated as a mistake.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // Mock mode itself: the transport swap, and the ONE place fixtures are
      // legitimately read — behind NEXT_PUBLIC_DATA_MODE.
      "src/lib/api/mock-transport.ts",
      "src/mocks/**",
      // Stories are design-review surfaces and never ship.
      "src/**/*.stories.tsx",
      // ── Migration baseline. Shrinks as screens are wired. ────────────────
      "src/components/app/admin/audit-view.tsx",
      "src/components/app/admin/members-view.tsx",
      "src/components/app/admin/settings-view.tsx",
      "src/components/app/admin/usage-view.tsx",
      "src/components/app/approvals/approvals-view.tsx",
      "src/components/app/approvals/gate-card.tsx",
      "src/components/app/approvals/sla-ring.tsx",
      "src/components/app/architect/blueprint-stream.tsx",
      "src/components/app/auth/ambient-run.tsx",
      "src/components/app/builder/builder-view.tsx",
      "src/components/app/builder/canvas.tsx",
      "src/components/app/builder/comments.tsx",
      "src/components/app/builder/inspector/advanced-tab.tsx",
      "src/components/app/builder/inspector/configure-tab.tsx",
      "src/components/app/builder/inspector/inputs-tab.tsx",
      "src/components/app/builder/inspector/node-inspector.tsx",
      // Reads `inputsFor` only as the fallback for non-tool node kinds; tool
      // parameters now come from the registered tool's own input schema.
      "src/components/app/builder/inspector/node-inputs.ts",
      "src/components/app/builder/inspector/output-test-tabs.tsx",
      "src/components/app/builder/keyboard-graph.ts",
      "src/components/app/builder/layout.ts",
      "src/components/app/builder/palette.tsx",
      "src/components/app/builder/simulate-panel.tsx",
      "src/components/app/builder/store.ts",
      
      "src/components/app/builder/validation.ts",
      "src/components/app/builder/workflow-edge.tsx",
      "src/components/app/builder/workflow-node.tsx",
      "src/components/app/connectivity/connections-view.tsx",
      "src/components/app/connectivity/integrations-view.tsx",
      "src/components/app/connectivity/triggers-view.tsx",
      "src/components/app/control/activity-stream.tsx",
      "src/components/app/control/control-view.tsx",
      "src/components/app/control/detail-band.tsx",
      "src/components/app/control/empty-workspace.tsx",
      "src/components/app/control/fleet-heatstrip.tsx",
      "src/components/app/control/health-strip.tsx",
      "src/components/app/control/time-range.tsx",
      "src/components/app/incidents/incident-detail.tsx",
      "src/components/app/incidents/incidents-view.tsx",
      "src/components/app/registry/agent-detail.tsx",
      "src/components/app/registry/agents-view.tsx",
      "src/components/app/registry/atoms.tsx",
      "src/components/app/registry/tool-detail.tsx",
      "src/components/app/registry/tools-view.tsx",
      "src/components/app/ribbon/checkpoint-ribbon.tsx",
      "src/components/app/ribbon/geometry.ts",
      "src/components/app/run-detail/canvas-mirror.tsx",
      "src/components/app/run-detail/compare.tsx",
      "src/components/app/run-detail/inspector.tsx",
      "src/components/app/run-detail/log-stream.tsx",
      "src/components/app/run-detail/recovery-card.tsx",
      "src/components/app/run-detail/replay.tsx",
      "src/components/app/run-detail/run-detail-view.tsx",
      "src/components/app/run-detail/run-header.tsx",
      "src/components/app/run-detail/step-timeline.tsx",
      "src/components/app/runs/bulk-bar.tsx",
      "src/components/app/runs/failure-clusters.tsx",
      "src/components/app/runs/quick-peek.tsx",
      "src/components/app/runs/runs-view.tsx",
      "src/components/app/shell/app-shell.tsx",
      "src/components/app/shell/command-palette.tsx",
      "src/components/app/shell/environment.tsx",
      "src/components/app/shell/notification-inbox.tsx",
      "src/components/app/shell/sidebar.tsx",
      "src/components/app/shell/topbar.tsx",
      "src/components/app/shell/workspace-switcher.tsx",
      "src/components/app/templates/templates-view.tsx",
      "src/components/app/workflows/atoms.tsx",
      "src/components/app/workflows/bulk-bar.tsx",
      "src/components/app/workflows/config-diff.tsx",
      "src/components/app/workflows/graph-canvas.tsx",
      
      "src/components/app/workflows/publish-flow.tsx",
      "src/components/app/workflows/row-actions.tsx",
      "src/components/app/workflows/version-history.tsx",
      "src/components/app/workflows/workflow-cards.tsx",
      "src/components/app/workflows/workflows-view.tsx",
      "src/components/charts/burndown.tsx",
      "src/components/charts/cost-trend.tsx",
      "src/components/charts/heatstrip.tsx",
      "src/components/charts/latency-distribution.tsx",
      "src/components/marketing/landing.tsx",
      "src/components/marketing/recovery-loop.tsx",
      "src/content/docs/bodies.tsx",
      "src/lib/api/client.ts",
      "src/lib/query.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~/mocks", "~/mocks/*"],
              message:
                "Fixtures must not be imported outside mock mode. This data is fabricated and currently ships to production. Read from the API via ~/lib/api, and render <NotAvailableYet> where the endpoint does not exist yet. See docs/integration/API-GAPS.md.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
