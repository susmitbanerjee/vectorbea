package com.vectorbea.api.config

import org.slf4j.LoggerFactory

/**
 * Application configuration — read from environment variables.
 *
 * Rules:
 *  - Required vars cause startup failure (listed below).
 *  - Optional infra vars (DB, Redis, secrets) emit a warning when absent.
 *    Connections are established lazily; their absence only causes failures when
 *    routes that need them are actually called.
 *  - Secret values are NEVER logged — only their presence is noted.
 */
data class AppConfig(
    val port: Int,
    val appEnv: String,
    val databaseUrl: String?,
    val redisUrl: String?,
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

    companion object {
        private val log = LoggerFactory.getLogger(AppConfig::class.java)

        private const val DEFAULT_PORT = 8080
        private const val DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024  // 2 MB
        private const val DEFAULT_VERSION = "0.1.0"

        fun fromEnv(): AppConfig {
            val port = env("PORT")?.toIntOrNull() ?: DEFAULT_PORT
            val appEnv = env("APP_ENV") ?: "development"

            // ── Optional infra vars — warn, don't fail ──────────────────────
            val databaseUrl = envOptional("DATABASE_URL", "DB connections will not be available")
            val redisUrl = envOptional("REDIS_URL", "Redis connections will not be available")
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

            // ── Log level ───────────────────────────────────────────────────
            val logLevel = env("LOG_LEVEL") ?: "INFO"

            // ── Version / commit ────────────────────────────────────────────
            val version = env("APP_VERSION") ?: DEFAULT_VERSION
            val commit = env("GIT_COMMIT")

            // ── Body size ───────────────────────────────────────────────────
            val maxBody = env("MAX_REQUEST_BODY_BYTES")?.toIntOrNull() ?: DEFAULT_MAX_BODY_BYTES

            val config = AppConfig(
                port = port,
                appEnv = appEnv,
                databaseUrl = databaseUrl,
                redisUrl = redisUrl,
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

        private fun envOptional(name: String, warningIfAbsent: String): String? {
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
        log.info("  database      : ${if (databaseUrl != null) "configured" else "NOT SET"}")
        log.info("  redis         : ${if (redisUrl != null) "configured" else "NOT SET"}")
        log.info("  secret key    : ${if (secretEncryptionKeyPresent) "present" else "NOT SET"}")
        log.info("  cors origins  : $corsAllowedOrigins")
        log.info("  log level     : $logLevel")
        log.info("  max body      : ${maxRequestBodyBytes / 1024} KB")
        // !! Never log: databaseUrl, redisUrl, or any key material !!
    }
}
