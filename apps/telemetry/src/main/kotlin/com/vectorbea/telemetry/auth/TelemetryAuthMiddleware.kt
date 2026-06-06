package com.vectorbea.telemetry.auth

import com.vectorbea.telemetry.config.TelemetryConfig
import com.vectorbea.telemetry.http.Response
import com.vectorbea.telemetry.http.TelemetryRequest

/**
 * Authentication middleware for telemetry dashboard routes.
 * All dashboard routes require a valid JWT from an admin email.
 */
class TelemetryAuthMiddleware(
    private val jwtVerifier: JwtVerifier,
    private val config: TelemetryConfig,
) {
    /** Verifies user JWT and checks admin status. Returns claims or null (response already sent). */
    fun requireAdmin(req: TelemetryRequest): JwtClaims? {
        val token = req.bearerToken()
        if (token == null) {
            Response.unauthorized(req.exchange, "Bearer token required")
            return null
        }
        val claims = try {
            jwtVerifier.verify(token)
        } catch (e: AuthException) {
            Response.unauthorized(req.exchange, "Invalid token: ${e.message}")
            return null
        }
        if (!config.isAdmin(claims.email)) {
            Response.forbidden(req.exchange, "Admin access required")
            return null
        }
        return claims
    }

    /** Verifies user JWT (any authenticated user). Returns claims or null (response already sent). */
    fun requireAuth(req: TelemetryRequest): JwtClaims? {
        val token = req.bearerToken()
        if (token == null) {
            Response.unauthorized(req.exchange, "Bearer token required")
            return null
        }
        return try {
            jwtVerifier.verify(token)
        } catch (e: AuthException) {
            Response.unauthorized(req.exchange, "Invalid token: ${e.message}")
            null
        }
    }

    /** Verifies internal service token. Returns true or writes 401 response. */
    fun requireInternalToken(req: TelemetryRequest): Boolean {
        val token = req.internalToken() ?: req.bearerToken()
        if (token == null || config.internalToken == null) {
            Response.unauthorized(req.exchange, "Internal token required")
            return false
        }
        if (token != config.internalToken) {
            Response.unauthorized(req.exchange, "Invalid internal token")
            return false
        }
        return true
    }
}
