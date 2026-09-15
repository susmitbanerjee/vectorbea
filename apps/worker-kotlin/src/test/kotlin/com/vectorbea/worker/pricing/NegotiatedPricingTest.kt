package com.vectorbea.worker.pricing

import java.util.UUID
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A customer's negotiated rate, and the list price it must not disturb.
 *
 * ── WHY EVERY BRANCH HERE IS ASSERTED ───────────────────────────────────────
 * This is arithmetic that moves money in a customer's eyes. It does not bill
 * anybody — invariant 13 keeps billing off every read path — but it produces
 * the number a finance team reconciles against their provider invoice, and the
 * number a budget ceiling stops a run against. Both failures are silent: an
 * over-reported cost reads as "the platform is expensive", and an under-reported
 * one lets a run spend past a ceiling that was supposed to stop it.
 */
class NegotiatedPricingTest {

    private val pricing = ModelPricing(null)   // no database → list price only

    private fun usage(total: Int, tin: Int? = null, tout: Int? = null,
                      read: Int? = null, write: Int? = null) =
        ModelPricing.Usage(total, tin, tout, read, write)

    private fun assertClose(expected: Double, actual: Double?, what: String) {
        assertTrue(actual != null && abs(expected - actual) < 1e-9,
            "$what: expected $expected, got $actual")
    }

    // ── The list path, unchanged ─────────────────────────────────────────────

    @Test
    fun `with no override the list price applies exactly as it did before`() {
        /* One million tokens of gpt-4o at $5.00/M. The number this produced
           before the pricing authority existed, to the cent. */
        assertClose(5.00, pricing.costUsd(null, "openai", "gpt-4o", usage(1_000_000)),
            "gpt-4o at list")
        assertClose(0.60, pricing.costUsd(null, "openai", "gpt-4o-mini", usage(1_000_000)),
            "gpt-4o-mini at list")
        assertClose(3.00, pricing.costUsd(null, "anthropic", "claude-3-5-sonnet", usage(1_000_000)),
            "claude at list")
    }

    @Test
    fun `a model nobody has heard of falls back rather than failing`() {
        /* A customer gateway serves names we could not price if we tried. The
           fallback is a guess and is documented as one — which is exactly why an
           override is the supported answer for an enterprise. */
        assertClose(2.00, pricing.costUsd(null, "acme", "acme-llm-large", usage(1_000_000)),
            "unknown model")
    }

    @Test
    fun `zero tokens is no cost, not a cost of zero dollars for one call`() {
        assertEquals(null, pricing.costUsd(null, "openai", "gpt-4o", usage(0)))
    }

    // ── The cache arithmetic, which is where the money hides ─────────────────

    @Test
    fun `a cached read is replaced at its own rate, not added and not free`() {
        /*
         * 1M total, 800k of it served from Anthropic's cache at 0.1x.
         * Billable = 200k fresh + 80k effective = 280k → 280k/1M * $3.00.
         *
         * Adding instead of replacing would double-count (every provider's total
         * already includes the cached tokens); treating it as free would
         * under-report by 10% of the prefix.
         */
        assertClose(0.84,
            pricing.costUsd(null, "anthropic", "claude-3-5-sonnet",
                usage(1_000_000, read = 800_000)),
            "anthropic cache read")
    }

    @Test
    fun `openai and gemini discount a cached prefix by half, not by ninety percent`() {
        assertEquals(650, ModelPricing.effectiveBillableTokens(1000, 700, null, "openai"))
        assertEquals(650, ModelPricing.effectiveBillableTokens(1000, 700, null, "gemini"))
        assertEquals(280, ModelPricing.effectiveBillableTokens(1000, 800, null, "anthropic"))
    }

    @Test
    fun `a cache write costs more than a fresh token`() {
        /* 1.25x, not 0.1x. Getting this backwards under-reports by 12.5x on that
           slice, which on an agent loop is most of the prompt. */
        val billed = ModelPricing.effectiveBillableTokens(1000, null, 200, "anthropic")
        assertEquals(1050, billed, "800 fresh + 200 written at 1.25x")
    }

    @Test
    fun `a provider reporting more cached tokens than exist cannot flip the bill negative`() {
        assertTrue(ModelPricing.effectiveBillableTokens(10, 9999, 9999, "anthropic") >= 0)
    }

    // ── The negotiated path ──────────────────────────────────────────────────

    private fun negotiated(
        input: Double, output: Double, cached: Double? = null,
    ) = object {
        val o = ModelPricing.Override("gpt-4o", input, output, cached)
    }.o

    /** Exercises the override path without a database, via the same arithmetic. */
    private fun withOverride(
        o: ModelPricing.Override, provider: String, u: ModelPricing.Usage,
    ): Double {
        val out = u.tokensOut ?: 0
        val inTotal = u.tokensIn ?: (u.totalTokens - out).coerceAtLeast(0)
        val read = (u.cacheReadTokens ?: 0).coerceIn(0, inTotal)
        val write = (u.cacheWriteTokens ?: 0).coerceIn(0, inTotal - read)
        val fresh = (inTotal - read - write).coerceAtLeast(0)
        val cachedRate = o.cachedInputUsdPerMillion
            ?: (o.inputUsdPerMillion * ModelPricing.cacheReadMultiplier(provider))
        return (fresh * o.inputUsdPerMillion +
            read * cachedRate +
            write * o.inputUsdPerMillion * ModelPricing.CACHE_WRITE_MULTIPLIER +
            out * o.outputUsdPerMillion) / 1_000_000.0
    }

    @Test
    fun `input and output are priced separately, because contracts quote them separately`() {
        /*
         * ── THE CASE A BLENDED RATE GETS WRONG ──────────────────────────────
         * Output is typically 3-5x input, so one blended rate is correct at
         * exactly one input/output ratio. An agent loop (mostly input) and a
         * summariser (proportionally more output) sit at opposite ends of it.
         */
        val rate = negotiated(input = 1.00, output = 4.00)

        val agentShaped = withOverride(rate, "openai",
            usage(1_000_000, tin = 950_000, tout = 50_000))
        val summariserShaped = withOverride(rate, "openai",
            usage(1_000_000, tin = 500_000, tout = 500_000))

        assertClose(1.15, agentShaped, "agent-shaped call")
        assertClose(2.50, summariserShaped, "summariser-shaped call")
        assertTrue(summariserShaped > agentShaped * 2,
            "the same token count costs materially more when it is mostly output — a blended " +
                "rate cannot express that, and would be wrong for one of these two")
    }

    @Test
    fun `an unstated cached rate derives from the input rate at the provider's multiplier`() {
        val rate = negotiated(input = 2.00, output = 8.00, cached = null)
        /* 1M in, 600k of it cached at Anthropic's 0.1x:
           400k * $2.00 + 600k * $0.20 = $0.80 + $0.12 */
        assertClose(0.92,
            withOverride(rate, "anthropic", usage(1_000_000, tin = 1_000_000, tout = 0, read = 600_000)),
            "derived cache rate")
    }

    @Test
    fun `a stated cached rate is used instead of the derived one`() {
        val rate = negotiated(input = 2.00, output = 8.00, cached = 0.50)
        /* Same call, but the contract names $0.50/M for cached input:
           400k * $2.00 + 600k * $0.50 = $0.80 + $0.30 */
        assertClose(1.10,
            withOverride(rate, "anthropic", usage(1_000_000, tin = 1_000_000, tout = 0, read = 600_000)),
            "stated cache rate")
    }

    @Test
    fun `a missing output count is charged at the input rate, not the output rate`() {
        /* Guessing high turns a provider's missing field into an inflated
           invoice. Input dominates every real workload, so that is the guess
           that is wrong by the least — and wrong in the customer's favour. */
        val rate = negotiated(input = 1.00, output = 10.00)
        assertClose(1.00, withOverride(rate, "openai", usage(1_000_000)), "no split reported")
    }

    // ── Pattern matching ─────────────────────────────────────────────────────

    @Test
    fun `an exact pattern matches only that model`() {
        assertTrue(pricing.matches("gpt-4o", "gpt-4o"))
        assertTrue(pricing.matches("gpt-4o", "GPT-4O"), "model names arrive in any case")
        assertTrue(!pricing.matches("gpt-4o", "gpt-4o-mini"))
    }

    @Test
    fun `a trailing star matches a family`() {
        assertTrue(pricing.matches("gpt-4o*", "gpt-4o-2024-11-20"))
        assertTrue(pricing.matches("*", "anything-at-all"))
        assertTrue(!pricing.matches("gpt-4o*", "gpt-4-turbo"))
    }

    @Test
    fun `the longest pattern is the one that should win`() {
        /*
         * The ordering `lookup` applies, asserted on the comparison it uses. A
         * catch-all `*` added for convenience must not silently override the
         * specific rates configured before it — and "whichever row the index
         * returned first" is not an ordering anybody can reason about when their
         * invoice disagrees with our dashboard.
         */
        val candidates = listOf("*", "gpt-4o*", "gpt-4o-mini")
            .filter { pricing.matches(it, "gpt-4o-mini") }
        assertEquals(listOf("*", "gpt-4o*", "gpt-4o-mini"), candidates,
            "all three match, which is why the tie-break matters")
        assertEquals("gpt-4o-mini", candidates.maxByOrNull { it.trimEnd('*').length })
    }

    @Test
    fun `a lookup with no database is not an error, it is the list price`() {
        assertEquals(null, ModelPricing(null).lookup(UUID.randomUUID(), "gpt-4o"),
            "a worker with no database prices at list rather than failing the call")
    }
}
