package com.vectorbea.worker.contract

import java.text.Normalizer

/**
 * Mechanically verify that a model's citation actually exists in the source.
 *
 * THIS IS THE WHOLE IDEA
 * ----------------------
 * Layer 2 states the leverage precisely: verifying spans
 *
 *   "converts hallucination from an unverifiable property into a checkable one.
 *    You are no longer asking a model to self-report confidence — you are asking it
 *    to point at evidence and then checking whether the evidence exists."
 *
 * A model that invents an account name must also invent a span it came from.
 * Inventing a VALUE is free; inventing a QUOTATION that survives a substring check
 * against the input is not. So the check is not clever — it is
 * `source.contains(span)` — and that is exactly why it works.
 *
 * THE LADDER, AND WHY IT DESCENDS RATHER THAN BRANCHES
 * ----------------------------------------------------
 * Three tiers, tried in order, each weaker than the last:
 *
 *   EXACT       a literal substring. The only tier that proves nothing was altered.
 *   NORMALISED  matches after collapsing whitespace, folding case and normalising
 *               unicode. Models re-type quotations, and re-typing turns a
 *               non-breaking space into a space and a curly quote into a straight
 *               one. Rejecting those would fail honest citations at a rate that
 *               makes the feature unusable.
 *   FUZZY       similarity above a threshold. A genuinely weaker signal, and it is
 *               RECORDED as weaker rather than laundered into a pass — the
 *               confidence score needs to know the difference.
 *
 * Below the fuzzy threshold the citation is fabricated, so the value is fabricated.
 * Fail the field. There is no fourth tier and there must not be one: every tier
 * added below fuzzy is a tier that accepts invention.
 */
object SpanVerifier {

    /** How strongly a span was verified. Ordered weakest-last. */
    enum class Level {
        /** Literal substring. Nothing was altered. */
        EXACT,

        /** Matched after whitespace/case/unicode normalisation. */
        NORMALISED,

        /** Similar enough to accept, but recorded as a weaker signal. */
        FUZZY,

        /** Not present in the source. The citation, and so the value, is invented. */
        NOT_FOUND,
    }

    data class Result(
        val level: Level,
        /** 0..1. 1.0 for exact and normalised; the measured ratio for fuzzy. */
        val similarity: Double,
        /** Where it was found, so the UI can highlight it. -1 when not found. */
        val offset: Int,
        val message: String,
    ) {
        val verified: Boolean get() = level != Level.NOT_FOUND

        /** Only EXACT and NORMALISED are strong evidence for the confidence score. */
        val strong: Boolean get() = level == Level.EXACT || level == Level.NORMALISED
    }

    /**
     * Minimum similarity for the fuzzy tier.
     *
     * 0.85 is deliberately high. Fuzzy exists to absorb re-typing artefacts, not to
     * accept paraphrase — a model that paraphrases the source has stopped quoting it
     * and the evidence chain is broken. Lower this and the check degrades into
     * "these two strings share some letters".
     */
    private val FUZZY_THRESHOLD: Double =
        System.getenv("GROUNDEDNESS_FUZZY_THRESHOLD")?.toDoubleOrNull() ?: 0.85

    /**
     * Spans shorter than this are not accepted at the fuzzy tier.
     *
     * A four-character span fuzzy-matches half of any document by accident. Short
     * spans must be exact or normalised, where a match still means something.
     */
    private const val MIN_FUZZY_SPAN = 12

    /**
     * Characters models substitute when they re-type a quotation.
     *
     * Written as escapes rather than literal glyphs so this file stays pure ASCII —
     * a tool that re-encodes it would otherwise silently corrupt the very characters
     * this normalisation exists to fold.
     */
    private val PUNCTUATION_FOLDS = listOf(
        "‘" to "'",   // left single quote
        "’" to "'",   // right single quote / apostrophe
        "“" to "\"",  // left double quote
        "”" to "\"",  // right double quote
        "–" to "-",   // en dash
        "—" to "-",   // em dash
        " " to " ",   // non-breaking space
    )

    /**
     * Verify one span against the source.
     *
     * @param span   the quotation the model claims to have taken.
     * @param source the input the node was given, serialised whole rather than
     *               per-field: a model may legitimately cite across field
     *               boundaries, and restricting the search to one field would fail
     *               an honest citation.
     */
    fun verify(span: String?, source: String): Result {
        if (span.isNullOrBlank()) {
            return Result(Level.NOT_FOUND, 0.0, -1,
                "No source_span was given, so the value cannot be traced back to the input.")
        }
        if (source.isBlank()) {
            return Result(Level.NOT_FOUND, 0.0, -1,
                "The node had no input to cite from, so no citation can be valid.")
        }

        // ── 1. Exact ─────────────────────────────────────────────────────────
        val exact = source.indexOf(span)
        if (exact >= 0) {
            return Result(Level.EXACT, 1.0, exact, "Citation found verbatim in the input.")
        }

        // ── 2. Normalised ────────────────────────────────────────────────────
        val nSpan = normalise(span)
        val nSource = normalise(source)
        if (nSpan.isNotBlank()) {
            val at = nSource.indexOf(nSpan)
            if (at >= 0) {
                return Result(Level.NORMALISED, 1.0, at,
                    "Citation found in the input after normalising whitespace and punctuation.")
            }
        }

        // ── 3. Fuzzy ─────────────────────────────────────────────────────────
        if (nSpan.length >= MIN_FUZZY_SPAN) {
            val (ratio, at) = bestWindow(nSpan, nSource)
            if (ratio >= FUZZY_THRESHOLD) {
                return Result(Level.FUZZY, ratio, at,
                    "Citation approximately matches the input (" + pct(ratio) + " similar). " +
                        "Accepted, but this is weaker evidence than a verbatim quotation.")
            }
            return Result(Level.NOT_FOUND, ratio, -1, fabricationMessage(span, ratio))
        }

        return Result(Level.NOT_FOUND, 0.0, -1, fabricationMessage(span, 0.0))
    }

    /**
     * The message a user sees when a citation does not check out.
     *
     * It says what happened AND what it means, because "span verification failed" is
     * a diagnostic while this is an accusation of fabrication — the user needs to
     * understand that the VALUE is suspect, not merely the quotation.
     */
    private fun fabricationMessage(span: String, ratio: Double): String {
        val quoted = if (span.length > 80) span.take(80) + "..." else span
        val closest = if (ratio > 0) " (closest match " + pct(ratio) + ")" else ""
        return "The model cited \"" + quoted + "\" as its source, but that text does not appear " +
            "in the input" + closest + ". The citation was invented, so the value it supports " +
            "cannot be trusted."
    }

    private fun pct(r: Double) = Math.round(r * 100).toString() + "%"

    /**
     * Fold away the differences that re-typing introduces without changing meaning.
     *
     * NFKC first, which turns full-width and ligature forms into plain equivalents.
     * Then the punctuation substitutions, then whitespace collapse, then case.
     *
     * What is NOT folded: letters, digits, and word order. A normalised match must
     * still be the same words in the same order, or this tier would silently become
     * the fuzzy one.
     */
    fun normalise(s: String): String {
        var out = Normalizer.normalize(s, Normalizer.Form.NFKC)
        for ((from, to) in PUNCTUATION_FOLDS) out = out.replace(from, to)
        return out.replace(Regex("\\s+"), " ").trim().lowercase()
    }

    /**
     * Best similarity of the span against any equal-length window of the source.
     *
     * A sliding window rather than whole-string similarity: a 40-character span
     * against a 10,000-character document scores near zero globally however good the
     * local match is, so a global ratio would reject every honest citation in a long
     * input.
     *
     * COARSE THEN FINE, AND WHY A COARSE PASS ALONE IS NOT ENOUGH
     * -----------------------------------------------------------
     * Stepping one character at a time is O(len(source) × len(span)) and this runs
     * per field per node, so the first pass strides.
     *
     * But a strided pass cannot be trusted on its own, and the reason is easy to get
     * wrong: a window offset from the true alignment by k characters does not merely
     * lose k characters of overlap, it costs roughly 2k edits — k deletions at the
     * front and k insertions at the back. A 31-character span sampled on a stride of
     * 7 can therefore land 3 characters off the true position and score ~0.74 against
     * a genuine near-miss that is actually 0.94. Measured, exactly that: a real
     * one-typo citation scored below the threshold and was reported as fabricated.
     *
     * Accusing a model of inventing evidence because of a sampling artefact is the
     * worst failure this class can have. So the coarse pass only locates the
     * neighbourhood, and a second pass walks every offset within one stride of it to
     * find the true alignment. Cost stays linear in the source; accuracy is exact.
     */
    private fun bestWindow(span: String, source: String): Pair<Double, Int> {
        if (span.isEmpty() || source.isEmpty()) return 0.0 to -1
        if (span.length >= source.length) return similarity(span, source) to 0

        val stride = maxOf(1, span.length / 4)

        // Coarse: locate the neighbourhood.
        var best = 0.0
        var bestAt = -1
        var i = 0
        while (i + span.length <= source.length) {
            val ratio = similarity(span, source.substring(i, i + span.length))
            if (ratio > best) {
                best = ratio
                bestAt = i
            }
            if (best >= 0.999) break
            i += stride
        }
        if (best >= 0.999 || bestAt < 0) return best to bestAt

        // Fine: the true alignment is within one stride of the coarse hit. Without
        // this the score is an artefact of where the samples happened to land.
        val from = maxOf(0, bestAt - stride)
        val to = minOf(source.length - span.length, bestAt + stride)
        for (j in from..to) {
            val ratio = similarity(span, source.substring(j, j + span.length))
            if (ratio > best) {
                best = ratio
                bestAt = j
            }
        }
        return best to bestAt
    }

    /**
     * Levenshtein similarity, 0..1.
     *
     * Two rolling rows rather than a full matrix: the span is bounded by the model's
     * output but the source is not, and a full matrix over a large document is a heap
     * problem waiting to happen.
     */
    fun similarity(a: String, b: String): Double {
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0

        var prev = IntArray(b.length + 1) { it }
        var curr = IntArray(b.length + 1)

        for (i in 1..a.length) {
            curr[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                curr[j] = minOf(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            val swap = prev
            prev = curr
            curr = swap
        }

        return 1.0 - prev[b.length].toDouble() / maxOf(a.length, b.length)
    }
}
