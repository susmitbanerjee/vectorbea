package com.vectorbea.worker.reliability

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Retry that does not make things worse.
 *
 * The tests that matter most here are the NEGATIVE ones. Getting a repair to work
 * is pleasant; refusing to retry the three cases that must not be retried is what
 * stops the system burning budget to reproduce a wrong answer.
 */
class RepairStrategyTest {

    private fun detail(
        message: String = "something went wrong",
        temperatureZero: Boolean = false,
    ) = RepairStrategy.FailureDetail(
        message = message,
        originalPrompt = "Extract the account owner from the email.",
        invalidOutput = """{"risk_score": 340}""",
        wasTemperatureZero = temperatureZero,
    )

    // ── The three that must not blind-retry ─────────────────────────────────

    @Test
    fun `groundedness failure escalates rather than retrying`() {
        // The same prompt at temperature 0 reproduces the same fabrication exactly.
        // A retry is not unlikely to help - it is guaranteed not to.
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.GROUNDEDNESS_FAILURE,
            attemptsSoFar = 0,
            detail = detail("The model cited text that is not in the input."),
        )
        assertTrue(d is RepairStrategy.Decision.Escalate,
            "groundedness must escalate, never repeat the same request: $d")
        d as RepairStrategy.Decision.Escalate
        assertTrue(d.forceTemperatureZero, "the cheap escalation comes first")
        assertFalse(d.requireHumanGate, "a human gate is the last resort, not the first")
    }

    @Test
    fun `groundedness at temperature zero escalates to a human when there is no stronger model`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.GROUNDEDNESS_FAILURE,
            attemptsSoFar = 0,
            detail = detail(temperatureZero = true),
            hasSecondaryProvider = false,
        ) as RepairStrategy.Decision.Escalate

        // Already deterministic, nowhere stronger to go: a person has to look.
        assertFalse(d.forceTemperatureZero, "it was already at 0")
        assertFalse(d.preferStrongerModel, "there is no secondary configured")
        assertTrue(d.requireHumanGate)
    }

    @Test
    fun `content filter fails immediately with an explanation`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.CONTENT_FILTER,
            attemptsSoFar = 0,
            detail = detail(),
        )
        assertTrue(d is RepairStrategy.Decision.Fail, "retrying a deterministic filter is futile: $d")
        d as RepairStrategy.Decision.Fail
        assertTrue(d.userMessage.contains("content policy"), d.userMessage)
        // The message must say WHY it was not retried, or the user assumes we gave up.
        assertTrue(d.userMessage.contains("not retried"), d.userMessage)
        assertEquals(0, FailureClassifier.policyFor(FailureClassifier.Kind.CONTENT_FILTER).maxAttempts)
    }

    @Test
    fun `the same rule failing twice stops rather than repairing again`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.ASSERTION_FAILURE,
            attemptsSoFar = 1,
            detail = detail("risk_score was 340, expected 0-100"),
            sameRuleTwice = true,
        )
        assertTrue(d is RepairStrategy.Decision.Fail,
            "two failures on one rule mean the prompt or contract is wrong: $d")
        d as RepairStrategy.Decision.Fail
        assertTrue(d.userMessage.contains("prompt or the contract is wrong"), d.userMessage)
    }

    // ── The high-yield path ─────────────────────────────────────────────────

    @Test
    fun `schema violation produces a repair prompt containing the output and the violation`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.SCHEMA_VIOLATION,
            attemptsSoFar = 0,
            detail = RepairStrategy.FailureDetail(
                message = "risk_score was 340, expected at most 100",
                originalPrompt = "Score the account risk.",
                invalidOutput = """{"risk_score": 340}""",
                schemaJson = """{"type":"object","properties":{"risk_score":{"type":"integer"}}}""",
            ),
        )
        assertTrue(d is RepairStrategy.Decision.Repair)
        d as RepairStrategy.Decision.Repair

        // All three parts must be present; a repair prompt missing any of them
        // recovers barely better than a blind retry.
        assertTrue(d.prompt.contains("Score the account risk."), "original task missing")
        assertTrue(d.prompt.contains("340"), "the model's own invalid output missing")
        assertTrue(d.prompt.contains("expected at most 100"), "the specific violation missing")
        assertTrue(d.prompt.contains("required structure"), "the schema missing")
    }

    @Test
    fun `repair caps at two attempts`() {
        val kinds = listOf(
            FailureClassifier.Kind.SCHEMA_VIOLATION,
            FailureClassifier.Kind.ASSERTION_FAILURE,
            FailureClassifier.Kind.TOOL_HALLUCINATION,
            FailureClassifier.Kind.PARSE_ERROR,
        )
        for (k in kinds) {
            assertEquals(2, FailureClassifier.policyFor(k).maxAttempts, "$k should allow 2 repairs")
            val exhausted = RepairStrategy.decide(k, attemptsSoFar = 2, detail = detail())
            assertTrue(exhausted is RepairStrategy.Decision.Fail, "$k must stop after 2: $exhausted")
        }
    }

    @Test
    fun `a hallucinated tool call is repaired with the real tool list`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.TOOL_HALLUCINATION,
            attemptsSoFar = 0,
            detail = RepairStrategy.FailureDetail(
                message = "The model called 'send_invoice', which is not available.",
                availableTools = listOf("lookup_account", "send_email"),
            ),
        ) as RepairStrategy.Decision.Repair

        assertTrue(d.prompt.contains("lookup_account"))
        assertTrue(d.prompt.contains("send_email"))
        assertTrue(d.prompt.contains("Do not invent a tool name"))
    }

    // ── Infrastructure failures ─────────────────────────────────────────────

    @Test
    fun `a 429 backs off and suspends rather than holding the slot`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.PROVIDER_429, attemptsSoFar = 0, detail = detail(),
        ) as RepairStrategy.Decision.Backoff
        assertTrue(d.suspend, "a run must never hold a worker permit while backing off")
        assertTrue(d.delayMs > 0)
    }

    @Test
    fun `a 5xx backs off without suspending and allows three attempts`() {
        val d = RepairStrategy.decide(
            FailureClassifier.Kind.PROVIDER_5XX, attemptsSoFar = 0, detail = detail(),
        ) as RepairStrategy.Decision.Backoff
        assertFalse(d.suspend)
        assertEquals(3, FailureClassifier.policyFor(FailureClassifier.Kind.PROVIDER_5XX).maxAttempts)
    }

    @Test
    fun `a timeout is retried once, not three times`() {
        assertEquals(1, FailureClassifier.policyFor(FailureClassifier.Kind.TIMEOUT).maxAttempts)
        val second = RepairStrategy.decide(
            FailureClassifier.Kind.TIMEOUT, attemptsSoFar = 1, detail = detail(),
        )
        assertTrue(second is RepairStrategy.Decision.Fail,
            "a second timeout has already spent the budget twice")
    }

    @Test
    fun `backoff is jittered so simultaneous failures do not retry together`() {
        val delays = (1..40).map {
            (RepairStrategy.decide(
                FailureClassifier.Kind.PROVIDER_5XX, attemptsSoFar = 2, detail = detail(),
            ) as RepairStrategy.Decision.Backoff).delayMs
        }
        assertTrue(delays.distinct().size > 5,
            "a fixed delay would have every failing run retry at the same instant: $delays")
    }

    // ── Classification ──────────────────────────────────────────────────────

    @Test
    fun `http status classifies before message text`() {
        // A 429 whose body mentions "invalid" is still a 429.
        assertEquals(FailureClassifier.Kind.PROVIDER_429,
            FailureClassifier.classify(httpStatus = 429, message = "invalid request, slow down"))
        assertEquals(FailureClassifier.Kind.PROVIDER_5XX,
            FailureClassifier.classify(httpStatus = 503))
    }

    @Test
    fun `contract signals classify unambiguously`() {
        assertEquals(FailureClassifier.Kind.SCHEMA_VIOLATION, FailureClassifier.classify(
            contractOutcome = FailureClassifier.ContractSignal.SCHEMA))
        assertEquals(FailureClassifier.Kind.GROUNDEDNESS_FAILURE, FailureClassifier.classify(
            contractOutcome = FailureClassifier.ContractSignal.GROUNDEDNESS))
    }

    @Test
    fun `an unclassifiable failure is NOT retried`() {
        // A new failure mode must surface as an unretried failure and get classified,
        // not be silently absorbed into a blind retry loop.
        val kind = FailureClassifier.classify(message = "something nobody has seen before")
        assertEquals(FailureClassifier.Kind.UNKNOWN, kind)
        val d = RepairStrategy.decide(kind, attemptsSoFar = 0, detail = detail())
        assertTrue(d is RepairStrategy.Decision.Fail)
    }

    @Test
    fun `content filter is recognised from provider prose`() {
        for (msg in listOf(
            "The response was filtered due to content_filter triggering",
            "This request was flagged by our safety system",
            "I cannot assist with that request",
        )) {
            assertEquals(FailureClassifier.Kind.CONTENT_FILTER,
                FailureClassifier.classify(message = msg), "not recognised: $msg")
        }
    }

    @Test
    fun `every policy carries a rationale the user can read`() {
        // The rationale is surfaced in the run detail. A blank one means a user sees
        // "not retried" with no explanation and assumes the platform gave up.
        for (kind in FailureClassifier.Kind.entries) {
            val p = FailureClassifier.policyFor(kind)
            assertTrue(p.rationale.length > 40, "$kind has a thin rationale: ${p.rationale}")
        }
    }
}
