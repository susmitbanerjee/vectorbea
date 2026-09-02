"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MonoId } from "~/components/ui/mono-id";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
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

      <DebugTab
        runId={runId}
        /* The contextual action for an AUTH failure. Sends them where the
           credential is fixed, because "reconnect Salesforce" is only useful if
           it is one click from the sentence that says so. */
        onReconnect={() => router.push("/connections")}
        onRetryFromHere={() => router.push(`/runs/${runId}?action=retry`)}
      />
    </div>
  );
}
