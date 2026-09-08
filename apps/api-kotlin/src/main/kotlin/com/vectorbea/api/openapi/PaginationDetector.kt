package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.tools.httpspec.HttpToolSpec

/**
 * Guesses how an operation paginates, from what its document already says.
 *
 * ── WHY GUESS AT ALL ────────────────────────────────────────────────────────
 * OpenAPI has no way to declare pagination. It is expressed entirely in
 * convention — a `cursor` parameter, a `has_more` field, a `Link` header — and
 * every API in wide use follows one of about four of them. So the choice is
 * between guessing from those conventions and leaving every imported list
 * operation unpaginated, which means an agent that sees the first page and
 * believes it has seen everything.
 *
 * ── THE GUESS IS CONSERVATIVE IN A SPECIFIC DIRECTION ───────────────────────
 * A WRONG pagination strategy is worse than none: it produces extra requests
 * that return the same page, or a cursor sent to an API that ignores it. So a
 * strategy is only produced when BOTH halves are present — the request
 * parameter that carries the position AND the response field that supplies the
 * next one. A `limit` parameter alone is not pagination; it is a limit.
 *
 * Detected caps are deliberately modest. An operator raising `maxPages` from 5
 * has decided to; one who never looks has a tool that cannot exhaust a context
 * window.
 */
internal object PaginationDetector {

    fun detect(
        op: OpenApiDocument.Operation,
        inputs: List<HttpToolSpec.InputMapping>,
        doc: OpenApiDocument,
    ): HttpToolSpec.PaginationSpec {
        /* Only a read paginates. A POST that happens to take a `page` parameter
           is a search endpoint whose pagination we would be following with a
           repeated side effect, and that is not a guess worth making. */
        if (op.method != "GET") return HttpToolSpec.PaginationSpec.None

        val successSchema = successSchemaOf(doc, op) ?: return HttpToolSpec.PaginationSpec.None
        val itemsPath = collectionPathIn(successSchema)

        val queryNames = inputs
            .filter { it.location == HttpToolSpec.InputMapping.Location.QUERY }
            .associateBy { it.wireName.lowercase() }

        /*
         * ── EACH STRATEGY EITHER FULLY RESOLVES OR DECLINES ─────────────────
         *
         * Tried in order, and a strategy that RECOGNISES its request parameter
         * but cannot find the matching response field must fall through rather
         * than stop the search. That is not hypothetical: Twilio's list endpoints
         * take a `PageToken` parameter — which reads as a cursor — while their
         * documented pagination is `Page`/`PageSize`. An earlier version returned
         * "no pagination" the moment it saw `PageToken`, so every Twilio list
         * imported unpaginated, and an agent saw the first fifty records and
         * believed that was all of them.
         */
        return cursor(successSchema, queryNames, itemsPath)
            ?: linkHeader(doc, op, itemsPath)
            ?: offsetOrPage(successSchema, queryNames, itemsPath)
            ?: HttpToolSpec.PaginationSpec.None
    }

    private fun cursor(
        schema: JsonNode,
        queryNames: Map<String, HttpToolSpec.InputMapping>,
        itemsPath: String?,
    ): HttpToolSpec.PaginationSpec? {
        val cursorParam = CURSOR_PARAMS.firstNotNullOfOrNull { queryNames[it] } ?: return null
        val nextPath = NEXT_CURSOR_PATHS.firstOrNull { pathExists(schema, it) }

        /*
         * Stripe's shape: no `next_cursor` anywhere, because the cursor IS the id
         * of the last object in the page. Recognised specifically, because it is
         * the most widely copied cursor API and would otherwise import with no
         * pagination at all.
         */
        val stripeShaped = nextPath == null && itemsPath != null &&
            pathExists(schema, "has_more")

        val resolvedNextPath = nextPath
            ?: (if (stripeShaped) "$itemsPath[-1].id" else null)
            ?: return null

        return HttpToolSpec.PaginationSpec.Cursor(
            cursorParam = cursorParam.wireName,
            nextCursorPath = resolvedNextPath,
            hasMorePath = HAS_MORE_PATHS.firstOrNull { pathExists(schema, it) },
            limitParam = LIMIT_PARAMS.firstNotNullOfOrNull { queryNames[it] }?.wireName,
            pageSize = null,
            itemsPath = itemsPath,
        )
    }

    /**
     * Declared in `responses.<code>.headers.Link`.
     *
     * GitHub declares it, which is what makes this detectable rather than
     * assumed — and assuming it for every `page`-taking API would send a
     * follow-up request per call to an API that never sends the header.
     */
    private fun linkHeader(
        doc: OpenApiDocument,
        op: OpenApiDocument.Operation,
        itemsPath: String?,
    ): HttpToolSpec.PaginationSpec? =
        if (declaresLinkHeader(doc, op)) HttpToolSpec.PaginationSpec.LinkHeader(itemsPath = itemsPath)
        else null

    private fun offsetOrPage(
        schema: JsonNode,
        queryNames: Map<String, HttpToolSpec.InputMapping>,
        itemsPath: String?,
    ): HttpToolSpec.PaginationSpec? {
        if (itemsPath == null) return null
        val pageParam = PAGE_PARAMS.firstNotNullOfOrNull { queryNames[it] }
        val offsetParam = OFFSET_PARAMS.firstNotNullOfOrNull { queryNames[it] }
        val positional = pageParam ?: offsetParam ?: return null
        val limitParam = LIMIT_PARAMS.firstNotNullOfOrNull { queryNames[it] }

        val pageSize = (limitParam?.default as? Long)?.toInt()
            ?.takeIf { it in 1..500 } ?: DEFAULT_PAGE_SIZE

        return HttpToolSpec.PaginationSpec.Offset(
            offsetParam = positional.wireName,
            limitParam = limitParam?.wireName,
            pageSize = pageSize,
            pageMode = pageParam != null,
            totalPath = TOTAL_PATHS.firstOrNull { pathExists(schema, it) },
            itemsPath = itemsPath,
        )
    }

    /** The schema of the first 2xx `application/json` response. */
    fun successSchemaOf(doc: OpenApiDocument, op: OpenApiDocument.Operation): JsonNode? {
        val responses = op.responses ?: return null
        if (!responses.isObject) return null
        val success = responses.fields().asSequence()
            .firstOrNull { (code, _) -> code.toIntOrNull()?.let { it in 200..299 } ?: false }
            ?.value ?: return null
        val content = success.get("content") as? ObjectNode ?: return null
        val json = content.fields().asSequence()
            .firstOrNull { (ct, _) -> ct.startsWith("application/json") || ct.endsWith("+json") }
            ?.value ?: content.fields().asSequence().firstOrNull()?.value ?: return null
        return doc.resolveDeep(json.get("schema"), maxDepth = 8).takeUnless { it.isNull }
    }

    /**
     * The dotted path to the array of records, if there is one.
     *
     * A response that IS an array has no path, and that is expressed as null with
     * no collection — the paginator handles a bare array by accumulating the root.
     * A response that WRAPS one is the common case, and the wrapper key is drawn
     * from a short list rather than by taking the first array property: a
     * `warnings: []` field alongside `data: []` is real, and picking it would
     * paginate the warnings.
     */
    fun collectionPathIn(schema: JsonNode?): String? {
        if (schema == null) return null
        if (OperationMapper.typeOf(schema) == "array") return null
        val props = schema.get("properties") as? ObjectNode ?: return null
        for (candidate in COLLECTION_KEYS) {
            val prop = props.get(candidate) ?: continue
            if (OperationMapper.typeOf(prop) == "array") return candidate
        }
        /* Fall back to the ONLY array property, when there is exactly one. Two
           arrays is genuinely ambiguous and guessing there is how the warnings
           get paginated. */
        val arrays = props.fields().asSequence()
            .filter { (_, v) -> OperationMapper.typeOf(v) == "array" }
            .map { it.key }.toList()
        return arrays.singleOrNull()
    }

    private fun pathExists(schema: JsonNode?, path: String): Boolean {
        var cur = schema ?: return false
        for (segment in path.substringBefore('[').split('.')) {
            if (segment.isEmpty()) continue
            val props = cur.get("properties") as? ObjectNode ?: return false
            cur = props.get(segment) ?: return false
        }
        return true
    }

    private fun declaresLinkHeader(doc: OpenApiDocument, op: OpenApiDocument.Operation): Boolean {
        val responses = op.responses ?: return false
        if (!responses.isObject) return false
        return responses.fields().asSequence()
            .filter { (code, _) -> code.toIntOrNull()?.let { it in 200..299 } ?: false }
            .any { (_, response) ->
                (doc.resolve(response).get("headers") as? ObjectNode)
                    ?.fieldNames()?.asSequence()?.any { it.equals("link", ignoreCase = true) } == true
            }
    }

    private const val DEFAULT_PAGE_SIZE = 50

    private val CURSOR_PARAMS = listOf(
        "cursor", "starting_after", "startingafter", "after", "next_cursor",
        "nextcursor", "page_token", "pagetoken", "next_token", "continuation_token",
    )
    private val NEXT_CURSOR_PATHS = listOf(
        "next_cursor", "nextCursor", "next_page_token", "nextPageToken",
        "response_metadata.next_cursor", "meta.next_cursor", "paging.cursors.after",
        "next", "continuation_token",
    )
    private val HAS_MORE_PATHS = listOf("has_more", "hasMore", "has_next", "hasNext", "more")
    private val PAGE_PARAMS = listOf("page", "page_number", "pagenumber", "pageindex")
    private val OFFSET_PARAMS = listOf("offset", "skip", "start", "start_index")
    private val LIMIT_PARAMS = listOf("limit", "per_page", "perpage", "page_size", "pagesize", "count", "max_results")
    private val TOTAL_PATHS = listOf(
        "total", "total_count", "totalCount", "totalSize", "total_results",
        "count", "meta.total", "pagination.total",
    )

    /** Where an API puts its records, in rough order of frequency. */
    private val COLLECTION_KEYS = listOf(
        "data", "items", "results", "records", "values", "entries",
        "elements", "content", "list", "objects", "resources", "rows",
    )
}
