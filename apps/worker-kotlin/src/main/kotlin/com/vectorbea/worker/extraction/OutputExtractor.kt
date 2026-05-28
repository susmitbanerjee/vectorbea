package com.vectorbea.worker.extraction

import com.vectorbea.worker.mapping.JsonPathResolver
import com.vectorbea.worker.mapping.MappingResolver
import com.vectorbea.worker.mapping.StepOutputView
import com.vectorbea.worker.runtime.graph.RuntimeContext

/**
 * Extracts structured output from a node's raw output.
 *
 * Extraction modes (configured via [WorkflowNode.outputExtraction]):
 *
 *   full_response        — return the entire raw output map as-is
 *   body                 — return rawOutput["body"] (Map) or rawOutput itself
 *   json_path            — apply a JSONPath expression (e.g. "$.rows[0]")
 *   custom_mapping       — apply a named mapping of targetKey → expression
 *
 * Config structure in [WorkflowNode.outputExtraction] (Map<String, Any>):
 *
 *   { "mode": "full_response" }
 *   { "mode": "body" }
 *   { "mode": "json_path", "path": "$.data.customers" }
 *   { "mode": "json_path", "path": "$.rows[0]", "targetKey": "firstRow" }
 *   { "mode": "custom_mapping", "fields": { "customerId": "$.body.id", "name": "$.body.fullName" } }
 *
 * Individual [WorkflowNode.outputExtraction] map entries (targetKey → jsonPath)
 * are also supported as shorthand for multi-field json_path extraction.
 *
 * SECURITY: Path expressions are parsed with [JsonPathResolver] — never eval'd.
 */
object OutputExtractor {

    /**
     * Extraction result: the extracted data plus metadata.
     */
    data class ExtractionResult(
        val extracted: Map<String, Any>,
        val mode: String,
        val fieldCount: Int,
    )

    /**
     * Extract from [rawOutput] using the extraction config from the node.
     *
     * @param rawOutput        the raw output returned by the executor
     * @param extractionConfig [WorkflowNode.outputExtraction] — may be empty
     * @param legacyExtractionMap  legacy per-field dot-paths from [WorkflowNode.outputExtraction]
     *                             (Map<String, String> where value is a dot-path)
     * @param ctx              current runtime context (for template resolution)
     * @param stepOutputs      current step output view (for cross-step references)
     */
    fun extract(
        rawOutput: Map<String, Any>,
        extractionConfig: Map<String, Any>,
        legacyExtractionMap: Map<String, String> = emptyMap(),
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): ExtractionResult {
        // If there's a "mode" key, use the structured extraction config
        val mode = extractionConfig["mode"] as? String

        if (mode != null) {
            return when (mode) {
                "full_response"  -> fullResponse(rawOutput)
                "body"           -> extractBody(rawOutput)
                "json_path"      -> extractJsonPath(rawOutput, extractionConfig)
                "custom_mapping" -> extractCustomMapping(rawOutput, extractionConfig, ctx, stepOutputs)
                else             -> fullResponse(rawOutput) // unknown mode → pass through
            }
        }

        // Legacy: each key in outputExtraction is targetKey → jsonPath
        if (legacyExtractionMap.isNotEmpty()) {
            return extractLegacyFields(rawOutput, legacyExtractionMap)
        }

        // No extraction config → pass through raw output
        return fullResponse(rawOutput)
    }

    // ── Mode implementations ──────────────────────────────────────────────────

    private fun fullResponse(raw: Map<String, Any>): ExtractionResult =
        ExtractionResult(extracted = raw, mode = "full_response", fieldCount = raw.size)

    @Suppress("UNCHECKED_CAST")
    private fun extractBody(raw: Map<String, Any>): ExtractionResult {
        val body = raw["body"] as? Map<String, Any> ?: raw
        return ExtractionResult(extracted = body, mode = "body", fieldCount = body.size)
    }

    private fun extractJsonPath(raw: Map<String, Any>, config: Map<String, Any>): ExtractionResult {
        val path = config["path"] as? String
            ?: return fullResponse(raw)  // no path → pass through

        val targetKey = config["targetKey"] as? String ?: "result"
        val resolved  = JsonPathResolver.resolve(path, raw)
            ?: throw ExtractionException("json_path extraction: path '$path' resolved to null in output")

        val extracted: Map<String, Any> = when (resolved) {
            is Map<*, *>  -> {
                @Suppress("UNCHECKED_CAST")
                val asMap = resolved as Map<String, Any>
                // If targetKey is explicitly provided, wrap; else return the map directly
                if (config.containsKey("targetKey")) mapOf(targetKey to asMap) else asMap
            }
            else -> mapOf(targetKey to resolved)
        }

        return ExtractionResult(extracted = extracted, mode = "json_path", fieldCount = extracted.size)
    }

    @Suppress("UNCHECKED_CAST")
    private fun extractCustomMapping(
        raw: Map<String, Any>,
        config: Map<String, Any>,
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): ExtractionResult {
        val fields = config["fields"] as? Map<String, String>
            ?: return fullResponse(raw)

        val extracted = mutableMapOf<String, Any>()
        for ((targetKey, expr) in fields) {
            // First try JSONPath against raw output
            val jpResult = runCatching { JsonPathResolver.resolve(expr, raw) }.getOrNull()
            if (jpResult != null) {
                extracted[targetKey] = jpResult
                continue
            }
            // Then try template resolution
            val tmplResult = runCatching {
                MappingResolver.resolveTemplateString(expr, ctx, stepOutputs)
            }.getOrNull()
            if (tmplResult != null) {
                extracted[targetKey] = tmplResult
            }
        }

        return ExtractionResult(extracted = extracted, mode = "custom_mapping", fieldCount = extracted.size)
    }

    private fun extractLegacyFields(
        raw: Map<String, Any>,
        fields: Map<String, String>,
    ): ExtractionResult {
        val extracted = mutableMapOf<String, Any>()
        for ((targetKey, path) in fields) {
            val resolved = JsonPathResolver.resolve(path, raw)
                ?: JsonPathResolver.resolvePathInMap(path, raw)
            if (resolved != null) extracted[targetKey] = resolved
        }
        return ExtractionResult(extracted = extracted, mode = "custom_mapping", fieldCount = extracted.size)
    }
}

class ExtractionException(message: String) : Exception(message)
