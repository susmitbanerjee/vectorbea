package com.vectorbea.worker.durable.archive

import java.io.OutputStream
import java.io.Writer
import java.sql.ResultSet
import java.sql.Types
import java.util.zip.GZIPOutputStream

/**
 * How a partition's rows are laid down in the warm tier.
 *
 * ── ON PARQUET, HONESTLY ────────────────────────────────────────────────────
 * §12.1 says warm is Parquet, and Parquet is the right answer: a warm-tier read
 * is almost always "one column, one workspace, one month", which is exactly what
 * columnar storage and predicate pushdown are for.
 *
 * It is NOT what ships here. `parquet-avro` drags in the Hadoop client tree —
 * tens of megabytes and a transitive graph this worker has no other use for —
 * and CLAUDE.md is explicit that a new dependency is a question, not a decision.
 * So this interface exists, [NdJsonGzEncoder] implements it, and a
 * `ParquetEncoder` is a class next to it the day the dependency is approved. The
 * `format` column on `run_trace_archives` records which one wrote each object,
 * so a bucket holding both is still readable.
 *
 * NDJSON+gzip is not a placeholder in the meantime. `COPY`, DuckDB's
 * `read_json_auto`, Athena, BigQuery and Spark all read it directly, it streams
 * without a schema round trip, and it compresses a trace table — which is mostly
 * repeated type names and JSON — to a fraction of its on-disk size.
 *
 * ── WHAT AN ENCODER MUST NOT DO ─────────────────────────────────────────────
 * Not sanitize. Invariant 4 puts sanitization at the write boundary, once:
 * `RunEventStore`, `SpanWriter` and `PayloadStore` are handed clean values and
 * store what they are given. By the time rows reach here they have been through
 * that boundary, and a second pass here would either be a no-op or evidence that
 * the first one is broken — and the fix for the second case is upstream, not a
 * filter on the way out.
 */
interface ArchiveEncoder {
    /** File extension and `run_trace_archives.format`, e.g. `ndjson.gz`. */
    val format: String

    /**
     * Stream every row of [rs] into [out]. Returns the row count.
     *
     * Must not buffer the result set: partitions are exported precisely because
     * they are large.
     */
    fun encode(rs: ResultSet, out: OutputStream): Long
}

/**
 * Newline-delimited JSON, gzipped. One object per row, column names as keys.
 *
 * Column names come off `ResultSetMetaData` rather than a hard-coded list, so
 * the exporter survives a column being added to `run_events` or `run_spans`
 * without a matching edit here. A schema drift that silently dropped a column
 * from the archive would only be discovered when someone needed it.
 */
class NdJsonGzEncoder : ArchiveEncoder {
    override val format: String = "ndjson.gz"

    override fun encode(rs: ResultSet, out: OutputStream): Long {
        var rows = 0L
        /* The gzip stream is closed by `use`, which writes the trailer. Without
           that the file is a valid prefix of a gzip member and every reader
           rejects it — a corruption that only shows up on the read, long after
           the partition it came from is gone. */
        GZIPOutputStream(out, 16 * 1024).use { gz ->
            val w = gz.writer(Charsets.UTF_8).buffered(64 * 1024)
            val meta = rs.metaData
            val n = meta.columnCount
            val names = (1..n).map { meta.getColumnLabel(it) }
            val types = (1..n).map { meta.getColumnType(it) }
            while (rs.next()) {
                w.write("{")
                var first = true
                for (i in 1..n) {
                    val raw = rs.getObject(i)
                    if (raw == null && rs.wasNull()) continue   // omit nulls; smaller and lossless
                    if (!first) w.write(",")
                    first = false
                    writeJsonString(w, names[i - 1])
                    w.write(":")
                    writeValue(w, rs, i, types[i - 1])
                }
                w.write("}\n")
                rows++
            }
            w.flush()
        }
        return rows
    }

    /**
     * JSON columns are emitted as JSON, not as a string containing JSON.
     *
     * The difference decides whether a warm-tier query can reach inside
     * `metadata_json_sanitized` or has to parse it a second time per row. The
     * validity check is deliberate: a `jsonb` column is always valid JSON, but a
     * `text` column that merely looks like one is not, and emitting it raw would
     * produce a file that fails to parse at row nine million.
     */
    private fun writeValue(w: Writer, rs: ResultSet, i: Int, type: Int) {
        when (type) {
            Types.BIGINT, Types.INTEGER, Types.SMALLINT, Types.TINYINT -> w.write(rs.getLong(i).toString())
            Types.BOOLEAN, Types.BIT -> w.write(if (rs.getBoolean(i)) "true" else "false")
            Types.DOUBLE, Types.FLOAT, Types.REAL, Types.NUMERIC, Types.DECIMAL -> {
                val d = rs.getDouble(i)
                if (d.isFinite()) w.write(d.toString()) else writeJsonString(w, rs.getString(i))
            }
            Types.OTHER -> {
                val s = rs.getString(i)
                if (s != null && looksLikeJson(s)) w.write(s) else writeJsonString(w, s ?: "")
            }
            else -> writeJsonString(w, rs.getString(i) ?: "")
        }
    }

    private fun looksLikeJson(s: String): Boolean {
        val t = s.trim()
        if (t.length < 2) return false
        if (!((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))) return false
        return runCatching { MAPPER.readTree(t) }.isSuccess
    }

    private fun writeJsonString(w: Writer, s: String) {
        w.write("\"")
        for (c in s) {
            when {
                c == '"' -> w.write("\\\"")
                c == '\\' -> w.write("\\\\")
                c == '\n' -> w.write("\\n")
                c == '\r' -> w.write("\\r")
                c == '\t' -> w.write("\\t")
                c < ' ' -> w.write("\\u%04x".format(c.code))
                else -> w.write(c.code)
            }
        }
        w.write("\"")
    }

    private companion object {
        val MAPPER = com.fasterxml.jackson.databind.ObjectMapper()
    }
}
