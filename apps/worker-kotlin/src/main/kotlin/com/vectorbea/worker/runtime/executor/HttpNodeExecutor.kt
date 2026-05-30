package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.SsrfException
import com.vectorbea.worker.connector.SsrfGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/**
 * Executes HTTP tool nodes against external HTTP endpoints.
 *
 * Node config keys:
 *   - connectionId    (UUID string, optional) — an HTTP connection for base URL + auth
 *   - url             (string, required if no connectionId) — absolute URL
 *   - method          (string, default "GET")
 *   - headers         (Map<String,String>, optional) — additional request headers
 *   - body            (Any, optional) — request body (JSON-serialized)
 *   - timeoutMs       (Long, optional) — default 30 s
 *   - maxResponseBytes (Long, optional) — default 2 MB
 *   - followRedirects (Boolean, default true)
 *
 * SECURITY:
 *  - SSRF guard applied to every request.
 *  - allowedHosts enforced if connection is set.
 *  - allowedPaths enforced if connection is set and non-empty.
 *  - Authorization headers are REDACTED in all event summaries.
 *  - Secrets are never placed in URLs.
 *  - Response body is never logged raw.
 */
class HttpNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build(),
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_MS          = 30_000L
        const val DEFAULT_MAX_RESPONSE_BYTES  = 2_097_152L // 2 MB
        private val REDACTED_HEADER_NAMES = setOf(
            "authorization", "x-api-key", "api-key", "x-auth-token", "x-secret"
        )
    }

    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val cfg = node.config

        // ── Optional: resolve connection ──────────────────────────────────────
        val connectionIdStr = cfg["connectionId"] as? String
        var allowedHosts    = emptyList<String>()
        var allowedPaths    = emptyList<String>()
        var baseUrl: String? = null
        var authHeader: Pair<String, String>? = null

        if (!connectionIdStr.isNullOrBlank()) {
            val connectionId = try { UUID.fromString(connectionIdStr) }
            catch (e: Exception) {
                return NodeResult.Failed("HTTP node '${node.id}': invalid connectionId format")
            }

            val resolved = try {
                connectionResolver.resolve(connectionId, context.workspaceId, expectedType = "http")
            } catch (e: ConnectionException) {
                emitEvent(context, node.id, EventType.CONNECTION_VALIDATION_FAILED, "failed",
                    title = "Connection validation failed")
                return NodeResult.Failed("Connection error for node '${node.id}': ${e.message}")
            }

            emitEvent(context, node.id, EventType.CONNECTION_RESOLVED, "info",
                title = "Connection resolved",
                summary = "provider=${resolved.record.provider}")

            allowedHosts = resolved.record.allowedHosts
            allowedPaths = resolved.record.allowedPaths
            baseUrl      = resolved.record.configJson["baseUrl"] as? String

            // Build auth header from connection
            if (resolved.secret != null && !resolved.secret.isCleared()) {
                val authType = resolved.record.authType.lowercase()
                resolved.secret.useOnce { secret ->
                    authHeader = when (authType) {
                        "api_key"       -> "x-api-key" to secret
                        "bearer", "jwt" -> "Authorization" to "Bearer $secret"
                        "basic"         -> {
                            val encoded = java.util.Base64.getEncoder()
                                .encodeToString("${resolved.record.configJson["username"] ?: ""}:$secret".toByteArray())
                            "Authorization" to "Basic $encoded"
                        }
                        else            -> "Authorization" to "Bearer $secret"
                    }
                }
            }
        }

        // ── Build URL ─────────────────────────────────────────────────────────
        val rawUrl = resolveUrl(cfg, resolvedInputs, baseUrl)
            ?: return NodeResult.Failed("HTTP node '${node.id}': no URL provided (set 'url' in config or attach an HTTP connection with baseUrl)")

        // ── SSRF check ────────────────────────────────────────────────────────
        try {
            SsrfGuard.checkUrl(rawUrl, allowedHosts)
        } catch (e: SsrfException) {
            emitEvent(context, node.id, EventType.HTTP_REQUEST_PREPARED, "blocked",
                title = "SSRF blocked", summary = e.message?.take(200))
            return NodeResult.Failed("SSRF protection blocked request for node '${node.id}': ${e.message}")
        }

        // ── Allowed paths check ───────────────────────────────────────────────
        if (allowedPaths.isNotEmpty()) {
            val path = try { URI.create(rawUrl).path ?: "/" } catch (_: Exception) { "/" }
            val pathAllowed = allowedPaths.any { allowed -> path.startsWith(allowed) }
            if (!pathAllowed) {
                return NodeResult.Failed(
                    "HTTP node '${node.id}': path '$path' not in allowedPaths for this connection"
                )
            }
        }

        // ── Build request ─────────────────────────────────────────────────────
        val method      = (cfg["method"] as? String ?: "GET").uppercase()
        val timeoutMs   = (cfg["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_TIMEOUT_MS
        val maxRespBytes = (cfg["maxResponseBytes"] as? Number)?.toLong() ?: DEFAULT_MAX_RESPONSE_BYTES

        @Suppress("UNCHECKED_CAST")
        val extraHeaders = (cfg["headers"] as? Map<String, String>) ?: emptyMap()

        val bodyObj = cfg["body"] ?: resolvedInputs["body"]
        val bodyJson = if (bodyObj != null && method !in setOf("GET", "HEAD", "DELETE")) {
            when (bodyObj) {
                is String -> bodyObj
                else      -> mapper.writeValueAsString(bodyObj)
            }
        } else null

        emitEvent(context, node.id, EventType.HTTP_REQUEST_PREPARED, "running",
            title = "HTTP request prepared",
            summary = "$method ${sanitizeUrlForLog(rawUrl)}")

        // ── Execute ───────────────────────────────────────────────────────────
        val startMs = System.currentTimeMillis()

        emitEvent(context, node.id, EventType.HTTP_REQUEST_STARTED, "running",
            title = "HTTP request started",
            summary = "$method ${sanitizeUrlForLog(rawUrl)}")

        val (statusCode, responseBody, responseHeaders) = try {
            doRequest(rawUrl, method, authHeader, extraHeaders, bodyJson, timeoutMs)
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - startMs
            log.warn("[http] request failed [nodeId={}, method={}, durationMs={}]: {}",
                node.id, method, durationMs, e.javaClass.simpleName)
            return NodeResult.Failed("HTTP request failed for node '${node.id}': ${e.message?.take(200)}")
        }

        val durationMs = System.currentTimeMillis() - startMs

        if (responseBody.length > maxRespBytes) {
            return NodeResult.Failed(
                "HTTP response exceeded size limit for node '${node.id}': " +
                        "${responseBody.length} > $maxRespBytes bytes"
            )
        }

        val success = statusCode in 200..299
        emitEvent(context, node.id, EventType.HTTP_REQUEST_COMPLETED, if (success) "success" else "failed",
            title = "HTTP request completed",
            summary = "$method ${sanitizeUrlForLog(rawUrl)} → $statusCode (${durationMs}ms)",
            durationMs = durationMs)

        if (!success) {
            return NodeResult.Failed("HTTP node '${node.id}': server returned HTTP $statusCode")
        }

        // ── Parse response ────────────────────────────────────────────────────
        val parsedBody: Any = try {
            mapper.readValue(responseBody, Any::class.java)
        } catch (_: Exception) {
            responseBody // raw string if not JSON
        }

        // ── Slack / API soft-failure detection ────────────────────────────────
        // Slack Web API (chat.postMessage etc.) always returns HTTP 200, but
        // indicates failures via {"ok": false, "error": "..."} in the JSON body.
        // Treat these as hard failures so the step shows as failed with the reason.
        @Suppress("UNCHECKED_CAST")
        if (parsedBody is Map<*, *>) {
            val ok = (parsedBody as Map<String, Any?>)["ok"]
            if (ok == false || ok == "false") {
                val slackError = parsedBody["error"]?.toString() ?: "unknown Slack error"
                val needed     = parsedBody["needed"]?.toString()  // missing OAuth scope
                val reason = if (needed != null)
                    "Slack API error: $slackError (needed scope: $needed)"
                else
                    "Slack API error: $slackError"
                log.warn("[http] Slack soft-failure [nodeId={}, error={}]", node.id, slackError)
                return NodeResult.Failed("HTTP node '${node.id}': $reason")
            }
        }

        return NodeResult.Completed(
            output = mapOf(
                "statusCode"  to statusCode,
                "body"        to parsedBody,
                "headers"     to redactHeaders(responseHeaders),
            ),
            metadata = mapOf(
                "method"     to method,
                "statusCode" to statusCode,
                "durationMs" to durationMs,
            )
        )
    }

    // ── HTTP execution ────────────────────────────────────────────────────────

    private fun doRequest(
        url: String,
        method: String,
        authHeader: Pair<String, String>?,
        extraHeaders: Map<String, String>,
        bodyJson: String?,
        timeoutMs: Long,
    ): Triple<Int, String, Map<String, List<String>>> {
        val reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofMillis(timeoutMs))

        // Auth header first — never in URL
        authHeader?.let { (name, value) -> reqBuilder.header(name, value) }

        // Extra headers (skip if they attempt to override auth)
        extraHeaders.forEach { (k, v) ->
            if (k.lowercase() !in REDACTED_HEADER_NAMES) {
                reqBuilder.header(k, v)
            }
        }

        val bodyPublisher = when {
            bodyJson != null -> {
                reqBuilder.header("Content-Type", "application/json")
                HttpRequest.BodyPublishers.ofString(bodyJson)
            }
            method in setOf("POST", "PUT", "PATCH") -> HttpRequest.BodyPublishers.noBody()
            else -> HttpRequest.BodyPublishers.noBody()
        }

        reqBuilder.method(method, bodyPublisher)

        val response = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString())
        return Triple(response.statusCode(), response.body() ?: "", response.headers().map())
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun resolveUrl(
        cfg: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
        baseUrl: String?,
    ): String? {
        val configUrl = cfg["url"] as? String
        val inputUrl  = resolvedInputs["url"] as? String
        val path      = cfg["path"] as? String ?: resolvedInputs["path"] as? String

        return when {
            !configUrl.isNullOrBlank() -> {
                if (baseUrl != null && !configUrl.startsWith("http")) {
                    baseUrl.trimEnd('/') + "/" + configUrl.trimStart('/')
                } else configUrl
            }
            !inputUrl.isNullOrBlank()  -> inputUrl
            baseUrl != null && path != null -> baseUrl.trimEnd('/') + "/" + path.trimStart('/')
            baseUrl != null -> baseUrl
            else -> null
        }
    }

    /** Remove query-string from URL for safe logging. */
    private fun sanitizeUrlForLog(url: String): String = try {
        val uri = URI.create(url)
        "${uri.scheme}://${uri.host}${uri.path}"
    } catch (_: Exception) {
        url.take(80)
    }

    private fun redactHeaders(headers: Map<String, List<String>>): Map<String, String> =
        headers.entries.associate { (k, vs) ->
            val v = if (k.lowercase() in REDACTED_HEADER_NAMES) "[REDACTED]" else vs.firstOrNull() ?: ""
            k to v
        }

    private fun emitEvent(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
        durationMs: Long? = null,
    ) = try {
        eventStore.appendEvent(RunEvent(
            runId         = ctx.runId,
            workspaceId   = ctx.workspaceId,
            environmentId = ctx.environmentId,
            type          = type,
            status        = status,
            stepId        = nodeId,
            title         = title,
            summary       = summary,
            durationMs    = durationMs,
        ))
    } catch (_: Exception) {}
}
