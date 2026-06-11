package com.vectorbea.api.connector

import java.time.Instant

/**
 * Result of a connection test.
 *
 * SECURITY: This record is returned in API responses.
 * It MUST NOT contain any secrets, credentials, raw connection strings,
 * internal hostnames, or stack traces.
 */
data class ConnectionTestResult(
    /** High-level outcome */
    val status: TestStatus,
    /** Wall-clock latency of the connection attempt in milliseconds */
    val latencyMs: Long,
    /** Machine-readable error code — safe to expose */
    val errorCode: String?,
    /** Human-readable sanitized message — safe to expose */
    val message: String,
    /** When the test was performed */
    val testedAt: Instant = Instant.now(),
    /** Optional metadata safe to show (model list, DB version, etc.) */
    val details: Map<String, Any?> = emptyMap(),
) {
    enum class TestStatus {
        /** Connection succeeded */
        CONNECTED,
        /** Connection failed for any reason */
        FAILED,
        /** The target host is private/internal — whitelist or private runner required */
        PRIVATE_RUNNER_REQUIRED,
        /** Target may be accessible but IP needs to be whitelisted at the remote */
        WHITELIST_REQUIRED,
    }

    fun toResponse(): Map<String, Any?> = mapOf(
        "status" to status.name.lowercase(),
        "latencyMs" to latencyMs,
        "errorCode" to errorCode,
        "message" to message,
        "testedAt" to testedAt.toString(),
        "details" to details,
    )

    companion object {
        fun connected(latencyMs: Long, message: String = "Connection successful", details: Map<String, Any?> = emptyMap()) =
            ConnectionTestResult(TestStatus.CONNECTED, latencyMs, null, message, details = details)

        fun failed(latencyMs: Long, errorCode: String, message: String) =
            ConnectionTestResult(TestStatus.FAILED, latencyMs, errorCode, message)

        fun privateHost(latencyMs: Long = 0) =
            ConnectionTestResult(
                TestStatus.PRIVATE_RUNNER_REQUIRED, latencyMs,
                "PRIVATE_HOST", "The target host is in a private network. Enable private runner mode."
            )
    }
}
