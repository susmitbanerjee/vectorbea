package com.vectorbea.telemetry.auth

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
import org.slf4j.LoggerFactory

class JwtVerifier(private val secret: String) {
    private val log = LoggerFactory.getLogger(JwtVerifier::class.java)
    private val algorithm = Algorithm.HMAC256(secret)

    fun verify(token: String): JwtClaims {
        val verified = try {
            JWT.require(algorithm).acceptLeeway(30).build().verify(token)
        } catch (e: JWTVerificationException) {
            throw AuthException("JWT verification failed: ${e.message}")
        } catch (e: Exception) {
            throw AuthException("Malformed JWT: ${e.message}")
        }

        val sub = verified.subject ?: throw AuthException("JWT missing 'sub' claim")
        val email = verified.getClaim("email").asString()
        val userMeta = verified.getClaim("user_metadata").asMap()
        val fullName = userMeta?.get("full_name") as? String

        log.debug("[jwt] verified sub={}", sub)
        return JwtClaims(sub = sub, email = email, fullName = fullName)
    }
}

data class JwtClaims(val sub: String, val email: String?, val fullName: String?)

class AuthException(message: String) : RuntimeException(message)
