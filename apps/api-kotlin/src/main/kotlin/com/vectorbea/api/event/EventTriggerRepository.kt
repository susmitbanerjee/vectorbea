package com.vectorbea.api.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** A subscription to a broker the customer already runs. */
data class EventTrigger(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID,
    val name: String,
    /** kafka | sqs | pubsub */
    val broker: String,
    /** Where the credentials live. Never inline — same rule as every other secret. */
    val connectionId: UUID?,
    /** Kafka: topic. SQS: queue URL. Pub/Sub: subscription. */
    val source: String,
    val consumerGroup: String?,
    val inputMapping: Map<String, String>,
    val filterPath: String?,
    val filterValues: List<String>,
    val dedupePath: String?,
    /**
     * The path naming the THING the run works, not the message that reported it.
     *
     * `dedupePath` deduplicates a broker REDELIVERY of one message. This
     * deduplicates the WORK: two different messages about the same service would
     * otherwise start two runs. What happens instead is `workflows.dedup_policy`.
     */
    val runDedupPath: String? = null,
    /** 0–100, or null to take the workflow's default. */
    val runPriority: Short? = null,
    val maxInFlight: Int,
    val batchSize: Int,
    val enabled: Boolean,
    val disabledReason: String?,
    val lastError: String?,
    val lastMessageAt: Instant?,
    val messagesConsumed: Long,
    val createdAt: Instant,
)

open class EventTriggerRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(EventTriggerRepository::class.java)

    private val mapper = ObjectMapper()

    /**
     * Every trigger a consumer should be running.
     *
     * `disabled_reason IS NULL` as well as `enabled`: a trigger the runner
     * disabled itself — bad credentials, a topic that does not exist — must not
     * be picked straight back up on the next sweep. Clearing the reason is what
     * re-enables it, and that is a person's decision.
     */
    open fun listRunnable(): List<EventTrigger> = query(
        "SELECT $COLUMNS FROM event_triggers WHERE enabled AND disabled_reason IS NULL " +
            "ORDER BY created_at",
        {}, ::map)

    open fun listForWorkspace(workspaceId: UUID): List<EventTrigger> = query(
        "SELECT $COLUMNS FROM event_triggers WHERE workspace_id = ? ORDER BY created_at DESC",
        { setUuid(1, workspaceId) }, ::map)

    open fun findById(id: UUID, workspaceId: UUID): EventTrigger? = queryOne(
        "SELECT $COLUMNS FROM event_triggers WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) }, ::map)

    open fun create(
        workspaceId: UUID, environmentId: UUID, workflowId: UUID,
        name: String, broker: String, connectionId: UUID?, source: String,
        consumerGroup: String?, inputMapping: Map<String, String>,
        filterPath: String?, filterValues: List<String>, dedupePath: String?,
        runDedupPath: String?, runPriority: Short?,
        maxInFlight: Int, batchSize: Int, createdByUserId: UUID?,
    ): EventTrigger = executeReturning(
        """INSERT INTO event_triggers
             (workspace_id, environment_id, workflow_id, name, broker, connection_id,
              source, consumer_group, input_mapping, filter_path, filter_values,
              dedupe_path, run_dedup_path, run_priority,
              max_in_flight, batch_size, created_by_user_id)
           VALUES (?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?)
           RETURNING $COLUMNS""",
        {
            setUuid(1, workspaceId); setUuid(2, environmentId); setUuid(3, workflowId)
            setString(4, name); setString(5, broker); setUuidOrNull(6, connectionId)
            setString(7, source); setString(8, consumerGroup)
            setString(9, mapper.writeValueAsString(inputMapping))
            setString(10, filterPath)
            setArray(11, connection.createArrayOf("text", filterValues.toTypedArray()))
            setString(12, dedupePath)
            setString(13, runDedupPath)
            if (runPriority != null) setShort(14, runPriority)
            else setNull(14, java.sql.Types.SMALLINT)
            setInt(15, maxInFlight.coerceIn(1, 1_000))
            setInt(16, batchSize.coerceIn(1, 100))
            setUuidOrNull(17, createdByUserId)
        }, ::map)

    open fun setEnabled(id: UUID, workspaceId: UUID, enabled: Boolean): Boolean = execute(
        /* Enabling also clears whatever the runner refused it for. Leaving the
           reason set would make the toggle appear to work and change nothing —
           `listRunnable` would keep skipping it. */
        "UPDATE event_triggers SET enabled = ?, updated_at = now(), " +
            "disabled_reason = CASE WHEN ? THEN NULL ELSE disabled_reason END " +
            "WHERE id = ? AND workspace_id = ?",
        {
            setBoolean(1, enabled); setBoolean(2, enabled)
            setUuid(3, id); setUuid(4, workspaceId)
        }) > 0

    open fun delete(id: UUID, workspaceId: UUID): Boolean = execute(
        "DELETE FROM event_triggers WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) }) > 0

    /**
     * Stop consuming, and say why.
     *
     * Called by the runner for a failure that will not fix itself — bad
     * credentials, a topic that does not exist. The alternative is a loop that
     * fails forever in a log nobody reads, and a customer whose events silently
     * never arrive.
     */
    open fun disableWithReason(id: UUID, reason: String) {
        execute("UPDATE event_triggers SET enabled = false, disabled_reason = ?, " +
            "last_error = ?, updated_at = now() WHERE id = ?") {
            setString(1, reason.take(500)); setString(2, reason.take(500)); setUuid(3, id)
        }
    }

    open fun recordActivity(id: UUID, consumed: Int, lastError: String?) {
        execute("UPDATE event_triggers SET messages_consumed = messages_consumed + ?, " +
            "last_message_at = CASE WHEN ? > 0 THEN now() ELSE last_message_at END, " +
            "last_error = ?, updated_at = now() WHERE id = ?") {
            setLong(1, consumed.toLong()); setInt(2, consumed)
            setString(3, lastError?.take(500)); setUuid(4, id)
        }
    }

    // ── The dedup ledger ─────────────────────────────────────────────────────

    /**
     * Claim a message, or discover it is already claimed.
     *
     * ── THIS IS THE HALF THAT MAKES AT-LEAST-ONCE SURVIVABLE ────────────────
     * Every broker here may hand us the same message twice: a Kafka rebalance
     * mid-batch, an SQS visibility timeout that expires while a run is being
     * created, a Pub/Sub lease that lapses. None of that is exceptional — it is
     * the documented behaviour, and a consumer that assumes otherwise creates
     * duplicate runs under exactly the conditions that make duplicates most
     * expensive.
     *
     * The insert IS the claim, so two consumers racing on the same message
     * cannot both win. Returns null when somebody already has it.
     */
    open fun claim(
        triggerId: UUID,
        workspaceId: UUID,
        dedupeKey: String,
        body: String?,
    ): UUID? = queryOne(
        """INSERT INTO event_trigger_deliveries
             (trigger_id, workspace_id, dedupe_key, outcome, body_text)
           VALUES (?,?,?,'accepted',?)
           ON CONFLICT (trigger_id, dedupe_key) DO NOTHING
           RETURNING id""",
        {
            setUuid(1, triggerId); setUuid(2, workspaceId)
            setString(3, dedupeKey.take(500)); setString(4, body?.take(MAX_STORED_BODY))
        }) { rs -> rs.uuid("id") }

    open fun finishDelivery(deliveryId: UUID, outcome: String, detail: String?, runId: UUID?) {
        execute("UPDATE event_trigger_deliveries SET outcome = ?, detail = ?, run_id = ? " +
            "WHERE id = ?") {
            setString(1, outcome); setString(2, detail?.take(1_000))
            setUuidOrNull(3, runId); setUuid(4, deliveryId)
        }
    }

    /**
     * Give a claim back.
     *
     * A message refused for a reason that will pass — a quota that resets — must
     * be redeliverable, and a claim row would block it forever. Deleting is the
     * only correct answer: the ledger's job is "did this run", and it did not.
     */
    open fun releaseClaim(deliveryId: UUID) {
        execute("DELETE FROM event_trigger_deliveries WHERE id = ?") { setUuid(1, deliveryId) }
    }

    open fun recentDeliveries(triggerId: UUID, workspaceId: UUID, limit: Int = 50):
        List<Map<String, Any?>> = query(
        """SELECT id, dedupe_key, received_at, outcome, detail, run_id
             FROM event_trigger_deliveries
            WHERE trigger_id = ? AND workspace_id = ?
            ORDER BY received_at DESC LIMIT $limit""",
        { setUuid(1, triggerId); setUuid(2, workspaceId) },
    ) { rs ->
        mapOf(
            "id" to rs.uuid("id").toString(),
            "dedupeKey" to rs.getString("dedupe_key"),
            "receivedAt" to (rs.instantOrNull("received_at")?.toString()),
            "outcome" to rs.getString("outcome"),
            "detail" to rs.getString("detail"),
            "runId" to rs.uuidOrNull("run_id")?.toString(),
        )
    }

    private fun map(rs: ResultSet) = EventTrigger(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        workflowId = rs.uuid("workflow_id"),
        name = rs.getString("name"),
        broker = rs.getString("broker"),
        connectionId = rs.uuidOrNull("connection_id"),
        source = rs.getString("source"),
        consumerGroup = rs.getString("consumer_group"),
        inputMapping = readStringMap(rs.getString("input_mapping")),
        filterPath = rs.getString("filter_path"),
        filterValues = readTextArray(rs, "filter_values"),
        dedupePath = rs.getString("dedupe_path"),
        /* Tolerated missing, for the same schema-skew reason as the webhook. */
        runDedupPath = runCatching { rs.getString("run_dedup_path") }.getOrNull(),
        runPriority = runCatching {
            rs.getShort("run_priority").takeIf { !rs.wasNull() }
        }.getOrNull(),
        maxInFlight = rs.getInt("max_in_flight"),
        batchSize = rs.getInt("batch_size"),
        enabled = rs.getBoolean("enabled"),
        disabledReason = rs.getString("disabled_reason"),
        lastError = rs.getString("last_error"),
        lastMessageAt = rs.instantOrNull("last_message_at"),
        messagesConsumed = rs.getLong("messages_consumed"),
        createdAt = rs.instantOrNull("created_at") ?: Instant.EPOCH,
    )

    @Suppress("UNCHECKED_CAST")
    private fun readStringMap(raw: String?): Map<String, String> = runCatching {
        if (raw.isNullOrBlank()) emptyMap()
        else (mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            .mapNotNull { (k, v) -> v?.let { k.toString() to it.toString() } }.toMap()
    }.getOrDefault(emptyMap())

    private fun readTextArray(rs: ResultSet, col: String): List<String> = runCatching {
        (rs.getArray(col)?.array as? Array<*>)?.mapNotNull { it?.toString() } ?: emptyList()
    }.getOrDefault(emptyList())

    companion object {
        /** Same bound as a webhook delivery, for the same reason: this is a log, not a store. */
        const val MAX_STORED_BODY = 64 * 1024
    }
}

private const val COLUMNS = """
    id, workspace_id, environment_id, workflow_id, name, broker, connection_id,
    source, consumer_group, input_mapping, filter_path, filter_values, dedupe_path,
    run_dedup_path, run_priority,
    max_in_flight, batch_size, enabled, disabled_reason, last_error,
    last_message_at, messages_consumed, created_at"""
