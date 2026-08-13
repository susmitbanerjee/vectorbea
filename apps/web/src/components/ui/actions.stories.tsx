import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Button, IconButton, ButtonGroup, SplitButton, ToggleButton, type ButtonVariant, type ButtonSize } from "./button";
import { Text } from "./text";
import { CheckpointIcon, ReplayIcon, IncidentIcon } from "~/components/icons/domain";

/**
 * ACTIONS — every variant × every state.
 *
 * Toggle the theme in the toolbar; both must be checked, never inferred.
 */

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "subtle"];
const SIZES: ButtonSize[] = ["xs", "sm", "md", "lg"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-4 py-1.5">
      <Text variant="mono-sm" tone="muted">{label}</Text>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      {hint ? <Text variant="caption" tone="muted" className="mt-1 mb-3 block max-w-[76ch]">{hint}</Text> : <div className="mb-3" />}
      <div className="bg-surface-raised border-subtle rounded-lg border p-4">{children}</div>
    </section>
  );
}

const meta = { title: "Primitives/Actions", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  render: () => (
    <div className="font-ui p-8">
      <Text variant="eyebrow" tone="accent" className="mb-2 block">Primitives</Text>
      <Text variant="display-md" tone="max" className="mb-2">Actions</Text>
      <Text variant="body-sm" tone="secondary" className="mb-8 block max-w-[76ch]">
        Radius <code className="font-code">sm</code> (6px), 1px border, press is a 1px translate not a
        scale, focus is the two-stop <code className="font-code">--shadow-focus</code> ring. Loading
        freezes the box — the label stays mounted and hidden, so a row of buttons never jumps.
      </Text>

      <Section title="Variants × states" hint="Every variant at md, across rest / disabled / loading.">
        <Row label="rest">
          {VARIANTS.map((v) => <Button key={v} variant={v}>{v}</Button>)}
        </Row>
        <Row label="disabled">
          {VARIANTS.map((v) => <Button key={v} variant={v} disabled>{v}</Button>)}
        </Row>
        <Row label="loading">
          {VARIANTS.map((v) => <Button key={v} variant={v} loading>{v}</Button>)}
        </Row>
        <Row label="with icon">
          {VARIANTS.map((v) => (
            <Button key={v} variant={v} iconLeft={<CheckpointIcon size={14} />}>{v}</Button>
          ))}
        </Row>
      </Section>

      <Section title="No layout shift" hint="The same button, rest then loading. The box is identical — measure it.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" iconLeft={<ReplayIcon size={14} />}>Retry 4 nodes</Button>
          <Button variant="primary" iconLeft={<ReplayIcon size={14} />} loading>Retry 4 nodes</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="secondary" loading>Cancel</Button>
        </div>
      </Section>

      <Section title="Sizes" hint="xs 24 · sm 28 · md 32 · lg 36. Heights sit on the 4px lattice.">
        {SIZES.map((s) => (
          <Row key={s} label={s}>
            <Button size={s} variant="primary">Publish</Button>
            <Button size={s} variant="secondary" iconLeft={<CheckpointIcon size={s === "xs" ? 12 : 14} />}>Commit</Button>
            <Button size={s} variant="secondary" loading>Commit</Button>
            <IconButton size={s} variant="ghost" label="Replay run" icon={<ReplayIcon size={s === "xs" ? 12 : 14} />} />
          </Row>
        ))}
      </Section>

      <Section title="IconButton" hint="label is required by the type — it is the entire accessible name.">
        <Row label="variants">
          {VARIANTS.map((v) => (
            <IconButton key={v} variant={v} label={`Replay (${v})`} icon={<ReplayIcon size={14} />} />
          ))}
        </Row>
        <Row label="states">
          <IconButton label="Replay" icon={<ReplayIcon size={14} />} />
          <IconButton label="Replay disabled" disabled icon={<ReplayIcon size={14} />} />
          <IconButton label="Replay loading" loading icon={<ReplayIcon size={14} />} />
        </Row>
      </Section>

      <Section title="ButtonGroup" hint="Shared 1px seam via negative margin — not three adjacent buttons with a 2px gutter.">
        <Row label="group">
          <ButtonGroup label="Run actions">
            <Button variant="secondary">Retry</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="secondary">Compare</Button>
          </ButtonGroup>
        </Row>
        <Row label="with icons">
          <ButtonGroup label="View density">
            <Button variant="secondary" size="sm">Comfortable</Button>
            <Button variant="subtle" size="sm">Default</Button>
            <Button variant="secondary" size="sm">Compact</Button>
          </ButtonGroup>
        </Row>
      </Section>

      <Section title="SplitButton" hint="The primary action stays a single click; only the caret opens the menu.">
        <Row label="split">
          <SplitButton variant="primary" menuLabel="More run options">Run now</SplitButton>
          <SplitButton variant="secondary" menuLabel="More export options">Export</SplitButton>
          <SplitButton variant="secondary" menuLabel="More options" loading>Export</SplitButton>
          <SplitButton variant="secondary" menuLabel="More options" disabled>Export</SplitButton>
        </Row>
      </Section>

      <Section title="ToggleButton" hint="aria-pressed. Pressed uses the brand tint, never the primary fill — a toggle reports state, it does not solicit a click.">
        <ToggleDemo />
      </Section>
    </div>
  ),
};

function ToggleDemo() {
  const [live, setLive] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  return (
    <>
      <Row label="interactive">
        <ToggleButton pressed={live} onPressedChange={setLive} iconLeft={<CheckpointIcon size={14} />}>
          Live only
        </ToggleButton>
        <ToggleButton pressed={failed} onPressedChange={setFailed} iconLeft={<IncidentIcon size={14} />}>
          Failed only
        </ToggleButton>
      </Row>
      <Row label="states">
        <ToggleButton pressed={false}>Off</ToggleButton>
        <ToggleButton pressed>On</ToggleButton>
        <ToggleButton pressed disabled>On disabled</ToggleButton>
        <ToggleButton pressed={false} loading>Loading</ToggleButton>
      </Row>
    </>
  );
}
