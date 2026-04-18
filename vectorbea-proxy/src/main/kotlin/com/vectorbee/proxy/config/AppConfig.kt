package com.vectorbea.proxy.config

import java.net.InetAddress

data class AppConfig(
    // ── Control-plane hub (prompt fetches, audit logs, heartbeats) ────────────
    val hubUrl: String,
    val apiKey: String,

    // ── Telemetry service (infrastructure metrics → dev-telemetry.vectorbea.com)
    //
    // Deliberately separate from hubUrl so the telemetry endpoint can live on
    // a different domain, VPC, or CDN edge without affecting the control plane.
    // Falls back to hubUrl when VECTORBEA_TELEMETRY_URL is not set so existing
    // single-host deployments need no changes.
    val telemetryUrl: String,

    // ── Sidecar identity ──────────────────────────────────────────────────────
    // Stable identifier sent with every telemetry batch.  Kubernetes sets
    // HOSTNAME to the pod name; bare-metal installs should set VECTORBEA_HOST_ID
    // explicitly.
    val proxyHostId: String,

    // ── Runtime environment reported in telemetry (dev | prod) ───────────────
    val environment: String,

    // ── Ports & socket paths ──────────────────────────────────────────────────
    val httpPort: Int = 8080,
    val sharedRulesPath: String = "/app/shared-config/rules.json",
    // Ktor REST socket — used by the Next.js hub for prompt invalidations + ops tooling
    val restSocketPath: String = "/tmp/vectorbea-rest.sock",
    // gRPC data-plane socket — hot path used by SDK clients in the same pod
    val grpcSocketPath: String = "/tmp/vectorbea.sock",

    // ── Audit flush tuning ────────────────────────────────────────────────────
    val flushIntervalMillis: Long = 5_000,
    val flushBatchSize: Int = 50,

    // ── Telemetry push interval ───────────────────────────────────────────────
    // How often the TelemetryDispatcher flushes accumulated CPU / memory /
    // latency samples to the telemetry service. Defaults to 30 s, matching the
    // heartbeat cadence so the two background workers are in-phase.
    val telemetryIntervalMs: Long = 30_000,
) {
    companion object {
        fun fromEnv(): AppConfig {
            val hubUrl = env("VECTORBEA_HUB_URL")
                ?: error("VECTORBEA_HUB_URL must be set")
            val apiKey = env("VECTORBEA_KEY")
                ?: error("VECTORBEA_KEY must be set")

            // Telemetry URL falls back to the hub URL so single-host setups
            // (local dev, Docker Compose without a dedicated telemetry service)
            // continue working with zero extra configuration.
            val telemetryUrl = env("VECTORBEA_TELEMETRY_URL")
                ?: env("VECTORBEA_HUB_URL")
                ?: "http://localhost:3001"

            // Stable host identity: prefer explicit override → Kubernetes pod name
            // (HOSTNAME) → machine hostname → random fallback.
            val proxyHostId = env("VECTORBEA_HOST_ID")
                ?: env("HOSTNAME")
                ?: runCatching { InetAddress.getLocalHost().hostName }.getOrElse { "unknown-host" }

            val environment = env("VECTORBEA_ENV")
                ?.lowercase()
                ?.takeIf { it in setOf("dev", "prod") }
                ?: "prod"

            return AppConfig(
                hubUrl          = hubUrl.trimEnd('/'),
                apiKey          = apiKey,
                telemetryUrl    = telemetryUrl.trimEnd('/'),
                proxyHostId     = proxyHostId,
                environment     = environment,
                httpPort        = env("VECTORBEA_HTTP_PORT")?.toIntOrNull() ?: 8080,
                sharedRulesPath = env("VECTORBEA_SHARED_RULES_PATH") ?: "/app/shared-config/rules.json",
                restSocketPath  = env("VECTORBEA_REST_SOCKET") ?: "/tmp/vectorbea-rest.sock",
                grpcSocketPath  = env("VECTORBEA_GRPC_SOCKET") ?: "/tmp/vectorbea.sock",
                telemetryIntervalMs = env("VECTORBEA_TELEMETRY_INTERVAL_MS")?.toLongOrNull() ?: 30_000,
            )
        }

        private fun env(name: String): String? =
            System.getenv(name)?.takeIf { it.isNotBlank() }
    }
}
