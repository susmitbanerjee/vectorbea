import { z } from "zod";
import { isoDateTime, jsonObject, page, uuid } from "./primitives";

/**
 * Workflows, agents, tools, connections.
 *
 * Transcribed from `routes/{WorkflowRoutes,AgentRoutes,ToolRoutes,ConnectionRoutes}.kt`.
 */

export const lifecycleStatus = z.enum(["active", "paused", "draft", "archived"]);
export const riskLevel = z.enum(["low", "medium", "high", "critical"]);

/* ── Agents ───────────────────────────────────────────────────────────────── */

export const agent = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  name: z.string(),
  slug: z.string(),
  type: z.string(),
  role: z.string().nullable(),
  instructions: z.string().nullable(),
  llmConnectionId: uuid.nullable(),
  modelName: z.string().nullable(),
  temperature: z.number().nullable(),
  maxTokens: z.number().nullable(),
  maxIterations: z.number().nullable(),
  memoryPolicy: jsonObject,
  retryPolicy: jsonObject,
  timeoutPolicy: jsonObject,
  approvalPolicy: jsonObject,
  allowedToolIds: z.array(z.string()),
  outputSchema: jsonObject,
  status: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Agent = z.infer<typeof agent>;
export const agentPage = page(agent);

/* ── Tools ────────────────────────────────────────────────────────────────── */

export const tool = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  name: z.string(),
  slug: z.string(),
  type: z.string(),
  description: z.string().nullable(),
  connectionId: uuid.nullable(),
  inputSchema: jsonObject,
  outputSchema: jsonObject,
  config: jsonObject,
  riskLevel: z.string(),
  requiresApproval: z.boolean(),
  timeoutMs: z.number().nullable(),
  retryPolicy: jsonObject,
  idempotencyStrategy: z.string().nullable(),
  status: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Tool = z.infer<typeof tool>;
export const toolPage = page(tool);

/* ── Workflows ────────────────────────────────────────────────────────────── */

/**
 * The fields the UI's fixture type adds and the API does NOT return —
 * `successRate30d`, `spend30dUsd`, `last30`, `owner`, `tags`, `connectionNames`,
 * `avgDurationMs` — are absent here rather than optional. A screen that needs
 * them has to confront the gap instead of rendering `undefined`. See API-GAPS.md.
 *
 * `stepCount`/`agentCount`/`toolCount` ARE returned, but only on the detail
 * endpoint, where `graphJson` is loaded. On the list they are hard-coded to 0
 * (`Triple(0, 0, 0)`), which is a zero that means "not computed" — exactly the
 * kind of number a UI must not present as real.
 */
export const workflow = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  name: z.string(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  currentVersionId: uuid.nullable(),
  stepCount: z.number(),
  agentCount: z.number(),
  toolCount: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Workflow = z.infer<typeof workflow>;
export const workflowPage = page(workflow);

export const workflowVersion = z.object({
  id: uuid,
  workflowId: uuid,
  version: z.number(),
  graph: jsonObject,
  inputSchema: jsonObject,
  outputSchema: jsonObject,
  triggerConfig: jsonObject,
  retryPolicy: jsonObject,
  timeoutPolicy: jsonObject,
  budgetPolicy: jsonObject,
  replaySupport: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type WorkflowVersion = z.infer<typeof workflowVersion>;

/* ── Connections ──────────────────────────────────────────────────────────── */

/**
 * Note `secretConfigured: boolean` rather than a secret reference — the route
 * deliberately never exposes the ref. Any UI that wants to show "credential
 * set" reads this and nothing else.
 *
 * What is NOT here: blast radius. The UI's `BlastRadius` fixture
 * (`~/mocks/connectivity`) counts the workflows, tools and runs a broken
 * connection blocks, and no endpoint computes it. See API-GAPS.md.
 */
export const connection = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  name: z.string(),
  slug: z.string(),
  type: z.string(),
  provider: z.string(),
  status: z.string(),
  networkStatus: z.string(),
  authType: z.string(),
  secretConfigured: z.boolean(),
  config: jsonObject,
  allowedHosts: z.array(z.string()),
  allowedPaths: z.array(z.string()),
  allowedSchemas: z.array(z.string()),
  allowedTables: z.array(z.string()),
  lastTestedAt: isoDateTime.nullable(),
  lastTestStatus: z.string().nullable(),
  lastTestLatencyMs: z.number().nullable(),
  lastTestErrorCode: z.string().nullable(),
  lastTestErrorMessageSanitized: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Connection = z.infer<typeof connection>;
export const connectionPage = page(connection);

/* ── Identity and roles ───────────────────────────────────────────────────── */

/**
 * Workspace roles, matching the database CHECK constraint in
 * `V006__auth_schema_complete.sql`: `role IN ('owner','admin','developer','viewer')`.
 *
 * `editor` is accepted as a legacy alias because invitation rows written before
 * the role reconciliation carry it, and it is not a valid database value. It
 * normalises to `developer`. See `normalizeWorkspaceRole`.
 */
export const workspaceRole = z.enum(["owner", "admin", "developer", "viewer"]);
export type WorkspaceRole = z.infer<typeof workspaceRole>;

/** Highest privilege last. The only ordering in the product. */
export const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

export function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
  if (role === "owner" || role === "admin" || role === "developer" || role === "viewer") {
    return role;
  }
  if (role === "editor") return "developer";
  return "viewer";
}

export function roleAtLeast(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

/**
 * `GET /api/me` — the SINGLE SOURCE OF TRUTH for who the caller is and what
 * they may do, in every workspace they belong to.
 *
 * Role is per membership, not global, which is why nothing may cache "the
 * user's role" without also naming the workspace it belongs to. Deriving it
 * anywhere else is what produced "Your role: Viewer" beside a row saying Owner.
 *
 * The role field is passed through `normalizeWorkspaceRole` on parse so a
 * legacy `editor` row cannot fail validation.
 */
export const meMembership = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string().nullable(),
  role: z.unknown().transform(normalizeWorkspaceRole),
});
export type MeMembership = z.infer<typeof meMembership>;

export const me = z.object({
  user: z.object({
    id: uuid,
    supabaseUserId: z.string().nullable(),
    email: z.string().nullable(),
  }),
  workspaces: z.array(meMembership),
  defaultWorkspaceId: uuid.nullable(),
});
export type Me = z.infer<typeof me>;
