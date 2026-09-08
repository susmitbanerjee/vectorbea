package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import java.security.MessageDigest

/**
 * What changed between two imports of the same document — item 12.
 *
 * ── WHY A DIFF AND NOT A REPLACE ────────────────────────────────────────────
 * `agents.allowed_tool_ids` grants a tool by UUID. A re-import that rewrote
 * tools in place would change what that UUID does without changing the grant —
 * so an agent granted `create_refund`, scoped by a bound maximum amount, could
 * be silently regranted a wider version of it by somebody pasting a URL. Nothing
 * in the product would have said anything.
 *
 * So a re-import produces this: a list of what is new, what changed, and what
 * the vendor removed. Applying any of it is a separate, deliberate act, and
 * changes to a GRANTED tool are marked as such — see
 * `tool_versions_pending_review`.
 *
 * ── THE FINGERPRINT IS OVER BEHAVIOUR, NOT OVER THE DOCUMENT ────────────────
 * Method, path, parameters, request body schema and security. NOT descriptions,
 * examples, tags or `x-` extensions.
 *
 * That line is the difference between a feature and a nuisance. A vendor
 * reworded prose in every one of nine hundred operations would otherwise present
 * as nine hundred changes needing review — and a review that is nine hundred
 * items long is a review nobody performs, which leaves the one real change
 * unnoticed among them.
 */
object SpecDiff {

    private val mapper = ObjectMapper()

    /**
     * A behaviour hash for one operation.
     *
     * Canonicalised before hashing: object keys sorted, whitespace irrelevant,
     * cosmetic keys stripped. Two documents that describe the same operation must
     * hash the same however each was serialised — a vendor switching from YAML to
     * JSON, or their generator changing key order, is not a change.
     */
    fun fingerprint(op: OpenApiDocument.Operation, doc: OpenApiDocument): String {
        val canonical = mapper.createObjectNode().apply {
            put("method", op.method)
            put("path", op.path)
            /* Deprecation IS behaviour: an operation the vendor has deprecated is
               one an agent should stop being granted. */
            put("deprecated", op.deprecated)

            val params = putArray("parameters")
            op.parameters
                .map { p ->
                    mapper.createObjectNode().apply {
                        put("name", p.get("name")?.asText() ?: "")
                        put("in", p.get("in")?.asText() ?: "")
                        put("required", p.path("required").asBoolean(false))
                        set<JsonNode>("schema", canonicalise(doc.resolveDeep(p.get("schema"), 6)))
                    }
                }
                /* Sorted, because parameter ORDER is not behaviour and generators
                   reorder them between releases. */
                .sortedBy { "${it.path("in").asText()}:${it.path("name").asText()}" }
                .forEach { params.add(it) }

            op.requestBody?.let { body ->
                val bodyNode = putObject("requestBody")
                bodyNode.put("required", body.path("required").asBoolean(false))
                (body.get("content") as? ObjectNode)?.let { content ->
                    val types = bodyNode.putObject("content")
                    content.fields().asSequence()
                        .sortedBy { it.key }
                        .forEach { (ct, media) ->
                            types.set<JsonNode>(
                                ct,
                                canonicalise(doc.resolveDeep(media.get("schema"), 6)),
                            )
                        }
                }
            }

            val security = putArray("security")
            op.security
                .map { "${it.schemeName}:${it.scopes.sorted().joinToString(",")}" }
                .sorted()
                .forEach { security.add(it) }
        }

        return sha256(mapper.writeValueAsString(canonical))
    }

    /**
     * Strip the parts of a schema that describe it rather than constrain it.
     *
     * `description`, `example`, `examples`, `title`, `externalDocs` and every
     * `x-` extension. Keys are emitted in sorted order so serialisation order
     * cannot change the hash.
     */
    private fun canonicalise(node: JsonNode?): JsonNode {
        if (node == null || node.isNull) return mapper.nullNode()
        return when {
            node.isObject -> {
                val out = mapper.createObjectNode()
                node.fields().asSequence()
                    .filter { (k, _) -> k !in COSMETIC_KEYS && !k.startsWith("x-") }
                    .sortedBy { it.key }
                    .forEach { (k, v) -> out.set<JsonNode>(k, canonicalise(v)) }
                out
            }

            node.isArray -> {
                val out = mapper.createArrayNode()
                node.forEach { out.add(canonicalise(it)) }
                out
            }

            else -> node
        }
    }

    // ── The diff ─────────────────────────────────────────────────────────────

    enum class ChangeKind { ADDED, CHANGED, REMOVED, UNCHANGED }

    data class OperationChange(
        val operationKey: String,
        val kind: ChangeKind,
        val method: String,
        val path: String,
        val summary: String?,
        /** The tool this operation currently backs, when it backs one. */
        val toolId: String?,
        /** True when an agent is granted that tool. Drives review priority. */
        val isGranted: Boolean = false,
        /** Human-readable specifics, for the review screen. */
        val details: List<String> = emptyList(),
    )

    data class Result(
        val added: List<OperationChange>,
        val changed: List<OperationChange>,
        val removed: List<OperationChange>,
        val unchangedCount: Int,
    ) {
        val hasChanges: Boolean get() = added.isNotEmpty() || changed.isNotEmpty() || removed.isNotEmpty()

        /** Changes that touch a tool an agent currently holds. */
        val affectingGrantedTools: List<OperationChange>
            get() = (changed + removed).filter { it.isGranted }
    }

    /** One side of the comparison: what a previous import recorded. */
    data class PreviousOperation(
        val operationKey: String,
        val fingerprint: String,
        val method: String,
        val path: String,
        val summary: String?,
        val toolId: String?,
        val isGranted: Boolean,
        /** The generated spec as it was, for explaining WHAT changed. */
        val httpSpecJson: JsonNode?,
    )

    fun diff(
        previous: List<PreviousOperation>,
        current: List<OpenApiDocument.Operation>,
        doc: OpenApiDocument,
    ): Result {
        val previousByKey = previous.associateBy { it.operationKey }
        val currentByKey = current.associateBy { it.key }

        val added = ArrayList<OperationChange>()
        val changed = ArrayList<OperationChange>()
        var unchanged = 0

        for (op in current) {
            val before = previousByKey[op.key]
            val fingerprint = fingerprint(op, doc)
            when {
                before == null -> added += OperationChange(
                    operationKey = op.key, kind = ChangeKind.ADDED,
                    method = op.method, path = op.path, summary = op.summary,
                    toolId = null,
                )

                before.fingerprint != fingerprint -> changed += OperationChange(
                    operationKey = op.key, kind = ChangeKind.CHANGED,
                    method = op.method, path = op.path, summary = op.summary,
                    toolId = before.toolId, isGranted = before.isGranted,
                    details = explain(before, op, doc),
                )

                else -> unchanged++
            }
        }

        /*
         * A REMOVED operation whose tool is granted is the most dangerous entry
         * in this list, and the least obvious. The tool keeps working — it is our
         * row, not the vendor's — right up until the vendor turns the endpoint
         * off, at which point an agent starts failing with a 404 that nobody
         * connects to a spec re-import three weeks earlier.
         */
        val removed = previous
            .filter { it.operationKey !in currentByKey }
            .map {
                OperationChange(
                    operationKey = it.operationKey, kind = ChangeKind.REMOVED,
                    method = it.method, path = it.path, summary = it.summary,
                    toolId = it.toolId, isGranted = it.isGranted,
                    details = listOf(
                        if (it.toolId != null)
                            "The vendor no longer documents this operation. The tool still " +
                                "exists and still works, and will start failing whenever the " +
                                "vendor removes the endpoint."
                        else "The vendor no longer documents this operation."
                    ),
                )
            }

        return Result(added, changed, removed, unchanged)
    }

    /**
     * Say what changed, in the terms a reviewer decides on.
     *
     * ── WHY THE SPECIFICS MATTER MORE THAN THE FACT ─────────────────────────
     * "This operation changed" is not reviewable. "A new REQUIRED parameter
     * `account_id`" and "the parameter `limit` is no longer capped at 100" lead
     * to different decisions, and the second is the kind of change that widens
     * what a granted agent can do. The comparison is against the previously
     * GENERATED spec rather than against the previous document, because that is
     * what the tool actually does today.
     */
    private fun explain(
        before: PreviousOperation,
        after: OpenApiDocument.Operation,
        doc: OpenApiDocument,
    ): List<String> {
        val details = ArrayList<String>()

        if (!before.method.equals(after.method, ignoreCase = true)) {
            details += "The method changed from ${before.method} to ${after.method}."
        }
        if (before.path != after.path) {
            details += "The path changed from `${before.path}` to `${after.path}`."
        }
        if (after.deprecated) {
            details += "The vendor has marked this operation deprecated."
        }

        val beforeInputs = (before.httpSpecJson?.get("request")?.get("inputs") as? ArrayNode)
            ?.associate { it.path("wireName").asText(it.path("name").asText()) to it }
            ?: emptyMap()

        val afterParams = after.parameters.associateBy { it.path("name").asText() }

        for ((name, param) in afterParams) {
            val was = beforeInputs[name]
            val nowRequired = param.path("required").asBoolean(false)
            when {
                was == null && nowRequired ->
                    details += "New REQUIRED parameter `$name`. Calls that worked before will " +
                        "now fail until it is supplied."

                was == null -> details += "New optional parameter `$name`."
                !was.path("required").asBoolean(false) && nowRequired ->
                    details += "`$name` is now required."

                was.path("required").asBoolean(false) && !nowRequired ->
                    details += "`$name` is no longer required."
            }
            val wasEnum = (was?.get("enum") as? ArrayNode)?.map { it.asText() }?.toSet()
            val nowEnum = (doc.resolveDeep(param.get("schema"), 4).get("enum") as? ArrayNode)
                ?.map { it.asText() }?.toSet()
            if (wasEnum != null && nowEnum != null && wasEnum != nowEnum) {
                val gained = nowEnum - wasEnum
                val lost = wasEnum - nowEnum
                if (gained.isNotEmpty()) details += "`$name` accepts new values: ${gained.take(6).joinToString(", ")}."
                if (lost.isNotEmpty()) details += "`$name` no longer accepts: ${lost.take(6).joinToString(", ")}."
            }
        }

        for (name in beforeInputs.keys) {
            /* Body inputs are not parameters; only report a parameter that is
               genuinely gone rather than one that moved into the body. */
            val wasIn = beforeInputs[name]?.path("in")?.asText()
            if (name !in afterParams && wasIn != "body") {
                details += "The parameter `$name` was removed."
            }
        }

        val hadBody = before.httpSpecJson?.get("request")?.get("body") != null
        val hasBody = after.requestBody != null
        if (hadBody && !hasBody) details += "This operation no longer takes a request body."
        if (!hadBody && hasBody) details += "This operation now takes a request body."

        if (details.isEmpty()) {
            /* The fingerprint differs and nothing above explains it — a schema
               nested below what `explain` walks. Saying so beats saying nothing,
               and beats claiming there is no difference. */
            details += "The request or response schema changed. Compare the generated " +
                "definition before applying."
        }
        return details
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private val COSMETIC_KEYS = setOf(
        "description", "example", "examples", "title", "externalDocs", "summary",
        "\$comment", "deprecated_reason", "xml",
    )
}
