package com.vectorbea.telemetry.http

import com.sun.net.httpserver.HttpExchange
import org.slf4j.LoggerFactory

typealias Handler = (TelemetryRequest) -> Unit

class Router {
    private val log = LoggerFactory.getLogger(Router::class.java)
    private val routes = mutableListOf<Route>()

    data class Route(val method: String, val pattern: String, val handler: Handler)

    fun get(path: String, handler: Handler) = routes.add(Route("GET", path, handler))
    fun post(path: String, handler: Handler) = routes.add(Route("POST", path, handler))

    fun dispatch(exchange: HttpExchange) {
        val method = exchange.requestMethod.uppercase()
        val path = exchange.requestURI.path
        val req = TelemetryRequest(exchange)

        if (method == "OPTIONS") {
            exchange.sendResponseHeaders(204, -1)
            exchange.responseBody.close()
            return
        }

        val match = routes.firstOrNull { r ->
            r.method == method && pathMatches(r.pattern, path)
        }

        if (match == null) {
            Response.notFound(exchange, "No route for $method $path")
            return
        }

        try {
            match.handler(req)
        } catch (e: Exception) {
            log.error("Handler error for $method $path: ${e.message}", e)
            try { Response.serverError(exchange, e.message ?: "Internal error") }
            catch (_: Exception) {}
        }
    }

    private fun pathMatches(pattern: String, path: String): Boolean {
        if (pattern == path) return true
        val pParts = pattern.split("/")
        val rParts = path.split("/")
        if (pParts.size != rParts.size) return false
        return pParts.zip(rParts).all { (p, r) -> p.startsWith(":") || p == r }
    }
}
