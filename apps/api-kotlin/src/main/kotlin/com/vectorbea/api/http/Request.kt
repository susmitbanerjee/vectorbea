package com.vectorbea.api.http

import com.sun.net.httpserver.HttpExchange
import java.net.URI

/**
 * Immutable representation of an incoming HTTP request.
 *
 * Parsed from JDK [HttpExchange] by [Request.from].
 * Body is read eagerly and capped at [maxBodyBytes] to prevent large-payload attacks.
 */
import com.vectorbea.api.auth.AuthPrincipal

data class Request(
    val method: String,
    val path: String,
    /** Path parameters extracted by the router, e.g. { "id" -> "abc-123" } */
    val pathParams: Map<String, String> = emptyMap(),
    /** Query string parameters, e.g. ?workspaceId=foo → { "workspaceId" -> "foo" } */
    val queryParams: Map<String, String> = emptyMap(),
    /** Lowercase header names for case-insensitive lookup */
    val headers: Map<String, String> = emptyMap(),
    /** Raw request body as a string (empty string if no body) */
    val body: String = "",
    /** Per-request unique ID — generated before routing */
    val requestId: String = "",
    /** Verified auth principal — null when auth is disabled (dev mode) or for public endpoints. */
    val principal: com.vectorbea.api.auth.AuthPrincipal? = null,
    /**
     * The API key this request authenticated with, when it did.
     *
     * Carried ALONGSIDE [principal] rather than instead of it: a key that acts
     * as a member produces a principal too, because a key must be held to that
     * member's spend cap rather than escaping it. "Which key" and "whose budget"
     * are different questions, and an incident asks both.
     *
     * Null for every browser request, which is the overwhelming majority.
     */
    val apiKeyId: java.util.UUID? = null,
) {
    companion object {
        private const val DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

        fun from(
            exchange: HttpExchange,
            requestId: String,
            maxBodyBytes: Int = DEFAULT_MAX_BODY_BYTES,
        ): Request {
            val uri: URI = exchange.requestURI
            val path = uri.path ?: "/"
            val queryParams = parseQuery(uri.rawQuery)
            val headers = buildMap<String, String> {
                exchange.requestHeaders.forEach { (k, vs) ->
                    if (vs.isNotEmpty()) put(k.lowercase(), vs.first())
                }
            }
            val body = exchange.requestBody.use { stream ->
                val bytes = stream.readNBytes(maxBodyBytes + 1)
                if (bytes.size > maxBodyBytes) {
                    throw com.vectorbea.api.errors.ApiError.ValidationError(
                        "Request body exceeds maximum allowed size of $maxBodyBytes bytes"
                    )
                }
                String(bytes, Charsets.UTF_8)
            }

            return Request(
                method = exchange.requestMethod.uppercase(),
                path = path,
                queryParams = queryParams,
                headers = headers,
                body = body,
                requestId = requestId,
            )
        }

        private fun parseQuery(rawQuery: String?): Map<String, String> {
            if (rawQuery.isNullOrBlank()) return emptyMap()
            return buildMap {
                rawQuery.split("&").forEach { pair ->
                    val idx = pair.indexOf('=')
                    if (idx >= 0) {
                        val key = java.net.URLDecoder.decode(pair.substring(0, idx), "UTF-8")
                        val value = java.net.URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
                        put(key, value)
                    } else if (pair.isNotBlank()) {
                        put(java.net.URLDecoder.decode(pair, "UTF-8"), "")
                    }
                }
            }
        }
    }

    /** Typed body deserialization — throws [ApiError.ValidationError] on malformed JSON. */
    inline fun <reified T> bodyAs(): T {
        if (body.isBlank()) throw com.vectorbea.api.errors.ApiError.ValidationError("Request body is required")
        return try {
            fromJson<T>(body)
        } catch (e: Exception) {
            throw com.vectorbea.api.errors.ApiError.ValidationError("Invalid JSON body: ${e.message}")
        }
    }

    fun header(name: String): String? = headers[name.lowercase()]
    fun query(name: String): String? = queryParams[name]
    fun pathParam(name: String): String = pathParams[name]
        ?: throw com.vectorbea.api.errors.ApiError.InternalError("Missing path param: $name")
}
