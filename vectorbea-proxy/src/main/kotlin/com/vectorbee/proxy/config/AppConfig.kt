package com.vectorbea.proxy.config

data class AppConfig(
    val hubUrl: String,
    val apiKey: String,
    val httpPort: Int = 8080,
    val sharedRulesPath: String = "/app/shared-config/rules.json",
    // Ktor REST socket — used by the Next.js hub to push prompt invalidations
    // and by ops tooling for diagnostics.
    val restSocketPath: String = "/tmp/vectorbea-rest.sock",
    // gRPC data-plane socket — the hot path used by SDK clients in the same pod.
    val grpcSocketPath: String = "/tmp/vectorbea.sock",
    val flushIntervalMillis: Long = 5_000,
    val flushBatchSize: Int = 50
) {
    companion object {
        fun fromEnv(): AppConfig {
            val hubUrl = env("VECTORBEA_HUB_URL")
                ?: error("VECTORBEA_HUB_URL must be set")
            val apiKey = env("VECTORBEA_KEY")
                ?: error("VECTORBEA_KEY must be set")

            return AppConfig(
                hubUrl = hubUrl.trimEnd('/'),
                apiKey = apiKey,
                httpPort = env("VECTORBEA_HTTP_PORT")?.toIntOrNull() ?: 8080,
                sharedRulesPath = env("VECTORBEA_SHARED_RULES_PATH") ?: "/app/shared-config/rules.json",
                restSocketPath = env("VECTORBEA_REST_SOCKET") ?: "/tmp/vectorbea-rest.sock",
                grpcSocketPath = env("VECTORBEA_GRPC_SOCKET") ?: "/tmp/vectorbea.sock"
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
