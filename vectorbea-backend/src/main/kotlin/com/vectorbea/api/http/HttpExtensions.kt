package com.vectorbea.api.http

import com.sun.net.httpserver.HttpExchange
import java.nio.charset.StandardCharsets
import java.net.URLDecoder
import java.util.UUID

private const val REQUEST_CONTEXT_KEY = "vectorbea.requestContext"

private const val MAX_BODY_BYTES: Int = 1 * 1024 * 1024 // 1 MiB

fun HttpExchange.readBody(): String {
    val buffer = ByteArray(MAX_BODY_BYTES + 1)
    var total = 0
    requestBody.use { stream ->
        while (true) {
            val read = stream.read(buffer, total, buffer.size - total)
            if (read <= 0) break
            total += read
            if (total > MAX_BODY_BYTES) {
                throw HttpException(413, "Request body too large (max ${MAX_BODY_BYTES} bytes)")
            }
        }
    }
    return String(buffer, 0, total, StandardCharsets.UTF_8)
}

fun HttpExchange.writeJson(statusCode: Int, payload: Any) {
    val bytes = Json.encode(payload).toByteArray(StandardCharsets.UTF_8)
    responseHeaders.add("Content-Type", "application/json; charset=utf-8")
    sendResponseHeaders(statusCode, bytes.size.toLong())
    responseBody.use { it.write(bytes) }
}

fun HttpExchange.writeEmpty(statusCode: Int) {
    sendResponseHeaders(statusCode, -1)
    responseBody.close()
}

fun HttpExchange.pathParam(name: String, pattern: String): String {
    val pathParts = requestURI.path.trim('/').split('/')
    val patternParts = pattern.trim('/').split('/')
    val index = patternParts.indexOfFirst { it == ":$name" }

    if (index == -1 || index >= pathParts.size) {
        throw HttpException(500, "Route parameter $name not available")
    }

    return pathParts[index]
}

fun HttpExchange.setRequestContext(context: RequestContext) {
    setAttribute(REQUEST_CONTEXT_KEY, context)
}

fun HttpExchange.requestContext(): RequestContext =
    getAttribute(REQUEST_CONTEXT_KEY) as? RequestContext ?: RequestContext()

fun HttpExchange.uuidQueryParam(name: String): UUID? =
    queryParam(name)?.let {
        try {
            UUID.fromString(it)
        } catch (_: IllegalArgumentException) {
            throw HttpException(400, "$name must be a valid UUID")
        }
    }

fun HttpExchange.queryParam(name: String): String? =
    requestURI.rawQuery
        ?.split("&")
        ?.mapNotNull { entry ->
            val parts = entry.split("=", limit = 2)
            if (parts.isEmpty()) null else {
                val key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8)
                val value = if (parts.size > 1) URLDecoder.decode(parts[1], StandardCharsets.UTF_8) else ""
                key to value
            }
        }
        ?.firstOrNull { it.first == name }
        ?.second
