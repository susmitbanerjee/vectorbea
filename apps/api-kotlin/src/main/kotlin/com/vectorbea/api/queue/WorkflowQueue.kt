package com.vectorbea.api.queue

import java.time.Instant
import java.util.UUID

/**
 * Represents a single unit of work placed on the workflow run queue.
 *
 * Security:
 *   - NEVER include connection strings, API keys, or secret refs in job payloads.
 *   - Secret resolution happens server-side during execution, not at enqueue time.
 *   - Input data is included as opaque JSON — the caller must strip secrets before enqueuing.
 */
data class WorkflowRunJob(
    /** Unique job ID — used for idempotency and deduplication. */
    val jobId: String = UUID.randomUUID().toString(),
    val runId: String,
    val workspaceId: String,
    val environmentId: String,
    val workflowId: String,
    val workflowVersionId: String,
    val jobType: JobType,
    val createdAt: Instant = Instant.now(),
    /** Number of attempts so far (0 = first attempt). */
    val attempt: Int = 0,
    /** Optional: resume from a specific node (used by RESUME_RUN, RETRY_NODE). */
    val resumeFromNodeId: String? = null,
    /**
     * Trigger input JSON — must NOT contain raw secrets.
     * Use placeholder references, resolved server-side at runtime.
     */
    val inputJson: String = "{}",
    /**
     * App user ID (UUID from app_users.id) of the user who triggered this run.
     * Derived from the verified AuthPrincipal — never from user-supplied headers.
     * Used for audit trail; does not affect execution.
     */
    val requestedByUserId: String? = null,
    /** True for "Debug Run" — instructs the worker to capture per-node debug snapshots. */
    val debugMode: Boolean = false,
)

enum class JobType {
    /** Start a fresh run from the beginning of the workflow. */
    START_RUN,
    /** Resume a paused/waiting run from where it left off. */
    RESUME_RUN,
    /** Retry a single failed node within an existing run. */
    RETRY_NODE,
    /** Replay a completed run (creates a new run). */
    REPLAY_RUN,
}

/**
 * Queue interface for dispatching workflow run jobs to workers.
 *
 * In the API service only [enqueue] is needed — workers will consume
 * from the same Redis Stream via a consumer group.
 *
 * If [enqueue] throws, the caller MUST NOT mark the run as "queued".
 * It should mark it as [enqueue_failed] or return an error to the client.
 */
interface WorkflowQueue {

    /**
     * Enqueue a [WorkflowRunJob] onto the stream.
     *
     * @return The Redis Stream message ID (e.g. "1718100000000-0") on success.
     * @throws WorkflowQueueException if Redis is unavailable or the write fails.
     */
    fun enqueue(job: WorkflowRunJob): String
}

/**
 * Thrown when a job cannot be placed on the queue.
 * Callers should NOT silently ignore this — the run must be marked failed.
 */
class WorkflowQueueException(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause)
