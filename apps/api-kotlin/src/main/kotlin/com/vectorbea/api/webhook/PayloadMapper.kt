package com.vectorbea.api.webhook

import com.fasterxml.jackson.databind.JsonNode

/**
 * Turning somebody else's payload into this workflow's inputs.
 *
 * ── WHY A MAPPING AND NOT "PASS THE BODY THROUGH" ───────────────────────────
 * A Stripe `checkout.session.completed` is 4 KB of envelope around three fields
 * a workflow actually wants. Passing it through whole means the workflow author
 * writes `$.data.object.customer_details.email` inside every node that needs it,
 * the graph is coupled to Stripe's envelope version, and switching to a
 * different payment provider is a rewrite rather than a mapping change.
 *
 * So the mapping lives on the trigger, in one place, and the workflow sees flat
 * named inputs. Empty mapping still means pass-through, because that is what
 * somebody wiring their first webhook wants before they know the shape — and
 * the mapping can be filled in from a real delivery in the log afterwards,
 * which is the workflow the delivery log exists to support.
 *
 * ── THE PATH SYNTAX IS DELIBERATELY SMALL ───────────────────────────────────
 * `$.a.b[0].c`, and that is all. Not JSONPath: no filters, no wildcards, no
 * recursive descent. A mapping is configuration a person reads at a glance, and
 * every expression this cannot express is one that belongs in the workflow
 * where it can be tested. The same syntax the HTTP tool spec uses for response
 * extraction, on purpose — one thing to learn.
 */
object PayloadMapper {

    /** What a mapping produced, or why it produced nothing. */
    sealed interface Result {
        data class Mapped(val inputs: Map<String, Any?>) : Result

        /**
         * Every mapped field was missing.
         *
         * A distinct outcome rather than an empty map: a run started with no
         * inputs from a delivery that had them is a workflow doing nothing while
         * appearing to work, and it is nearly always a path typo. The delivery
         * log records it as `rejected_mapping` with the paths that missed, which
         * is the answer to "why did my webhook run with no data".
         */
        data class Empty(val missingPaths: List<String>) : Result
    }

    /**
     * @param mapping field name → path. Empty means pass-through.
     */
    fun map(body: JsonNode, mapping: Map<String, String>): Result {
        if (mapping.isEmpty()) {
            /* Pass-through. Wrapped under `body` rather than spread at the top
               level: a payload with a field called `input` or `runId` would
               otherwise collide with the run's own vocabulary, and the collision
               would be silent. */
            return Result.Mapped(mapOf("body" to toPlain(body)))
        }

        val out = LinkedHashMap<String, Any?>()
        val missing = mutableListOf<String>()
        for ((field, path) in mapping) {
            val node = atPath(body, path)
            if (node == null || node.isMissingNode) {
                missing += path
                /* Present as null rather than absent, so a workflow that declares
                   the input sees "not sent" instead of failing on an unknown key.
                   The distinction between "absent" and "null" is not one a webhook
                   sender can be relied on to make. */
                out[field] = null
            } else {
                out[field] = toPlain(node)
            }
        }

        return if (missing.size == mapping.size) Result.Empty(missing)
        else Result.Mapped(out)
    }

    /**
     * Read one path.
     *
     * A leading `$.` is optional because half the people writing these will
     * include it and half will not, and refusing one of the two spellings is a
     * support ticket rather than a lesson.
     */
    fun atPath(root: JsonNode, path: String): JsonNode? {
        var node: JsonNode = root
        val cleaned = path.trim().removePrefix("$").removePrefix(".")
        if (cleaned.isEmpty()) return root

        for (rawSegment in cleaned.split('.')) {
            if (rawSegment.isEmpty()) continue
            var segment = rawSegment

            // A leading name, then any number of [n] indexes: `items[0][1]`.
            val bracket = segment.indexOf('[')
            if (bracket >= 0) {
                val name = segment.substring(0, bracket)
                if (name.isNotEmpty()) {
                    node = node.get(name) ?: return null
                }
                segment = segment.substring(bracket)
                for (match in INDEX.findAll(segment)) {
                    val index = match.groupValues[1].toIntOrNull() ?: return null
                    if (!node.isArray) return null
                    /* Negative indexes count from the end, because "the last
                       element" is a thing people want and `items[-1]` is how they
                       will write it. */
                    val resolved = if (index < 0) node.size() + index else index
                    node = node.get(resolved) ?: return null
                }
            } else {
                node = node.get(segment) ?: return null
            }
        }
        return node
    }

    private val INDEX = Regex("""\[(-?\d+)]""")

    /** Jackson node → plain Kotlin, so the value serializes into the run input. */
    private fun toPlain(node: JsonNode): Any? = when {
        node.isNull -> null
        node.isTextual -> node.asText()
        node.isBoolean -> node.asBoolean()
        node.isInt -> node.asInt()
        node.isLong -> node.asLong()
        node.isNumber -> node.asDouble()
        node.isArray -> node.map { toPlain(it) }
        node.isObject -> node.fieldNames().asSequence()
            .associateWith { toPlain(node.get(it)) }
        else -> node.asText()
    }

    /**
     * The value a filter or a dedup key reads, as a string.
     *
     * Null when the path misses, which the caller reads as "no value" rather
     * than as the empty string — a webhook with an event-type filter and a
     * missing type field must be filtered out, not matched against `""`.
     */
    fun stringAt(root: JsonNode, path: String?): String? {
        if (path.isNullOrBlank()) return null
        val node = atPath(root, path) ?: return null
        if (node.isNull || node.isMissingNode) return null
        return if (node.isTextual) node.asText() else node.toString()
    }
}
