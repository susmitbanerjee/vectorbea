/**
 * Shared helpers for mock agent endpoints.
 *
 * Mock agents are local Next.js API routes that simulate AI agent behavior.
 * They are safe to use as `endpointUrl` values in development/testing.
 * They update the AgentRun in the DB directly (no HTTP round-trip) so the
 * entire lifecycle is visible in the scheduler UI immediately.
 *
 * ── Request contract ──────────────────────────────────────────────────────────
 * All mock agent endpoints accept a JSON body:
 * {
 *   agentRunId?:          string   // if present, DB state will be updated
 *   resumeFromApproval?:  boolean  // true when scheduler resumes after approval
 *   approvalId?:          string   // present when resuming
 *   approvalDecision?:    "APPROVED" | "REJECTED"
 * }
 */

import { db } from "@/server/db";
import { getMockSession } from "@/server/auth/mock-session";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockStepResult {
  type: string;
  name: string;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface MockSuccessPayload {
  status: "succeeded";
  output: Record<string, unknown>;
  steps: MockStepResult[];
  usage: { totalTokens: number; estimatedCostUsd: number };
}

export interface MockFailurePayload {
  status: "failed";
  errorMessage: string;
}

export interface MockApprovalPayload {
  status: "requires_approval";
  approval: { title: string; message: string };
  partialOutput: Record<string, unknown>;
}

export type MockAgentPayload =
  | MockSuccessPayload
  | MockFailurePayload
  | MockApprovalPayload;

// ─── Request body ─────────────────────────────────────────────────────────────

export interface MockAgentRequest {
  agentRunId?: string;
  resumeFromApproval?: boolean;
  approvalId?: string;
  approvalDecision?: "APPROVED" | "REJECTED";
}

// ─── sleep ────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── DB lifecycle helpers ─────────────────────────────────────────────────────

/**
 * Mark a run as RUNNING (sets startedAt).
 * No-op if agentRunId is not provided or run is not found.
 */
export async function markRunning(agentRunId: string | undefined): Promise<void> {
  if (!agentRunId) return;
  try {
    await db.agentRun.updateMany({
      where: { id: agentRunId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  } catch {
    // best-effort
  }
}

/**
 * Mark a run SUCCEEDED, record usage, write audit log.
 */
export async function markSucceeded(
  agentRunId: string | undefined,
  usage: { totalTokens: number; estimatedCostUsd: number },
  startedAt: Date,
): Promise<void> {
  if (!agentRunId) return;
  const now = new Date();
  const durationMs = now.getTime() - startedAt.getTime();
  try {
    const session = await getMockSession();
    await db.$transaction([
      db.agentRun.updateMany({
        where: { id: agentRunId },
        data: {
          status: "SUCCEEDED",
          finishedAt: now,
          durationMs,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          errorMessage: null,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: session.organizationId,
          entityType: "AgentRun",
          entityId: agentRunId,
          action: "run.succeeded",
          metadataJson: {
            source: "mock-agent",
            durationMs,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
          },
        },
      }),
    ]);
  } catch {
    // best-effort
  }
}

/**
 * Mark a run FAILED with an error message, write audit log.
 */
export async function markFailed(
  agentRunId: string | undefined,
  errorMessage: string,
  startedAt: Date,
): Promise<void> {
  if (!agentRunId) return;
  const now = new Date();
  const durationMs = now.getTime() - startedAt.getTime();
  try {
    const session = await getMockSession();
    await db.$transaction([
      db.agentRun.updateMany({
        where: { id: agentRunId },
        data: {
          status: "FAILED",
          finishedAt: now,
          durationMs,
          errorMessage,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: session.organizationId,
          entityType: "AgentRun",
          entityId: agentRunId,
          action: "run.failed",
          metadataJson: { source: "mock-agent", errorMessage, durationMs },
        },
      }),
    ]);
  } catch {
    // best-effort
  }
}

/**
 * Mark a run WAITING_FOR_APPROVAL and create an ApprovalRequest.
 * Returns the created approval ID, or null on failure.
 */
export async function markWaitingForApproval(
  agentRunId: string | undefined,
  approval: { title: string; message: string },
): Promise<string | null> {
  if (!agentRunId) return null;
  try {
    const session = await getMockSession();

    const run = await db.agentRun.findFirst({
      where: { id: agentRunId, organizationId: session.organizationId },
      select: { id: true, status: true },
    });
    if (!run) return null;

    const [, approvalRecord] = await db.$transaction([
      db.agentRun.update({
        where: { id: agentRunId },
        data: { status: "WAITING_FOR_APPROVAL", startedAt: new Date() },
      }),
      db.approvalRequest.create({
        data: {
          organizationId: session.organizationId,
          agentRunId,
          status: "PENDING",
          title: approval.title,
          message: approval.message,
          requestedBySystem: true,
        },
        select: { id: true },
      }),
    ]);

    return approvalRecord.id;
  } catch {
    return null;
  }
}

/**
 * Mark a run TIMEOUT, write audit log.
 */
export async function markTimeout(
  agentRunId: string | undefined,
  startedAt: Date,
): Promise<void> {
  if (!agentRunId) return;
  const now = new Date();
  const durationMs = now.getTime() - startedAt.getTime();
  try {
    const session = await getMockSession();
    await db.$transaction([
      db.agentRun.updateMany({
        where: { id: agentRunId },
        data: {
          status: "TIMEOUT",
          finishedAt: now,
          durationMs,
          errorMessage: "Run timed out: exceeded maximum allowed duration.",
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: session.organizationId,
          entityType: "AgentRun",
          entityId: agentRunId,
          action: "run.timeout",
          metadataJson: { source: "mock-agent", durationMs },
        },
      }),
    ]);
  } catch {
    // best-effort
  }
}
