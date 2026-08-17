package com.vectorbea.worker.replay

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import java.security.MessageDigest
import java.util.UUID
import javax.sql.DataSource

/**
 * Records every provider call completely enough to replay it.
 *
 * WHAT "COMPLETELY" MEANS AND WHY THE OLD RECORD WASN'T
 * -----------------------------------------------------
 * The previous record was a prose summary plus a token count. That is enough to
 * show a user what happened and nothing else. It cannot answer "which model
 * version decided this", "was temperature zero", "what did the provider actually
 * return", or "give me that answer again without paying for it" — and those are
 * the questions replay and audit exist to answer.
 *
 * So: parameters, both bodies, and the resolved model version. See
 * docs/architecture/REPLAY-AUDIT.md for the field-by-field gap this closes.
 *
 * THE REDACTION RULE
 * ------------------
 * Secrets are stripped from the stored request. The prompt and the response are
 * **never** redacted.
 *
 * That is a deliberate and slightly uncomfortable choice, so it is worth stating
 * plainly: the prompt and response ARE the audit substrate. A redacted audit
 * trail cannot answer the question it exists for, and "we store a censored
 * version of what the model was asked" is not an answer an enterprise buyer
 * accepts. Credentials are different — they are never *content*, only transport,
 * and stripping them costs nothing.
 *
 * FAILURES ARE RECORDED TOO
 * -------------------------
 * A call that returned 500, or was rate limited, is still a recorded call with
 * `outcome != 'ok'`. Replay must reproduce the failure: skipping it would let the
 * replayed run take a different branch from the original, which is precisely the
 * divergence this whole change exists to eliminate.
 */
class ModelCallRecorder(
    private val dataSource: DataSource,
    private val blobs: BlobStore = PostgresBlobStore(dataSource),
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    companion object {
        /**
         * Inline ceiling. Above this the body is offloaded and only the key is
         * stored, consistent with the 256KB payload ceiling used elsewhere.
         */
        val INLINE_MAX_BYTES: Int =
            System.getenv("MODEL_CALL_INLINE_MAX_BYTES")?.toIntOrNull() ?: 262_144

        /**
         * Header names whose values are credentials.
         *
         * Matched case-insensitively on a prefix, because providers keep inventing
         * spellings of the same idea and a missed one is a leaked key.
         */
        private val SECRET_KEYS = listOf(
            "authorization", "x-api-key", "api-key", "api_key", "apikey",
            "secret", "password", "token", "bearer", "credential",
        )

        fun promptHash(messages: Any?): String {
            val text = messages?.toString() ?: ""
            val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        }
    }

    /** One provider call, as it happened. */
    data class ModelCall(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val nodeId: String,
        val provider: String,
        val modelId: String,
        /** Resolved version from the response. Null when the provider does not say. */
        val modelVersion: String? = null,
        val temperature: Double? = null,
        val topP: Double? = null,
        val seed: Long? = null,
        val maxTokens: Int? = null,
        val responseFormat: String? = null,
        val promptHash: String? = null,
        val requestJson: String? = null,
        val responseJson: String? = null,
        val logprobs: String? = null,
        val finishReason: String? = null,
        val tokensIn: Int? = null,
        val tokensOut: Int? = null,
        val latencyMs: Long? = null,
        val costUsd: Double? = null,
        val attemptNumber: Int = 0,
        val callIndex: Int = 0,
        val outcome: String = "ok",
        val errorSanitized: String? = null,
        val eventId: UUID? = null,
    )

    /**
     * Persist the call.
     *
     * Never throws. A recording failure must not fail the run it is recording —
     * the user's work completing matters more than our audit of it — but it is
     * logged at WARN because a run with missing calls is a run that cannot be
     * replayed, and the operator should find that out before a customer does.
     *
     * `ON CONFLICT DO NOTHING` on the uniqueness key: a retried *write* must not
     * create a second candidate response for the same call, which would leave
     * replay with two answers and no way to choose.
     */
    fun record(call: ModelCall) {
        runCatching {
            val (reqInline, reqKey) = split(redactRequest(call.requestJson), call.runId, "req")
            val (resInline, resKey) = split(call.responseJson, call.runId, "res")

            dataSource.connection.use { conn ->
                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    var i = 1
                    stmt.setObject(i++, call.runId)
                    stmt.setObject(i++, call.workspaceId)
                    stmt.setObject(i++, call.environmentId)
                    stmt.setString(i++, call.nodeId)
                    stmt.setObject(i++, call.eventId)
                    stmt.setString(i++, call.provider)
                    stmt.setString(i++, call.modelId)
                    stmt.setString(i++, call.modelVersion)
                    setDoubleOrNull(stmt, i++, call.temperature)
                    setDoubleOrNull(stmt, i++, call.topP)
                    if (call.seed != null) stmt.setLong(i++, call.seed) else stmt.setNull(i++, java.sql.Types.BIGINT)
                    setIntOrNull(stmt, i++, call.maxTokens)
                    stmt.setString(i++, call.responseFormat)
                    stmt.setString(i++, call.promptHash)
                    stmt.setString(i++, reqInline)
                    stmt.setString(i++, resInline)
                    stmt.setString(i++, reqKey)
                    stmt.setString(i++, resKey)
                    stmt.setString(i++, call.logprobs)
                    stmt.setString(i++, call.finishReason)
                    setIntOrNull(stmt, i++, call.tokensIn)
                    setIntOrNull(stmt, i++, call.tokensOut)
                    if (call.latencyMs != null) stmt.setLong(i++, call.latencyMs) else stmt.setNull(i++, java.sql.Types.BIGINT)
                    setDoubleOrNull(stmt, i++, call.costUsd)
                    stmt.setInt(i++, call.attemptNumber)
                    stmt.setInt(i++, call.callIndex)
                    stmt.setString(i++, call.outcome)
                    stmt.setString(i++, call.errorSanitized)
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[record] could not persist model call for run {} node {}: {} — " +
                "this run is no longer fully replayable", call.runId, call.nodeId, it.message)
        }
    }

    /**
     * Strip credentials from a serialised request body.
     *
     * Parse, walk, re-serialise — rather than a regex over the JSON text — so a
     * credential nested inside a tool definition is caught and a *prompt* that
     * discusses passwords is not. On a parse failure the body is stored as-is:
     * these are our own serialised maps, so a failure means something unexpected,
     * and losing the audit record is the worse outcome.
     */
    private fun redactRequest(json: String?): String? {
        if (json == null) return null
        return runCatching {
            val parsed = mapper.readValue(json, Any::class.java)
            mapper.writeValueAsString(redactSecrets(parsed))
        }.getOrDefault(json)
    }

    /** Inline when small, offloaded when not. Exactly one of the pair is non-null. */
    private fun split(body: String?, runId: UUID, kind: String): Pair<String?, String?> {
        if (body == null) return null to null
        if (body.toByteArray(Charsets.UTF_8).size <= INLINE_MAX_BYTES) return body to null
        val key = "runs/$runId/model-calls/${UUID.randomUUID()}.$kind.json"
        return runCatching { blobs.put(key, body); null to key }
            .getOrElse {
                log.warn("[record] offload failed for {} — truncating inline: {}", key, it.message)
                // Truncated rather than dropped: a partial body still tells an
                // auditor what was asked, and a null tells them nothing. The
                // marker makes the truncation obvious rather than silent.
                mapper.writeValueAsString(mapOf(
                    "__truncated" to true,
                    "__originalBytes" to body.toByteArray(Charsets.UTF_8).size,
                    "body" to body.take(INLINE_MAX_BYTES / 2),
                )) to null
            }
    }

    /**
     * Strip credentials from a request body before storing it.
     *
     * Walks the structure rather than regexing the JSON, so a key named
     * `authorization` nested three levels down is caught and a *prompt* that
     * happens to contain the word "password" is not.
     */
    fun redactSecrets(body: Any?): Any? = when (body) {
        is Map<*, *> -> body.entries.associate { (k, v) ->
            val key = k?.toString().orEmpty()
            // `messages`, `contents` and `prompt` are content, never credentials,
            // and are passed through untouched no matter what they contain. This
            // is the rule that keeps the audit substrate intact.
            if (key.lowercase() in CONTENT_KEYS) key to v
            else if (SECRET_KEYS.any { key.lowercase().contains(it) }) key to "[redacted]"
            else key to redactSecrets(v)
        }
        is List<*> -> body.map { redactSecrets(it) }
        else -> body
    }

    private fun setDoubleOrNull(stmt: java.sql.PreparedStatement, i: Int, v: Double?) {
        if (v != null) stmt.setDouble(i, v) else stmt.setNull(i, java.sql.Types.DOUBLE)
    }

    private fun setIntOrNull(stmt: java.sql.PreparedStatement, i: Int, v: Int?) {
        if (v != null) stmt.setInt(i, v) else stmt.setNull(i, java.sql.Types.INTEGER)
    }
}

/** Keys whose values are content and must survive redaction untouched. */
private val CONTENT_KEYS = setOf("messages", "contents", "prompt", "system", "input", "content")

private val INSERT_SQL = """
    INSERT INTO model_calls (
        run_id, workspace_id, environment_id, node_id, event_id,
        provider, model_id, model_version,
        temperature, top_p, seed, max_tokens, response_format,
        prompt_hash, request_body, response_body, request_body_key, response_body_key,
        logprobs, finish_reason, tokens_in, tokens_out, latency_ms, cost_usd,
        attempt_number, call_index, outcome, error_sanitized
    ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?::jsonb, ?::jsonb, ?, ?,
        ?::jsonb, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
    )
    ON CONFLICT (run_id, node_id, attempt_number, call_index) DO NOTHING
""".trimIndent()

/**
 * Where oversized bodies go.
 *
 * An interface with one implementation, because the interface is the point: R2 is
 * the intended home (backend prompt B07) and there is no object-storage client in
 * this service yet. Shipping the seam with a working Postgres implementation means
 * the recording is complete *today* and the storage backend is a swap rather than
 * a redesign.
 */
interface BlobStore {
    fun put(key: String, body: String)
    fun get(key: String): String?
}

/**
 * Postgres-backed blob storage — the interim implementation.
 *
 * Large bodies in a TOASTed column is not where these belong long-term: they
 * inflate backups and vacuum, and object storage is an order of magnitude cheaper
 * per byte. It IS, however, transactional with the rest of the recording, needs no
 * new credentials, and cannot silently lose a body to a bucket-policy change —
 * which makes it the right thing to be correct with first.
 *
 * Tracked as D19.
 */
class PostgresBlobStore(private val dataSource: DataSource) : BlobStore {
    override fun put(key: String, body: String) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO payload_blobs (key, body) VALUES (?, ?)
                   ON CONFLICT (key) DO NOTHING"""
            ).use { stmt ->
                stmt.setString(1, key)
                stmt.setString(2, body)
                stmt.executeUpdate()
            }
        }
    }

    override fun get(key: String): String? = dataSource.connection.use { conn ->
        conn.prepareStatement("SELECT body FROM payload_blobs WHERE key = ?").use { stmt ->
            stmt.setString(1, key)
            stmt.executeQuery().use { rs -> if (rs.next()) rs.getString("body") else null }
        }
    }
}
