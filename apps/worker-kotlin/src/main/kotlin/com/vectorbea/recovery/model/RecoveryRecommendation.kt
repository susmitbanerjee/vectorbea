package com.vectorbea.recovery.model

data class RecoveryRecommendation(
    val action: RecoveryAction,
    val retryable: Boolean,
    val autoReplaySafe: Boolean,
    val requiresHumanApproval: Boolean,
    val confidence: Double = 1.0,
    val risk: String = "low",
    val summary: String,
    val recommendedAction: String,
    val remediation: Map<String, Any?> = emptyMap(),
    val checkpointId: String? = null,
    val delayMs: Long? = null,
    val estimatedCostCents: Long? = null,
)
