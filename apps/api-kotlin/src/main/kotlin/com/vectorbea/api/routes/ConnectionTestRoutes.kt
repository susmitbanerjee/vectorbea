package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.validateConfigJsonNotContainsSecrets
import com.vectorbea.api.cache.CacheKeys
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.get
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.connector.ConnectionTester
import com.vectorbea.api.connector.ConnectionTestResult
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.Connection
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.secrets.SecretServiceUnavailableException
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Connection testing routes.
 *
 * SECURITY:
 * - plaintextSecret is accepted ONLY over TLS and only in POST body.
 * - plaintextSecret is NEVER logged, returned, or persisted in configJson.
 * - For saved connections, secrets are resolved server-side via SecretService.
 * - Test results are cached briefly — cached results never contain secrets.
 */
class ConnectionTestRoutes(
    private val connectionRepo: ConnectionRepository,
    private val secretService: SecretService,
    private val cache: CacheService,
) {
    private val log = LoggerFactory.getLogger(ConnectionTestRoutes::class.java)
    private val tester = ConnectionTester(secretService)

    fun register(router: Router) {
        router.post("/api/connections/:id/test", ::testSaved)
        router.post("/api/connections/test-unsaved", ::testUnsaved)
        router.post("/api/connections/:id/rotate-secret", ::rotateSecret)
        router.get("/api/connections/:id/list-models", ::listModels)
    }

    // ── POST /api/connections/:id/test ────────────────────────────────────────

    private fun testSaved(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")

        val connection = connectionRepo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Connection")

        // Check brief cache (30s) — avoids hammering providers with rapid re-tests
        val cacheKey = CacheKeys.connectionTest(ctx.workspaceId.toString(), id.toString())
        val cached = cache.get<Map<String, Any?>>(cacheKey)
        if (cached != null) {
            log.debug("Returning cached test result [connectionId={}]", id)
            return Response.ok(cached)
        }

        val result = tester.test(connection)

        // Persist result to DB (update last_tested_at, status, etc.)
        persistTestResult(connection, result)

        // Cache briefly — result never contains secrets
        cache.set(cacheKey, result.toResponse(), ttlSeconds = 30L)

        return Response.ok(result.toResponse())
    }

    // ── POST /api/connections/test-unsaved ────────────────────────────────────

    private fun testUnsaved(req: Request): Response {
        req.context()  // validates workspace header

        data class UnsavedTestBody(
            val type: String?,
            val provider: String?,
            val authType: String? = "api_key",
            /** Plaintext secret — accepted here, never stored, never logged */
            val plaintextSecret: String? = null,
            val config: Map<String, Any?>? = null,
        )

        val body = req.bodyAs<UnsavedTestBody>()

        val type = body.type?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("type is required")
        val provider = body.provider?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("provider is required")

        // Ensure config doesn't accidentally contain secrets alongside plaintextSecret
        @Suppress("UNCHECKED_CAST")
        val config: Map<String, Any?> = body.config ?: emptyMap()
        validateConfigJsonNotContainsSecrets(config.filterValues { it != null } as Map<String, Any>, "config")

        val result = tester.testUnsaved(
            type = type,
            provider = provider,
            authType = body.authType ?: "api_key",
            plaintextSecret = body.plaintextSecret,
            config = config,
        )

        // Do not cache unsaved tests (no stable key)
        return Response.ok(result.toResponse())
    }

    // ── POST /api/connections/:id/rotate-secret ───────────────────────────────

    private fun rotateSecret(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")

        val connection = connectionRepo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Connection")

        data class RotateBody(
            /** Plaintext new secret — accepted here, encrypted immediately, never stored raw */
            val plaintextSecret: String?,
        )

        val body = req.bodyAs<RotateBody>()
        val plaintext = body.plaintextSecret?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("plaintextSecret is required for secret rotation")

        val ref = connection.secretRef
        if (ref != null) {
            // Update existing secret
            try {
                secretService.updateSecret(ref, plaintext)
            } catch (e: SecretServiceUnavailableException) {
                throw ApiError.ServiceUnavailable("Secret service not configured — cannot rotate secret")
            }
        } else {
            // Create new secret and link it
            val secretRef = try {
                secretService.createSecret(ctx.workspaceId, id, plaintext)
            } catch (e: SecretServiceUnavailableException) {
                throw ApiError.ServiceUnavailable("Secret service not configured — cannot store secret")
            }

            connectionRepo.update(
                id = id,
                workspaceId = ctx.workspaceId,
                secretRef = secretRef.ref,
            )
        }

        // Invalidate cached test result
        cache.del(CacheKeys.connectionTest(ctx.workspaceId.toString(), id.toString()))

        log.info("Secret rotated [connectionId={}, workspaceId={}]", id, ctx.workspaceId)

        return Response.ok(mapOf(
            "id" to id.toString(),
            "secretConfigured" to true,
            "message" to "Secret updated successfully",
        ))
    }

    // ── GET /api/connections/:id/list-models ──────────────────────────────────

    private fun listModels(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")

        val connection = connectionRepo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Connection")

        if (connection.type.lowercase() != "llm") {
            throw ApiError.ValidationError("list-models is only supported for LLM connections")
        }

        // For now, return static model lists per provider.
        // A future version can fetch dynamically using the resolved key.
        val models = knownModels(connection.provider)
        return Response.ok(mapOf("models" to models, "provider" to connection.provider))
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun persistTestResult(connection: Connection, result: ConnectionTestResult) {
        try {
            connectionRepo.updateStatus(
                id = connection.id,
                workspaceId = connection.workspaceId,
                status = when (result.status) {
                    ConnectionTestResult.TestStatus.CONNECTED -> "connected"
                    else -> "failed"
                },
                networkStatus = when (result.status) {
                    ConnectionTestResult.TestStatus.PRIVATE_RUNNER_REQUIRED -> "private_only"
                    ConnectionTestResult.TestStatus.WHITELIST_REQUIRED -> "needs_whitelist"
                    else -> "reachable"
                },
                lastTestedAt = result.testedAt,
                latencyMs = result.latencyMs.toInt().coerceAtMost(Int.MAX_VALUE),
                errorCode = result.errorCode,
                errorMessage = result.message.take(500),   // sanitized — no secrets
            )
        } catch (e: Exception) {
            log.warn("Failed to persist test result [connectionId={}]: {}", connection.id, e.message)
        }
    }

    private fun knownModels(provider: String): List<String> = when (provider.lowercase()) {
        "openai" -> listOf(
            "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4",
            "gpt-3.5-turbo", "o1-preview", "o1-mini",
        )
        "anthropic" -> listOf(
            "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5",
            "claude-opus-4", "claude-sonnet-4", "claude-haiku-3",
        )
        "google", "gemini", "google_gemini" -> listOf(
            "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro",
        )
        "mistral" -> listOf(
            "mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mistral-7b",
        )
        "cohere" -> listOf("command-r-plus", "command-r", "command", "command-light")
        else -> emptyList()
    }
}
