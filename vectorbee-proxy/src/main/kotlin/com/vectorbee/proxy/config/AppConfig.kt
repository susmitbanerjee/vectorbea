package com.vectorbee.proxy.config

data class AppConfig(
    val hubUrl: String,
    val apiKey: String,
    val socketPath: String = "/tmp/vectorbee.sock",
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
                apiKey = apiKey
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
