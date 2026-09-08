package com.vectorbea.api.openapi

import com.vectorbea.worker.tools.httpspec.HttpToolSpec

/**
 * Turns an operation's declared error responses into the agent-facing contract.
 *
 * ── WHY THIS IS SMALL, AND SHOULD BE ────────────────────────────────────────
 * `ToolErrorShape.ofStatus` already classifies every standard status correctly,
 * with the `retryable` flag that does the real work. A tool declares rules to
 * OVERRIDE that — not to restate it — so a generator that emitted a rule for
 * every declared response would produce ten rules per tool that say exactly what
 * the default already says, on every tool, forever.
 *
 * What is worth generating is the two things the default cannot know:
 *
 *   1. WHERE the provider's own message lives. `messagePath` turns "HTTP 400"
 *      into "HTTP 400: parameter `amount` must be positive", which is the
 *      difference between an agent that corrects its input and one that retries
 *      the same call until its iteration budget runs out.
 *   2. A NON-STANDARD success. An operation declaring 404 as a documented
 *      outcome of a lookup is telling us that "not found" is an answer, not a
 *      failure — and the vendor's own document is the only place that is written
 *      down.
 */
internal object ErrorMappingGenerator {

    fun forOperation(
        doc: OpenApiDocument,
        op: OpenApiDocument.Operation,
    ): List<HttpToolSpec.ErrorMapping> {
        val responses = op.responses ?: return emptyList()
        if (!responses.isObject) return emptyList()

        val out = ArrayList<HttpToolSpec.ErrorMapping>()

        for ((code, responseRaw) in responses.fields().asSequence().toList()) {
            val status = code.toIntOrNull() ?: continue
            if (status < 400) continue
            val response = doc.resolve(responseRaw)

            val messagePath = messagePathIn(doc, response)
            val description = response.get("description")?.asText()
                ?.replace(Regex("""\s+"""), " ")?.trim()?.takeIf { it.isNotBlank() }

            /*
             * Emitted only when there is something to add. A rule identical to the
             * default is noise in the UI, noise in the diff, and one more thing to
             * keep correct when the default improves.
             */
            if (messagePath == null && description == null) continue

            out += HttpToolSpec.ErrorMapping(
                status = status,
                kind = kindFor(status),
                retryable = status == 429 || status in 500..599,
                /*
                 * The vendor's own sentence, as the fix. It is written for a person
                 * debugging their integration, which is closer to what an agent
                 * needs than anything generic — and where it is useless, a person
                 * editing the tool can see exactly what it says and delete it.
                 */
                fix = description?.take(MAX_FIX)?.takeIf { it.length > MIN_USEFUL_FIX },
                messagePath = messagePath,
            )
        }

        return out.take(MAX_RULES)
    }

    /**
     * Where this error response puts its message.
     *
     * Read from the DECLARED schema rather than guessed, which is the whole
     * advantage of having the document: `HttpToolResolver` falls back to a list
     * of common paths when no rule says, and a declared path beats that list
     * every time — particularly for the APIs that nest it two deep.
     */
    private fun messagePathIn(doc: OpenApiDocument, response: com.fasterxml.jackson.databind.JsonNode): String? {
        val content = response.get("content") as? com.fasterxml.jackson.databind.node.ObjectNode
            ?: return null
        val json = content.fields().asSequence()
            .firstOrNull { (ct, _) -> ct.startsWith("application/json") || ct.endsWith("+json") }
            ?.value ?: return null
        val schema = doc.resolveDeep(json.get("schema"), maxDepth = 5)
        return findMessagePath(schema, "", 0)
    }

    private fun findMessagePath(
        schema: com.fasterxml.jackson.databind.JsonNode?,
        prefix: String,
        depth: Int,
    ): String? {
        if (schema == null || depth > 3) return null
        val props = schema.get("properties") as? com.fasterxml.jackson.databind.node.ObjectNode
            ?: return null

        for (candidate in MESSAGE_KEYS) {
            val prop = props.get(candidate) ?: continue
            if (OperationMapper.typeOf(prop) == "string") {
                return if (prefix.isEmpty()) candidate else "$prefix.$candidate"
            }
        }
        /* One level in. `{"error": {"message": "..."}}` is the second most common
           shape after a flat `message`, and missing it costs the message. */
        for ((name, prop) in props.fields().asSequence().toList()) {
            if (name.lowercase() !in NESTING_KEYS) continue
            val nested = findMessagePath(prop, if (prefix.isEmpty()) name else "$prefix.$name", depth + 1)
            if (nested != null) return nested
        }
        return null
    }

    private fun kindFor(status: Int): String = when (status) {
        401, 403 -> "auth"
        404 -> "not_found"
        400, 422 -> "invalid_input"
        429 -> "rate_limit"
        in 500..599 -> "server"
        else -> "unknown"
    }

    private const val MAX_RULES = 8
    private const val MAX_FIX = 200

    /**
     * "Not Found" and "Bad Request" are the status name restated, and a `fix`
     * that restates the status is worse than none — it displaces the default's
     * actually-actionable sentence.
     */
    private const val MIN_USEFUL_FIX = 24

    private val MESSAGE_KEYS = listOf(
        "message", "error_description", "detail", "error", "title", "reason",
        "errorMessage", "description",
    )
    private val NESTING_KEYS = setOf("error", "errors", "meta", "data", "fault", "status")
}
