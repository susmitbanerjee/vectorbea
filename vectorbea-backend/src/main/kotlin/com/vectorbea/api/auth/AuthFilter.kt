package com.vectorbea.api.auth

import com.sun.net.httpserver.Filter
import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.RequestContext
import com.vectorbea.api.http.RoutePattern
import com.vectorbea.api.http.setRequestContext
import com.vectorbea.api.http.writeJson
import com.vectorbea.api.service.AuthService

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
