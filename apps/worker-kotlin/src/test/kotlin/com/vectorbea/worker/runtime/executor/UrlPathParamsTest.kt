package com.vectorbea.worker.runtime.executor

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * URL path parameters.
 *
 * WHY THIS CAPABILITY EXISTS. Body templates have always been resolvable;
 * URLs never were. REST APIs put their identifiers in the PATH — GitHub's pull
 * request is `/repos/{owner}/{repo}/pulls/{number}`, Airtable's record is
 * `/v0/{base}/{table}` — so the only HTTP tools that could be registered were
 * ones whose every path segment was fixed forever. "Read a pull request" could
 * read exactly one pull request. That quietly decided which integrations were
 * expressible at all.
 *
 * WHY ENCODING IS NOT OPTIONAL. These values arrive from workflow inputs, and
 * one step further back from a model. `../` or `?` written into a path segment
 * does not stay in that segment.
 */
class UrlPathParamsTest {

    /* A pure function on the companion, so testing it needs no ConnectionResolver,
       no event store and no Redis pub/sub proxy. */
    private fun substitute(url: String, inputs: Map<String, Any>) =
        HttpNodeExecutor.substitutePathParams(url, inputs)

    @Test
    fun `single-brace and double-brace placeholders both resolve`() {
        assertEquals(
            "https://api.github.com/repos/acme/platform/pulls/42",
            substitute(
                "https://api.github.com/repos/acme/platform/pulls/{number}",
                mapOf("number" to 42),
            ),
        )
        assertEquals(
            "https://api.github.com/repos/acme/platform/pulls/42",
            substitute(
                "https://api.github.com/repos/acme/platform/pulls/{{ number }}",
                mapOf("number" to 42),
            ),
        )
    }

    @Test
    fun `a URL with no placeholders is returned untouched`() {
        val url = "https://api.github.com/rate_limit?per_page=1"
        assertEquals(url, substitute(url, mapOf("number" to 1)))
    }

    @Test
    fun `several placeholders in one URL all resolve`() {
        assertEquals(
            "https://api.airtable.com/v0/appABC/Leads",
            substitute(
                "https://api.airtable.com/v0/{base_id}/{table}",
                mapOf("base_id" to "appABC", "table" to "Leads"),
            ),
        )
    }

    @Test
    fun `path traversal in a value cannot climb out of the segment`() {
        // Left raw, this would have addressed a completely different resource.
        val out = substitute(
            "https://api.example.com/v1/items/{id}",
            mapOf("id" to "../../admin/keys"),
        )
        assertTrue(out.endsWith("%2F..%2Fadmin%2Fkeys"), out)
        assertTrue(!out.contains("/../"), out)
    }

    @Test
    fun `a value cannot graft a query string onto the request`() {
        val out = substitute(
            "https://api.example.com/v1/items/{id}",
            mapOf("id" to "7?admin=true"),
        )
        assertTrue(!out.contains("?"), out)
        assertTrue(out.endsWith("7%3Fadmin%3Dtrue"), out)
    }

    @Test
    fun `a space becomes percent-20 rather than a plus`() {
        // URLEncoder is a FORM encoder. A `+` inside a path segment is a literal
        // plus, so a form-encoded space silently changes the resource name.
        val out = substitute(
            "https://api.example.com/v1/sheets/{range}",
            mapOf("range" to "Sheet 1!A:D"),
        )
        assertTrue(out.contains("Sheet%201"), out)
        assertTrue(!out.contains("+"), out)
    }

    @Test
    fun `a dotted reference falls back to its last segment`() {
        // Node input maps are frequently keyed by the bare name while a template
        // was written against the fuller path.
        assertEquals(
            "https://api.example.com/v1/items/9",
            substitute(
                "https://api.example.com/v1/items/{input.id}",
                mapOf("id" to 9),
            ),
        )
    }

    @Test
    fun `an unresolved placeholder fails loudly instead of 404ing at the vendor`() {
        /* Leaving `{number}` in the path sends the vendor a literal brace and
           gets a 404 back — the least informative possible way to discover that
           an input mapping is missing. */
        val thrown = assertFailsWith<Exception> {
            substitute(
                "https://api.github.com/repos/acme/platform/pulls/{number}",
                emptyMap(),
            )
        }
        assertTrue(thrown.message!!.contains("number"), thrown.message!!)
    }
}
