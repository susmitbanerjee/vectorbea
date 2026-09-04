import * as React from "react";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import type { IconComponent } from "~/components/icons/types";

/**
 * <RoutePlaceholder> — a route that exists in the IA but has no screen yet.
 *
 * Copy follows §12: an invitation with a stated next step, never "Coming soon"
 * or "No data". It names which prompt fills it in, so someone landing here from
 * the nav knows this is planned work rather than a broken link.
 */
export function RoutePlaceholder({
  eyebrow, title, description, icon: Glyph, plannedIn, bullets,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: IconComponent;
  plannedIn: string;
  bullets: string[];
}) {
  return (
    <PageContainer>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />

      <div className="border-subtle bg-surface-raised rounded-lg border p-8">
        <div className="mx-auto max-w-lg text-center">
          <span className="bg-accent-subtle text-accent mb-4 inline-grid size-12 place-items-center rounded-lg">
            <Glyph size={24} aria-hidden="true" />
          </span>

          <Text variant="heading-md" tone="max" className="mb-1.5 block">
            This surface lands in {plannedIn}
          </Text>
          <Text variant="body-sm" tone="secondary" className="mb-5 block">
            The route, navigation and shell are wired now so the information architecture is
            reviewable end to end. Here is what will fill it:
          </Text>

          <ul className="mb-6 grid gap-2 text-left">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <Text variant="body-sm" tone="secondary">{b}</Text>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm">Read the design direction</Button>
            <Button variant="ghost" size="sm">Open the execution plan</Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
