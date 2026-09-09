package com.vectorbea.api.webhook

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.repository.BaseRepository
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.PageParams
import org.slf4j.LoggerFactory
import java.security.SecureRandom
import java.sql.ResultSet
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.sql.DataSource

/** A per-workflow webhook endpoint. */
data class Webhook(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID,
    val name: String,
    /**
     * The public address.
     *
     * Never logged and never returned in a list response — only on create, and
     * only once. A webhook URL is pasted into a third party's console, so it is
     * a bearer credential for "may enqueue work in this workspace" even with a
     * signature on top.
     */
    val token: String,
    val signatureScheme: String,
    val signingSecretRef: String?,
    val signatureHeader: String?,
    val timestampHeader: String?,
    val toleranceSeconds: Int,
    val inputMapping: Map<String, String>,
    val eventTypePath: String?,
    val eventTypes: List<String>,
    val dedupeHeader: String?,
    val dedupePath: String?,
    val enabled: Boolean,
    val createdAt: Instant,
)

/** One delivery, accepted or not. */
data class WebhookDelivery(
    val id: UUID,
    val webhookId: UUID,
    val workspaceId: UUID,
    val receivedAt: Instant,
    val outcome: String,
    val detail: String?,
    val headers: Map<String, Any?>,
    val bodyText: String?,
    val bodyBytes: Int,
    val dedupeKey: String?,
    val eventType: String?,
    val runId: UUID?,
    val replayOfId: UUID?,
)

open class WebhookRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WebhookRepository::class.java)

    private val mapper = ObjectMapper()

    companion object {
        /**
         * Bodies over this are truncated in the delivery log.
         *
         * A delivery log is a debugging surface, not a payload store — a 5 MB
         * body stored per delivery per webhook is a table nobody can query and a
         * retention bill nobody chose. 64 KB is enough to see the shape, and the
         * marker says something was cut so nobody debugs a truncation as a
         * malformed payload.
         */
        const val MAX_STORED_BODY = 64 * 1024

        /**
         * 32 bytes of URL-safe randomness.
         *
         * Not derived from the workflow id, unlike almost every other key in this
         * system: this one is pasted into a third party's console and rotating it
         * has to produce a genuinely different address. A derived token could
         * only be rotated by changing what it is derived from.
         */
        fun mintToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return "whk_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        }
    }

    // ── Endpoints ────────────────────────────────────────────────────────────

    /**
     * Find by token, for the public delivery path.
     *
     * NOT workspace-scoped, and it cannot be: the sender has no workspace. The
     * token IS the scope, which is why it is 32 random bytes and why the row it
     * finds carries the workspace that everything downstream is scoped to.
     */
    open fun findByToken(token: String): Webhook? = queryOne(
        "SELECT $COLUMNS FROM workflow_webhooks WHERE token = ?",
        { setString(1, token) }, ::mapWebhook)

    open fun findById(id: UUID, workspaceId: UUID): Webhook? = queryOne(
        "SELECT $COLUMNS FROM workflow_webhooks WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) }, ::mapWebhook)

    open fun listForWorkspace(workspaceId: UUID, workflowId: UUID? = null): List<Webhook> = query(
        """SELECT $COLUMNS FROM workflow_webhooks
            WHERE workspace_id = ? AND (?::uuid IS NULL OR workflow_id = ?::uuid)
            ORDER BY created_at DESC""",
        { setUuid(1, workspaceId); setUuidOrNull(2, workflowId); setUuidOrNull(3, workflowId) },
        ::mapWebhook)

    open fun create(
        workspaceId: UUID,
        environmentId: UUID,
        workflowId: UUID,
        name: String,
        signatureScheme: String,
        signingSecretRef: String?,
        signatureHeader: String?,
        timestampHeader: String?,
        toleranceSeconds: Int,
        inputMapping: Map<String, String>,
        eventTypePath: String?,
        eventTypes: List<String>,
        dedupeHeader: String?,
        dedupePath: String?,
        createdByUserId: UUID?,
    ): Webhook = executeReturning(
        """INSERT INTO workflow_webhooks
             (workspace_id, environment_id, workflow_id, name, token, signature_scheme,
              signing_secret_ref, signature_header, timestamp_header, tolerance_seconds,
              input_mapping, event_type_path, event_types, dedupe_header, dedupe_path,
              created_by_user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?)
           RETURNING $COLUMNS""",
        {
            setUuid(1, workspaceId); setUuid(2, environmentId); setUuid(3, workflowId)
            setString(4, name); setString(5, mintToken()); setString(6, signatureScheme)
            setString(7, signingSecretRef); setString(8, signatureHeader)
            setString(9, timestampHeader); setInt(10, toleranceSeconds)
            setString(11, mapper.writeValueAsString(inputMapping))
            setString(12, eventTypePath)
            setArray(13, connectionArray(eventTypes))
            setString(14, dedupeHeader); setString(15, dedupePath)
            setUuidOrNull(16, createdByUserId)
        }, ::mapWebhook)

    open fun setEnabled(id: UUID, workspaceId: UUID, enabled: Boolean): Boolean = execute(
        "UPDATE workflow_webhooks SET enabled = ?, updated_at = now() " +
            "WHERE id = ? AND workspace_id = ?",
        { setBoolean(1, enabled); setUuid(2, id); setUuid(3, workspaceId) }) > 0

    open fun delete(id: UUID, workspaceId: UUID): Boolean = execute(
        "DELETE FROM workflow_webhooks WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) }) > 0

    /** Replace the token. The old URL stops working immediately — that is the point. */
    open fun rotateToken(id: UUID, workspaceId: UUID): String? {
        val token = mintToken()
        val updated = execute(
            "UPDATE workflow_webhooks SET token = ?, updated_at = now() " +
                "WHERE id = ? AND workspace_id = ?",
            { setString(1, token); setUuid(2, id); setUuid(3, workspaceId) })
        return if (updated > 0) token else null
    }

    // ── Deliveries ───────────────────────────────────────────────────────────

    /**
     * Record a delivery.
     *
     * ── EVERY DELIVERY, NOT EVERY ACCEPTED ONE ──────────────────────────────
     * "The webhook does not work" has four completely different causes — the
     * sender never called, the signature failed, the filter excluded it, or the
     * mapping produced nothing — and from outside they are indistinguishable:
     * no run. The rejected rows are the valuable ones.
     *
     * Returns null when the insert hit the dedup constraint, which the caller
     * reads as "already delivered" — the dedup check and the write are the same
     * statement, so two concurrent redeliveries cannot both pass.
     */
    open fun recordDelivery(
        webhookId: UUID,
        workspaceId: UUID,
        outcome: String,
        detail: String?,
        headers: Map<String, String>,
        body: String?,
        dedupeKey: String?,
        eventType: String?,
        runId: UUID?,
        replayOfId: UUID? = null,
        replayedByUserId: UUID? = null,
    ): UUID? = queryOne(
        """INSERT INTO webhook_deliveries
             (webhook_id, workspace_id, outcome, detail, headers_json, body_text,
              body_bytes, dedupe_key, event_type, run_id, replay_of_id, replayed_by_user_id)
           VALUES (?,?,?,?,?::jsonb,?,?,?,?,?,?,?)
           ON CONFLICT DO NOTHING
           RETURNING id""",
        {
            setUuid(1, webhookId); setUuid(2, workspaceId)
            setString(3, outcome); setString(4, detail?.take(1_000))
            setString(5, mapper.writeValueAsString(headers))
            setString(6, body?.take(MAX_STORED_BODY))
            setInt(7, body?.toByteArray()?.size ?: 0)
            setString(8, dedupeKey?.take(500)); setString(9, eventType?.take(200))
            setUuidOrNull(10, runId); setUuidOrNull(11, replayOfId)
            setUuidOrNull(12, replayedByUserId)
        }) { rs -> rs.uuid("id") }

    /** Attach the run once the ingress has produced one. */
    open fun attachRun(deliveryId: UUID, runId: UUID) {
        execute("UPDATE webhook_deliveries SET run_id = ? WHERE id = ?") {
            setUuid(1, runId); setUuid(2, deliveryId)
        }
    }

    open fun listDeliveries(
        webhookId: UUID,
        workspaceId: UUID,
        params: PageParams,
        outcome: String? = null,
    ): Page<WebhookDelivery> = queryPage(
        sql = """SELECT $DELIVERY_COLUMNS FROM webhook_deliveries
                  WHERE webhook_id = ? AND workspace_id = ?
                    AND (?::text IS NULL OR outcome = ?::text)
                  ORDER BY received_at DESC""",
        countSql = """SELECT count(*) FROM webhook_deliveries
                       WHERE webhook_id = ? AND workspace_id = ?
                         AND (?::text IS NULL OR outcome = ?::text)""",
        params = params,
        bind = {
            setUuid(1, webhookId); setUuid(2, workspaceId)
            setString(3, outcome); setString(4, outcome)
        },
        mapRow = ::mapDelivery)

    open fun findDelivery(id: UUID, workspaceId: UUID): WebhookDelivery? = queryOne(
        "SELECT $DELIVERY_COLUMNS FROM webhook_deliveries WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) }, ::mapDelivery)

    // ── Mapping ──────────────────────────────────────────────────────────────

    private fun mapWebhook(rs: ResultSet) = Webhook(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        workflowId = rs.uuid("workflow_id"),
        name = rs.getString("name"),
        token = rs.getString("token"),
        signatureScheme = rs.getString("signature_scheme"),
        signingSecretRef = rs.getString("signing_secret_ref"),
        signatureHeader = rs.getString("signature_header"),
        timestampHeader = rs.getString("timestamp_header"),
        toleranceSeconds = rs.getInt("tolerance_seconds"),
        inputMapping = readStringMap(rs.getString("input_mapping")),
        eventTypePath = rs.getString("event_type_path"),
        eventTypes = readTextArray(rs, "event_types"),
        dedupeHeader = rs.getString("dedupe_header"),
        dedupePath = rs.getString("dedupe_path"),
        enabled = rs.getBoolean("enabled"),
        createdAt = rs.instantOrNull("created_at") ?: Instant.EPOCH,
    )

    private fun mapDelivery(rs: ResultSet) = WebhookDelivery(
        id = rs.uuid("id"),
        webhookId = rs.uuid("webhook_id"),
        workspaceId = rs.uuid("workspace_id"),
        receivedAt = rs.instantOrNull("received_at") ?: Instant.EPOCH,
        outcome = rs.getString("outcome"),
        detail = rs.getString("detail"),
        headers = readAnyMap(rs.getString("headers_json")),
        bodyText = rs.getString("body_text"),
        bodyBytes = rs.getInt("body_bytes"),
        dedupeKey = rs.getString("dedupe_key"),
        eventType = rs.getString("event_type"),
        runId = rs.uuidOrNull("run_id"),
        replayOfId = rs.uuidOrNull("replay_of_id"),
    )

    @Suppress("UNCHECKED_CAST")
    private fun readStringMap(raw: String?): Map<String, String> = runCatching {
        if (raw.isNullOrBlank()) emptyMap()
        else (mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            .mapNotNull { (k, v) -> v?.let { k.toString() to it.toString() } }.toMap()
    }.getOrDefault(emptyMap())

    @Suppress("UNCHECKED_CAST")
    private fun readAnyMap(raw: String?): Map<String, Any?> = runCatching {
        if (raw.isNullOrBlank()) emptyMap()
        else mapper.readValue(raw, Map::class.java) as Map<String, Any?>
    }.getOrDefault(emptyMap())

    private fun readTextArray(rs: ResultSet, col: String): List<String> = runCatching {
        (rs.getArray(col)?.array as? Array<*>)?.mapNotNull { it?.toString() } ?: emptyList()
    }.getOrDefault(emptyList())

    /**
     * A `text[]` bound through the driver rather than built into the SQL.
     *
     * String-concatenating an array literal is how an event type containing a
     * comma or a quote becomes an injection, and event types are caller-supplied.
     */
    private fun java.sql.PreparedStatement.setArray(index: Int, values: List<String>) {
        setArray(index, connection.createArrayOf("text", values.toTypedArray()))
    }

    private fun connectionArray(values: List<String>): List<String> = values
}

private const val COLUMNS = """
    id, workspace_id, environment_id, workflow_id, name, token, signature_scheme,
    signing_secret_ref, signature_header, timestamp_header, tolerance_seconds,
    input_mapping, event_type_path, event_types, dedupe_header, dedupe_path,
    enabled, created_at"""

private const val DELIVERY_COLUMNS = """
    id, webhook_id, workspace_id, received_at, outcome, detail, headers_json,
    body_text, body_bytes, dedupe_key, event_type, run_id, replay_of_id"""
