package com.vectorbea.worker.net

import com.knuddels.jtokkit.Encodings
import com.knuddels.jtokkit.api.EncodingType
import com.vectorbea.worker.logging.logger

/**
 * What a provider call will cost, before it is made.
 *
 * ── WHY THE OLD ESTIMATE COULD NOT WORK ─────────────────────────────────────
 * It was `sum(content.length) / 4 + maxTokens`. Four characters per token is the
 * standard figure for English prose, and an agent does not send prose. It sends
 * `AgentPromptBuilder`'s system prompt, which serialises the whole tool catalogue
 * with `writerWithDefaultPrettyPrinter()` — two-space indented JSON, one field
 * per line, every key quoted — followed by accumulated JSON observations.
 * Indentation runs, braces, quotes and colons tokenize far closer to one token
 * per character.
 *
 * Measured against real prompt shapes, the old estimate under-reserved by 15% at
 * three tools and 36% at twenty tools with twelve iterations of observations.
 * Three properties of that error matter more than its size:
 *
 *   1. **The sign never changes.** Every shape under-reserves. A random error
 *      averages out across concurrent callers; a systematic one does not.
 *   2. **It grows with load.** Smallest on a first iteration with few tools,
 *      largest at full fan-out width with a wide catalogue.
 *   3. **Settling does not rescue it.** The correction lands when the response
 *      returns. During the in-flight window — which is when the burst happens —
 *      every concurrent caller is short by the same fraction.
 *
 * ── TWO PARTS: MEASURE, THEN LEARN ──────────────────────────────────────────
 * The input side is TOKENIZED, not approximated. The output side cannot be
 * measured — the completion does not exist yet — so it stays `maxTokens`, which
 * is the number the provider itself counts against the limit.
 *
 * A tokenizer alone is still not enough, because it is exact only for the
 * encodings OpenAI publishes. Anthropic and Google publish none, and provider
 * accounting includes framing the prompt text does not contain: message
 * envelopes, role markers, tool-definition wrappers, and for Anthropic a system
 * block sent outside `messages`. So the tokenizer's number is multiplied by a
 * correction factor learned per (model, prompt shape) from the difference
 * between what was reserved and what the provider actually billed. See
 * [EstimateCorrection].
 *
 * Tokenizer for the part that is knowable, feedback for the part that is not.
 */
class TokenEstimator(
    private val correction: EstimateCorrection = EstimateCorrection.inProcess(),
) {
    private val log = logger()

    /**
     * Loaded once. `EncodingRegistry` is thread-safe and holds the merge tables,
     * which are a few megabytes — building one per call would dominate the cost
     * of the estimate it exists to produce.
     */
    private val registry by lazy { Encodings.newLazyEncodingRegistry() }

    /**
     * The shape of a prompt, for the correction factor's key.
     *
     * ── WHY SHAPE AND NOT JUST MODEL ────────────────────────────────────────
     * The residual error is not a property of the model alone. A first iteration
     * carrying a large tool catalogue and no observations mis-estimates
     * differently from a twelfth iteration whose bulk is observation JSON,
     * because the framing overhead per token differs between them. One factor per
     * model would average two different biases into a number that fits neither.
     *
     * Three buckets rather than a continuum: enough to separate the regimes,
     * few enough that each accumulates samples quickly. A factor that needs a
     * thousand calls to become useful is a factor that is never useful.
     */
    enum class Shape {
        /** Little or no JSON — a plain LLM node, or an agent with no tools. */
        PROSE,

        /** Dominated by the tool catalogue. Typically an early iteration. */
        SCHEMA_HEAVY,

        /** Dominated by accumulated observations. A late iteration. */
        OBSERVATION_HEAVY;

        companion object {
            /**
             * Classify by how much of the prompt is JSON-ish, and where it sits.
             *
             * Deliberately crude and deliberately cheap: this runs on the hot path
             * before every provider call, and its only job is to keep two
             * different biases in two different buckets.
             */
            fun of(messages: List<Map<String, Any>>): Shape {
                var systemChars = 0
                var otherChars = 0
                var quotes = 0
                for (m in messages) {
                    val c = (m["content"] as? String) ?: continue
                    if (m["role"] == "system") systemChars += c.length else otherChars += c.length
                    quotes += c.count { it == '"' }
                }
                val total = systemChars + otherChars
                if (total == 0) return PROSE
                /*
                 * QUOTE density, not bracket density.
                 *
                 * The first version counted `{` and `[`, and it misclassified a
                 * twenty-tool catalogue as prose. Measured over the real prompt
                 * shapes: brackets separate the two classes by only 2.7x (one per
                 * 286 characters in prose, one per ~105 in JSON), which is inside
                 * the variation between JSON shapes themselves.
                 *
                 * Quotes separate them by roughly 40x — prose here contains none
                 * at all, and every JSON shape measured lands between one per 11
                 * and one per 15 characters, because every key and every string
                 * value carries two. The threshold sits an order of magnitude
                 * clear of both.
                 */
                if (quotes * QUOTE_DENSITY_DIVISOR < total) return PROSE
                return if (systemChars >= otherChars) SCHEMA_HEAVY else OBSERVATION_HEAVY
            }

            /**
             * One quote per fewer than this many characters means structured text.
             *
             * 30, against a measured 11-15 for JSON and 286+ for prose.
             */
            private const val QUOTE_DENSITY_DIVISOR = 30
        }
    }

    /** What a call is expected to cost, and the facts needed to grade it later. */
    data class Estimate(
        val model: String,
        val shape: Shape,
        /** Tokenizer output for the input side, before correction. */
        val rawInputTokens: Long,
        /** The factor applied. 1.0 until enough samples exist. */
        val factor: Double,
        /** `maxTokens` — the output reservation, uncorrected. */
        val outputTokens: Long,
    ) {
        /** Input after correction, plus the output allowance. */
        val total: Long get() = (rawInputTokens * factor).toLong() + outputTokens

        /** Corrected input alone — what [EstimateCorrection.record] grades. */
        val correctedInput: Long get() = (rawInputTokens * factor).toLong()
    }

    fun estimate(model: String, messages: List<Map<String, Any>>, maxTokens: Int?): Estimate {
        val shape = Shape.of(messages)
        val raw = countInput(model, messages)
        return Estimate(
            model = model,
            shape = shape,
            rawInputTokens = raw,
            factor = correction.factorFor(model, shape),
            outputTokens = (maxTokens ?: DEFAULT_MAX_TOKENS).toLong(),
        )
    }

    /**
     * Tokenize the prompt.
     *
     * Per message, plus a fixed per-message overhead: every provider wraps each
     * message in role markers and delimiters that are billed and are not in the
     * content. Four tokens is the documented figure for the OpenAI chat format
     * and is close enough for the others that the correction factor absorbs the
     * difference.
     *
     * Falls back to the old character heuristic if the encoding cannot be loaded,
     * because an estimate that throws would take down every provider call — and
     * the thing being replaced is still better than nothing.
     */
    private fun countInput(model: String, messages: List<Map<String, Any>>): Long {
        val enc = try {
            registry.getEncoding(encodingFor(model))
        } catch (e: Exception) {
            log.warn("[estimate] tokenizer unavailable for {} — falling back to chars/4: {}",
                model, e.message)
            return messages.sumOf { ((it["content"] as? String)?.length ?: 0) } / 4L
        }
        var total = 0L
        for (m in messages) {
            val c = (m["content"] as? String) ?: continue
            total += enc.countTokens(c) + PER_MESSAGE_OVERHEAD
        }
        return total
    }

    /**
     * Which encoding to count with.
     *
     * o200k for the GPT-4o family, cl100k for everything else including Claude
     * and Gemini. Naming the approximation rather than hiding it: cl100k is not
     * Anthropic's tokenizer and no public one exists, so for those models this is
     * a good first number that the correction factor then calibrates. That is why
     * the feedback loop is not optional.
     */
    private fun encodingFor(model: String): EncodingType = when {
        model.contains("gpt-4o", ignoreCase = true) -> EncodingType.O200K_BASE
        model.contains("gpt-4.1", ignoreCase = true) -> EncodingType.O200K_BASE
        model.contains("o1", ignoreCase = true) -> EncodingType.O200K_BASE
        else -> EncodingType.CL100K_BASE
    }

    /** Grade a finished call. [actualInputTokens] is the provider's own count. */
    fun record(estimate: Estimate, actualInputTokens: Long) {
        if (actualInputTokens <= 0 || estimate.rawInputTokens <= 0) return
        correction.record(estimate.model, estimate.shape,
            estimate.rawInputTokens, actualInputTokens)
    }

    internal companion object {
        /** Matches what `callAnthropic` sends when a node sets none. */
        const val DEFAULT_MAX_TOKENS = 1024

        /** Role markers and delimiters, billed and absent from the content. */
        const val PER_MESSAGE_OVERHEAD = 4L
    }
}

/**
 * The learned correction factor: reserved versus actually billed.
 *
 * ── WHY THIS EXISTS ALONGSIDE A REAL TOKENIZER ──────────────────────────────
 * The tokenizer answers "how many tokens is this text". The provider bills for
 * something slightly different — message framing, tool-definition wrappers,
 * Anthropic's separate system block — and for two of the three providers we are
 * not even using their tokenizer. The gap is small, systematic, and different per
 * model and per prompt shape, which is exactly the sort of thing a feedback loop
 * closes and a constant does not.
 *
 * ── AN EWMA, AND WHY IT IS CLAMPED ──────────────────────────────────────────
 * Each finished call contributes `actual / raw`. An exponentially weighted mean
 * with a slow alpha tracks a real drift — a provider changing its framing, a new
 * model — without a single outlier moving the factor enough to matter.
 *
 * Clamped to [1.0, 2.0]. The lower bound is the important one: a factor below 1
 * would mean the bucket reserves LESS than the tokenizer counted, and since the
 * whole failure being fixed is systematic under-reservation, the feedback loop
 * must never be able to reintroduce it. The upper bound stops a run of pathological
 * samples from reserving double and throttling the fleet on its own arithmetic.
 *
 * ── IN-PROCESS BY DEFAULT ───────────────────────────────────────────────────
 * Unlike the bucket, this does not have to be shared to be correct: every worker
 * converges on the same factor from its own traffic, and a worker that has just
 * started reserves at 1.0, which is the tokenizer's own number. Redis would make
 * convergence faster and add a network call to the hot path for a number that
 * moves slowly.
 */
interface EstimateCorrection {
    fun factorFor(model: String, shape: TokenEstimator.Shape): Double
    fun record(model: String, shape: TokenEstimator.Shape, raw: Long, actual: Long)

    /** Samples seen and the current factor, for the metric and for tests. */
    fun snapshot(): Map<String, Pair<Long, Double>>

    companion object {
        fun inProcess(): EstimateCorrection = InProcessEstimateCorrection()

        /** Never correct. For tests that pin the tokenizer's raw output. */
        fun none(): EstimateCorrection = object : EstimateCorrection {
            override fun factorFor(model: String, shape: TokenEstimator.Shape) = 1.0
            override fun record(model: String, shape: TokenEstimator.Shape, raw: Long, actual: Long) {}
            override fun snapshot(): Map<String, Pair<Long, Double>> = emptyMap()
        }
    }
}

class InProcessEstimateCorrection(
    /**
     * EWMA weight. 0.05 means a single call moves the factor by at most 5% of the
     * distance to its own ratio, so roughly sixty calls to converge and no single
     * call able to distort it.
     */
    private val alpha: Double = 0.05,
    /**
     * Samples before the factor is used at all.
     *
     * Below this, [factorFor] returns 1.0 — the tokenizer's own number. A factor
     * derived from three calls is noise, and applying it would make the first
     * minutes after a deploy worse than no correction.
     */
    private val minSamples: Long = 20,
) : EstimateCorrection {

    private class Cell(@Volatile var factor: Double = 1.0) {
        val samples = java.util.concurrent.atomic.AtomicLong()
    }

    private val cells = java.util.concurrent.ConcurrentHashMap<String, Cell>()

    private fun key(model: String, shape: TokenEstimator.Shape) = "$model|$shape"

    override fun factorFor(model: String, shape: TokenEstimator.Shape): Double {
        val c = cells[key(model, shape)] ?: return 1.0
        return if (c.samples.get() < minSamples) 1.0 else c.factor
    }

    override fun record(model: String, shape: TokenEstimator.Shape, raw: Long, actual: Long) {
        if (raw <= 0 || actual <= 0) return
        val c = cells.computeIfAbsent(key(model, shape)) { Cell() }
        val ratio = (actual.toDouble() / raw).coerceIn(MIN_FACTOR, MAX_FACTOR)
        /* Not atomic across read-modify-write, and deliberately so: this is a
           smoothed statistic, a lost update costs one sample out of sixty, and a
           lock in front of every finished provider call would be a real cost for
           no accuracy anyone could measure. */
        c.factor = (c.factor * (1 - alpha) + ratio * alpha).coerceIn(MIN_FACTOR, MAX_FACTOR)
        c.samples.incrementAndGet()
    }

    override fun snapshot(): Map<String, Pair<Long, Double>> =
        cells.entries.associate { (k, v) -> k to (v.samples.get() to v.factor) }

    internal companion object {
        /**
         * Never below 1.0. The failure being fixed is systematic
         * under-reservation; a feedback loop that can reintroduce it is worse than
         * no feedback loop, because it would do so silently and with authority.
         */
        const val MIN_FACTOR = 1.0
        const val MAX_FACTOR = 2.0
    }
}
