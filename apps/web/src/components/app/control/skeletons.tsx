import * as React from "react";
import { cn } from "~/lib/cn";

/* ══════════════════════════════════════════════════════════════════════════════
   SKELETONS — in the shape of the band, never a page spinner.

   A spinner tells you to wait. A skeleton tells you what is coming, and — the
   part that matters — reserves the exact space so nothing reflows when data
   lands. On this page a reflow is not cosmetic: an operator who has started
   moving toward "Fix connection" should not have it jump 40px because the health
   strip finished loading.

   Everything here is decorative, so it is aria-hidden and the live region that
   announces loading lives on the page, not on each shape.
══════════════════════════════════════════════════════════════════════════════ */

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      data-motion="decorative"
      style={style}
      className={cn(
        "bg-surface-active block rounded-xs",
        // Opacity-only pulse. A translating gradient sweep would animate
        // background-position, which §7 rules out.
        "motion-safe:animate-[ink-fade-in_1.4s_ease-in-out_infinite_alternate]",
        className,
      )}
    />
  );
}

export function HealthStripSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "border-subtle bg-surface-raised overflow-hidden rounded-lg border",
        "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
      )}
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="border-subtle min-w-0 border-b p-4 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
          <Shimmer className="h-2.5 w-24" />
          <Shimmer className="mt-3 h-7 w-20" />
          <Shimmer className="mt-2.5 h-2.5 w-full max-w-[13rem]" />
        </div>
      ))}
    </div>
  );
}

/**
 * The attention line, not the old feed.
 *
 * One row rather than three: the triage feed moved to the notification inbox
 * and what remains on Control is a single severity summary. A three-row
 * skeleton would reserve height the loaded page never uses, which is exactly
 * the reflow a skeleton exists to prevent.
 */
export function AttentionSummarySkeleton() {
  return (
    <div aria-hidden="true" className="border-subtle bg-surface-raised rounded-md border px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Shimmer className="size-4 shrink-0 rounded-sm" />
        <Shimmer className="h-3 w-48" />
        <Shimmer className="h-2.5 w-28" />
      </div>
    </div>
  );
}

export function FleetSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="border-subtle bg-surface-raised overflow-hidden rounded-lg border">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            "grid grid-cols-[11rem_1fr_auto] items-center gap-3 px-3 py-2",
            i > 0 && "border-subtle border-t",
          )}
        >
          <div className="min-w-0">
            <Shimmer className="h-3 w-28" />
            <Shimmer className="mt-1.5 h-2.5 w-20" />
          </div>
          {/* Thirty cells at the real pitch, so the strip does not resize. */}
          <div className="flex gap-[3px]">
            {Array.from({ length: 30 }, (_, c) => (
              <Shimmer key={c} className="h-5 w-2.5 rounded-[2px]" />
            ))}
          </div>
          <Shimmer className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 xl:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="border-subtle bg-surface-raised rounded-lg border p-3">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="mt-3 h-[168px] w-full rounded-sm" />
        </div>
      ))}
      <div className="border-subtle bg-surface-raised rounded-lg border xl:col-span-2">
        <div className="border-subtle border-b px-3 py-2">
          <Shimmer className="h-2.5 w-20" />
        </div>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="border-subtle flex items-center gap-2.5 border-b px-3 py-1.5 last:border-b-0">
            <Shimmer className="size-1.5 shrink-0 rounded-full" />
            <Shimmer className="h-2.5 w-12 shrink-0" />
            <Shimmer className="h-2.5 flex-1" />
            <Shimmer className="h-2.5 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The whole page, for the first paint. */
export function ControlSkeleton() {
  return (
    <div className="grid gap-6">
      <p role="status" className="sr-only">Loading workspace health.</p>
      <HealthStripSkeleton />
      <AttentionSummarySkeleton />
      <FleetSkeleton />
      <DetailSkeleton />
    </div>
  );
}
