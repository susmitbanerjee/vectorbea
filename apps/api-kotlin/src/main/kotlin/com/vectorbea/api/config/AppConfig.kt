package com.vectorbea.api.config

import org.slf4j.LoggerFactory

/**
 * Application configuration — read from environment variables.
 *
 * Rules:
 *  - Required vars cause startup failure in production once DB is mandatory.
 *  - Optional infra vars (DB, Redis, secrets) emit a warning when absent.
 *  - Secret values (DATABASE_URL, REDIS_URL, SECRET_ENCRYPTION_KEY) are
 *    NEVER logged — only their presence is noted.
 */
data class AppConfig(
    val port: Int,
    val appEnv: String,
    val db: DbConfig?,
    val redis: RedisConfig?,
    /** Key is present/absent — value never printed */
    val secretEncryptionKeyPresent: Boolean,
    val corsAllowedOrigins: Set<String>,
    val logLevel: String,
    val version: String,
    val commit: String?,
    /** Max request body size in bytes (default: 2 MB) */
    val maxRequestBodyBytes: Int,
) {
    val isProduction: Boolean get() = appEnv == "production"
    val isLocal: Boolean get() = appEnv == "local" || appEnv == "development"

    companion object {
        private val log = LoggerFactory.getLogger(AppConfig::class.java)

        private const val DEFAULT_PORT = 8080
        private const val DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024  // 2 MB
        private const val DEFAULT_VERSION = "0.1.0"

        fun fromEnv(): AppConfig {
            val port = env("PORT")?.toIntOrNull() ?: DEFAULT_PORT
            val appEnv = env("APP_ENV") ?: "development"

            // ── Database config ─────────────────────────────────────────────
            val dbUrl = envSecret("DATABASE_URL", "DB connections will not be available")
            val db = dbUrl?.let {
                DbConfig(
                    url = it,
                    maxPoolSize = env("DB_POOL_MAX_SIZE")?.toIntOrNull() ?: 10,
                    connectionTimeoutMs = env("DB_CONNECTION_TIMEOUT_MS")?.toLongOrNull() ?: 30_000L,
                    idleTimeoutMs = env("DB_IDLE_TIMEOUT_MS")?.toLongOrNull() ?: 600_000L,
                    keepaliveTimeMs = env("DB_KEEPALIVE_TIME_MS")?.toLongOrNull() ?: 300_000L,
                    maxLifetimeMs = env("DB_MAX_LIFETIME_MS")?.toLongOrNull() ?: 1_800_000L,
                    runMigrations = env("RUN_MIGRATIONS")?.lowercase() == "true",
                )
            }

            // ── Redis ───────────────────────────────────────────────────────
            val redisUrl = envSecret("REDIS_URL", "Redis connections will not be available")
            val redis = redisUrl?.let {
                RedisConfig(
                    url = it,
                    tlsEnabled = env("REDIS_TLS_ENABLED")?.lowercase() == "true",
                    commandTimeoutMs = env("REDIS_COMMAND_TIMEOUT_MS")?.toLongOrNull() ?: 2_000L,
                    queueStream = env("REDIS_QUEUE_STREAM") ?: "workflow-runs",
                    queueGroup = env("REDIS_QUEUE_GROUP") ?: "workflow-workers",
                    eventChannelPrefix = env("REDIS_EVENT_CHANNEL_PREFIX") ?: "run-events",
                    cachePrefix = env("REDIS_CACHE_PREFIX") ?: "vectorbea",
                    lockPrefix = env("REDIS_LOCK_PREFIX") ?: "lock",
                    workerHeartbeatTtlSeconds = env("REDIS_WORKER_HEARTBEAT_TTL_SECONDS")?.toLongOrNull() ?: 60L,
                )
            }

            // ── Secret encryption key ───────────────────────────────────────
            val secretKey = env("SECRET_ENCRYPTION_KEY")
            if (secretKey == null) {
                log.warn("[config] SECRET_ENCRYPTION_KEY not set — secret decryption will not be available")
            }

            // ── CORS ────────────────────────────────────────────────────────
            val corsRaw = env("CORS_ALLOWED_ORIGINS") ?: "*"
            val corsOrigins = corsRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            if ("*" in corsOrigins) {
                log.warn("[config] CORS_ALLOWED_ORIGINS=* — accepting all origins (not safe for production)")
            }

            val logLevel = env("LOG_LEVEL") ?: "INFO"
            val version = env("APP_VERSION") ?: DEFAULT_VERSION
            val commit = env("GIT_COMMIT")
            val maxBody = env("MAX_REQUEST_BODY_BYTES")?.toIntOrNull() ?: DEFAULT_MAX_BODY_BYTES

            val config = AppConfig(
                port = port,
                appEnv = appEnv,
                db = db,
                redis = redis,
                secretEncryptionKeyPresent = secretKey != null,
                corsAllowedOrigins = corsOrigins,
                logLevel = logLevel,
                version = version,
                commit = commit,
                maxRequestBodyBytes = maxBody,
            )

            config.logSummary()
            return config
        }

        private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

        /** Reads a secret env var — warns if absent, never logs the value. */
        private fun envSecret(name: String, warningIfAbsent: String): String? {
            val value = env(name)
            if (value == null) log.warn("[config] $name not set — $warningIfAbsent")
            return value
        }
    }

    private fun logSummary() {
        log.info("=== vectorbea-api config ===")
        log.info("  port          : $port")
        log.info("  env           : $appEnv")
        log.info("  version       : $version${if (commit != null) " ($commit)" else ""}")
        log.info("  database      : ${if (db != null) "configured (pool=${db.maxPoolSize}, migrations=${db.runMigrations})" else "NOT SET"}")
        log.info("  redis         : ${if (redis != null) "configured (tls=${redis.tlsEnabled}, stream=${redis.queueStream})" else "NOT SET"}")
        log.info("  secret key    : ${if (secretEncryptionKeyPresent) "present" else "NOT SET"}")
        log.info("  cors origins  : $corsAllowedOrigins")
        log.info("  log level     : $logLevel")
        log.info("  max body      : ${maxRequestBodyBytes / 1024} KB")
        // !! NEVER log: DATABASE_URL, REDIS_URL, SECRET_ENCRYPTION_KEY, or any key material !!
    }
}

/**
 * Redis client configuration.
 * Extracted from [AppConfig] only when REDIS_URL is present.
 * The URL is treated as a secret — NEVER logged.
 */
data class RedisConfig(
    /** Redis connection URL — never logged */
    val url: String,
    /** Whether to enable SSL/TLS (required for Upstash, Redis Cloud, etc.) */
    val tlsEnabled: Boolean = false,
    /** Milliseconds to wait for a command response before timing out */
    val commandTimeoutMs: Long = 2_000L,
    /** Redis Stream key for workflow run jobs */
    val queueStream: String = "workflow-runs",
    /** Consumer group name (workers create this group on startup) */
    val queueGroup: String = "workflow-workers",
    /** Pub/Sub channel prefix for run events */
    val eventChannelPrefix: String = "run-events",
    /** Key prefix for cache entries */
    val cachePrefix: String = "vectorbea",
    /** Key prefix for distributed locks */
    val lockPrefix: String = "lock",
    /** TTL in seconds for worker heartbeat keys */
    val workerHeartbeatTtlSeconds: Long = 60L,
)

/**
 * Postgres connection pool configuration.
 * Extracted from [AppConfig] only when DATABASE_URL is present.
 */
data class DbConfig(
    /** JDBC connection URL — never logged */
    val url: String,
    /** Maximum connections in the HikariCP pool */
    val maxPoolSize: Int = 10,
    /** Milliseconds to wait for a connection before throwing */
    val connectionTimeoutMs: Long = 30_000L,
    /** Milliseconds an idle connection may sit in the pool before eviction */
    val idleTimeoutMs: Long = 600_000L,
    /** Milliseconds between TCP keepalive probes (prevents idle-timeout on Neon/RDS) */
    val keepaliveTimeMs: Long = 300_000L,
    /** Max lifetime of a connection in the pool */
    val maxLifetimeMs: Long = 1_800_000L,
    /** Whether to run Flyway migrations on startup */
    val runMigrations: Boolean = false,
)
