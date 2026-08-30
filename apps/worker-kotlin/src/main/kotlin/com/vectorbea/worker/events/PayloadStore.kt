package com.vectorbea.worker.events

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.recovery.sanitize.RecoverySanitizer
import com.vectorbea.worker.logging.logger
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Content-addressed storage for the payloads that are too big, too repetitive, or
 * too sensitive to live in a row.
 *
 * WHY CONTENT ADDRESSING EARNS ITS KEEP IMMEDIATELY
 * -------------------------------------------------
 * An agent's system prompt is rebuilt from the same config and the same tool list
 * on every iteration, so a twenty-iteration loop produces twenty identical
 * strings. Keyed by hash they are one row. The user prompt, which embeds the
 * changing observation list, is not identical and gets a row each — which is
 * correct, and is the reason prompts are stored as two payloads rather than one
 * request blob. Storing the whole request together would content-address to
 * nothing.
 *
 * REDACTION HAPPENS BEFORE HASHING, NOT AFTER
 * -------------------------------------------
 * Two consequences, both load-bearing:
 *   - The stored bytes always match the ref. A hash of the raw text next to a
 *     redacted body is a ref that verifies nothing.
 *   - Two payloads differing only in a secret converge to one row, which is the
 *     behaviour you want: the secret is not what made them different.
 *
 * What was masked is recorded on the row. A reader who sees
 * `[redacted: connection secret]` knows why the gap is there; a reader who sees
 * a gap files a bug.
 *
 * TWO TIERS
 * ---------
 * Under [INLINE_MAX_BYTES] the content lives in `run_payloads.inline_value`. Above
 * it, the metadata row stays there and the bytes go to [PayloadBlobStore] with
 * `storage = 'object'` and the ref as the key.
 *
 * That blob store is STILL POSTGRES today (`run_payload_blobs`). The seam is real
 * and P12 swaps it for a bucket, but nobody reading `storage = 'object'` should
 * conclude their bytes have left the primary database yet.
 *
 * Truncation survives only as the no-blob-store fallback: a value too large to
 * inline with nowhere to spill is capped and flagged rather than dropped.
 *
 * SECURITY: this class redacts, unlike [RunEventStore] which stores what it is
 * given. That difference is intentional — an event carries a summary a caller has
 * already shaped, while a payload is bulk content nobody has read. The two
 * contracts are documented where they differ so neither is assumed of the other.
 */
class PayloadStore(
    private val dataSource: DataSource?,
    /**
     * Where content above [INLINE_MAX_BYTES] goes. Null falls back to truncation,
     * which is what shipped before the object tier existed.
     *
     * Ordered BEFORE [retentionDays] deliberately: Kotlin binds a trailing lambda to
     * the last parameter, so putting a function-typed parameter anywhere but last
     * silently changes what `PayloadStore(ds) { 7 }` means at every existing call
     * site.
     */
    private val blobs: PayloadBlobStore? = dataSource?.let { PostgresPayloadBlobStore(it) },
    /** Retention lookup, cached: workspace → log_retention_days. */
    private val retentionDays: (UUID) -> Int = { 7 },
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /**
         * The inline/object boundary, per the trace design.
         *
         * Was 64 KiB while this store was inline-only: with nowhere else to put a
         * large value, a low boundary would have truncated results the store exists
         * to keep. Now that the object tier exists, 8 KiB is the right line —
         * `run_payloads` is scanned by the debugger per iteration, and a jsonb column
         * holding 64 KiB rows makes that scan carry bytes nobody asked for.
         *
         * Lowering it is safe for rows already written: `storage` is recorded per
         * row, so anything inlined at the old boundary is still read inline. Nothing
         * is rewritten.
         */
        const val INLINE_MAX_BYTES = 8 * 1024

        const val TEXT = "text/plain"
        const val JSON = "application/json"

        /** The ref for [content], for callers that want to check before writing. */
        fun refFor(redactedContent: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(redactedContent.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }

    /** What a stored payload came out as, for the caller's log line and events. */
    data class Stored(
        val ref: String,
        val sizeBytes: Int,
        val truncated: Boolean,
        val redactions: List<RecoverySanitizer.Redaction>,
        /** True when the bytes went to [PayloadBlobStore] instead of inline. */
        val objectStored: Boolean = false,
    )

    /**
     * Redact, hash, store, return the ref — or null if it could not be stored.
     *
     * NEVER THROWS. A payload that cannot be persisted must not fail the thing that
     * produced it: the caller loses a debugging artefact, not a run. Callers treat
     * null as "no ref" and carry on.
     */
    fun capture(workspaceId: UUID, content: String?, contentType: String = TEXT): Stored? {
        val ds = dataSource ?: return null
        if (content.isNullOrEmpty()) return null

        return try {
            val redacted = RecoverySanitizer.redactForPayload(content)

            /* Redact BEFORE measuring and before truncating. The other order can cut a
               secret in half and leave the front of it in the stored text, past the
               point any pattern would still match it. */
            val bytes = redacted.text.toByteArray(Charsets.UTF_8)
            val oversize = bytes.size > INLINE_MAX_BYTES
            val store = blobs

            /* Oversize with a blob store goes to the object tier WHOLE. Oversize
               without one is truncated — the pre-object-tier behaviour, kept as the
               floor rather than dropping the payload. */
            val useObject = oversize && store != null
            val truncated = oversize && store == null
            val body =
                if (!truncated) redacted.text
                else String(bytes, 0, INLINE_MAX_BYTES, Charsets.UTF_8) +
                     "\n… [truncated: ${bytes.size - INLINE_MAX_BYTES} more bytes]"

            val ref = refFor(body)
            val stored = Stored(ref, body.toByteArray(Charsets.UTF_8).size, truncated,
                redacted.redactions, objectStored = useObject)

            /* Bytes first, then the metadata row. A blob with no row is garbage the
               next identical write dedupes onto; a row pointing at a blob that is not
               there is a payload the reader cannot fetch, which is worse. */
            if (useObject) store!!.put(ref, body.toByteArray(Charsets.UTF_8))
            insert(ds, ref, workspaceId, stored, body, contentType, useObject)
            stored
        } catch (e: Exception) {
            log.warn("[payloads] capture failed workspace={}: {}", workspaceId, e.message)
            null
        }
    }

    /** Read a payload back. Null when absent — the caller decides what that means. */
    fun load(ref: String): String? {
        val ds = dataSource ?: return null
        return try {
            val row: Pair<String?, String?>? = ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT storage, inline_value::text FROM run_payloads WHERE ref = ?"
                ).use { stmt ->
                    stmt.setString(1, ref)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) null else Pair(rs.getString(1), rs.getString(2))
                    }
                }
            }
            /* Reads BOTH tiers, and must keep doing so. Rows written before the inline
               boundary dropped from 64 KiB to 8 KiB are inline at up to 64 KiB;
               `storage` is recorded per row, so none of them needed rewriting. */
            row?.let { (storage, inline) ->
                if (storage == "object") blobs?.get(ref)?.toString(Charsets.UTF_8)
                else inline?.let { raw ->
                    /* Inline is a JSON value: a text payload comes back quoted and
                       escaped. Object-tier bytes are the raw body.
                       Named `raw`, not `it`: getOrElse's parameter is the Throwable,
                       so `{ it }` there returns the exception rather than the text. */
                    runCatching { mapper.readValue(raw, String::class.java) }.getOrElse { raw }
                }
            }
        } catch (e: Exception) {
            log.warn("[payloads] load failed ref={}: {}", ref.take(12), e.message)
            null
        }
    }

    private fun insert(
        ds: DataSource, ref: String, workspaceId: UUID,
        stored: Stored, body: String, contentType: String, useObject: Boolean,
    ) {
        val expiresAt = Instant.now().plusSeconds(
            runCatching { retentionDays(workspaceId) }.getOrDefault(7).coerceIn(1, 3650) * 86_400L)

        ds.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_payloads
                   (ref, workspace_id, size_bytes, content_type, storage,
                    inline_value, truncated, redactions, expires_at, object_key)
                   VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?)
                   ON CONFLICT (ref) DO UPDATE
                     SET expires_at = GREATEST(run_payloads.expires_at, EXCLUDED.expires_at)"""
            ).use { stmt ->
                stmt.setString(1, ref)
                stmt.setObject(2, workspaceId)
                stmt.setInt(3, stored.sizeBytes)
                stmt.setString(4, contentType)
                stmt.setString(5, if (useObject) "object" else "inline")
                /* run_payloads_backing_check requires inline_value on an inline row and
                   object_key on an object row. Exactly one is populated. */
                if (useObject) stmt.setNull(6, java.sql.Types.OTHER)
                else stmt.setString(6, mapper.writeValueAsString(body))
                stmt.setBoolean(7, stored.truncated)
                stmt.setString(8, mapper.writeValueAsString(
                    stored.redactions.map { mapOf("label" to it.label, "count" to it.count) }))
                stmt.setTimestamp(9, Timestamp.from(expiresAt))
                if (useObject) stmt.setString(10, ref) else stmt.setNull(10, java.sql.Types.VARCHAR)
                stmt.executeUpdate()
            }
        }
    }
}

/**
 * Workspace retention, read once per workspace per process.
 *
 * `log_retention_days` changes about never, and a query per captured payload would
 * put a round trip on the hot path of every iteration. Unbounded is fine: one small
 * int per workspace this worker has actually executed for.
 */
class RetentionLookup(private val dataSource: DataSource?) {
    private val log = logger()
    private val cache = java.util.concurrent.ConcurrentHashMap<UUID, Int>()

    fun daysFor(workspaceId: UUID): Int = cache.getOrPut(workspaceId) {
        val ds = dataSource ?: return@getOrPut DEFAULT_DAYS
        try {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT log_retention_days FROM workspace_usage_policies WHERE workspace_id = ?"
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) rs.getInt(1).takeIf { it > 0 } ?: DEFAULT_DAYS
                        else DEFAULT_DAYS
                    }
                }
            }
        } catch (e: Exception) {
            log.debug("[payloads] retention lookup failed for {} — using {}d: {}",
                workspaceId, DEFAULT_DAYS, e.message)
            DEFAULT_DAYS
        }
    }

    companion object { const val DEFAULT_DAYS = 7 }
}
