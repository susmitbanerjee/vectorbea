package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.entitlements.ApiKeyService
import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Managing a workspace's API keys, and reading spend by member.
 *
 * ── WHY THESE TWO LIVE TOGETHER ─────────────────────────────────────────────
 * They are the two halves of the same question: who is spending this
 * workspace's allowance, and through what. A key and a guest are both actors
 * with a budget, and an owner investigating a surprise bill wants one screen,
 * not two.
 */
class ApiKeyRoutes(
    private val ds: DataSource,
    private val keys: ApiKeyService,
    private val guard: EntitlementGuard,
    /**
     * The audit trail.
     *
     * A key is a credential with a budget attached, so every change to one is a
     * security event: who minted it, who rotated it, who widened its limit and
     * when. Null degrades to no trail rather than refusing the action — losing
     * an audit row must never lose a customer's ability to rotate a leaked key.
     */
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
) {
    private val log = LoggerFactory.getLogger(ApiKeyRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/api-keys", ::list)
        router.post("/api/api-keys", ::create)
        router.delete("/api/api-keys/:id", ::revoke)
        router.post("/api/api-keys/:id/rotate", ::rotate)
        router.put("/api/api-keys/:id/rate-limit", ::setRateLimit)

        router.get("/api/workspaces/spend-by-member", ::spendByMember)
        router.put("/api/workspaces/member-budget/:userId", ::setMemberBudget)
    }

    // ── Rotation and per-key limits ───────────────────────────────────

    /**
     * Replace a key, keeping the old one alive for a bounded window.
     *
     * ── WHY NOT "REVOKE AND CREATE" ────────────────────────────────
     * Because that is an outage. Between the revoke and the new key reaching
     * every deployment that uses it, every request from those deployments fails
     * — and "rotate your keys regularly" is advice nobody follows twice after
     * that happens once.
     *
     * The overlap is bounded, because an unbounded one is not rotation. The
     * response says exactly when the old key stops working, so the deadline is
     * something the operator planned for rather than discovered.
     */
    private fun rotate(req: Request): Response {
        val ctx = req.context()
        val keyId = req.pathUUID("id")
        val graceSeconds = req.query("graceSeconds")?.toLongOrNull()
            ?.coerceIn(0L, 7L * 24 * 60 * 60)

        val created = (if (graceSeconds != null)
            keys.rotate(ctx.workspaceId, keyId, req.principal?.appUserId, graceSeconds)
        else
            keys.rotate(ctx.workspaceId, keyId, req.principal?.appUserId))
            ?: throw ApiError.NotFound("API key")

        audit?.recordUserAction(
            req = req, workspaceId = ctx.workspaceId,
            action = "api_key.rotate", targetType = "api_key", targetId = keyId,
            after = mapOf("newKeyId" to created.id.toString(), "graceSeconds" to graceSeconds),
        )

        log.info("[apikey] {} rotated by {}", keyId, req.principal?.appUserId)
        return Response.ok(mapOf(
            "id" to created.id.toString(),
            "name" to created.name,
            "prefix" to created.prefix,
            /* The secret, once. Same contract as create: it is in this response
               and nowhere else, ever again. */
            "key" to created.secret,
            "rotatedFrom" to keyId.toString(),
            "message" to "The previous key keeps working for " +
                "${(graceSeconds ?: 86_400L) / 3600} hours. Deploy this one before then.",
        ))
    }

    /**
     * Give one key its own ceiling.
     *
     * Clamped to the plan's limit inside the service, so this cannot be a way to
     * buy throughput by adding keys — it can only ever narrow.
     */
    private fun setRateLimit(req: Request): Response {
        val ctx = req.context()
        val keyId = req.pathUUID("id")

        data class Body(val perMinute: Int? = null)
        val body = if (req.body.isBlank()) Body() else req.bodyAs<Body>()

        if (!keys.setRateLimit(ctx.workspaceId, keyId, body.perMinute)) {
            throw ApiError.NotFound("API key")
        }

        audit?.recordUserAction(
            req = req, workspaceId = ctx.workspaceId,
            action = "api_key.rate_limit", targetType = "api_key", targetId = keyId,
            after = mapOf("perMinute" to body.perMinute),
        )

        return Response.ok(mapOf(
            "id" to keyId.toString(),
            "rateLimitPerMinute" to body.perMinute,
            "planCeiling" to keys.rateLimitPerMinute(ctx.workspaceId),
            "message" to if (body.perMinute == null)
                "This key now uses the workspace's plan limit."
            else
                "This key is limited to ${body.perMinute} requests per minute.",
        ))
    }

    // ── Keys ──────────────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        return Response.ok(mapOf(
            "keys" to keys.list(ctx.workspaceId),
            "limit" to guard.resolve(ctx.workspaceId).limit(
                com.vectorbea.api.entitlements.EntitlementKeys.MAX_API_KEYS),
            "used" to guard.apiKeyCount(ctx.workspaceId),
            "rateLimitPerMinute" to keys.rateLimitPerMinute(ctx.workspaceId),
        ))
    }

    /**
     * Mint a key. The secret is in this response and nowhere else, ever again.
     *
     * ── THE KEY ACTS AS ITS CREATOR BY DEFAULT ──────────────────────────────
     * Which is the part that closes the exploit. If a key were simply "the
     * workspace", a guest capped at 250k tokens could mint one and spend the
     * host's whole month through it. Because the key inherits its creator's
     * identity, its runs are charged to that creator's member cap — minting a
     * key gets you a different door into the same budget, not a bigger budget.
     *
     * An admin may pass `actsAs: null` for an unattributed service key. That is
     * a deliberate privilege and it is why this route needs the admin floor.
     */
    private fun create(req: Request): Response {
        val ctx = req.context()
        val principal = req.principal

        data class Body(val name: String?, val actsAs: String?, val expiresAt: String?)
        val body = try { req.bodyAs<Body>() }
        catch (e: Exception) { throw ApiError.ValidationError("Invalid JSON body: ${e.message}") }

        val name = body.name?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw ApiError.ValidationError("'name' is required — a key nobody can identify is a key nobody will revoke")

        /* Default to the creator. `actsAs: null` explicitly means an
           unattributed key and is only reachable here because the route already
           requires an admin. */
        val actsAs = when {
            body.actsAs == null -> principal?.appUserId
            body.actsAs.isBlank() -> null
            else -> runCatching { UUID.fromString(body.actsAs) }.getOrNull()
                ?: throw ApiError.ValidationError("'actsAs' must be a user id")
        }

        // A key may only act as somebody who is actually in this workspace.
        // Without this an admin could mint a key attributed to a member of
        // another workspace, and that member's cap would absorb spend they never
        // caused.
        if (actsAs != null && !isMember(ctx.workspaceId, actsAs)) {
            throw ApiError.ValidationError("'actsAs' must be an active member of this workspace")
        }

        val expiresAt = body.expiresAt?.let {
            runCatching { Instant.parse(it) }.getOrNull()
                ?: throw ApiError.ValidationError("'expiresAt' must be an ISO-8601 instant")
        }

        val created = keys.create(
            workspaceId = ctx.workspaceId,
            name = name,
            createdByUserId = principal?.appUserId,
            actsAsUserId = actsAs,
            expiresAt = expiresAt,
        )

        log.info("[apikey] workspace {} minted key {}", ctx.workspaceId, created.id)
        return Response(
            status = 201,
            body = toJson(mapOf(
                "id" to created.id.toString(),
                "name" to created.name,
                "prefix" to created.prefix,
                /* The one and only time. Named `secret` rather than `key` so a
                   client logging the whole response is at least obvious about
                   what it just wrote to disk. */
                "secret" to created.secret,
                "expiresAt" to created.expiresAt?.toString(),
                "message" to "Copy this key now. It cannot be shown again.",
            )),
            headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
        )
    }

    private fun revoke(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val done = keys.revoke(ctx.workspaceId, id, req.principal?.appUserId)
        // 404 rather than 409 for an already-revoked key: from the caller's side
        // "this key is not live in this workspace" is one fact, and revocation is
        // idempotent by design.
        if (!done) throw ApiError.NotFound("API key")
        log.info("[apikey] workspace {} revoked key {}", ctx.workspaceId, id)
        return Response.noContent()
    }

    // ── Spend by member ───────────────────────────────────────────────────────

    /**
     * Who is spending this workspace's allowance (§4's visibility half).
     *
     * A cap without a view is a support ticket waiting to happen: the owner gets
     * a refusal from somebody else's run and has no way to see why. This is the
     * screen that answers it.
     */
    private fun spendByMember(req: Request): Response {
        val ctx = req.context()
        val rows = ds.connection.use { c ->
            c.prepareStatement(
                "SELECT user_id, email, tokens, runs, cap FROM workspace_spend_by_member(?)"
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            val cap = rs.getLong("cap")
                            val tokens = rs.getLong("tokens")
                            add(mapOf(
                                "userId" to rs.getObject("user_id", UUID::class.java).toString(),
                                "email" to rs.getString("email"),
                                "tokens" to tokens,
                                "runs" to rs.getLong("runs"),
                                "cap" to if (cap < 0) null else cap,
                                "capped" to (cap >= 0 && tokens >= cap),
                            ))
                        }
                    }
                }
            }
        }
        return Response.ok(mapOf("members" to rows, "period" to periodOf(ctx.workspaceId)))
    }

    /**
     * Set one member's token budget in this workspace.
     *
     * Never raises the workspace or account ceiling — those are checked
     * separately and first, so granting a contractor "unlimited" gives them the
     * workspace's remaining allowance and not a penny more. Said in the response
     * so an owner does not believe they have bought capacity by typing a number.
     */
    private fun setMemberBudget(req: Request): Response {
        val ctx = req.context()
        val userId = req.pathUUID("userId")

        data class Body(val tokensPerMonth: Long?, val reason: String?)
        val body = try { req.bodyAs<Body>() }
        catch (e: Exception) { throw ApiError.ValidationError("Invalid JSON body: ${e.message}") }

        val tokens = body.tokensPerMonth
            ?: throw ApiError.ValidationError("'tokensPerMonth' is required (-1 for no separate cap)")
        if (tokens < -1) throw ApiError.ValidationError("'tokensPerMonth' must be -1 or a positive number")

        if (!isMember(ctx.workspaceId, userId)) throw ApiError.NotFound("Member")

        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO workspace_member_budgets
                     (workspace_id, user_id, tokens_per_month, reason, set_by_user_id)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (workspace_id, user_id) DO UPDATE
                     SET tokens_per_month = EXCLUDED.tokens_per_month,
                         reason = EXCLUDED.reason,
                         set_by_user_id = EXCLUDED.set_by_user_id,
                         updated_at = now()"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setObject(2, userId)
                st.setLong(3, tokens)
                st.setString(4, body.reason)
                st.setObject(5, req.principal?.appUserId)
                st.executeUpdate()
            }
        }

        return Response.ok(mapOf(
            "userId" to userId.toString(),
            "tokensPerMonth" to tokens,
            "used" to guard.memberUsage(ctx.workspaceId, userId),
            "note" to "A member budget divides this workspace's allowance. It does not add to it.",
        ))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun isMember(workspaceId: UUID, userId: UUID): Boolean =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT 1 FROM workspace_members
                    WHERE workspace_id = ? AND user_id = ? AND status = 'active' LIMIT 1"""
            ).use { st ->
                st.setObject(1, workspaceId); st.setObject(2, userId)
                st.executeQuery().use { rs -> rs.next() }
            }
        }

    private fun periodOf(workspaceId: UUID): Map<String, Any?> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT p.period_start, p.period_end
                     FROM workspaces w, LATERAL account_current_period(w.billing_account_id) p
                    WHERE w.id = ?"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) emptyMap()
                    else mapOf(
                        "start" to rs.getTimestamp(1).toInstant().toString(),
                        "end" to rs.getTimestamp(2).toInstant().toString(),
                    )
                }
            }
        }
}
