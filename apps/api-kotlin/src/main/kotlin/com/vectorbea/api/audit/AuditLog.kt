package com.vectorbea.api.audit

import com.vectorbea.api.auth.AuthPrincipal
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.util.UUID
import javax.sql.DataSource

/**
 * The governance trail (§4.4, P20).
 *
 * APPEND ONLY, AND THERE IS NO WRITE-DOWN PATH
 * --------------------------------------------
 * This class exposes exactly one verb: [record]. No update, no delete, no
 * "correct an entry". A correction is a new entry.
 *
 * That is enforced twice on purpose. Here, by having no other method — so a
 * future refactor cannot casually add one. And in the database, by triggers that
 * refuse UPDATE and DELETE outright, because "the application layer has no delete
 * path" is a promise about code and an enterprise buyer is asking about data.
 * A rule enforced only in code is one merge away from being untrue.
 *
 * BEFORE AND AFTER, NOT JUST AFTER
 * --------------------------------
 * "Someone changed the workspace settings" is not an audit trail. "Someone
 * changed max_concurrent_runs from 2 to 50 at 14:02" is. Every config change
 * carries both sides; that is what makes the log answer questions rather than
 * merely prove that something happened.
 *
 * WHAT IS DELIBERATELY NOT STORED
 * -------------------------------
 * The raw IP. It is hashed. An audit trail that accumulates personal data becomes
 * a second thing with its own retention obligation and its own breach
 * consequences — and "which IP" is almost never the question, while "was this the
 * same client as last time" is, and a hash answers that.
 */
class AuditLog(private val dataSource: DataSource?) {

    private val log = LoggerFactory.getLogger(AuditLog::class.java)

    /**
     * The actions worth recording.
     *
     * An enum rather than free strings so the set is greppable and the P20 filter
     * has something finite to offer. Dotted `noun.verb`, matching §4.4.
     */
    object Action {
        // Auth
        const val LOGIN = "auth.login"
        const val LOGOUT = "auth.logout"
        const val LOGIN_FAILED = "auth.login_failed"

        // Workflows
        const val WORKFLOW_PUBLISH = "workflow.publish"
        const val WORKFLOW_UPDATE = "workflow.update"
        const val WORKFLOW_ARCHIVE = "workflow.archive"
        const val WORKFLOW_DELETE = "workflow.delete"

        // Approvals — who decided what, and why
        const val APPROVAL_DECIDE = "approval.decide"

        // Connections — the blast-radius surface
        const val CONNECTION_CREATE = "connection.create"
        const val CONNECTION_UPDATE = "connection.update"
        const val CONNECTION_DELETE = "connection.delete"
        const val CONNECTION_TEST = "connection.test"

        // Tools — a test message is a real post in somebody's channel
        const val TOOL_TEST_MESSAGE = "tool.test_message"

        // Membership
        const val MEMBER_INVITE = "member.invite"
        const val MEMBER_ROLE_CHANGE = "member.role_change"
        const val MEMBER_REMOVE = "member.remove"

        // Settings and policy
        const val SETTINGS_UPDATE = "settings.update"
        const val LIMIT_OVERRIDE = "limit.override"

        // Destructive run operations
        const val RUN_CANCEL = "run.cancel"
        const val RUN_RERUN = "run.rerun"
        const val DATA_EXPORT = "data.export"
        const val DATA_DELETE = "data.delete"
    }

    object Result {
        const val SUCCESS = "success"
        /** The actor was refused. Denials matter more than successes in an audit. */
        const val DENIED = "denied"
        const val ERROR = "error"
    }

    /**
     * Append one entry.
     *
     * Never throws. An audit write failing must not fail the action it is
     * auditing — refusing a member's login because the log is unavailable turns a
     * governance feature into an outage. The failure is logged at ERROR, not WARN,
     * because a gap in an audit trail is a compliance problem even when it is
     * invisible.
     *
     * The corollary is that this log is not a transactional guarantee: it records
     * what the application did, on a best-effort basis. Where a true guarantee is
     * needed — approval decisions, most obviously — the authoritative record is
     * the domain table (`run_approvals.resolved_by`), and this is the searchable
     * index over it.
     */
    fun record(
        workspaceId: UUID,
        action: String,
        targetType: String,
        targetId: UUID? = null,
        environmentId: UUID? = null,
        actorType: String = "user",
        actorId: String? = null,
        before: Any? = null,
        after: Any? = null,
        result: String = Result.SUCCESS,
        request: Request? = null,
    ) {
        val ds = dataSource ?: return
        try {
            ds.connection.use { conn ->
                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setObject(2, environmentId)
                    stmt.setString(3, actorType)
                    stmt.setString(4, actorId)
                    stmt.setString(5, action)
                    stmt.setString(6, targetType)
                    stmt.setObject(7, targetId)
                    stmt.setString(8, before?.let { runCatching { toJson(it) }.getOrNull() })
                    stmt.setString(9, after?.let { runCatching { toJson(it) }.getOrNull() })
                    stmt.setString(10, request?.let { hashIp(clientIp(it)) })
                    stmt.setString(11, request?.header("user-agent")?.take(500))
                    stmt.setString(12, result)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.error("[audit] FAILED to record {} on {} for workspace {}: {} — " +
                "this is a gap in the audit trail", action, targetType, workspaceId, e.message)
        }
    }

    /** Convenience for the common case: an authenticated user acting on a resource. */
    fun recordUserAction(
        req: Request,
        workspaceId: UUID,
        action: String,
        targetType: String,
        targetId: UUID? = null,
        environmentId: UUID? = null,
        before: Any? = null,
        after: Any? = null,
        result: String = Result.SUCCESS,
    ) = record(
        workspaceId = workspaceId,
        action = action,
        targetType = targetType,
        targetId = targetId,
        environmentId = environmentId,
        actorType = if (req.principal == null) "system" else "user",
        actorId = req.principal?.appUserId?.toString(),
        before = before,
        after = after,
        result = result,
        request = req,
    )

    /**
     * Client IP, preferring the proxy header.
     *
     * `X-Forwarded-For` is client-controlled and therefore untrustworthy as
     * identity — but it is only ever hashed and used for correlation here, never
     * for authorisation, so a forged value costs nothing more than a useless
     * correlation key.
     */
    private fun clientIp(req: Request): String? =
        req.header("x-forwarded-for")?.substringBefore(',')?.trim()
            ?: req.header("x-real-ip")

    private fun hashIp(ip: String?): String? {
        if (ip.isNullOrBlank()) return null
        // Salted with a deployment secret where available, so the hashes are not
        // reversible with a rainbow table of the IPv4 space — which is small
        // enough to enumerate exhaustively, making an unsalted hash of an IP
        // barely better than storing it.
        val salt = System.getenv("AUDIT_IP_SALT") ?: "vectorbea-audit"
        val digest = MessageDigest.getInstance("SHA-256").digest("$salt:$ip".toByteArray())
        return digest.joinToString("") { "%02x".format(it) }.take(32)
    }

    private companion object {
        val INSERT_SQL = """
            INSERT INTO audit_log (
                workspace_id, environment_id, actor_type, actor_id,
                action, target_type, target_id,
                before_json, after_json, ip_hash, user_agent, result
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)
        """.trimIndent()
    }
}
