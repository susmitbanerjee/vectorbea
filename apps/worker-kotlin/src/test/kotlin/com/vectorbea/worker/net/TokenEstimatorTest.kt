package com.vectorbea.worker.net

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The estimate has to be within 10% at p95 on real agent prompts.
 *
 * ── WHY THIS NUMBER, AND WHY p95 RATHER THAN A MEAN ─────────────────────────
 * The old estimate was `characters / 4`, which under-reserved agent prompts by
 * 15-36% — always in the same direction, and worst at high tool counts and deep
 * iterations, which is when a fan-out is at full width. A mean would have looked
 * survivable: it is the tail calls that breach the provider's limit, and a p95
 * error of 35% means one call in twenty reserves two thirds of what it spends.
 *
 * ── WHAT "REAL AGENT PROMPTS" MEANS HERE ────────────────────────────────────
 * The prompts are built by `AgentPromptBuilder`'s own shape: a fixed prose
 * scaffold, then the tool catalogue serialised with Jackson's default pretty
 * printer, then accumulated JSON observations. That is what makes them tokenize
 * badly — two-space indentation, one field per line, every key quoted — and a
 * test that fed the estimator prose would pass while the production path failed.
 *
 * ── AND WHAT GROUND TRUTH IS ────────────────────────────────────────────────
 * jtokkit itself, which IS the provider's tokenizer for OpenAI models. For those
 * the test is exact rather than approximate. For Anthropic and Google no offline
 * tokenizer exists, so the assertion there is on the CORRECTION LOOP: given a
 * stream of real ratios, it must converge to within the same 10%.
 */
class TokenEstimatorTest {

    private val mapper = ObjectMapper()

    // ── Prompt construction, matching AgentPromptBuilder ─────────────────────

    private fun toolCatalogue(tools: Int, fieldsPerTool: Int): String =
        mapper.writerWithDefaultPrettyPrinter().writeValueAsString(
            (0 until tools).map { t ->
                mapOf(
                    "id" to "3f2b8c1a-9d4e-4a7b-8c31-%012d".format(t),
                    "name" to "tool_$t",
                    "description" to "Look up tool_$t records and return the matching rows.",
                    "inputSchema" to mapOf(
                        "type" to "object",
                        "properties" to (0 until fieldsPerTool).associate { f ->
                            "field_$f" to mapOf(
                                "type" to "string",
                                "description" to "The ${f}th input field for tool_$t.")
                        },
                        "required" to listOf("field_0"),
                    ),
                )
            })

    private fun observations(n: Int): String =
        mapper.writerWithDefaultPrettyPrinter().writeValueAsString(
            (0 until n).map { i ->
                mapOf(
                    "step" to i,
                    "tool" to "tool_${i % 4}",
                    "output" to mapOf(
                        "rows" to (0 until 6).map { r ->
                            mapOf("id" to "rec-$i-$r", "status" to "active",
                                "amount" to 1234.56, "updatedAt" to "2026-09-0${1 + r % 9}T10:00:00Z")
                        },
                    ),
                )
            })

    private val scaffold = """
        You are Researcher. Specialist.

        INSTRUCTIONS:
        Find the account, check its billing status, and summarise anything unusual.

        You MUST respond with a single JSON object representing your next action.

        ALLOWED ACTIONS:
        - THINK: Internal reasoning step. No external call.
        - CALL_TOOL: Call one of the allowed tools below.
        - FINAL: You have enough information to produce the final answer.
        - ASK_APPROVAL: You need human approval before proceeding.
        - FAIL: You cannot complete the task. Explain why in failReason.
    """.trimIndent()

    private fun prompt(tools: Int, fields: Int, obs: Int): List<Map<String, Any>> = listOf(
        mapOf("role" to "system",
            "content" to "$scaffold\n\nALLOWED TOOLS:\n${toolCatalogue(tools, fields)}"),
        mapOf("role" to "user",
            "content" to "TASK: reconcile the account.\n\nOBSERVATIONS:\n${observations(obs)}"),
    )

    /** What the old implementation did, kept so the improvement is measurable. */
    private fun charsOverFour(messages: List<Map<String, Any>>, maxTokens: Int): Long =
        messages.sumOf { ((it["content"] as? String)?.length ?: 0) } / 4L + maxTokens

    /** The provider's own count, for an OpenAI model: jtokkit is exact there. */
    private fun groundTruth(messages: List<Map<String, Any>>): Long {
        val enc = com.knuddels.jtokkit.Encodings.newLazyEncodingRegistry()
            .getEncoding(com.knuddels.jtokkit.api.EncodingType.CL100K_BASE)
        return messages.sumOf { enc.countTokens(it["content"] as String) + 4L }
    }

    /** The shapes an agent actually sends, across its loop. */
    private val shapes = listOf(
        Triple(0, 0, 0), Triple(3, 3, 0), Triple(3, 3, 4),
        Triple(8, 5, 0), Triple(8, 5, 6), Triple(8, 5, 14),
        Triple(14, 6, 10), Triple(20, 6, 18), Triple(20, 8, 30),
        Triple(5, 4, 22), Triple(12, 5, 2), Triple(1, 2, 40),
    )

    // ── The acceptance criterion ─────────────────────────────────────────────

    @Test
    fun `estimate error is within ten percent at p95 on real agent prompts`() {
        val est = TokenEstimator(EstimateCorrection.none())
        val errors = shapes.map { (t, f, o) ->
            val messages = prompt(t, f, o)
            val actual = groundTruth(messages)
            val reserved = est.estimate("gpt-4o-mini", messages, 1024).correctedInput
            Math.abs(reserved - actual).toDouble() / actual
        }.sorted()

        val p95 = errors[Math.min(errors.size - 1, Math.ceil(0.95 * errors.size).toInt() - 1)]
        assertTrue(p95 <= 0.10,
            "p95 estimate error was ${"%.1f".format(p95 * 100)}%, over the 10% budget. " +
            "Per-shape: ${errors.map { "%.1f%%".format(it * 100) }}")
    }

    /**
     * And it is a real improvement, not a re-labelling.
     *
     * Asserted rather than assumed: if the new estimator were no better than
     * `chars / 4` the criterion above would still be worth keeping, but the
     * dependency would not.
     */
    @Test
    fun `the tokenizer beats the character heuristic it replaced`() {
        val est = TokenEstimator(EstimateCorrection.none())
        var oldWorse = 0
        shapes.forEach { (t, f, o) ->
            val messages = prompt(t, f, o)
            val actual = groundTruth(messages)
            val new = Math.abs(est.estimate("gpt-4o-mini", messages, 0).correctedInput - actual)
            val old = Math.abs(charsOverFour(messages, 0) - actual)
            if (old > new) oldWorse++
        }
        assertTrue(oldWorse >= shapes.size - 1,
            "the character heuristic was as good or better on ${shapes.size - oldWorse} " +
            "of ${shapes.size} shapes — the tokenizer is not earning its dependency")
    }

    /**
     * The old estimate under-reserved, which is the direction that causes 429s.
     *
     * Pinned as a fact about what was fixed. If someone reverts to `chars / 4`
     * this states, in a failing assertion, what they are reintroducing.
     */
    @Test
    fun `the character heuristic under-reserved schema-heavy prompts`() {
        val messages = prompt(tools = 20, fields = 6, obs = 18)
        val actual = groundTruth(messages)
        val old = charsOverFour(messages, 0)
        assertTrue(old < actual,
            "chars/4 estimated $old against an actual $actual — this test encodes " +
            "the under-reservation that motivated the change and it no longer holds")
    }

    // ── Shape classification ─────────────────────────────────────────────────

    @Test
    fun `prompt shapes are told apart`() {
        assertEquals(TokenEstimator.Shape.PROSE,
            TokenEstimator.Shape.of(prompt(0, 0, 0)))
        assertEquals(TokenEstimator.Shape.SCHEMA_HEAVY,
            TokenEstimator.Shape.of(prompt(20, 6, 0)))
        assertEquals(TokenEstimator.Shape.OBSERVATION_HEAVY,
            TokenEstimator.Shape.of(prompt(1, 2, 60)))
    }

    // ── The correction loop ──────────────────────────────────────────────────

    /**
     * For the providers whose tokenizer we do not have, the loop closes the gap.
     *
     * Anthropic bills roughly 12% above what cl100k counts on this kind of
     * content. Simulated here as a constant bias, because the property being
     * tested is that a systematic bias is LEARNED — the exact figure is a
     * property of the provider, not of this code.
     */
    @Test
    fun `the correction factor converges on a systematic provider bias`() {
        val correction = InProcessEstimateCorrection()
        val est = TokenEstimator(correction)
        val messages = prompt(8, 5, 6)
        val bias = 1.12

        val before = est.estimate("claude-opus-5", messages, 0)
        val rawError = Math.abs(before.correctedInput - before.rawInputTokens * bias) /
            (before.rawInputTokens * bias)
        assertTrue(rawError > 0.05,
            "the simulated bias is too small to be worth correcting; this test would " +
            "pass whether or not the loop worked")

        repeat(200) {
            val e = est.estimate("claude-opus-5", messages, 0)
            est.record(e, (e.rawInputTokens * bias).toLong())
        }

        val after = est.estimate("claude-opus-5", messages, 0)
        val corrected = Math.abs(after.correctedInput - after.rawInputTokens * bias) /
            (after.rawInputTokens * bias)
        assertTrue(corrected <= 0.10,
            "after 200 samples the correction was still ${"%.1f".format(corrected * 100)}% out; " +
            "factor=${after.factor}")
    }

    /**
     * The factor can never reduce a reservation below the tokenizer's count.
     *
     * The failure being fixed is systematic UNDER-reservation. A feedback loop
     * able to reintroduce it would do so silently and with the authority of
     * measured data, which is worse than no feedback loop at all.
     */
    @Test
    fun `the correction factor never drops below one`() {
        val correction = InProcessEstimateCorrection()
        val est = TokenEstimator(correction)
        val messages = prompt(3, 3, 0)
        /* A provider that consistently bills HALF of what we counted. */
        repeat(500) {
            val e = est.estimate("gpt-4o-mini", messages, 0)
            est.record(e, (e.rawInputTokens * 0.5).toLong())
        }
        assertTrue(est.estimate("gpt-4o-mini", messages, 0).factor >= 1.0,
            "the correction dropped below 1.0 and is now shrinking reservations below " +
            "the tokenizer's own count")
    }

    /**
     * A handful of samples does not move it.
     *
     * A factor derived from three calls is noise, and applying it would make the
     * first minutes after every deploy worse than no correction at all.
     */
    @Test
    fun `the factor is not applied before it has enough samples`() {
        val correction = InProcessEstimateCorrection()
        val est = TokenEstimator(correction)
        val messages = prompt(3, 3, 0)
        repeat(5) {
            val e = est.estimate("gpt-4o-mini", messages, 0)
            est.record(e, e.rawInputTokens * 2)
        }
        assertEquals(1.0, est.estimate("gpt-4o-mini", messages, 0).factor,
            "a factor was applied from five samples")
    }

    /**
     * Two shapes on one model do not average into a number that fits neither.
     *
     * The residual error is not a property of the model alone: a prompt whose
     * bulk is tool schemas mis-estimates differently from one whose bulk is
     * observations, and one factor per model would split the difference badly.
     */
    @Test
    fun `shapes learn their own factors`() {
        val correction = InProcessEstimateCorrection()
        val est = TokenEstimator(correction)
        val schema = prompt(20, 6, 0)
        val observation = prompt(1, 2, 60)

        repeat(200) {
            val a = est.estimate("gpt-4o-mini", schema, 0)
            est.record(a, (a.rawInputTokens * 1.30).toLong())
            val b = est.estimate("gpt-4o-mini", observation, 0)
            est.record(b, (b.rawInputTokens * 1.02).toLong())
        }

        val fSchema = est.estimate("gpt-4o-mini", schema, 0).factor
        val fObs = est.estimate("gpt-4o-mini", observation, 0).factor
        assertTrue(fSchema > fObs + 0.10,
            "the two shapes converged on the same factor ($fSchema vs $fObs) — they are " +
            "sharing a cell, and each is now wrong in a different direction")
    }
}
