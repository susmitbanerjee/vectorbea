package com.vectorbea.worker.events

import com.vectorbea.worker.logging.logger
import javax.sql.DataSource

/**
 * Where a payload's BYTES live when it is too large to inline.
 *
 * THE POINT OF THIS INTERFACE IS THAT IT IS NOT POSTGRES
 * -----------------------------------------------------
 * `run_payloads` holds the metadata — ref, size, redactions, expiry — and this
 * holds the content. Two stores rather than one wide table so they are
 * independently swappable: P12 replaces this implementation with real object
 * storage and `run_payloads` does not change at all. A single table with a body
 * column would make that a migration instead of a class.
 *
 * So nothing here takes a `Connection`, a transaction handle, or anything else a
 * bucket cannot provide. An interface that accepts a JDBC connection cannot be
 * satisfied by S3, and discovering that later means rewriting every call site
 * rather than writing one class.
 *
 * WHY THIS IS NOT `com.vectorbea.worker.replay.BlobStore`
 * ------------------------------------------------------
 * That one exists, has the same shape, and backs `payload_blobs` for model-call
 * recordings. They are deliberately separate: different tables, different
 * retention (a recording lives as long as its run is replayable; a trace payload
 * expires on the workspace's `log_retention_days`), and different swap timelines.
 * Merging them would couple two lifecycles that have no reason to move together.
 * If they are ever unified, this is the note that says what to check.
 */
interface PayloadBlobStore {
    /** Store [bytes] under [key]. Returns the key, so a caller can chain. */
    fun put(key: String, bytes: ByteArray): String

    /** Fetch by key, or null if absent. */
    fun get(key: String): ByteArray?
}

/**
 * The interim implementation: Postgres, in `run_payload_blobs`.
 *
 * A row whose `run_payloads.storage` says `'object'` is stored HERE — still on the
 * primary database. The column records the intent and the seam is real, but nobody
 * reading `storage = 'object'` should conclude their bytes are in a bucket. P12
 * makes that true by replacing this class.
 *
 * Content-addressed, so the insert is idempotent: the same bytes produce the same
 * key and the second write is a no-op rather than a duplicate.
 */
class PostgresPayloadBlobStore(private val dataSource: DataSource) : PayloadBlobStore {
    private val log = logger()

    override fun put(key: String, bytes: ByteArray): String {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO run_payload_blobs (key, body) VALUES (?, ?) ON CONFLICT (key) DO NOTHING"
            ).use { stmt ->
                stmt.setString(1, key)
                stmt.setString(2, String(bytes, Charsets.UTF_8))
                stmt.executeUpdate()
            }
        }
        return key
    }

    override fun get(key: String): ByteArray? =
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT body FROM run_payload_blobs WHERE key = ?").use { stmt ->
                    stmt.setString(1, key)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) rs.getString(1)?.toByteArray(Charsets.UTF_8) else null
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[payloads] blob read failed key={}: {}", key.take(12), e.message)
            null
        }
}
