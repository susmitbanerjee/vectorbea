package com.vectorbea.recovery.policy
import com.vectorbea.recovery.model.ReplaySafety

class ReplaySafetyAnalyzer {
    fun analyze(nodeType: String?, operationType: String?, hasIdempotencyKey: Boolean, isIrreversible: Boolean = false): ReplaySafety {
        if (isIrreversible) return ReplaySafety.NOT_REPLAYABLE
        val nt = nodeType?.lowercase() ?: ""
        val op = operationType?.uppercase() ?: ""
        return when {
            nt in setOf("llm","agent","branch","join","transform","checkpoint") -> ReplaySafety.SAFE_TO_REPLAY
            op == "GET" || op == "SELECT" || op == "READ" -> ReplaySafety.SAFE_TO_REPLAY
            nt == "db_read" -> ReplaySafety.SAFE_TO_REPLAY
            nt == "trigger" || nt == "timer" -> ReplaySafety.SAFE_TO_REPLAY
            hasIdempotencyKey -> ReplaySafety.IDEMPOTENT_WITH_KEY
            op in setOf("POST","PUT","PATCH") || nt in setOf("http_tool") -> ReplaySafety.REQUIRES_APPROVAL
            nt == "db_write" || op in setOf("INSERT","UPDATE","DELETE") -> ReplaySafety.REQUIRES_APPROVAL
            nt in setOf("notification","email","send") -> ReplaySafety.REQUIRES_APPROVAL
            nt == "payment" || nt == "charge" -> ReplaySafety.NOT_REPLAYABLE
            else -> ReplaySafety.UNKNOWN
        }
    }
}
