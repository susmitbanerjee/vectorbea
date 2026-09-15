package com.vectorbea.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpRequest
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * The MCP wire protocol: JSON-RPC 2.0 over streamable HTTP.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────
 * MCP is a discovery and invocation protocol. A server calling Salesforce makes
 * the same REST call a direct integration would and returns the same forty fields
 * of nested JSON — so nothing here improves the *quality* of a result. That is
 * the result contract layer's job, and MCP results go through it exactly like an
 * HTTP tool's.
 *
 * What this buys is the product story: a customer connects their own tools
 * without us writing an integration for each. It is ADDITIVE — `http` and
 * `database` are untouched, because a customer with a plain REST endpoint must
 * not have to wrap it in an MCP server first.
 *
 * ── EVERY RESPONSE IS UNTRUSTED ─────────────────────────────────────────────
 * This is a customer's server, and its tool descriptions reach the model's
 * prompt. That makes them an injection surface with a direct route to the thing
 * being protected. Nothing in this file trusts a field: sizes are bounded by the
 * [McpTransport]'s byte cap, and everything textual is sanitized by
 * [McpSanitizer] before it is stored or shown. See [McpDiscovery].
 *
 * ── THE HANDSHAKE, WHICH THIS CLIENT USED TO SKIP ───────────────────────────
 * The first version sent `tools/list` cold, with `Accept: application/json`, and
 * read the body as a single JSON object. That happens to work against a server
 * that is stateless and never streams — our own `/api/mcp` is one — and fails
 * against most servers built on the reference SDKs, in three separate ways:
 *
 *   · They require `initialize` first, and answer anything else with
 *     "Bad Request: Server not initialized".
 *   · They require the client to accept BOTH `application/json` and
 *     `text/event-stream`, and answer 406 when it does not.
 *   · They are allowed to reply to a POST with a one-shot event stream, whose
 *     body is `event: message\ndata: {...}` rather than JSON.
 *
 * Each of those looked, from the verify step, like "this is not an MCP server",
 * which is the wrong diagnosis for a server that is a perfectly good one. All
 * three are now handled here, once, for both services.
 *
 * ── SESSIONS ────────────────────────────────────────────────────────────────
 * A server that issues `Mcp-Session-Id` on `initialize` expects it on every
 * later call. Sessions are cached per (connection, url, credential) — the
 * credential is in the key as a FINGERPRINT, never the token, so a rotated or
 * refreshed token starts a fresh session rather than presenting a new token
 * inside an old one. A server that expires a session answers 404, and the call
 * re-initialises once and retries: that is what the specification tells a
 * client to do, and it is invisible to the caller.
 *
 * ── ONE TRANSPORT, DELIBERATELY ─────────────────────────────────────────────
 * `streamable-http` only. The legacy HTTP+SSE transport needs a long-lived
 * connection held against a worker slot, which is the shape this runtime spends
 * most of its effort avoiding. A connection configured for `sse` is refused with
 * that sentence rather than silently downgraded.
 *
 * Note the difference: a streamable-HTTP server REPLYING with an event stream is
 * supported (it is one POST and one bounded body). A server whose only endpoint
 * is the legacy SSE transport is not.
 */
class McpClient(
    /**
     * Supplied by the caller, because egress is the caller's business. See
     * [McpTransport]. There is no default: a default would be one service's
     * egress policy silently applied to the other's calls.
     */
    private val transport: McpTransport,
) {
    private val mapper = ObjectMapper()

    data class Server(
        val connectionId: java.util.UUID,
        val url: String,
        val transport: String = "streamable-http",
        /** Bearer token, when the connection carries one. Never logged. */
        val authToken: String? = null,
        val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    )

    /** A JSON-RPC failure, or a protocol-level one. Carries what a contract needs. */
    open class McpException(
        message: String,
        /** JSON-RPC error code, when the server returned one. */
        val rpcCode: Int? = null,
        /** HTTP status, when the failure was at that level. */
        val httpStatus: Int? = null,
    ) : RuntimeException(message)

    /**
     * The server wants a credential it was not given, or refused the one it was.
     *
     * A distinct type because it is the one failure the product should ANSWER
     * rather than report: a 401 carrying `resource_metadata` is a server saying
     * "here is where to go and sign in", and the connect flow turns that into a
     * sign-in button instead of an error box.
     */
    class McpAuthRequiredException(
        httpStatus: Int,
        val challenge: AuthChallenge,
    ) : McpException(
        if (httpStatus == 403) "the MCP server refused the credential (HTTP 403)"
        else "the MCP server requires authorization (HTTP $httpStatus)",
        httpStatus = httpStatus,
    )

    /** What a `WWW-Authenticate: Bearer …` header said. Every field optional. */
    data class AuthChallenge(
        /** RFC 9728: where the server's protected-resource metadata lives. */
        val resourceMetadata: String? = null,
        val scope: String? = null,
        /** `invalid_token`, `insufficient_scope`, … — an OAuth error code, not prose. */
        val error: String? = null,
    )

    /** What `initialize` told us about the server. */
    data class ServerInfo(
        val name: String?,
        val version: String?,
        val protocolVersion: String?,
    )

    /** A handshake plus a tool list, in one call — what a verify step needs. */
    data class Probe(
        val info: ServerInfo,
        val tools: List<JsonNode>,
    )

    private data class SessionKey(val connectionId: java.util.UUID, val url: String, val credential: String)
    private data class Session(val id: String?, val protocolVersion: String, val info: ServerInfo)

    private val sessions = ConcurrentHashMap<SessionKey, Session>()

    // ── Protocol ─────────────────────────────────────────────────────────────

    /** `tools/list` — what this server offers. Follows pagination to a bound. */
    fun listTools(server: Server): List<JsonNode> = paged(server, "tools/list", "tools")

    /** `resources/list` — read-only context an agent can pull on demand. */
    fun listResources(server: Server): List<JsonNode> = paged(server, "resources/list", "resources")

    /** `resources/read` — the contents of one resource, by uri. */
    fun readResource(server: Server, uri: String): JsonNode =
        call(server, "resources/read", mapper.createObjectNode().put("uri", uri))

    /** `tools/call` — invoke one remote tool. */
    fun callTool(server: Server, name: String, arguments: Map<String, Any?>): JsonNode {
        val params = mapper.createObjectNode()
        params.put("name", name)
        params.set<JsonNode>("arguments", mapper.valueToTree(arguments))
        return call(server, "tools/call", params)
    }

    /**
     * Initialise (fresh, never from the cache) and list tools.
     *
     * Fresh because a probe is a claim about the server as it is NOW, made while
     * a person is reading the answer. A cached session would let a verify step
     * pass on the strength of a handshake from an hour ago.
     */
    fun probe(server: Server): Probe {
        sessions.remove(keyOf(server))
        val session = session(server)
        return Probe(session.info, listTools(server))
    }

    /** Drop any cached session for this server, e.g. after its credential changed. */
    fun forget(connectionId: java.util.UUID) {
        sessions.keys.removeIf { it.connectionId == connectionId }
    }

    /**
     * `tools/list` and `resources/list` are paginated by `nextCursor`.
     *
     * Bounded, because the cursor is the server's: a server that always returns
     * one would otherwise hold this call in a loop until the transport's budget
     * ran out, once per page.
     */
    private fun paged(server: Server, method: String, field: String): List<JsonNode> {
        val out = mutableListOf<JsonNode>()
        var cursor: String? = null
        repeat(MAX_PAGES) {
            val params = mapper.createObjectNode()
            cursor?.let { params.put("cursor", it) }
            val result = call(server, method, params)
            out += arrayField(result, field)
            cursor = result["nextCursor"]?.asText()?.takeIf { it.isNotBlank() }
            if (cursor == null) return out
        }
        return out
    }

    /**
     * One JSON-RPC round trip, inside a session.
     *
     * ── WHY A FAILURE HERE IS AN EXCEPTION AND NOT A NULL ───────────────────
     * Every caller has to distinguish "the server said no" from "the server is
     * unreachable" from "the server answered nonsense", because those map to
     * different error contracts and different retry advice. A null collapses all
     * three into the one thing an agent cannot act on.
     */
    private fun call(server: Server, method: String, params: JsonNode): JsonNode {
        requireSupportedTransport(server)
        val session = session(server)
        return try {
            exchange(server, method, params, session)
        } catch (e: SessionExpired) {
            /* The specification's instruction for a 404 on a session id: start a
               new one. Once — a server that expires every session immediately is
               broken, and looping would hide that. */
            sessions.remove(keyOf(server))
            exchange(server, method, params, session(server))
        }
    }

    /** The cached session, or a new one from `initialize`. */
    private fun session(server: Server): Session {
        requireSupportedTransport(server)
        val key = keyOf(server)
        sessions[key]?.let { return it }
        val created = initialize(server)
        sessions[key] = created
        return created
    }

    private fun initialize(server: Server): Session {
        val params = mapper.createObjectNode().apply {
            put("protocolVersion", PROTOCOL_VERSION)
            set<JsonNode>("capabilities", mapper.createObjectNode())
            set<JsonNode>("clientInfo", mapper.createObjectNode()
                .put("name", CLIENT_NAME).put("version", CLIENT_VERSION))
        }
        val response = send(server, rpcPayload("initialize", params), sessionId = null, protocolVersion = PROTOCOL_VERSION)
        checkStatus(response, hadSession = false)

        val root = parseReply(response, expectId = true)
        root["error"]?.let { err ->
            /* A server that does not implement `initialize` at all is old or
               minimal rather than broken — our own server answered tools/list
               cold for a long time. Proceed without a session instead of
               refusing a server that would otherwise work. */
            if (err["code"]?.asInt() == -32601) {
                return Session(null, PROTOCOL_VERSION, ServerInfo(null, null, null))
            }
            throw rpcError(err)
        }
        val result = root["result"]
            ?: throw McpException("the MCP server's reply to initialize had no result")

        val negotiated = result["protocolVersion"]?.asText()?.takeIf { it.isNotBlank() } ?: PROTOCOL_VERSION
        val info = ServerInfo(
            name = McpSanitizer.text(result["serverInfo"]?.get("name")?.asText(), 120),
            version = McpSanitizer.text(result["serverInfo"]?.get("version")?.asText(), 60),
            protocolVersion = McpSanitizer.name(negotiated),
        )
        val sessionId = response.header("Mcp-Session-Id")?.takeIf { it.isNotBlank() && it.length <= 512 }

        /* The notification completes the handshake. Its reply is 202 with no
           body; a server that answers otherwise has still been told, and failing
           the whole connection over the status of a notification would refuse a
           server over a detail it never promised us. */
        runCatching {
            val note = mapper.createObjectNode().put("jsonrpc", "2.0").put("method", "notifications/initialized")
            send(server, mapper.writeValueAsString(note), sessionId, negotiated)
        }

        return Session(sessionId, negotiated, info)
    }

    private fun exchange(server: Server, method: String, params: JsonNode, session: Session): JsonNode {
        val response = send(server, rpcPayload(method, params), session.id, session.protocolVersion)
        checkStatus(response, hadSession = session.id != null)

        val root = parseReply(response, expectId = true)
        root["error"]?.let { throw rpcError(it) }
        return root["result"]
            ?: throw McpException("the MCP server's reply had no result and no error")
    }

    private fun send(server: Server, body: String, sessionId: String?, protocolVersion: String): McpTransport.Response {
        val builder = HttpRequest.newBuilder()
            .uri(URI.create(server.url))
            .header("Content-Type", "application/json")
            /* Both, always. The specification requires the client to accept an
               event stream in reply to a POST, and servers on the reference SDKs
               enforce it with a 406. */
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", protocolVersion)
            .POST(HttpRequest.BodyPublishers.ofString(body))
        sessionId?.let { builder.header("Mcp-Session-Id", it) }
        server.authToken?.takeIf { it.isNotBlank() }?.let {
            builder.header("Authorization", "Bearer $it")
        }

        return try {
            transport.send(builder.build(), server.timeoutMs, MAX_RESPONSE_BYTES)
        } catch (e: Exception) {
            /* The message, never the exception: a stack trace from an HTTP client
               carries the URL, and an MCP server URL can carry a token in its
               path. The cause class is enough to classify. */
            throw McpException("could not reach the MCP server (${e.javaClass.simpleName})")
        }
    }

    private fun checkStatus(response: McpTransport.Response, hadSession: Boolean) {
        val status = response.statusCode
        if (status in 200..299) return
        if (status == 401 || status == 403) {
            throw McpAuthRequiredException(status, parseChallenge(response.header("WWW-Authenticate")))
        }
        if (status == 404 && hadSession) throw SessionExpired()
        throw McpException("the MCP server returned HTTP $status", httpStatus = status)
    }

    /**
     * The JSON-RPC message in a reply, whether it came as JSON or as an event stream.
     *
     * An event stream may carry server-to-client notifications (progress, logs)
     * before the response. Those are skipped: the response is the message with an
     * `id` and a `result` or `error`. Choosing the LAST such message rather than
     * the first means a server that emits an interim message shaped like a reply
     * cannot make us read the wrong one.
     */
    private fun parseReply(response: McpTransport.Response, expectId: Boolean): JsonNode {
        val contentType = response.header("Content-Type")?.lowercase() ?: ""
        val body = response.body
        val looksLikeStream = contentType.startsWith("text/event-stream") ||
            body.trimStart().let { it.startsWith("event:") || it.startsWith("data:") || it.startsWith(":") }

        if (!looksLikeStream) {
            return try {
                mapper.readTree(body) ?: throw IllegalStateException()
            } catch (_: Exception) {
                throw McpException("the MCP server returned a body that is not JSON")
            }
        }

        val messages = sseDataMessages(body).mapNotNull { runCatching { mapper.readTree(it) }.getOrNull() }
        val reply = messages.lastOrNull { m ->
            (!expectId || m.has("id")) && (m.has("result") || m.has("error"))
        }
        return reply ?: throw McpException(
            "the MCP server replied with an event stream that carried no response")
    }

    private fun rpcError(err: JsonNode): McpException {
        /* A JSON-RPC error is the server declining, which is a different thing
           from the server being broken — and the distinction is exactly what
           the error contract needs to decide whether retrying could help. */
        val code = err["code"]?.asInt()
        val msg = McpSanitizer.text(err["message"]?.asText(), MAX_ERROR_CHARS)
        return McpException("the MCP server refused the call${msg?.let { ": $it" } ?: ""}", rpcCode = code)
    }

    private fun rpcPayload(method: String, params: JsonNode): String =
        mapper.writeValueAsString(mapper.createObjectNode().apply {
            put("jsonrpc", "2.0")
            put("id", java.util.UUID.randomUUID().toString())
            put("method", method)
            set<JsonNode>("params", params)
        })

    private fun requireSupportedTransport(server: Server) {
        if (server.transport != "streamable-http") {
            throw McpException(
                "MCP transport '${server.transport}' is not supported. " +
                "Only streamable-http is implemented; configure the server for HTTP.")
        }
    }

    private fun keyOf(server: Server) = SessionKey(server.connectionId, server.url, fingerprint(server.authToken))

    private fun arrayField(result: JsonNode, field: String): List<JsonNode> =
        (result[field] as? com.fasterxml.jackson.databind.node.ArrayNode)?.toList()
            ?: emptyList()

    /** Internal signal: the server forgot our session. Never escapes [call]. */
    private class SessionExpired : RuntimeException()

    companion object {
        /** The revision this client implements. Sent, so a mismatch is the server's to report. */
        const val PROTOCOL_VERSION = "2025-06-18"

        const val CLIENT_NAME = "Vectorbea"
        const val CLIENT_VERSION = "1.0.0"

        /**
         * Ceiling on one MCP response.
         *
         * A manifest is small; a `tools/call` result is a tool result and can be
         * anything. Bounded by the same streaming cap every other outbound call
         * uses, because a customer's server is exactly as able to return a
         * gigabyte as anybody else's endpoint.
         */
        const val MAX_RESPONSE_BYTES = 1_048_576L

        const val DEFAULT_TIMEOUT_MS = 15_000L

        /** A server's error text is untrusted and goes near a prompt. */
        const val MAX_ERROR_CHARS = 300

        /** Pages of `tools/list` followed before stopping. 20 × a normal page is hundreds of tools. */
        const val MAX_PAGES = 20

        /**
         * `data:` payloads of an event stream, one string per event.
         *
         * Per the event-stream format: events are separated by a blank line, and
         * multiple `data:` lines in one event are joined with a newline. Comments
         * (`:`) and other fields are ignored.
         */
        fun sseDataMessages(body: String): List<String> {
            val events = mutableListOf<String>()
            val data = StringBuilder()
            var hasData = false
            fun flush() {
                if (hasData) events += data.toString()
                data.setLength(0); hasData = false
            }
            body.replace("\r\n", "\n").replace('\r', '\n').split('\n').forEach { line ->
                when {
                    line.isEmpty() -> flush()
                    line.startsWith(":") -> Unit
                    line.startsWith("data:") -> {
                        if (hasData) data.append('\n')
                        data.append(line.removePrefix("data:").removePrefix(" "))
                        hasData = true
                    }
                    else -> Unit
                }
            }
            flush()
            return events
        }

        /**
         * Parse `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.
         *
         * Tolerant by construction: a malformed header yields an empty challenge,
         * never an exception, because the 401 it arrived on is already the answer
         * and discovery has well-known fallbacks.
         */
        fun parseChallenge(header: String?): AuthChallenge {
            if (header.isNullOrBlank()) return AuthChallenge()
            val params = mutableMapOf<String, String>()
            Regex("""([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))""")
                .findAll(header)
                .forEach { m ->
                    val value = m.groupValues[2].ifEmpty { m.groupValues[3] }.replace("\\\"", "\"")
                    params.putIfAbsent(m.groupValues[1].lowercase(), value)
                }
            return AuthChallenge(
                resourceMetadata = params["resource_metadata"]?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
                scope = params["scope"],
                error = params["error"],
            )
        }

        /** Enough to tell two credentials apart; useless to anybody who reads it. */
        internal fun fingerprint(token: String?): String {
            if (token.isNullOrBlank()) return "-"
            val digest = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
            return digest.take(8).joinToString("") { "%02x".format(it) }
        }
    }
}
