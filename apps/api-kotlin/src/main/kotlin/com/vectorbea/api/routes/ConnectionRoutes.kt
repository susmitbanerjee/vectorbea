package com.vectorbea.api.routes

import com.vectorbea.api.api.AUTH_TYPES
import com.vectorbea.api.api.CONNECTION_TYPES
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.requireMaxLength
import com.vectorbea.api.api.requireOneOf
import com.vectorbea.api.api.slugify
import com.vectorbea.api.api.validateConfigJsonNotContainsSecrets
import com.vectorbea.api.cache.CacheKeys
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.Connection
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.CreateConnectionRequest
import com.vectorbea.api.repository.EnvironmentRepository
import com.vectorbea.api.repository.Page
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.secrets.SecretServiceUnavailableException
import org.slf4j.LoggerFactory

// ── Request bodies ────────────────────────────────────────────────────────────

private data class CreateConnectionBody(
    val name: String?,
    val slug: String? = null,
    val type: String?,
    val provider: String?,
    val authType: String?,
    /** Environment slug selected by the user (development/staging/production). */
    val environment: String? = null,
    val config: Map<String, Any>? = null,
    val allowedHosts: List<String>? = null,
    val allowedPaths: List<String>? = null,
    val allowedSchemas: List<String>? = null,
    val allowedTables: List<String>? = null,
    /**
     * Plaintext secret accepted ONLY on create.
     * Immediately encrypted — NEVER stored, logged, or returned.
     * Must be submitted over TLS.
     */
    val plaintextSecret: String? = null,
)

private data class UpdateConnectionBody(
    val name: String? = null,
    val config: Map<String, Any>? = null,
    val allowedHosts: List<String>? = null,
    val allowedPaths: List<String>? = null,
    val allowedSchemas: List<String>? = null,
    val allowedTables: List<String>? = null,
    val status: String? = null,
    /**
     * Plaintext secret accepted on patch (rotate in place).
     * Immediately encrypted — NEVER stored, logged, or returned.
     */
    val plaintextSecret: String? = null,
)

// ── Response — secrets stripped ───────────────────────────────────────────────

private data class ConnectionResponse(
    val id: String,
    val workspaceId: String,
    val environmentId: String,
    val name: String,
    val slug: String,
    val type: String,
    val provider: String,
    val status: String,
    val networkStatus: String,
    val authType: String,
    val secretConfigured: Boolean,  // replaces secretRef — never expose the ref
    val config: Map<String, Any>,
    val allowedHosts: List<String>,
    val allowedPaths: List<String>,
    val allowedSchemas: List<String>,
    val allowedTables: List<String>,
    val lastTestedAt: String?,
    val lastTestStatus: String?,
    val lastTestLatencyMs: Int?,
    val lastTestErrorCode: String?,
    val lastTestErrorMessageSanitized: String?,
    val createdAt: String,
    val updatedAt: String,
)

@Suppress("UNCHECKED_CAST")
private fun Connection.toResponse() = ConnectionResponse(
    id = id.toString(),
    workspaceId = workspaceId.toString(),
    environmentId = environmentId.toString(),
    name = name,
    slug = slug,
    type = type,
    provider = provider,
    status = status,
    networkStatus = networkStatus,
    authType = authType,
    secretConfigured = secretRef != null,
    config = runCatching { mapper.readValue(configJson, Map::class.java) as Map<String, Any> }.getOrDefault(emptyMap()),
    allowedHosts = runCatching { mapper.readValue(allowedHosts, List::class.java) as List<String> }.getOrDefault(emptyList()),
    allowedPaths = runCatching { mapper.readValue(allowedPaths, List::class.java) as List<String> }.getOrDefault(emptyList()),
    allowedSchemas = runCatching { mapper.readValue(allowedSchemas, List::class.java) as List<String> }.getOrDefault(emptyList()),
    allowedTables = runCatching { mapper.readValue(allowedTables, List::class.java) as List<String> }.getOrDefault(emptyList()),
    lastTestedAt = lastTestedAt?.toString(),
    lastTestStatus = lastTestStatus,
    lastTestLatencyMs = lastTestLatencyMs,
    lastTestErrorCode = lastTestErrorCode,
    lastTestErrorMessageSanitized = lastTestErrorMessageSanitized,
    createdAt = createdAt.toString(),
    updatedAt = updatedAt.toString(),
)

// ── Route handler ─────────────────────────────────────────────────────────────

class ConnectionRoutes(
    private val repo: ConnectionRepository,
    private val cache: CacheService,
    private val secretService: SecretService? = null,
    private val telemetry: com.vectorbea.api.telemetry.TelemetryClient? = null,
    /**
     * Governance trail. Connections are the highest-value audit target in the
     * product: they are where credentials live and where a change has the widest
     * blast radius.
     */
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
    private val environmentRepo: EnvironmentRepository? = null,
) {
    private val log = LoggerFactory.getLogger(ConnectionRoutes::class.java)
    fun register(router: Router) {
        router.get("/api/connections", ::list)
        router.post("/api/connections", ::create)
        router.get("/api/connections/:id", ::getById)
        router.patch("/api/connections/:id", ::update)
        router.delete("/api/connections/:id", ::delete)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
        val typeFilter = req.query("type")
        val statusFilter = req.query("status")
        val envId = ctx.environmentId

        val cacheKey = "${CacheKeys.connectionList(ctx.workspaceId.toString(), envId?.toString() ?: "all")}:${typeFilter.orEmpty()}:${statusFilter.orEmpty()}:${params.page}:${params.pageSize}"
        // Cache the already-mapped response page (not the raw Connection objects) to
        // avoid Jackson type-erasure issues when deserializing Page<Connection> generics.
        val page = cache.getOrSet(cacheKey, ttlSeconds = 60L) {
            repo.list(ctx.workspaceId, envId, typeFilter, statusFilter, params)
                .mapItems { it.toResponse() }
        }
        return Response.ok(page)
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<CreateConnectionBody>()

        val envId = body.environment?.trim()?.takeIf { it.isNotBlank() }?.let { requested ->
            val slug = requireOneOf(
                requested, "environment", setOf("development", "staging", "production"),
            )
            environmentRepo?.findOrCreate(ctx.workspaceId, slug)?.id
                ?: throw ApiError.ServiceUnavailable("Environment repository is not available")
        } ?: ctx.requireEnvironmentId()

        val name = requireMaxLength(requireField(body.name, "name"), "name", 255)
        val type = requireOneOf(requireField(body.type, "type"), "type", CONNECTION_TYPES)
        val provider = requireMaxLength(requireField(body.provider, "provider"), "provider", 100)
        val authType = requireOneOf(requireField(body.authType, "authType"), "authType", AUTH_TYPES)
        val config = body.config ?: emptyMap()
        validateConfigJsonNotContainsSecrets(config, "config")

        val slug = slugify(body.slug?.takeIf { it.isNotBlank() } ?: name)

        // Encrypt plaintextSecret if provided — NEVER store raw secret
        val secretRef = encryptSecretIfPresent(
            plaintext = body.plaintextSecret,
            workspaceId = ctx.workspaceId,
            connectionId = null,  // connection not yet created; update after
        )

        val conn = repo.create(
            CreateConnectionRequest(
                workspaceId = ctx.workspaceId,
                environmentId = envId,
                name = name,
                slug = slug,
                type = type,
                provider = provider,
                authType = authType,
                secretRef = secretRef?.ref,
                configJson = config,
                allowedHosts = body.allowedHosts ?: emptyList(),
                allowedPaths = body.allowedPaths ?: emptyList(),
                allowedSchemas = body.allowedSchemas ?: emptyList(),
                allowedTables = body.allowedTables ?: emptyList(),
            )
        )
        invalidateListCache(ctx.workspaceId, envId)
        telemetry?.track("connection_created", "connection",
            workspaceId = ctx.workspaceId.toString(),
            connectionId = conn.id.toString(),
            appUserId = req.principal?.appUserId?.toString(),
            properties = mapOf("type" to type, "provider" to provider))
        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_CREATE,
            targetType = "connection", targetId = conn.id, environmentId = envId,
            after = mapOf("name" to conn.name, "type" to type, "provider" to provider),
        )
        return Response.created(conn.toResponse())
    }

    /**
     * What of a connection is safe and useful to keep in the audit trail.
     *
     * Explicitly enumerated rather than serialising the record: `secret_ref` and
     * `config_json` can carry credential material, and an audit trail is the last
     * place a secret should end up — it is append-only, so a leak into it cannot
     * be deleted.
     */
    private fun auditProjection(c: com.vectorbea.api.repository.Connection) = mapOf(
        "name" to c.name,
        "status" to c.status,
        "allowedHosts" to c.allowedHosts,
        "allowedPaths" to c.allowedPaths,
        "allowedSchemas" to c.allowedSchemas,
        "allowedTables" to c.allowedTables,
    )

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val conn = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Connection")
        return Response.ok(conn.toResponse())
    }

    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val body = req.bodyAs<UpdateConnectionBody>()

        // Read the prior state BEFORE mutating. "Someone changed the connection"
        // is not an audit trail; "someone changed its allowed hosts from A to B"
        // is, and after the update the previous value is gone.
        val prior = repo.findById(id, ctx.workspaceId)

        if (body.config != null) validateConfigJsonNotContainsSecrets(body.config, "config")

        // Encrypt plaintextSecret if provided on PATCH
        val secretRef = encryptSecretIfPresent(
            plaintext = body.plaintextSecret,
            workspaceId = ctx.workspaceId,
            connectionId = id,
        )

        val conn = repo.update(
            id = id,
            workspaceId = ctx.workspaceId,
            name = body.name?.trim()?.takeIf { it.isNotBlank() },
            configJson = body.config,
            allowedHosts = body.allowedHosts,
            allowedPaths = body.allowedPaths,
            allowedSchemas = body.allowedSchemas,
            allowedTables = body.allowedTables,
            status = body.status,
            secretRef = secretRef?.ref,
        ) ?: throw ApiError.NotFound("Connection")

        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_UPDATE,
            targetType = "connection", targetId = id, environmentId = conn.environmentId,
            before = prior?.let { auditProjection(it) },
            after = auditProjection(conn),
        )

        if (secretRef != null) {
            cache.del(CacheKeys.connectionTest(ctx.workspaceId.toString(), id.toString()))
        }
        invalidateListCache(ctx.workspaceId, conn.environmentId)
        return Response.ok(conn.toResponse())
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Connection")
        repo.delete(id, ctx.workspaceId)
        invalidateListCache(ctx.workspaceId, existing.environmentId)
        // `before` only — there is no after. The shape of the record is what makes
        // "what was deleted, and by whom" answerable a year later, when the row
        // itself is long gone. Secrets are not in the projection.
        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_DELETE,
            targetType = "connection", targetId = id,
            environmentId = existing.environmentId,
            before = mapOf(
                "name" to existing.name, "type" to existing.type,
                "provider" to existing.provider, "status" to existing.status,
            ),
        )
        return Response.noContent()
    }

    /**
     * Encrypt a plaintext secret if provided.
     * Returns null if no plaintext was supplied.
     * Throws [ApiError.ServiceUnavailable] if service not configured but plaintext is given.
     *
     * SECURITY: [plaintext] is NEVER logged or returned.
     */
    private fun encryptSecretIfPresent(
        plaintext: String?,
        workspaceId: java.util.UUID,
        connectionId: java.util.UUID?,
    ): com.vectorbea.api.secrets.SecretRef? {
        val trimmed = plaintext?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val svc = secretService
            ?: throw ApiError.ServiceUnavailable("Secret service not configured — cannot store secret")
        return try {
            svc.createSecret(workspaceId, connectionId, trimmed)
        } catch (e: SecretServiceUnavailableException) {
            throw ApiError.ServiceUnavailable("Secret service unavailable — SECRET_ENCRYPTION_KEY not set")
        }
    }

    private fun invalidateListCache(workspaceId: java.util.UUID, environmentId: java.util.UUID) {
        // Use prefix deletion because the actual cache key appends filter and pagination
        // params (":type:status:page:pageSize") that the invalidation site doesn't know.
        // Pattern: connections:list:{workspaceId}:* — clears all env/filter/page combos.
        cache.delByPrefix(CacheKeys.connectionList(workspaceId.toString(), "").dropLast(1))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
