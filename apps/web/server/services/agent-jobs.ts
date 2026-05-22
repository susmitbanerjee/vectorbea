import "server-only";

import { Prisma } from "@/lib/generated/prisma";

import { db } from "@/server/db";
import { getBudgetUsage } from "@/server/services/budget-policy";
import type {
  CreateAgentJobInput,
  ListAgentJobsQuery,
  UpdateAgentJobInput,
} from "@/server/validation/agent-jobs";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

const JOB_DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  triggerType: true,
  cronExpression: true,
  timezone: true,
  endpointUrl: true,
  httpMethod: true,
  headersJson: true,
  maxDurationSeconds: true,
  maxRetries: true,
  retryBackoffSeconds: true,
  requireApprovalBeforeRun: true,
  requireApprovalBeforeExternalAction: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  budgetPolicy: true,
} satisfies Prisma.AgentJobSelect;

const RUN_SUMMARY_SELECT = {
  id: true,
  status: true,
  triggerSource: true,
  attemptNumber: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  estimatedCostUsd: true,
  totalTokens: true,
  errorMessage: true,
  createdAt: true,
} satisfies Prisma.AgentRunSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

export async function listAgentJobs(organizationId: string, query: ListAgentJobsQuery) {
  const { status, triggerType, search, page, pageSize } = query;

  const where: Prisma.AgentJobWhereInput = {
    organizationId,
    ...(status && { status }),
    ...(triggerType && { triggerType }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { endpointUrl: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [total, jobs] = await db.$transaction([
    db.agentJob.count({ where }),
    db.agentJob.findMany({
      where,
      select: JOB_DETAIL_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    jobs,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get by ID
// ─────────────────────────────────────────────────────────────────────────────

export async function getAgentJob(organizationId: string, jobId: string) {
  const job = await db.agentJob.findFirst({
    where: { id: jobId, organizationId },
    select: JOB_DETAIL_SELECT,
  });

  if (!job) throw new NotFoundError(`Agent job ${jobId} not found.`);

  // Last 10 runs
  const recentRuns = await db.agentRun.findMany({
    where: { agentJobId: jobId, organizationId },
    select: RUN_SUMMARY_SELECT,
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Success / failure counts across all runs
  const [successCount, failureCount, totalRuns] = await db.$transaction([
    db.agentRun.count({ where: { agentJobId: jobId, organizationId, status: "SUCCEEDED" } }),
    db.agentRun.count({
      where: { agentJobId: jobId, organizationId, status: { in: ["FAILED", "TIMEOUT"] } },
    }),
    db.agentRun.count({ where: { agentJobId: jobId, organizationId } }),
  ]);

  const budgetUsage = await getBudgetUsage(jobId, organizationId);

  return {
    job,
    recentRuns,
    stats: {
      totalRuns,
      successCount,
      failureCount,
      successRate: totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : null,
    },
    budgetUsage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createAgentJob(
  organizationId: string,
  userId: string,
  input: CreateAgentJobInput,
) {
  const { budgetPolicy, ...jobData } = input;

  const job = await db.$transaction(async (tx) => {
    const created = await tx.agentJob.create({
      data: {
        organizationId,
        createdByUserId: userId,
        name: jobData.name,
        description: jobData.description ?? null,
        status: "ACTIVE",
        triggerType: jobData.triggerType,
        cronExpression: jobData.cronExpression ?? null,
        timezone: jobData.timezone,
        endpointUrl: jobData.endpointUrl,
        httpMethod: jobData.httpMethod,
        headersJson: jobData.headersJson
          ? (jobData.headersJson as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        maxDurationSeconds: jobData.maxDurationSeconds,
        maxRetries: jobData.maxRetries,
        retryBackoffSeconds: jobData.retryBackoffSeconds,
        requireApprovalBeforeRun: jobData.requireApprovalBeforeRun,
        requireApprovalBeforeExternalAction: jobData.requireApprovalBeforeExternalAction,
      },
      select: JOB_DETAIL_SELECT,
    });

    if (budgetPolicy) {
      await tx.budgetPolicy.create({
        data: {
          organizationId,
          agentJobId: created.id,
          maxTokensPerRun: budgetPolicy.maxTokensPerRun ?? null,
          maxCostUsdPerRun: budgetPolicy.maxCostUsdPerRun ?? null,
          maxRunsPerDay: budgetPolicy.maxRunsPerDay ?? null,
          maxRunsPerMonth: budgetPolicy.maxRunsPerMonth ?? null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        entityType: "AgentJob",
        entityId: created.id,
        action: "job.created",
        metadataJson: { name: created.name, triggerType: created.triggerType },
      },
    });

    // Re-fetch with budgetPolicy included
    return tx.agentJob.findUniqueOrThrow({
      where: { id: created.id },
      select: JOB_DETAIL_SELECT,
    });
  });

  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

export async function updateAgentJob(
  organizationId: string,
  userId: string,
  jobId: string,
  input: UpdateAgentJobInput,
) {
  const existing = await db.agentJob.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, status: true },
  });

  if (!existing) throw new NotFoundError(`Agent job ${jobId} not found.`);
  if (existing.status === "ARCHIVED") {
    throw new ValidationError("Archived jobs cannot be updated. Restore the job first.");
  }

  const { budgetPolicy, ...jobFields } = input;

  // Build the Prisma update data — only include fields that were provided
  const updateData: Prisma.AgentJobUpdateInput = {};
  if (jobFields.name !== undefined) updateData.name = jobFields.name;
  if (jobFields.description !== undefined) updateData.description = jobFields.description ?? null;
  if (jobFields.status !== undefined) updateData.status = jobFields.status;
  if (jobFields.cronExpression !== undefined)
    updateData.cronExpression = jobFields.cronExpression ?? null;
  if (jobFields.timezone !== undefined) updateData.timezone = jobFields.timezone;
  if (jobFields.endpointUrl !== undefined) updateData.endpointUrl = jobFields.endpointUrl;
  if (jobFields.httpMethod !== undefined) updateData.httpMethod = jobFields.httpMethod;
  if (jobFields.headersJson !== undefined)
    updateData.headersJson = jobFields.headersJson
      ? (jobFields.headersJson as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  if (jobFields.maxDurationSeconds !== undefined)
    updateData.maxDurationSeconds = jobFields.maxDurationSeconds;
  if (jobFields.maxRetries !== undefined) updateData.maxRetries = jobFields.maxRetries;
  if (jobFields.retryBackoffSeconds !== undefined)
    updateData.retryBackoffSeconds = jobFields.retryBackoffSeconds;
  if (jobFields.requireApprovalBeforeRun !== undefined)
    updateData.requireApprovalBeforeRun = jobFields.requireApprovalBeforeRun;
  if (jobFields.requireApprovalBeforeExternalAction !== undefined)
    updateData.requireApprovalBeforeExternalAction =
      jobFields.requireApprovalBeforeExternalAction;

  const job = await db.$transaction(async (tx) => {
    const updated = await tx.agentJob.update({
      where: { id: jobId },
      data: updateData,
      select: JOB_DETAIL_SELECT,
    });

    // Budget policy: upsert if provided, delete if explicitly null
    if (budgetPolicy !== undefined) {
      if (budgetPolicy === null) {
        await tx.budgetPolicy.deleteMany({ where: { agentJobId: jobId } });
      } else {
        await tx.budgetPolicy.upsert({
          where: { agentJobId: jobId },
          create: {
            organizationId,
            agentJobId: jobId,
            maxTokensPerRun: budgetPolicy.maxTokensPerRun ?? null,
            maxCostUsdPerRun: budgetPolicy.maxCostUsdPerRun ?? null,
            maxRunsPerDay: budgetPolicy.maxRunsPerDay ?? null,
            maxRunsPerMonth: budgetPolicy.maxRunsPerMonth ?? null,
          },
          update: {
            maxTokensPerRun: budgetPolicy.maxTokensPerRun ?? null,
            maxCostUsdPerRun: budgetPolicy.maxCostUsdPerRun ?? null,
            maxRunsPerDay: budgetPolicy.maxRunsPerDay ?? null,
            maxRunsPerMonth: budgetPolicy.maxRunsPerMonth ?? null,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        entityType: "AgentJob",
        entityId: jobId,
        action: "job.updated",
        metadataJson: { changedFields: Object.keys(input) },
      },
    });

    return tx.agentJob.findUniqueOrThrow({
      where: { id: jobId },
      select: JOB_DETAIL_SELECT,
    });
  });

  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive  (soft delete)
// ─────────────────────────────────────────────────────────────────────────────

export async function archiveAgentJob(
  organizationId: string,
  userId: string,
  jobId: string,
) {
  const existing = await db.agentJob.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, status: true, name: true },
  });

  if (!existing) throw new NotFoundError(`Agent job ${jobId} not found.`);
  if (existing.status === "ARCHIVED") {
    throw new ValidationError(`Agent job "${existing.name}" is already archived.`);
  }

  await db.$transaction([
    db.agentJob.update({
      where: { id: jobId },
      data: { status: "ARCHIVED" },
    }),
    db.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        entityType: "AgentJob",
        entityId: jobId,
        action: "job.archived",
        metadataJson: { previousStatus: existing.status },
      },
    }),
  ]);

  return { id: jobId, status: "ARCHIVED" as const };
}
