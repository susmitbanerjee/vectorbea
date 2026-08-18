package com.vectorbea.observability.analytics

/**
 * What ingestion needs to know, and nothing else.
 *
 * The service previously took the whole `TelemetryConfig` — port, CORS origins, JWT
 * secret, admin emails, OTel endpoint — to read four fields off it. That was tolerable
 * when the config and the service shipped in the same process. As a library it is not:
 * it would force every host to construct a server configuration in order to record an
 * event, and it would make the library's API change whenever the telemetry service's
 * deployment shape did.
 *
 * Four fields, all of which genuinely affect what gets stored.
 */
data class AnalyticsConfig(
    /** Which deployment the events belong to: dev, stage or prod. */
    val vectorbeaEnv: String = "dev",
    /** Events accepted per request. Excess is dropped, not rejected — see AnalyticsIngestionService. */
    val maxBatchSize: Int = 100,
    /** Per-event property budget in bytes, after sanitisation. */
    val maxEventSizeBytes: Int = 32_768,
    /** How long rows are kept. Enforced by the retention job, recorded here so it is visible. */
    val retentionDays: Int = 90,
) {
    companion object {
        fun fromEnv(getenv: (String) -> String? = System::getenv): AnalyticsConfig {
            val env = getenv("VECTORBEA_ENV")?.lowercase()
                ?.takeIf { it in setOf("dev", "stage", "prod") } ?: "dev"
            return AnalyticsConfig(
                vectorbeaEnv = env,
                maxBatchSize = getenv("TELEMETRY_MAX_BATCH_SIZE")?.toIntOrNull() ?: 100,
                maxEventSizeBytes = getenv("TELEMETRY_MAX_EVENT_SIZE_BYTES")?.toIntOrNull() ?: 32_768,
                retentionDays = getenv("TELEMETRY_RETENTION_DAYS")?.toIntOrNull() ?: 90,
            )
        }
    }
}
