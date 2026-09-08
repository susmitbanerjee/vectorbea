import { z } from "zod";
import { isoDateTime, jsonObject, maybe, page, uuid } from "./primitives";

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
  role: z.string().nullish(),
  instructions: z.string().nullish(),
  llmConnectionId: uuid.nullish(),
  modelName: z.string().nullish(),
  temperature: z.number().nullish(),
  maxTokens: z.number().nullish(),
  maxIterations: z.number().nullish(),
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
  description: z.string().nullish(),
  connectionId: uuid.nullish(),
  inputSchema: jsonObject,
  outputSchema: jsonObject,
  config: jsonObject,
  riskLevel: z.string(),
  requiresApproval: z.boolean(),
  timeoutMs: z.number().nullish(),
  retryPolicy: jsonObject,
  idempotencyStrategy: z.string().nullish(),
  status: z.string(),
  /**
   * The whole HTTP call this tool makes, when it has one (V064).
   *
   * `jsonObject` and not a mirrored Zod schema, deliberately. The shape is owned
   * by `HttpToolSpec.kt`, which the API and the worker BOTH compile precisely so
   * there is one reader; a third definition here would be a third opinion, and
   * the failure mode of the third opinion is a form that saves a document the
   * runtime silently ignores. The editor reads and writes it through the narrow
   * accessors in `http-spec.ts`, which is where the shape knowledge lives on
   * this side.
   *
   * Null means the tool uses the legacy `config` keys and behaves as it always
   * did — which is most tools, and is the whole migration story.
   */
  httpSpec: jsonObject.nullish(),
  /** What the model is shown of the result (V056). Null means the whole thing. */
  resultContract: jsonObject.nullish(),
  /** Which `tool_versions.version` is live. */
  currentVersion: maybe(z.number()),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Tool = z.infer<typeof tool>;
export const toolPage = page(tool);

/* ── Tool versions ────────────────────────────────────────────────────────── */

/**
 * A snapshot of a tool's definition.
 *
 * ── WHY THE UI HAS TO KNOW ABOUT THESE ──────────────────────────────────────
 * `agents.allowedToolIds` grants a tool by id. A spec re-import that rewrote
 * tools in place would change what that id does without changing the grant, so
 * a re-import writes a PENDING version instead and somebody applies it. The
 * review screen is the only place that can happen, which makes this type part of
 * the product rather than an audit trail.
 */
export const toolVersion = z.object({
  id: uuid,
  toolId: uuid,
  version: z.number(),
  name: z.string(),
  description: z.string().nullish(),
  reviewState: z.enum(["applied", "pending", "rejected"]),
  source: z.enum(["manual", "openapi_import", "postman_import", "migration"]),
  specImportId: uuid.nullish(),
  changeSummary: z.string().nullish(),
  riskLevel: z.string(),
  requiresApproval: z.boolean(),
  createdAt: isoDateTime,
  appliedAt: isoDateTime.nullish(),
  /* Present only on the detail endpoint. A version LIST is rendered as rows and
     would otherwise ship a whole spec per row. */
  httpSpec: jsonObject.nullish(),
  inputSchema: jsonObject.nullish(),
  resultContract: jsonObject.nullish(),
  connectionId: uuid.nullish(),
  timeoutMs: z.number().nullish(),
});
export type ToolVersion = z.infer<typeof toolVersion>;

export const toolVersionList = z.object({
  currentVersion: z.number().nullish(),
  toolName: z.string(),
  items: z.array(toolVersion),
});

/**
 * One row of the review queue.
 *
 * `isGranted` is the field the screen sorts and colours by: a pending change to
 * a tool nobody has granted is a chore, and to one an agent holds it is a
 * security review. A list that mixes them puts the review below the chores.
 */
export const pendingToolVersion = z.object({
  versionId: uuid,
  toolId: uuid,
  toolName: z.string(),
  version: z.number(),
  changeSummary: z.string().nullish(),
  source: z.string(),
  specImportId: uuid.nullish(),
  createdAt: isoDateTime,
  isGranted: z.boolean(),
});
export type PendingToolVersion = z.infer<typeof pendingToolVersion>;

export const pendingToolVersionList = z.object({
  items: z.array(pendingToolVersion),
  total: z.number(),
  grantedCount: z.number(),
});

/* ── API spec imports ─────────────────────────────────────────────────────── */

export const specImport = z.object({
  id: uuid,
  name: z.string(),
  sourceKind: z.enum(["openapi", "postman"]),
  sourceType: z.enum(["upload", "url"]),
  sourceUrl: z.string().nullish(),
  title: z.string().nullish(),
  specVersion: z.string().nullish(),
  servers: z.array(z.object({ url: z.string(), description: z.string().nullish() })),
  securitySchemes: jsonObject,
  operationCount: z.number(),
  connectionId: uuid.nullish(),
  previousImportId: uuid.nullish(),
  documentBytes: z.number(),
  documentSha256: z.string(),
  createdAt: isoDateTime,
});
export type SpecImport = z.infer<typeof specImport>;
export const specImportPage = page(specImport);

/** One operation of an imported document, as the selection table renders it. */
export const specOperation = z.object({
  operationKey: z.string(),
  method: z.string(),
  path: z.string(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  tags: z.array(z.string()),
  deprecated: z.boolean(),
  toolId: uuid.nullish(),
  hasBody: maybe(z.boolean()),
  hasResultContract: maybe(z.boolean()),
  httpSpec: jsonObject.nullish(),
  inputSchema: jsonObject.nullish(),
  resultContract: jsonObject.nullish(),
});
export type SpecOperation = z.infer<typeof specOperation>;

/**
 * A credential the document says it needs — item 10.
 *
 * `credentialLabel` is written for a person ("API key (sent as the `api_key`
 * header)") because the answer to "which of these do I have" is not derivable
 * from a scheme type. `needsInput` is what the form must additionally ask for,
 * and it also carries the warnings: a key in a query string is logged by every
 * proxy between here and the provider, and the person deserves to know before
 * they paste one.
 */
export const specAuthCandidate = z.object({
  schemeName: z.string(),
  strategy: z.string(),
  auth: jsonObject,
  credentialLabel: z.string(),
  requiredSecretFields: z.array(z.string()),
  operationCount: z.number(),
  needsInput: z.array(z.string()),
  description: z.string().nullish(),
});
export type SpecAuthCandidate = z.infer<typeof specAuthCandidate>;

export const specOperationChange = z.object({
  operationKey: z.string(),
  kind: z.enum(["added", "changed", "removed", "unchanged"]),
  method: z.string(),
  path: z.string(),
  summary: z.string().nullish(),
  toolId: uuid.nullish(),
  isGranted: z.boolean(),
  details: z.array(z.string()),
});
export type SpecOperationChange = z.infer<typeof specOperationChange>;

export const specDiff = z.object({
  previousImportId: uuid,
  currentImportId: uuid,
  hasChanges: z.boolean(),
  added: z.array(specOperationChange),
  changed: z.array(specOperationChange),
  removed: z.array(specOperationChange),
  unchangedCount: z.number(),
  affectingGrantedTools: z.array(specOperationChange),
});
export type SpecDiff = z.infer<typeof specDiff>;

export const specImportResult = z.object({
  import: specImport,
  format: z.string(),
  operations: z.array(specOperation),
  auth: z.array(specAuthCandidate),
  /** What a Postman conversion could not recover. Empty for OpenAPI. */
  notes: z.array(z.string()),
  diff: specDiff.nullish(),
});
export type SpecImportResult = z.infer<typeof specImportResult>;

export const specOperationList = z.object({
  items: z.array(specOperation),
  tags: z.array(z.string()),
  total: z.number(),
});

export const specToolsCreated = z.object({
  created: z.array(z.object({
    operationKey: z.string(),
    toolId: uuid,
    name: z.string(),
    riskLevel: z.string(),
  })),
  pendingReview: z.array(z.object({
    operationKey: z.string(),
    toolId: uuid,
    versionId: uuid,
    version: z.number(),
  })),
  message: z.string(),
});
export type SpecToolsCreated = z.infer<typeof specToolsCreated>;

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
  slug: maybe(z.string()),
  description: z.string().nullish(),
  status: z.string(),
  currentVersionId: maybe(uuid),
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
  replaySupport: maybe(z.string()),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type WorkflowVersion = z.infer<typeof workflowVersion>;
export const workflowVersionPage = page(workflowVersion);

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
  lastTestedAt: maybe(isoDateTime),
  lastTestStatus: maybe(z.string()),
  lastTestLatencyMs: maybe(z.number()),
  lastTestErrorCode: maybe(z.string()),
  lastTestErrorMessageSanitized: maybe(z.string()),
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
  slug: maybe(z.string()),
  role: z.unknown().transform(normalizeWorkspaceRole),
});
export type MeMembership = z.infer<typeof meMembership>;

export const me = z.object({
  user: z.object({
    id: uuid,
    supabaseUserId: maybe(z.string()),
    email: maybe(z.string()),
  }),
  workspaces: z.array(meMembership),
  defaultWorkspaceId: maybe(uuid),
});
export type Me = z.infer<typeof me>;
