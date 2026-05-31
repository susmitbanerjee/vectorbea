package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class DbFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: ""
        val sql = e.dbSqlState
        if (sql != null) return when (sql) {
            "28P01","28000" -> mk(FailureCategory.AUTH_FAILURE, "DB_AUTH_FAILED", FailureSeverity.HIGH, false, "Database authentication failed.")
            "42P01" -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_TABLE_NOT_FOUND", FailureSeverity.HIGH, false, "Table does not exist. SQLSTATE 42P01")
            "42703" -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_COLUMN_NOT_FOUND", FailureSeverity.HIGH, false, "Column does not exist. SQLSTATE 42703")
            "23505" -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_UNIQUE_CONSTRAINT", FailureSeverity.MEDIUM, false, "Unique constraint violation: duplicate record.")
            "23503" -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_FOREIGN_KEY_CONSTRAINT", FailureSeverity.MEDIUM, false, "Foreign key constraint violation.")
            "57014" -> mk(FailureCategory.TIMEOUT, "DB_STATEMENT_TIMEOUT", FailureSeverity.MEDIUM, true, "Query exceeded statement timeout.")
            "25006","25P02" -> mk(FailureCategory.DB_WRITE_BLOCKED, "DB_READ_ONLY_VIOLATION", FailureSeverity.HIGH, false, "Write on read-only connection.")
            else -> null
        }
        return when {
            msg.contains("does not exist") && (msg.contains("table") || msg.contains("relation")) -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_TABLE_NOT_FOUND", FailureSeverity.HIGH, false, "Table or relation does not exist.")
            msg.contains("does not exist") && msg.contains("column") -> mk(FailureCategory.DB_QUERY_FAILURE, "DB_COLUMN_NOT_FOUND", FailureSeverity.HIGH, false, "Column does not exist.")
            msg.contains("read-only") || msg.contains("read only") -> mk(FailureCategory.DB_WRITE_BLOCKED, "DB_READ_ONLY_VIOLATION", FailureSeverity.HIGH, false, "Write on read-only connection.")
            msg.contains("connection refused") || msg.contains("could not connect") -> mk(FailureCategory.CONNECTION_FAILURE, "DB_CONNECTION_REFUSED", FailureSeverity.HIGH, true, "Could not connect to database.")
            msg.contains("timeout") || msg.contains("timed out") -> mk(FailureCategory.TIMEOUT, "DB_TIMEOUT", FailureSeverity.MEDIUM, true, "Database operation timed out.")
            msg.contains("password authentication failed") || msg.contains("authentication failed") -> mk(FailureCategory.AUTH_FAILURE, "DB_AUTH_FAILED", FailureSeverity.HIGH, false, "Database authentication failed.")
            else -> null
        }
    }
    private fun mk(cat: FailureCategory, code: String, sev: FailureSeverity, retry: Boolean, sum: String) =
        FailureClassification(cat, code, sev, retry, summary = sum)
}
