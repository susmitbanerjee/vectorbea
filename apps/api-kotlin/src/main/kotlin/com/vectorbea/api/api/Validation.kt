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

/** Connection type allowlist */
val CONNECTION_TYPES = setOf("llm", "database", "http", "tool")

/** Provider allowlist for LLM connections */
val LLM_PROVIDERS = setOf("openai", "anthropic", "google", "mistral", "cohere", "azure_openai", "custom")

/** Agent type allowlist */
val AGENT_TYPES = setOf("native_llm_agent", "conversational", "task", "supervisor", "router", "custom")

/** Tool type allowlist */
val TOOL_TYPES = setOf("http", "database", "code", "builtin", "llm_generate", "custom")

/** Tool risk levels */
val RISK_LEVELS = setOf("low", "medium", "high", "critical")

/** Workflow statuses */
val WORKFLOW_STATUSES = setOf("draft", "active", "archived")

/** Connection auth types */
val AUTH_TYPES = setOf("api_key", "oauth2", "basic", "bearer", "none", "mtls", "custom")

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
    "custom" -> CONNECTION_TYPES  // any
    else -> CONNECTION_TYPES
}

/** Returns true if the given tool type requires a connectionId. */
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
