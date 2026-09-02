"use client";

import * as React from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { useApi } from "~/lib/api/api-provider";
import { createFailuresApi, type FailureRollup, type FailureWindow } from "~/lib/api/failures";
import { useScope } from "~/lib/workspace/workspace-provider";
import { cn } from "~/lib/cn";
import { FailuresView } from "./failures-view";

/**
 * The data half of the failures page.
 *
 * Split from the view so the view is a pure function of a roll-up — which is
 * what lets the stories render the cases that matter (an undermined workspace, a
 * single recurring credential, an empty window) without a server.
 */

/** True when a rejection is this component cancelling its own request. */
function isAborted(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  return typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted";
}

const WINDOW_PARAM = "window";
const IS_WINDOW = (v: string | null): v is FailureWindow =>
  v === "24h" || v === "7d" || v === "30d" || v === "90d";

export function FailuresPage() {
  const client = useApi();
  const { workspaceId } = useScope();
  const api = React.useMemo(
    () => createFailuresApi(client.transport, workspaceId),
    [client, workspaceId],
  );

  /*
   * The window lives in the URL.
   *
   * Same reason the Debug tab's selection does: this page is read and then sent
   * — "the AUTH spike is in the last 24 hours, look" — and a link that opens on
   * a different window is a link that does not carry the finding.
   */
  const [win, setWin] = React.useState<FailureWindow>(() => {
    if (typeof globalThis.location === "undefined") return "7d";
    const q = new URLSearchParams(globalThis.location.search).get(WINDOW_PARAM);
    return IS_WINDOW(q) ? q : "7d";
  });

  const [data, setData] = React.useState<FailureRollup | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const onWindow = React.useCallback((w: FailureWindow) => {
    setWin(w);
    if (typeof globalThis.history === "undefined") return;
    const url = new URL(globalThis.location.href);
    url.searchParams.set(WINDOW_PARAM, w);
    globalThis.history.replaceState(null, "", url);
  }, []);

  React.useEffect(() => {
    if (!workspaceId) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    api.rollup(workspaceId, win, ac.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (isAborted(e)) return;
        setError(e instanceof Error ? e.message : "Could not load the failures roll-up.");
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [api, workspaceId, win]);

  if (!workspaceId) {
    return <Notice title="No workspace selected" body="Pick a workspace to see its failures." />;
  }

  if (error) {
    return (
      <Notice
        title="The failures roll-up could not be loaded"
        body={error}
        onRetry={() => setWin((w) => w)}
      />
    );
  }

  /* First load only. A window change keeps the previous window on screen and
     dims it, because replacing a page of numbers with a skeleton loses the
     comparison the reader changed the window to make. */
  if (loading && !data) return <RollupSkeleton />;
  if (!data) return null;

  return <FailuresView data={data} window={win} onWindow={onWindow} refreshing={loading} />;
}

function Notice({
  title, body, onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div className="border-status-failed-border bg-status-failed-subtle flex gap-3 rounded-md border p-4">
      <Icon icon={WarningCircle} size="sm" className="text-status-failed mt-0.5 shrink-0" decorative />
      <div>
        <Text variant="body-sm" tone="max" className="block font-medium">{title}</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1 block">{body}</Text>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "text-fg-link rounded-xs mt-2 block px-1 text-sm",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:focus-ring",
            )}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Skeleton in the shape of the content: a header, three owner cards, a table. */
function RollupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading failures">
      <div className="bg-surface-sunken h-8 w-40 animate-pulse rounded-md motion-reduce:animate-none" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border-subtle bg-surface-raised h-32 animate-pulse rounded-lg border motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="border-subtle bg-surface-raised mt-8 h-64 animate-pulse rounded-lg border motion-reduce:animate-none" />
    </div>
  );
}
