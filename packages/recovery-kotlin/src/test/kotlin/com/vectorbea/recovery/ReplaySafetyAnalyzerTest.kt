package com.vectorbea.recovery

import com.vectorbea.recovery.model.ReplaySafety
import com.vectorbea.recovery.policy.ReplaySafetyAnalyzer
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class ReplaySafetyAnalyzerTest {
    private val a = ReplaySafetyAnalyzer()
    @Test fun httpGetSafe() = assertEquals(ReplaySafety.SAFE_TO_REPLAY, a.analyze("http_tool","GET",false))
    @Test fun dbReadSafe() = assertEquals(ReplaySafety.SAFE_TO_REPLAY, a.analyze("db_read","SELECT",false))
    @Test fun llmSafe() = assertEquals(ReplaySafety.SAFE_TO_REPLAY, a.analyze("llm",null,false))
    @Test fun dbWriteRequiresApproval() = assertEquals(ReplaySafety.REQUIRES_APPROVAL, a.analyze("db_write","INSERT",false))
    @Test fun httpPostWithIdempotencyKey() = assertEquals(ReplaySafety.IDEMPOTENT_WITH_KEY, a.analyze("http_tool","POST",true))
    @Test fun paymentNotReplayable() = assertEquals(ReplaySafety.NOT_REPLAYABLE, a.analyze("payment",null,false,true))
    @Test fun notificationRequiresApproval() = assertEquals(ReplaySafety.REQUIRES_APPROVAL, a.analyze("notification",null,false))
    @Test fun branchSafe() = assertEquals(ReplaySafety.SAFE_TO_REPLAY, a.analyze("branch",null,false))
}
