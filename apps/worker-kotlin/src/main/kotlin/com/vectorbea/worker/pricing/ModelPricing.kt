package com.vectorbea.worker.pricing

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * What a model call costs, and whose price says so.
 *
 * ── WHY A CUSTOMER'S RATE CANNOT BE A CONSTANT IN THE CODE ──────────────────
 * The list price lived in a `when` over model-name substrings inside
 * `LlmNodeExecutor`, which is right for a self-serve customer on published
 * rates and wrong for every enterprise. An enterprise is on a negotiated
 * agreement, frequently on committed spend, and routinely running their own
 * gateway in front of a model we have never heard of. Pricing their calls at
 * our list rate over-reports their spend — and over-reporting is the failure
 * that costs trust fastest, because the first thing they do is reconcile our
 * dashboard against their provider invoice and find we are wrong.
 *
 * ── THE LIST PATH IS UNCHANGED, DELIBERATELY ────────────────────────────────
 * There are two calculations here, not one generalised one:
 *
 *   · No override → exactly what shipped before: an effective billable token
 *     count (cached input REPLACED at its own multiplier) times one blended
 *     rate. Every existing customer's numbers are byte-identical.
 *   · An override → input and output priced SEPARATELY, because that is how a
 *     contract is quoted, and blending them would require inventing a ratio.
 *
 * Generalising the first into the second would have moved every historical
 * figure on every dashboard for a refactor nobody asked for. Two paths, each
 * simple, is the honest shape.
 */
class ModelPricing(private val dataSource: DataSource?) {

    private val log = logger()

    /** A negotiated rate, per million tokens. */
    data class Override(
        val modelPattern: String,
        val inputUsdPerMillion: Double,
        val outputUsdPerMillion: Double,
        /** Null means "use the provider's own published cache multiplier". */
        val cachedInputUsdPerMillion: Double?,
    )

    /** Everything a call needs priced. */
    data class Usage(
        val totalTokens: Int,
        val tokensIn: Int?,
        val tokensOut: Int?,
        val cacheReadTokens: Int?,
        val cacheWriteTokens: Int?,
    )

    /**
     * The cost of one call, in USD.
     *
     * @param connectionId whose contract applies. Null skips the override
     *   lookup entirely, which is what a call with no connection behind it
     *   wants and what a worker with no database degrades to.
     */
    fun costUsd(
        connectionId: UUID?,
        provider: String,
        model: String,
        usage: Usage,
    ): Double? {
        if (usage.totalTokens <= 0) return null

        val override = connectionId?.let { lookup(it, model) }
        if (override == null) {
            /* The pre-V070 path, unchanged. */
            val billable = effectiveBillableTokens(
                usage.totalTokens, usage.cacheReadTokens, usage.cacheWriteTokens, provider)
            return (billable / 1_000_000.0) * listUsdPerMillion(model)
        }
        return negotiatedCost(override, provider, usage)
    }

    /**
     * A negotiated rate, applied to input and output separately.
     *
     * ── THE SPLIT MATTERS MORE THAN IT LOOKS ────────────────────────────────
     * Output is typically 3-5x input. A blended rate is therefore only correct
     * at one particular input/output ratio, and an agent loop and a
     * summarisation node sit at opposite ends of that range — so a blend that
     * is right for one is 2-3x wrong for the other. We have both counts;
     * refusing to use them would be choosing to be wrong.
     */
    private fun negotiatedCost(o: Override, provider: String, usage: Usage): Double {
        /*
         * When the provider reported a split, use it. When it did not, fall back
         * to charging everything at the INPUT rate rather than the output one:
         * input dominates every real workload, and the alternative — guessing
         * high — turns a missing field into an inflated invoice.
         */
        val out = usage.tokensOut ?: 0
        val inTotal = usage.tokensIn ?: (usage.totalTokens - out).coerceAtLeast(0)

        val read = (usage.cacheReadTokens ?: 0).coerceIn(0, inTotal)
        val write = (usage.cacheWriteTokens ?: 0).coerceIn(0, inTotal - read)
        val freshIn = (inTotal - read - write).coerceAtLeast(0)

        val cachedRate = o.cachedInputUsdPerMillion
            ?: (o.inputUsdPerMillion * cacheReadMultiplier(provider))
        /* A cache WRITE costs more than a fresh token, not less — Anthropic
           charges 1.25x. Getting this backwards under-reports by 12.5x on that
           slice, which on an agent loop is most of the prompt. */
        val writeRate = o.inputUsdPerMillion * CACHE_WRITE_MULTIPLIER

        return (freshIn * o.inputUsdPerMillion
            + read * cachedRate
            + write * writeRate
            + out * o.outputUsdPerMillion) / 1_000_000.0
    }

    /**
     * The best-matching override for a model on a connection.
     *
     * LONGEST pattern wins. A catch-all `*` added for convenience must not
     * silently take precedence over the specific rates configured before it,
     * and "whichever the index returned first" is not an ordering anybody can
     * reason about when their invoice disagrees with our dashboard.
     */
    internal fun lookup(connectionId: UUID, model: String): Override? = runCatching {
        val ds = dataSource ?: return null
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT model_pattern, input_usd_per_million, output_usd_per_million,
                          cached_input_usd_per_million
                     FROM connection_model_prices
                    WHERE connection_id = ?"""
            ).use { st ->
                st.setObject(1, connectionId)
                st.executeQuery().use { rs ->
                    val rows = buildList {
                        while (rs.next()) add(Override(
                            modelPattern = rs.getString("model_pattern"),
                            inputUsdPerMillion = rs.getDouble("input_usd_per_million"),
                            outputUsdPerMillion = rs.getDouble("output_usd_per_million"),
                            cachedInputUsdPerMillion = rs.getBigDecimal("cached_input_usd_per_million")
                                ?.toDouble(),
                        ))
                    }
                    rows.filter { matches(it.modelPattern, model) }
                        .maxByOrNull { it.modelPattern.trimEnd('*').length }
                }
            }
        }
    }.getOrElse {
        /*
         * A pricing read must never fail a call. Falling back to list price
         * over-reports rather than losing the run, and the log line is what says
         * why a customer's figures moved.
         */
        log.warn("[pricing] override lookup failed for connection {}: {} — falling back to " +
            "list price, which will over-report a negotiated rate", connectionId, it.message)
        null
    }

    /** Exact, or a prefix ending in `*`. Case-insensitive, like the list table. */
    internal fun matches(pattern: String, model: String): Boolean =
        if (pattern.endsWith("*")) model.startsWith(pattern.dropLast(1), ignoreCase = true)
        else pattern.equals(model, ignoreCase = true)

    companion object {
        /**
         * Anthropic charges 1.25x for a cache WRITE.
         *
         * The other providers neither charge for nor report one, so their write
         * count is always zero and this never applies to them.
         */
        const val CACHE_WRITE_MULTIPLIER = 1.25

        /**
         * What a cached input token costs as a fraction of a fresh one.
         *
         * Anthropic publishes 0.1x; OpenAI and Gemini discount a cached prefix
         * by half. Per provider because getting it wrong is a silent 5x on the
         * cached fraction.
         */
        fun cacheReadMultiplier(provider: String): Double =
            if (provider == "anthropic") 0.10 else 0.50

        /**
         * Tokens to bill, with cached input REPLACED at its own rate.
         *
         * Pure and public because this is the arithmetic that silently moves
         * money: every branch is a plausible-looking one-liner and three of them
         * are wrong.
         *
         *   - Adding the cached tokens instead of replacing them double-counts,
         *     since every provider's total already includes them.
         *   - Treating a cache read as free under-reports by 10-50% of the prefix.
         *   - Treating a cache WRITE as a read under-reports by 12.5x on that
         *     slice — a write costs MORE than a fresh token, not less.
         *
         * Clamped, because a provider is free to report a cached count that
         * exceeds what we believe the total is, and a negative fresh count would
         * flip the sign of the bill.
         */
        fun effectiveBillableTokens(
            total: Int,
            cacheRead: Int?,
            cacheWrite: Int?,
            provider: String,
        ): Int {
            val read = (cacheRead ?: 0).coerceIn(0, total)
            val write = (cacheWrite ?: 0).coerceIn(0, total - read)
            val fresh = (total - read - write).coerceAtLeast(0)
            return (fresh + (read * cacheReadMultiplier(provider)) + (write * CACHE_WRITE_MULTIPLIER))
                .toInt().coerceAtLeast(0)
        }

        /**
         * The platform's published rate, blended, per million tokens.
         *
         * Substring matching on the model name, longest-intent first. Unchanged
         * from where it lived inside `LlmNodeExecutor` — moved here so there is
         * ONE place that answers "what does this cost", not two that can drift.
         */
        fun listUsdPerMillion(model: String): Double = when {
            model.contains("gpt-4o-mini", ignoreCase = true) -> 0.60
            model.contains("gpt-4o", ignoreCase = true) -> 5.00
            model.contains("gpt-4.1-mini", ignoreCase = true) -> 0.40
            model.contains("gpt-4.1", ignoreCase = true) -> 2.00
            model.contains("gpt-4", ignoreCase = true) -> 30.00
            model.contains("gpt-3.5", ignoreCase = true) -> 0.50
            model.contains("claude-3-5-haiku", ignoreCase = true) -> 0.80
            model.contains("claude-3-5", ignoreCase = true) -> 3.00
            model.contains("claude-3-haiku", ignoreCase = true) -> 0.25
            model.contains("claude-3-opus", ignoreCase = true) -> 15.00
            model.contains("claude", ignoreCase = true) -> 3.00
            model.contains("gemini-1.5-flash", ignoreCase = true) -> 0.075
            model.contains("gemini-1.5-pro", ignoreCase = true) -> 3.50
            model.contains("gemini", ignoreCase = true) -> 1.00
            /*
             * ── AND THIS IS WHY AN OVERRIDE IS NOT OPTIONAL FOR A GATEWAY ────
             * A customer gateway serves model names we have never seen —
             * `acme-llm-large`, or an internal alias for something we could not
             * name if we tried. Every one of them lands here, at a number that
             * is a guess. It is a defensible guess for a self-serve user who
             * typed an unfamiliar model, and it is not a number to put in front
             * of an enterprise. `ConnectionModelPriceRoutes` is how they replace
             * it, and the connection test warns when they have not.
             */
            else -> 2.00
        }
    }
}
