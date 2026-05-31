package com.vectorbea.recovery

import com.vectorbea.recovery.model.*
import com.vectorbea.recovery.policy.RecoveryPolicyEngine
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class RecoveryPolicyEngineTest {
    private val engine = RecoveryPolicyEngine()
    private fun ctx(checkpoint: Boolean = false, cid: String? = null, safety: ReplaySafety = ReplaySafety.UNKNOWN) =
        RecoveryContext(checkpointAvailable = checkpoint, checkpointId = cid, replaySafety = safety)
    private fun cls(cat: FailureCategory, code: String = "X", retry: Boolean = false) =
        FailureClassification(cat, code, FailureSeverity.MEDIUM, retry, summary = "t")

    @Test fun rateLimit() { val r = engine.recommend(cls(FailureCategory.RATE_LIMIT),ctx()); assertEquals(RecoveryAction.WAIT_AND_RETRY,r.action); assertTrue(r.retryable) }
    @Test fun timeout() { assertEquals(RecoveryAction.RETRY_SAME_STEP, engine.recommend(cls(FailureCategory.TIMEOUT),ctx()).action) }
    @Test fun secretMissing() { val r = engine.recommend(cls(FailureCategory.AUTH_FAILURE,"SECRET_MISSING"),ctx()); assertEquals(RecoveryAction.ROTATE_SECRET,r.action); assertTrue(r.requiresHumanApproval) }
    @Test fun http401() { assertEquals(RecoveryAction.FIX_CONNECTION, engine.recommend(cls(FailureCategory.AUTH_FAILURE,"HTTP_401"),ctx()).action) }
    @Test fun mappingFailure() { val r = engine.recommend(cls(FailureCategory.MAPPING_FAILURE),ctx()); assertEquals(RecoveryAction.FIX_MAPPING,r.action); assertFalse(r.retryable) }
    @Test fun dbTableNotFound() { assertEquals(RecoveryAction.FIX_SCHEMA, engine.recommend(cls(FailureCategory.DB_QUERY_FAILURE,"DB_TABLE_NOT_FOUND"),ctx()).action) }
    @Test fun workerCrashedWithCheckpoint() {
        val r = engine.recommend(cls(FailureCategory.WORKER_CRASHED,retry=true), ctx(checkpoint=true,cid="ck1",safety=ReplaySafety.SAFE_TO_REPLAY))
        assertEquals(RecoveryAction.REPLAY_FROM_CHECKPOINT,r.action); assertEquals("ck1",r.checkpointId); assertTrue(r.autoReplaySafe)
    }
    @Test fun workerCrashedNoCheckpoint() { assertEquals(RecoveryAction.RETRY_SAME_STEP, engine.recommend(cls(FailureCategory.WORKER_CRASHED,retry=true),ctx()).action) }
    @Test fun approvalRejected() { val r = engine.recommend(cls(FailureCategory.APPROVAL_REJECTED),ctx()); assertEquals(RecoveryAction.NO_ACTION,r.action); assertFalse(r.retryable) }
    @Test fun unknown() { val r = engine.recommend(cls(FailureCategory.UNKNOWN),ctx()); assertEquals(RecoveryAction.REQUEST_HUMAN_APPROVAL,r.action); assertTrue(r.requiresHumanApproval) }
}
