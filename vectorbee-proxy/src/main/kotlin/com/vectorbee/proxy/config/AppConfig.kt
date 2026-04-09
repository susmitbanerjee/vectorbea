package com.vectorbee.proxy.config

data class AppConfig(
    val hubUrl: String,
    val apiKey: String,
    // Ktor REST socket — used by the Next.js hub to push prompt invalidations
    // and by ops tooling for diagnostics.
    val restSocketPath: String = "/tmp/vectorbee-rest.sock",
    // gRPC data-plane socket — the hot path used by SDK clients in the same pod.
    val grpcSocketPath: String = "/tmp/vectorbee.sock",
    val flushIntervalMillis: Long = 5_000,
    val flushBatchSize: Int = 50
) {
    companion object {
        fun fromEnv(): AppConfig {
            val hubUrl = env("VECTORBEE_HUB_URL")
                ?: error("VECTORBEE_HUB_URL must be set")
            val apiKey = env("VECTORBEE_KEY")
                ?: error("VECTORBEE_KEY must be set")

            return AppConfig(
                hubUrl = hubUrl.trimEnd('/'),
                apiKey = apiKey,
                restSocketPath = env("VECTORBEE_REST_SOCKET") ?: "/tmp/vectorbee-rest.sock",
                grpcSocketPath = env("VECTORBEE_GRPC_SOCKET") ?: "/tmp/vectorbee.sock"
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
