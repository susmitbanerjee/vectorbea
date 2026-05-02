package com.vectorbea.proxy.config

import java.net.InetAddress

data class AppConfig(
    // ── Control-plane hub (prompt fetches, audit logs, heartbeats) ────────────
    val hubUrl: String,
    val apiKey: String,
    val ingestUrl: String,
    val ingestToken: String,

    // ── Telemetry service (infrastructure metrics → dev-telemetry.vectorbea.com)
    //
    // Deliberately separate from hubUrl so the telemetry endpoint can live on
    // a different domain, VPC, or CDN edge without affecting the control plane.
    // Falls back to hubUrl when VECTORBEA_TELEMETRY_URL is not set so existing
    // single-host deployments need no changes.
    val telemetryUrl: String,
    val telemetryEnabled: Boolean,

    // ── Sidecar identity ──────────────────────────────────────────────────────
    // Stable identifier sent with every telemetry batch.  Kubernetes sets
    // HOSTNAME to the pod name; bare-metal installs should set VECTORBEA_HOST_ID
    // explicitly.
    val proxyHostId: String,

    // ── Runtime environment reported in telemetry (dev | prod) ───────────────
    val environment: String,
    val serviceName: String,
    val clusterName: String? = null,
    val namespace: String? = null,
    val podName: String? = null,
    val containerName: String? = null,

    // ── Ports & socket paths ──────────────────────────────────────────────────
    val httpPort: Int = 8080,
    val sharedRulesPath: String = "/app/shared-config/rules.json",
    // Ktor REST socket — used by the Next.js hub for prompt invalidations + ops tooling
    val restSocketPath: String? = null,
    // gRPC data-plane socket — hot path used by SDK clients in the same pod
    val grpcSocketPath: String? = null,

    // ── Audit flush tuning ────────────────────────────────────────────────────
    val flushIntervalMillis: Long = 5_000,
    val flushBatchSize: Int = 50,
    val maxQueueSize: Int = 10_000,
    val captureInputs: Boolean = true,
    val captureOutputs: Boolean = true,
    val redactSecrets: Boolean = true,
    val sampleRate: Double = 1.0,
    val failOpen: Boolean = true,

    // ── Telemetry push interval ───────────────────────────────────────────────
    // How often the TelemetryDispatcher flushes accumulated CPU / memory /
    // latency samples to the telemetry service. Defaults to 30 s, matching the
    // heartbeat cadence so the two background workers are in-phase.
    val telemetryIntervalMs: Long = 30_000,
) {
    init {
        // Validate key format early — fail fast before sync/heartbeat start.
        // Accepted prefixes (in order of preference):
        //   vb_live_   — dashboard-generated production key
        //   vb_test_   — dashboard-generated non-production key
        //   vb_        — legacy short prefix
        //   vbagent_   — legacy agent-provisioned key (vbagent CLI / older SDK)
        // Never log the key value itself.
        val keyValid = apiKey.startsWith("vb_live_") ||
                       apiKey.startsWith("vb_test_") ||
                       apiKey.startsWith("vb_") ||
                       apiKey.startsWith("vbagent_")
        require(keyValid) {
            "VECTORBEA_KEY format is invalid. Expected prefix: vb_live_ (production), vb_test_ (non-production), " +
            "or vbagent_ (agent-provisioned). Generate a key from the VectorBea dashboard → API Keys."
        }
    }

    companion object {
        fun fromEnv(): AppConfig {
            val hubUrl = env("VECTORBEA_HUB_URL")
                ?: error("VECTORBEA_HUB_URL must be set")
            val apiKey = env("VECTORBEA_KEY")
                ?: error("VECTORBEA_KEY must be set")
            val ingestUrl = env("VECTORBEA_INGEST_URL")
                ?: "${hubUrl.trimEnd('/')}/api/ingest/traces"
            val ingestToken = env("VECTORBEA_INGEST_TOKEN")
                ?: apiKey

            // Telemetry URL falls back to the hub URL so single-host setups
            // (local dev, Docker Compose without a dedicated telemetry service)
            // continue working with zero extra configuration.
            val telemetryUrl = env("VECTORBEA_TELEMETRY_URL")
                ?: env("VECTORBEA_HUB_URL")
                ?: "http://localhost:3001"
            val telemetryEnabled = env("VECTORBEA_ENABLE_TELEMETRY")
                ?.lowercase()
                ?.let { value ->
                    when (value) {
                        "1", "true", "yes", "on" -> true
                        "0", "false", "no", "off" -> false
                        else -> null
                    }
                }
                // Local Docker testing usually passes only HUB_URL + API key.
                // In that mode we default telemetry off to avoid noisy HTML 404s
                // from hosts that expose the control plane but not the ingest API.
                ?: (env("VECTORBEA_TELEMETRY_URL") != null)

            // Stable host identity: prefer explicit override → Kubernetes pod name
            // (HOSTNAME) → machine hostname → random fallback.
            val proxyHostId = env("VECTORBEA_HOST_ID")
                ?: env("HOSTNAME")
                ?: runCatching { InetAddress.getLocalHost().hostName }.getOrElse { "unknown-host" }

            val environment = env("VECTORBEA_ENV")
                ?.lowercase()
                ?.takeIf { it in setOf("dev", "prod", "staging", "production", "test") }
                ?: "prod"
            val serviceName = env("VECTORBEA_SERVICE_NAME")
                ?: env("OTEL_SERVICE_NAME")
                ?: env("SERVICE_NAME")
                ?: proxyHostId

            return AppConfig(
                hubUrl          = hubUrl.trimEnd('/'),
                apiKey          = apiKey,
                ingestUrl       = ingestUrl.trimEnd('/'),
                ingestToken     = ingestToken,
                telemetryUrl    = telemetryUrl.trimEnd('/'),
                telemetryEnabled = telemetryEnabled,
                proxyHostId     = proxyHostId,
                environment     = environment,
                serviceName     = serviceName,
                clusterName     = env("VECTORBEA_CLUSTER_NAME"),
                namespace       = env("VECTORBEA_NAMESPACE"),
                podName         = env("VECTORBEA_POD_NAME") ?: env("HOSTNAME"),
                containerName   = env("VECTORBEA_CONTAINER_NAME"),
                httpPort        = env("VECTORBEA_LOCAL_HTTP_PORT")?.toIntOrNull() ?: env("VECTORBEA_HTTP_PORT")?.toIntOrNull() ?: 8080,
                sharedRulesPath = env("VECTORBEA_SHARED_RULES_PATH") ?: "/app/shared-config/rules.json",
                restSocketPath  = env("VECTORBEA_REST_SOCKET"),
                grpcSocketPath  = env("VECTORBEA_GRPC_SOCKET") ?: env("VECTORBEA_SOCKET_PATH"),
                flushIntervalMillis = env("VECTORBEA_FLUSH_INTERVAL_MS")?.toLongOrNull() ?: 5_000,
                flushBatchSize  = env("VECTORBEA_BATCH_SIZE")?.toIntOrNull() ?: 50,
                maxQueueSize    = env("VECTORBEA_MAX_QUEUE_SIZE")?.toIntOrNull() ?: 10_000,
                captureInputs   = envBool("VECTORBEA_CAPTURE_INPUTS", default = true),
                captureOutputs  = envBool("VECTORBEA_CAPTURE_OUTPUTS", default = true),
                redactSecrets   = envBool("VECTORBEA_REDACT_SECRETS", default = true),
                sampleRate      = env("VECTORBEA_SAMPLE_RATE")?.toDoubleOrNull()?.coerceIn(0.0, 1.0) ?: 1.0,
                failOpen        = envBool("VECTORBEA_FAIL_OPEN", default = true),
                telemetryIntervalMs = env("VECTORBEA_TELEMETRY_INTERVAL_MS")?.toLongOrNull() ?: 30_000,
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }

        private fun envBool(name: String, default: Boolean): Boolean =
            when (env(name)?.lowercase()) {
                "1", "true", "yes", "on" -> true
                "0", "false", "no", "off" -> false
                else -> default
            }
    }
}
