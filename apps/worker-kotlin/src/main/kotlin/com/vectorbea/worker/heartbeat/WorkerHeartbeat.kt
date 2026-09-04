package com.vectorbea.worker.heartbeat

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.logging.logger
import io.lettuce.core.api.sync.RedisCommands
import java.sql.Timestamp
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.sql.DataSource

/**
 * Periodic worker heartbeat — writes to both Redis and Postgres.
 *
 * Redis:
 *   HSET worker:{workerId} field value ...
 *   EXPIRE worker:{workerId} {ttlSeconds}
 *
 * Postgres:
 *   INSERT INTO workers ... ON CONFLICT (id) DO UPDATE SET ...
 *
 * The heartbeat runs on a dedicated daemon thread via [ScheduledExecutorService].
 * Failures are logged but not fatal — a missed beat is recovered on the next tick.
 *
 * [activeTasks] is updated by [RunProcessor] to reflect current load.
 */
class WorkerHeartbeat(
    private val config: WorkerConfig,
    private val redis: RedisCommands<String, String>,
    private val dataSource: DataSource,
) {
    private val log = logger()

    val activeTasks = AtomicInteger(0)
    val status = AtomicReference(WorkerStatus.STARTING)

    /**
     * Total execution slots this worker actually has.
     *
     * `config.concurrency` is only the fallback formula's input and has not
     * described real capacity since pool sizing was decoupled — reporting it
     * would tell the Control page a 6-agent-slot worker had 4 slots in total.
     * Headroom is only meaningful against the real number.
     */
    private val totalCapacity: Int =
        config.shortConcurrency + config.longConcurrency +
        config.agentConcurrency + config.systemConcurrency

    private val scheduler: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "worker-heartbeat").also { it.isDaemon = true }
        }

    private val redisKey = "worker:${config.workerId}"

    enum class WorkerStatus(val value: String) {
        STARTING("starting"),
        IDLE("idle"),
        RUNNING("running"),
        DRAINING("draining"),
        STOPPED("stopped"),
    }

    /** Start the heartbeat loop. Fires immediately, then at [WorkerConfig.heartbeatIntervalMs]. */
    fun start() {
        status.set(WorkerStatus.IDLE)
        log.info("[heartbeat] starting (interval={}ms, ttl={}s)",
            config.heartbeatIntervalMs, config.heartbeatTtlSeconds)

        scheduler.scheduleAtFixedRate(
            ::beat,
            0L,
            config.heartbeatIntervalMs,
            TimeUnit.MILLISECONDS,
        )
    }

    /** Mark the worker as draining and send a final heartbeat. */
    fun drain() {
        status.set(WorkerStatus.DRAINING)
        beat()  // immediate drain heartbeat
    }

    /** Mark the worker as stopped, write final heartbeat, shut down scheduler. */
    fun stop() {
        status.set(WorkerStatus.STOPPED)
        beat()
        scheduler.shutdownNow()
        log.info("[heartbeat] stopped")
    }

    /** Increment active task count (call when a job is claimed). */
    fun taskStarted() { activeTasks.incrementAndGet() }

    /** Decrement active task count (call when a job finishes or errors). */
    fun taskFinished() { activeTasks.decrementAndGet() }

    // ── Beat ──────────────────────────────────────────────────────────────────

    private fun beat() {
        val now = Instant.now()
        val active = activeTasks.get()
        val st = status.get()

        try {
            writeRedisHeartbeat(now, active, st)
        } catch (e: Exception) {
            log.warn("[heartbeat] Redis write failed: {}", e.message)
        }

        try {
            writeDbHeartbeat(now, active, st)
        } catch (e: Exception) {
            log.warn("[heartbeat] DB write failed: {}", e.message)
        }

        log.debug("[heartbeat] beat [status={}, activeTasks={}]", st.value, active)
    }

    private fun writeRedisHeartbeat(now: Instant, active: Int, st: WorkerStatus) {
        redis.hset(redisKey, buildMap {
            put("workerId", config.workerId)
            put("name", config.workerName)
            put("status", st.value)
            put("queue", config.queueStream)
            put("capacity", totalCapacity.toString())
            put("activeTasks", active.toString())
            put("version", config.version)
            put("lastHeartbeatAt", now.toString())
            put("appEnv", config.appEnv)
        })
        redis.expire(redisKey, config.heartbeatTtlSeconds)
    }

    private fun writeDbHeartbeat(now: Instant, active: Int, st: WorkerStatus) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(UPSERT_SQL).use { stmt ->
                stmt.setString(1, config.workerId)
                stmt.setString(2, config.workerName)
                stmt.setString(3, st.value)
                stmt.setString(4, config.queueStream)
                stmt.setInt(5, totalCapacity)
                stmt.setInt(6, active)
                stmt.setTimestamp(7, Timestamp.from(now))
                stmt.setString(8, config.version)
                // ON CONFLICT SET uses EXCLUDED.* — no extra parameters needed
                stmt.executeUpdate()
            }
        }
    }

    companion object {
        /**
         * Fleet registration. `workspace_id` / `environment_id` are explicitly
         * NULL: a worker serves every tenant on the queue and has no workspace to
         * name at boot.
         *
         * V006 made those columns NOT NULL as part of a workspace-scoping pass,
         * and because this statement never supplied them, EVERY heartbeat write
         * failed from that migration onward — silently, since the failure is
         * caught and logged at WARN and the loop continues. That is why the
         * `workers` table read as "unused telemetry" (§6.5): nothing could write
         * to it. V021 restores them to nullable.
         */
        private val UPSERT_SQL = """
            INSERT INTO workers
                (id, name, status, queue, capacity, active_tasks, last_heartbeat_at, version,
                 workspace_id, environment_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            ON CONFLICT (id) DO UPDATE SET
                name              = EXCLUDED.name,
                status            = EXCLUDED.status,
                active_tasks      = EXCLUDED.active_tasks,
                last_heartbeat_at = EXCLUDED.last_heartbeat_at,
                version           = EXCLUDED.version,
                updated_at        = now()
        """.trimIndent()
    }
}
