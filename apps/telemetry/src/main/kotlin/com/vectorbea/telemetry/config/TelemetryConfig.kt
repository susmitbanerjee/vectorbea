package com.vectorbea.telemetry.config

import org.slf4j.LoggerFactory

data class TelemetryConfig(
    val port: Int,
    val appEnv: String,
    val vectorbeaEnv: String,
    val db: DbConfig?,
    val jwtSecret: String?,
    val corsAllowedOrigins: Set<String>,
    val adminEmails: Set<String>,
    val internalToken: String?,
    val telemetryPublicUrl: String,
    val otelEnabled: Boolean,
    val otelServiceName: String,
    val otelEndpoint: String?,
    val otelHeaders: String?,
    val otelResourceAttributes: String?,
    val maxBatchSize: Int,
    val maxEventSizeBytes: Int,
    val retentionDays: Int,
    val version: String,
) {
    val isProduction: Boolean get() = appEnv == "production"

    fun isAdmin(email: String?): Boolean =
        email != null && adminEmails.any { it.equals(email.trim(), ignoreCase = true) }

    fun validateForProduction() {
        if (!isProduction) return
        val log = LoggerFactory.getLogger(TelemetryConfig::class.java)
        val fatal = mutableListOf<String>()
        if (db == null)             fatal += "DATABASE_URL must be set in production"
        if (jwtSecret == null)      fatal += "JWT_SECRET must be set in production"
        if (internalToken == null)  fatal += "TELEMETRY_INTERNAL_TOKEN must be set in production"
        if (fatal.isNotEmpty()) {
            val msg = "FATAL: Production config missing:\n" + fatal.joinToString("\n") { "  - $it" }
            log.error(msg)
            throw IllegalStateException(msg)
        }
        if ("*" in corsAllowedOrigins) {
            log.warn("[config] CORS_ALLOWED_ORIGINS=* in production")
        }
    }

    companion object {
        private val log = LoggerFactory.getLogger(TelemetryConfig::class.java)

        fun fromEnv(): TelemetryConfig {
            val port = env("PORT")?.toIntOrNull() ?: 8080
            val appEnv = env("APP_ENV") ?: "development"
            val vectorbeaEnv = env("VECTORBEA_ENV")?.lowercase()?.let {
                if (it in setOf("dev", "stage", "prod")) it else "dev"
            } ?: "dev"

            val dbUrl = envSecret("DATABASE_URL", "DB-backed endpoints will fail")
            val db = dbUrl?.let {
                DbConfig(
                    url = it,
                    maxPoolSize = env("DB_POOL_MAX_SIZE")?.toIntOrNull() ?: 5,
                    runMigrations = env("RUN_MIGRATIONS")?.lowercase() == "true",
                )
            }

            val jwtSecret = env("JWT_SECRET") ?: env("SUPABASE_JWT_SECRET")
            if (jwtSecret == null) log.warn("[config] JWT_SECRET not set — auth disabled (dev mode)")

            val corsRaw = env("TELEMETRY_CORS_ALLOWED_ORIGINS") ?: env("CORS_ALLOWED_ORIGINS") ?: "*"
            val corsOrigins = corsRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()

            val adminEmails = (env("ADMIN_EMAILS") ?: "")
                .split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()

            val internalToken = env("TELEMETRY_INTERNAL_TOKEN")
            if (internalToken == null) log.warn("[config] TELEMETRY_INTERNAL_TOKEN not set — internal ingestion disabled")

            val otelEnabled = env("OTEL_ENABLED")?.lowercase() == "true"
            val otelEndpoint = env("OTEL_EXPORTER_OTLP_ENDPOINT")
            if (otelEnabled && otelEndpoint == null) {
                log.warn("[config] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set")
            }

            val config = TelemetryConfig(
                port = port,
                appEnv = appEnv,
                vectorbeaEnv = vectorbeaEnv,
                db = db,
                jwtSecret = jwtSecret,
                corsAllowedOrigins = corsOrigins,
                adminEmails = adminEmails,
                internalToken = internalToken,
                telemetryPublicUrl = env("TELEMETRY_PUBLIC_URL") ?: "http://localhost:$port",
                otelEnabled = otelEnabled,
                otelServiceName = env("OTEL_SERVICE_NAME") ?: "vectorbea-telemetry",
                otelEndpoint = otelEndpoint,
                otelHeaders = env("OTEL_EXPORTER_OTLP_HEADERS"),
                otelResourceAttributes = env("OTEL_RESOURCE_ATTRIBUTES"),
                maxBatchSize = env("ANALYTICS_MAX_BATCH_SIZE")?.toIntOrNull() ?: 50,
                maxEventSizeBytes = env("ANALYTICS_MAX_EVENT_SIZE_BYTES")?.toIntOrNull() ?: 16384,
                retentionDays = env("ANALYTICS_RETENTION_DAYS")?.toIntOrNull() ?: 180,
                version = env("APP_VERSION") ?: "0.1.0",
            )

            config.logSummary()
            return config
        }

        private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

        private fun envSecret(name: String, warningIfAbsent: String): String? {
            val v = env(name)
            if (v == null) log.warn("[config] $name not set — $warningIfAbsent")
            return v
        }
    }

    private fun logSummary() {
        log.info("=== vectorbea-telemetry config ===")
        log.info("  port          : $port")
        log.info("  app env       : $appEnv")
        log.info("  vectorbea env : $vectorbeaEnv")
        log.info("  version       : $version")
        log.info("  database      : ${if (db != null) "configured (pool=${db.maxPoolSize})" else "NOT SET"}")
        log.info("  jwt auth      : ${if (jwtSecret != null) "enabled" else "DISABLED"}")
        log.info("  internal token: ${if (internalToken != null) "set" else "NOT SET"}")
        log.info("  cors origins  : $corsAllowedOrigins")
        log.info("  otel          : enabled=$otelEnabled endpoint=${otelEndpoint ?: "not set"}")
        log.info("  admin emails  : ${adminEmails.size} configured")
    }
}

data class DbConfig(
    val url: String,
    val maxPoolSize: Int = 5,
    val connectionTimeoutMs: Long = 30_000L,
    val idleTimeoutMs: Long = 600_000L,
    val keepaliveTimeMs: Long = 300_000L,
    val maxLifetimeMs: Long = 1_800_000L,
    val runMigrations: Boolean = false,
)
