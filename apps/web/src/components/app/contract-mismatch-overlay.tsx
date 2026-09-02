"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { onContractMismatch, type ContractMismatch } from "~/lib/api/validate";

/**
 * <ContractMismatchOverlay> — development only.
 *
 * The contracts in `@vectorbea/shared` are transcribed by hand from the Kotlin
 * handlers, so they drift. In production that drift degrades quietly into an
 * error state and a telemetry report. In development it should be impossible to
 * ignore, because the person who can fix it is looking at the screen.
 *
 * Renders nothing in production — the whole component short-circuits, and the
 * reporting path in `validate.ts` runs regardless of whether this is mounted.
 */
export function ContractMismatchOverlay() {
  const [mismatches, setMismatches] = React.useState<ContractMismatch[]>([]);
  const [dismissed, setDismissed] = React.useState(false);

  const enabled = process.env.NODE_ENV !== "production";

  React.useEffect(() => {
    if (!enabled) return;
    return onContractMismatch((mismatch) => {
      setDismissed(false);
      // Keep the most recent few. A schema break usually fires on every row of
      // a list, and a thousand identical panels helps nobody.
      setMismatches((current) => [mismatch, ...current].slice(0, 5));
    });
  }, [enabled]);

  if (!enabled || dismissed || mismatches.length === 0) return null;

  return (
    <div
      role="alertdialog"
      aria-label="API contract mismatch"
      className={cn(
        "fixed inset-x-0 bottom-0 z-[200] max-h-[60vh] overflow-y-auto",
        "border-t border-status-failed-border bg-status-failed-subtle",
        "px-4 py-3 text-fg-primary",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-status-failed">
              API contract mismatch ({mismatches.length})
            </p>
            <p className="text-xs text-fg-secondary">
              The API returned a shape the contract in @vectorbea/shared does not describe.
              Update the schema, or fix the endpoint. This overlay is development only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={cn(
              "rounded-sm border border-subtle px-2 py-1 text-xs",
              "hover:bg-hover focus-visible:focus-ring",
            )}
          >
            Dismiss
          </button>
        </div>

        {mismatches.map((mismatch, index) => (
          <details
            key={`${mismatch.at}-${index}`}
            open={index === 0}
            className="rounded-md border border-subtle bg-raised p-3"
          >
            <summary className="cursor-pointer text-xs font-medium">
              <span className="font-mono">{mismatch.path}</span>
              {mismatch.requestId ? (
                <span className="ml-2 font-mono text-fg-muted">{mismatch.requestId}</span>
              ) : null}
            </summary>
            <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-fg-secondary">
              {JSON.stringify(mismatch.issues, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
