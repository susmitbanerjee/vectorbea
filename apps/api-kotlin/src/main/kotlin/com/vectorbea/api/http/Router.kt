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

    /**
     * Match [request] against registered routes.
     * Returns a [Response], handling 404 and 405 internally.
     */
    fun dispatch(request: Request): Response {
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
        return methodMatch.handler(enrichedRequest)
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
