import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import {
  contrastRatio,
  formatRatio,
  MINIMUM,
  passes,
  resolveToken,
  type Requirement,
} from "~/lib/contrast";

/**
 * THE TOKEN GALLERY
 *
 * Every scale in the Ink & Iris system, rendered from the live CSS custom
 * properties — not from a hard-coded copy. Each semantic pairing is graded
 * against the WCAG minimum that actually applies to how the token is used, and
 * the ratio shown is the one the browser is painting right now, in whichever
 * theme the toolbar is set to.
 *
 * Toggle the theme in the toolbar. Both themes must be clean.
 *
 * The CI gate for the same rules is `npm run check:contrast`, which parses
 * colour.css directly and fails the build on any regression.
 */

/* ── Live token reading ─────────────────────────────────────────────────────── */

/**
 * Resolve a set of tokens to hex, re-resolving whenever the theme class on
 * <html> changes. Storybook's theme toolbar mutates that class, so a
 * MutationObserver is what keeps the numbers honest after a toggle.
 */
function useTokens(names: readonly string[]): Record<string, string | null> {
  const key = names.join("|");
  const [snapshot, setSnapshot] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    const read = () => {
      const next: Record<string, string | null> = {};
      for (const n of key.split("|")) next[n] = resolveToken(n);
      setSnapshot(next);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [key]);

  return snapshot;
}

/* ── Spec ───────────────────────────────────────────────────────────────────── */

const PRIMITIVES: { family: string; hint: string; tokens: string[] }[] = [
  {
    family: "Graphite",
    hint: "Cool, blue-undertone neutrals. Dark-theme surfaces and text. Deliberately not Tailwind slate.",
    tokens: ["--graphite-1000", "--graphite-950", "--graphite-900", "--graphite-850", "--graphite-800",
      "--graphite-750", "--graphite-700", "--graphite-600", "--graphite-500", "--graphite-400",
      "--graphite-300", "--graphite-200", "--graphite-100", "--graphite-50"],
  },
  {
    family: "Paper",
    hint: "Light-theme neutrals. paper-600 is derived, not from §3.2 — see the note in colour.css.",
    tokens: ["--paper-0", "--paper-50", "--paper-100", "--paper-200", "--paper-300",
      "--paper-400", "--paper-500", "--paper-600", "--paper-700", "--paper-900", "--paper-1000"],
  },
  {
    family: "Iris — brand",
    hint: "Identity, primary action, selection, focus. Never a status, never a health indicator, never a risk level.",
    tokens: ["--iris-50", "--iris-100", "--iris-200", "--iris-300", "--iris-400", "--iris-500",
      "--iris-600", "--iris-700", "--iris-800", "--iris-900", "--iris-950"],
  },
  {
    family: "Ember — human involvement",
    hint: "Approval pending, SLA countdown, manual intervention. The warm counterpoint.",
    tokens: ["--ember-200", "--ember-300", "--ember-400", "--ember-500", "--ember-600", "--ember-700", "--ember-950"],
  },
  {
    family: "Verdant — success",
    hint: "A run or step succeeded. Never the brand.",
    tokens: ["--verdant-50", "--verdant-400", "--verdant-500", "--verdant-600", "--verdant-700", "--verdant-950"],
  },
  {
    family: "Signal — failure",
    hint: "A run or step failed.",
    tokens: ["--signal-50", "--signal-400", "--signal-500", "--signal-600", "--signal-700", "--signal-950"],
  },
  {
    family: "Pulse — live",
    hint: "Executing right now.",
    tokens: ["--pulse-50", "--pulse-400", "--pulse-500", "--pulse-600", "--pulse-700", "--pulse-950"],
  },
];

const READING = ["--bg-app", "--bg-base", "--bg-raised", "--bg-overlay", "--bg-sunken"];
const CARDS = ["--bg-base", "--bg-raised"];
const STATUSES = ["success", "failed", "live", "waiting", "queued", "cancelled"] as const;

type Row = { token: string; against: string[]; req: Requirement; note?: string };
type Group = { title: string; hint: string; rows: Row[] };

const SURFACE_ROWS: Row[] = [
  { token: "--bg-canvas", against: [], req: "decorative", note: "builder void" },
  { token: "--bg-app", against: [], req: "decorative", note: "application background" },
  { token: "--bg-base", against: [], req: "decorative", note: "base surface" },
  { token: "--bg-raised", against: [], req: "decorative", note: "cards, panels" },
  { token: "--bg-overlay", against: [], req: "decorative", note: "menus, popovers" },
  { token: "--bg-sunken", against: [], req: "decorative", note: "wells, table zebra" },
  { token: "--bg-hover", against: ["--bg-raised"], req: "decorative", note: "surface delta" },
  { token: "--bg-active", against: ["--bg-raised"], req: "decorative", note: "surface delta" },
  { token: "--bg-selected", against: ["--bg-raised"], req: "decorative", note: "surface delta" },
];

const GROUPS: Group[] = [
  {
    title: "Foreground",
    hint: "Graded against the worst of all five reading surfaces. Body text needs 4.5:1.",
    rows: [
      { token: "--fg-max", against: READING, req: "text", note: "headings" },
      { token: "--fg-primary", against: READING, req: "text", note: "body" },
      { token: "--fg-secondary", against: READING, req: "text", note: "supporting" },
      { token: "--fg-muted", against: READING, req: "text", note: "metadata" },
      { token: "--fg-disabled", against: CARDS, req: "decorative", note: "disabled control — WCAG 1.4.3 exempt" },
      { token: "--fg-link", against: CARDS, req: "text" },
      { token: "--fg-on-accent", against: ["--accent"], req: "text", note: "label on a brand fill" },
    ],
  },
  {
    title: "Borders",
    hint: "border-default is the control boundary and must clear 3:1. border-subtle is a decorative divider — WCAG 1.4.11 scopes to parts needed to identify a control, and a row separator is not one.",
    rows: [
      { token: "--border-subtle", against: CARDS, req: "decorative", note: "card / row separator" },
      { token: "--border-default", against: CARDS, req: "ui", note: "inputs, selects, checkboxes" },
      { token: "--border-strong", against: CARDS, req: "ui", note: "emphasis, active outline" },
      { token: "--border-focus", against: [...CARDS, "--bg-app"], req: "ui", note: "focus ring — brand" },
    ],
  },
  {
    title: "Brand — iris",
    hint: "Never a status. --accent is graded as a link/active label, and its border against the brand tint.",
    rows: [
      { token: "--accent", against: [...CARDS, "--bg-selected"], req: "text" },
      { token: "--accent-hover", against: CARDS, req: "ui" },
      { token: "--accent-active", against: CARDS, req: "ui" },
      { token: "--accent-subtle", against: [], req: "decorative", note: "tint fill" },
      { token: "--accent-border", against: ["--accent-subtle"], req: "ui", note: "outline on tint" },
    ],
  },
  {
    title: "Status — badge label on its own tint",
    hint: "The badge label sits on the -subtle fill, so it is graded as body text at 4.5:1.",
    rows: STATUSES.map((s) => ({
      token: `--status-${s}`,
      against: [`--status-${s}-subtle`],
      req: "text" as Requirement,
      note: "label on tint",
    })),
  },
  {
    title: "Status — dot and glyph on a card",
    hint: "The same colour used as a status dot is a graphical object: 3:1.",
    rows: STATUSES.map((s) => ({
      token: `--status-${s}`,
      against: CARDS,
      req: "ui" as Requirement,
      note: "dot / glyph",
    })),
  },
  {
    title: "Status — badge outline",
    hint: "The -border variant outlines the badge against its own tint.",
    rows: STATUSES.map((s) => ({
      token: `--status-${s}-border`,
      against: [`--status-${s}-subtle`],
      req: "ui" as Requirement,
    })),
  },
  {
    title: "Risk",
    hint: "Always paired with a glyph, never colour alone (§3.5).",
    rows: (["low", "medium", "high", "critical"] as const).map((r) => ({
      token: `--risk-${r}`,
      against: ["--bg-raised"],
      req: "ui" as Requirement,
    })),
  },
  {
    title: "Environment chrome",
    hint: "A 2px rail plus a chip. The hatch and dash carry the meaning for colour-blind users; colour alone never does.",
    rows: (["production", "staging", "development"] as const).map((e) => ({
      token: `--env-${e}`,
      against: ["--bg-app"],
      req: "ui" as Requirement,
    })),
  },
];

const ALL_TOKENS = Array.from(
  new Set([
    ...PRIMITIVES.flatMap((p) => p.tokens),
    ...SURFACE_ROWS.flatMap((r) => [r.token, ...r.against]),
    ...GROUPS.flatMap((g) => g.rows.flatMap((r) => [r.token, ...r.against])),
  ]),
);

/* ── Presentation ───────────────────────────────────────────────────────────── */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-heading-md text-fg-max font-ui">{title}</h2>
      {hint ? <p className="text-caption text-fg-muted mt-1 mb-4 max-w-[76ch]">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

function Verdict({ ratio, req }: { ratio: number | null; req: Requirement }) {
  if (ratio === null) {
    return <span className="text-caption text-fg-muted">—</span>;
  }
  if (req === "decorative") {
    return (
      <span className="text-caption text-fg-muted">
        <span className="tabular font-code">{formatRatio(ratio)}</span> · exempt
      </span>
    );
  }
  const ok = passes(ratio, req);
  return (
    <span
      className={[
        "text-caption inline-flex items-center gap-1.5 rounded-xs border px-1.5 py-0.5",
        ok
          ? "bg-status-success-subtle text-status-success border-status-success-border"
          : "bg-status-failed-subtle text-status-failed border-status-failed-border",
      ].join(" ")}
    >
      <span className="tabular font-code font-semibold">{formatRatio(ratio)}</span>
      <span aria-hidden="true">·</span>
      <span>{ok ? "PASS" : "FAIL"}</span>
      <span className="text-fg-muted">needs {MINIMUM[req]}:1</span>
    </span>
  );
}

/** Worst-case ratio across every intended background, and which one caused it. */
function worstCase(
  fg: string | null,
  backgrounds: string[],
  tokens: Record<string, string | null>,
): { ratio: number | null; bg: string | null } {
  if (!fg || backgrounds.length === 0) return { ratio: null, bg: null };
  let worst: { ratio: number; bg: string } | null = null;
  for (const b of backgrounds) {
    const bgHex = tokens[b];
    if (!bgHex) continue;
    const ratio = contrastRatio(fg, bgHex);
    if (!worst || ratio < worst.ratio) worst = { ratio, bg: b };
  }
  return worst ? { ratio: worst.ratio, bg: worst.bg } : { ratio: null, bg: null };
}

function TokenRow({ row, tokens }: { row: Row; tokens: Record<string, string | null> }) {
  const hex = tokens[row.token] ?? null;
  const { ratio, bg } = worstCase(hex, row.against, tokens);

  return (
    <tr className="border-subtle border-b last:border-b-0">
      <td className="py-2 pr-3">
        <span
          className="border-subtle inline-block h-7 w-12 rounded-xs border align-middle"
          style={{ background: `var(${row.token})` }}
        />
      </td>
      <td className="py-2 pr-4">
        <code className="text-mono-sm font-code text-fg-primary">{row.token}</code>
        {row.note ? <div className="text-caption text-fg-muted">{row.note}</div> : null}
      </td>
      <td className="py-2 pr-4">
        <code className="text-mono-sm font-code text-fg-secondary tabular">{hex ?? "unresolved"}</code>
      </td>
      <td className="py-2 pr-4">
        {bg ? <code className="text-mono-sm font-code text-fg-muted">{bg}</code> : <span className="text-caption text-fg-muted">—</span>}
      </td>
      <td className="py-2">
        <Verdict ratio={ratio} req={row.req} />
      </td>
    </tr>
  );
}

function RowTable({ rows, tokens }: { rows: Row[]; tokens: Record<string, string | null> }) {
  return (
    <div className="bg-surface-raised border-subtle overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-left">
        <thead>
          <tr className="border-subtle border-b">
            {["", "Token", "Value", "Worst background", "Contrast"].map((h) => (
              <th key={h} className="text-eyebrow text-fg-muted px-0 py-2 font-semibold uppercase first:pl-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td:first-child]:pl-3">{rows.map((r) => <TokenRow key={`${r.token}-${r.req}-${r.against.join()}`} row={r} tokens={tokens} />)}</tbody>
      </table>
    </div>
  );
}

function Scale({ family, hint, tokens, values }: {
  family: string; hint: string; tokens: string[]; values: Record<string, string | null>;
}) {
  return (
    <Section title={family} hint={hint}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tokens.map((t) => (
          <div key={t} className="flex flex-col gap-1.5">
            <div className="border-subtle h-16 rounded-md border" style={{ background: `var(${t})` }} />
            <code className="text-mono-sm font-code text-fg-secondary">{t.replace("--", "")}</code>
            <code className="text-mono-sm font-code text-fg-muted tabular">{values[t] ?? "—"}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── The gallery ────────────────────────────────────────────────────────────── */

function Gallery() {
  const tokens = useTokens(ALL_TOKENS);

  const graded = React.useMemo(() => {
    const out: { pass: number; fail: number; failures: string[] } = { pass: 0, fail: 0, failures: [] };
    for (const g of GROUPS) {
      for (const r of g.rows) {
        if (r.req === "decorative") continue;
        const { ratio } = worstCase(tokens[r.token] ?? null, r.against, tokens);
        if (ratio === null) continue;
        if (passes(ratio, r.req)) out.pass += 1;
        else {
          out.fail += 1;
          out.failures.push(`${r.token} (${formatRatio(ratio)}, needs ${MINIMUM[r.req]}:1)`);
        }
      }
    }
    return out;
  }, [tokens]);

  const clean = graded.fail === 0 && graded.pass > 0;

  return (
    <div className="font-ui p-8">
      <header className="mb-10">
        <p className="text-eyebrow text-accent mb-2 uppercase">Foundation</p>
        <h1 className="text-display-md text-fg-max font-display mb-2">Ink &amp; Iris — token gallery</h1>
        <p className="text-body-sm text-fg-secondary max-w-[76ch]">
          Brand colour and status colour are disjoint sets. Iris never means &ldquo;good&rdquo;; green never
          means &ldquo;Vectorbea&rdquo;. Every ratio below is computed from the live custom properties in the
          theme you are currently viewing.
        </p>

        <div
          className={[
            "mt-5 inline-flex flex-col gap-1 rounded-md border px-4 py-3",
            clean
              ? "bg-status-success-subtle border-status-success-border"
              : "bg-status-failed-subtle border-status-failed-border",
          ].join(" ")}
          role="status"
        >
          <span className={`text-heading-sm ${clean ? "text-status-success" : "text-status-failed"}`}>
            {clean
              ? `All ${graded.pass} enforced pairings pass in this theme`
              : `${graded.fail} pairing${graded.fail === 1 ? "" : "s"} failing`}
          </span>
          <span className="text-caption text-fg-secondary">
            4.5:1 body · 3:1 large text and UI glyphs · decorative separators measured but exempt
          </span>
          {graded.failures.map((f) => (
            <code key={f} className="text-mono-sm font-code text-status-failed">{f}</code>
          ))}
        </div>
      </header>

      <Section
        title="Primitive layer"
        hint="The only hex values in the codebase. Deliberately not exposed as Tailwind utilities — bg-iris-500 does not exist, so components cannot reach past the semantic layer."
      >
        <div />
      </Section>

      {PRIMITIVES.map((p) => (
        <Scale key={p.family} family={p.family} hint={p.hint} tokens={p.tokens} values={tokens} />
      ))}

      <Section
        title="Surfaces"
        hint="Nine steps from the builder void to a selected row. Contrast between surfaces is a perceptual delta, not a WCAG requirement, so these are measured and exempt."
      >
        <RowTable rows={SURFACE_ROWS} tokens={tokens} />
      </Section>

      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} hint={g.hint}>
          <RowTable rows={g.rows} tokens={tokens} />
        </Section>
      ))}

      <Section title="Radii" hint="Six steps. Nothing else exists (§8).">
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          {["rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full"].map((c) => (
            <div key={c} className="flex flex-col gap-2">
              <div className={`bg-accent h-14 ${c}`} />
              <code className="text-mono-sm font-code text-fg-muted">{c}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation" hint="Tinted with the surface hue, never pure black (§3.7).">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
          {["shadow-1", "shadow-2", "shadow-3", "focus-ring", "glow-live"].map((c) => (
            <div key={c} className="flex flex-col gap-2">
              <div className={`bg-surface-raised border-subtle h-16 rounded-lg border ${c}`} />
              <code className="text-mono-sm font-code text-fg-muted">{c}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale" hint="Product base is 14px, not 16. Operators run dense (§4.1).">
        <div className="bg-surface-raised border-subtle space-y-3 rounded-lg border p-5">
          {[
            ["text-display-lg font-display", "Display lg — 40px"],
            ["text-heading-lg font-ui", "Heading lg — 22px"],
            ["text-body font-ui", "Body — 14px, the product default"],
            ["text-body-sm font-ui", "Body sm — 13px, dense tables"],
            ["text-caption font-ui", "Caption — 11.5px"],
            ["text-mono font-code", "Mono — 13px, logs and IDs"],
          ].map(([cls, label]) => (
            <p key={label} className={`text-fg-primary ${cls}`}>{label}</p>
          ))}
          <p className="text-fg-primary text-mono font-code tabular">
            tabular-nums · 1,204,881 · 0,999,111 · 8,888,888
          </p>
        </div>
      </Section>

      <Section title="Motion" hint="Motion explains state change. Motion that decorates is deleted (§7). Every value collapses to 90ms under prefers-reduced-motion.">
        <div className="bg-surface-raised border-subtle overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-left">
            <tbody className="[&_td]:px-3 [&_td]:py-2">
              {[
                ["--duration-instant", "90ms", "state flips, toggles"],
                ["--duration-fast", "140ms", "hover, press, tooltip"],
                ["--duration-base", "200ms", "dropdowns, tabs, chips"],
                ["--duration-slow", "320ms", "drawers, sheets, route change"],
                ["--duration-deliberate", "480ms", "first-paint orchestration only"],
                ["--ease-standard", "cubic-bezier(.20, 0, 0, 1)", "default"],
                ["--ease-entrance", "cubic-bezier(.16, 1, .30, 1)", "entering"],
                ["--ease-exit", "cubic-bezier(.40, 0, 1, 1)", "leaving"],
              ].map(([token, value, use]) => (
                <tr key={token} className="border-subtle border-b last:border-b-0">
                  <td><code className="text-mono-sm font-code text-fg-primary">{token}</code></td>
                  <td><code className="text-mono-sm font-code text-fg-secondary tabular">{value}</code></td>
                  <td className="text-caption text-fg-muted">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Z-index" hint="A closed set. A component needing a layer that is not here has misunderstood which layer it belongs to.">
        <div className="flex flex-wrap gap-2">
          {[["base", 0], ["sticky", 10], ["dropdown", 20], ["overlay", 30],
            ["modal", 40], ["popover", 50], ["toast", 60], ["tooltip", 70]].map(([name, z]) => (
            <span key={String(name)} className="bg-surface-overlay border-subtle text-caption text-fg-secondary rounded-xs border px-2.5 py-1">
              <code className="font-code text-fg-primary">z-{name}</code>
              <span className="tabular font-code text-fg-muted"> · {z}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "Foundation/Design tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = { render: () => <Gallery /> };
