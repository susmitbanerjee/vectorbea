/**
 * Connection Validator — Server-side only
 *
 * Validates all connections required by a workflow graph before run start
 * and during step execution. Blocks runs with missing/failed/unreachable
 * connections before any agent or tool code executes.
 *
 * Emits sanitized events — no secrets in messages.
 */

import "server-only";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionIssueSeverity = "blocking" | "warning";

export type ConnectionIssueCode =
  | "CONNECTION_MISSING"
  | "SECRET_MISSING"
  | "CONNECTION_DISABLED"
  | "CONNECTION_AUTH_FAILED"
  | "CONNECTION_UNREACHABLE"
  | "WHITELIST_REQUIRED"
  | "PRIVATE_RUNNER_REQUIRED"
  | "CONNECTION_TYPE_INCOMPATIBLE"
  | "CONNECTION_NOT_TESTED";

export interface ConnectionIssue {
  connectionId: string | null;
  connectionName: string;
  entityType: "agent" | "tool" | "workflow";
  entityId: string;
  entityName: string;
  severity: ConnectionIssueSeverity;
  code: ConnectionIssueCode;
  /** Sanitized — never contains secrets, URLs with credentials, or raw config */
  message: string;
  /** Actionable guidance shown in UI */
  remediation: string;
}

export interface ConnectionValidationResult {
  ok: boolean;
  blockingIssues: ConnectionIssue[];
  warnings: ConnectionIssue[];
}

// ─── Connection record shape from DB ─────────────────────────────────────────

interface ConnectionRow {
  id: string;
  name: string;
  type: string;
  status: string;
  auth_type: string;
  secret_ref: string | null;
  last_test_status: string | null;
  network_policy: {
    requireWhitelist?: boolean;
    privateRunnerRequired?: boolean;
  } | null;
}

// ─── Allowed connection status for running ────────────────────────────────────

const RUNNABLE_STATUSES = new Set(["connected", "not_tested"]);
const AUTH_FAILURE_STATUSES = new Set(["failed"]);

// ─── Validate a single connection row ────────────────────────────────────────

function validateConnectionRow(
  conn: ConnectionRow | null,
  entityType: "agent" | "tool",
  entityId: string,
  entityName: string,
  requiredType?: string,
): ConnectionIssue[] {
  const issues: ConnectionIssue[] = [];

  if (!conn) {
    issues.push({
      connectionId: null,
      connectionName: "Unknown connection",
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "CONNECTION_MISSING",
      message: `${entityType === "agent" ? "Agent" : "Tool"} "${entityName}" requires a connection that no longer exists.`,
      remediation: "Re-configure the connection in the Connections settings.",
    });
    return issues;
  }

  // Type compatibility check
  if (requiredType && conn.type !== requiredType) {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "CONNECTION_TYPE_INCOMPATIBLE",
      message: `Connection "${conn.name}" is type "${conn.type}" but "${entityName}" requires "${requiredType}".`,
      remediation: `Select a "${requiredType}" connection for "${entityName}".`,
    });
  }

  // Disabled
  if (conn.status === "disabled") {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "CONNECTION_DISABLED",
      message: `Connection "${conn.name}" is disabled.`,
      remediation: `Re-enable "${conn.name}" in Connections settings or select a different connection.`,
    });
    return issues; // No point checking further if disabled
  }

  // Secret missing
  if (conn.auth_type !== "none" && !conn.secret_ref) {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "SECRET_MISSING",
      message: `Connection "${conn.name}" has no credentials configured.`,
      remediation: `Add credentials to "${conn.name}" in Connections settings, then test the connection.`,
    });
  }

  // Missing secret status
  if (conn.status === "missing_secret") {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "SECRET_MISSING",
      message: `Connection "${conn.name}" is missing required credentials.`,
      remediation: `Add credentials to "${conn.name}" in Connections settings.`,
    });
  }

  // Auth failed
  if (AUTH_FAILURE_STATUSES.has(conn.status) && conn.last_test_status === "failed") {
    const np = conn.network_policy ?? {};

    if (np.requireWhitelist) {
      issues.push({
        connectionId: conn.id,
        connectionName: conn.name,
        entityType,
        entityId,
        entityName,
        severity: "blocking",
        code: "WHITELIST_REQUIRED",
        message: `Connection "${conn.name}" requires IP allowlisting. Vectorbea Cloud outbound IPs are not whitelisted on this host.`,
        remediation: "Add Vectorbea outbound IPs to your firewall/security group. Find them under Settings → Network Access.",
      });
    } else if (np.privateRunnerRequired) {
      issues.push({
        connectionId: conn.id,
        connectionName: conn.name,
        entityType,
        entityId,
        entityName,
        severity: "blocking",
        code: "PRIVATE_RUNNER_REQUIRED",
        message: `Connection "${conn.name}" is on a private network. A private runner is required to reach it from Vectorbea Cloud.`,
        remediation: "Configure a Vectorbea private runner inside your network perimeter.",
      });
    } else {
      issues.push({
        connectionId: conn.id,
        connectionName: conn.name,
        entityType,
        entityId,
        entityName,
        severity: "blocking",
        code: "CONNECTION_AUTH_FAILED",
        message: `Connection "${conn.name}" failed its last connectivity test. Check credentials and retry.`,
        remediation: `Go to Connections → "${conn.name}" → Test Connection to diagnose.`,
      });
    }
  }

  // Needs whitelist (status-based)
  if (conn.status === "needs_whitelist") {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "blocking",
      code: "WHITELIST_REQUIRED",
      message: `Connection "${conn.name}" requires IP allowlisting before Vectorbea Cloud can reach it.`,
      remediation: "Add Vectorbea outbound IPs to your firewall. Find them under Settings → Network Access.",
    });
  }

  // Not tested — warning only (allow but warn)
  if (conn.status === "not_tested" && !issues.some((i) => i.severity === "blocking")) {
    issues.push({
      connectionId: conn.id,
      connectionName: conn.name,
      entityType,
      entityId,
      entityName,
      severity: "warning",
      code: "CONNECTION_NOT_TESTED",
      message: `Connection "${conn.name}" has not been tested. The run will proceed but may fail if credentials are incorrect.`,
      remediation: `Test "${conn.name}" in Connections settings before running in production.`,
    });
  }

  return issues;
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validate all connections required by agents and tools in a workflow graph.
 *
 * @param workspaceId  Workspace scope — enforces tenant isolation
 * @param agentDefs    Array of { agentId, agentName, llmConnectionId }
 * @param toolDefs     Array of { toolId, toolName, connectionId, connectionType }
 */
export async function validateWorkflowConnections(
  workspaceId: string,
  agentDefs: Array<{ agentId: string; agentName: string; llmConnectionId: string | null }>,
  toolDefs: Array<{ toolId: string; toolName: string; connectionId: string | null; connectionType?: string }>,
): Promise<ConnectionValidationResult> {
  // Collect all unique connection IDs needed
  const neededIds = new Set<string>();
  for (const a of agentDefs) {
    if (a.llmConnectionId) neededIds.add(a.llmConnectionId);
  }
  for (const t of toolDefs) {
    if (t.connectionId) neededIds.add(t.connectionId);
  }

  if (neededIds.size === 0) {
    // No connections required — workflow has no LLM agents or external tools
    return { ok: true, blockingIssues: [], warnings: [] };
  }

  // Lazy DB import (this file may be used outside Next.js request context)
  const { db } = await import("@/server/db");
  const { Prisma } = await import("@/lib/generated/prisma");

  const idList = Array.from(neededIds);

  // Fetch all needed connections in one query, scoped to workspace
  const rows = await db.$queryRaw<ConnectionRow[]>(Prisma.sql`
    SELECT id, name, type, status, auth_type, secret_ref, last_test_status, network_policy
    FROM vectorbea.connections
    WHERE id = ANY(${idList}::text[])
      AND workspace_id = ${workspaceId}
  `).catch(() => [] as ConnectionRow[]);

  const connMap = new Map<string, ConnectionRow>(rows.map((r) => [r.id, r]));

  const allIssues: ConnectionIssue[] = [];

  // Validate LLM connections for agents
  for (const agent of agentDefs) {
    if (!agent.llmConnectionId) {
      allIssues.push({
        connectionId: null,
        connectionName: "LLM Connection",
        entityType: "agent",
        entityId: agent.agentId,
        entityName: agent.agentName,
        severity: "blocking",
        code: "CONNECTION_MISSING",
        message: `Agent "${agent.agentName}" has no LLM connection configured.`,
        remediation: `Configure an LLM connection for agent "${agent.agentName}" in the workflow builder.`,
      });
      continue;
    }
    const conn = connMap.get(agent.llmConnectionId) ?? null;
    allIssues.push(...validateConnectionRow(conn, "agent", agent.agentId, agent.agentName, "llm_provider"));
  }

  // Validate tool connections
  for (const tool of toolDefs) {
    if (!tool.connectionId) continue; // Some tools have no connection requirement
    const conn = connMap.get(tool.connectionId) ?? null;
    allIssues.push(...validateConnectionRow(conn, "tool", tool.toolId, tool.toolName, tool.connectionType));
  }

  const blockingIssues = allIssues.filter((i) => i.severity === "blocking");
  const warnings       = allIssues.filter((i) => i.severity === "warning");

  return {
    ok: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}
