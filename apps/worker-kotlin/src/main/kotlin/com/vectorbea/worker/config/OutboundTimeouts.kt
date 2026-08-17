package com.vectorbea.worker.config

import org.slf4j.LoggerFactory

/**
 * Single source of truth for every timeout applied to **outbound** I/O.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Kotlin `withTimeout` around a *blocking* call does not cancel it. It
 * abandons the coroutine while the underlying thread stays parked on the socket
 * — forever, if the peer accepts the connection and then never responds. Every
 * outbound call therefore needs a timeout enforced **below** the application:
 * at the JDBC driver, or at the HTTP client.
 *
 * The three blocking sources (09-EXECUTION-ARCHITECTURE-REVISED §1.5):
 *   1. LLM provider HTTP calls
 *   2. HTTP tool calls
 *   3. Tenant databases via ClientDbPoolManager  ← unbounded before this change
 *
 * POLICY
 * ------
 *   connect  5s   — a peer that will answer, answers fast
 *   socket  30s   — no single read may park a pool thread longer than this
 *   total   from the node's timeout policy (`tools.timeout_ms`, LLM `timeoutMs`),
 *                  clamped to [totalCallCeilingMs] so a tenant cannot configure
 *                  an unbounded call.
 *
 * Every value is overridable by environment variable, and every effective value
 * is logged once at startup by [logEffectiveValues] so an operator can see what
 * the process is actually running with — not what the defaults say.
 */
data class OutboundTimeouts(
    // ── Tenant + platform JDBC (driver level) ────────────────────────────────
    /** TCP connect timeout, seconds. pgjdbc `connectTimeout`, MySQL `connectTimeout` (ms). */
    val dbConnectTimeoutSeconds: Int,
    /** Per-read socket timeout, seconds. THE critical one — bounds a hung read. */
    val dbSocketTimeoutSeconds: Int,
    /** Driver login/handshake timeout, seconds (`loginTimeout`). */
    val dbLoginTimeoutSeconds: Int,
    /** pgjdbc `cancelSignalTimeout` — bounds the out-of-band cancel used by queryTimeout. */
    val dbCancelSignalTimeoutSeconds: Int,

    // ── Tenant JDBC (HikariCP level) ─────────────────────────────────────────
    /** How long `getConnection()` may wait for a pooled connection. */
    val tenantPoolConnectionTimeoutMs: Long,
    /** How long Hikari's aliveness check may take before the connection is evicted. */
    val tenantPoolValidationTimeoutMs: Long,
    /** Hard recycle age for a pooled physical connection. */
    val tenantPoolMaxLifetimeMs: Long,
    /** Idle eviction. */
    val tenantPoolIdleTimeoutMs: Long,
    /** Warn when a connection is held longer than this (a held connection is a held slot). */
    val tenantPoolLeakDetectionMs: Long,
    /** Max physical connections per tenant connection record. */
    val tenantPoolMaxSize: Int,

    // ── Platform Postgres (HikariCP level) ───────────────────────────────────
    val platformPoolValidationTimeoutMs: Long,
    val platformPoolKeepaliveMs: Long,

    // ── Outbound HTTP (LLM, tools, webhooks, telemetry) ──────────────────────
    /** TCP+TLS connect timeout for every outbound HTTP client. */
    val httpConnectTimeoutMs: Long,
    /** Time allowed to receive response *headers* (the JDK request timeout). */
    val httpHeadersTimeoutMs: Long,
    /**
     * Absolute ceiling on a single HTTP call **including body streaming**.
     * A per-node `timeoutMs` larger than this is clamped down; the node cannot
     * opt out of the ceiling.
     */
    val httpTotalCallCeilingMs: Long,
    /** Default total-call budget when a node specifies none. */
    val httpDefaultTotalCallMs: Long,
    /** Size of the shared idle-connection cache (`jdk.httpclient.connectionPoolSize`). */
    val httpConnectionPoolSize: Int,
    /** Threads in the shared HTTP client's executor — the real cap on concurrent exchanges. */
    val httpExecutorThreads: Int,
    /** Total-call ceiling for best-effort telemetry posts (kept short — it is not user work). */
    val telemetryTotalCallMs: Long,
) {
    companion object {
        private val log = LoggerFactory.getLogger(OutboundTimeouts::class.java)

        const val DEFAULT_CONNECT_MS = 5_000L
        const val DEFAULT_SOCKET_MS = 30_000L

        fun fromEnv(): OutboundTimeouts = OutboundTimeouts(
            dbConnectTimeoutSeconds = envI("DB_CONNECT_TIMEOUT_SECONDS", 5).coerceIn(1, 120),
            dbSocketTimeoutSeconds = envI("DB_SOCKET_TIMEOUT_SECONDS", 30).coerceIn(1, 600),
            dbLoginTimeoutSeconds = envI("DB_LOGIN_TIMEOUT_SECONDS", 5).coerceIn(1, 120),
            dbCancelSignalTimeoutSeconds = envI("DB_CANCEL_SIGNAL_TIMEOUT_SECONDS", 5).coerceIn(1, 60),

            tenantPoolConnectionTimeoutMs = envL("TENANT_DB_POOL_CONNECTION_TIMEOUT_MS", 10_000L),
            tenantPoolValidationTimeoutMs = envL("TENANT_DB_POOL_VALIDATION_TIMEOUT_MS", 3_000L),
            tenantPoolMaxLifetimeMs = envL("TENANT_DB_POOL_MAX_LIFETIME_MS", 1_800_000L),
            tenantPoolIdleTimeoutMs = envL("TENANT_DB_POOL_IDLE_TIMEOUT_MS", 300_000L),
            tenantPoolLeakDetectionMs = envL("TENANT_DB_POOL_LEAK_DETECTION_MS", 60_000L),
            tenantPoolMaxSize = envI("TENANT_DB_POOL_MAX_SIZE", 3).coerceIn(1, 20),

            platformPoolValidationTimeoutMs = envL("DB_POOL_VALIDATION_TIMEOUT_MS", 5_000L),
            platformPoolKeepaliveMs = envL("DB_POOL_KEEPALIVE_MS", 300_000L),

            httpConnectTimeoutMs = envL("HTTP_CONNECT_TIMEOUT_MS", DEFAULT_CONNECT_MS),
            httpHeadersTimeoutMs = envL("HTTP_HEADERS_TIMEOUT_MS", DEFAULT_SOCKET_MS),
            httpTotalCallCeilingMs = envL("HTTP_TOTAL_CALL_CEILING_MS", 120_000L),
            httpDefaultTotalCallMs = envL("HTTP_DEFAULT_TOTAL_CALL_MS", DEFAULT_SOCKET_MS),
            httpConnectionPoolSize = envI("HTTP_CONNECTION_POOL_SIZE", 64).coerceIn(1, 4_096),
            httpExecutorThreads = envI("HTTP_EXECUTOR_THREADS", 32).coerceIn(2, 512),
            telemetryTotalCallMs = envL("TELEMETRY_TOTAL_CALL_MS", 5_000L),
        )

        private fun envI(name: String, default: Int): Int =
            System.getenv(name)?.trim()?.toIntOrNull() ?: default

        private fun envL(name: String, default: Long): Long =
            System.getenv(name)?.trim()?.toLongOrNull() ?: default
    }

    /**
     * Clamp a caller-supplied per-call budget into [1s, httpTotalCallCeilingMs].
     * A node config of `timeoutMs: 0` or a hostile `timeoutMs: 999999999` both
     * land inside the ceiling.
     */
    fun clampTotalCallMs(requestedMs: Long?): Long {
        val requested = requestedMs?.takeIf { it > 0 } ?: httpDefaultTotalCallMs
        return requested.coerceIn(1_000L, httpTotalCallCeilingMs)
    }

    /**
     * Log every effective value exactly once, at startup. An operator reading
     * the boot log must be able to answer "what bounds a hung tenant DB right
     * now?" without reading the source.
     */
    fun logEffectiveValues() {
        log.info("=== outbound I/O timeouts (effective) ===")
        log.info("  jdbc.connectTimeout        : {}s", dbConnectTimeoutSeconds)
        log.info("  jdbc.socketTimeout         : {}s   <- bounds a hung tenant DB read", dbSocketTimeoutSeconds)
        log.info("  jdbc.loginTimeout          : {}s", dbLoginTimeoutSeconds)
        log.info("  jdbc.cancelSignalTimeout   : {}s", dbCancelSignalTimeoutSeconds)
        log.info("  tenantPool.connectionTimeout: {}ms", tenantPoolConnectionTimeoutMs)
        log.info("  tenantPool.validationTimeout: {}ms", tenantPoolValidationTimeoutMs)
        log.info("  tenantPool.maxLifetime      : {}ms", tenantPoolMaxLifetimeMs)
        log.info("  tenantPool.idleTimeout      : {}ms", tenantPoolIdleTimeoutMs)
        log.info("  tenantPool.leakDetection    : {}ms", tenantPoolLeakDetectionMs)
        log.info("  tenantPool.maxSize          : {} per connection record", tenantPoolMaxSize)
        log.info("  platformPool.validationTimeout: {}ms", platformPoolValidationTimeoutMs)
        log.info("  platformPool.keepalive        : {}ms", platformPoolKeepaliveMs)
        log.info("  http.connectTimeout        : {}ms", httpConnectTimeoutMs)
        log.info("  http.headersTimeout        : {}ms", httpHeadersTimeoutMs)
        log.info("  http.totalCallCeiling      : {}ms  <- clamps node timeoutMs", httpTotalCallCeilingMs)
        log.info("  http.defaultTotalCall      : {}ms", httpDefaultTotalCallMs)
        log.info("  http.connectionPoolSize    : {}", httpConnectionPoolSize)
        log.info("  http.executorThreads       : {}  <- max concurrent exchanges", httpExecutorThreads)
        log.info("  telemetry.totalCall        : {}ms", telemetryTotalCallMs)
    }
}
