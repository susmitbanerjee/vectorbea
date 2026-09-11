"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  MagnifyingGlass, WarningCircle, CloudSlash, CaretRight,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";
import { MonoId } from "~/components/ui/mono-id";
import { ProviderLogo } from "~/components/ui/provider-logo";
import { Section } from "~/components/app/registry/detail-sheet";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useEntitlements, upgradeReason, ENTITLEMENT } from "~/lib/entitlements/use-entitlements";
import type { McpToolRow, Scope } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT THIS SERVER OFFERS

   The one MCP-specific surface in the product, and it is a tab on a CONNECTION
   rather than a section of its own. MCP is a tool type, not a subsystem
   (MCP.md §2) — the schema makes a server-level grant inexpressible, and an IA
   that gave MCP its own area would teach the opposite: that these are a
   different kind of tool, with their own rules, plausibly granted a server at a
   time. The surfaces have to say what the runtime says.

   TWO FACTS AT ONCE, ALWAYS. A stale manifest still lists tools. The banner
   goes ABOVE the table and never replaces it, because serving stale rather than
   empty is a deliberate decision one layer down (MCP.md §6) and a UI that
   swapped the list for an error would undo it at the last inch. Same shape as
   `delivery_status` beside a run status: the run succeeded AND the delivery
   failed, and you need both sentences.

   A WITHDRAWN TOOL KEEPS ITS ROW. It is dimmed, not hidden, and it says what is
   true: the server stopped advertising it, the grants are unchanged, and calls
   now fail with a legible cause. Hiding it — or calling it "deleted" — would
   restore exactly the ambiguity the write path pays to remove.
══════════════════════════════════════════════════════════════════════════════ */

export function McpToolsPanel({
  connectionId, connectionName, scope,
}: {
  connectionId: string;
  connectionName: string;
  scope: Scope;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const entitlements = useEntitlements();
  const [discovering, setDiscovering] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  /* `Scope` allows undefined ids (a caller that has not resolved one yet);
     `ScopeIds` does not, because a cache key with `undefined` in it is a
     different key from one with `null` and the two would never hit. */
  const keyScope = {
    workspaceId: scope.workspaceId ?? null,
    environmentId: scope.environmentId ?? null,
  };

  const query = useApiQuery({
    queryKey: [...queryKeys.connections.all(keyScope), "mcp-tools", connectionId] as const,
    queryFn: () => api.connections.mcpTools(connectionId, scope),
    enabled: Boolean(connectionId),
  });

  const allowed = entitlements.has(ENTITLEMENT.MCP_TOOLS);

  async function discover() {
    setDiscovering(true);
    try {
      const outcome = await api.connections.mcpDiscover(connectionId, scope);
      /* The verb on the button is the verb in the toast. */
      toast.success(
        outcome.toolsWritten === 0
          ? `Discovered nothing — ${connectionName} advertises no tools.`
          : `Discovered ${outcome.toolsWritten} tool${outcome.toolsWritten === 1 ? "" : "s"} from ${connectionName}.`,
      );
      await query.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all(keyScope) });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The server could not be asked for its tools.",
      );
    } finally {
      setDiscovering(false);
    }
  }

  const discoverButton = (
    <Button
      size="xs"
      variant="secondary"
      loading={discovering}
      loadingLabel="Discovering"
      disabled={!allowed}
      onClick={() => void discover()}
      iconLeft={<Icon icon={MagnifyingGlass} size="sm" decorative />}
    >
      {query.data?.items.length ? "Rediscover" : "Discover"}
    </Button>
  );

  /*
   * The gate names the plan the workspace is actually on and the one that would
   * grant this, from the API's own catalogue — never a hardcoded "Pro", which
   * goes stale the first time the plans are renamed.
   *
   * Resolved from the WORKSPACE'S billing account, not the signed-in person's
   * plan: a Pro member acting inside a Free workspace gets Free limits, at every
   * enforcement point including this one.
   */
  const action = allowed ? discoverButton : (
    <Tooltip content={`${upgradeReason(entitlements, ENTITLEMENT.MCP_TOOLS)} Upgrade to connect your own servers.`}>
      {/* A disabled button is not a tooltip trigger in every browser, so the
          wrapper carries the hover and the button stays genuinely disabled. */}
      <span className="inline-flex">{discoverButton}</span>
    </Tooltip>
  );

  // ── Loading: the shape of the table, not a spinner ─────────────────────────
  if (query.isPending) {
    return (
      <Section title="Tools" help="What this server advertises." action={action}>
        <ul className="grid gap-2" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <li key={row} className="flex items-center gap-3">
              <span className="bg-surface-sunken h-3.5 w-40 shrink-0 rounded-xs" />
              <span className="bg-surface-sunken h-3.5 w-28 shrink-0 rounded-xs" />
              <span className="bg-surface-sunken h-3.5 min-w-0 flex-1 rounded-xs" />
              <span className="bg-surface-sunken h-3.5 w-16 shrink-0 rounded-xs" />
            </li>
          ))}
        </ul>
        <Text variant="caption" tone="muted" className="sr-only">Loading this server&rsquo;s tools</Text>
      </Section>
    );
  }

  // ── Error: OUR API failed, which is not the server failing ─────────────────
  if (query.error) {
    const denied = /403|forbidden|permission/i.test(query.error.message);
    return (
      <Section
        title="Tools"
        tone={denied ? "warning" : "error"}
        help={denied
          ? "You need connection write access to discover tools. Ask a workspace admin."
          : "This is Vectorbea failing to answer, not the MCP server refusing."}
        action={denied ? undefined : (
          <Button size="xs" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
        )}
      >
        <Text variant="body-sm" tone="secondary" className="block">
          {denied ? "The tools this server advertises are not visible to your role."
            : `Could not load this server's tools. ${query.error.message}`}
        </Text>
      </Section>
    );
  }

  const items = query.data?.items ?? [];
  const manifest = query.data?.manifest ?? null;
  const live = items.filter((tool) => !tool.possiblyWithdrawn).length;

  return (
    <>
      <Section
        title={`${items.length} tool${items.length === 1 ? "" : "s"}`}
        help={manifest
          ? `Discovered ${relativeWord(manifest.fetchedAt)}.${items.length !== live ? ` ${items.length - live} no longer advertised.` : ""}`
          : "This server has never been discovered."}
        action={action}
      >
        {/* PARTIAL: the banner sits above the list and never replaces it. */}
        {manifest?.stale && manifest.lastError ? (
          <div className="border-status-waiting-border bg-status-waiting-subtle mb-3 flex items-start gap-2 rounded-sm border p-2.5">
            <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px shrink-0" />
            <Text variant="body-sm" tone="secondary" className="min-w-0 leading-snug">
              Last refresh failed{manifest.lastErrorAt ? <> <RelativeTime iso={manifest.lastErrorAt} /></> : null}:{" "}
              {manifest.lastError}. Showing the tools from the last successful discovery — calls to
              them will fail until the server answers.
            </Text>
          </div>
        ) : null}

        {items.length === 0 ? (
          <Text variant="body-sm" tone="secondary" className="block">
            No tools discovered yet. Discovering asks the server what it offers and registers each
            one as a tool you can grant to an agent.
          </Text>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse">
              <caption className="sr-only">Tools advertised by {connectionName}</caption>
              <thead>
                <tr className="border-subtle border-b">
                  <Th>Tool</Th>
                  <Th>Remote name</Th>
                  <Th>Description</Th>
                  <Th align="right">Granted to</Th>
                  <Th>Last seen</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((tool) => (
                  <ToolRow
                    key={tool.toolId}
                    tool={tool}
                    expanded={expanded === tool.toolId}
                    onToggle={() =>
                      setExpanded((current) => (current === tool.toolId ? null : tool.toolId))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Granting"
        help="Enforced by the engine. An ungranted tool cannot be called, whatever any description says."
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Every tool above is granted to an agent individually, from that agent&rsquo;s Grants tab.
          There is no way to grant a whole server — a grant list holds tool ids, and no field
          anywhere means &ldquo;everything from here&rdquo;. Removing this connection is the one
          server-level action, and it revokes all of them at once.
        </Text>
      </Section>

      {manifest && manifest.resourceCount > 0 ? (
        <Section title="Resources" help="Read-only context an agent pulls on demand.">
          <Text variant="body-sm" tone="secondary" className="block">
            This server also offers{" "}
            <span className="tabular-nums">{manifest.resourceCount}</span>{" "}
            resource{manifest.resourceCount === 1 ? "" : "s"}. They are reached by passing a
            resource URI to one of its tools, and are not granted separately.
          </Text>
        </Section>
      ) : null}
    </>
  );
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

function ToolRow({
  tool, expanded, onToggle,
}: {
  tool: McpToolRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const altered = (tool.description ?? "").includes("[removed]");
  const grantCount = tool.grantedToAgentIds.length;

  return (
    <>
      <tr
        className={cn(
          "border-subtle border-b last:border-b-0",
          tool.possiblyWithdrawn && "opacity-60",
        )}
      >
        <td className="py-1.5 pr-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={cn(
              "group flex min-w-0 items-center gap-1.5 rounded-xs text-left",
              "outline-none focus-visible:focus-ring",
            )}
          >
            <Icon
              icon={CaretRight}
              size="sm"
              decorative
              className={cn(
                "text-fg-muted shrink-0",
                /* Transform only, and it sits still for anyone who asked for
                   reduced motion. */
                "transition-transform duration-fast ease-standard motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
            {/*
              The vendor's mark, resolved from the server name and the remote
              tool name. This is the row saying WHAT was found rather than only
              that something was — "Vectorbea discovered ServiceNow" instead of
              four strings beginning `mcp-1a2b3c4d.`. An unrecognised vendor
              gets a monogram, never a hole.
            */}
            <ProviderLogo
              provider={vendorHint(tool)}
              fallbackLabel={tool.serverName ?? tool.mcpToolName ?? tool.name}
              size={14}
              decorative
              className="shrink-0"
            />
            <Text variant="mono-sm" tone="primary" className="truncate group-hover:text-fg-primary">
              {tool.name}
            </Text>
          </button>
        </td>
        <td className="py-1.5 pr-3">
          <Text variant="mono-sm" tone="secondary" className="truncate">
            {tool.mcpToolName ?? "—"}
          </Text>
        </td>
        <td className="min-w-0 py-1.5 pr-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <Text variant="caption" tone="secondary" className="min-w-0 truncate">
              {tool.description ?? "No description."}
            </Text>
            {altered ? (
              <Tooltip content="Part of this description looked like an instruction to the model and was replaced. The tool still works, and this does not affect what it is allowed to do.">
                <span className="shrink-0">
                  <Icon icon={WarningCircle} size="sm" className="text-status-waiting" label="Description altered" />
                </span>
              </Tooltip>
            ) : null}
          </span>
        </td>
        <td className="py-1.5 pr-3 text-right">
          <Text variant="caption" tone={grantCount > 0 ? "secondary" : "muted"} tabular>
            {grantCount === 0 ? "Not granted" : `${grantCount} agent${grantCount === 1 ? "" : "s"}`}
          </Text>
        </td>
        <td className="py-1.5 pr-3">
          <Text variant="caption" tone="muted">
            {tool.lastSeenAt ? <RelativeTime iso={tool.lastSeenAt} /> : "Never"}
          </Text>
        </td>
        <td className="py-1.5">
          {tool.possiblyWithdrawn ? (
            <span className="text-fg-muted flex items-center gap-1">
              <Icon icon={CloudSlash} size="sm" decorative />
              <Text variant="caption" tone="muted">Not advertised</Text>
            </span>
          ) : (
            /* A status token, never brand iris. Iris means Vectorbea; green
               here would mean "our brand says this is fine", which is a
               different claim from "the server still lists it". */
            <Text variant="caption" className="text-status-live">Live</Text>
          )}
        </td>
      </tr>

      {expanded ? (
        <tr className="border-subtle border-b last:border-b-0">
          <td colSpan={6} className="pb-3 pt-0.5">
            <div className="bg-surface-sunken grid gap-2 rounded-sm p-2.5">
              <span className="flex items-center gap-2">
                <Text variant="caption" tone="muted" className="w-20 shrink-0">Tool id</Text>
                <MonoId value={tool.toolId} srLabel="Tool id" />
              </span>

              {tool.description ? (
                <span className="flex items-start gap-2">
                  <Text variant="caption" tone="muted" className="w-20 shrink-0">Description</Text>
                  {/* The stored text, `[removed]` markers and all. The
                      sanitizer writes a marker instead of deleting precisely so
                      a reviewer can see something was there — hiding it here
                      would make that choice pointless. */}
                  <Text variant="body-sm" tone="secondary" className="min-w-0 leading-snug">
                    {tool.description}
                  </Text>
                </span>
              ) : null}

              {tool.possiblyWithdrawn ? (
                <Text variant="body-sm" tone="secondary" className="leading-snug">
                  The server stopped advertising this tool
                  {tool.lastSeenAt ? <> around <RelativeTime iso={tool.lastSeenAt} /></> : null}. Its
                  grants are unchanged — {grantCount === 0
                    ? "no agent holds one"
                    : `${grantCount} agent${grantCount === 1 ? "" : "s"} may still call it`}
                  , and those calls now fail with &ldquo;the server no longer advertises this
                  tool&rdquo;. Revoke the grants, or ask whoever runs the server.
                </Text>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The best guess at which vendor a discovered tool belongs to.
 *
 * Three sources, most specific first. The SERVER name is the strongest signal —
 * somebody who calls their connection "Acme ServiceNow" has told us — and the
 * remote tool name is the fallback for a server named after the team that runs
 * it rather than the product it fronts (`platform-tools` advertising
 * `grafana_query`). The namespaced local name is last because it leads with
 * `mcp-<uuid8>.` and matches nothing.
 *
 * Wrong guesses are cheap here: the tool is named correctly beside the mark, so
 * the worst case is an unhelpful picture, not a misleading row.
 */
function vendorHint(tool: McpToolRow): string {
  return [tool.serverName, tool.mcpToolName, tool.name]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn("pb-1.5 pr-3 font-normal", align === "right" ? "text-right" : "text-left")}
    >
      <Text variant="caption" tone="muted">{children}</Text>
    </th>
  );
}

/** "4 minutes ago" without pulling a whole formatter in for one string. */
function relativeWord(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return "at an unknown time";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
