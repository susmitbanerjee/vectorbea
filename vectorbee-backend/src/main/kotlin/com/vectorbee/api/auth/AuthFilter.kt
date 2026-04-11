package com.vectorbee.api.auth

import com.sun.net.httpserver.Filter
import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.RequestContext
import com.vectorbee.api.http.RoutePattern
import com.vectorbee.api.http.setRequestContext
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.service.AuthService

class AuthFilter(
    private val authService: AuthService,
    private val protectedRoutes: List<RouteDefinition>
) : Filter() {
    data class RouteDefinition(
        val method: String,
        val pattern: String
    )

    override fun description(): String = "Validates bearer tokens for protected routes"

    override fun doFilter(exchange: HttpExchange, chain: Chain) {
        try {
            val authRequired = protectedRoutes.any {
                it.method == exchange.requestMethod && RoutePattern.matches(it.pattern, exchange.requestURI.path)
            }

            if (!authRequired) {
                exchange.setRequestContext(RequestContext())
                chain.doFilter(exchange)
                return
            }

            val authorization = exchange.requestHeaders.getFirst("Authorization")
                ?: throw HttpException(401, "Missing Authorization header")

            if (!authorization.startsWith("Bearer ")) {
                throw HttpException(401, "Invalid Authorization header")
            }

            val token = authorization.removePrefix("Bearer ").trim()
            if (token.isBlank()) {
                throw HttpException(401, "Bearer token is empty")
            }

            val authResult = authService.authenticate(token)
                ?: throw HttpException(401, "Invalid API key")

            exchange.setRequestContext(
                RequestContext(
                    workspaceId = authResult.workspaceId,
                    workspaceRole = authResult.workspaceRole,
                    organizationId = authResult.organizationId
                )
            )
            chain.doFilter(exchange)
        } catch (ex: HttpException) {
            exchange.writeJson(ex.statusCode, mapOf("error" to ex.message))
        } catch (ex: Exception) {
            ex.printStackTrace()
            exchange.writeJson(500, mapOf("error" to "Internal server error"))
        }
    }
}
