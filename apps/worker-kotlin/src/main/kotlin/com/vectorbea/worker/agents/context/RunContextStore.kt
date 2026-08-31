package com.vectorbea.worker.agents.context

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.recovery.sanitize.RecoverySanitizer
import com.vectorbea.worker.events.PayloadStore
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * The team blackboard: what one agent found, written where its peers can read it.
 *
 * ── APPEND-ONLY, AND WHAT THAT BUYS ─────────────────────────────────────────
 * Every write is a new row at `version = MAX + 1`. Nothing is ever updated in
 * place, so two peers in a fan-out writing the same key never contend on a row
 * lock, and the debugger can answer "what did this agent see when it decided
 * that" by reading the key AT a version rather than reading whatever survived.
 * A read that can only return the present tense makes a whole class of
 * multi-agent bug undiagnosable, because the value that caused the decision is
 * gone by the time anyone looks.
 *
 * ── SANITIZATION HAPPENS HERE, ONCE ─────────────────────────────────────────
 * This is a write boundary in the same sense `RunEventStore` and `SpanWriter`
 * are, and it takes the opposite half of the contract: those two store what they
 * are given, and this one is where the redaction happens. A blackboard value is
 * whatever an agent chose to write, which means it can carry a connection string
 * it read out of an error message. It is then read into a PEER'S PROMPT and sent
 * to a provider — so an unsanitized blackboard is an exfiltration path, not
 * merely an untidy log.
 *
 * ── AND SO IS THE CAP ───────────────────────────────────────────────────────
 * The same read-into-a-prompt property makes size a correctness concern rather
 * than a storage one. Values over [PayloadStore.INLINE_MAX_BYTES] go to the
 * payload store and the row keeps a ref; the inline value is a stated summary,
 * not a silent truncation, so a reader can tell the difference between "this is
 * the value" and "this is the front of the value".
 */
class RunContextStore(
    private val dataSource: DataSource?,
    /** Where oversized values go. Null keeps them inline, capped and marked. */
    private val payloads: PayloadStore? = null,
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /**
         * The largest value kept inline in `value_json`.
         *
         * Deliberately smaller than [PayloadStore.INLINE_MAX_BYTES]: a payload is
         * read by a person in a debugger, but a blackboard entry is read by a
         * MODEL, several of them at once, inside a context window that also has to
         * hold the task. Ten entries at 8 KiB is 80 KiB of prompt before the agent
         * has been told what to do.
         */
        const val INLINE_MAX_CHARS = 2_000

        /** Keys are addresses, not content. */
        const val MAX_KEY_CHARS = 200

        /** Retries on the version race. See [write]. */
        private const val VERSION_RETRIES = 5

        /**
         * A uuid that cannot be an activation, so `= ANY(array)` over an empty
         * lineage matches nothing — rather than erroring, or matching everything,
         * which is the direction an access-control bug must never fail.
         */
        private val NO_ACTIVATION: UUID = UUID(0, 0)
    }

    /**
     * Where an entry lives. This is the ACCESS BOUNDARY, not a label.
     *
     * | Scope | A reader may address it when |
     * |---|---|
     * | `RUN` | it is in the same run |
     * | `TEAM` | it belongs to the reader's team node |
     * | `ACTIVATION` | it belongs to the reader's activation or an ancestor |
     */
    enum class Scope(val wire: String) {
        RUN("run"), TEAM("team"), ACTIVATION("activation")
    }

    /**
     * How visibility MODIFIES the scope. Checked in SQL, never after the read.
     *
     * Two modifiers and one neutral default, which is the only arrangement that
     * does not produce a footgun:
     *
     * | Visibility | Effect |
     * |---|---|
     * | [PUBLIC] | Widens past the scope — any activation in the run |
     * | [TEAM] | Neutral. The scope is the boundary; this adds nothing |
     * | [PRIVATE] | Narrows — the writer and its descendants only, whatever the scope |
     *
     * [TEAM] being neutral rather than "readers who are in a team" is deliberate.
     * It is the DEFAULT, and the other reading makes the default write unreadable
     * by the default reader: a single agent, or a supervisor that has not
     * delegated yet, has no team ref and could not read back a value it had just
     * written itself.
     */
    enum class Visibility(val wire: String) {
        PUBLIC("public"),
        TEAM("team"),
        PRIVATE("private"),
    }

    data class Entry(
        val key: String,
        /** The inline value. A summary when [payloadRef] is set. */
        val value: String,
        /**
         * This key's version — 1, 2, 3 for successive writes of THIS key.
         *
         * Per key, not per run. See [watermark] for the run-wide ordering; the two
         * are different numbers and using one for the other is the bug this
         * distinction exists to prevent.
         */
        val version: Long,
        /**
         * This row's position in the run's write order.
         *
         * ── WHY A SECOND NUMBER ────────────────────────────────────────────
         * [version] cannot serve as a snapshot point, because it counts per key.
         * Key `a` at version 2 and key `c` at version 1 say nothing about which
         * was written first, so "read everything as of version 2" would include a
         * `c` that did not exist yet — an as-of read that silently shows an agent
         * something it could not have seen, which is worse than no as-of read.
         *
         * The `BIGSERIAL` primary key is already a run-wide monotonic write order,
         * so the watermark is free. This is the number a handoff records as
         * `context_version`.
         */
        val watermark: Long,
        val scope: String,
        val scopeRef: String?,
        val visibility: String,
        val writtenBy: UUID?,
        /** Set when the full value went to the payload store. */
        val payloadRef: String? = null,
    ) {
        val offloaded: Boolean get() = payloadRef != null
    }

    /**
     * What a reader is allowed to see.
     *
     * Passed as one object rather than four parameters because every field is
     * required for the visibility rules to be correct, and an optional one would
     * silently widen a read: a caller that forgets [teamRef] would see nothing,
     * but one that forgets [activationId] would see another activation's private
     * entries.
     */
    data class Reader(
        val runId: UUID,
        /** The team node this reader belongs to, if any. */
        val teamRef: String?,
        /** This reader's activation. */
        val activationId: UUID?,
        /**
         * This activation and every ancestor, so a child can read what its parent
         * wrote privately. Ancestors, never descendants: a supervisor reading its
         * workers' private scratch space is the thing `private` exists to prevent.
         */
        val activationLineage: List<UUID> = listOfNotNull(activationId),
    )

    // ── Write ────────────────────────────────────────────────────────────────

    /**
     * Append a new version of [key].
     *
     * Returns the version written, or null when there is nothing to write to.
     * Never throws: an agent that cannot record a finding should carry on and
     * say so, not fail the run.
     *
     * ── THE VERSION RACE, AND WHY IT IS A RETRY AND NOT A LOCK ─────────────
     * `MAX(version) + 1` computed by two workers at once yields the same number
     * twice. `uq_run_context_version` rejects the second, and this retries onto
     * the next version. The alternative — `SELECT … FOR UPDATE` on the key — is a
     * lock on the hot path of every team write, which is precisely the cost
     * append-only was chosen to avoid. A retry loop pays only when there IS
     * contention.
     */
    fun write(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        key: String,
        value: Any?,
        scope: Scope = Scope.RUN,
        scopeRef: String? = null,
        visibility: Visibility = Visibility.TEAM,
        writtenBy: UUID? = null,
    ): Long? {
        val ds = dataSource ?: return null
        if (key.isBlank()) return null

        /* scope='run' carries no ref and the others must. Enforced here as well as
           by the CHECK, so a caller gets a null and a log line rather than a
           constraint violation buried in a stack trace. */
        val ref = if (scope == Scope.RUN) null else scopeRef
        if (scope != Scope.RUN && ref.isNullOrBlank()) {
            log.warn("[context] {} scope needs a scope_ref — dropping key={}", scope.wire, key)
            return null
        }

        /*
         * ── A PRIVATE ENTRY WITH NO OWNER IS A WRITE-ONLY BLACK HOLE ────────
         *
         * `private` means "the writer and its descendants", and the read enforces
         * that as `written_by = ANY(lineage)`. With `written_by` null the
         * comparison is null, so NOBODY can read it — including the writer. The
         * value would be stored, cost storage, and never be seen again, and
         * nothing would say so.
         *
         * Refused at the WRITE instead, where the caller can be told. Fail closed
         * and loudly, rather than fail closed and silently.
         */
        if (visibility == Visibility.PRIVATE && writtenBy == null) {
            log.warn("[context] a private entry needs a writing activation — dropping key={}", key)
            return null
        }

        val rendered = render(value)
        val redacted = RecoverySanitizer.redactForPayload(rendered)

        /* Offload BEFORE truncating, so the store gets the whole value and the
           row gets a stated summary of it rather than the front of it. */
        val stored = if (redacted.text.length > INLINE_MAX_CHARS)
            runCatching { payloads?.capture(workspaceId, redacted.text) }.getOrNull() else null

        val inline = when {
            stored != null ->
                redacted.text.take(INLINE_MAX_CHARS) +
                    "\n… [${redacted.text.length - INLINE_MAX_CHARS} more characters in ${stored.ref}]"
            redacted.text.length > INLINE_MAX_CHARS ->
                redacted.text.take(INLINE_MAX_CHARS) +
                    "\n… [truncated: ${redacted.text.length - INLINE_MAX_CHARS} more characters, not stored]"
            else -> redacted.text
        }

        val json = mapper.writeValueAsString(inline)
        val truncatedKey = key.take(MAX_KEY_CHARS)

        repeat(VERSION_RETRIES) { attempt ->
            val result = runCatching {
                ds.connection.use { conn ->
                    conn.prepareStatement(
                        """INSERT INTO run_context_entries
                             (run_id, workspace_id, environment_id, scope, scope_ref, key,
                              value_json, version, written_by, visibility, payload_ref)
                           SELECT ?,?,?,?,?,?,?::jsonb,
                                  COALESCE(MAX(version), 0) + 1,
                                  ?,?,?
                             FROM run_context_entries
                            WHERE run_id = ? AND scope = ? AND key = ?
                              AND COALESCE(scope_ref,'') = COALESCE(?,'')
                           RETURNING version"""
                    ).use { st ->
                        st.setObject(1, runId); st.setObject(2, workspaceId)
                        st.setObject(3, environmentId); st.setString(4, scope.wire)
                        st.setString(5, ref); st.setString(6, truncatedKey)
                        st.setString(7, json)
                        st.setObject(8, writtenBy); st.setString(9, visibility.wire)
                        st.setString(10, stored?.ref)
                        st.setObject(11, runId); st.setString(12, scope.wire)
                        st.setString(13, truncatedKey); st.setString(14, ref)
                        st.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else null }
                    }
                }
            }
            result.getOrNull()?.let { return it }

            val e = result.exceptionOrNull()
            /* 23505 is unique_violation: somebody else took this version. Anything
               else is not a race and retrying it just costs time. */
            val isVersionRace = (e as? java.sql.SQLException)?.sqlState == "23505"
            if (!isVersionRace) {
                log.warn("[context] write failed run={} key={}: {}", runId, truncatedKey, e?.message)
                return null
            }
            if (attempt == VERSION_RETRIES - 1) {
                log.warn("[context] lost the version race {} times run={} key={}",
                    VERSION_RETRIES, runId, truncatedKey)
            }
        }
        return null
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * The latest version of every key this reader may see.
     *
     * `DISTINCT ON (key)` with `ORDER BY key, version DESC` — one row per key,
     * the newest. Visibility and scope are filtered IN the query, never after it:
     * a value that reaches this process has, in every code path that matters,
     * already reached a prompt.
     */
    fun latest(reader: Reader, keys: Collection<String>? = null): List<Entry> {
        val ds = dataSource ?: return emptyList()
        if (keys != null && keys.isEmpty()) return emptyList()

        return runCatching {
            ds.connection.use { conn ->
                val lineage = reader.activationLineage.ifEmpty { listOf(NO_ACTIVATION) }
                val keyFilter = if (keys == null) "" else
                    " AND key = ANY(?)"

                conn.prepareStatement(
                    """SELECT DISTINCT ON (key)
                              key, value_json::text AS v, version, id, scope, scope_ref,
                              visibility, written_by, payload_ref
                         FROM run_context_entries
                        WHERE run_id = ? AND $VISIBILITY_SQL$keyFilter
                        ORDER BY key, version DESC"""
                ).use { st ->
                    st.setObject(1, reader.runId)
                    val next = bindVisibility(conn, st, reader, lineage, from = 2)
                    if (keys != null) {
                        st.setArray(next, conn.createArrayOf("text",
                            keys.map { it.take(MAX_KEY_CHARS) }.toTypedArray()))
                    }
                    st.executeQuery().use { rs -> readAll(rs) }
                }
            }
        }.getOrElse {
            log.warn("[context] read failed run={}: {}", reader.runId, it.message)
            emptyList()
        }
    }

    /**
     * Every key as it stood at [watermark] — the debugger's question.
     *
     * "What did this agent see when it decided that" is answerable only because
     * nothing is updated in place. The handoff row records the watermark; this
     * reads at it. Visibility is applied exactly as in [latest], because a
     * historical read is still a read.
     *
     * [watermark], not a version: see [Entry.watermark].
     */
    fun asOf(reader: Reader, watermark: Long): List<Entry> {
        val ds = dataSource ?: return emptyList()
        return runCatching {
            ds.connection.use { conn ->
                val lineage = reader.activationLineage.ifEmpty { listOf(NO_ACTIVATION) }
                conn.prepareStatement(
                    """SELECT DISTINCT ON (key)
                              key, value_json::text AS v, version, id, scope, scope_ref,
                              visibility, written_by, payload_ref
                         FROM run_context_entries
                        WHERE run_id = ? AND id <= ? AND $VISIBILITY_SQL
                        ORDER BY key, version DESC"""
                ).use { st ->
                    st.setObject(1, reader.runId)
                    st.setLong(2, watermark)
                    bindVisibility(conn, st, reader, lineage, from = 3)
                    st.executeQuery().use { rs -> readAll(rs) }
                }
            }
        }.getOrElse {
            log.warn("[context] as-of read failed run={}: {}", reader.runId, it.message)
            emptyList()
        }
    }

    /** Every version of one key, oldest first — the audit view of a bad write. */
    fun history(runId: UUID, key: String, scope: Scope = Scope.RUN, scopeRef: String? = null): List<Entry> {
        val ds = dataSource ?: return emptyList()
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT key, value_json::text AS v, version, id, scope, scope_ref,
                              visibility, written_by, payload_ref
                         FROM run_context_entries
                        WHERE run_id = ? AND key = ? AND scope = ?
                          AND COALESCE(scope_ref,'') = COALESCE(?,'')
                        ORDER BY version"""
                ).use { st ->
                    st.setObject(1, runId); st.setString(2, key.take(MAX_KEY_CHARS))
                    st.setString(3, scope.wire); st.setString(4, scopeRef)
                    st.executeQuery().use { rs -> readAll(rs) }
                }
            }
        }.getOrElse { emptyList() }
    }

    /**
     * The run's current write position — what a handoff records so the decision
     * can be replayed against exactly the context that produced it.
     *
     * The MAX row id, not the max version. See [Entry.watermark].
     */
    fun currentWatermark(runId: UUID): Long {
        val ds = dataSource ?: return 0
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT COALESCE(MAX(id),0) FROM run_context_entries WHERE run_id=?"
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
                }
            }
        }.getOrDefault(0)
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /**
     * The one visibility predicate, shared by [latest] and [asOf].
     *
     * ONE COPY, DELIBERATELY. Two hand-maintained copies of an access-control
     * clause drift, and the way they drift is that the less-exercised one — the
     * historical read — becomes the permissive one. A debugger that shows an
     * operator a private value the agent itself could not see is a leak with a
     * plausible excuse attached.
     *
     * Reads: PUBLIC widens past the scope; otherwise the scope must admit the
     * reader, and PRIVATE additionally requires the writer to be the reader or
     * one of its ancestors.
     */
    private val VISIBILITY_SQL = """(
              visibility = 'public'
           OR (
                (   scope = 'run'
                 OR (scope = 'team'       AND scope_ref = ?)
                 OR (scope = 'activation' AND scope_ref = ANY(?)) )
                AND (visibility <> 'private' OR written_by = ANY(?))
              )
            )"""

    /** Binds [VISIBILITY_SQL]'s three parameters. Returns the next free index. */
    private fun bindVisibility(
        conn: java.sql.Connection,
        st: java.sql.PreparedStatement,
        reader: Reader,
        lineage: List<UUID>,
        from: Int,
    ): Int {
        var i = from
        st.setString(i++, reader.teamRef)
        /* scope_ref is TEXT even for an activation scope — it holds either a team
           node id or an activation id — so the array it is compared against is
           text, not uuid. */
        st.setArray(i++, conn.createArrayOf("text", lineage.map { it.toString() }.toTypedArray()))
        st.setArray(i++, conn.createArrayOf("uuid", lineage.toTypedArray()))
        return i
    }

    private fun readAll(rs: java.sql.ResultSet): List<Entry> {
        val out = mutableListOf<Entry>()
        while (rs.next()) {
            val raw = rs.getString("v") ?: continue
            /* Stored as JSON, so a plain string comes back quoted and escaped.
               Unwrap scalars — handing a model an escaped JSON string when the
               value was a sentence is needlessly harder for it to read. Objects
               and arrays stay as JSON, which is what they were. */
            val text = if (raw.startsWith("\""))
                runCatching { mapper.readValue(raw, String::class.java) }.getOrDefault(raw)
            else raw
            out += Entry(
                key = rs.getString("key"),
                value = text,
                version = rs.getLong("version"),
                watermark = rs.getLong("id"),
                scope = rs.getString("scope"),
                scopeRef = rs.getString("scope_ref"),
                visibility = rs.getString("visibility"),
                writtenBy = rs.getObject("written_by", UUID::class.java),
                payloadRef = rs.getString("payload_ref"),
            )
        }
        return out
    }

    private fun render(value: Any?): String = when (value) {
        null -> ""
        is String -> value
        else -> runCatching { mapper.writeValueAsString(value) }.getOrElse { value.toString() }
    }
}
