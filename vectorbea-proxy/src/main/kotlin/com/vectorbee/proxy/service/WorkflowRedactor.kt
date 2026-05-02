package com.vectorbea.proxy.service

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val SENSITIVE_KEYS = setOf(
    "authorization",
    "api_key",
    "apikey",
    "x-api-key",
    "password",
    "secret",
    "token",
    "bearer",
    "credential",
    "private_key",
)

private val SECRET_VALUE_PATTERNS = listOf(
    Regex("Bearer\\s+[A-Za-z0-9._\\-]+", RegexOption.IGNORE_CASE),
    Regex("sk-[A-Za-z0-9]{20,}", RegexOption.IGNORE_CASE),
    Regex("vb(?:_li|_ingest_[a-z]+)?_[A-Za-z0-9]{12,}", RegexOption.IGNORE_CASE),
    Regex("(?<![A-Za-z0-9])[A-Za-z0-9_\\-]{32,}(?![A-Za-z0-9])"),
)

data class RedactionResult(
    val element: JsonElement,
    val redactionCount: Long,
)

object WorkflowRedactor {
    fun redact(element: JsonElement?, aggressive: Boolean): RedactionResult {
        if (element == null) return RedactionResult(JsonNull, 0)
        var count = 0L

        fun walk(node: JsonElement): JsonElement = when (node) {
            is JsonObject -> JsonObject(
                node.mapValues { (key, value) ->
                    val keyLower = key.lowercase()
                    if (SENSITIVE_KEYS.any { keyLower.contains(it) }) {
                        count += 1
                        JsonPrimitive("[REDACTED]")
                    } else {
                        walk(value)
                    }
                },
            )
            is JsonArray -> JsonArray(node.map { walk(it) })
            is JsonPrimitive -> {
                if (!node.isString) {
                    node
                } else {
                    val raw = node.content
                    val redacted = if (aggressive) {
                        SECRET_VALUE_PATTERNS.fold(raw) { current, pattern ->
                            pattern.replace(current, "[REDACTED]")
                        }
                    } else {
                        SECRET_VALUE_PATTERNS.take(2).fold(raw) { current, pattern ->
                            pattern.replace(current, "[REDACTED]")
                        }
                    }
                    if (redacted != raw) {
                        count += 1
                    }
                    JsonPrimitive(redacted)
                }
            }
        }

        return RedactionResult(walk(element), count)
    }
}
