package com.vectorbea.api.ingress

import java.util.UUID

/**
 * How a run was started.
 *
 * ── WHY THIS IS AN ENUM AND NOT A STRING ────────────────────────────────────
 * `agent_runs.trigger_type` was a free-text column validated by one route with
 * an inline `setOf("manual", "api", "schedule")`. The scheduler wrote
 * `"schedule"` from its own copy of the string, and the acceptance criterion
 * here — that five ingress paths produce runs indistinguishable except for this
 * attribute — is not checkable while the attribute is whatever each caller
 * happened to type.
 *
 * `manual` and `api` are the same door with different hands on it: a person in
 * the UI and a program with a key. They stay separate because the answer to
 * "who is spending this" differs, and the runs list filters on it.
 */
enum class TriggerSource(val wire: String) {
    /** A person pressed Run. */
    MANUAL("manual"),

    /** `POST /api/workflows/:id/run`, or `POST /api/runs`, with a key or a session. */
    API("api"),

    /** A cron or interval schedule fired. */
    SCHEDULE("schedule"),

    /** A third party posted to a per-workflow webhook endpoint. */
    WEBHOOK("webhook"),

    /** A message arrived on a broker the customer runs. */
    EVENT("event"),

    /** An MCP client called this workflow as a tool. */
    MCP("mcp");

    companion object {
        private val BY_WIRE = entries.associateBy { it.wire }

        /**
         * Read a caller-supplied trigger type, or null if it is not one of ours.
         *
         * Null rather than a default, so a route can refuse an unrecognised value
         * with a message naming the valid ones. Silently coercing to `manual`
         * would file an API run under a person.
         */
        fun fromWire(value: String?): TriggerSource? = value?.let { BY_WIRE[it.lowercase()] }

        /** Every valid value, for an error message that says what to use instead. */
        fun wireNames(): List<String> = entries.map { it.wire }
    }
}

/**
 * Who or what is accountable for this run.
 *
 * ── THE SECOND QUESTION EVERY LIMIT NEEDS (INVARIANT 12) ────────────────────
 * A workspace is shareable, so "may this run start" is never enough on its own
 * — the platform also has to know whose budget it comes out of. A person and an
 * API key are both answers; a schedule and a webhook are deliberately neither,
 * and that is not a gap:
 *
 *   An owner's 09:00 cron job is not a guest's spend. Charging it to the person
 *   who happened to create the schedule would drain their member cap while they
 *   slept, and charging it to whoever last edited the workflow is worse. It is
 *   the workspace's cost, and no member's.
 *
 * So `userId` is null for schedule, webhook and event ingress by design, and
 * `EntitlementGuard.requireMemberSpend` is passed that null rather than skipped
 * — the guard's own no-member branch is where that decision lives, in one place.
 */
data class TriggerActor(
    /** The member whose cap this run counts against, or null for machine ingress. */
    val userId: UUID? = null,
    /** The key that acted, recorded alongside the member rather than instead of it. */
    val apiKeyId: UUID? = null,
    /**
     * The webhook, schedule or event trigger that produced this run.
     *
     * A breadcrumb, not a foreign key — see the column comment in V066. It is
     * what turns "why did this run start" into one query.
     */
    val triggerRef: UUID? = null,
)
