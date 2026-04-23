package com.vectorbea.proxy.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

private const val TRACE_SCHEMA_VERSION = "1.0"

private val RESERVED_KEYS = setOf(
    "schema_version",
    "trace",
    "executor",
    "request",
    "prompt",
    "model",
    "retrieval",
    "cache",
    "guardrail",
    "fallback",
    "output",
    "evaluation",
    "logs",
    "spans",
    "tags",
    "custom",
)

object TraceMetadataBuilder {
    private fun primitiveContent(value: JsonPrimitive?): String? =
        value?.content?.takeIf { it.isNotBlank() }

    private fun primitiveBoolean(value: JsonPrimitive?): Boolean? =
        when (value?.content?.lowercase()) {
            "true" -> true
            "false" -> false
            else -> null
        }

    private fun buildSpan(
        spanId: String,
        parentSpanId: String?,
        name: String,
        type: String,
        component: String,
        status: String,
        startOffsetMs: Double,
        durationMs: Double,
    ): JsonObject = buildJsonObject {
        put("span_id", JsonPrimitive(spanId))
        parentSpanId?.let { put("parent_span_id", JsonPrimitive(it)) }
        put("name", JsonPrimitive(name))
        put("type", JsonPrimitive(type))
        put("component", JsonPrimitive(component))
        put("status", JsonPrimitive(status))
        put("start_offset_ms", JsonPrimitive(startOffsetMs.coerceAtLeast(0.0)))
        put("duration_ms", JsonPrimitive(durationMs.coerceAtLeast(0.0)))
    }

    private fun buildDefaultSpans(
        totalDurationMs: Double,
        proxyLatencyMs: Double,
        llmLatencyMs: Int,
        status: String,
    ): JsonArray = buildJsonArray {
        add(
            buildSpan(
                spanId = "root",
                parentSpanId = null,
                name = "request",
                type = "root",
                component = "vectorbea-proxy",
                status = status,
                startOffsetMs = 0.0,
                durationMs = totalDurationMs.coerceAtLeast(1.0),
            ),
        )

        add(
            buildSpan(
                spanId = "proxy",
                parentSpanId = "root",
                name = "proxy runtime",
                type = "sidecar",
                component = "vectorbea-proxy",
                status = "success",
                startOffsetMs = 0.0,
                durationMs = proxyLatencyMs.coerceAtLeast(1.0),
            ),
        )

        if (llmLatencyMs > 0) {
            add(
                buildSpan(
                    spanId = "llm",
                    parentSpanId = "root",
                    name = "llm completion",
                    type = "llm",
                    component = "llm-provider",
                    status = status,
                    startOffsetMs = proxyLatencyMs.coerceAtLeast(0.0),
                    durationMs = llmLatencyMs.toDouble().coerceAtLeast(1.0),
                ),
            )
        }
    }

    fun normalize(
        metadata: JsonObject,
        promptVersionId: String,
        promptName: String,
        versionTag: String,
        proxyLatencyMs: Double,
        llmLatencyMs: Int,
        tokenCount: Int,
        useType: String = "runtime",
    ): JsonObject {
        val trace = metadata["trace"] as? JsonObject
        val executor = metadata["executor"] as? JsonObject
        val prompt = metadata["prompt"] as? JsonObject
        val model = metadata["model"] as? JsonObject
        val cache = metadata["cache"] as? JsonObject
        val output = metadata["output"] as? JsonObject
        val tags = metadata["tags"] as? JsonObject
        val custom = metadata["custom"] as? JsonObject ?: buildJsonObject {
            metadata.forEach { (key, value) ->
                if (key !in RESERVED_KEYS) {
                    put(key, value)
                }
            }
        }

        val fallbackTriggered = primitiveBoolean(metadata["fallbackUsed"] as? JsonPrimitive)
            ?: primitiveBoolean((metadata["fallback"] as? JsonObject)?.get("triggered") as? JsonPrimitive)

        val totalDuration = (proxyLatencyMs + llmLatencyMs).coerceAtLeast(0.0)
        val traceStatus = trace?.get("status")?.let { (it as? JsonPrimitive)?.content }
            ?: if (fallbackTriggered == true) "warning" else "success"
        val spans = metadata["spans"] as? JsonArray
        val normalizedSpans = if (spans == null || spans.isEmpty()) {
            buildDefaultSpans(
                totalDurationMs = totalDuration,
                proxyLatencyMs = proxyLatencyMs,
                llmLatencyMs = llmLatencyMs,
                status = traceStatus,
            )
        } else {
            spans
        }

        return buildJsonObject {
            put("schema_version", TRACE_SCHEMA_VERSION)

            putJsonObject("trace") {
                trace?.forEach { (key, value) -> put(key, value) }
                put("duration_ms", JsonPrimitive(totalDuration))
                if (trace?.get("status") == null) {
                    put("status", JsonPrimitive(traceStatus))
                }
            }

            putJsonObject("executor") {
                executor?.forEach { (key, value) -> put(key, value) }
                if (executor?.get("type") == null) put("type", JsonPrimitive("direct_provider"))
                if (executor?.get("ownership") == null) put("ownership", JsonPrimitive("vectorbea"))
                if (executor?.get("request_mode") == null) put("request_mode", JsonPrimitive("direct"))
                if (executor?.get("response_observability") == null) put("response_observability", JsonPrimitive("full"))
            }

            putJsonObject("prompt") {
                prompt?.forEach { (key, value) -> put(key, value) }
                put("prompt_version_id", JsonPrimitive(promptVersionId))
                if (promptName.isNotBlank()) put("name", JsonPrimitive(promptName))
                if (versionTag.isNotBlank()) put("version_tag", JsonPrimitive(versionTag))
            }

            putJsonObject("model") {
                model?.forEach { (key, value) -> put(key, value) }
                if (llmLatencyMs > 0 && model?.get("latency_ms") == null) {
                    put("latency_ms", JsonPrimitive(llmLatencyMs))
                }
                if (tokenCount >= 0 && model?.get("total_tokens") == null) {
                    put("total_tokens", JsonPrimitive(tokenCount))
                }
            }

            putJsonObject("cache") {
                cache?.forEach { (key, value) -> put(key, value) }
                val legacyCacheStatus = primitiveContent(metadata["cacheStatus"] as? JsonPrimitive)
                val legacyCacheHit = primitiveBoolean(metadata["cacheHit"] as? JsonPrimitive)
                if (cache?.get("status") == null) {
                    when {
                        !legacyCacheStatus.isNullOrBlank() -> put("status", legacyCacheStatus)
                        legacyCacheHit == true -> put("status", JsonPrimitive("hit"))
                        legacyCacheHit == false -> put("status", JsonPrimitive("miss"))
                    }
                }
            }

            put("guardrail", metadata["guardrail"] ?: JsonObject(emptyMap()))
            put("fallback", metadata["fallback"] ?: JsonObject(emptyMap()))
            put("request", metadata["request"] ?: JsonObject(emptyMap()))
            put("retrieval", metadata["retrieval"] ?: JsonObject(emptyMap()))
            put("evaluation", metadata["evaluation"] ?: JsonObject(emptyMap()))

            putJsonObject("output") {
                output?.forEach { (key, value) -> put(key, value) }
                if (output?.get("final_text") == null) {
                    primitiveContent(metadata["finalOutput"] as? JsonPrimitive)?.let { finalOut ->
                        put("final_text", JsonPrimitive(finalOut))
                    }
                }
                if (output?.get("raw_text") == null) {
                    primitiveContent(metadata["rawOutput"] as? JsonPrimitive)?.let { raw ->
                        put("raw_text", JsonPrimitive(raw))
                    }
                }
            }

            put("logs", metadata["logs"] ?: JsonArray(emptyList()))
            putJsonArray("spans") {
                normalizedSpans.forEach { add(it) }
            }

            putJsonObject("tags") {
                tags?.forEach { (key, value) -> put(key, value) }
                put("use_type", JsonPrimitive(useType))
            }

            put("custom", custom)
        }
    }
}
