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
    val queueStream: String,
    val queueGroup: String,
    val concurrency: Int,

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
                redisCommandTimeoutMs = env("REDIS_COMMAND_TIMEOUT_MS")?.toLongOrNull() ?: 3_000L,
                secretEncryptionKey = secretKey,
                queueStream = env("WORKER_QUEUE_STREAM") ?: "workflow-runs",
                queueGroup = env("WORKER_QUEUE_GROUP") ?: "workflow-workers",
                concurrency = concurrency,
                pollBlockMs = env("WORKER_POLL_BLOCK_MS")?.toLongOrNull() ?: 5_000L,
                pollBatchSize = env("WORKER_POLL_BATCH_SIZE")?.toIntOrNull()?.coerceIn(1, 50) ?: 10,
                heartbeatIntervalMs = env("WORKER_HEARTBEAT_INTERVAL_MS")?.toLongOrNull() ?: 15_000L,
                heartbeatTtlSeconds = env("WORKER_HEARTBEAT_TTL_SECONDS")?.toLongOrNull() ?: 60L,
            )

            config.logSummary()
            return config
        }

        private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

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
        log.info("  stream      : $queueStream / group=$queueGroup")
        log.info("  concurrency : $concurrency")
        log.info("  pollBlockMs : $pollBlockMs")
        log.info("  heartbeat   : every ${heartbeatIntervalMs}ms (ttl=${heartbeatTtlSeconds}s)")
        // !! NEVER log: dbUrl, redisUrl, secretEncryptionKey !!
    }
}
