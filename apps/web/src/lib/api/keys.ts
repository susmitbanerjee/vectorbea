/**
 * Query key factory.
 *
 * Hierarchical and workspace-scoped, so that scope changes are ONE
 * invalidation instead of a list of them:
 *
 *   ["ws", wsId]                                → everything in a workspace
 *   ["ws", wsId, "env", envId]                  → everything in an environment
 *   ["ws", wsId, "env", envId, "runs"]          → every run query
 *   ["ws", wsId, "env", envId, "runs", "list", filters]
 *
 * TanStack matches keys by prefix, so `invalidateQueries({ queryKey: keys.env(ws, env) })`
 * takes out every query below it. That is the whole reason the workspace and
 * environment sit at the FRONT of the key rather than inside a filters object:
 * an environment switch has to be able to invalidate everything it scopes
 * without enumerating the entities that exist today.
 *
 * Keys are `as const` so TypeScript keeps the tuple shapes and a typo in a
 * segment is a compile error rather than a cache miss nobody notices.
 */

export type ScopeIds = {
  workspaceId: string | null;
  environmentId: string | null;
};

/** Filters are serialised into the key, so two filter sets are two cache entries. */
export type QueryFilters = Record<string, unknown> | undefined;

export const queryKeys = {
  /** Root. Invalidate to drop literally everything. */
  all: () => ["ws"] as const,

  workspace: (workspaceId: string | null) => ["ws", workspaceId] as const,

  env: (workspaceId: string | null, environmentId: string | null) =>
    ["ws", workspaceId, "env", environmentId] as const,

  /** Identity is not workspace-scoped — it is what resolves the workspace list. */
  session: () => ["session"] as const,
  me: () => ["session", "me"] as const,
  workspaceList: () => ["session", "workspaces"] as const,

  runs: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "runs"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.runs.all(s), "list", filters ?? {}] as const,
    detail: (s: ScopeIds, runId: string) => [...queryKeys.runs.all(s), "detail", runId] as const,
    events: (s: ScopeIds, runId: string) => [...queryKeys.runs.all(s), "events", runId] as const,
  },

  workflows: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "workflows"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.workflows.all(s), "list", filters ?? {}] as const,
    detail: (s: ScopeIds, id: string) => [...queryKeys.workflows.all(s), "detail", id] as const,
    versions: (s: ScopeIds, id: string) => [...queryKeys.workflows.all(s), "versions", id] as const,
  },

  agents: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "agents"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.agents.all(s), "list", filters ?? {}] as const,
    detail: (s: ScopeIds, id: string) => [...queryKeys.agents.all(s), "detail", id] as const,
  },

  tools: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "tools"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.tools.all(s), "list", filters ?? {}] as const,
    detail: (s: ScopeIds, id: string) => [...queryKeys.tools.all(s), "detail", id] as const,
  },

  connections: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "connections"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.connections.all(s), "list", filters ?? {}] as const,
    detail: (s: ScopeIds, id: string) => [...queryKeys.connections.all(s), "detail", id] as const,
  },

  approvals: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "approvals"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.approvals.all(s), "list", filters ?? {}] as const,
  },

  incidents: {
    all: (s: ScopeIds) => [...queryKeys.env(s.workspaceId, s.environmentId), "incidents"] as const,
    list: (s: ScopeIds, filters?: QueryFilters) =>
      [...queryKeys.incidents.all(s), "list", filters ?? {}] as const,
  },

  dashboard: {
    summary: (s: ScopeIds) =>
      [...queryKeys.env(s.workspaceId, s.environmentId), "dashboard", "summary"] as const,
  },
} as const;

/**
 * Staleness policy, by entity.
 *
 * Lists tolerate 30s of staleness — they are scanned, not trusted to the
 * second. Run detail is 0: someone watching a run needs the current state, and
 * a cached "running" for a run that finished is actively misleading.
 */
export const STALE_TIME = {
  list: 30_000,
  detail: 30_000,
  /** Anything live. Always refetch on mount. */
  live: 0,
} as const;
