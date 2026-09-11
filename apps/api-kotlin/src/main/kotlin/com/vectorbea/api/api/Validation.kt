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
val AUTH_TYPES = setOf("api_key", "oauth2", "basic", "bearer", "none", "mtls", "custom", "connection_string")

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
 * ── WHY `http` IS NOT HERE ──────────────────────────────────────────────────
 * It was, and it was wrong. A connection supplies an HTTP tool with two things:
 * a base URL and a credential. Since V064 the whole call lives in
 * `http_spec_json`, which carries its own absolute URL — so a tool that hits a
 * public endpoint needs neither, and `HttpToolResolver` has always handled
 * that: "Public until a connection says otherwise. A tool with no connection
 * behind it has nothing that could have authorised private egress."
 *
 * The runtime was therefore already correct and only the create route refused,
 * which made "register a tool for this public API" a dead end that ended in
 * inventing an empty connection to get past the form.
 *
 * The egress story is unchanged and is the reason this is safe: no connection
 * means `EgressPolicy.PUBLIC`, no allowed-hosts widening and no secret. A
 * connection-less HTTP tool can reach strictly less than one with a connection,
 * never more.
 *
 * `mcp` is also deliberately absent, for a different reason: a discovered MCP
 * tool carries its server in `mcp_server_connection_id`, a separate column with
 * its own FK. Requiring `connection_id` would refuse every row discovery writes.
 */
fun toolRequiresConnection(toolType: String): Boolean = when (toolType) {
    "database", "llm_generate" -> true
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
