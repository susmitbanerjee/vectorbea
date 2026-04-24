package com.vectorbea.sdk

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

const val TRACE_METADATA_SCHEMA_VERSION: String = "1.0"

private fun asMap(value: Any?): Map<String, Any?> =
    (value as? Map<*, *>)?.entries
        ?.mapNotNull { (key, item) -> (key as? String)?.let { it to item } }
        ?.toMap()
        ?: emptyMap()

private fun asNumber(value: Any?, fallback: Number = 0): Number =
    value as? Number ?: fallback

private fun Any?.toJsonElement(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Map<*, *> -> buildJsonObject {
        this@toJsonElement.forEach { (key, value) ->
            if (key is String) put(key, value.toJsonElement())
        }
    }
    is Iterable<*> -> buildJsonArray {
        this@toJsonElement.forEach { add(it.toJsonElement()) }
    }
    is Array<*> -> buildJsonArray {
        this@toJsonElement.forEach { add(it.toJsonElement()) }
    }
    else -> JsonPrimitive(this.toString())
}

private fun normalizeCost(value: Any?): Map<String, Any?> {
    val cost = asMap(value)
    return buildMap {
        put("currency", cost["currency"] ?: "USD")
        (cost["input_cost"] ?: cost["inputCost"])?.let { if (it is Number) put("input_cost", it) }
        (cost["output_cost"] ?: cost["outputCost"])?.let { if (it is Number) put("output_cost", it) }
        (cost["total_cost"] ?: cost["totalCost"])?.let { if (it is Number) put("total_cost", it) }
    }
}

private fun syntheticSpans(
    proxyLatencyMs: Double,
    llmLatencyMs: Long,
    durationMs: Double,
    status: String,
): List<Map<String, Any?>> = buildList {
    add(
        mapOf(
            "span_id" to "root",
            "parent_span_id" to null,
            "name" to "Runtime execution",
            "type" to "root",
            "component" to "vectorbea-sdk",
            "status" to status,
            "start_offset_ms" to 0,
            "duration_ms" to durationMs,
        ),
    )
    if (proxyLatencyMs > 0) {
        add(
            mapOf(
                "span_id" to "prompt-resolve",
                "parent_span_id" to "root",
                "name" to "Prompt resolution",
                "type" to "prompt_resolve",
                "component" to "vectorbea",
                "status" to status,
                "start_offset_ms" to 0,
                "duration_ms" to proxyLatencyMs,
            ),
        )
    }
    if (llmLatencyMs > 0) {
        add(
            mapOf(
                "span_id" to "llm-call",
                "parent_span_id" to "root",
                "name" to "LLM completion",
                "type" to "llm",
                "component" to "llm",
                "status" to status,
                "start_offset_ms" to proxyLatencyMs.coerceAtLeast(0.0),
                "duration_ms" to llmLatencyMs,
            ),
        )
    }
}

internal fun buildTraceMetadataV1(
    metadata: Map<String, Any?>,
    promptVersionId: String,
    promptName: String,
    versionTag: String,
    proxyLatencyMs: Double,
    llmLatencyMs: Long,
    tokenCount: Int,
    useType: String = "runtime",
): JsonObject {
    val trace = asMap(metadata["trace"])
    val executor = asMap(metadata["executor"])
    val request = asMap(metadata["request"])
    val requestInput = asMap(request["input"])
    val prompt = asMap(metadata["prompt"])
    val model = asMap(metadata["model"])
    val retrieval = asMap(metadata["retrieval"] ?: metadata["rag"])
    val cache = asMap(metadata["cache"])
    val guardrail = asMap(metadata["guardrail"])
    val output = asMap(metadata["output"])
    val tags = asMap(metadata["tags"])
    val custom = asMap(metadata["custom"]).toMutableMap()
    val reserved = setOf(
        "schema_version",
        "trace",
        "executor",
        "request",
        "prompt",
        "model",
        "retrieval",
        "rag",
        "cache",
        "guardrail",
        "output",
        "spans",
        "logs",
        "tags",
        "custom",
    )
    metadata.forEach { (key, value) ->
        if (key !in reserved) custom[key] = value
    }

    val durationMs = (proxyLatencyMs + llmLatencyMs).coerceAtLeast(0.0)
    val status = trace["status"] as? String ?: if (custom["fallbackUsed"] == true || custom["fallbackUsed"] == "true") {
        "warning"
    } else {
        "success"
    }
    val inputText = requestInput["text"] ?: asMap(metadata["input"])["text"]
    val variables = asMap(prompt["variables"] ?: custom["variables"])
    val modelName = model["model"] ?: model["name"] ?: custom["model"]
    val inputTokens = asNumber(model["input_tokens"] ?: model["tokensIn"] ?: custom["tokensIn"], 0).toInt()
    val outputTokens = asNumber(model["output_tokens"] ?: model["tokensOut"] ?: custom["tokensOut"], 0).toInt()
    val totalTokens = asNumber(model["total_tokens"] ?: custom["totalTokens"], tokenCount).toInt()
    val guardrailAction = when (guardrail["action"]) {
        "passed" -> "allow"
        "flagged" -> "warn"
        else -> guardrail["action"] as? String
    }
    val spans = metadata["spans"] as? List<*>

    return buildJsonObject {
        put("schema_version", TRACE_METADATA_SCHEMA_VERSION)

        putJsonObject("trace") {
            trace.forEach { (key, value) -> put(key, value.toJsonElement()) }
            put("duration_ms", asNumber(trace["duration_ms"], durationMs).toJsonElement())
            put("status", status)
        }

        putJsonObject("executor") {
            executor.forEach { (key, value) -> put(key, value.toJsonElement()) }
            put("type", executor["type"] as? String ?: "direct_provider")
            put("name", executor["name"] as? String ?: model["provider"] as? String ?: "direct-provider")
            put("ownership", executor["ownership"] as? String ?: "vectorbea")
            put("request_mode", executor["request_mode"] as? String ?: "direct")
            put("endpoint", executor["endpoint"].toJsonElement())
            put("response_observability", executor["response_observability"] as? String ?: executor["observability"] as? String ?: "full")
        }

        putJsonObject("request") {
            request.forEach { (key, value) -> if (key != "input") put(key, value.toJsonElement()) }
            putJsonObject("input") {
                requestInput.forEach { (key, value) -> put(key, value.toJsonElement()) }
                if (inputText is String) put("text", inputText)
                if (variables.isNotEmpty()) put("variables", variables.toJsonElement())
            }
        }

        putJsonObject("prompt") {
            prompt.forEach { (key, value) -> put(key, value.toJsonElement()) }
            put("prompt_version_id", prompt["prompt_version_id"] as? String ?: promptVersionId)
            if (promptName.isNotBlank()) put("name", prompt["name"] as? String ?: promptName)
            if (versionTag.isNotBlank()) put("version_tag", prompt["version_tag"] as? String ?: versionTag)
            put("variables", variables.toJsonElement())
        }

        putJsonObject("model") {
            model.forEach { (key, value) -> if (key != "name") put(key, value.toJsonElement()) }
            if (modelName is String) put("model", modelName)
            put("input_tokens", inputTokens)
            put("output_tokens", outputTokens)
            put("total_tokens", totalTokens)
            put("latency_ms", asNumber(model["latency_ms"], llmLatencyMs).toLong())
            put("cost", normalizeCost(model["cost"] ?: custom["cost"]).toJsonElement())
        }

        putJsonObject("retrieval") {
            retrieval.forEach { (key, value) -> if (key != "chunks") put(key, value.toJsonElement()) }
            put("enabled", retrieval["enabled"] as? Boolean ?: listOf("query", "sources", "chunks").any { retrieval[it] != null })
            if (retrieval["retrieval_ms"] != null && retrieval["latency_ms"] == null) {
                put("latency_ms", retrieval["retrieval_ms"].toJsonElement())
            }
            if (retrieval["chunks"] != null && retrieval["sources"] == null) {
                put("sources", retrieval["chunks"].toJsonElement())
            }
        }

        putJsonObject("cache") {
            cache.forEach { (key, value) -> put(key, value.toJsonElement()) }
            put("enabled", cache["enabled"] as? Boolean ?: (cache["status"] != null))
        }

        putJsonObject("guardrail") {
            guardrail.forEach { (key, value) -> if (key != "action") put(key, value.toJsonElement()) }
            put("triggered", guardrail["triggered"] as? Boolean ?: (guardrailAction == "warn" || guardrailAction == "block"))
            guardrailAction?.let { put("action", it) }
        }

        putJsonObject("output") {
            output.forEach { (key, value) -> if (key != "text") put(key, value.toJsonElement()) }
            (output["raw_text"] ?: custom["rawOutput"])?.let { put("raw_text", it.toJsonElement()) }
            (output["final_text"] ?: output["text"] ?: custom["finalOutput"])?.let { put("final_text", it.toJsonElement()) }
        }

        putJsonArray("logs") {
            (metadata["logs"] as? List<*>)?.forEach { add(it.toJsonElement()) }
        }
        put(
            "spans",
            if (!spans.isNullOrEmpty()) {
                spans.toJsonElement()
            } else {
                syntheticSpans(proxyLatencyMs, llmLatencyMs, durationMs, status).toJsonElement()
            },
        )
        putJsonObject("tags") {
            tags.forEach { (key, value) ->
                if (value is String && value.isNotBlank()) put(key, value)
            }
            put("use_type", useType)
        }
        put("custom", custom.toJsonElement())
    }
}
