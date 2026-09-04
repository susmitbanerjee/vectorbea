package com.vectorbea.worker.runtime.executor

/**
 * How many bind parameters a statement actually asks for, and where.
 *
 * THE BUG THIS EXISTS TO FIX
 * ──────────────────────────
 * `ToolNodeExecutor` used to attach every resolved input to a database tool as a
 * positional parameter whenever the SQL carried no `{{…}}` templates:
 *
 *     result["params"] = resolvedInputs.values.toList()
 *
 * Nothing checked whether the statement had any placeholders to bind them to.
 * `DbWriteNodeExecutor` then called `setObject(1, …)` on a statement with none, and
 * the driver answered
 *
 *     The column index is out of range: 1, number of columns: 0.
 *
 * which describes the driver's predicament and not the user's mistake. The statement
 * did not need parameters; the platform supplied them anyway.
 *
 * Counting is literal-aware because a `?` or `$1` inside a string literal, a quoted
 * identifier or a comment is TEXT, not a placeholder. `INTERVAL '$1 days'` binds
 * nothing — the existing comment in `ToolNodeExecutor` calls out exactly that trap as
 * the cause of this same error.
 */
internal object SqlPlaceholders {

    /**
     * @param questionMarks JDBC `?` placeholders outside literals and comments.
     * @param dollarIndices `$N` indices outside literals, in order of appearance.
     */
    data class Analysis(
        val questionMarks: Int,
        val dollarIndices: List<Int>,
    ) {
        /** True when the statement asks for nothing to be bound. */
        val isEmpty: Boolean get() = questionMarks == 0 && dollarIndices.isEmpty()
    }

    fun analyse(sql: String): Analysis {
        var questionMarks = 0
        val dollars = mutableListOf<Int>()

        var i = 0
        while (i < sql.length) {
            when {
                // Single-quoted literal. '' is an escaped quote, not a terminator.
                sql[i] == '\'' -> {
                    i++
                    while (i < sql.length) {
                        if (sql[i] == '\'') {
                            if (i + 1 < sql.length && sql[i + 1] == '\'') i += 2 else { i++; break }
                        } else i++
                    }
                }

                // Double-quoted identifier. "" is an escaped quote.
                sql[i] == '"' -> {
                    i++
                    while (i < sql.length) {
                        if (sql[i] == '"') {
                            if (i + 1 < sql.length && sql[i + 1] == '"') i += 2 else { i++; break }
                        } else i++
                    }
                }

                // Line comment.
                sql.startsWith("--", i) -> {
                    val nl = sql.indexOf('\n', i)
                    i = if (nl < 0) sql.length else nl + 1
                }

                // Block comment. Postgres nests them.
                sql.startsWith("/*", i) -> {
                    var depth = 1
                    i += 2
                    while (i < sql.length && depth > 0) {
                        when {
                            sql.startsWith("/*", i) -> { depth++; i += 2 }
                            sql.startsWith("*/", i) -> { depth--; i += 2 }
                            else -> i++
                        }
                    }
                }

                sql[i] == '?' -> { questionMarks++; i++ }

                sql[i] == '$' && i + 1 < sql.length && sql[i + 1].isDigit() -> {
                    var j = i + 1
                    while (j < sql.length && sql[j].isDigit()) j++
                    sql.substring(i + 1, j).toIntOrNull()?.let { dollars += it }
                    i = j
                }

                else -> i++
            }
        }

        return Analysis(questionMarks, dollars)
    }

    /**
     * Rewrite `$1, $2, …` into the `?` form pgjdbc actually binds.
     *
     * The platform's own documentation and comments describe `$N` as the supported
     * positional syntax, and users write it, but pgjdbc has never recognised it — it
     * only binds `?`. So a `$N` statement reported zero parameters and every attempt
     * to bind one failed. Rewriting makes the documented form work rather than
     * silently not working.
     *
     * Returns null when the indices are not a simple ascending `1..n` in order of
     * appearance. Reordering or reusing parameters is legal Postgres but the caller
     * has no parameter NAMES to reorder by, so guessing would bind the right values
     * into the wrong columns — a wrong write is worse than a refused one.
     */
    fun rewriteDollarsToQuestionMarks(sql: String): String? {
        val analysis = analyse(sql)
        if (analysis.dollarIndices.isEmpty()) return null
        if (analysis.questionMarks > 0) return null // mixed styles: refuse to guess
        if (analysis.dollarIndices != (1..analysis.dollarIndices.size).toList()) return null

        val out = StringBuilder(sql.length)
        var i = 0
        while (i < sql.length) {
            when {
                sql[i] == '\'' -> {
                    val start = i
                    i++
                    while (i < sql.length) {
                        if (sql[i] == '\'') {
                            if (i + 1 < sql.length && sql[i + 1] == '\'') i += 2 else { i++; break }
                        } else i++
                    }
                    out.append(sql, start, i)
                }

                sql[i] == '"' -> {
                    val start = i
                    i++
                    while (i < sql.length) {
                        if (sql[i] == '"') {
                            if (i + 1 < sql.length && sql[i + 1] == '"') i += 2 else { i++; break }
                        } else i++
                    }
                    out.append(sql, start, i)
                }

                sql.startsWith("--", i) -> {
                    val nl = sql.indexOf('\n', i)
                    val end = if (nl < 0) sql.length else nl + 1
                    out.append(sql, i, end)
                    i = end
                }

                sql.startsWith("/*", i) -> {
                    val start = i
                    var depth = 1
                    i += 2
                    while (i < sql.length && depth > 0) {
                        when {
                            sql.startsWith("/*", i) -> { depth++; i += 2 }
                            sql.startsWith("*/", i) -> { depth--; i += 2 }
                            else -> i++
                        }
                    }
                    out.append(sql, start, i)
                }

                sql[i] == '$' && i + 1 < sql.length && sql[i + 1].isDigit() -> {
                    var j = i + 1
                    while (j < sql.length && sql[j].isDigit()) j++
                    out.append('?')
                    i = j
                }

                else -> { out.append(sql[i]); i++ }
            }
        }
        return out.toString()
    }
}
