"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { flattenConfig, type VersionNode } from "~/mocks/workflow-nodes";
import type { FieldDiff } from "~/mocks/workflow-versions";

/* ══════════════════════════════════════════════════════════════════════════════
   CONFIG DIFF — per node, expandable.

   FLATTENED PATHS, NOT A JSON BLOB DIFF. `retry.attempts 3 → 1` is one line an
   operator reads in a second. The same change rendered as a unified diff of
   pretty-printed JSON is nine lines of braces around the one that matters, and
   it puts the brace noise at the same visual weight as the value.

   Unchanged fields are collapsed by default and available on demand, because
   the question on this screen is "what changed" and the answer to "what is the
   rest of it" lives one click away in the builder.
══════════════════════════════════════════════════════════════════════════════ */

export function ConfigDiff({
  fields, before, after, className,
}: {
  fields: FieldDiff[];
  /** Null when the node did not exist in that version. */
  before: VersionNode | null;
  after: VersionNode | null;
  className?: string;
}) {
  const [showAll, setShowAll] = React.useState(false);

  const changedPaths = new Set(fields.map((f) => f.path));
  const full = flattenConfig((after ?? before)?.config ?? {});
  const unchanged = Object.entries(full)
    .filter(([path]) => !changedPaths.has(path))
    .sort(([a], [b]) => a.localeCompare(b));

  if (fields.length === 0 && unchanged.length === 0) {
    return <Text variant="caption" tone="muted" className={className}>This node has no configuration.</Text>;
  }

  return (
    <div className={cn("grid gap-2", className)}>
      {fields.length === 0 ? (
        <Text variant="caption" tone="muted">Nothing changed on this node.</Text>
      ) : (
        <dl className="grid gap-px">
          {fields.map((field) => (
            <DiffRow key={field.path} field={field} />
          ))}
        </dl>
      )}

      {unchanged.length > 0 ? (
        <div>
          <button
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className={cn(
              "font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            {showAll ? "Hide" : "Show"} {unchanged.length} unchanged {unchanged.length === 1 ? "field" : "fields"}
          </button>

          {showAll ? (
            <dl className="mt-1.5 grid gap-px">
              {unchanged.map(([path, value]) => (
                <div key={path} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-2 px-1 py-0.5">
                  <dt className="min-w-0">
                    <Text variant="mono-sm" tone="disabled" className="truncate">{path}</Text>
                  </dt>
                  <dd className="min-w-0">
                    <Text variant="mono-sm" tone="muted" className="break-all">{format(value)}</Text>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const KIND_TONE: Record<FieldDiff["kind"], string> = {
  changed: "text-status-waiting",
  added: "text-status-success",
  removed: "text-status-failed",
};

function DiffRow({ field }: { field: FieldDiff }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-baseline gap-2 rounded-xs px-1 py-1",
        "bg-surface-sunken",
      )}
    >
      <dt className="min-w-0">
        <Text variant="mono-sm" tone="secondary" className="truncate" title={field.path}>
          {field.path}
        </Text>
      </dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-1.5">
        {field.kind !== "added" ? (
          <Text
            variant="mono-sm"
            tone="muted"
            className="break-all line-through decoration-1"
          >
            {format(field.before)}
          </Text>
        ) : null}
        {field.kind === "changed" ? (
          <span className="text-fg-disabled shrink-0" aria-hidden="true">
            <svg viewBox="0 0 12 8" className="h-2 w-3">
              <path d="M0 4h9M6.5 1.5 9.5 4l-3 2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : null}
        {field.kind !== "removed" ? (
          <Text variant="mono-sm" tone="inherit" className={cn("break-all", KIND_TONE[field.kind])}>
            {format(field.after)}
          </Text>
        ) : null}
        <span className="sr-only">
          {field.kind === "changed" ? `changed from ${format(field.before)} to ${format(field.after)}`
            : field.kind === "added" ? `added, set to ${format(field.after)}`
              : `removed, was ${format(field.before)}`}
        </span>
      </dd>
    </div>
  );
}

/**
 * Values as they appear in the config, not as JSON.
 *
 * A number stays a number and a string loses its quotes — quotes on every string
 * value doubles the punctuation on a screen whose job is to make one changed
 * value obvious. Arrays keep brackets because their length is the information.
 */
function format(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => String(v)).join(", ")}]`;
  if (typeof value === "number") return value.toLocaleString("en-GB");
  return String(value);
}
