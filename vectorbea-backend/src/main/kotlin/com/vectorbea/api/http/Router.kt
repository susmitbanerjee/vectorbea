package com.vectorbea.api.http

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler

class Router : HttpHandler {
    private data class Route(
        val method: String,
        val pattern: String,
        val authRequired: Boolean,
        val handler: (HttpExchange) -> Unit
    )

    private val routes = mutableListOf<Route>()

    fun get(pattern: String, authRequired: Boolean = false, handler: (HttpExchange) -> Unit) {
        routes += Route("GET", pattern, authRequired, handler)
    }

    fun post(pattern: String, authRequired: Boolean = false, handler: (HttpExchange) -> Unit) {
        routes += Route("POST", pattern, authRequired, handler)
    }

    fun delete(pattern: String, authRequired: Boolean = false, handler: (HttpExchange) -> Unit) {
        routes += Route("DELETE", pattern, authRequired, handler)
    }

    override fun handle(exchange: HttpExchange) {
        try {
            val route = routes.firstOrNull {
                it.method == exchange.requestMethod && RoutePattern.matches(it.pattern, exchange.requestURI.path)
            } ?: throw HttpException(404, "Route not found")

            route.handler(exchange)
        } catch (ex: HttpException) {
            exchange.writeJson(ex.statusCode, mapOf("error" to ex.message))
        } catch (ex: Exception) {
            ex.printStackTrace()
            exchange.writeJson(500, mapOf("error" to "Internal server error"))
        }
    }
}
