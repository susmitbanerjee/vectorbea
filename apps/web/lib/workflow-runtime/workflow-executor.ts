/**
 * Workflow Executor
 *
 * Server-side only. Executes a WorkflowGraph node-by-node, resolving
 * connections and secrets, calling external services, and emitting
 * run events to the database.
 *
 * SECURITY INVARIANTS:
 *   - Secrets are resolved server-side only via getSecretForRuntime()
 *   - Plaintext secrets never appear in event payloads, logs, or outputs
 *   - Connection strings / API keys are never surfaced in run context
 *   - HTTP requests go through SSRF check before dispatch
 *   - DB queries use parameterized SQL only
 */

import "server-only";

import { db } from "@/server/db";
import { Prisma } from "@/lib/generated/prisma";
import { getSecretForRuntime } from "@/lib/server/secret-service";
import { checkSSRF } from "@/lib/server/ssrf-protection";
import type {
  SavedWorkflowNode,
  WorkflowGraph,
  WorkflowRunContext,
  StepOutputEntry,
  LlmNodeConfig,
  HttpToolNodeConfig,
  DbReadNodeConfig,
  DbWriteNodeConfig,
  TransformNodeConfig,
} from "@/types/workflow-graph";
import {
  resolveTemplate,
  resolveMapping,
  makeRunContext,
} from "./mapping-resolver";
import { processOutput } from "./output-extractor";
import { validateSchema, repairJson } from "./schema-validator";

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export interface ExecutorOptions {
  runId: string;
  workspaceId: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  triggerType: string;
  workflowInput: Record<string, unknown>;
  graph: WorkflowGraph;
  /** Max steps to execute before failing (safety limit) */
  maxSteps?: number;
  /** Skip SSRF checks (private runner mode) */
  privateRunnerMode?: boolean;
  /** Dry-run: resolve inputs and validate but don't call external services */
  dryRun?: boolean;
}

export interface ExecutorResult {
  status: "succeeded" | "failed" | "waiting_for_approval" | "paused";
  finalOutput?: unknown;
  errorMessage?: string;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

// â"€â"€â"€ Connection loader (server-side, with secret resolution) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface ResolvedConnection {
  type: string;
  configJson: Record<string, unknown>;
  /** Resolved plaintext secret â€" NEVER log or return this */
  secret: string | null;
  baseUrl?: string | null;
}

async function loadConnection(connectionId: string, workspaceId: string): Promise<ResolvedConnection | null> {
  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT id, type, config_json, secret_ref
      FROM vectorbea.connections
      WHERE id = ${connectionId}::uuid
        AND workspace_id = ${workspaceId}::uuid
        AND status != 'disabled'
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    const secretRef = typeof row.secret_ref === "string" ? row.secret_ref : null;
    const secret = secretRef ? await getSecretForRuntime(secretRef) : null;
    const configJson = (row.config_json ?? {}) as Record<string, unknown>;
    // base_url may be stored in config_json (e.g. for custom LLM endpoints)
    const baseUrl = typeof configJson.baseUrl === "string" ? configJson.baseUrl
      : typeof configJson.base_url === "string" ? configJson.base_url
      : null;

    return {
      type: String(row.type ?? ""),
      configJson,
      secret,
      baseUrl,
    };
  } catch (e) {
    console.error("[loadConnection] query failed:", (e as Error).message);
    return null;
  }
}

// â"€â"€â"€ Event emitter â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function emitEvent(seqRef: { seq: number }, opts: {
  runId: string;
  workspaceId: string;
  type: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING" | "SKIPPED";
  source?: string;
  title?: string;
  summary?: string;
  nodeId?: string;
  agentName?: string;
  toolName?: string;
  modelName?: string;
  durationMs?: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  /** Sanitized input (no secrets) */
  inputJsonSanitized?: unknown;
  /** Sanitized output (no secrets) */
  outputJsonSanitized?: unknown;
  errorJsonSanitized?: unknown;
}) {
  const seq = ++seqRef.seq;
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO vectorbea.platform_run_events (
        run_id, workspace_id, sequence, type, status, source, timestamp,
        title, summary, agent_name, tool_name, model_name,
        duration_ms, tokens_used, estimated_cost_usd,
        input_json_sanitized, output_json_sanitized, metadata_json_sanitized,
        error_json_sanitized
      ) VALUES (
        ${opts.runId}::uuid,
        ${opts.workspaceId}::uuid,
        ${seq},
        ${opts.type},
        ${opts.status},
        ${opts.source ?? "SYSTEM"},
        now(),
        ${opts.title ?? null},
        ${opts.summary ?? null},
        ${opts.agentName ?? null},
        ${opts.toolName ?? null},
        ${opts.modelName ?? null},
        ${opts.durationMs ?? null},
        ${opts.tokensUsed ?? null},
        ${opts.estimatedCostUsd ?? null},
        ${opts.inputJsonSanitized != null ? Prisma.sql`${JSON.stringify(opts.inputJsonSanitized)}::jsonb` : Prisma.sql`NULL`},
        ${opts.outputJsonSanitized != null ? Prisma.sql`${JSON.stringify(opts.outputJsonSanitized)}::jsonb` : Prisma.sql`NULL`},
        NULL,
        ${opts.errorJsonSanitized != null ? Prisma.sql`${JSON.stringify(opts.errorJsonSanitized)}::jsonb` : Prisma.sql`NULL`}
      )
    `);
  } catch {
    // Best-effort event emission â€" never fail a run because of event write errors
  }
}

async function updateRunStatus(
  runId: string,
  status: string,
  opts: { output?: unknown; error?: unknown; durationMs?: number; totalTokens?: number; estimatedCostUsd?: number } = {},
) {
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE vectorbea.platform_runs
      SET
        status = ${status},
        ${status === "succeeded" || status === "failed" || status === "cancelled"
          ? Prisma.sql`completed_at = now(),`
          : Prisma.sql``}
        ${opts.output != null ? Prisma.sql`output_json = ${JSON.stringify(opts.output)}::jsonb,` : Prisma.sql``}
        ${opts.error != null ? Prisma.sql`error_json = ${JSON.stringify(opts.error)}::jsonb,` : Prisma.sql``}
        ${opts.durationMs != null ? Prisma.sql`duration_ms = ${opts.durationMs},` : Prisma.sql``}
        ${opts.totalTokens != null ? Prisma.sql`total_tokens = ${opts.totalTokens},` : Prisma.sql``}
        ${opts.estimatedCostUsd != null ? Prisma.sql`estimated_cost_usd = ${opts.estimatedCostUsd},` : Prisma.sql``}
        updated_at = now()
      WHERE id = ${runId}::uuid
    `);
  } catch {
    // Best-effort
  }
}

// â"€â"€â"€ Graph traversal â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function getStartNode(graph: WorkflowGraph): SavedWorkflowNode | null {
  return graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0] ?? null;
}

function getSuccessors(graph: WorkflowGraph, nodeId: string, edgeType?: string): SavedWorkflowNode[] {
  const edges = graph.edges.filter((e) => {
    if (e.source !== nodeId) return false;
    if (!edgeType) return true;
    const et = e.data?.edgeType ?? "default";
    return et === edgeType;
  });
  return edges
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is SavedWorkflowNode => n !== undefined);
}

// â"€â"€â"€ LLM executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function executeLlmNode(
  cfg: LlmNodeConfig,
  resolvedInput: Record<string, unknown>,
  connection: ResolvedConnection | null,
  dryRun: boolean,
): Promise<{ output: unknown; tokensUsed: number; estimatedCostUsd: number }> {
  if (dryRun) {
    return { output: { __dryRun: true, resolvedInput }, tokensUsed: 0, estimatedCostUsd: 0 };
  }

  const apiKey = connection?.secret ?? null;
  if (!apiKey) throw new Error(`LLM connection has no API key â€" check Connection configuration`);

  const provider = (connection?.configJson.providerType as string) ?? cfg.provider ?? "openai";
  const model = cfg.model;
  const systemPrompt = String(resolvedInput.systemPrompt ?? cfg.systemPrompt ?? "");
  const userPrompt = String(resolvedInput.userPrompt ?? "");
  const maxTokens = cfg.maxTokens ?? 2048;
  const timeoutMs = 60_000;

  // Delegate to the existing execution module
  const { executeResolvedPrompt } = await import("@/lib/server/execution");
  const result = await executeResolvedPrompt({
    workspaceId: "",
    promptVersionId: null,
    promptName: "workflow-llm-node",
    versionTag: "v1",
    templateText: systemPrompt,
    variables: resolvedInput as Record<string, unknown>,
    inputText: userPrompt,
    renderedPrompt: systemPrompt,
    providerConfig: {
      providerType: provider,
      apiKey,
      baseUrl: connection?.baseUrl ?? null,
      model,
      configId: connection ? String(connection.configJson.id ?? "") : "",
    },
  });

  let output: unknown = result.outputText;

  // Structured output / JSON repair
  if (cfg.outputSchema) {
    try {
      const parsed = repairJson(result.outputText);
      if (cfg.validationEnabled) {
        const validation = validateSchema(parsed, cfg.outputSchema);
        if (!validation.valid) {
          throw new Error(`LLM output failed schema validation: ${validation.errors.map((e) => e.message).join("; ")}`);
        }
      }
      output = parsed;
    } catch (e) {
      if ((e as Error).message.startsWith("LLM output failed")) throw e;
      // JSON parse failed â€" leave as raw text
    }
  }

  const cost = +(result.tokenCount * 0.000003).toFixed(6);
  return { output, tokensUsed: result.tokenCount, estimatedCostUsd: cost };
}

// â"€â"€â"€ HTTP tool executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function executeHttpNode(
  cfg: HttpToolNodeConfig,
  resolvedInput: Record<string, unknown>,
  connection: ResolvedConnection | null,
  privateRunnerMode: boolean,
  dryRun: boolean,
): Promise<{ output: unknown }> {
  const urlRaw = String(resolvedInput.__url ?? "");
  if (!urlRaw) throw new Error("HTTP tool: url resolved to empty string");

  if (!dryRun) {
    // SSRF check
    const ssrf = await checkSSRF(urlRaw, privateRunnerMode);
    if (!ssrf.allowed) throw new Error(`HTTP_BLOCKED: ${ssrf.reason}`);
  }

  if (dryRun) {
    return { output: { __dryRun: true, method: cfg.method, url: urlRaw, resolvedHeaders: resolvedInput.__headers ?? {} } };
  }

  const method = cfg.method;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const maxBytes = cfg.maxResponseBytes ?? 5 * 1024 * 1024; // 5 MB default

  // Build headers â€" never log raw Authorization values
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  // Apply connection auth headers server-side
  if (connection) {
    const authType = String(connection.configJson.authType ?? "");
    const secret = connection.secret;
    if (secret) {
      if (authType === "bearer") headers["Authorization"] = `Bearer ${secret}`;
      else if (authType === "api_key") {
        const headerName = String(connection.configJson.apiKeyHeader ?? "X-API-Key");
        headers[headerName] = secret;
      } else if (authType === "basic") {
        headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
      }
    }
  }

  // Apply resolved headers (from template expansion)
  const resolvedHeaders = resolvedInput.__headers as Record<string, string> | undefined;
  if (resolvedHeaders) {
    for (const [k, v] of Object.entries(resolvedHeaders)) {
      // Never override Authorization from resolved headers if we already set it from connection
      if (k.toLowerCase() === "authorization" && headers["Authorization"]) continue;
      headers[k] = String(v);
    }
  }

  const bodyStr = resolvedInput.__body != null
    ? (typeof resolvedInput.__body === "string" ? resolvedInput.__body : JSON.stringify(resolvedInput.__body))
    : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("HTTP timeout"), timeoutMs);

  let responseStatusCode = 0;
  let responseHeaders: Record<string, string> = {};
  let responseBody: unknown = null;

  try {
    const resp = await fetch(urlRaw, {
      method,
      headers,
      body: bodyStr,
      signal: controller.signal,
      cache: "no-store",
    });

    responseStatusCode = resp.status;
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

    const contentType = resp.headers.get("content-type") ?? "";
    let rawBody: string;
    const reader = resp.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new Error(`HTTP response exceeded max size (${maxBytes} bytes)`);
          }
          chunks.push(value);
        }
      }
      rawBody = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    } else {
      rawBody = await resp.text();
    }

    if (contentType.includes("application/json")) {
      try { responseBody = JSON.parse(rawBody); } catch { responseBody = rawBody; }
    } else {
      responseBody = rawBody;
    }

    if (!resp.ok) {
      // Sanitize error body to avoid leaking connection details
      const safeError = typeof responseBody === "string"
        ? responseBody.slice(0, 500)
        : JSON.stringify(responseBody).slice(0, 500);
      throw new Error(`HTTP ${responseStatusCode}: ${safeError}`);
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    output: {
      statusCode: responseStatusCode,
      headers: responseHeaders,
      body: responseBody,
    },
  };
}

// â"€â"€â"€ DB read executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function executeDbReadNode(
  cfg: DbReadNodeConfig,
  resolvedParams: Record<string, unknown>,
  connection: ResolvedConnection | null,
  dryRun: boolean,
): Promise<{ output: unknown }> {
  if (dryRun) {
    return { output: { __dryRun: true, sql: cfg.sqlTemplate, resolvedParams } };
  }

  if (!connection?.secret) throw new Error("DB read: no connection string â€" check Connection configuration");

  const connectionString = connection.secret;

  // Use pg client for parameterized queries
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Build parameter array in SQL-appearance order
    const paramOrder: string[] = [];
    let sql = cfg.sqlTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
      if (!paramOrder.includes(name)) paramOrder.push(name);
      return `$${paramOrder.indexOf(name) + 1}`;
    });
    const values = paramOrder.map((k) => resolvedParams[k]);

    const maxRows = cfg.maxRows ?? 1000;
    // Add LIMIT if not present
    if (!/\bLIMIT\b/i.test(sql)) {
      sql = `${sql.trim().replace(/;?\s*$/, "")} LIMIT ${maxRows}`;
    }

    const result = await client.query(sql, values);
    return { output: { rows: result.rows, rowCount: result.rowCount } };
  } finally {
    await client.end().catch(() => {});
  }
}

// â"€â"€â"€ DB write executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function executeDbWriteNode(
  cfg: DbWriteNodeConfig,
  resolvedParams: Record<string, unknown>,
  connection: ResolvedConnection | null,
  dryRun: boolean,
): Promise<{ output: unknown }> {
  if (dryRun) {
    return { output: { __dryRun: true, sql: cfg.sqlTemplate, resolvedParams } };
  }

  if (!connection?.secret) throw new Error("DB write: no connection string â€" check Connection configuration");

  const connectionString = connection.secret;
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const paramOrder: string[] = [];
    let sql = cfg.sqlTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
      if (!paramOrder.includes(name)) paramOrder.push(name);
      return `$${paramOrder.indexOf(name) + 1}`;
    });
    const values = paramOrder.map((k) => resolvedParams[k]);

    const result = await client.query(sql, values);
    return { output: { affectedRows: result.rowCount, rows: result.rows } };
  } finally {
    await client.end().catch(() => {});
  }
}

// â"€â"€â"€ Transform executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function executeTransformNode(
  cfg: TransformNodeConfig,
  context: WorkflowRunContext,
): unknown {
  const engine = cfg.engine ?? "template";
  if (engine === "template") {
    return resolveTemplate(cfg.expression, context);
  }
  // JSONata / jq â€" structural placeholders (not yet implemented server-side)
  throw new Error(`Transform engine '${engine}' is not yet supported`);
}

// â"€â"€â"€ Sanitize output (remove any fields that might contain secrets) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function sanitizeOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  if (Array.isArray(output)) return output.map(sanitizeOutput);

  const obj = output as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    // Redact any key that looks like a secret
    if (
      lk.includes("password") || lk.includes("secret") || lk.includes("api_key") ||
      lk.includes("apikey") || lk.includes("token") || lk.includes("credential") ||
      lk.includes("private_key") || lk.includes("connection_string")
    ) {
      sanitized[k] = "[REDACTED]";
    } else {
      sanitized[k] = sanitizeOutput(v);
    }
  }
  return sanitized;
}

// ─── Agent executor ───────────────────────────────────────────────────────────
// Loads the agent + its tools from DB, calls the LLM with tool definitions
// (OpenAI function-calling), dispatches tool calls in a loop until the model
// stops calling tools or maxIterations is reached.

interface AgentToolRecord {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string;
  inputSchema: Record<string, unknown>;
  connectionId: string | null;
  dbConfig: { sqlTemplate: string; maxRows?: number; requireApproval?: boolean } | null;
  httpConfig: { method: string; url: string; headers: Record<string, string>; bodyTemplate?: string } | null;
}

async function executeAgentNode(opts: {
  agentId: string;
  workspaceId: string;
  runId: string;
  workflowInput: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  dryRun: boolean;
  seqRef: { seq: number };
}): Promise<{ output: unknown; tokensUsed: number; estimatedCostUsd: number }> {
  const { agentId, workspaceId, runId, workflowInput, stepOutputs, dryRun, seqRef } = opts;

  // Load agent record
  const agentRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id, name, model_name, temperature, max_iterations,
           llm_connection_id, allowed_tool_ids, instructions
    FROM vectorbea.platform_agents
    WHERE id = ${agentId}::uuid AND workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `);
  const agentRow = agentRows[0];
  if (!agentRow) throw new Error(`Agent ${agentId} not found`);

  const modelName      = String(agentRow.model_name ?? "gpt-4o-mini");
  const temperature    = Number(agentRow.temperature ?? 0.1);
  const maxIterations  = Number(agentRow.max_iterations ?? 10);
  const instructions   = String(agentRow.instructions ?? "");
  const llmConnId      = agentRow.llm_connection_id ? String(agentRow.llm_connection_id) : null;
  const allowedToolIds = Array.isArray(agentRow.allowed_tool_ids) ? (agentRow.allowed_tool_ids as string[]) : [];
  const agentName      = String(agentRow.name ?? "Agent");

  // Load LLM connection + API key
  const llmConn = llmConnId ? await loadConnection(llmConnId, workspaceId) : null;
  if (!llmConnId) throw new Error(`Agent "${agentName}": no llm_connection_id on agent row`);
  if (!llmConn)   throw new Error(`Agent "${agentName}": loadConnection returned null for id=${llmConnId}`);
  if (!llmConn.secret) throw new Error(`Agent "${agentName}": connection found but secret is null (secret_ref may be missing or decryption failed)`);
  const apiKey  = llmConn.secret;
  const baseUrl = llmConn.baseUrl ?? "https://api.openai.com/v1";

  // Load tools
  let tools: AgentToolRecord[] = [];
  if (allowedToolIds.length > 0) {
    const toolRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT id, name, slug, type, description, input_schema, connection_id, db_config, http_config
      FROM vectorbea.platform_tools
      WHERE id = ANY(${allowedToolIds}::uuid[]) AND workspace_id = ${workspaceId}::uuid
    `);
    tools = toolRows.map((r) => ({
      id:           String(r.id),
      name:         String(r.name),
      slug:         String(r.slug ?? r.name).replace(/[^a-zA-Z0-9_-]/g, "_"),
      type:         String(r.type ?? "http"),
      description:  String(r.description ?? ""),
      inputSchema:  (r.input_schema ?? {}) as Record<string, unknown>,
      connectionId: r.connection_id ? String(r.connection_id) : null,
      dbConfig:     r.db_config as AgentToolRecord["dbConfig"],
      httpConfig:   r.http_config as AgentToolRecord["httpConfig"],
    }));
  }

  if (dryRun) {
    return { output: { __dryRun: true, agentName, modelName, tools: tools.map((t) => t.name) }, tokensUsed: 0, estimatedCostUsd: 0 };
  }

  // Build OpenAI tool definitions
  const openAiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.slug, description: t.description || t.name, parameters: t.inputSchema },
  }));

  // Build initial messages
  const systemPrompt = instructions || "You are a helpful AI agent. Complete the user task using the available tools.";
  const contextSummary = Object.keys(stepOutputs).length > 0
    ? `\n\nPrevious step outputs:\n${JSON.stringify(stepOutputs, null, 2)}`
    : "";

  const messages: Record<string, unknown>[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Execute the workflow task.${contextSummary}\n\nWorkflow input: ${JSON.stringify(workflowInput)}` },
  ];

  let totalTokens = 0;
  let lastOutput: unknown = null;

  // Agentic loop
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const llmStartMs = Date.now();

    const llmRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        temperature,
        messages,
        tools: openAiTools.length > 0 ? openAiTools : undefined,
        tool_choice: openAiTools.length > 0 ? "auto" : undefined,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      throw new Error(`LLM API error (${llmRes.status}): ${errText.slice(0, 300)}`);
    }

    const llmData = await llmRes.json() as {
      choices: { message: { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { total_tokens: number };
    };

    const iterTokens = llmData.usage?.total_tokens ?? 0;
    totalTokens += iterTokens;
    const assistantMsg = llmData.choices[0]?.message;
    if (!assistantMsg) break;

    await emitEvent(seqRef, {
      runId, workspaceId,
      type: "LLM_CALL_STARTED", status: "SUCCEEDED", source: "NATIVE",
      agentName, modelName,
      title: `LLM — ${modelName} (iter ${iteration + 1})`,
      summary: assistantMsg.content?.slice(0, 200) ?? undefined,
      durationMs: Date.now() - llmStartMs,
      tokensUsed: iterTokens,
      estimatedCostUsd: (iterTokens / 1_000_000) * 2.5,
    });

    // No tool calls — agent finished
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      lastOutput = assistantMsg.content;
      break;
    }

    messages.push({ role: "assistant", content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

    // Dispatch tool calls
    for (const toolCall of assistantMsg.tool_calls) {
      const fnName = toolCall.function.name;
      const tool   = tools.find((t) => t.slug === fnName);
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch { /* ignore */ }

      await emitEvent(seqRef, {
        runId, workspaceId, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "NATIVE",
        agentName, toolName: tool?.name ?? fnName,
        title: `Tool call — ${tool?.name ?? fnName}`,
        inputJsonSanitized: sanitizeOutput(toolArgs),
      });

      let toolResult: unknown;
      const toolStartMs = Date.now();

      try {
        if (!tool) throw new Error(`Tool "${fnName}" not registered on agent`);

        if (tool.type === "http") {
          const hc = tool.httpConfig;
          if (!hc) throw new Error(`Tool "${tool.name}": no HTTP config`);
          let url = hc.url;
          for (const [k, v] of Object.entries(toolArgs)) url = url.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), String(v));
          await checkSSRF(url);
          let body: string | undefined;
          if (hc.bodyTemplate) {
            body = hc.bodyTemplate;
            for (const [k, v] of Object.entries(toolArgs)) body = body!.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), JSON.stringify(v));
          }
          const httpRes = await fetch(url, {
            method: hc.method,
            headers: { "Content-Type": "application/json", ...hc.headers },
            body: body ?? (["POST","PUT","PATCH"].includes(hc.method) ? JSON.stringify(toolArgs) : undefined),
          });
          const text = await httpRes.text();
          try { toolResult = JSON.parse(text); } catch { toolResult = text; }

        } else if (tool.type === "database_read" || tool.type === "database_write") {
          const dc = tool.dbConfig;
          if (!dc?.sqlTemplate) throw new Error(`Tool "${tool.name}": no SQL template configured`);
          const conn = tool.connectionId ? await loadConnection(tool.connectionId, workspaceId) : null;
          if (!conn?.secret) throw new Error(`Tool "${tool.name}": database connection missing or has no credentials`);

          const { Client } = await import("pg");
          const client = new Client({ connectionString: conn.secret });
          await client.connect();
          try {
            const paramOrder: string[] = [];
            const sql = dc.sqlTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
              if (!paramOrder.includes(name)) paramOrder.push(name);
              return `$${paramOrder.indexOf(name) + 1}`;
            });
            const values = paramOrder.map((k) => toolArgs[k] ?? null);
            const result = await client.query(sql, values);
            toolResult = tool.type === "database_read"
              ? { rows: result.rows, rowCount: result.rowCount }
              : { rowsAffected: result.rowCount, success: true };
          } finally {
            await client.end().catch(() => {});
          }

        } else {
          throw new Error(`Tool type "${tool.type}" not supported in agent execution`);
        }

        await emitEvent(seqRef, {
          runId, workspaceId, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "NATIVE",
          agentName, toolName: tool.name,
          title: `Tool completed — ${tool.name}`,
          durationMs: Date.now() - toolStartMs,
          outputJsonSanitized: sanitizeOutput(toolResult),
        });

      } catch (toolErr) {
        const errMsg = toolErr instanceof Error ? toolErr.message : "Tool failed";
        toolResult = { error: errMsg };
        await emitEvent(seqRef, {
          runId, workspaceId, type: "TOOL_CALL_FAILED", status: "FAILED", source: "NATIVE",
          agentName, toolName: tool?.name ?? fnName,
          title: `Tool failed — ${tool?.name ?? fnName}`,
          durationMs: Date.now() - toolStartMs,
          errorJsonSanitized: { message: errMsg },
        });
      }

      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) });
    }
    lastOutput = assistantMsg.content;
  }

  const estimatedCostUsd = (totalTokens / 1_000_000) * 2.5;
  return { output: lastOutput, tokensUsed: totalTokens, estimatedCostUsd };
}


// â"€â"€â"€ Main executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export async function executeWorkflow(opts: ExecutorOptions): Promise<ExecutorResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const {
    runId, workspaceId, workflowId, workflowName, workflowVersion,
    triggerType, workflowInput, graph,
    maxSteps = 200,
    privateRunnerMode = false,
    dryRun = false,
  } = opts;

  const seqRef = { seq: 0 };

  const context = makeRunContext({
    runId, workspaceId, workflowId,
    startedAt, triggerType,
    workflowInput,
  });

  let totalTokens = 0;
  let totalCost = 0;
  let stepCount = 0;
  let finalOutput: unknown = undefined;

  await emitEvent(seqRef, {
    runId, workspaceId,
    type: "RUN_STARTED",
    status: "SUCCEEDED",
    title: `Run started â€" ${workflowName}`,
    source: "SYSTEM",
  });

  // Topological traversal starting from trigger node
  let current = getStartNode(graph);
  if (!current) {
    await updateRunStatus(runId, "failed", { error: { message: "Workflow graph has no trigger node" } });
    return { status: "failed", errorMessage: "No trigger node found", totalTokens: 0, estimatedCostUsd: 0, durationMs: Date.now() - startMs };
  }

  // Skip the trigger node itself â€" it only defines the entry point
  const successors = getSuccessors(graph, current.id);
  current = successors[0] ?? null;

  while (current !== null) {
    if (stepCount++ > maxSteps) {
      const msg = `Execution aborted: exceeded maxSteps limit (${maxSteps})`;
      await updateRunStatus(runId, "failed", { error: { message: msg }, durationMs: Date.now() - startMs });
      return { status: "failed", errorMessage: msg, totalTokens, estimatedCostUsd: totalCost, durationMs: Date.now() - startMs };
    }

    const node: SavedWorkflowNode = current;
    const nodeType = node.type;

    // â"€â"€ End node â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (nodeType === "end") {
      const endCfg = node.data.endConfig;
      if (endCfg?.outputMapping) {
        finalOutput = resolveMapping(endCfg.outputMapping, context);
      }
      break;
    }

    // â"€â"€ Approval node â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (nodeType === "approval") {
      const cfg = node.data.approvalConfig;
      if (cfg) {
        // Resolve approval message
        const resolvedMessage = cfg.message ? String(resolveTemplate(cfg.message, context)) : "";
        const resolvedTitle = cfg.title ? String(resolveTemplate(cfg.title, context)) : "Approval required";

        // Emit approval request event
        await emitEvent(seqRef, {
          runId, workspaceId,
          type: "APPROVAL_REQUESTED",
          status: "PENDING",
          title: resolvedTitle,
          summary: resolvedMessage,
          source: "SYSTEM",
        });

        // Update run status to waiting
        await updateRunStatus(runId, "waiting_for_approval");
        return {
          status: "waiting_for_approval",
          totalTokens, estimatedCostUsd: totalCost, durationMs: Date.now() - startMs,
        };
      }
      break;
    }

    // â"€â"€ Step nodes â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const stepStartMs = Date.now();

    await emitEvent(seqRef, {
      runId, workspaceId,
      type: "STEP_STARTED",
      status: "SUCCEEDED",
      title: `${node.data.label ?? nodeType} started`,
      source: "NATIVE",
    });

    let stepOutput: unknown = null;
    let stepError: string | undefined;
    let stepTokens = 0;
    let stepCost = 0;

    try {
      // â"€â"€ Resolve input mapping â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const inputMapping = node.data.inputMappingJson ?? {};
      const resolvedInputs = Object.keys(inputMapping).length > 0
        ? resolveMapping(inputMapping, context)
        : {};

      // â"€â"€ Validate input schema (if configured) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const inputSchema = node.data.inputSchemaJson;
      if (inputSchema && Object.keys(resolvedInputs).length > 0) {
        const validation = validateSchema(resolvedInputs, inputSchema);
        if (!validation.valid) {
          throw new Error(`Input schema validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
        }
      }

      // â"€â"€ Execute per node type â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      switch (nodeType) {
        case "llm": {
          const cfg = node.data.llmConfig;
          if (!cfg) throw new Error("LLM node missing llmConfig");

          const userPrompt = cfg.userPromptTemplate
            ? String(resolveTemplate(cfg.userPromptTemplate, context))
            : String(resolvedInputs.userPrompt ?? "");
          const systemPrompt = cfg.systemPrompt
            ? String(resolveTemplate(cfg.systemPrompt, context))
            : String(resolvedInputs.systemPrompt ?? "");

          const conn = cfg.connectionId ? await loadConnection(cfg.connectionId, workspaceId) : null;

          await emitEvent(seqRef, {
            runId, workspaceId, type: "LLM_CALL_STARTED", status: "SUCCEEDED",
            title: `LLM call â€" ${cfg.model}`,
            modelName: cfg.model,
            source: "NATIVE",
          });

          const llmResult = await executeLlmNode(
            cfg,
            { ...resolvedInputs, userPrompt, systemPrompt },
            conn,
            dryRun,
          );
          stepOutput = llmResult.output;
          stepTokens = llmResult.tokensUsed;
          stepCost = llmResult.estimatedCostUsd;
          totalTokens += stepTokens;
          totalCost += stepCost;

          if (cfg.validationEnabled && cfg.outputSchema && !dryRun) {
            const v = validateSchema(stepOutput, cfg.outputSchema);
            await emitEvent(seqRef, {
              runId, workspaceId, type: "LLM_OUTPUT_VALIDATED",
              status: v.valid ? "SUCCEEDED" : "FAILED",
              title: v.valid ? "LLM output validated" : `Output validation failed: ${v.errors[0]?.message}`,
              source: "NATIVE",
            });
            if (!v.valid) throw new Error(`LLM output validation: ${v.errors.map((e) => e.message).join("; ")}`);
          }

          await emitEvent(seqRef, {
            runId, workspaceId, type: "LLM_CALL_COMPLETED", status: "SUCCEEDED",
            title: `LLM call completed (${stepTokens.toLocaleString()} tokens)`,
            modelName: cfg.model,
            tokensUsed: stepTokens,
            estimatedCostUsd: stepCost,
            durationMs: Date.now() - stepStartMs,
            source: "NATIVE",
          });
          break;
        }

        case "http_tool": {
          const cfg = node.data.httpToolConfig;
          if (!cfg) throw new Error("HTTP tool node missing httpToolConfig");

          const conn = cfg.connectionId ? await loadConnection(cfg.connectionId, workspaceId) : null;
          const url = cfg.urlTemplate ? String(resolveTemplate(cfg.urlTemplate, context)) : "";

          // Resolve headers from template
          const resolvedHeaders: Record<string, string> = {};
          if (cfg.headers) {
            for (const [k, v] of Object.entries(cfg.headers)) {
              resolvedHeaders[k] = String(resolveTemplate(v, context));
            }
          }

          // Resolve query params
          let finalUrl = url;
          if (cfg.queryParams && Object.keys(cfg.queryParams).length > 0) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(cfg.queryParams)) {
              qs.set(k, String(resolveTemplate(v, context)));
            }
            finalUrl = `${url}${url.includes("?") ? "&" : "?"}${qs.toString()}`;
          }

          // Resolve body
          const resolvedBody = cfg.bodyTemplate
            ? resolveTemplate(cfg.bodyTemplate, context)
            : resolvedInputs.body ?? undefined;

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_STARTED", status: "SUCCEEDED",
            title: `HTTP ${cfg.method} â€" ${finalUrl.replace(/[?#].*/, "")}`,
            toolName: node.data.label as string,
            source: "NATIVE",
          });

          const httpResult = await executeHttpNode(
            cfg,
            { ...resolvedInputs, __url: finalUrl, __headers: resolvedHeaders, __body: resolvedBody },
            conn,
            privateRunnerMode,
            dryRun,
          );
          stepOutput = httpResult.output;

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED",
            title: `HTTP completed (${(stepOutput as Record<string, unknown>)?.statusCode ?? "?"})`,
            toolName: node.data.label as string,
            durationMs: Date.now() - stepStartMs,
            outputJsonSanitized: sanitizeOutput(stepOutput),
            source: "NATIVE",
          });
          break;
        }

        case "db_read": {
          const cfg = node.data.dbReadConfig;
          if (!cfg) throw new Error("DB read node missing dbReadConfig");

          const conn = cfg.connectionId ? await loadConnection(cfg.connectionId, workspaceId) : null;
          const resolvedParams = cfg.parameters ? resolveMapping(cfg.parameters, context) : {};

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_STARTED", status: "SUCCEEDED",
            title: `DB query â€" ${node.data.label}`,
            toolName: node.data.label as string,
            source: "NATIVE",
            // Show sanitized SQL preview (no parameter values)
            inputJsonSanitized: { sqlPreview: cfg.sqlTemplate.slice(0, 200) },
          });

          const dbResult = await executeDbReadNode(cfg, resolvedParams, conn, dryRun);
          stepOutput = dbResult.output;

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED",
            title: `DB query completed (${(stepOutput as Record<string, unknown>)?.rowCount ?? "?"} rows)`,
            toolName: node.data.label as string,
            durationMs: Date.now() - stepStartMs,
            source: "NATIVE",
          });
          break;
        }

        case "db_write": {
          const cfg = node.data.dbWriteConfig;
          if (!cfg) throw new Error("DB write node missing dbWriteConfig");

          if (cfg.requireApproval) {
            await emitEvent(seqRef, {
              runId, workspaceId, type: "APPROVAL_REQUESTED", status: "PENDING",
              title: `DB write requires approval — ${node.data.label}`,
              source: "SYSTEM",
            });
            await updateRunStatus(runId, "waiting_for_approval");
            return { status: "waiting_for_approval", totalTokens, estimatedCostUsd: totalCost, durationMs: Date.now() - startMs };
          }

          const conn = cfg.connectionId ? await loadConnection(cfg.connectionId, workspaceId) : null;
          const resolvedParams = cfg.parameters ? resolveMapping(cfg.parameters, context) : {};

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_STARTED", status: "SUCCEEDED",
            title: `DB write â€" ${node.data.label}`,
            toolName: node.data.label as string,
            source: "NATIVE",
            inputJsonSanitized: { sqlPreview: cfg.sqlTemplate.slice(0, 200) },
          });

          const dbResult = await executeDbWriteNode(cfg, resolvedParams, conn, dryRun);
          stepOutput = dbResult.output;

          await emitEvent(seqRef, {
            runId, workspaceId, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED",
            title: `DB write completed (${(stepOutput as Record<string, unknown>)?.affectedRows ?? "?"} rows affected)`,
            toolName: node.data.label as string,
            durationMs: Date.now() - stepStartMs,
            source: "NATIVE",
          });
          break;
        }

        case "transform": {
          const cfg = node.data.transformConfig;
          if (!cfg) throw new Error("Transform node missing transformConfig");

          stepOutput = executeTransformNode(cfg, context);
          await emitEvent(seqRef, {
            runId, workspaceId, type: "STEP_COMPLETED", status: "SUCCEEDED",
            title: `Transform completed â€" ${node.data.label}`,
            source: "NATIVE",
            outputJsonSanitized: sanitizeOutput(stepOutput),
          });
          break;
        }

        case "branch": {
          const cfg = node.data.branchConfig;
          const condition = cfg?.conditionExpression
            ? resolveTemplate(cfg.conditionExpression, context)
            : false;
          const branchTaken = Boolean(condition);

          await emitEvent(seqRef, {
            runId, workspaceId, type: "STEP_COMPLETED", status: "SUCCEEDED",
            title: `Branch: condition ${branchTaken ? "true" : "false"}`,
            source: "NATIVE",
            outputJsonSanitized: { branchTaken, condition: cfg?.conditionExpression },
          });

          // Follow the appropriate branch edge
          const edgeType = branchTaken ? "conditional_true" : "conditional_false";
          const branchSuccessors = getSuccessors(graph, node.id, edgeType);
          if (branchSuccessors.length === 0) {
            // Fall back to any available edge
            const any = getSuccessors(graph, node.id);
            current = any[0] ?? null;
          } else {
            current = branchSuccessors[0]!;
          }

          // Store empty step output
          context.steps[node.id] = {
            raw: { branchTaken },
            extracted: { branchTaken },
            status: "succeeded",
            durationMs: Date.now() - stepStartMs,
          };
          continue; // don't fall through to default traversal
        }

        case "timer": {
          const cfg = node.data.timerConfig;
          const delayMs = cfg?.delayMs ?? 0;
          // In real execution we would queue a resume â€" for now we skip the delay
          await emitEvent(seqRef, {
            runId, workspaceId, type: "STEP_COMPLETED", status: "SUCCEEDED",
            title: `Timer: ${delayMs}ms delay (skipped in direct execution)`,
            source: "SYSTEM",
          });
          stepOutput = { delayMs };
          break;
        }

        case "webhook_wait": {
          // Pause execution and wait for inbound webhook
          await emitEvent(seqRef, {
            runId, workspaceId, type: "STEP_STARTED", status: "PENDING",
            title: `Waiting for webhook â€" ${node.data.label}`,
            source: "SYSTEM",
          });
          await updateRunStatus(runId, "paused");
          return { status: "paused", totalTokens, estimatedCostUsd: totalCost, durationMs: Date.now() - startMs };
        }

        case "checkpoint": {
          const cfg = node.data.checkpointConfig;
          await emitEvent(seqRef, {
            runId, workspaceId, type: "CHECKPOINT_CREATED", status: "SUCCEEDED",
            title: `Checkpoint: ${cfg?.checkpointName ?? node.data.label}`,
            source: "SYSTEM",
            outputJsonSanitized: { checkpointName: cfg?.checkpointName, nodeId: node.id },
          });
          stepOutput = { checkpointName: cfg?.checkpointName };
          break;
        }

        case "artifact": {
          const cfg = node.data.artifactConfig;
          const content = cfg?.sourceExpression
            ? resolveTemplate(cfg.sourceExpression, context)
            : null;
          await emitEvent(seqRef, {
            runId, workspaceId, type: "ARTIFACT_CREATED", status: "SUCCEEDED",
            title: `Artifact: ${cfg?.artifactName ?? node.data.label}`,
            source: "SYSTEM",
            outputJsonSanitized: { artifactName: cfg?.artifactName, artifactType: cfg?.artifactType },
          });
          stepOutput = { artifactName: cfg?.artifactName, content: sanitizeOutput(content) };
          break;
        }

        case "agent": {
          // Agent steps emit their own sub-events via the agent runner
          // For now emit a simplified event set
          const cfg = node.data.agentConfig;
          await emitEvent(seqRef, {
            runId, workspaceId, type: "AGENT_STARTED", status: "SUCCEEDED",
            title: `Agent started â€" ${cfg?.agentName ?? node.data.label}`,
            agentName: cfg?.agentName as string,
            source: "NATIVE",
          });
          // Execute real agent: LLM agentic loop with tool calls
          if (!cfg?.agentId) {
            stepOutput = { warning: "Agent node has no agentId configured" };
          } else {
            const agentResult = await executeAgentNode({
              agentId: cfg.agentId,
              workspaceId,
              runId,
              workflowInput,
              stepOutputs: Object.fromEntries(
                Object.entries(context.steps).map(([k, v]) => [k, (v as { extracted: unknown }).extracted])
              ),
              dryRun,
              seqRef,
            });
            stepOutput = { output: agentResult.output, status: "completed" };
            totalTokens += agentResult.tokensUsed;
            totalCost   += agentResult.estimatedCostUsd;
          }
          await emitEvent(seqRef, {
            runId, workspaceId, type: "AGENT_COMPLETED", status: "SUCCEEDED",
            title: `Agent completed â€" ${cfg?.agentName ?? node.data.label}`,
            agentName: cfg?.agentName as string,
            durationMs: Date.now() - stepStartMs,
            source: "NATIVE",
          });
          break;
        }

        default:
          // Unknown node type â€" skip
          await emitEvent(seqRef, {
            runId, workspaceId, type: "STEP_COMPLETED", status: "SKIPPED",
            title: `Skipped: ${nodeType}`,
            source: "SYSTEM",
          });
          stepOutput = null;
      }

      // â"€â"€ Extract output â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const extractionCfg = node.data.outputExtractionJson;
      const extracted = processOutput(stepOutput, extractionCfg);

      // â"€â"€ Validate output schema â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const outputSchema = node.data.outputSchemaJson;
      if (outputSchema) {
        const v = validateSchema(extracted, outputSchema);
        if (!v.valid) {
          throw new Error(`Output schema validation failed at ${node.data.label}: ${v.errors.map((e) => e.message).join("; ")}`);
        }
      }

      // â"€â"€ Apply output mapping â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const outputMapping = node.data.outputMappingJson;
      let finalExtracted: Record<string, unknown> = extracted;
      if (outputMapping && Object.keys(outputMapping).length > 0) {
        // outputMapping maps context keys to expression paths in the current output
        // e.g. { "userId": "$.id" } means context.steps[node.id].extracted.userId = extracted.id
        const mapped: Record<string, unknown> = {};
        for (const [ctxKey, exprPath] of Object.entries(outputMapping)) {
          const { extractOutput: ex } = await import("./output-extractor");
          mapped[ctxKey] = ex(stepOutput, { mode: "json_path", jsonPath: exprPath });
        }
        finalExtracted = { ...extracted, ...mapped };
      }

      // â"€â"€ Store in run context â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const stepEntry: StepOutputEntry = {
        raw: sanitizeOutput(stepOutput),
        extracted: sanitizeOutput(finalExtracted),
        status: "succeeded",
        durationMs: Date.now() - stepStartMs,
        tokensUsed: stepTokens,
        estimatedCostUsd: stepCost,
      };
      context.steps[node.id] = stepEntry;
      // Also index by label for readability in templates
      if (node.data.label && typeof node.data.label === "string") {
        context.steps[node.data.label] = stepEntry;
      }

      await emitEvent(seqRef, {
        runId, workspaceId, type: "STEP_COMPLETED", status: "SUCCEEDED",
        title: `${node.data.label ?? nodeType} completed`,
        durationMs: Date.now() - stepStartMs,
        tokensUsed: stepTokens > 0 ? stepTokens : undefined,
        estimatedCostUsd: stepCost > 0 ? stepCost : undefined,
        outputJsonSanitized: sanitizeOutput(finalExtracted),
        source: "NATIVE",
      });

    } catch (err) {
      stepError = (err instanceof Error) ? err.message : String(err);

      // Check retry policy
      const retryPolicy = node.data.retryPolicyJson;
      const maxAttempts = retryPolicy?.maxAttempts ?? 1;

      // For now, single attempt only (retry would require re-queuing logic)
      context.steps[node.id] = {
        raw: null,
        extracted: null,
        status: "failed",
        durationMs: Date.now() - stepStartMs,
        errorMessage: stepError,
      };

      await emitEvent(seqRef, {
        runId, workspaceId, type: "STEP_FAILED", status: "FAILED",
        title: `${node.data.label ?? nodeType} failed: ${stepError.slice(0, 120)}`,
        durationMs: Date.now() - stepStartMs,
        errorJsonSanitized: { message: stepError },
        source: "NATIVE",
      });

      const durationMs = Date.now() - startMs;
      await updateRunStatus(runId, "failed", {
        error: { step: node.data.label, message: stepError },
        durationMs, totalTokens, estimatedCostUsd: totalCost,
      });

      await emitEvent(seqRef, {
        runId, workspaceId, type: "RUN_FAILED", status: "FAILED",
        title: `Run failed â€" ${workflowName}`,
        source: "SYSTEM",
      });

      return { status: "failed", errorMessage: stepError, totalTokens, estimatedCostUsd: totalCost, durationMs };
    }

    // â"€â"€ Advance to next node â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Try "success" edges first, then "default", then any edge (untyped graphs)
    let nextNodes = getSuccessors(graph, node.id, "success");
    if (nextNodes.length === 0) nextNodes = getSuccessors(graph, node.id, "default");
    if (nextNodes.length === 0) nextNodes = getSuccessors(graph, node.id); // untyped
    current = nextNodes[0] ?? null;
  }

  // â"€â"€ Run succeeded â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const durationMs = Date.now() - startMs;
  await updateRunStatus(runId, "succeeded", {
    output: sanitizeOutput(finalOutput),
    durationMs, totalTokens, estimatedCostUsd: totalCost,
  });

  await emitEvent(seqRef, {
    runId, workspaceId, type: "RUN_SUCCEEDED", status: "SUCCEEDED",
    title: `Run succeeded â€" ${workflowName}`,
    source: "SYSTEM",
  });

  return { status: "succeeded", finalOutput, totalTokens, estimatedCostUsd: totalCost, durationMs };
}
