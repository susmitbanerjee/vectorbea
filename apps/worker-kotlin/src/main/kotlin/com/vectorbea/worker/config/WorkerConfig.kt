package com.vectorbea.worker.config

import org.slf4j.LoggerFactory

/**
 * Worker configuration — read exclusively from environment variables.
 *
 * SECURITY:
 *  - DATABASE_URL, REDIS_URL, SECRET_ENCRYPTION_KEY are NEVER logged.
 *  - Only their presence/absence is noted.
 *  - Production mode (APP_ENV=production) fails startup if any required
 *    infrastructure variable is absent.
 */
data class WorkerConfig(
    // ── Identity ─────────────────────────────────────────────────────────────
    val workerId: String,
    val workerName: String,
    val appEnv: String,
    val version: String,

    // ── DB — NEVER log the URL ───────────────────────────────────────────────
    val dbUrl: String,
    val dbMaxPoolSize: Int,
    val dbConnectionTimeoutMs: Long,

    // ── Redis — NEVER log the URL ────────────────────────────────────────────
    val redisUrl: String,
    val redisTlsEnabled: Boolean,
    val redisCommandTimeoutMs: Long,

    // ── Secret — NEVER log the value ────────────────────────────────────────
    /** Raw base64 key — decoded once at startup, then discarded as a String */
    val secretEncryptionKey: String?,

    // ── Queue ────────────────────────────────────────────────────────────────
    /** Legacy single stream. Consumed only while [legacyStreamEnabled]. */
    val queueStream: String,
    val queueGroup: String,
    /**
     * Whether to keep a consumer on the legacy untyped stream.
     *
     * True during migration so messages enqueued by a not-yet-upgraded API are
     * still executed. Set `WORKER_LEGACY_STREAM_ENABLED=false` once the legacy
     * stream has been drained and verified empty — see
     * docs/architecture/TYPED-QUEUE-MIGRATION.md.
     */
    val legacyStreamEnabled: Boolean,
    /**
     * Where the claim decision is made: "redis" | "postgres" | "dual".
     *
     * Defaults to "redis" so deploying this code changes nothing. "dual" runs
     * both while the streams drain — see TYPED-QUEUE-MIGRATION.md and
     * POSTGRES-CLAIM.md for the ordered cutover.
     */
    val claimMode: String,
    /** Legacy single-pool sizing — retained as the fallback for pool derivation. */
    val concurrency: Int,

    // ── Isolated execution pools (head-of-line-blocking protection) ───────────
    val shortConcurrency: Int,
    val longConcurrency: Int,
    val agentConcurrency: Int,
    /** The dispatched-child lane. Its own pool, so a parked supervisor's
     *  children do not queue behind new top-level runs. */
    val agentChildConcurrency: Int,
    val agentInteractiveConcurrency: Int,
    val systemConcurrency: Int,
    /**
     * Threads available for tenant-database node execution, isolated from every
     * pool above. A hanging tenant database can exhaust this and nothing else.
     */
    val tenantDbConcurrency: Int,

    // ── Pool-aware backpressure ──────────────────────────────────────────────
    /** Max messages to pull per XREADGROUP call (bounded prefetch). */
    val readBatchSize: Int,
    /** Strict per-pool local buffer size for messages awaiting a free slot. */
    val maxPrefetchPerPool: Int,
    /** Base sleep between idle/saturated poll iterations (backoff floor). */
    val pollSleepMs: Long,
    /** Upper bound on the adaptive poll backoff. */
    val pollMaxSleepMs: Long,
    /** Multiplier applied to the backoff on each consecutive idle/saturated iteration. */
    val pollBackoffMultiplier: Double,
    /** Random jitter (0..N ms) added to each backoff sleep to de-sync workers. */
    val pollJitterMs: Long,

    // ── Per-tenant fairness ──────────────────────────────────────────────────
    val maxActiveRunsPerTenant: Int,
    val maxActiveAgentRunsPerTenant: Int,
    val maxActiveLongRunsPerTenant: Int,
    val maxActiveShortRunsPerTenant: Int,

    // ── Graceful shutdown ────────────────────────────────────────────────────
    val shutdownTimeoutMs: Long,

    // ── Polling ──────────────────────────────────────────────────────────────
    /** Milliseconds XREADGROUP blocks waiting for new messages */
    val pollBlockMs: Long,
    /** Max messages to pull per XREADGROUP call */
    val pollBatchSize: Int,

    // ── Heartbeat ────────────────────────────────────────────────────────────
    val heartbeatIntervalMs: Long,
    /** Redis TTL for the heartbeat key — should be > heartbeatIntervalMs */
    val heartbeatTtlSeconds: Long,
) {
    val isProduction: Boolean get() = appEnv == "production"
    val isDev: Boolean get() = appEnv == "development" || appEnv == "local"

    companion object {
        private val log = LoggerFactory.getLogger(WorkerConfig::class.java)

        fun fromEnv(): WorkerConfig {
            val appEnv = env("APP_ENV") ?: "development"
            val isProd = appEnv == "production"

            // ── Required infrastructure ──────────────────────────────────────
            val dbUrl = requireSecret("DATABASE_URL", isProd)
            val redisUrl = requireSecret("REDIS_URL", isProd)

            // ── Secret key — required in production ──────────────────────────
            val secretKey = env("SECRET_ENCRYPTION_KEY")
            if (secretKey == null) {
                if (isProd) throw IllegalStateException(
                    "SECRET_ENCRYPTION_KEY is required in production"
                )
                log.warn("[config] SECRET_ENCRYPTION_KEY not set — secret decryption unavailable")
            }

            // ── Worker identity ──────────────────────────────────────────────
            val workerId = env("WORKER_ID")
                ?: "worker-${java.net.InetAddress.getLocalHost().hostName}-${ProcessHandle.current().pid()}"
            val workerName = env("WORKER_NAME") ?: workerId

            val concurrency = env("WORKER_CONCURRENCY")?.toIntOrNull()?.coerceIn(1, 32) ?: 4

            // ── Pool sizing ──────────────────────────────────────────────────
            // Each pool now has its own knob. Deriving all four from a single
            // WORKER_CONCURRENCY was the root of §1.4: raising agent capacity
            // meant raising *every* pool, so nobody did, and the agent pool sat
            // at max(1, 4/2) = 2 slots platform-wide.
            //
            // Resolution order, first match wins:
            //   1. WORKER_POOL_AGENT        — the current name
            //   2. AGENT_WORKER_CONCURRENCY — the previous name, still honoured
            //   3. the WORKER_CONCURRENCY formula — unchanged, so a worker with
            //      no new variables set behaves exactly as before
            //
            // AGENT defaults to 6 (09-EXECUTION-ARCHITECTURE-REVISED §5 stage 1).
            // Every agent slot is a thread parked on an LLM socket, so this is
            // bounded by threads and heap, not CPU — see docs/architecture/
            // STAGE-1-CAPACITY.md for the measured ceiling.
            val shortConcurrency  = poolSize("SHORT",  "SHORT_WORKER_CONCURRENCY")  ?: maxOf(8, concurrency)
            val longConcurrency   = poolSize("LONG",   "LONG_WORKER_CONCURRENCY")   ?: maxOf(1, concurrency / 2)
            val agentConcurrency  = poolSize("AGENT",  "AGENT_WORKER_CONCURRENCY")  ?: maxOf(6, concurrency / 2)
            val agentChildConcurrency = poolSize("AGENT_CHILD", "AGENT_CHILD_WORKER_CONCURRENCY")
                ?: agentConcurrency
            val agentInteractiveConcurrency =
                poolSize("AGENT_INTERACTIVE", "AGENT_INTERACTIVE_WORKER_CONCURRENCY")
                    ?: (agentConcurrency / 2).coerceAtLeast(1)
            val systemConcurrency = poolSize("SYSTEM", "SYSTEM_WORKER_CONCURRENCY") ?: 2

            // Tenant-database node execution runs on its own dispatcher, sized
            // independently of every pool above. See TenantDbDispatcher.
            val tenantDbConcurrency = env("WORKER_POOL_TENANT_DB")?.toIntOrNull() ?: 16

            // Hoisted: the Redis command timeout is derived from it below.
            val pollBlockMs = env("WORKER_POLL_BLOCK_MS")?.toLongOrNull() ?: 5_000L

            val config = WorkerConfig(
                workerId = workerId,
                workerName = workerName,
                appEnv = appEnv,
                version = env("APP_VERSION") ?: "0.1.0",
                dbUrl = dbUrl ?: "jdbc:postgresql://localhost:5432/vectorbea",
                // Each in-flight run needs several short-lived connections (status,
                // events, checkpoints, step outputs) plus background loops
                // (heartbeat, timers, crash recovery). Size the pool to the
                // concurrency so event writes don't starve under load.
                dbMaxPoolSize = env("DB_POOL_MAX_SIZE")?.toIntOrNull() ?: (concurrency * 2 + 6),
                dbConnectionTimeoutMs = env("DB_CONNECTION_TIMEOUT_MS")?.toLongOrNull() ?: 30_000L,
                redisUrl = redisUrl ?: "redis://localhost:6379",
                redisTlsEnabled = env("REDIS_TLS_ENABLED")?.lowercase() == "true",
                // The Lettuce command timeout MUST exceed the XREADGROUP BLOCK
                // window, or every idle poll aborts as a timeout and the loop
                // spins on errors instead of blocking cheaply. The old default
                // (3s) was below the default block window (5s), so a worker
                // started without REDIS_COMMAND_TIMEOUT_MS logged an error every
                // iteration — a timeout firing on entirely healthy operation.
                redisCommandTimeoutMs = env("REDIS_COMMAND_TIMEOUT_MS")?.toLongOrNull()
                    ?: (pollBlockMs + 5_000L),
                secretEncryptionKey = secretKey,
                queueStream = env("WORKER_QUEUE_STREAM") ?: "workflow-runs",
                queueGroup = env("WORKER_QUEUE_GROUP") ?: "workflow-workers",
                // Default true: a worker deployed before the API still needs to
                // see legacy messages. Flipping to false is the last migration step.
                legacyStreamEnabled = env("WORKER_LEGACY_STREAM_ENABLED")?.lowercase() != "false",
                claimMode = (env("WORKER_CLAIM_MODE") ?: "redis").lowercase(),
                concurrency = concurrency,
                shortConcurrency  = shortConcurrency.coerceIn(1, 64),
                longConcurrency   = longConcurrency.coerceIn(1, 32),
                agentConcurrency  = agentConcurrency.coerceIn(1, 32),
                agentChildConcurrency = agentChildConcurrency.coerceIn(1, 32),
                agentInteractiveConcurrency = agentInteractiveConcurrency.coerceIn(1, 32),
                systemConcurrency = systemConcurrency.coerceIn(1, 16),
                tenantDbConcurrency = tenantDbConcurrency.coerceIn(1, 64),
                readBatchSize       = env("WORKER_READ_BATCH_SIZE")?.toIntOrNull()?.coerceIn(1, 50) ?: 8,
                // Raised 2 → 4. A buffered message is held in this JVM and will
                // be placed as soon as a slot frees; a *parked* message is left
                // unacked in the PEL where no worker can touch it until the idle
                // threshold expires. Trading a little heap for fewer parks is a
                // good trade: 4 × 4 pools × one small job object.
                maxPrefetchPerPool  = env("WORKER_MAX_PREFETCH_PER_POOL")?.toIntOrNull()?.coerceIn(0, 20) ?: 4,
                pollSleepMs         = env("WORKER_POLL_SLEEP_MS")?.toLongOrNull() ?: 200L,
                pollMaxSleepMs      = env("WORKER_POLL_MAX_SLEEP_MS")?.toLongOrNull() ?: 2_000L,
                pollBackoffMultiplier = env("WORKER_POLL_BACKOFF_MULTIPLIER")?.toDoubleOrNull() ?: 1.5,
                pollJitterMs        = env("WORKER_POLL_JITTER_MS")?.toLongOrNull() ?: 100L,
                maxActiveRunsPerTenant      = env("MAX_ACTIVE_RUNS_PER_TENANT")?.toIntOrNull() ?: 2,
                maxActiveAgentRunsPerTenant = env("MAX_ACTIVE_AGENT_RUNS_PER_TENANT")?.toIntOrNull() ?: 1,
                maxActiveLongRunsPerTenant  = env("MAX_ACTIVE_LONG_RUNS_PER_TENANT")?.toIntOrNull() ?: 1,
                maxActiveShortRunsPerTenant = env("MAX_ACTIVE_SHORT_RUNS_PER_TENANT")?.toIntOrNull() ?: 4,
                shutdownTimeoutMs   = env("WORKER_SHUTDOWN_TIMEOUT_MS")?.toLongOrNull() ?: 30_000L,
                pollBlockMs = pollBlockMs,
                pollBatchSize = env("WORKER_POLL_BATCH_SIZE")?.toIntOrNull()?.coerceIn(1, 50) ?: 10,
                heartbeatIntervalMs = env("WORKER_HEARTBEAT_INTERVAL_MS")?.toLongOrNull() ?: 15_000L,
                heartbeatTtlSeconds = env("WORKER_HEARTBEAT_TTL_SECONDS")?.toLongOrNull() ?: 60L,
            )

            config.logSummary()
            return config
        }

        private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

        /**
         * Explicit size for one pool: `WORKER_POOL_<NAME>`, falling back to the
         * pre-existing `<NAME>_WORKER_CONCURRENCY` alias. Returns null when
         * neither is set, so the caller applies the WORKER_CONCURRENCY formula
         * and an untouched deployment keeps its current behaviour.
         */
        private fun poolSize(name: String, legacyAlias: String): Int? =
            env("WORKER_POOL_$name")?.toIntOrNull() ?: env(legacyAlias)?.toIntOrNull()

        private fun requireSecret(name: String, failIfAbsent: Boolean): String? {
            val value = env(name)
            if (value == null) {
                if (failIfAbsent) throw IllegalStateException("$name is required in production")
                log.warn("[config] $name not set — using fallback (non-production only)")
            }
            return value
        }
    }

    private fun logSummary() {
        log.info("=== vectorbea-worker config ===")
        log.info("  workerId    : $workerId")
        log.info("  workerName  : $workerName")
        log.info("  env         : $appEnv")
        log.info("  version     : $version")
        log.info("  database    : ${if (dbUrl.isNotBlank()) "configured (pool=$dbMaxPoolSize)" else "NOT SET"}")
        log.info("  redis       : ${if (redisUrl.isNotBlank()) "configured (tls=$redisTlsEnabled)" else "NOT SET"}")
        log.info("  secret key  : ${if (secretEncryptionKey != null) "present" else "NOT SET"}")
        log.info("  claim mode  : $claimMode${if (claimMode == "dual") " — Postgres claim + Redis streams draining" else ""}")
        log.info("  streams     : runs.short / runs.long / runs.agent / runs.system (typed)")
        log.info("  legacy      : ${if (legacyStreamEnabled) "$queueStream / group=$queueGroup (DUAL-CONSUME ACTIVE)" else "disabled"}")
        log.info("  concurrency : $concurrency (fallback formula only)")
        log.info("  pools       : short=$shortConcurrency long=$longConcurrency agent=$agentConcurrency " +
            "agent.child=$agentChildConcurrency agent.interactive=$agentInteractiveConcurrency " +
            "system=$systemConcurrency")
        log.info("  tenant-db   : $tenantDbConcurrency threads (isolated dispatcher)")
        log.info("  max run threads: ${shortConcurrency + longConcurrency + agentConcurrency + systemConcurrency} pool + $tenantDbConcurrency tenant-db")
        log.info("  prefetch    : readBatch=$readBatchSize perPoolBuffer=$maxPrefetchPerPool")
        log.info("  poll backoff: base=${pollSleepMs}ms max=${pollMaxSleepMs}ms x$pollBackoffMultiplier jitter=${pollJitterMs}ms")
        log.info("  tenant caps : total=$maxActiveRunsPerTenant agent=$maxActiveAgentRunsPerTenant long=$maxActiveLongRunsPerTenant short=$maxActiveShortRunsPerTenant (DEFAULTS — per-workspace policy overrides)")
        log.info("  fairness    : shared state (run_leases) — limits are replica-count independent")
        log.info("  shutdown    : ${shutdownTimeoutMs}ms")
        log.info("  pollBlockMs : $pollBlockMs (redis command timeout=${redisCommandTimeoutMs}ms — must exceed it)")
        log.info("  heartbeat   : every ${heartbeatIntervalMs}ms (ttl=${heartbeatTtlSeconds}s)")
        // !! NEVER log: dbUrl, redisUrl, secretEncryptionKey !!
    }
}
