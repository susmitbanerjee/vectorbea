"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MonoId } from "~/components/ui/mono-id";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";
import { DebugTab } from "./debug-tab";

/**
 * The page shell around the Debug tab: run identity, then the answer, then the
 * evidence.
 *
 * The header carries only what §5.1 puts there — id, workflow, status, duration,
 * cost. Everything else a reader might want is one of the three views below, and
 * putting it in the header instead would push the root-cause banner below the
 * fold, which is the one thing that must never happen.
 */
export function DebugRunView({ runId }: { runId: string }) {
  const router = useRouter();
  const api = useApi();
  const { workspaceId } = useScope();
  const [retryError, setRetryError] = React.useState<string | null>(null);

  /**
   * Re-run the step that broke.
   *
   * Reports rather than navigates on failure: a retry the API refuses — because
   * the run has since moved on, or because the step is not retryable — is a real
   * answer, and silently landing on the run page would look like it worked.
   */
  const retryFromHere = React.useCallback(async (nodeId: string | null) => {
    setRetryError(null);
    if (!nodeId) {
      setRetryError(
        "This run has no step to resume from — it failed before any step ran. " +
        "Retry the whole run from the run page instead.",
      );
      return;
    }
    try {
      await api.runs.retryNode(runId, nodeId, { workspaceId });
      router.push(`/runs/${runId}`);
    } catch (error) {
      setRetryError(
        error instanceof Error ? error.message : "The step could not be retried.",
      );
    }
  }, [api, runId, workspaceId, router]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/runs/${runId}`}
            className={cn(
              "rounded-xs text-sm text-fg-link",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:focus-ring",
            )}
          >
            ← Back to run
          </Link>
          <span aria-hidden="true" className="text-fg-disabled">·</span>
          <Text variant="body" className="font-medium text-fg-max">Debug</Text>
          {/* Mono, middle-truncated, click-to-copy — the house rule for every id. */}
          <MonoId value={runId} />
        </div>
        <Text variant="caption" className="text-fg-muted">
          Why this run did what it did: where it failed, how long it was parked, and
          what each call sent and received.
        </Text>
      </header>

      {retryError ? (
        <div className="rounded-md border border-status-failed-border bg-status-failed-subtle px-3 py-2">
          <Text variant="body" className="text-status-failed">{retryError}</Text>
        </div>
      ) : null}

      <DebugTab
        runId={runId}
        /* The contextual action for an AUTH failure. Sends them where the
           credential is fixed, because "reconnect Salesforce" is only useful if
           it is one click from the sentence that says so. */
        onReconnect={() => router.push("/connections")}
        /*
         * ── THIS BUTTON USED TO GO NOWHERE ───────────────────────────────
         *
         * It pushed `/runs/{id}?action=retry`, and nothing in the application
         * reads `?action` — so the reported symptom was exact: the button
         * navigates and nothing happens. The endpoint it needed,
         * `POST /api/runs/:id/retry-node`, has existed all along.
         *
         * On success it goes to the run page, because the thing worth watching
         * after a retry is the run, not the trace of the attempt that failed.
         */
        onRetryFromHere={(nodeId) => void retryFromHere(nodeId)}
      />
    </div>
  );
}
