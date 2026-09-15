package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.vectorbea.worker.tools.httpspec.HttpToolSpec

/**
 * Follows a paginated collection, and stops — item 5.
 *
 * ── THE CAP IS THE FEATURE ──────────────────────────────────────────────────
 * An agent handed a `next_cursor` follows it. It cannot know how many pages
 * there are, and it does not feel the cost of finding out, so the natural
 * behaviour is to keep going until the context window ends the run — having
 * spent the whole budget assembling a list too large to reason about. That is
 * the failure the brief names, and it is not fixable by prompting: "do not
 * fetch too many pages" has no operational meaning to a model that cannot see
 * the total.
 *
 * Moving the loop into the runtime makes the bound a number. Two numbers, in
 * fact, and both are needed: [HttpToolSpec.PaginationSpec.maxPages] bounds the
 * REQUESTS (an API with 10-item pages), [maxItems] bounds the TOKENS (an API
 * with 1000-item pages). Either alone leaves one of those two APIs unbounded.
 *
 * ── WHAT THE AGENT IS TOLD WHEN THE CAP FIRES ───────────────────────────────
 * [Result.truncated] becomes a `more` marker in the merged document. A model
 * shown a cut-off list with no marker reasons as though it saw everything —
 * concluding there are forty matches when there are four hundred — and answers
 * confidently and wrongly. The marker costs about twenty tokens and removes
 * that entire class of error, and it lets the model decide to narrow its query,
 * which is the behaviour actually wanted.
 */
internal object Paginator {

    private val mapper = ObjectMapper()

    /** One page, as the caller's fetch function returns it. */
    data class Page(
        val body: JsonNode,
        val headers: Map<String, List<String>>,
        val statusCode: Int,
    )

    data class Result(
        /** The merged document: pages accumulated at `itemsPath`, or page one. */
        val body: JsonNode,
        val pagesFetched: Int,
        val itemCount: Int,
        /** True when a cap stopped the walk while the API had more to give. */
        val truncated: Boolean,
        val stoppedBecause: String? = null,
    )

    /**
     * Walk the pages.
     *
     * [fetch] takes the extra query parameters for the NEXT request — or an
     * absolute URL, for the link-header strategy, where the next page's address
     * is given rather than computed. Returning null ends the walk; the caller
     * uses that for a page that failed in a way it has already handled.
     */
    suspend fun walk(
        spec: HttpToolSpec.PaginationSpec,
        first: Page,
        fetch: suspend (extraQuery: Map<String, String>, absoluteUrl: String?) -> Page?,
    ): Result {
        if (spec is HttpToolSpec.PaginationSpec.None) {
            return Result(first.body, 1, itemsIn(first.body, null)?.size() ?: 0, false)
        }

        val itemsPath = spec.itemsPath
        val accumulated: ArrayNode? = itemsPath?.let { mapper.createArrayNode() }
        var pages = 0
        var items = 0
        var current: Page? = first
        var truncated = false
        var stoppedBecause: String? = null

        /* Cursor and offset state live across iterations; link-header state is
           the whole next URL. Each strategy owns exactly one of these. */
        var cursor: String? = null
        var offset = 0
        var nextUrl: String? = null

        while (current != null) {
            pages++
            val pageItems = itemsIn(current.body, itemsPath)
            if (accumulated != null && pageItems != null) {
                for (element in pageItems) {
                    if (items >= spec.maxItems) {
                        truncated = true
                        stoppedBecause = "the ${spec.maxItems}-item cap"
                        break
                    }
                    accumulated.add(element)
                    items++
                }
            } else if (pageItems != null) {
                items += pageItems.size()
            }

            if (truncated) break

            if (pages >= spec.maxPages) {
                /*
                 * The page cap fired. Whether that TRUNCATED anything depends on
                 * whether the API had more — reported honestly rather than assumed,
                 * because "showing 250 of 250" and "showing 250 of thousands" lead
                 * a model to different next actions.
                 */
                val more = hasMore(spec, current, cursorFrom(spec, current))
                if (more) {
                    truncated = true
                    stoppedBecause = "the ${spec.maxPages}-page cap"
                }
                break
            }

            val next = when (spec) {
                is HttpToolSpec.PaginationSpec.None -> null

                is HttpToolSpec.PaginationSpec.Cursor -> {
                    val nextCursor = cursorFrom(spec, current)
                    if (nextCursor.isNullOrBlank() || !hasMore(spec, current, nextCursor)) null
                    else {
                        cursor = nextCursor
                        val q = LinkedHashMap<String, String>()
                        q[spec.cursorParam] = nextCursor
                        spec.limitParam?.let { p -> spec.pageSize?.let { q[p] = it.toString() } }
                        fetch(q, null)
                    }
                }

                is HttpToolSpec.PaginationSpec.Offset -> {
                    val pageItemCount = pageItems?.size() ?: 0
                    /*
                     * A short page is the end. Every offset-paginated API says so
                     * this way, and it is the only signal that works when the API
                     * reports no total — asking for one more page to discover it is
                     * empty costs a request per tool call, forever.
                     */
                    if (pageItemCount < spec.pageSize) null
                    else {
                        val total = spec.totalPath?.let {
                            ResponseExtractor.atPath(current.body, it)?.takeIf { n -> n.isNumber }?.asInt()
                        }
                        offset += if (spec.pageMode) 1 else spec.pageSize
                        val reached = total != null && items >= total
                        if (reached) null
                        else {
                            val q = LinkedHashMap<String, String>()
                            q[spec.offsetParam] = if (spec.pageMode) (offset + 1).toString() else offset.toString()
                            spec.limitParam?.let { q[it] = spec.pageSize.toString() }
                            fetch(q, null)
                        }
                    }
                }

                is HttpToolSpec.PaginationSpec.LinkHeader -> {
                    nextUrl = linkHeaderNext(current.headers, spec.relation)
                    if (nextUrl == null) null else fetch(emptyMap(), nextUrl)
                }
            }
            current = next
        }

        val merged = if (accumulated != null && itemsPath != null) {
            mergeInto(first.body, itemsPath, accumulated, truncated, items, pages)
        } else {
            first.body
        }
        return Result(merged, pages, items, truncated, stoppedBecause)
    }

    private fun itemsIn(body: JsonNode, itemsPath: String?): ArrayNode? {
        if (itemsPath == null) return body as? ArrayNode
        return ResponseExtractor.atPath(body, itemsPath) as? ArrayNode
    }

    private fun cursorFrom(spec: HttpToolSpec.PaginationSpec, page: Page): String? {
        if (spec !is HttpToolSpec.PaginationSpec.Cursor) return null
        val n = ResponseExtractor.atPath(page.body, spec.nextCursorPath) ?: return null
        return if (n.isTextual) n.asText().takeIf { it.isNotBlank() } else n.asText()
    }

    /**
     * Whether the API says there is more.
     *
     * `hasMorePath` wins when declared, because a cursor field that is present
     * and stale is a real shape — Stripe returns the last object's id whether or
     * not `has_more` is true, so following the cursor alone loops on the final
     * page forever.
     */
    private fun hasMore(spec: HttpToolSpec.PaginationSpec, page: Page, cursor: String?): Boolean =
        when (spec) {
            is HttpToolSpec.PaginationSpec.Cursor -> {
                val declared = spec.hasMorePath?.let {
                    ResponseExtractor.atPath(page.body, it)?.asBoolean(false)
                }
                declared ?: !cursor.isNullOrBlank()
            }

            is HttpToolSpec.PaginationSpec.LinkHeader ->
                linkHeaderNext(page.headers, spec.relation) != null

            is HttpToolSpec.PaginationSpec.Offset -> {
                val items = itemsIn(page.body, spec.itemsPath)?.size() ?: 0
                items >= spec.pageSize
            }

            is HttpToolSpec.PaginationSpec.None -> false
        }

    /**
     * `Link: <https://…?page=2>; rel="next", <…>; rel="last"` — RFC 8288.
     *
     * Parsed rather than regex-matched on `rel="next"` alone because the URL may
     * itself contain the string `rel=`, and because `rel` may be unquoted. The
     * header is also case-insensitive in its parameter names, which a naive
     * match gets wrong against at least one real API.
     */
    fun linkHeaderNext(headers: Map<String, List<String>>, relation: String): String? {
        val values = headers.entries
            .firstOrNull { it.key.equals("link", ignoreCase = true) }?.value
            ?: return null
        for (header in values) {
            for (part in splitLinks(header)) {
                val urlStart = part.indexOf('<')
                val urlEnd = part.indexOf('>', urlStart + 1)
                if (urlStart < 0 || urlEnd < 0) continue
                val url = part.substring(urlStart + 1, urlEnd).trim()
                val params = part.substring(urlEnd + 1)
                val rel = Regex("""rel\s*=\s*"?([^";,]+)"?""", RegexOption.IGNORE_CASE)
                    .find(params)?.groupValues?.get(1)?.trim()
                if (rel.equals(relation, ignoreCase = true)) return url
            }
        }
        return null
    }

    /** Split on commas that are not inside `<…>`. */
    private fun splitLinks(header: String): List<String> {
        val out = mutableListOf<String>()
        var depth = 0
        var start = 0
        header.forEachIndexed { i, c ->
            when (c) {
                '<' -> depth++
                '>' -> depth--
                ',' -> if (depth == 0) {
                    out += header.substring(start, i); start = i + 1
                }
            }
        }
        out += header.substring(start)
        return out.map { it.trim() }.filter { it.isNotEmpty() }
    }

    /**
     * Put the accumulated items back where they came from.
     *
     * The envelope of page ONE is kept — its `total`, its metadata, whatever the
     * API chose to tell us — with the item array replaced. Returning a bare array
     * instead would discard the total, which is the one field that lets the
     * model know how much it did not see.
     */
    private fun mergeInto(
        first: JsonNode,
        itemsPath: String,
        items: ArrayNode,
        truncated: Boolean,
        itemCount: Int,
        pages: Int,
    ): JsonNode {
        val root = first.deepCopy<JsonNode>()
        val segments = itemsPath.removePrefix("$.").removePrefix("$").split('.')
            .filter { it.isNotEmpty() }
        var cur: JsonNode = root
        for (i in 0 until segments.size - 1) {
            cur = cur.get(segments[i]) ?: return items
        }
        val container = cur as? com.fasterxml.jackson.databind.node.ObjectNode ?: return items
        container.set<JsonNode>(segments.last(), items)

        if (truncated && root is com.fasterxml.jackson.databind.node.ObjectNode) {
            /*
             * Written at the ROOT rather than beside the items, so it survives the
             * observation cap: `ResultProjection` writes its summary first for the
             * same reason, and a truncation marker that gets cut off is worse than
             * none, because it teaches nothing while looking like it did.
             */
            root.put("pagesFetched", pages)
            root.put("itemsFetched", itemCount)
            root.put("truncated", true)
            root.put(
                "truncationNote",
                "More results exist. This is the first $itemCount, over $pages page(s). " +
                    "Narrow the query rather than asking for more.",
            )
        }
        return root
    }
}
