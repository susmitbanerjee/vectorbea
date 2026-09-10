package com.vectorbea.worker.agents.context

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper

/**
 * Builds one activation's context deterministically, in priority order, under a
 * hard character budget.
 *
 * ── WHY THE TRUNCATION IS THE POINT, NOT THE BUDGET ─────────────────────────
 * Every agent framework has a context budget. What they mostly do when they hit
 * it is drop something and say nothing, and the resulting failure — an agent
 * that "ignored" an instruction it was never shown, or "forgot" a finding that
 * was silently cut — is the single hardest agent failure to diagnose, because
 * every artefact you would reach for looks correct. The prompt is well formed.
 * The tool worked. The model behaved reasonably given what it got. Nothing
 * anywhere records that what it got was not what was assembled.
 *
 * So the budget here is ordinary and the BOOKKEEPING is the feature. Every drop
 * is named, counted, and returned in [Assembled.spanAttributes] for the trace.
 * Making truncation observable does not reduce the failure rate; it removes the
 * category, by turning a mystery into a line in the debugger.
 *
 * ── DETERMINISTIC ───────────────────────────────────────────────────────────
 * Sections are emitted in [Section] order regardless of the order the caller
 * supplied them, and dropping is strictly bottom-up. The same inputs produce the
 * same bytes on every tick — which is what a resumed run needs, and what makes
 * "the prompt changed between attempts" a real signal rather than noise.
 *
 * Pure: no I/O, no clock, no randomness. Resolving blackboard refs and recalling
 * memory happen in the caller, so this can be tested exhaustively without a
 * database and cannot be the reason a run fails.
 */
object ContextAssembler {

    private val mapper = jacksonObjectMapper()

    /**
     * The priority order from §7. Declaration order IS the priority: earlier is
     * more important, and dropping walks from the bottom.
     *
     * [protectedFromDropping] marks the two sections that are the task itself. An
     * agent without its objective is not a degraded agent, it is a different one,
     * and the answer it produces is worse than no answer because it looks like an
     * answer.
     */
    enum class Section(val heading: String, val protectedFromDropping: Boolean) {
        /** Contract objective, constraints, success criteria. */
        OBJECTIVE("TASK", true),

        /** Contract inputs. */
        INPUTS("INPUT DATA", true),

        /** The agent's own memory recall. */
        MEMORY("WORKING MEMORY", false),

        /** Blackboard entries this activation's contract named in `contextRefs`. */
        BLACKBOARD("SHARED CONTEXT", false),

        /** Recent handoff history for this subtree, summarised. */
        HANDOFFS("RECENT HANDOFFS", false),

        /** Previous observations — the existing last-10 behaviour. */
        OBSERVATIONS("PREVIOUS OBSERVATIONS", false),

        /**
         * Free-text guidance a person sent into the run while it was running.
         *
         * PROTECTED, unlike observations. A human correcting an agent mid-run —
         * "the database is the primary, do not fail over" — is the highest-value
         * context in the prompt and the least reproducible: dropping it under
         * budget pressure means the agent proceeds to do the thing it was just
         * told not to, and nobody can tell from the output that the instruction
         * was ever there. It is also the smallest section, so protecting it
         * costs almost nothing.
         */
        GUIDANCE("GUIDANCE FROM A PERSON", true),
    }

    /** One contribution to a section. Several may share a section. */
    data class Part(val section: Section, val body: String)

    data class Assembled(
        val text: String,
        /** True when at least one section was dropped. */
        val truncated: Boolean,
        /** Which sections were dropped, in the order they were dropped. */
        val droppedSections: List<String>,
        /**
         * True when the protected sections alone exceed the budget.
         *
         * The budget is NOT enforced in this case, deliberately. Cutting the
         * objective or the inputs to fit produces an agent working on half a task
         * and reporting confidently on it; going over produces a provider error
         * that names the real problem. A loud failure beats a quiet wrong answer.
         */
        val overBudget: Boolean,
        val charsUsed: Int,
        val charBudget: Int,
        /** Sections that survived, in emission order. */
        val includedSections: List<String>,
    ) {
        /**
         * What the trace records. Flat and small — these are filter keys, not
         * content.
         */
        fun spanAttributes(): Map<String, Any> = buildMap {
            put("context_chars", charsUsed)
            put("context_char_budget", charBudget)
            put("context_truncated", truncated)
            if (truncated) put("context_dropped_sections", droppedSections)
            if (overBudget) put("context_over_budget", true)
        }

        fun attributesJson(): String =
            runCatching { mapper.writeValueAsString(spanAttributes()) }.getOrDefault("{}")
    }

    /**
     * Assemble [parts] into one context under [charBudget].
     *
     * Whole sections are dropped, not fractions of them. §7 says drop from the
     * bottom, and a section is the smallest unit that stays coherent: half a
     * blackboard entry or a truncated observation reads to the model as a
     * complete but wrong fact, which is worse than its absence. The cost is
     * dropping more than strictly necessary; the benefit is that everything the
     * model is shown is true.
     */
    fun assemble(parts: List<Part>, charBudget: Int): Assembled {
        /* Group first, so the caller may supply parts in any order and several
           parts may share a section. Within a section, caller order is kept —
           that order is meaningful (observations are chronological). */
        val bySection = LinkedHashMap<Section, MutableList<String>>()
        for (p in parts) {
            val body = p.body.trim()
            if (body.isEmpty()) continue
            bySection.getOrPut(p.section) { mutableListOf() }.add(body)
        }

        val rendered = Section.entries
            .filter { bySection.containsKey(it) }
            .associateWith { section ->
                "${section.heading}:\n" + bySection.getValue(section).joinToString("\n\n")
            }

        val kept = LinkedHashMap(rendered)
        val dropped = mutableListOf<String>()

        /* Bottom-up: the LAST droppable section goes first. Protected sections are
           skipped rather than deferred — they are never candidates at all. */
        val droppable = Section.entries
            .filter { !it.protectedFromDropping && kept.containsKey(it) }
            .reversed()

        for (section in droppable) {
            if (size(kept) <= charBudget) break
            kept.remove(section)
            dropped += section.name
        }

        val finalSize = size(kept)
        val text = Section.entries
            .filter { kept.containsKey(it) }
            .joinToString(SEPARATOR) { kept.getValue(it) }

        return Assembled(
            text = text,
            truncated = dropped.isNotEmpty(),
            droppedSections = dropped,
            overBudget = finalSize > charBudget,
            charsUsed = finalSize,
            charBudget = charBudget,
            includedSections = Section.entries.filter { kept.containsKey(it) }.map { it.name },
        )
    }

    private const val SEPARATOR = "\n\n"

    /** The size the assembled text WILL be, separators included. */
    private fun size(kept: Map<Section, String>): Int {
        if (kept.isEmpty()) return 0
        return kept.values.sumOf { it.length } + SEPARATOR.length * (kept.size - 1)
    }
}
