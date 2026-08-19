"use client";

import * as React from "react";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { NotAvailableYet } from "~/components/app/not-available-yet";
import {
  formatResolvedValue,
  toResolvedFields,
  unresolvedFields,
  type NodeDebugDetail,
  type ResolvedField,
} from "~/lib/api/node-debug";

/**
 * <ResolvedInputPreview> — what this node's inputs ACTUALLY resolved to, from
 * the last recorded run.
 *
 * Backed by `workflow_node_debug_snapshots` (V017), which is one of the few
 * things in this product where the data was built before the screen: the worker
 * records the template, the resolved values and the provenance of every
 * expression, on every attempt.
 *
 * Two design commitments:
 *
 *  1. UNRESOLVED FIELDS COME FIRST. A field whose expression produced nothing is
 *     why the node failed, and sorting it into alphabetical position among
 *     twenty successful fields buries the answer.
 *
 *  2. PROVENANCE IS LABELLED AS A GUESS. The worker recovers the source node by
 *     regex from the template text, not from the resolver — so this renders it
 *     as "probably from X", never as a definite link. Presenting a heuristic as
 *     a fact is how someone spends an hour debugging the wrong node.
 */
export interface ResolvedInputPreviewProps {
  snapshot: NodeDebugDetail | null | undefined;
  /** True while the snapshot request is in flight. */
  loading?: boolean;
  /** Set when the node has never run in a recorded run. */
  neverRan?: boolean;
  className?: string;
}

export function ResolvedInputPreview({
  snapshot,
  loading,
  neverRan,
  className,
}: ResolvedInputPreviewProps) {
  const fields = React.useMemo(() => toResolvedFields(snapshot), [snapshot]);
  const unresolved = React.useMemo(() => unresolvedFields(fields), [fields]);

  const ordered = React.useMemo(() => {
    const missing = fields.filter((f) => f.missing && !f.literal);
    const rest = fields.filter((f) => !(f.missing && !f.literal));
    return [...missing, ...rest];
  }, [fields]);

  if (loading) {
    // Skeleton in the shape of the content: three field rows, not a spinner.
    return (
      <div className={cn("grid gap-2", className)} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading resolved inputs</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-md border border-subtle bg-raised p-3">
            <div className="bg-hover h-3 w-24 rounded-xs motion-safe:animate-pulse" />
            <div className="bg-hover mt-2 h-3 w-full rounded-xs motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (neverRan) {
    return (
      <NotAvailableYet
        label="Resolved values"
        reason="This node has not run yet. Run the workflow once and the resolved inputs from that run will appear here."
        className={className}
      />
    );
  }

  if (fields.length === 0) {
    return (
      <div className={cn("rounded-md border border-subtle bg-sunken px-4 py-3", className)}>
        <Text variant="body-sm" tone="secondary" className="block">
          This node takes no inputs.
        </Text>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3", className)}>
      {unresolved.length > 0 ? (
        <div
          role="status"
          className="border-status-failed-border bg-status-failed-subtle rounded-md border px-3 py-2"
        >
          <Text variant="body-sm" tone="inherit" className="text-status-failed block">
            {unresolved.length === 1
              ? "1 field did not resolve in the last run."
              : `${unresolved.length} fields did not resolve in the last run.`}
          </Text>
        </div>
      ) : null}

      <ul className="grid gap-2">
        {ordered.map((field) => (
          <FieldRow key={field.field} field={field} />
        ))}
      </ul>

      {snapshot ? (
        <Text variant="caption" tone="muted" className="block">
          From attempt {snapshot.attempt} of the last recorded run.
        </Text>
      ) : null}
    </div>
  );
}

function FieldRow({ field }: { field: ResolvedField }) {
  const problem = field.missing && !field.literal;

  return (
    <li
      className={cn(
        "rounded-md border bg-raised p-3",
        problem ? "border-status-failed-border" : "border-subtle",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Text variant="body-sm" tone="primary" className="font-mono">
          {field.field}
        </Text>
        {problem ? (
          <Text variant="caption" tone="inherit" className="text-status-failed shrink-0">
            did not resolve
          </Text>
        ) : null}
      </div>

      {field.template !== null ? (
        <p className="text-fg-muted mt-1.5 font-mono text-xs break-words">{field.template}</p>
      ) : null}

      <div className="mt-2">
        <Text variant="caption" tone="muted" className="block">
          {problem ? "No value in the last run" : "Resolved to"}
        </Text>
        <pre
          className={cn(
            "mt-0.5 font-mono text-xs break-words whitespace-pre-wrap",
            problem ? "text-fg-disabled" : "text-fg-primary",
          )}
        >
          {formatResolvedValue(field.resolved)}
        </pre>
      </div>

      {field.sources.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {field.sources.map((source, index) => (
            <li key={`${source.variable}-${index}`} className="text-fg-muted text-xs">
              <span className="font-mono">{source.variable}</span>
              {source.sourceNode ? (
                <>
                  {" — probably from "}
                  <span className="text-fg-secondary">{source.sourceNode}</span>
                  {source.sourcePath ? (
                    <span className="font-mono">{`.${source.sourcePath}`}</span>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
