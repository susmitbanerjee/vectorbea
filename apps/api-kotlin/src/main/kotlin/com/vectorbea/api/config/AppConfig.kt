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
    /** Raw key string — NEVER log, pass to Encryption.decodeKey() at startup only */
    val secretEncryptionKey: String? = null,
    val secretKeyVersion: String = "1",
    val corsAllowedOrigins: Set<String>,
    /** Shared JWT secret for HS256 token verification. Null = auth disabled (dev/open mode). Never log. */
    val jwtSecret: String? = null,
    val logLevel: String,
    val version: String,
    val commit: String?,
    // AI Workflow Architect config
    val architectEnabled: Boolean = false,
    val architectApiKey: String? = null,
    val architectModel: String? = "gpt-4o-mini",
    /** Max request body size in bytes (default: 2 MB) */
    val maxRequestBodyBytes: Int,

    // ── Private beta / production controls ─────────────────────────────────
    val publicSignupEnabled: Boolean = true,
    /** Comma-separated admin email addresses */
    val adminEmails: Set<String> = emptySet(),
    /**
     * Shared secret for `/internal/telemetry/events`.
     *
     * Was the telemetry service's own; now the API's, because the API is the process
     * that owns that endpoint. Null disables internal ingestion rather than defaulting
     * to something guessable - an analytics store anyone can write to is a store you
     * cannot trust, which is worse than not having one.
     */
    val telemetryInternalToken: String? = null,
    val defaultExecutionMode: String = "simulation_only",
    val realExecutionRequiresAdminApproval: Boolean = true,
    val byokRequiredForRealExecution: Boolean = true,
    val allowPlatformLlmForWorkflowExecution: Boolean = false,
    // Beta default limits
    val betaDefaultMaxWorkflows: Int = 3,
    val betaDefaultMaxRunsPerDay: Int = 20,
    val betaDefaultMaxStepsPerWorkflow: Int = 5,
) {
    val isProduction: Boolean get() = appEnv == "production"
    val isLocal: Boolean get() = appEnv == "local" || appEnv == "development"

    /** Returns true if the given email belongs to an admin. */
    fun isAdmin(email: String?): Boolean =
        email != null && (adminEmails.any { it.equals(email.trim(), ignoreCase = true) })

    /**
     * Validate production-critical config. Throws [IllegalStateException] if any
     * required production variable is missing. Safe to call in non-production; warns only.
     */
    fun validateForProduction() {
        if (!isProduction) return
        val log = LoggerFactory.getLogger(AppConfig::class.java)

        // ── Hard failures — service cannot function without these ──────────────
        val fatal = mutableListOf<String>()
        if (db == null)                  fatal += "DATABASE_URL must be set in production"
        if (redis == null)               fatal += "REDIS_URL must be set in production"
        if (!secretEncryptionKeyPresent) fatal += "SECRET_ENCRYPTION_KEY must be set in production"
        if (jwtSecret == null)           fatal += "JWT_SECRET (or SUPABASE_JWT_SECRET) must be set in production"
        if (fatal.isNotEmpty()) {
            val msg = "FATAL: Production config missing critical vars:\n" + fatal.joinToString("\n") { "  - $it" }
            log.error(msg)
            throw IllegalStateException(msg)
        }

        // ── Soft warnings — service starts but security is degraded ────────────
        if ("*" in corsAllowedOrigins) {
            log.warn("[config] CORS_ALLOWED_ORIGINS=* in production — consider setting explicit origins for security")
        }
        if (adminEmails.isEmpty()) {
            log.warn("[config] ADMIN_EMAILS not set — admin routes will be inaccessible. Set ADMIN_EMAILS=you@example.com")
        }
    }

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
                log.warn("[config] SECRET_ENCRYPTION_KEY not set — secret encryption will not be available")
            }
            val secretKeyVersion = env("SECRET_KEY_VERSION") ?: "1"

            // ── CORS ────────────────────────────────────────────────────────
            val corsRaw = env("CORS_ALLOWED_ORIGINS") ?: "*"
            val corsOrigins = corsRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            if ("*" in corsOrigins) {
                log.warn("[config] CORS_ALLOWED_ORIGINS=* — accepting all origins (not safe for production)")
            }

            // ── JWT auth ──────────────────────────────────────────────────────
            // JWT_SECRET is the shared HS256 secret used by Next.js to sign tokens.
            // When absent the API runs in open/dev mode (workspace headers trusted).
            val jwtSecret = env("JWT_SECRET") ?: env("SUPABASE_JWT_SECRET")  // legacy fallback
            if (jwtSecret == null) {
                log.warn("[config] JWT_SECRET not set — JWT auth disabled (open/dev mode)")
            }

            val logLevel = env("LOG_LEVEL") ?: "INFO"
            val version = env("APP_VERSION") ?: DEFAULT_VERSION
            val commit = env("GIT_COMMIT")
            val maxBody = env("MAX_REQUEST_BODY_BYTES")?.toIntOrNull() ?: DEFAULT_MAX_BODY_BYTES
            val architectEnabled = env("AI_ARCHITECT_ENABLED")?.lowercase() == "true"
            val architectApiKey  = env("AI_ARCHITECT_API_KEY") ?: env("OPENAI_API_KEY")
            val architectModel   = env("AI_ARCHITECT_MODEL") ?: "gpt-4o-mini"

            // ── Production controls ─────────────────────────────────────────
            // Signup remains closed by default in production.
            val isProductionEnv = appEnv == "production"
            val publicSignupEnabled = env("PUBLIC_SIGNUP_ENABLED")?.lowercase()?.let { it != "false" }
                ?: !isProductionEnv  // production defaults to signup CLOSED
            val adminEmails        = (env("ADMIN_EMAILS") ?: "")
                .split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            val defaultExecMode    = env("DEFAULT_EXECUTION_MODE") ?: "simulation_only"
            val realExecApproval   = env("REAL_EXECUTION_REQUIRES_ADMIN_APPROVAL")?.lowercase() != "false"
            val byokRequired       = env("BYOK_REQUIRED_FOR_REAL_EXECUTION")?.lowercase() != "false"
            val allowPlatformLlm   = env("ALLOW_PLATFORM_LLM_FOR_WORKFLOW_EXECUTION")?.lowercase() == "true"

            val config = AppConfig(
                port = port,
                appEnv = appEnv,
                db = db,
                redis = redis,
                secretEncryptionKeyPresent = secretKey != null,
                secretEncryptionKey = secretKey,
                secretKeyVersion = secretKeyVersion,
                corsAllowedOrigins = corsOrigins,
                logLevel = logLevel,
                version = version,
                commit = commit,
                maxRequestBodyBytes = maxBody,
                jwtSecret = jwtSecret,
                architectEnabled = architectEnabled,
                architectApiKey  = architectApiKey,
                architectModel   = architectModel,
                publicSignupEnabled = publicSignupEnabled,
                adminEmails      = adminEmails,
                telemetryInternalToken = env("TELEMETRY_INTERNAL_TOKEN"),
                defaultExecutionMode = defaultExecMode,
                realExecutionRequiresAdminApproval = realExecApproval,
                byokRequiredForRealExecution = byokRequired,
                allowPlatformLlmForWorkflowExecution = allowPlatformLlm,
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
        log.info("  jwt auth      : ${if (jwtSecret != null) "enabled (HS256)" else "DISABLED (open/dev mode)"}")
        log.info("  max body      : ${maxRequestBodyBytes / 1024} KB")
        // suppressed: log.info("  max body.*")
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
