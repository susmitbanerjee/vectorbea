package com.vectorbea.sdk

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

const val TRACE_METADATA_SCHEMA_VERSION: String = "1.0"

internal fun buildTraceMetadataV1(
    metadata: Map<String, String>,
    promptVersionId: String,
    promptName: String,
    versionTag: String,
    proxyLatencyMs: Double,
    llmLatencyMs: Long,
    tokenCount: Int,
    useType: String = "runtime",
): JsonObject = buildJsonObject {
    put("schema_version", TRACE_METADATA_SCHEMA_VERSION)

    putJsonObject("trace") {
        put("duration_ms", JsonPrimitive((proxyLatencyMs + llmLatencyMs).coerceAtLeast(0.0)))
        put("status", JsonPrimitive(if (metadata["fallbackUsed"] == "true") "warning" else "success"))
    }

    putJsonObject("executor") {
        put("type", JsonPrimitive(metadata["executorType"] ?: "direct_provider"))
        put("name", JsonPrimitive(metadata["executorName"] ?: metadata["provider"] ?: "direct-provider"))
        put("ownership", JsonPrimitive(metadata["executorOwnership"] ?: "vectorbea"))
        put("request_mode", JsonPrimitive(metadata["executorRequestMode"] ?: "direct"))
        metadata["executorEndpoint"]?.let { put("endpoint", JsonPrimitive(it)) }
        put("response_observability", JsonPrimitive(metadata["executorObservability"] ?: "full"))
    }

    putJsonObject("prompt") {
        put("prompt_version_id", JsonPrimitive(promptVersionId))
        if (promptName.isNotBlank()) put("name", JsonPrimitive(promptName))
        if (versionTag.isNotBlank()) put("version_tag", JsonPrimitive(versionTag))
    }

    putJsonObject("model") {
        val provider = metadata["provider"]
        val model = metadata["model"]
        if (!provider.isNullOrBlank()) put("provider", JsonPrimitive(provider))
        if (!model.isNullOrBlank()) put("model", JsonPrimitive(model))
        put("latency_ms", JsonPrimitive(llmLatencyMs))
        put("total_tokens", JsonPrimitive(tokenCount))
    }

    putJsonObject("cache") {
        metadata["cacheStatus"]?.let { put("status", JsonPrimitive(it)) }
        metadata["cacheKey"]?.let { put("cache_key", JsonPrimitive(it)) }
    }

    putJsonObject("output") {
        metadata["rawOutput"]?.let { put("raw_text", JsonPrimitive(it)) }
        metadata["finalOutput"]?.let { put("final_text", JsonPrimitive(it)) }
    }

    put("logs", JsonArray(emptyList()))
    put("spans", JsonArray(emptyList()))

    putJsonObject("tags") {
        put("use_type", JsonPrimitive(useType))
    }

    putJsonObject("custom") {
        metadata.forEach { (key, value) ->
            if (key !in setOf(
                    "provider",
                    "model",
                    "cacheStatus",
                    "cacheKey",
                    "rawOutput",
                    "finalOutput",
                )
            ) {
                put(key, JsonPrimitive(value))
            }
        }
    }
}
