"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { PROVIDER_IDS, type ProviderId } from "~/components/ui/provider-logo";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT THE CANVAS IS ALLOWED TO OFFER

   The builder used to read its agents, tools and connections from
   `~/mocks/fixtures` — seventeen invented agents and a generated tool list.
   Every dropdown in the inspector therefore offered things that do not exist,
   and picking one wrote a configuration no engine could run.

   Two separate problems hid behind that, and both are fixed here:

   1. THE LISTS WERE FICTIONAL. They now come from the same queries the registry
      screens use, through the SAME query keys — so opening the builder after
      creating a tool shows that tool, and creating one anywhere invalidates
      this too. Only what the workspace actually owns is offered.

   2. THE BINDINGS WERE UNRUNNABLE. `ToolNodeExecutor` resolves `config.toolId`
      as a UUID and fails the node outright without one; `AgentNodeExecutor`
      does the same with `config.agentId`. The inspector was writing
      `config.tool = "<display name>"` and `config.model = "<model name>"`,
      which those executors never read. A workflow built on this canvas could
      look complete and fail on its first run with "missing required config".
      Selections now write ids, and names are written alongside for display
      only.

   READING STAYS TOLERANT. Graphs saved before this exist and must keep opening,
   so a node is resolved by id first and by name second. Nothing rewrites a
   stored graph on load — an old node keeps working, and is upgraded the moment
   someone re-picks its tool.
══════════════════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 200;

export interface BuilderRegistry {
  agents: contracts.Agent[];
  tools: contracts.Tool[];
  connections: contracts.Connection[];
  loading: boolean;
  /** True when a list could not be loaded, so callers can say so rather than showing "none". */
  failed: boolean;
  byToolId: Map<string, contracts.Tool>;
  byAgentId: Map<string, contracts.Agent>;
  byConnectionId: Map<string, contracts.Connection>;
}

const EMPTY: BuilderRegistry = {
  agents: [], tools: [], connections: [],
  loading: false, failed: false,
  byToolId: new Map(), byAgentId: new Map(), byConnectionId: new Map(),
};

const RegistryContext = React.createContext<BuilderRegistry>(EMPTY);

/**
 * One set of queries for the whole builder.
 *
 * Deliberately a provider rather than a hook per consumer: the canvas decorates
 * every node from this, and the inspector reads it too. Separate subscriptions
 * would each re-render on their own cache event and, on the canvas, that means
 * every node object being rebuilt while one is being dragged.
 */
export function BuilderRegistryProvider({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const enabled = Boolean(workspaceId);
  const keyScope = { workspaceId, environmentId: null };
  const params = { workspaceId, environmentId: null, page: 1, pageSize: PAGE_SIZE };

  const agents = useApiQuery({
    queryKey: queryKeys.agents.list(keyScope, { page: 1, pageSize: PAGE_SIZE }),
    queryFn: () => api.agents.list(params),
    enabled,
  });
  const tools = useApiQuery({
    queryKey: queryKeys.tools.list(keyScope, { page: 1, pageSize: PAGE_SIZE }),
    queryFn: () => api.tools.list(params),
    enabled,
  });
  const connections = useApiQuery({
    queryKey: queryKeys.connections.list(keyScope, { page: 1, pageSize: PAGE_SIZE }),
    queryFn: () => api.connections.list(params),
    enabled,
  });

  const value = React.useMemo<BuilderRegistry>(() => {
    const agentItems = agents.data?.items ?? [];
    const toolItems = tools.data?.items ?? [];
    const connectionItems = connections.data?.items ?? [];
    return {
      agents: agentItems,
      tools: toolItems,
      connections: connectionItems,
      loading: enabled && (agents.isPending || tools.isPending || connections.isPending),
      failed: Boolean(agents.error ?? tools.error ?? connections.error),
      byToolId: new Map(toolItems.map((t) => [t.id, t])),
      byAgentId: new Map(agentItems.map((a) => [a.id, a])),
      byConnectionId: new Map(connectionItems.map((c) => [c.id, c])),
    };
  }, [
    agents.data, tools.data, connections.data,
    agents.isPending, tools.isPending, connections.isPending,
    agents.error, tools.error, connections.error,
    enabled,
  ]);

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

export function useBuilderRegistry(): BuilderRegistry {
  return React.useContext(RegistryContext);
}

/**
 * Whether a connection can be used, by the worker's rule.
 *
 * A passing test stores `connected`; `active` is the older value; a never-tested
 * connection is `not_tested` and the worker proceeds with it (see
 * `ConnectionResolver.resolve`). Checking for `active` alone made the canvas warn
 * "Connection 'Slack' is connected — 'Post to Slack' will fail here" about a
 * connection whose test had just passed.
 */
export function isUsableConnection(status: string | null | undefined): boolean {
  return status === "active" || status === "connected" || status === "ok" || status === "not_tested";
}

/* ── Resolution ─────────────────────────────────────────────────────────────
   Pure, and exported for tests. A node's binding is whatever the graph happens
   to carry, which after several generations of this builder is not one thing. */

/** The tool a node is bound to, by id where possible and by name otherwise. */
export function resolveTool(
  config: Record<string, unknown>,
  registry: Pick<BuilderRegistry, "tools" | "byToolId">,
): contracts.Tool | null {
  const id = typeof config.toolId === "string" ? config.toolId : null;
  if (id) {
    const hit = registry.byToolId.get(id);
    if (hit) return hit;
  }
  // Legacy graphs bound by display name. Matched case-insensitively because the
  // registry lets two tools differ only by case and the old writer did not.
  const name = typeof config.tool === "string" ? config.tool
    : typeof config.toolName === "string" ? config.toolName
      : null;
  if (!name) return null;
  const needle = name.toLowerCase();
  return registry.tools.find((t) => t.name.toLowerCase() === needle || t.slug === name) ?? null;
}

export function resolveAgent(
  config: Record<string, unknown>,
  registry: Pick<BuilderRegistry, "agents" | "byAgentId">,
): contracts.Agent | null {
  const id = typeof config.agentId === "string" ? config.agentId : null;
  if (id) {
    const hit = registry.byAgentId.get(id);
    if (hit) return hit;
  }
  const name = typeof config.agent === "string" ? config.agent
    : typeof config.agentName === "string" ? config.agentName
      : null;
  if (name) {
    const needle = name.toLowerCase();
    const byName = registry.agents.find((a) => a.name.toLowerCase() === needle || a.slug === name);
    if (byName) return byName;
  }
  // Older still: the node stored only a model name, and the inspector matched
  // the first agent using that model. Kept so those nodes still render.
  const model = typeof config.model === "string" ? config.model : null;
  if (!model) return null;
  return registry.agents.find((a) => a.modelName === model) ?? null;
}

export function resolveConnection(
  config: Record<string, unknown>,
  registry: Pick<BuilderRegistry, "connections" | "byConnectionId">,
): contracts.Connection | null {
  const id = typeof config.connectionId === "string" ? config.connectionId : null;
  if (id) {
    const hit = registry.byConnectionId.get(id);
    if (hit) return hit;
  }
  const name = typeof config.connection === "string" ? config.connection : null;
  if (!name) return null;
  const needle = name.toLowerCase();
  return registry.connections.find((c) => c.name.toLowerCase() === needle) ?? null;
}

/* ── Node decoration ────────────────────────────────────────────────────────
   What the canvas draws under a node's title. */

/**
 * The only part of a node this file needs.
 *
 * Declared structurally rather than imported from the fixture module: the node
 * type still lives under `~/mocks`, and depending on it here would make a file
 * whose entire purpose is replacing fixtures import one.
 */
export interface BindableNode {
  kind: string;
  config: Record<string, unknown>;
}

export interface BoundResource {
  label: string;
  provider: ProviderId | null;
  connected: boolean;
  detail: string | null;
  /** True when the node names something the workspace does not have. */
  missing: boolean;
}

/**
 * A stable, string-only summary of what a node is bound to.
 *
 * Returns `null` rather than an object when a node binds nothing, so the
 * canvas's memo comparator can treat "unbound" as one identity.
 */
export function boundResourceFor(
  node: BindableNode,
  registry: BuilderRegistry,
): BoundResource | null {
  const config = node.config;

  if (node.kind === "tool") {
    const tool = resolveTool(config, registry);
    const connection = resolveConnection(config, registry)
      ?? (tool?.connectionId ? registry.byConnectionId.get(tool.connectionId) ?? null : null);
    if (tool) {
      return {
        label: tool.name,
        provider: providerOf(connection, tool.type),
        connected: connection ? isUsableConnection(connection.status) : false,
        detail: connection?.name ?? `${tool.riskLevel} risk`,
        missing: false,
      };
    }
    const named = firstString(config.tool, config.toolName, config.toolId);
    if (!named) return null;
    // Naming something the workspace does not have is a configuration error the
    // canvas should show, not hide behind an empty subtitle.
    return {
      label: named,
      provider: null,
      connected: false,
      detail: registry.loading ? null : "Not in this workspace",
      missing: !registry.loading,
    };
  }

  if (node.kind === "agent" || node.kind === "llm") {
    const agent = resolveAgent(config, registry);
    if (agent) {
      const connection = agent.llmConnectionId
        ? registry.byConnectionId.get(agent.llmConnectionId) ?? null
        : null;
      return {
        label: agent.name,
        provider: providerOf(connection, agent.type),
        connected: connection ? isUsableConnection(connection.status) : false,
        detail: agent.modelName ?? null,
        missing: false,
      };
    }
    const named = firstString(config.agent, config.agentName, config.model, config.modelName);
    if (!named) return null;
    // An `llm` node may legitimately name a model without naming an agent, so
    // this is only an error when the node claims an agent.
    const claimsAgent = Boolean(firstString(config.agentId, config.agent, config.agentName));
    return {
      label: named,
      provider: null,
      connected: false,
      detail: claimsAgent && !registry.loading ? "Not in this workspace" : null,
      missing: claimsAgent && !registry.loading,
    };
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value) return value;
  return null;
}

/**
 * The brand mark to draw, from the connection's provider or the node's type.
 *
 * A provider string comes from the API and is open-ended; the logo set is not.
 * Anything without a mark returns null and the node draws its label alone,
 * which is the honest outcome — inventing a logo for an unknown provider is
 * worse than showing none.
 */
const PROVIDER_ALIASES: Record<string, ProviderId> = {
  postgresql: "postgres",
  pgsql: "postgres",
  neon: "postgres",
  supabase: "postgres",
  timescale: "postgres",
  timescaledb: "postgres",
  cockroach: "postgres",
  cockroachdb: "postgres",
  redshift: "postgres",
  mariadb: "mysql",
  planetscale: "mysql",
  claude: "anthropic",
  "google-gemini": "gemini",
  googlesheets: "google-sheets",
  rest: "http",
  api: "http",
};

const KNOWN_PROVIDERS = new Set<string>(PROVIDER_IDS);

function providerOf(connection: contracts.Connection | null, fallback: string): ProviderId | null {
  for (const candidate of [connection?.provider, connection?.type, fallback]) {
    if (typeof candidate !== "string" || !candidate) continue;
    const key = candidate.toLowerCase();
    if (KNOWN_PROVIDERS.has(key)) return key as ProviderId;
    const alias = PROVIDER_ALIASES[key];
    if (alias) return alias;
  }
  return null;
}
