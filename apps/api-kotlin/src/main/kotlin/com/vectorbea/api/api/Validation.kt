package com.vectorbea.api.api

import com.vectorbea.api.errors.ApiError

/** Validation helpers — all throw [ApiError.ValidationError] on failure. */

fun requireField(value: String?, fieldName: String): String {
    val trimmed = value?.trim()
    if (trimmed.isNullOrBlank()) throw ApiError.ValidationError("$fieldName is required")
    return trimmed
}

fun requireMaxLength(value: String, fieldName: String, max: Int): String {
    if (value.length > max)
        throw ApiError.ValidationError("$fieldName must be at most $max characters")
    return value
}

fun requireOneOf(value: String, fieldName: String, allowed: Set<String>): String {
    if (value !in allowed)
        throw ApiError.ValidationError(
            "$fieldName must be one of: ${allowed.joinToString(", ")}, got '$value'"
        )
    return value
}

fun requirePositive(value: Int?, fieldName: String): Int? {
    if (value != null && value < 0)
        throw ApiError.ValidationError("$fieldName must be positive, got $value")
    return value
}

fun requirePositiveDouble(value: Double?, fieldName: String): Double? {
    if (value != null && value < 0.0)
        throw ApiError.ValidationError("$fieldName must be non-negative, got $value")
    return value
}

/**
 * Connection type allowlist.
 *
 * `mcp` and `tool` are the SAME THING with two spellings, and both stay.
 * An MCP server has always been stored as `tool` — `ConnectionTester` has
 * treated `tool`, `mcp` and `mcp_server` as one case since it was written, and
 * the web maps its own `mcp_server` onto `tool` before sending. Rows exist with
 * `tool`, so removing it would orphan every MCP connection anyone has already
 * made; `mcp` is added because a type nobody can name is a type nobody can
 * filter a list by, which is how an MCP server became indistinguishable from
 * anything else typed `tool`.
 */
val CONNECTION_TYPES = setOf(
    "llm", "database", "http", "tool", "mcp", "vector_store", "object_storage",
)

/** The spellings that mean "an MCP server". Matches `ConnectionTester`'s `when`. */
val MCP_CONNECTION_TYPES = setOf("tool", "mcp", "mcp_server")

/** Provider allowlist for LLM connections */
val LLM_PROVIDERS = setOf("openai", "anthropic", "google", "mistral", "cohere", "azure_openai", "custom")

/** Agent type allowlist */
val AGENT_TYPES = setOf(
    "native_llm_agent", "iterative_agent", "tool_agent", "router_agent", "approval_agent",
    "imported_langgraph_node", "external_instrumented_agent",
    // Retained for API clients created before the enterprise registry vocabulary.
    "conversational", "task", "supervisor", "router", "custom",
)

/**
 * Tool type allowlist.
 *
 * `mcp` is here because `McpDiscovery.syncTools` has always INSERTed it, through
 * raw SQL that never passed this check. The two agreed only because discovery
 * never went through the create-tool route — and a vocabulary that a stored row
 * can violate is a vocabulary that will be believed and then contradicted.
 * Naming it also lets a person PATCH a discovered tool (its risk level, its
 * approval requirement) without the update being refused for a type the row
 * already has.
 */
val TOOL_TYPES = setOf("http", "database", "code", "builtin", "llm_generate", "mcp", "custom")

/** Tool risk levels */
val RISK_LEVELS = setOf("low", "medium", "high", "critical")

/** Workflow statuses */
val WORKFLOW_STATUSES = setOf("draft", "active", "archived")

/** Connection auth types */
/**
 * `webhook_url`: the credential IS the destination — a Teams, Google Chat or
 * Discord incoming webhook. Stored encrypted as the connection's secret like any
 * other credential, because anyone holding that URL can post to the channel.
 */
val AUTH_TYPES = setOf("api_key", "oauth2", "basic", "bearer", "none", "mtls", "custom", "connection_string", "webhook_url")

/**
 * Returns compatible connection types for each tool type.
 * Used to validate that tool.connectionId points to a compatible connection.
 */
fun compatibleConnectionTypes(toolType: String): Set<String> = when (toolType) {
    "http" -> setOf("http")
    "database" -> setOf("database")
    "llm_generate" -> setOf("llm")
    "builtin" -> emptySet()   // no connection needed
    "code" -> emptySet()      // no external connection
    /* An MCP tool's connection IS its server, and revoking it revokes every
       tool discovered through it — the one server-level action there should be.
       Pointing one at an LLM or a database connection would be a tool whose
       call can never be made. */
    "mcp" -> MCP_CONNECTION_TYPES
    "custom" -> CONNECTION_TYPES  // any
    else -> CONNECTION_TYPES
}

/**
 * Returns true if the given tool type requires a connectionId.
 *
 * ── WHY `http` IS HERE ──────────────────────────────────────────────────────
 * It is a PRODUCT decision, not a runtime one, and the distinction matters when
 * reading `HttpToolResolver`: the runtime runs a connection-less tool perfectly
 * well ("Public until a connection says otherwise"), and still does. Nothing
 * below is a claim that it cannot.
 *
 * The decision is that an API is modelled ONCE, as an integration, and a tool is
 * one fine-tuned call on it. Somebody registering an API registers a handful of
 * tools against it — a GET, a POST, a delete — and every one of them wants the
 * same host, the same credential, the same allowed hosts and the same egress
 * policy. With a connection that is one row they all point at:
 * `RequestAssembler.joinUrl` composes the connection's base URL with each tool's
 * relative path, so moving from staging to production is one edit rather than
 * one edit per tool, and revoking the credential revokes the whole set.
 *
 * Without one, each tool carries its own absolute URL and that shared fact is
 * copied N times, which is the state where a base URL gets changed in four
 * places out of five.
 *
 * ── THIS IS NOT THE DEAD END IT WAS BEFORE V064 ─────────────────────────────
 * The old refusal was wrong because the only escape was inventing an empty
 * connection. That escape is now the supported path and not a workaround: the
 * catalogue ships a `Generic HTTP` integration whose auth methods are `none` and
 * `api-key`, so a public API is a connection with a base URL and no credential —
 * which is a truthful description of it, and the place its allowed hosts and
 * egress policy live if it ever needs them.
 *
 * `mcp` is deliberately absent, for a reason unrelated to any of this: a
 * discovered MCP tool carries its server in `mcp_server_connection_id`, a
 * separate column with its own FK. Requiring `connection_id` would refuse every
 * row discovery writes.
 */
fun toolRequiresConnection(toolType: String): Boolean = when (toolType) {
    "http", "database", "llm_generate" -> true
    else -> false
}

/**
 * Forbidden fields in configJson — these would allow secret leakage.
 * Any key matching these patterns causes a validation error.
 */
private val FORBIDDEN_CONFIG_KEYS = setOf(
    "password", "secret", "api_key", "apikey", "token", "bearer",
    "credential", "private_key", "access_key", "secret_key",
    "client_secret", "auth_token", "connection_string",
)

/**
 * Validates that [configJson] does not contain known secret field names.
 * Callers must strip secrets and store them via the secrets service instead.
 */
fun validateConfigJsonNotContainsSecrets(config: Map<String, Any>, fieldPath: String = "config") {
    config.keys.forEach { key ->
        val lower = key.lowercase().replace("_", "").replace("-", "")
        if (FORBIDDEN_CONFIG_KEYS.any { lower.contains(it.replace("_", "")) }) {
            throw ApiError.ValidationError(
                "$fieldPath.$key looks like a secret field. " +
                    "Do not put credentials in config — use the secrets endpoint instead."
            )
        }
    }
}
