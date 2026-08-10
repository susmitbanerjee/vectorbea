import type { Meta, StoryObj } from "@storybook/nextjs";

/**
 * The token sheet. Not product UI — this is the design system's own
 * documentation, and the surface the P02 review gate is judged against.
 *
 * It is also the end-to-end proof that the Ink & Iris token layer compiles:
 * every swatch below is a semantic utility generated from
 * src/styles/tokens/*.css. If a swatch renders transparent, that token is broken.
 *
 * Toggle the theme in the toolbar. Dark is the product default.
 */

const meta = {
  title: "Foundation/Design tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-heading-md text-fg-high font-ui">{title}</h2>
      <p className="text-caption text-fg-muted font-ui mt-1 mb-4">{hint}</p>
      {children}
    </section>
  );
}

function Swatch({ className, name }: { className: string; name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`border-subtle h-14 rounded-md border ${className}`} />
      <code className="text-mono-sm text-fg-muted font-code">{name}</code>
    </div>
  );
}

const surfaces = [
  "bg-surface-void",
  "bg-surface-app",
  "bg-surface-base",
  "bg-surface-raised",
  "bg-surface-overlay",
  "bg-surface-hover",
];

const status = [
  "bg-status-succeeded",
  "bg-status-failed",
  "bg-status-live",
  "bg-status-waiting",
  "bg-status-queued",
  "bg-status-cancelled",
];

const brand = ["bg-brand", "bg-brand-hover", "bg-brand-pressed", "bg-brand-tint"];

const foreground = [
  "text-fg-max",
  "text-fg-high",
  "text-fg-primary",
  "text-fg-secondary",
  "text-fg-muted",
  "text-fg-disabled",
];

const type = [
  ["text-display-lg font-display", "Display lg — 40px"],
  ["text-heading-lg font-ui", "Heading lg — 22px"],
  ["text-body font-ui", "Body — 14px, the product default"],
  ["text-body-sm font-ui", "Body sm — 13px, dense tables"],
  ["text-caption font-ui", "Caption — 11.5px"],
  ["text-mono font-code", "Mono — 13px, logs and IDs"],
] as const;

export const Tokens: Story = {
  render: () => (
    <div className="bg-surface-app font-ui min-h-screen p-8">
      <h1 className="text-display-md text-fg-max font-display mb-1">Ink &amp; Iris</h1>
      <p className="text-body-sm text-fg-secondary mb-10">
        Brand colour and status colour are disjoint sets. Iris never means &ldquo;good&rdquo;.
        Green never means &ldquo;Vectorbea&rdquo;.
      </p>

      <Section title="Surfaces" hint="Six steps, void through overlay.">
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          {surfaces.map((c) => (
            <Swatch key={c} className={c} name={c} />
          ))}
        </div>
      </Section>

      <Section title="Status" hint="Each colour has exactly one job. Never reuse one for brand.">
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          {status.map((c) => (
            <Swatch key={c} className={c} name={c} />
          ))}
        </div>
      </Section>

      <Section title="Brand — iris" hint="Identity, primary action, selection, focus. Never a status.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {brand.map((c) => (
            <Swatch key={c} className={c} name={c} />
          ))}
        </div>
      </Section>

      <Section title="Foreground" hint="Contrast must hold at 4.5:1 body, 3:1 large, in both themes.">
        <div className="bg-surface-raised border-subtle rounded-lg border p-5">
          {foreground.map((c) => (
            <p key={c} className={`text-body ${c}`}>
              {c} — the quick brown fox jumps over the lazy dog
            </p>
          ))}
        </div>
      </Section>

      <Section title="Type scale" hint="Product base is 14px, not 16. Operators run dense.">
        <div className="bg-surface-raised border-subtle space-y-3 rounded-lg border p-5">
          {type.map(([cls, label]) => (
            <p key={label} className={`text-fg-primary ${cls}`}>
              {label}
            </p>
          ))}
        </div>
      </Section>

      <Section title="Numerals" hint="tabular-nums on every number in a table, metric or duration.">
        <div className="bg-surface-raised border-subtle rounded-lg border p-5">
          <div className="tabular text-fg-primary font-code text-mono">
            <div>1,204,881</div>
            <div>0,999,111</div>
            <div>8,888,888</div>
          </div>
        </div>
      </Section>

      <Section title="Elevation" hint="Tinted with the surface hue, never pure black.">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {["elevation-1", "elevation-2", "elevation-3", "glow-live"].map((c) => (
            <div key={c} className="flex flex-col gap-2">
              <div className={`bg-surface-raised h-16 rounded-lg ${c}`} />
              <code className="text-mono-sm text-fg-muted font-code">{c}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii" hint="Six steps. Nothing else exists.">
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          {["rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full"].map(
            (c) => (
              <div key={c} className="flex flex-col gap-2">
                <div className={`bg-brand h-14 ${c}`} />
                <code className="text-mono-sm text-fg-muted font-code">{c}</code>
              </div>
            ),
          )}
        </div>
      </Section>
    </div>
  ),
};
