package com.vectorbea.recovery

import com.vectorbea.recovery.sanitize.RecoverySanitizer
import org.junit.jupiter.api.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

class RecoverySanitizerTest {
    @Test fun redactsBearerToken() {
        val r = RecoverySanitizer.sanitizeMessage("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.realtoken.sig")
        assertNotNull(r); assertFalse(r.contains("realtoken"), "Token should be redacted: $r")
    }
    @Test fun redactsApiKey() {
        val r = RecoverySanitizer.sanitizeMessage("api_key: sk-abcdef1234567890abcdef1234567890")
        assertNotNull(r); assertFalse(r.contains("abcdef1234567890abcdef1234567890"), "API key should be redacted: $r")
    }
    @Test fun redactsDbConnectionString() {
        val r = RecoverySanitizer.sanitizeMessage("postgresql://user:mypassword@db.neon.tech/mydb")
        assertNotNull(r); assertFalse(r.contains("mypassword"), "Password should be redacted: $r")
    }
    @Test fun safeMsgUnchanged() {
        val msg = "Table not found: workflows"
        assert(RecoverySanitizer.sanitizeMessage(msg) == msg)
    }
    @Test fun truncatesLongLogs() {
        val lines = (1..100).map { "log line $it" }
        assert(RecoverySanitizer.sanitizeLogs(lines).size <= 20)
    }
    @Test fun sanitizesMetadata() {
        val meta = mapOf("Authorization" to "Bearer secrettoken12345", "nodeId" to "n1")
        val r = RecoverySanitizer.sanitizeMetadata(meta)
        assertFalse((r["Authorization"] as? String)?.contains("secrettoken12345") == true)
    }
}
