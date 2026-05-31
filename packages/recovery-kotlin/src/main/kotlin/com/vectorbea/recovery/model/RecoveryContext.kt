package com.vectorbea.recovery.model

data class RecoveryContext(
    val recoveryMode: RecoveryMode = RecoveryMode.MANUAL,
    val replaySafety: ReplaySafety = ReplaySafety.UNKNOWN,
    val checkpointAvailable: Boolean = false,
    val checkpointId: String? = null,
    val idempotencyKeyAvailable: Boolean = false,
    val nodeRequiresApproval: Boolean = false,
    val workflowAllowsAutoRecovery: Boolean = false,
    val maxAutoRecoveryAttempts: Int = 3,
    val previousRecoveryAttempts: Int = 0,
    val retryPolicyAllowsRetry: Boolean = true,
    val retryDelayMs: Long? = null,
    val estimatedRecoveryCostCents: Long? = null,
    val recoveryBudgetRemainingCents: Long? = null,
)
