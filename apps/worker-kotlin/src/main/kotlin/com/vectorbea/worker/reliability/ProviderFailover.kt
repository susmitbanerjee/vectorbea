package com.vectorbea.worker.reliability

import com.vectorbea.worker.logging.logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource

/**
 * Fail over to a secondary provider when the primary is sustainedly broken.
 *
 * WHY THIS IS LOUD RATHER THAN SILENT
 * -----------------------------------
 * §5 is explicit: *"Log the failover; it changes behaviour."* That is the whole
 * design constraint here and it is worth being precise about why.
 *
 * A failover is not a transparent recovery. The secondary is a **different model**,
 * with different phrasing, different tool-calling behaviour, and a different
 * failure surface. A run that succeeded on the secondary did not succeed on the
 * primary, and if the output later looks odd, "which model produced this" is the
 * first question — and one nobody can answer if the substitution was silent.
 *
 * So every failover writes an event visible in the run detail, and the model
 * recorded against the call is the one that actually answered.
 *
 * SUSTAINED, NOT INCIDENTAL
 * -------------------------
 * A single 5xx is noise; providers return them routinely and a retry usually
 * succeeds. Failing over on the first one would swap models constantly and make
 * behaviour unpredictable for no benefit.
 *
 * So failover requires the primary to have exhausted its retries — three attempts,
 * per the §5 table — within one node execution. That is what "sustained" means
 * here: not a count over time, but "this call could not be completed by the
 * primary".
 */
class ProviderFailover(private val dataSource: DataSource?) {

    private val log = logger()

    /** A configured alternative for a workspace. */
    data class Secondary(
        val connectionId: UUID,
        val provider: String,
        val model: String,
    )

    data class Decision(
        val secondary: Secondary,
        /** Shown in the run detail. Never omitted. */
        val userMessage: String,
    )

    /**
     * Consecutive primary failures per (run, node), so "sustained" is scoped to the
     * call rather than to the process.
     *
     * Keyed on run+node rather than on the connection: two runs hitting the same
     * degraded provider should each make their own decision, and a shared counter
     * would let one run's failures trigger another's failover mid-execution.
     */
    private val failures = ConcurrentHashMap<String, AtomicInteger>()

    /**
     * Whether this failure should trigger a failover, and to what.
     *
     * Returns null when it should not — the caller then follows the ordinary backoff
     * path. Only PROVIDER_5XX qualifies: a 429 is the provider working correctly and
     * asking us to wait, and failing over on it would move load onto the secondary
     * every time the primary got busy, which is how both end up rate limited.
     */
    fun considerFailover(
        kind: FailureClassifier.Kind,
        runId: UUID,
        nodeId: String,
        workspaceId: UUID,
        primaryProvider: String,
    ): Decision? {
        if (kind != FailureClassifier.Kind.PROVIDER_5XX) return null

        val key = "$runId|$nodeId"
        val count = failures.computeIfAbsent(key) { AtomicInteger(0) }.incrementAndGet()
        val threshold = FailureClassifier.policyFor(FailureClassifier.Kind.PROVIDER_5XX).maxAttempts
        if (count < threshold) return null

        val secondary = secondaryFor(workspaceId, primaryProvider) ?: run {
            log.warn("[failover] {} is failing for run {} node {} but no secondary provider is " +
                "configured for this workspace", primaryProvider, runId, nodeId)
            return null
        }

        // ERROR, not INFO. A failover means a customer's workflow is running on a
        // model they did not choose, and that should be visible in an alert rather
        // than discovered later in a log search.
        log.error("[failover] {} failed {} times for run {} node {} - failing over to {} ({}). " +
            "This changes model behaviour.",
            primaryProvider, count, runId, nodeId, secondary.provider, secondary.model)

        return Decision(
            secondary = secondary,
            userMessage = "The primary AI provider ($primaryProvider) failed repeatedly, so this " +
                "step ran on the backup provider (${secondary.provider}, ${secondary.model}) " +
                "instead. The result may differ in wording or structure from a normal run.",
        )
    }

    /** Reset the counter once the node completes, so a later failure starts fresh. */
    fun clear(runId: UUID, nodeId: String) {
        failures.remove("$runId|$nodeId")
    }

    /**
     * The workspace's configured backup LLM connection.
     *
     * Chosen as an active LLM connection of a DIFFERENT provider from the primary —
     * failing over to another connection on the same provider is no failover at all
     * when the provider itself is down.
     *
     * Explicitly opted into via `config_json.failover_secondary`, rather than
     * inferred: silently routing a customer's data to whichever other provider they
     * happen to have configured is a data-residency decision that is not ours to
     * make.
     */
    fun secondaryFor(workspaceId: UUID, primaryProvider: String): Secondary? {
        val ds = dataSource ?: return null
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, provider, config_json->>'model' AS model
                         FROM connections
                        WHERE workspace_id = ?
                          AND type = 'llm'
                          AND status = 'active'
                          AND lower(provider) <> lower(?)
                          AND (config_json->>'failover_secondary')::boolean IS TRUE
                        ORDER BY updated_at DESC
                        LIMIT 1"""
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setString(2, primaryProvider)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) null else Secondary(
                            connectionId = UUID.fromString(rs.getString("id")),
                            provider = rs.getString("provider"),
                            model = rs.getString("model") ?: "unknown",
                        )
                    }
                }
            }
        }.getOrElse {
            log.warn("[failover] could not look up a secondary provider for {}: {}",
                workspaceId, it.message)
            null
        }
    }
}
