package com.vectorbea.recovery.model

data class FailureClassification(
    val category: FailureCategory,
    val code: String,
    val severity: FailureSeverity,
    val retryable: Boolean,
    val deterministic: Boolean = true,
    val summary: String,
    val technicalSummary: String? = null,
    val confidence: Double = 1.0,
    val evidence: Map<String, Any?> = emptyMap(),
)
