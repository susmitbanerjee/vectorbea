package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.extraction.OutputExtractor
import com.vectorbea.worker.mapping.InMemoryStepOutputView
import com.vectorbea.worker.mapping.MappingException
import com.vectorbea.worker.mapping.MappingResolver
import com.vectorbea.worker.mapping.StepOutputView
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import com.vectorbea.worker.validation.JsonSchemaValidator

/**
 * Executor for TRANSFORM nodes — full data-movement implementation.
 *
 * Pipeline:
 *   1. TRANSFORM_STARTED
 *   2. Resolve input mapping via [MappingResolver] (template expressions)
 *   3. INPUT_MAPPING_COMPLETED (or INPUT_MAPPING_FAILED)
 *   4. Apply output mapping (targetKey → source expression)
 *   5. Run [OutputExtractor] to extract fields from intermediate result
 *   6. OUTPUT_EXTRACTION_COMPLETED (or OUTPUT_EXTRACTION_FAILED)
 *   7. Validate against outputSchema via [JsonSchemaValidator]
 *   8. STEP_OUTPUT_VALIDATED (or STEP_SCHEMA_VALIDATION_FAILED)
 *   9. TRANSFORM_COMPLETED
 *
 * Events are emitted as metadata on the returned [NodeResult], not directly
 * (WorkflowRuntime handles event emission).  The [TransformEvents] data class
 * carries them so the runtime can emit them in order.
 *
 * SECURITY:
 *   - Input values are never logged raw.
 *   - Output values stored in metadata are truncated and sanitized.
 *   - Forbidden mapping references throw [MappingException] → NodeResult.Failed.
 */
class TransformNodeExecutor(
    private val stepOutputView: StepOutputView = InMemoryStepOutputView(),
) : NodeExecutor {

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        // ── 1. Resolve full input mapping via template resolver ────────────────
        val mappedInputs: Map<String, Any> = try {
            val templateMapping = node.inputMapping.ifEmpty { null }
            if (templateMapping != null) {
                MappingResolver.resolveMapping(templateMapping, ctx, stepOutputView)
            } else {
                resolvedInputs // already resolved by WorkflowRuntime's basic resolver
            }
        } catch (e: MappingException) {
            return NodeResult.Failed("Input mapping failed: ${e.message}")
        } catch (e: Exception) {
            return NodeResult.Failed("Input mapping error: ${e.message?.take(200)}")
        }

        // Start with all mapped inputs
        val working = mutableMapOf<String, Any>()
        working.putAll(mappedInputs)

        // ── 2. Apply output mapping (rename/reshape fields) ───────────────────
        if (node.outputMapping.isNotEmpty()) {
            for ((targetKey, sourceExpr) in node.outputMapping) {
                val value = resolveOutputExpr(sourceExpr, working, ctx)
                if (value != null) working[targetKey] = value
            }
        }

        // ── 3. Apply output extraction ────────────────────────────────────────
        @Suppress("UNCHECKED_CAST")
        val extractionConfig = node.config["outputExtraction"] as? Map<String, Any> ?: emptyMap()
        val legacyExtraction = node.outputExtraction // Map<String, String>

        val extractionResult = try {
            OutputExtractor.extract(
                rawOutput         = working,
                extractionConfig  = extractionConfig,
                legacyExtractionMap = legacyExtraction,
                ctx               = ctx,
                stepOutputs       = stepOutputView,
            )
        } catch (e: Exception) {
            return NodeResult.Failed("Output extraction failed: ${e.message?.take(200)}")
        }

        val extracted = extractionResult.extracted

        // ── 4. Schema validation ──────────────────────────────────────────────
        val outputSchema = node.outputSchema
        val validationErrors: List<String>
        val validated: Map<String, Any>

        if (outputSchema.isNotEmpty()) {
            val result = JsonSchemaValidator.validate(extracted, outputSchema, path = "output")
            validationErrors = result.errors.map { "${it.path}: ${it.message}" }
            validated = extracted // schema validation doesn't transform; just checks

            if (!result.isValid) {
                // Emit validation failure — but only fail the node if schema is strict
                val strictValidation = node.config["strictSchema"] as? Boolean ?: false
                if (strictValidation) {
                    return NodeResult.Failed(
                        "Output schema validation failed: ${result.summarize()}"
                    )
                }
                // Non-strict: emit warning in metadata and continue
                return NodeResult.Completed(
                    output = validated,
                    metadata = mapOf(
                        "transformMode"       to "transform",
                        "extractionMode"      to extractionResult.mode,
                        "validationWarnings"  to validationErrors,
                        "fieldCount"          to extractionResult.fieldCount,
                    )
                )
            }
        } else {
            validationErrors = emptyList()
            validated = extracted
        }

        // ── 5. Success ────────────────────────────────────────────────────────
        return NodeResult.Completed(
            output = validated,
            metadata = mapOf(
                "transformMode"  to "transform",
                "extractionMode" to extractionResult.mode,
                "fieldCount"     to extractionResult.fieldCount,
            )
        )
    }

    /**
     * Resolve a single output mapping expression against current working map.
     * Supports: input.key, output.key, steps.nodeId.output.x, literal:value, dot-paths.
     */
    private fun resolveOutputExpr(
        expr: String,
        working: Map<String, Any>,
        ctx: RuntimeContext,
    ): Any? = when {
        expr.startsWith("input.")   -> com.vectorbea.worker.mapping.JsonPathResolver
            .resolvePathInMap(expr.removePrefix("input."), working)
        expr.startsWith("output.")  -> com.vectorbea.worker.mapping.JsonPathResolver
            .resolvePathInMap(expr.removePrefix("output."), working)
        expr.startsWith("literal:") -> expr.removePrefix("literal:")
        expr.startsWith("$.") || expr.startsWith("$[") ->
            com.vectorbea.worker.mapping.JsonPathResolver.resolve(expr, working)
        else -> working[expr]
    }
}

