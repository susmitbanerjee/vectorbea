package com.vectorbea.api.db

import com.vectorbea.api.http.fromJson
import com.vectorbea.api.http.toJson
import org.postgresql.util.PGobject
import java.sql.PreparedStatement
import java.sql.ResultSet

/**
 * JSONB column helpers for plain JDBC.
 *
 * Postgres JDBC represents JSONB columns as [PGobject] with type = "jsonb".
 * These helpers wrap the conversion so no raw PGobject handling leaks
 * into repository code.
 *
 * Writing:
 *   stmt.setJsonb(3, mapOf("key" to "value"))
 *
 * Reading:
 *   val config = rs.getJsonb<Map<String, Any>>("config_json")
 *   val config = rs.getJsonbOrNull<Map<String, Any>>("config_json")
 */

// ── Writing ───────────────────────────────────────────────────────────────────

/**
 * Converts [value] to a Postgres JSONB [PGobject].
 * Pass the result to [PreparedStatement.setObject].
 */
fun toJsonb(value: Any): PGobject = PGobject().apply {
    type = "jsonb"
    this.value = toJson(value)
}

/**
 * Sets parameter [index] to a JSONB value serialized from [value].
 * If [value] is null, sets the parameter to SQL NULL.
 */
fun PreparedStatement.setJsonb(index: Int, value: Any?): PreparedStatement {
    if (value == null) setNull(index, java.sql.Types.OTHER)
    else setObject(index, toJsonb(value))
    return this
}

// ── Reading ───────────────────────────────────────────────────────────────────

/**
 * Reads a JSONB column from [ResultSet] and deserializes to type [T].
 * Throws [IllegalStateException] if the column is null.
 */
inline fun <reified T> ResultSet.getJsonb(columnLabel: String): T {
    val raw = getString(columnLabel)
        ?: throw IllegalStateException("JSONB column '$columnLabel' was null; use getJsonbOrNull")
    return fromJson(raw)
}

/**
 * Reads a JSONB column from [ResultSet] and deserializes to type [T].
 * Returns null if the column value is SQL NULL.
 */
inline fun <reified T> ResultSet.getJsonbOrNull(columnLabel: String): T? {
    val raw = getString(columnLabel) ?: return null
    return fromJson(raw)
}

/**
 * Reads a JSONB column and returns it as a raw JSON string.
 * Useful when the downstream caller will re-serialize it.
 */
fun ResultSet.getJsonbString(columnLabel: String): String =
    getString(columnLabel) ?: "{}"

/**
 * Reads a JSONB column and returns it as a raw JSON string, or null.
 */
fun ResultSet.getJsonbStringOrNull(columnLabel: String): String? =
    getString(columnLabel)

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Empty JSON object as a JSONB PGobject — use as a default for non-null JSONB columns. */
val JSONB_EMPTY_OBJECT: PGobject = toJsonb(emptyMap<String, Any>())

/** Empty JSON array as a JSONB PGobject — use as a default for array JSONB columns. */
val JSONB_EMPTY_ARRAY: PGobject = toJsonb(emptyList<Any>())
