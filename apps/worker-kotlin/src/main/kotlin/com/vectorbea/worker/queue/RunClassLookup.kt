package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Reads a run's stored `execution_class` so a continuation can be re-enqueued
 * onto the stream it belongs on.
 *
 * WHY READ INSTEAD OF RE-DERIVE
 * -----------------------------
 * A RESUME_RUN after a cooperative yield is the *same run*, half-finished. It
 * must land in the same pool it was already occupying, and the authoritative
 * answer to which pool that is was written once, at trigger, into
 * `agent_runs.execution_class`.
 *
 * Re-deriving it here would be wrong twice over: it would reintroduce the graph
 * probe that typing the queue exists to delete, and it would let a continuation
 * drift to a different pool from its own first half if the classifier ever
 * changed — a run that starts on `runs.agent` and resumes on `runs.short` would
 * quietly defeat every capacity guarantee the split provides.
 *
 * The per-run cache is safe for the same reason as the API's version cache: a
 * run's class is immutable once written.
 */
class RunClassLookup(private val dataSource: DataSource) {

    private val log = logger()
    private val cache = java.util.concurrent.ConcurrentHashMap<UUID, WorkerJobType>()

    companion object {
        private const val SAFETY_LIMIT = 20_000
    }

    /**
     * The class for [runId]. Falls back to [WorkerJobType.SHORT] when the row or
     * column cannot be read — a continuation that cannot be classified still has
     * to run, and SHORT is the smallest claim on capacity.
     */
    fun classOf(runId: UUID): WorkerJobType {
        cache[runId]?.let { return it }
        val resolved = try {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT execution_class FROM agent_runs WHERE id = ?").use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) fromWire(rs.getString("execution_class")) else WorkerJobType.SHORT
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[class] could not read execution_class for run {} — defaulting to short: {}",
                runId, e.message)
            WorkerJobType.SHORT
        }
        if (cache.size >= SAFETY_LIMIT) cache.clear()
        cache[runId] = resolved
        return resolved
    }

    /** Drop a finished run from the cache. */
    fun forget(runId: UUID) {
        cache.remove(runId)
    }

    private fun fromWire(value: String?): WorkerJobType =
        WorkerJobType.entries.firstOrNull { it.name.equals(value?.trim(), ignoreCase = true) }
            ?: WorkerJobType.SHORT
}
