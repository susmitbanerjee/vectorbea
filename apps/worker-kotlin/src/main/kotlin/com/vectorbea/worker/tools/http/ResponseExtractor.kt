package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.jayway.jsonpath.Configuration
import com.jayway.jsonpath.JsonPath
import com.jayway.jsonpath.Option
import com.jayway.jsonpath.spi.json.JacksonJsonNodeJsonProvider
import com.jayway.jsonpath.spi.mapper.JacksonMappingProvider
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import io.burt.jmespath.jackson.JacksonRuntime
import java.util.concurrent.ConcurrentHashMap

/**
 * Cuts the agent-visible document out of a response — item 4, first half.
 *
 * ── EXTRACTION AND PROJECTION ARE TWO LAYERS ON PURPOSE ─────────────────────
 * This narrows the DOCUMENT: `$.data`, unwrapping the envelope every API puts
 * around its payload. `ResultProjection` then narrows the FIELDS within whatever
 * this produced. Collapsing them into one would force a choice, and both choices
 * are bad: doing envelopes in the contract means writing `body.data.records.` in
 * front of every field path, and doing fields in the extractor means one
 * JSONPath per field and no collection summary.
 *
 * Composed, the pair is what makes an imported operation usable without editing:
 * the importer generates the extraction from the response schema's envelope, and
 * the contract from its item schema, and the model sees ten fields of one record
 * instead of a 56-field document nested three deep.
 *
 * ── AN EXTRACTION THAT MATCHES NOTHING RETURNS THE WHOLE BODY ───────────────
 * The same rule the projection layer already follows, for the same reason. An
 * expression that stops matching — an API version changed, a field was renamed —
 * would otherwise produce an empty document, which reads to a model as "the tool
 * found nothing": silent, confident, and wrong in the direction of doing
 * nothing. [Extracted.applied] carries the truth so the caller can record it.
 */
internal object ResponseExtractor {

    private val log = logger()
    private val mapper = ObjectMapper()

    /**
     * json-path, on Jackson's node model, configured ONCE.
     *
     * `Configuration.setDefaults` is process-global; two call sites setting
     * different defaults is a race whose symptom is an extraction intermittently
     * returning the wrong node type. Building an explicit [Configuration] and
     * handing it to every call avoids touching the global at all.
     *
     * `SUPPRESS_EXCEPTIONS` turns a path that matches nothing into null rather
     * than a `PathNotFoundException`. That is the behaviour this layer wants
     * everywhere: a missing path is a fact about the response, not an error in
     * the runtime.
     */
    private val jsonPathConfig: Configuration = Configuration.builder()
        .jsonProvider(JacksonJsonNodeJsonProvider(mapper))
        .mappingProvider(JacksonMappingProvider(mapper))
        .options(Option.SUPPRESS_EXCEPTIONS)
        .build()

    private val jmesRuntime = JacksonRuntime()

    /**
     * Compiled expressions, cached.
     *
     * Both libraries compile a string into a tree, and both are called on every
     * page of every tool call. The cache is bounded by the number of DISTINCT
     * expressions in the workspace's tools, which is bounded by the number of
     * tools — so it cannot grow with traffic, which is the property that makes an
     * unbounded map acceptable here.
     */
    private val compiledJsonPath = ConcurrentHashMap<String, JsonPath>()
    private val compiledJmes = ConcurrentHashMap<String, io.burt.jmespath.Expression<JsonNode>>()

    data class Extracted(
        val node: JsonNode,
        /** False when there was no expression, or it matched nothing. */
        val applied: Boolean,
        /** Set when the expression itself is broken, for the operator. */
        val error: String? = null,
    )

    fun extract(body: JsonNode, extraction: HttpToolSpec.Extraction): Extracted =
        when (extraction) {
            is HttpToolSpec.Extraction.None -> Extracted(body, applied = false)

            is HttpToolSpec.Extraction.JsonPath -> runExpression(body, extraction.expression) {
                val path = compiledJsonPath.computeIfAbsent(it) { e -> JsonPath.compile(e) }
                path.read<JsonNode>(body, jsonPathConfig)
            }

            is HttpToolSpec.Extraction.JmesPath -> runExpression(body, extraction.expression) {
                val expr = compiledJmes.computeIfAbsent(it) { e -> jmesRuntime.compile(e) }
                expr.search(body)
            }
        }

    private inline fun runExpression(
        body: JsonNode,
        expression: String,
        evaluate: (String) -> JsonNode?,
    ): Extracted = try {
        val result = evaluate(expression)
        if (result == null || result.isNull || result.isMissingNode) {
            /*
             * Matched nothing. The whole body is returned rather than an empty
             * document — see the class comment — and `applied = false` is what the
             * caller records, so "the extraction stopped matching" is visible in
             * the run rather than being indistinguishable from an empty API.
             */
            Extracted(body, applied = false)
        } else {
            Extracted(result, applied = true)
        }
    } catch (e: Exception) {
        /*
         * A broken EXPRESSION, as opposed to one that matched nothing. It cannot
         * fail the tool call — the call succeeded and the data is right here —
         * but it must be legible, because the symptom otherwise is "my tool
         * returns too much" and the cause is three screens away.
         */
        log.warn(
            "[http-tool] extraction expression failed [{}]: {}",
            expression.take(80), e.javaClass.simpleName,
        )
        Extracted(
            body, applied = false,
            error = "The response extraction '${expression.take(80)}' could not be evaluated " +
                "(${e.javaClass.simpleName}). The full response was used instead.",
        )
    }

    /**
     * Read a dotted path. The vocabulary the error mappings and the paginator use.
     *
     * Deliberately NOT JSONPath. These paths come from a form field an operator
     * fills in while looking at a response body — `has_more`, `data.next_cursor`
     * — and the failure of a full expression language there is that `$.has_more`
     * and `has_more` both look right and only one works. A dotted path has one
     * spelling. Callers wanting more can use extraction, which is where an
     * expression language belongs.
     *
     * A leading `$.` is tolerated and stripped, because people will type it.
     */
    fun atPath(root: JsonNode?, path: String): JsonNode? {
        var cur = root ?: return null
        val cleaned = path.removePrefix("$.").removePrefix("$")
        for (segment in cleaned.split('.')) {
            if (segment.isEmpty()) continue
            /* `items[0]` and `items[-1]` — the last is how a cursor is usually
               taken from a Stripe-style page, whose next cursor IS the id of the
               final element rather than a field of the envelope. */
            val bracket = segment.indexOf('[')
            if (bracket >= 0 && segment.endsWith("]")) {
                val name = segment.substring(0, bracket)
                val index = segment.substring(bracket + 1, segment.length - 1).toIntOrNull()
                    ?: return null
                val arr = (if (name.isEmpty()) cur else cur.get(name)) ?: return null
                if (!arr.isArray) return null
                val i = if (index < 0) arr.size() + index else index
                cur = arr.get(i) ?: return null
            } else {
                cur = cur.get(segment) ?: return null
            }
        }
        return cur.takeUnless { it.isNull }
    }

    /** Test seam. Compiled-expression caches are process-wide. */
    fun clearCachesForTests() {
        compiledJsonPath.clear()
        compiledJmes.clear()
    }
}
