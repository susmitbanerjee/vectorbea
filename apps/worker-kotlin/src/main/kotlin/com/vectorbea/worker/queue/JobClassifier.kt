package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Maps a [WorkflowRunJob] to a [WorkerJobType] so the consumer can route it to
 * an isolated execution pool and apply the right tenant-fairness limits.
 *
 * Design constraints:
 *  - Conservative: when evidence is weak we prefer [WorkerJobType.SHORT] (the
 *    spec's default) rather than guessing LONG/AGENT.
 *  - Cheap: command type alone decides most jobs. Only fresh START/REPLAY (and
 *    yield resumes) probe the workflow graph, and that probe is a single small
 *    query whose result is cached by workflow version. We never pull the full
 *    workflow JSON into the Redis message — classification reads from the DB,
 *    the source of truth.
 *
 * Classification rules:
 *  - Operational continuations (timer/approval/cancel/recovery resumes) → SYSTEM,
 *    so they are never starved by long/agent workloads. With cooperative yielding
 *    each tick is bounded, so SYSTEM ticks stay short by construction.
 *  - Fresh runs (START/REPLAY) and yield-resumes → probe the graph: AGENT if it
 *    contains LLM/agent/tool nodes, LONG if it is large or HTTP-heavy, else SHORT.
 */
class JobClassifier(
    private val dataSource: DataSource,
    /** A graph with at least this many nodes is treated as LONG. */
    private val longNodeThreshold: Int = (System.getenv("WORKER_LONG_NODE_THRESHOLD")?.toIntOrNull() ?: 12),
    /** Cap on the per-version classification cache; cleared wholesale when exceeded. */
    private val maxCacheEntries: Int = 5_000,
) {
    private val log = logger()

    /** workflowVersionId → classification. Bounded; classification is stable per version. */
    private val cache = ConcurrentHashMap<UUID, WorkerJobType>()

    /** triggeredBy prefixes that mark an operational continuation (must not be starved). */
    private val systemTriggers = listOf("timer:", "approval", "cancel", "recovery", "crash", "system")

    fun classify(job: WorkflowRunJob): WorkerJobType = try {
        when (job.jobType) {
            WorkflowRunJob.JobType.RESUME_RUN,
            WorkflowRunJob.JobType.RETRY_NODE -> {
                val trigger = job.triggeredBy.lowercase()
                if (systemTriggers.any { trigger.startsWith(it) || trigger.contains(it) }) {
                    WorkerJobType.SYSTEM
                } else {
                    // e.g. a yield-resume — keep it on its workload's own pool.
                    probeWorkflow(job.runId)
                }
            }
            WorkflowRunJob.JobType.START_RUN,
            WorkflowRunJob.JobType.REPLAY_RUN -> probeWorkflow(job.runId)
            WorkflowRunJob.JobType.UNKNOWN -> WorkerJobType.SHORT
        }
    } catch (e: Exception) {
        // Never let classification failure block the queue — default to SHORT.
        log.warn("[classifier] classification failed [runId={}] — defaulting SHORT: {}", job.runId, e.message)
        WorkerJobType.SHORT
    }

    /**
     * Probe the workflow graph for this run and classify it. Single small query,
     * cached by workflow version. Returns SHORT when the graph can't be read.
     */
    private fun probeWorkflow(runId: UUID): WorkerJobType {
        val (versionId, graphJson) = loadGraph(runId) ?: return WorkerJobType.SHORT
        cache[versionId]?.let { return it }
        val result = classifyGraph(graphJson)
        if (cache.size >= maxCacheEntries) cache.clear()
        cache[versionId] = result
        return result
    }

    private fun loadGraph(runId: UUID): Pair<UUID, String>? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT wv.id, wv.graph_json
                   FROM agent_runs ar
                   JOIN workflow_versions wv ON wv.id = ar.workflow_version_id
                   WHERE ar.id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return null
                    val versionId = UUID.fromString(rs.getString(1))
                    val graph = rs.getString(2) ?: return null
                    versionId to graph
                }
            }
        }

    /**
     * Cheap heuristic over the raw graph JSON — no full parse. We only need a
     * coarse class, and node `"type"` values are stable strings in the graph.
     */
    private fun classifyGraph(graphJson: String): WorkerJobType {
        val g = graphJson.lowercase()
        val agentLike = AGENT_MARKERS.any { g.contains(it) }
        if (agentLike) return WorkerJobType.AGENT

        // Approximate node count by counting `"type"` keys.
        val nodeCount = TYPE_KEY.findAll(g).count()
        val httpHeavy = g.contains("\"http\"") || g.contains("\"db_query\"") || g.contains("\"db_write\"")
        return if (nodeCount >= longNodeThreshold || httpHeavy) WorkerJobType.LONG else WorkerJobType.SHORT
    }

    companion object {
        private val AGENT_MARKERS = listOf("\"llm\"", "\"agent\"", "\"tool\"")
        private val TYPE_KEY = Regex("\"type\"\\s*:")
    }
}
