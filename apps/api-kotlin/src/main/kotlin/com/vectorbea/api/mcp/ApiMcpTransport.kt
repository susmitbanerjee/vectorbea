package com.vectorbea.api.mcp

import com.vectorbea.api.security.SsrfGuard
import com.vectorbea.mcp.McpTransport
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.TimeUnit

/**
 * The API's egress, handed to the shared MCP protocol module.
 *
 * ── WHY THE API SUPPLIES ITS OWN ────────────────────────────────────────────
 * The worker reaches an MCP server through `OutboundHttp`, which is its pool,
 * its metrics and its clamped budget. None of that exists here and none of it
 * should: an API request is a person waiting on a page, not a run that has
 * already been admitted, and the two have different budgets for the same call.
 *
 * ── WHAT IS NOT OPTIONAL ────────────────────────────────────────────────────
 * The bounds. A customer's MCP server is exactly as able to return a gigabyte,
 * or to never answer, as anybody else's endpoint — and here it is being dialled
 * on a request thread, so an unbounded read is an API worker held open by
 * somebody else's server.
 *
 *   · **SSRF.** Checked on the resolved URL before the socket is opened. An MCP
 *     server URL is typed by a person into a form, which makes it the textbook
 *     case: without this, "connect an MCP server" is a request forgery
 *     primitive pointed at our own network.
 *   · **Redirects are not followed.** A redirect from a public host to
 *     `169.254.169.254` is how an SSRF guard that only checked the first URL
 *     gets walked past. `NEVER` is the whole mitigation.
 *   · **A byte cap that refuses rather than truncates.** A truncated JSON-RPC
 *     body parses as "not JSON", which is legible; a silently truncated one
 *     could parse as a SHORTER TOOL LIST, and the wizard would then report a
 *     number of tools that is quietly wrong.
 */
object ApiMcpTransport : McpTransport {

    /**
     * Ceiling on one call from the API, whatever the caller asks for.
     *
     * A run may wait fifteen seconds for a tool; a person pressing Discover
     * should not wait longer than a page load, and a server slower than this is
     * one they need to hear about rather than watch a spinner for.
     */
    private const val MAX_TOTAL_CALL_MS = 12_000L

    private val client: HttpClient by lazy {
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build()
    }

    override fun send(
        request: HttpRequest,
        totalCallMs: Long,
        maxResponseBytes: Long,
    ): McpTransport.Response {
        SsrfGuard.validate(request.uri().toString())

        val budgetMs = totalCallMs.coerceIn(1_000L, MAX_TOTAL_CALL_MS)
        /* The request arrives built by McpClient, which knows the protocol but
           not this service's budget. Rebuilt with the timeout rather than sent
           as-is, because an HttpRequest's timeout cannot be set afterwards. */
        val bounded = HttpRequest.newBuilder(request, { _, _ -> true })
            .timeout(Duration.ofMillis(budgetMs))
            .build()

        val response = client
            .sendAsync(bounded, HttpResponse.BodyHandlers.ofByteArray())
            .orTimeout(budgetMs, TimeUnit.MILLISECONDS)
            .join()

        val body = response.body() ?: ByteArray(0)
        if (body.size > maxResponseBytes) {
            throw ResponseTooLargeException(maxResponseBytes)
        }
        return McpTransport.Response(response.statusCode(), String(body, Charsets.UTF_8), response.headers().map())
    }

    /**
     * Refused, not truncated.
     *
     * The class exists so the refusal is distinguishable from a transport
     * failure in a log: "their server sent too much" and "their server did not
     * answer" lead to different conversations with the customer.
     */
    class ResponseTooLargeException(limitBytes: Long) :
        RuntimeException("the MCP server's response exceeded $limitBytes bytes")
}
