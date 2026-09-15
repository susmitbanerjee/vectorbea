package com.vectorbea.worker.runner

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkflowRunJob
import com.vectorbea.worker.runtime.RunProcessor
import kotlinx.coroutines.runBlocking
import java.util.UUID
import javax.sql.DataSource

/**
 * The bridge between a leased run and the engine that executes it.
 *
 * ── THE RUN HAS TO EXIST LOCALLY BEFORE THE RUNTIME CAN TOUCH IT ────────────
 * `RunProcessor` and everything under it read and write `agent_runs`,
 * `run_events`, `run_checkpoints`, `run_waits` and `step_executions`. On a
 * platform worker those rows are already there, put there by the ingress. On a
 * runner they are not: the run was created in OUR database, and the runner has
 * no access to it — which is the entire point.
 *
 * So the lease response is materialised into the runner's OWN database first,
 * with the same ids. Everything the run then produces — every prompt, every
 * tool result, every checkpoint — is written there, inside the customer's
 * perimeter, and never travels.
 *
 * ── THE IDS ARE OURS, DELIBERATELY ──────────────────────────────────────────
 * Same `run_id`, same `workspace_id`, same `workflow_version_id`. A support
 * conversation has to be able to say "run 8f3a…" and have both sides mean the
 * same run, and a resume after a runner restart has to find its own checkpoints
 * under the id the hub knows.
 */
class RunnerExecution(
    private val dataSource: DataSource,
    private val processor: RunProcessor,
    /**
     * The graph, which the runner does not have.
     *
     * A runner's local database has no `workflows` or `workflow_versions` rows
     * unless somebody put them there. Two honest options: sync them, or have the
     * runner fetch the version it was handed. Neither is built here — what is
     * built is the seam, and a runner started without it fails loudly at the
     * first lease rather than executing an empty graph and reporting success.
     */
    private val versionSource: ((UUID) -> String?)? = null,
) {

    private val log = logger()

    /**
     * Execute a leased run locally, and report what may be reported.
     *
     * Returns metadata only. `RunnerAgent.Outcome` has no field that can carry a
     * payload, which is the second wall behind `RunnerReport`'s allow-list — one
     * on each side of the perimeter, and the one at the receiving end is the one
     * that holds when a runner is an old build.
     */
    fun execute(leased: RunnerAgent.LeasedRun): RunnerAgent.Outcome {
        val startedAt = System.currentTimeMillis()

        materialise(leased)

        val job = WorkflowRunJob(
            streamMessageId = "",
            jobType = WorkflowRunJob.JobType.START_RUN,
            runId = leased.runId,
            workflowId = leased.workflowId,
            triggeredBy = RUNNER_SOURCE,
            inputJson = leased.inputJson,
            retryCount = 0,
            nodeId = null,
            checkpointId = null,
            workspaceId = leased.workspaceId,
        )

        return try {
            runBlocking { processor.process(job) }
            val local = readTerminal(leased.runId)
            RunnerAgent.Outcome(
                status = local.status,
                durationMs = local.durationMs ?: (System.currentTimeMillis() - startedAt),
                tokenCount = local.tokenCount,
                estimatedCost = local.estimatedCost,
                /*
                 * A classification derived from the local status, never the
                 * local error TEXT. The text is in this runner's own database,
                 * inside the customer's network, which is where they asked for
                 * it to be.
                 */
                failureClassification = classify(local.status),
            )
        } catch (e: Exception) {
            log.error("[runner] local execution of {} threw {}",
                leased.runId, e.javaClass.simpleName)
            RunnerAgent.Outcome(
                status = "failed",
                durationMs = System.currentTimeMillis() - startedAt,
                tokenCount = null, estimatedCost = null,
                failureClassification = "error",
            )
        }
    }

    /**
     * Write the run, and the rows it references, into the local database.
     *
     * `ON CONFLICT DO NOTHING` throughout: a runner that crashed mid-run and
     * re-leased the same run finds its own rows still there, and must resume
     * from its checkpoints rather than starting again with a fresh row.
     */
    private fun materialise(leased: RunnerAgent.LeasedRun) {
        val graphJson = versionSource?.invoke(leased.workflowVersionId)
            ?: throw IllegalStateException(
                "This runner has no source for workflow version ${leased.workflowVersionId}. " +
                    "A runner executes a graph it holds locally; without one it would run an " +
                    "empty workflow and report success, which is worse than refusing.")

        dataSource.connection.use { c ->
            c.autoCommit = false
            try {
                c.prepareStatement(
                    "INSERT INTO workspaces (id, name, slug) VALUES (?,?,?) " +
                        "ON CONFLICT (id) DO NOTHING"
                ).use {
                    it.setObject(1, leased.workspaceId)
                    it.setString(2, "runner-local")
                    it.setString(3, "runner-${leased.workspaceId}")
                    it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO environments (id, workspace_id, name, slug, type) " +
                        "VALUES (?,?,'runner','runner','production') ON CONFLICT (id) DO NOTHING"
                ).use {
                    it.setObject(1, leased.environmentId); it.setObject(2, leased.workspaceId)
                    it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO workflows (id, workspace_id, environment_id, name, slug, status) " +
                        "VALUES (?,?,?,'runner-local',?,'active') ON CONFLICT (id) DO NOTHING"
                ).use {
                    it.setObject(1, leased.workflowId); it.setObject(2, leased.workspaceId)
                    it.setObject(3, leased.environmentId)
                    it.setString(4, "wf-${leased.workflowId}")
                    it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version, graph_json) " +
                        "VALUES (?,?,1,?::jsonb) ON CONFLICT (id) DO NOTHING"
                ).use {
                    it.setObject(1, leased.workflowVersionId); it.setObject(2, leased.workflowId)
                    it.setString(3, graphJson)
                    it.executeUpdate()
                }
                c.prepareStatement(
                    """INSERT INTO agent_runs
                         (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                          status, input_json, execution_class)
                       VALUES (?,?,?,?,?, 'queued', ?::jsonb, ?)
                       ON CONFLICT (id) DO NOTHING"""
                ).use {
                    it.setObject(1, leased.runId); it.setObject(2, leased.workspaceId)
                    it.setObject(3, leased.environmentId); it.setObject(4, leased.workflowId)
                    it.setObject(5, leased.workflowVersionId)
                    it.setString(6, leased.inputJson)
                    it.setString(7, leased.executionClass ?: "short")
                    it.executeUpdate()
                }
                c.commit()
            } catch (e: Exception) {
                runCatching { c.rollback() }
                throw e
            } finally {
                runCatching { c.autoCommit = true }
            }
        }
    }

    /** What the local database says about the finished run. */
    private data class Terminal(
        val status: String,
        val durationMs: Long?,
        val tokenCount: Int?,
        val estimatedCost: Double?,
    )

    private fun readTerminal(runId: UUID): Terminal = dataSource.connection.use { c ->
        c.prepareStatement(
            "SELECT status, duration_ms, token_count, estimated_cost FROM agent_runs WHERE id = ?"
        ).use { st ->
            st.setObject(1, runId)
            st.executeQuery().use { rs ->
                if (!rs.next()) Terminal("failed", null, null, null)
                else Terminal(
                    status = rs.getString("status") ?: "failed",
                    durationMs = rs.getObject("duration_ms")?.let { (it as Number).toLong() },
                    tokenCount = rs.getObject("token_count")?.let { (it as Number).toInt() },
                    estimatedCost = rs.getBigDecimal("estimated_cost")?.toDouble(),
                )
            }
        }
    }

    /** A word, from a status. Never from the error text, which stays local. */
    private fun classify(status: String): String? = when (status) {
        "succeeded" -> null
        "timed_out" -> "timeout"
        "cancelled" -> "cancelled"
        "ceiling_exceeded" -> "ceiling"
        else -> "error"
    }

    companion object {
        /** `triggeredBy` on a job a runner produced. Mirrors `PG_CLAIM_SOURCE`. */
        const val RUNNER_SOURCE = "self_hosted_runner"
    }
}
