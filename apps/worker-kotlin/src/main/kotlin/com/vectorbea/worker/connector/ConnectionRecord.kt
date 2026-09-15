package com.vectorbea.worker.connector

import java.util.UUID

/**
 * Worker-side connection model loaded from the `connections` table.
 *
 * SECURITY:
 *  - [secretRef] is an opaque reference; the actual secret is resolved separately
 *    via [SecretService] and never stored here.
 *  - [configJson] must NOT contain credentials — only non-sensitive config.
 */
data class ConnectionRecord(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val type: String,           // "llm" | "http" | "database" | ...
    val provider: String,       // "openai" | "anthropic" | "gemini" | "postgresql" | ...
    val status: String,         // "active" | "inactive" | "error"
    val authType: String,       // "api_key" | "bearer" | "basic" | "none"
    val secretRef: String?,
    /** Non-sensitive config: base URLs, host, port, schema names, etc. Never credentials. */
    val configJson: Map<String, Any>,
    /** Non-empty list means only these hosts/IPs are permitted for SSRF protection. */
    val allowedHosts: List<String>,
    /**
     * How far this connection may reach. See [SsrfGuard.EgressPolicy].
     *
     * Defaulted to PUBLIC rather than made required, because the API and the
     * worker deploy independently: a worker running ahead of V071 reads a column
     * that is not there yet, and the safe reading of "I could not tell" is the
     * restrictive one. A connection whose private egress is silently ignored
     * fails visibly and is fixed; one whose restriction is silently ignored does
     * not fail at all.
     */
    val egressPolicy: SsrfGuard.EgressPolicy = SsrfGuard.EgressPolicy.PUBLIC,
    val allowedPaths: List<String>,
    val allowedSchemas: List<String>,
    val allowedTables: List<String>,
)

/**
 * A resolved connection: the record plus the decrypted secret (may be null).
 * The secret is wrapped in [SecretValue] to minimize its exposure window.
 *
 * Use [secret] immediately and let it be garbage-collected; do not retain it.
 */
data class ResolvedConnection(
    val record: ConnectionRecord,
    /** Null when the connection requires no credentials or secret resolution failed gracefully. */
    val secret: SecretValue?,
)

/** Exception thrown when connection validation fails. */
class ConnectionException(message: String, cause: Throwable? = null) : Exception(message, cause)
