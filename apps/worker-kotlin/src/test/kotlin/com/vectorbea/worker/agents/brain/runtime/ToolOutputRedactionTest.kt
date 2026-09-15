package com.vectorbea.worker.agents.brain.runtime

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What an agent is shown of a tool result.
 *
 * The base64 rule used to swallow every git commit SHA, so a GitHub workflow's
 * agent passed the literal "[REDACTED]" to get_commit and failed.
 */
class ToolOutputRedactionTest {

    private val guard = AgentSafetyGuard()

    @Test
    fun `commit SHAs and sha256 digests reach the agent intact`() {
        val sha = "9fceb02d0ae598e95dc970b74767f19372d61af8"
        val digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        val out = guard.sanitizeToolOutput("""{"sha":"$sha","tree":"$digest"}""", 10_000)
        assertTrue(out.contains(sha) && out.contains(digest), out)
        assertTrue(guard.sanitizeReasoningSummary("Fetch commit $sha").contains(sha))
    }

    @Test
    fun `tokens that only look long still do not`() {
        val opaque = "QWxhZGRpbjpvcGVuIHNlc2FtZQQWxhZGRpbjpvcGVuIHNlc2FtZQ"
        val out = guard.sanitizeToolOutput("""{"token":"$opaque","key":"sk-abc123DEF","jwt":"eyJ${"a".repeat(60)}"}""", 10_000)
        assertFalse(out.contains(opaque))
        assertTrue(out.contains("[REDACTED-KEY]") && out.contains("[REDACTED-JWT]"), out)
        // 41 hex characters is not a digest length, so it is not exempt.
        assertFalse(guard.sanitizeToolOutput("a".repeat(41), 10_000).contains("a".repeat(41)))
    }

    @Test
    fun `source file paths reach the agent intact, slash-bearing keys do not`() {
        val java = "src/main/java/com/susmitbanerjee/qrx/service/UserServiceImpl"
        val dir = "packages/graph-kotlin/src/main/kotlin/com/vectorbea/graph"
        val out = guard.sanitizeToolOutput(
            """{"files":["$java.java (modified)"],"patch":"diff --git a/$java.java b/$java.java --- a/$dir/WorkflowGraph.kt"}""",
            10_000)
        assertTrue(out.contains("$java.java") && out.contains("$dir/WorkflowGraph.kt"), out)
        assertFalse(out.contains("[REDACTED]"), out)

        val randomKey = "Zq8JfYk2PxW7hRtB3nLc/V9dGm4TsK1QwXyHjNb/Rp6aE"
        val capitals = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY/abc/def.txt"
        val redacted = guard.sanitizeToolOutput("""{"a":"$randomKey","b":"$capitals"}""", 10_000)
        assertFalse(redacted.contains(randomKey), redacted)
        assertFalse(redacted.contains("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"), redacted)
    }
}
