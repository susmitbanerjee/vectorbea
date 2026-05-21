import { Worker } from "bullmq";
import { db } from "./db";
import { redisConnection, type AgentRunJobData } from "./queues";

interface EndpointResponse {
  status?: "succeeded" | "requires_approval" | "failed";
  outputJson?: unknown;
  totalTokens?: number;
  estimatedCostUsd?: number;
  approvalTitle?: string;
  approvalMessage?: string;
  errorMessage?: string;
}

export function createExecutorWorker() {
  const worker = new Worker<AgentRunJobData>(
    "agent-run-queue",
    async (bullJob) => {
      const { agentRunId, agentJobId, organizationId } = bullJob.data;

      const agentJob = await db.agentJob.findFirst({
        where: { id: agentJobId, organizationId },
        select: {
          endpointUrl: true,
          httpMethod: true,
          headersJson: true,
          maxDurationSeconds: true,
          maxRetries: true,
          retryBackoffSeconds: true,
          requireApprovalBeforeRun: true,
          budgetPolicy: {
            select: {
              maxTokensPerRun: true,
              maxCostUsdPerRun: true,
            },
          },
        },
      });

      if (!agentJob) {
        console.error(`[executor] agentJob ${agentJobId} not found — dropping run ${agentRunId}`);
        await db.agentRun.update({
          where: { id: agentRunId },
          data: { status: "FAILED", errorMessage: "AgentJob not found", finishedAt: new Date() },
        });
        return;
      }

      // Mark run RUNNING
      await db.agentRun.update({
        where: { id: agentRunId },
        data: { status: "RUNNING", startedAt: new Date() },
      });

      await db.auditLog.create({
        data: {
          organizationId,
          entityType: "AgentRun",
          entityId: agentRunId,
          action: "run.started",
          metadataJson: { agentJobId, attempt: bullJob.attemptsMade + 1 },
        },
      });

      // Create the HTTP_CALL step
      const step = await db.agentRunStep.create({
        data: {
          organizationId,
          agentRunId,
          stepIndex: 0,
          stepType: "HTTP_CALL",
          name: "HTTP call to endpoint",
          status: "RUNNING",
          startedAt: new Date(),
        },
        select: { id: true },
      });

      const startMs = Date.now();
      let response: EndpointResponse;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          agentJob.maxDurationSeconds * 1000,
        );

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Vectorbea-Run-Id": agentRunId,
        };
        if (agentJob.headersJson && typeof agentJob.headersJson === "object") {
          Object.assign(headers, agentJob.headersJson);
        }

        const fetchResponse = await fetch(agentJob.endpointUrl, {
          method: agentJob.httpMethod,
          headers,
          body: agentJob.httpMethod !== "GET" ? JSON.stringify({ agentRunId, agentJobId }) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        response = (await fetchResponse.json()) as EndpointResponse;
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const durationMs = Date.now() - startMs;
        const errorMessage = isTimeout ? "Request timed out" : String(err);

        await db.$transaction([
          db.agentRunStep.update({
            where: { id: step.id },
            data: { status: "FAILED", errorMessage, finishedAt: new Date() },
          }),
          db.agentRun.update({
            where: { id: agentRunId },
            data: {
              status: isTimeout ? "TIMEOUT" : "FAILED",
              errorMessage,
              finishedAt: new Date(),
              durationMs,
            },
          }),
          db.auditLog.create({
            data: {
              organizationId,
              entityType: "AgentRun",
              entityId: agentRunId,
              action: isTimeout ? "run.timeout" : "run.failed",
              metadataJson: { errorMessage },
            },
          }),
        ]);

        // Re-throw so BullMQ can retry according to job options
        throw new Error(errorMessage);
      }

      const durationMs = Date.now() - startMs;
      const status = response.status ?? "succeeded";

      if (status === "requires_approval") {
        // Create approval gate step
        const approvalStep = await db.agentRunStep.create({
          data: {
            organizationId,
            agentRunId,
            stepIndex: 1,
            stepType: "APPROVAL_GATE",
            name: "Awaiting approval",
            status: "PENDING",
          },
          select: { id: true },
        });

        await db.$transaction([
          db.agentRunStep.update({
            where: { id: step.id },
            data: {
              status: "SUCCEEDED",
              outputJson: (response.outputJson as object) ?? {},
              finishedAt: new Date(),
            },
          }),
          db.agentRun.update({
            where: { id: agentRunId },
            data: { status: "WAITING_FOR_APPROVAL" },
          }),
          db.approvalRequest.create({
            data: {
              organizationId,
              agentRunId,
              agentRunStepId: approvalStep.id,
              title: response.approvalTitle ?? "Approval required",
              message: response.approvalMessage ?? "The agent is requesting approval before proceeding.",
              requestedBySystem: true,
            },
          }),
          db.auditLog.create({
            data: {
              organizationId,
              entityType: "AgentRun",
              entityId: agentRunId,
              action: "run.waiting_for_approval",
              metadataJson: { agentJobId },
            },
          }),
        ]);
        return;
      }

      if (status === "failed") {
        const errorMessage = response.errorMessage ?? "Endpoint reported failure";
        await db.$transaction([
          db.agentRunStep.update({
            where: { id: step.id },
            data: { status: "FAILED", errorMessage, finishedAt: new Date() },
          }),
          db.agentRun.update({
            where: { id: agentRunId },
            data: { status: "FAILED", errorMessage, finishedAt: new Date(), durationMs },
          }),
          db.auditLog.create({
            data: {
              organizationId,
              entityType: "AgentRun",
              entityId: agentRunId,
              action: "run.failed",
              metadataJson: { errorMessage },
            },
          }),
        ]);
        throw new Error(errorMessage);
      }

      // Succeeded
      const totalTokens = response.totalTokens ?? null;
      const estimatedCostUsd = response.estimatedCostUsd ?? null;

      // Budget post-check
      if (agentJob.budgetPolicy) {
        const { maxTokensPerRun, maxCostUsdPerRun } = agentJob.budgetPolicy;
        if (maxTokensPerRun != null && totalTokens != null && totalTokens > maxTokensPerRun) {
          console.warn(
            `[executor] run ${agentRunId} exceeded maxTokensPerRun: ${totalTokens} > ${maxTokensPerRun}`,
          );
        }
        if (
          maxCostUsdPerRun != null &&
          estimatedCostUsd != null &&
          estimatedCostUsd > Number(maxCostUsdPerRun)
        ) {
          console.warn(
            `[executor] run ${agentRunId} exceeded maxCostUsdPerRun: ${estimatedCostUsd} > ${maxCostUsdPerRun}`,
          );
        }
      }

      await db.$transaction([
        db.agentRunStep.update({
          where: { id: step.id },
          data: {
            status: "SUCCEEDED",
            outputJson: (response.outputJson as object) ?? {},
            tokensUsed: totalTokens,
            estimatedCostUsd: estimatedCostUsd != null ? String(estimatedCostUsd) : null,
            finishedAt: new Date(),
          },
        }),
        db.agentRun.update({
          where: { id: agentRunId },
          data: {
            status: "SUCCEEDED",
            outputJson: (response.outputJson as object) ?? {},
            totalTokens,
            estimatedCostUsd: estimatedCostUsd != null ? String(estimatedCostUsd) : null,
            finishedAt: new Date(),
            durationMs,
          },
        }),
        db.auditLog.create({
          data: {
            organizationId,
            entityType: "AgentRun",
            entityId: agentRunId,
            action: "run.succeeded",
            metadataJson: { durationMs, totalTokens, estimatedCostUsd },
          },
        }),
      ]);
    },
    {
      connection: redisConnection,
      concurrency: 10,
    },
  );

  worker.on("failed", async (bullJob, err) => {
    if (!bullJob) return;
    const { agentRunId, organizationId } = bullJob.data;
    // If no more retries, mark as permanently failed
    if (bullJob.attemptsMade >= (bullJob.opts.attempts ?? 1)) {
      await db.agentRun
        .update({
          where: { id: agentRunId },
          data: {
            status: "FAILED",
            errorMessage: err.message,
            finishedAt: new Date(),
          },
        })
        .catch(console.error);
      await db.auditLog
        .create({
          data: {
            organizationId,
            entityType: "AgentRun",
            entityId: agentRunId,
            action: "run.failed_permanently",
            metadataJson: { errorMessage: err.message, attempts: bullJob.attemptsMade },
          },
        })
        .catch(console.error);
    }
  });

  return worker;
}
