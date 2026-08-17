package com.vectorbea.api.contract

import com.vectorbea.api.http.fromJson
import com.vectorbea.worker.contract.AssertionEngine
import com.vectorbea.worker.contract.ExpressionParser
import com.vectorbea.worker.contract.JsonSchemaValidator

/**
 * Publish-time checks on a contract, and the live evaluation the inspector uses.
 *
 * Uses the SAME parser and evaluator as the worker — the source directory is shared
 * via `sourceSets` in build.gradle.kts rather than duplicated. That matters more
 * than it looks: an expression that lints clean in the editor and then fails to
 * parse in the worker is the worst possible outcome, because by then the author has
 * shipped and the assertion they thought was protecting them is inert.
 */
object ContractLinter {

    data class Problem(val message: String, val blocking: Boolean)

    /** Providers whose call path can structurally enforce a JSON Schema. */
    private val ENFORCING_PROVIDERS = setOf("openai", "azure-openai", "anthropic", "gemini")

    fun decodingEnforced(provider: String) = provider.lowercase() in ENFORCING_PROVIDERS

    fun decodingNote(provider: String): String? =
        if (decodingEnforced(provider)) null
        else "Provider '$provider' cannot enforce an output schema structurally. The schema " +
            "would be validated after generation but not constrained during it, so the model " +
            "is free to ignore it."

    /**
     * Check a contract before it is saved.
     *
     * Blocking problems prevent saving. The bar for blocking is: would saving this
     * leave the author believing they are protected when they are not?
     */
    fun lint(
        schema: Map<String, Any?>?,
        assertions: List<Map<String, Any?>>,
        provider: String?,
    ): List<Problem> {
        val problems = mutableListOf<Problem>()

        // §2's publish-time rule. Blocking, because a schema the provider cannot
        // enforce is not a weaker guarantee — it is none, presented as one.
        if (schema != null && provider != null && !decodingEnforced(provider)) {
            problems += Problem(
                "This node declares an output schema, but provider '$provider' cannot enforce it " +
                    "during generation. Either switch to a provider that supports constrained " +
                    "decoding (OpenAI, Anthropic or Gemini), or remove the schema and rely on " +
                    "assertions alone.",
                blocking = true)
        }

        if (schema != null) {
            if (schema["type"] != "object") {
                problems += Problem(
                    "The output schema must have \"type\": \"object\" at the root. " +
                        "Providers cannot constrain a bare array or scalar.",
                    blocking = true)
            }
            @Suppress("UNCHECKED_CAST")
            val props = schema["properties"] as? Map<String, Any?>
            if (props.isNullOrEmpty()) {
                problems += Problem(
                    "The output schema declares no properties, so it constrains nothing.",
                    blocking = true)
            }
            // Advisory: strict mode requires it, and this is added automatically at
            // call time — but an author who set it to true should know it is ignored.
            if (schema["additionalProperties"] == true) {
                problems += Problem(
                    "\"additionalProperties\": true is not compatible with strict constrained " +
                        "decoding and will be overridden to false when the call is made.",
                    blocking = false)
            }
        }

        val names = mutableSetOf<String>()
        assertions.forEachIndexed { i, a ->
            val name = a["name"] as? String
            val expr = a["expr"] as? String
            val severity = (a["severity"] as? String)?.lowercase()

            if (name.isNullOrBlank()) {
                problems += Problem("Assertion ${i + 1} has no name. The name appears in the " +
                    "failure message, so it must say what the rule is.", blocking = true)
            } else if (!names.add(name)) {
                problems += Problem("Two assertions are both named '$name'. Names must be unique " +
                    "so a failure identifies which rule fired.", blocking = true)
            }

            if (expr.isNullOrBlank()) {
                problems += Problem("Assertion '${name ?: i + 1}' has no expression.", blocking = true)
            } else {
                ExpressionParser.validate(expr)?.let {
                    problems += Problem("Assertion '${name ?: i + 1}' is not valid: $it", blocking = true)
                }
            }

            if (severity != null && severity !in setOf("fail", "warn", "gate")) {
                problems += Problem(
                    "Assertion '${name ?: i + 1}' has severity '$severity'. Use fail, warn or gate.",
                    blocking = true)
            }

            if ((a["message"] as? String).isNullOrBlank()) {
                // Advisory. A generated message still names the value, so this is a
                // quality nudge rather than a defect.
                problems += Problem(
                    "Assertion '${name ?: i + 1}' has no failure message. A written message " +
                        "reaches the user in run detail and in the approval gate — the generated " +
                        "one is correct but less clear.",
                    blocking = false)
            }
        }

        return problems
    }

    /** Evaluate a contract against sample data, for the inspector's live testing. */
    fun evaluate(
        schema: Map<String, Any?>?,
        assertions: List<Map<String, Any?>>,
        input: Any?,
        output: Any?,
    ): Map<String, Any?> {
        val schemaErrors = schema?.let { JsonSchemaValidator.validate(output, it) } ?: emptyList()

        // The worker's engine, unchanged, so what the editor shows is exactly what
        // will happen at runtime.
        val engine = AssertionEngine()
        val parsed = assertions.mapNotNull { a ->
            val name = a["name"] as? String ?: return@mapNotNull null
            val expr = a["expr"] as? String ?: return@mapNotNull null
            AssertionEngine.Assertion(
                name = name,
                expr = expr,
                severity = when ((a["severity"] as? String)?.lowercase()) {
                    "warn" -> AssertionEngine.Severity.WARN
                    "gate" -> AssertionEngine.Severity.GATE
                    else -> AssertionEngine.Severity.FAIL
                },
                message = a["message"] as? String,
            )
        }
        val evaluated = engine.evaluateAll(
            parsed, AssertionEngine.Context(input = input, output = output))

        val results = evaluated.map { r ->
            mapOf(
                "name" to r.name,
                "severity" to r.severity.name.lowercase(),
                "passed" to r.passed,
                "error" to r.error,
                "message" to r.message,
                "observed" to r.actual,
            )
        }
        val failed = results.filter { it["passed"] == false }
        return mapOf(
            "schemaValid" to schemaErrors.isEmpty(),
            "schemaErrors" to schemaErrors,
            "assertions" to results,
            "outcome" to when {
                schemaErrors.isNotEmpty() -> "fail"
                failed.any { it["severity"] == "fail" } -> "fail"
                failed.any { it["severity"] == "gate" } -> "gate"
                failed.any { it["severity"] == "warn" } -> "warn"
                else -> "pass"
            },
        )
    }

    /**
     * The publish readiness report (R06).
     *
     * A node with no contract is FLAGGED, not blocked — §7 is explicit that
     * contract-less nodes keep working. Blocking them would make adopting contracts
     * a breaking change for every existing workflow, which is how a good feature
     * gets turned off.
     */
    fun readiness(
        graphJson: String,
        contracts: Map<String, Triple<Boolean, Boolean, String?>>,
    ): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        val graph = runCatching { fromJson<Map<String, Any?>>(graphJson) }.getOrNull()
            ?: return mapOf("ready" to false, "errors" to listOf("The workflow graph could not be read."))

        @Suppress("UNCHECKED_CAST")
        val nodes = (graph["nodes"] as? List<Map<String, Any?>>) ?: emptyList()
        // Only these node types produce model output worth contracting.
        val modelNodes = nodes.filter { (it["type"] as? String)?.lowercase() in setOf("llm", "agent") }

        val errors = mutableListOf<String>()
        val warnings = mutableListOf<String>()

        modelNodes.forEach { n ->
            val id = n["id"] as? String ?: return@forEach
            val c = contracts[id]
            when {
                c == null -> warnings += "Node '$id' has no output contract. It will run, but its " +
                    "output is unchecked — a malformed or nonsensical response commits and flows " +
                    "downstream."
                c.first && !c.second -> errors += "Node '$id' declares an output schema that its " +
                    "provider cannot enforce. ${c.third ?: ""}".trim()
                !c.first -> warnings += "Node '$id' has assertions but no schema, so constrained " +
                    "decoding is off. Adding a schema eliminates malformed output entirely."
            }
        }

        return mapOf(
            "ready" to errors.isEmpty(),
            "errors" to errors,
            "warnings" to warnings,
            "modelNodes" to modelNodes.size,
            "contracted" to modelNodes.count { contracts.containsKey(it["id"] as? String) },
            "summary" to when {
                errors.isNotEmpty() -> "Cannot publish: ${errors.size} node(s) declare a schema their " +
                    "provider cannot enforce."
                warnings.isNotEmpty() -> "Ready to publish. ${warnings.size} node(s) have no output " +
                    "contract and will run unchecked."
                modelNodes.isEmpty() -> "Ready to publish. No model nodes to contract."
                else -> "Ready to publish. Every model node has an enforced contract."
            },
        )
    }
}
