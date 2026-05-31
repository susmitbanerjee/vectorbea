package com.vectorbea.api.auth

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
import org.slf4j.LoggerFactory

/**
 * Verifies JWTs signed with HMAC-SHA256 (HS256) using the local JWT_SECRET.
 *
 * Since auth is now Neon-native (no Supabase), all tokens are issued by the
 * Next.js API with a shared secret.  No JWKS, no external HTTP calls.
 *
 * Security guarantees:
 *  - Token is fully verified (signature + expiry) before claims are returned.
 *  - Unverified / unsigned tokens are rejected with AuthException.
 *  - Clock skew tolerance: 30 seconds.
 *  - Calling code MUST use the returned [JwtClaims.sub] as user identity.
 */
class JwtVerifier(private val secret: String) {

    private val log = LoggerFactory.getLogger(JwtVerifier::class.java)
    private val algorithm = Algorithm.HMAC256(secret)

    fun verify(token: String): JwtClaims {
        val verified = try {
            JWT.require(algorithm)
                .acceptLeeway(30)   // 30-second clock skew tolerance
                .build()
                .verify(token)
        } catch (e: JWTVerificationException) {
            throw AuthException("JWT verification failed: ${e.message}")
        } catch (e: Exception) {
            throw AuthException("Malformed JWT: ${e.message}")
        }

        val sub = verified.subject
            ?: throw AuthException("JWT missing 'sub' claim")

        val email    = verified.getClaim("email").asString()
        val role     = verified.getClaim("role").asString()
        val userMeta = verified.getClaim("user_metadata").asMap()
        val fullName  = userMeta?.get("full_name")  as? String ?: userMeta?.get("name") as? String
        val avatarUrl = userMeta?.get("avatar_url") as? String ?: userMeta?.get("picture") as? String

        log.debug("[jwt] verified sub={}", sub)
        return JwtClaims(sub = sub, email = email, role = role,
            fullName = fullName, avatarUrl = avatarUrl)
    }
}

data class JwtClaims(
    val sub: String,
    val email: String?,
    val role: String?,
    val fullName: String?,
    val avatarUrl: String?,
)

class AuthException(message: String) : RuntimeException(message)
