package com.vectorbea.api.workers

import com.vectorbea.api.http.mapper
import com.vectorbea.api.redis.RedisProvider
import org.slf4j.LoggerFactory
import java.time.Instant

/**
 * Redis-backed store for worker heartbeat state.
 *
 * Workers write a heartbeat record on every tick (default every 15-30s).
 * The record expires automatically after [WorkerHeartbeat.ttlSeconds] so
 * stale workers are evicted without manual cleanup.
 *
 * Key pattern:
 *   worker:heartbeat:{workerId}
 *
 * Used by:
 *   - Worker status page (API polls this to show live worker list)
 *   - Run routing (prefer workers with matching capabilities)
 *   - Alerting (no heartbeat for N minutes → worker down)
 */
data class WorkerHeartbeat(
    val workerId: String,
    val hostname: String,
    val pid: Int,
    val version: String,
    val status: WorkerStatus,
    val currentRunId: String?,
    val runCount: Long,
    val uptimeSeconds: Long,
    val lastSeenAt: Instant,
    val capabilities: List<String> = emptyList(),
    val metadata: Map<String, String> = emptyMap(),
) {
    companion object {
        /** Default heartbeat TTL — worker is considered dead if missed for this long. */
        const val DEFAULT_TTL_SECONDS = 60L
    }
}

enum class WorkerStatus {
    IDLE,
    BUSY,
    DRAINING,
}

class WorkerHeartbeatRepository(
    private val redis: RedisProvider,
    private val ttlSeconds: Long = WorkerHeartbeat.DEFAULT_TTL_SECONDS,
    private val keyPrefix: String = "worker:heartbeat",
) {
    private val log = LoggerFactory.getLogger(WorkerHeartbeatRepository::class.java)

    // ── Key helpers ───────────────────────────────────────────────────────────

    private fun heartbeatKey(workerId: String) = "$keyPrefix:$workerId"
    private val workerIndexKey = "$keyPrefix:_index"  // sorted set: workerId → lastSeenAt epoch

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Upsert a worker heartbeat record.
     * The key expires after [ttlSeconds] — no heartbeat → auto-evicted.
     */
    fun setWorkerHeartbeat(heartbeat: WorkerHeartbeat) {
        val key = heartbeatKey(heartbeat.workerId)
        try {
            val json = mapper.writeValueAsString(heartbeat)
            redis.commands.setex(key, ttlSeconds, json)

            // Maintain a sorted set index so [listKnownWorkers] is efficient.
            // Score = epoch seconds — oldest entries can be pruned easily.
            val score = heartbeat.lastSeenAt.epochSecond.toDouble()
            redis.commands.zadd(workerIndexKey, score, heartbeat.workerId)
            // Keep the index from growing unboundedly — remove entries older than 2× TTL
            val cutoff = (Instant.now().epochSecond - ttlSeconds * 2).toDouble()
            redis.commands.zremrangebyscore(
                workerIndexKey,
                io.lettuce.core.Range.create(Double.NEGATIVE_INFINITY, cutoff),
            )
            log.debug("[heartbeat] set workerId={} status={}", heartbeat.workerId, heartbeat.status)
        } catch (e: Exception) {
            log.warn("[heartbeat] SET failed workerId={}: {}", heartbeat.workerId, e.message)
        }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Retrieve the latest heartbeat for a worker.
     * Returns null if the worker is unknown or the key has expired.
     */
    fun getWorkerHeartbeat(workerId: String): WorkerHeartbeat? {
        val key = heartbeatKey(workerId)
        return try {
            val json = redis.commands.get(key) ?: return null
            mapper.readValue(json, WorkerHeartbeat::class.java)
        } catch (e: Exception) {
            log.warn("[heartbeat] GET failed workerId={}: {}", workerId, e.message)
            null
        }
    }

    /**
     * List all workers that have sent a heartbeat recently.
     * Results are ordered by [WorkerHeartbeat.lastSeenAt] descending (most recent first).
     *
     * Workers with expired keys will have been evicted from the index automatically.
     */
    fun listKnownWorkers(): List<WorkerHeartbeat> {
        return try {
            // Get worker IDs from the sorted set (by score = epoch, descending)
            val workerIds = redis.commands.zrevrangebyscore(
                workerIndexKey,
                io.lettuce.core.Range.create(
                    (Instant.now().epochSecond - ttlSeconds).toDouble(),
                    Double.POSITIVE_INFINITY,
                ),
            )
            workerIds.mapNotNull { getWorkerHeartbeat(it) }
        } catch (e: Exception) {
            log.warn("[heartbeat] listKnownWorkers failed: {}", e.message)
            emptyList()
        }
    }

    /**
     * Remove a worker's heartbeat record explicitly (e.g. on graceful shutdown).
     */
    fun removeWorkerHeartbeat(workerId: String) {
        try {
            redis.commands.del(heartbeatKey(workerId))
            redis.commands.zrem(workerIndexKey, workerId)
            log.info("[heartbeat] removed workerId={}", workerId)
        } catch (e: Exception) {
            log.warn("[heartbeat] remove failed workerId={}: {}", workerId, e.message)
        }
    }
}
