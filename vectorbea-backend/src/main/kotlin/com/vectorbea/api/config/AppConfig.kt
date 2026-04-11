package com.vectorbea.api.config

/**
 * Valid deployment environments. Controls auth bypass rules and logging verbosity.
 *
 * - LOCAL  : developer laptop / Docker Compose. Local auth bypass is active.
 * - DEV    : shared development Supabase project. No bypass; real API keys required.
 * - STAGE  : pre-production mirror. Same constraints as prod.
 * - PROD   : production. Hardened; any bypass paths are compile-time absent.
 */
enum class Environment {
    LOCAL, DEV, STAGE, PROD;

    val isLocal get() = this == LOCAL
    /** Returns true for any environment where the local bypass MUST be disabled. */
    val bypassForbidden get() = this != LOCAL
}

data class AppConfig(
    val port: Int,
    val dbUrl: String,
    val dbUser: String,
    val dbPassword: String,
    val dbPoolMaxSize: Int,
    val dbPoolMinIdle: Int,
    val dbConnectionTimeoutMs: Long,
    val dbIdleTimeoutMs: Long,
    /** Deployment environment — drives auth bypass and other env-specific behaviour. */
    val environment: Environment,
) {
    companion object {
        fun fromEnv(): AppConfig {
            val port = env("PORT")?.toIntOrNull() ?: 8080
            val dbUrl = env("DB_URL")
                ?: env("JDBC_DATABASE_URL")
                ?: error("DB_URL or JDBC_DATABASE_URL must be set")
            val dbUser = env("DB_USER")
                ?: env("PGUSER")
                ?: error("DB_USER or PGUSER must be set")
            val dbPassword = env("DB_PASSWORD")
                ?: env("PGPASSWORD")
                ?: error("DB_PASSWORD or PGPASSWORD must be set")
            val environment = env("ENVIRONMENT")
                ?.uppercase()
                ?.let { runCatching { Environment.valueOf(it) }.getOrNull() }
                ?: Environment.LOCAL

            return AppConfig(
                port = port,
                dbUrl = dbUrl,
                dbUser = dbUser,
                dbPassword = dbPassword,
                dbPoolMaxSize = env("DB_POOL_MAX_SIZE")?.toIntOrNull() ?: 10,
                dbPoolMinIdle = env("DB_POOL_MIN_IDLE")?.toIntOrNull() ?: 2,
                dbConnectionTimeoutMs = env("DB_CONNECTION_TIMEOUT_MS")?.toLongOrNull() ?: 10_000L,
                dbIdleTimeoutMs = env("DB_IDLE_TIMEOUT_MS")?.toLongOrNull() ?: 300_000L,
                environment = environment,
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
