import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Icon, ICON_SIZE, type IconSize } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { MonoId } from "~/components/ui/mono-id";
import { ProviderLogo, PROVIDER_IDS, providerLabel } from "~/components/ui/provider-logo";
import {
  DOMAIN_ICONS,
  DOMAIN_ICON_FAMILIES,
  type DomainIconFamily,
} from "./domain";
import { NODE_MARKS, NodeMarkChip } from "./nodes";

/**
 * THE ICON GALLERY
 *
 * Every bespoke mark, at every size in the token scale, in both themes.
 * Toggle the theme in the toolbar.
 *
 * These 29 domain marks and 12 node marks are the highest-leverage anti-template
 * work in the system: Vectorbea has primitives — checkpoint, lease,
 * blast-radius, backpressure — that no icon library contains, so every one is
 * drawn here from the same clipped-corner cell.
 */

const FAMILY_BLURB: Record<DomainIconFamily, string> = {
  durability: "The product thesis: how much committed work survives a failure.",
  queue: "What is waiting, who is taking it, and when it stops flowing.",
  graph: "The shapes a workflow can take.",
  human: "Where a person is in the loop. Pairs with ember.",
  failure: "What broke, how far it reached, and why. Never a warning triangle.",
  execution: "What a step actually does, and what it costs.",
};

const SIZES = Object.keys(ICON_SIZE) as IconSize[];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <Text variant="heading-md" tone="max">{title}</Text>
      {hint ? (
        <Text variant="caption" tone="muted" className="mt-1 mb-4 block max-w-[76ch]">{hint}</Text>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

function DomainCard({ entry }: { entry: (typeof DOMAIN_ICONS)[number] }) {
  return (
    <div className="bg-surface-raised border-subtle flex flex-col gap-3 rounded-lg border p-4">
      {/* Every size in the scale, so the smallest is judged at its real size. */}
      <div className="flex items-end gap-3 h-8">
        {SIZES.map((s) => (
          <Icon key={s} icon={entry.Icon} size={s} decorative className="text-fg-primary" />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Icon icon={entry.Icon} size="lg" decorative className="text-accent" />
        <Icon icon={entry.Icon} size="lg" weight="bold" decorative className="text-fg-max" />
        <Text variant="caption" tone="muted">regular · bold</Text>
      </div>
      <div>
        <Text variant="mono-sm" tone="primary" className="block">{entry.name}</Text>
        <Text variant="caption" tone="muted" className="block">{entry.meaning}</Text>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <div className="font-ui p-8">
      <header className="mb-10">
        <Text variant="eyebrow" tone="accent" className="mb-2 block">Foundation</Text>
        <Text variant="display-md" tone="max" className="mb-2">Iconography</Text>
        <Text variant="body-sm" tone="secondary" className="block max-w-[76ch]">
          Phosphor is the base set. Everything below is bespoke: 29 domain marks and 12 node marks,
          drawn on a 24×24 grid at 1.5px, every one derived from the same clipped-corner cell so the
          set coheres by construction rather than by coincidence. No Lucide, no emoji.
        </Text>
      </header>

      <Section
        title="Size scale"
        hint="xs 12 · sm 14 · md 16 · lg 20 · xl 24. Sizes come from the token scale only — an arbitrary px value is a bug."
      >
        <div className="bg-surface-raised border-subtle flex flex-wrap items-end gap-8 rounded-lg border p-5">
          {SIZES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <Icon icon={DOMAIN_ICONS[0].Icon} size={s} decorative className="text-fg-primary" />
              <Text variant="mono-sm" tone="muted">{s} · {ICON_SIZE[s]}</Text>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Icon icon={DOMAIN_ICONS[0].Icon} size="md" decorative className="text-fg-secondary" />
            <Text variant="body-sm" tone="secondary">
              Optically aligned to the baseline, not the box.
            </Text>
          </div>
        </div>
      </Section>

      {DOMAIN_ICON_FAMILIES.map((family) => (
        <Section
          key={family}
          title={`Domain — ${family}`}
          hint={FAMILY_BLURB[family]}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {DOMAIN_ICONS.filter((d) => d.family === family).map((entry) => (
              <DomainCard key={entry.name} entry={entry} />
            ))}
          </div>
        </Section>
      ))}

      <Section
        title="Node marks"
        hint="Twelve builder glyphs, each a state of the cell — open, closed, filled, nested, split, stacked, struck. Each sits on a tinted chip; ember marks the one node type that blocks on a person."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {NODE_MARKS.map(({ type, Icon: Glyph, meaning }) => (
            <div
              key={type}
              className="bg-surface-raised border-subtle flex flex-col items-start gap-3 rounded-lg border p-4"
            >
              <NodeMarkChip type={type} />
              <div className="flex items-center gap-2">
                <Icon icon={Glyph} size="md" decorative className="text-fg-muted" />
                <Icon icon={Glyph} size="sm" decorative className="text-fg-muted" />
              </div>
              <div>
                <Text variant="mono-sm" tone="primary" className="block">{type}</Text>
                <Text variant="caption" tone="muted" className="block">{meaning}</Text>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Provider logos"
        hint="Monochrome on a tint by default; full colour only when connected. That is what makes 'connected' scannable down a long list, and what stops the Integrations page reading as a sticker sheet."
      >
        <div className="bg-surface-raised border-subtle rounded-lg border p-5">
          <Text variant="label" tone="secondary" className="mb-3 block">Not connected</Text>
          <div className="mb-6 flex flex-wrap gap-3">
            {PROVIDER_IDS.map((p) => (
              <ProviderLogo key={p} provider={p} decorative />
            ))}
          </div>
          <Text variant="label" tone="secondary" className="mb-3 block">Connected</Text>
          <div className="flex flex-wrap gap-3">
            {PROVIDER_IDS.map((p) => (
              <ProviderLogo key={p} provider={p} connected decorative />
            ))}
          </div>
          <Text variant="caption" tone="muted" className="mt-4 block">
            {PROVIDER_IDS.map(providerLabel).join(" · ")}
          </Text>
        </div>
      </Section>

      <Section
        title="Type scale"
        hint="Fifteen fixed size/line-height/tracking triples from §4.1, bound to <Text variant>. A call site cannot pick a size without the line-height that belongs to it."
      >
        <div className="bg-surface-raised border-subtle space-y-3 rounded-lg border p-5">
          {([
            "display-lg", "display-md", "heading-lg", "heading-md", "heading-sm",
            "body-lg", "body", "body-sm", "label", "caption", "eyebrow", "mono",
          ] as const).map((v) => (
            <div key={v} className="flex flex-wrap items-baseline gap-4">
              <Text variant="mono-sm" tone="muted" className="w-28 shrink-0">{v}</Text>
              <Text variant={v} tone="primary">Durable execution, 1,204,881 runs</Text>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Identifiers"
        hint="Mono, slashed zero, middle-truncated, click to copy. Hover reveals the full value; clicking says Copied."
      >
        <div className="bg-surface-raised border-subtle flex flex-col items-start gap-2 rounded-lg border p-5">
          <MonoId value="a35d65ca-9f21-4c7e-8b12-4f0e2d3453b5" />
          <MonoId value="run_01JBQZ8XK4T9V2M7N3P6R8S1W5" />
          <MonoId value="wf_7c2f18ab90de4411" head={6} tail={4} />
          <MonoId value="loading" loading />
        </div>
      </Section>
    </div>
  );
}

const meta = { title: "Foundation/Iconography", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Icons: Story = { render: () => <Gallery /> };
