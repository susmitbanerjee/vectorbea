package com.vectorbea.api.auth

import com.auth0.jwk.JwkProviderBuilder
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
import org.slf4j.LoggerFactory
import java.net.URL
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.TimeUnit

/**
 * Verifies Supabase-issued JWTs.
 *
 * Supports:
 *  - RS256 / ES256 — JWKS-based (preferred, Supabase default for newer projects)
 *  - HS256        — HMAC secret fallback (legacy Supabase projects)
 *
 * JWKS is cached for [jwksCacheDurationHours] hours to avoid hammering Supabase.
 * Rate-limited to prevent JWKS-endpoint abuse during key-cache misses.
 *
 * Security guarantees:
 *  - Token is ALWAYS fully verified (signature + expiry + issuer) before claims are returned.
 *  - Unverified / unsigned tokens are rejected.
 *  - Clock skew tolerance: 30 seconds.
 *  - Calling code MUST use the returned [JwtClaims.sub] as the user identity — never trust
 *    a userId passed in any HTTP header or body.
 */
class JwtVerifier(
    private val supabaseUrl: String,
    /** Optional HMAC-SHA256 secret (Supabase "JWT Secret" in project settings).
     *  Only used when the token algorithm is HS256.  Never log this value. */
    private val jwtSecret: String? = null,
    private val jwksCacheDurationHours: Long = 1,
    private val jwksRateLimitPerMinute: Long = 10,
) {
    private val log = LoggerFactory.getLogger(JwtVerifier::class.java)

    // Normalize URL (strip trailing slash)
    private val baseUrl = supabaseUrl.trimEnd('/')

    // Supabase JWKS endpoint
    private val jwksUrl = URL("$baseUrl/.well-known/jwks.json")

    // Auth0 JWKS provider — caches public keys, rate-limits re-fetch on cache miss
    private val jwkProvider = JwkProviderBuilder(jwksUrl)
        .cached(/* maxCachedEntries */ 10, jwksCacheDurationHours, TimeUnit.HOURS)
        .rateLimited(jwksRateLimitPerMinute, 1, TimeUnit.MINUTES)
        .build()

    // Acceptable issuers — Supabase uses both forms depending on project setup
    private val acceptedIssuers = setOf("$baseUrl/auth/v1", baseUrl)

    /**
     * Verify [token] and return the contained claims.
     *
     * @throws AuthException if the token is missing, malformed, expired, or from
     *                       an unrecognised issuer / key.
     */
    fun verify(token: String): JwtClaims {
        // Decode header only (NO signature verification yet — just to read alg/kid)
        val decoded = try {
            JWT.decode(token)
        } catch (e: Exception) {
            throw AuthException("Malformed JWT: ${e.message}")
        }

        val algorithm: Algorithm = when (val alg = decoded.algorithm) {
            "RS256" -> {
                val kid = decoded.keyId
                    ?: throw AuthException("RS256 JWT missing 'kid' — cannot look up JWKS key")
                val jwk = try {
                    jwkProvider.get(kid)
                } catch (e: Exception) {
                    throw AuthException("JWKS key lookup failed for kid=$kid: ${e.message}")
                }
                Algorithm.RSA256(jwk.publicKey as RSAPublicKey, null)
            }
            "ES256" -> {
                val kid = decoded.keyId
                    ?: throw AuthException("ES256 JWT missing 'kid' — cannot look up JWKS key")
                val jwk = try {
                    jwkProvider.get(kid)
                } catch (e: Exception) {
                    throw AuthException("JWKS key lookup failed for kid=$kid: ${e.message}")
                }
                Algorithm.ECDSA256(jwk.publicKey as ECPublicKey, null)
            }
            "HS256" -> {
                if (jwtSecret == null) {
                    throw AuthException(
                        "HS256 token received but SUPABASE_JWT_SECRET is not configured. " +
                        "For newer Supabase projects using RS256/ES256, ensure the JWT is generated " +
                        "by a project that uses asymmetric keys (JWKS)."
                    )
                }
                Algorithm.HMAC256(jwtSecret)
            }
            else -> throw AuthException("Unsupported JWT algorithm: $alg")
        }

        // NOW verify: signature + expiry + issuer
        val verified = try {
            JWT.require(algorithm)
                .withAnyOfAudience("authenticated")   // Supabase sets aud=authenticated for user JWTs
                .acceptLeeway(30)                      // 30-second clock skew tolerance
                .build()
                .verify(decoded)
        } catch (e: JWTVerificationException) {
            throw AuthException("JWT verification failed: ${e.message}")
        }

        // Validate issuer explicitly (extra safety on top of the JWT library check)
        val iss = verified.issuer
        if (iss !in acceptedIssuers) {
            throw AuthException("JWT issuer '$iss' is not in the accepted issuer list")
        }

        val sub = verified.subject
            ?: throw AuthException("JWT missing 'sub' claim — cannot derive user identity")

        val email = verified.getClaim("email").asString()
        val role  = verified.getClaim("role").asString()

        log.debug("[jwt] verified sub={} alg={}", sub, alg)
        return JwtClaims(sub = sub, email = email, role = role)
    }
}

/**
 * Verified claims extracted from a Supabase JWT.
 * All fields were cryptographically verified — safe to trust.
 */
data class JwtClaims(
    /** Supabase user ID (UUID string from `sub` claim).  Use as the authoritative identity. */
    val sub: String,
    /** User email from JWT — may be null if not included in token. */
    val email: String?,
    /** Supabase role claim (usually "authenticated"). */
    val role: String?,
)

/** Thrown when a JWT cannot be verified for any reason. Maps to HTTP 401. */
class AuthException(message: String) : RuntimeException(message)
