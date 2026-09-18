import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { PlanChip, PlanRing, planTier, type PlanTier } from "./plan-badge";
import { Text } from "./text";

/**
 * PLAN TIER — every tier, on both surfaces the ring is actually drawn on.
 *
 * This story exists because the real screens CANNOT show it. The plan comes
 * from `/api/entitlements`, the workspace you are signed into is on one plan,
 * and the mock transport answers Free — so three of the four cases are
 * unreachable in the app without a billing account to switch. Everything below
 * is the treatment with the data stubbed, which is the only way to check the
 * gold ring in both themes before a paying customer does.
 *
 * Toggle the theme in the toolbar; both must be checked, never inferred.
 */

const CODES = ["free", "pro", "team", "enterprise"] as const;

/** Names as the seeded catalogue writes them (V060). */
const NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

function FakeAvatar({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "size-5" : size === "md" ? "size-8" : "size-16";
  return (
    <span
      aria-hidden="true"
      className={`${box} bg-accent-subtle text-accent font-ui text-eyebrow grid shrink-0 place-items-center rounded-full`}
    >
      S
    </span>
  );
}

/** The sidebar's account row, reproduced at its real width. */
function AccountRow({ tier, name }: { tier: PlanTier | null; name: string }) {
  return (
    <div className="bg-surface-base border-subtle w-[248px] rounded-md border p-2">
      <div className="font-ui text-body-sm text-fg-secondary flex items-center gap-2.5 rounded-sm px-2 py-1.5">
        <PlanRing tier={tier}>
          <FakeAvatar />
        </PlanRing>
        <span className="truncate">Susmit Banerjee</span>
        <PlanChip tier={tier} name={name} className="ml-auto" />
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      {hint ? (
        <Text variant="caption" tone="muted" className="mb-3 mt-1 block max-w-[76ch]">{hint}</Text>
      ) : (
        <div className="mb-3" />
      )}
      <div className="bg-surface-raised border-subtle rounded-lg border p-4">{children}</div>
    </section>
  );
}

const meta = { title: "Primitives/Plan tier", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PlanTiers: Story = {
  render: () => (
    <div className="font-ui p-8">
      <Text variant="eyebrow" tone="accent" className="mb-2 block">Primitives</Text>
      <Text variant="display-md" tone="max" className="mb-2">Plan tier</Text>
      <Text variant="body-sm" tone="secondary" className="mb-8 block max-w-[76ch]">
        A ring on the account avatar and a chip beside it, saying what the workspace&apos;s billing
        account is on. Free draws nothing — the absence is what makes the rest mean something. The
        ring is an <code className="font-code">outline</code>, so it never changes the height of the
        row it sits in.
      </Text>

      <Section
        title="The account row"
        hint="248px, the sidebar's real width, on --bg-base. This is where the treatment lives."
      >
        <div className="flex flex-wrap gap-4">
          {CODES.map((code) => (
            <div key={code} className="grid gap-2">
              <Text variant="mono-sm" tone="muted">{code}</Text>
              <AccountRow tier={planTier(code)} name={NAMES[code]} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Sizes"
        hint="20px in the sidebar, 32px in the account menu, 64px on Profile. The 64px ring takes the wider offset — at that size a two-pixel gap closes up and reads as a border on the photo."
      >
        <div className="flex flex-wrap items-end gap-8">
          {CODES.map((code) => (
            <div key={code} className="grid justify-items-center gap-3">
              <div className="flex items-end gap-4">
                <PlanRing tier={planTier(code)}><FakeAvatar size="sm" /></PlanRing>
                <PlanRing tier={planTier(code)}><FakeAvatar size="md" /></PlanRing>
                <PlanRing tier={planTier(code)} offset="lg"><FakeAvatar size="lg" /></PlanRing>
              </div>
              <Text variant="mono-sm" tone="muted">{code}</Text>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Chips alone"
        hint="Pro and Team are tints with an outline, the shape every badge in the product uses. Enterprise is a solid inversion — the only chip that is, which is what puts it above gold."
      >
        <div className="flex flex-wrap items-center gap-3">
          {CODES.map((code) => (
            <PlanChip key={code} tier={planTier(code)} name={NAMES[code]} />
          ))}
          <Text variant="caption" tone="muted">
            (free renders nothing, and so does a plan code this build has never heard of)
          </Text>
        </div>
      </Section>

      <Section
        title="On every surface a ring can land on"
        hint="The ring has to clear 3:1 against each of these in both themes — check:contrast grades all four."
      >
        {/* Class names are written out rather than interpolated: Tailwind only
            mints a utility it finds as a literal in the source, so `bg-${s}`
            would compile to nothing at all and this section would silently
            grade four identical surfaces. */}
        <div className="grid gap-2">
          {(
            [
              ["--bg-app", "bg-surface-app"],
              ["--bg-base", "bg-surface-base"],
              ["--bg-raised", "bg-surface-raised"],
              ["--bg-overlay", "bg-surface-overlay"],
            ] as const
          ).map(([token, surface]) => (
            <div key={token} className={`${surface} border-subtle flex items-center gap-4 rounded-md border p-3`}>
              <Text variant="mono-sm" tone="muted" className="w-40">{token}</Text>
              {CODES.map((code) => (
                <PlanRing key={code} tier={planTier(code)}><FakeAvatar /></PlanRing>
              ))}
            </div>
          ))}
        </div>
      </Section>
    </div>
  ),
};
