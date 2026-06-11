package com.vectorbea.api.http

import com.vectorbea.api.errors.ApiError

/**
 * Path-and-method router.
 *
 * Routes are registered with [route] and matched in registration order.
 * Path parameters use the `:param` syntax:
 *
 * ```kotlin
 * router.route("GET", "/workflows/:id/run", handler)
 * // matches /workflows/abc-123/run → pathParams["id"] = "abc-123"
 * ```
 *
 * The router is a pure function: [dispatch] returns a [Response] (never throws).
 */
class Router {

    data class Route(
        val method: String,         // uppercase, e.g. "GET"
        val pathPattern: String,    // e.g. "/workflows/:id/run"
        val segments: List<Segment>,
        val handler: (Request) -> Response,
    )

    sealed class Segment {
        data class Literal(val value: String) : Segment()
        data class Param(val name: String) : Segment()
    }

    private val routes = mutableListOf<Route>()

    /** Register a route for [method] + [pathPattern]. */
    fun route(method: String, pathPattern: String, handler: (Request) -> Response) {
        routes += Route(
            method = method.uppercase(),
            pathPattern = pathPattern,
            segments = parsePattern(pathPattern),
            handler = handler,
        )
    }

    // Convenience registration methods
    fun get(pattern: String, handler: (Request) -> Response) = route("GET", pattern, handler)
    fun post(pattern: String, handler: (Request) -> Response) = route("POST", pattern, handler)
    fun put(pattern: String, handler: (Request) -> Response) = route("PUT", pattern, handler)
    fun patch(pattern: String, handler: (Request) -> Response) = route("PATCH", pattern, handler)
    fun delete(pattern: String, handler: (Request) -> Response) = route("DELETE", pattern, handler)

    // ── SSE streaming routes ──────────────────────────────────────────────────

    /**
     * Represents a streaming Server-Sent Events emitter.
     * Implementations are provided by [HttpServer]; handlers call [sendEvent] / [sendComment]
     * to push data and check [isConnected] to detect client disconnect.
     */
    interface SseEmitter {
        /** Write an SSE event frame. Returns false if the client has disconnected. */
        fun sendEvent(eventType: String, data: String): Boolean
        /** Write an SSE comment (heartbeat). Returns false if disconnected. */
        fun sendComment(comment: String): Boolean
        /** True while the underlying connection is still open. */
        fun isConnected(): Boolean
    }

    data class SseRoute(
        val pathPattern: String,
        val segments: List<Segment>,
        val handler: (Request, SseEmitter) -> Unit,
    )

    private val sseRoutes = mutableListOf<SseRoute>()

    /** Register a GET SSE streaming route. */
    fun sseGet(pattern: String, handler: (Request, SseEmitter) -> Unit) {
        sseRoutes += SseRoute(
            pathPattern = pattern,
            segments = parsePattern(pattern),
            handler = handler,
        )
        // Also register a normal GET that returns 405-ish for non-SSE clients (content-type check
        // happens in HttpServer before dispatch — just ensure allowedMethods includes GET).
    }

    /** Returns the matching SSE route and extracted path params, or null. */
    fun findSseRoute(method: String, path: String): Pair<SseRoute, Map<String, String>>? {
        if (method != "GET") return null
        val segments = splitPath(path)
        for (route in sseRoutes) {
            val params = matchPath(route.segments, segments) ?: continue
            return route to params
        }
        return null
    }

    /**
     * Match [request] against registered routes.
     * Returns a [Response] — never throws. All [ApiError]s (404, 405, handler errors)
     * are caught here and converted to structured JSON responses.
     */
    fun dispatch(request: Request): Response {
        return try {
            val pathSegments = splitPath(request.path)

            // Find all routes whose path pattern matches (any method)
            val pathMatches = routes.filter { route ->
                matchPath(route.segments, pathSegments) != null
            }

            if (pathMatches.isEmpty()) {
                // No route has this path at all → 404
                throw ApiError.NotFound(request.path)
            }

            // Among path-matching routes, find one with the right method
            val methodMatch = pathMatches.firstOrNull { it.method == request.method }
                ?: throw ApiError.MethodNotAllowed(request.method, request.path)

            // Extract path params and dispatch
            val pathParams = matchPath(methodMatch.segments, pathSegments)!!
            val enrichedRequest = request.copy(pathParams = pathParams)
            methodMatch.handler(enrichedRequest)
        } catch (e: ApiError) {
            Response.fromApiError(e, request.requestId)
        }
    }

    /** All HTTP methods that have a registered route for [path] (for Allow header). */
    fun allowedMethods(path: String): List<String> {
        val segments = splitPath(path)
        return routes
            .filter { matchPath(it.segments, segments) != null }
            .map { it.method }
            .distinct()
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun parsePattern(pattern: String): List<Segment> =
        splitPath(pattern).map { seg ->
            if (seg.startsWith(":")) Segment.Param(seg.drop(1))
            else Segment.Literal(seg)
        }

    private fun splitPath(path: String): List<String> =
        path.trim('/').split('/').filter { it.isNotEmpty() }

    /**
     * Returns path params map if [patternSegments] matches [pathSegments], else null.
     */
    private fun matchPath(
        patternSegments: List<Segment>,
        pathSegments: List<String>,
    ): Map<String, String>? {
        if (patternSegments.size != pathSegments.size) return null
        val params = mutableMapOf<String, String>()
        for ((pat, actual) in patternSegments.zip(pathSegments)) {
            when (pat) {
                is Segment.Literal -> if (pat.value != actual) return null
                is Segment.Param -> params[pat.name] = actual
            }
        }
        return params
    }
}
