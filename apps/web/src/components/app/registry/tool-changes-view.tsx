"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldWarning, CheckCircle, XCircle, Clock } from "@phosphor-icons/react/dist/ssr";
import type { contracts } from "@vectorbea/shared";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation, useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   TOOL CHANGES — the review queue

   ── WHY THIS SCREEN EXISTS AT ALL ───────────────────────────────────────────
   `agents.allowedToolIds` grants a tool by uuid. If a spec re-import could
   rewrite what that uuid does, an agent granted `create_refund` — scoped by a
   bound maximum amount — could be regranted a wider version of it by somebody
   pasting a URL, and nothing in the product would have said so.

   A re-import therefore proposes rather than applies. This is the only place a
   proposal becomes live.

   ── GRANTED FIRST, AND VISIBLY SO ───────────────────────────────────────────
   A pending change to a tool nobody has granted is a chore. To one an agent
   currently holds it is a security review, and the two must not look alike:
   sorted apart, marked apart, counted separately in the header. A queue that
   mixes them puts the review below the chores on the second page, which is the
   same as not having the queue.
══════════════════════════════════════════════════════════════════════════════ */

export function ToolChangesView({ className }: { className?: string }) {
  const api = useApi();
  const scope = useScope();

  const pending = useApiQuery({
    queryKey: [...queryKeys.tools.all(scope), "pending-versions"],
    queryFn: () => api.toolVersions.pending(scope),
    freshness: "list",
  });

  if (pending.isPending) return <ReviewSkeleton className={className} />;

  if (pending.isError) {
    return (
      <div className={cn("border-subtle rounded-md border p-6", className)} role="alert">
        <Text variant="body-sm" className="text-fg-primary block font-medium">
          Could not load the review queue
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1 block">
          {pending.error.message} Nothing has been applied. Retry, or reload the page.
        </Text>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void pending.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const items = pending.data.items;

  if (items.length === 0) {
    return (
      <div className={cn("border-subtle rounded-md border border-dashed p-10 text-center", className)}>
        <Icon icon={CheckCircle} size="lg" decorative className="text-fg-muted mx-auto" />
        <Text variant="body" className="text-fg-primary mt-2 block font-medium">
          Nothing waiting for review
        </Text>
        <Text variant="body-sm" tone="secondary" className="mx-auto mt-1 block max-w-[52ch]">
          Re-importing an API document proposes changes here rather than editing tools in
          place, so a definition an agent is granted never changes without somebody deciding.
        </Text>
      </div>
    );
  }

  const granted = items.filter((i) => i.isGranted);
  const rest = items.filter((i) => !i.isGranted);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {granted.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Icon icon={ShieldWarning} size="sm" decorative className="text-status-degraded" />
            <Text variant="label" className="text-fg-max">
              {granted.length} change{granted.length === 1 ? "" : "s"} to a granted tool
            </Text>
          </div>
          <Text variant="body-sm" tone="secondary">
            An agent can call these right now. Applying one changes what that agent can do,
            without changing its grant.
          </Text>
          {granted.map((row) => <ReviewRow key={row.versionId} row={row} />)}
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section className="flex flex-col gap-3">
          <Text variant="label" className="text-fg-max">
            {rest.length} other change{rest.length === 1 ? "" : "s"}
          </Text>
          {rest.map((row) => <ReviewRow key={row.versionId} row={row} />)}
        </section>
      ) : null}
    </div>
  );
}

function ReviewRow({ row }: { row: contracts.PendingToolVersion }) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all(scope) });
  };

  const apply = useApiMutation({
    mutationFn: () => api.toolVersions.apply(row.versionId, scope),
    onSuccess: invalidate,
  });
  const reject = useApiMutation({
    mutationFn: () => api.toolVersions.reject(row.versionId, scope),
    onSuccess: invalidate,
  });

  const detail = useApiQuery({
    queryKey: [...queryKeys.tools.all(scope), "version", row.versionId],
    queryFn: () => api.toolVersions.get(row.versionId, scope),
    enabled: expanded,
    freshness: "detail",
  });

  const busy = apply.isPending || reject.isPending;
  const error = apply.error ?? reject.error;

  return (
    <article
      className={cn(
        "rounded-md border p-3",
        row.isGranted
          ? "border-status-degraded-border bg-status-degraded-subtle"
          : "border-subtle bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Text variant="body-sm" className="text-fg-max font-medium">{row.toolName}</Text>
            <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px] tabular-nums">
              v{row.version}
            </span>
            <span className="border-subtle text-fg-muted font-ui rounded-xs border px-1 text-[10px]">
              {row.source === "openapi_import" ? "OpenAPI import"
                : row.source === "postman_import" ? "Postman import" : row.source}
            </span>
            {row.isGranted ? (
              <span className="border-status-degraded-border text-status-degraded font-ui rounded-xs border px-1 text-[10px]">
                granted to an agent
              </span>
            ) : null}
          </div>
          {row.changeSummary ? (
            <Text variant="body-sm" tone="secondary" className="mt-1 block">{row.changeSummary}</Text>
          ) : null}
          <div className="mt-1.5 flex items-center gap-2">
            <Icon icon={Clock} size="xs" decorative className="text-fg-muted" />
            <Text variant="caption" tone="muted">
              {new Date(row.createdAt).toLocaleString()}
            </Text>
            <MonoId value={row.toolId} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide definition" : "See definition"}
          </Button>
          <Button
            variant="ghost" size="sm" iconLeft={<Icon icon={XCircle} size="sm" decorative />}
            disabled={busy} loading={reject.isPending}
            onClick={() => reject.mutate()}
          >
            Decline
          </Button>
          <Button
            variant="primary" size="sm" iconLeft={<Icon icon={CheckCircle} size="sm" decorative />}
            disabled={busy} loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            Apply
          </Button>
        </div>
      </div>

      {error ? (
        <Text variant="body-sm" className="text-status-failed mt-2 block">
          {error.message}
        </Text>
      ) : null}

      {apply.isSuccess ? (
        <Text variant="body-sm" className="text-status-succeeded mt-2 block">
          {apply.data.message}
        </Text>
      ) : null}
      {reject.isSuccess ? (
        <Text variant="body-sm" tone="secondary" className="mt-2 block">
          {reject.data.message}
        </Text>
      ) : null}

      {expanded ? (
        <div className="border-subtle mt-3 border-t pt-3">
          {detail.isPending ? (
            <Text variant="body-sm" tone="muted">Loading the proposed definition…</Text>
          ) : detail.isError ? (
            <Text variant="body-sm" className="text-status-failed">
              Could not load it: {detail.error.message}
            </Text>
          ) : (
            <ProposedDefinition version={detail.data} />
          )}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The proposed definition, rendered rather than dumped.
 *
 * The fields a reviewer decides on are the request, what the agent may supply,
 * and whether anything is bound. A raw JSON blob would technically contain all
 * of that and would be read by nobody.
 */
function ProposedDefinition({ version }: { version: contracts.ToolVersion }) {
  const spec = (version.httpSpec ?? {}) as Record<string, unknown>;
  const request = (spec.request ?? {}) as Record<string, unknown>;
  const inputs = Array.isArray(request.inputs)
    ? (request.inputs as Array<Record<string, unknown>>)
    : [];
  const auth = (spec.auth ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Text variant="caption" tone="muted">Sends</Text>
        <Text variant="body-sm" className="font-code text-fg-primary mt-0.5 block break-all">
          {String(request.method ?? "GET")} {String(request.baseUrl ?? "")}{String(request.path ?? "")}
        </Text>
      </div>

      <div>
        <Text variant="caption" tone="muted">Authenticates with</Text>
        <Text variant="body-sm" className="font-code text-fg-primary mt-0.5 block">
          {String(auth.strategy ?? "inherit")}
          {auth.header ? ` · ${String(auth.header)}` : ""}
          {auth.param ? ` · ?${String(auth.param)}` : ""}
        </Text>
      </div>

      {inputs.length > 0 ? (
        <div>
          <Text variant="caption" tone="muted">
            {inputs.length} input{inputs.length === 1 ? "" : "s"}
          </Text>
          <ul className="mt-1 flex flex-col gap-1">
            {inputs.map((input, index) => {
              const bound = input.constant !== undefined && input.constant !== null;
              return (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <code className="font-code text-mono-sm text-fg-primary">
                    {String(input.name ?? "")}
                  </code>
                  <Text variant="caption" tone="muted">→</Text>
                  <code className="font-code text-mono-sm text-fg-secondary">
                    {String(input.wireName ?? input.name ?? "")}
                  </code>
                  <span className="border-subtle text-fg-muted font-ui rounded-xs border px-1 text-[10px]">
                    {String(input.in ?? "")}
                  </span>
                  {input.required ? (
                    <Text variant="caption" tone="muted">required</Text>
                  ) : null}
                  {bound ? (
                    <span className="border-strong text-fg-secondary font-ui rounded-xs border px-1 text-[10px]">
                      bound to {String(input.constant)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-subtle bg-surface-raised rounded-md border p-3">
          <div className="bg-surface-sunken h-4 w-48 rounded-xs" />
          <div className="bg-surface-sunken mt-2 h-3 w-full max-w-md rounded-xs" />
          <div className="bg-surface-sunken mt-2 h-3 w-32 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

/* ── Entry points ─────────────────────────────────────────────────────────── */

/**
 * The button on the tools header, with its count.
 *
 * ── IT RENDERS NOTHING WHEN THERE IS NOTHING ────────────────────────────────
 * A permanently-present "Tool changes (0)" is a control people learn to skip,
 * and the one time it says 1 they skip it too. Appearing only when there is
 * something to decide is what keeps it worth reading.
 *
 * The count of GRANTED changes is what colours it. "Three changes waiting" and
 * "three changes to tools an agent can call right now" are different sentences,
 * and only the second should interrupt anybody.
 */
export function PendingChangesButton({ onOpen }: { onOpen: () => void }) {
  const api = useApi();
  const scope = useScope();

  const pending = useApiQuery({
    queryKey: [...queryKeys.tools.all(scope), "pending-versions"],
    queryFn: () => api.toolVersions.pending(scope),
    freshness: "list",
  });

  const total = pending.data?.total ?? 0;
  if (total === 0) return null;

  const granted = pending.data?.grantedCount ?? 0;

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onOpen}
      iconLeft={
        granted > 0
          ? <Icon icon={ShieldWarning} size="sm" decorative className="text-status-degraded" />
          : undefined
      }
      title={
        granted > 0
          ? `${granted} of ${total} change${total === 1 ? "" : "s"} affect a tool an agent is granted.`
          : `${total} tool change${total === 1 ? "" : "s"} waiting for review.`
      }
    >
      Tool changes
      <span className="border-subtle text-fg-secondary ml-1.5 rounded-xs border px-1 tabular-nums">
        {total}
      </span>
    </Button>
  );
}

/**
 * The review queue as a dialog over the registry.
 *
 * A dialog rather than a route because the decision is made WHILE looking at the
 * tools it changes — and because a route would need a place in the navigation
 * that is empty most of the time.
 */
export function ToolChangesDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg">
      <ModalHeader
        eyebrow="Build · Tools"
        title="Tool changes waiting for review"
        description="An API document that changed proposes new definitions rather than editing tools in place. Nothing here is live until it is applied."
      />
      <ModalBody>
        <ToolChangesView />
      </ModalBody>
      <ModalFooter hint="Declining keeps the tool exactly as it is, and the same change will not be proposed again for this document.">
        <Button variant="primary" onClick={() => onOpenChange(false)}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}
