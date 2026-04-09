package com.vectorbee.api.config

data class AppConfig(
    val port: Int,
    val dbUrl: String,
    val dbUser: String,
    val dbPassword: String
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

            return AppConfig(
                port = port,
                dbUrl = dbUrl,
                dbUser = dbUser,
                dbPassword = dbPassword
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
