import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "./text";

/**
 * <PageContainer> and <PageHeader> — the frame every screen sits in.
 *
 * Content max-width is 1600px for product surfaces (§8). Gutters step with the
 * viewport rather than staying fixed, because a 24px gutter that is right at
 * 1280px wastes the edge of a 1920px monitor an operator chose specifically for
 * density.
 */

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `prose` for docs-like reading widths, `full` to opt out of the cap. */
  width?: "product" | "prose" | "full";
}

export function PageContainer({ width = "product", className, children, ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-5 sm:px-6 2xl:px-8",
        width === "product" && "max-w-(--container-product)",
        width === "prose" && "max-w-(--container-prose)",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Facts about the thing — owner, version, environment, last run. */
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered flush to the bottom edge so the underline meets the content. */
  tabs?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow, title, description, metadata, actions, tabs, className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <Text variant="eyebrow" tone="muted" className="mb-1 block">{eyebrow}</Text>
          ) : null}
          <Text variant="heading-lg" tone="max" as="h1">{title}</Text>
          {description ? (
            <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[68ch]">
              {description}
            </Text>
          ) : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {metadata ? (
        <div className="text-fg-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">{metadata}</div>
      ) : null}

      {tabs ? <div className="border-subtle -mb-px mt-4 border-b">{tabs}</div> : null}
    </header>
  );
}

/** A single fact in the PageHeader metadata row. */
export function PageMeta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="caption" tone="secondary" className="tabular">{children}</Text>
    </span>
  );
}
