package com.vectorbea.api.errors

/**
 * Typed API errors.
 *
 * Every ApiError carries:
 *  - an HTTP status code
 *  - a machine-readable [code] (used in the JSON "error.code" field)
 *  - a human-readable [message] — NEVER contains internal details, secrets, or stack frames
 */
sealed class ApiError(
    val httpStatus: Int,
    val code: String,
    override val message: String,
    /**
     * Machine-readable facts behind the message, for a UI that has to render
     * something better than the sentence.
     *
     * "Workspace concurrency limit reached" is a toast. `{limit: 8, active: 8,
     * queued: 12}` is a progress bar, a queue position, and an upgrade prompt
     * that names the right number. The message stays authoritative — details
     * never contradict it — but a client that understands the code can do more
     * than print it.
     *
     * Values must be JSON primitives or maps of them. Never anything derived
     * from a secret, a connection string, or an internal identifier the caller
     * does not already own.
     */
    val details: Map<String, Any?> = emptyMap(),
) : Exception(message) {

    /** 400 — request body / parameter is invalid */
    class ValidationError(message: String) : ApiError(400, "VALIDATION_ERROR", message)

    /** 401 — missing or invalid credentials */
    class Unauthorized(message: String = "Authentication required") :
        ApiError(401, "UNAUTHORIZED", message)

    /** 403 — authenticated but not permitted */
    class Forbidden(message: String = "Access denied") :
        ApiError(403, "FORBIDDEN", message)

    /** 404 — resource does not exist */
    class NotFound(resource: String = "Resource") :
        ApiError(404, "NOT_FOUND", "$resource not found")

    /** 405 — HTTP method not supported for this route */
    class MethodNotAllowed(method: String, path: String) :
        ApiError(405, "METHOD_NOT_ALLOWED", "Method $method is not allowed on $path")

    /** 409 — conflict (duplicate key, version mismatch, etc.) */
    class Conflict(message: String) : ApiError(409, "CONFLICT", message)

    /** 422 — semantically invalid even though parseable */
    class UnprocessableEntity(message: String) :
        ApiError(422, "UNPROCESSABLE_ENTITY", message)

    /**
     * 422 — a skill was granted to an agent that lacks the tools it requires.
     *
     * Distinct from [UnprocessableEntity] for the reason [details] exists at
     * all: the form has to HIGHLIGHT the tools it is telling somebody to add,
     * and a sentence is not addressable. `missing` is one entry per skill, each
     * with the unmet requirements under it, so a row in the picker can be
     * marked without the client parsing prose.
     *
     * Refused at save rather than at run because a skill's instructions say
     * "call the video generation tool" — an agent holding that skill and not
     * that tool does exactly what it was taught, is refused by the runtime
     * (invariant 1, correctly), and presents as an agent that hallucinated a
     * tool. See docs/SKILLS.md §4.
     */
    class SkillToolsMissing(message: String, missing: List<Map<String, Any?>>) :
        ApiError(422, "SKILL_TOOLS_MISSING", message, mapOf("missing" to missing))

    /** 429 — too many requests */
    class TooManyRequests(
        message: String = "Rate limit exceeded",
        details: Map<String, Any?> = emptyMap(),
    ) : ApiError(429, "TOO_MANY_REQUESTS", message, details)

    /**
     * 429 — the workspace is at its own concurrency ceiling.
     *
     * Distinct from [TooManyRequests] on purpose. Rate limiting is "you asked too
     * fast"; this is "you have too much running", and the fix is different: wait
     * for your own runs to finish, or raise the plan. Giving them the same code
     * would make the UI unable to tell a customer which.
     */
    class WorkspaceConcurrencyLimit(
        limit: Int, active: Int, queued: Int,
        /**
         * The plan governing the WORKSPACE — never the reader's own plan. Null
         * only when entitlements could not be resolved, in which case the
         * sentence degrades to the pre-S3 wording rather than inventing one.
         */
        planCode: String? = null,
        planName: String? = null,
        upgradeToName: String? = null,
        upgradeUrl: String? = null,
    ) : ApiError(
        429, "WORKSPACE_CONCURRENCY_LIMIT",
        "This workspace is running $active of the $limit concurrent runs" +
            (if (planName != null) " its $planName plan allows" else " it is allowed") +
            ". $queued runs are queued and will start as those finish." +
            (when {
                upgradeToName != null -> " Upgrade to $upgradeToName to raise the limit."
                planName != null -> " Contact us to raise the limit."
                else -> ""
            }),
        mapOf(
            "limitKey" to "max_concurrent_runs",
            "limit" to limit, "active" to active, "queued" to queued,
            "plan" to planCode, "planName" to planName,
            "upgradeTo" to upgradeToName, "upgradeUrl" to upgradeUrl,
            "retryable" to true,
        ),
    )

    /**
     * 503 — the platform is shedding load, and this request is not in the
     * priority lane.
     *
     * A 503 rather than a 429: nothing about *this* caller is wrong, and a 429
     * would tell them to slow down when slowing down is not the remedy.
     */
    class QueueSaturated(
        globalDepth: Int, threshold: Int,
    ) : ApiError(
        503, "QUEUE_SATURATED",
        "The platform is at capacity ($globalDepth runs queued). Your run was not accepted — " +
            "please retry shortly.",
        mapOf("globalDepth" to globalDepth, "threshold" to threshold, "retryable" to true),
    )

    // ── Plan refusals ─────────────────────────────────────────────────────────
    //
    // A bare 403 is the failure these three exist to prevent. "Access denied" on
    // a feature the customer would happily pay for is a lost sale AND a support
    // ticket, because the reader cannot tell whether they lack a permission,
    // lack a plan, or found a bug.
    //
    // So every one of them names three things: the LIMIT that was hit (with the
    // number), the PLAN currently governing the workspace, and the UPGRADE PATH.
    // The plan and the path come from the `plans` table rather than from
    // constants here, so re-packaging changes the sentence without a deploy.
    //
    // And the plan named is always the WORKSPACE's plan, never the reader's. A
    // Pro user refused inside a Free workspace must be told the workspace is on
    // Free — telling them "your plan is Pro" while refusing them is how a
    // correct enforcement decision reads as a bug.

    /**
     * 429 — a metered quota for the period is spent.
     *
     * A 429 rather than a 403 because this one genuinely resolves with time: the
     * period rolls over. [details] carries `periodEnd` so a client can say when
     * rather than "later".
     */
    class PlanQuotaExceeded(
        limitKey: String,
        limitLabel: String,
        limit: Long,
        used: Long,
        planCode: String,
        planName: String,
        upgradeToName: String?,
        upgradeUrl: String,
        periodEnd: String?,
    ) : ApiError(
        429, "PLAN_QUOTA_EXCEEDED",
        "This workspace has used $used of its $limit $limitLabel on the $planName plan. " +
            (if (upgradeToName != null) "Upgrade to $upgradeToName for more, or wait for the quota to reset"
             else "Contact us to raise the limit, or wait for the quota to reset") +
            (if (periodEnd != null) " on ${periodEnd.take(10)}." else "."),
        mapOf(
            "limitKey" to limitKey, "limit" to limit, "used" to used,
            "plan" to planCode, "planName" to planName,
            "upgradeTo" to upgradeToName, "upgradeUrl" to upgradeUrl,
            "periodEnd" to periodEnd, "retryable" to true,
        ),
    )

    /**
     * 403 — a ceiling, hit right now.
     *
     * Not a 429: waiting changes nothing. The reader must remove something or
     * change plan, and the message says which.
     */
    class PlanLimitExceeded(
        limitKey: String,
        limitLabel: String,
        limit: Long,
        current: Long,
        planCode: String,
        planName: String,
        upgradeToName: String?,
        upgradeUrl: String,
    ) : ApiError(
        403, "PLAN_LIMIT_EXCEEDED",
        "The $planName plan allows $limit $limitLabel and this workspace has $current. " +
            (if (upgradeToName != null) "Upgrade to $upgradeToName to raise the limit."
             else "Contact us to raise the limit."),
        mapOf(
            "limitKey" to limitKey, "limit" to limit, "current" to current,
            "plan" to planCode, "planName" to planName,
            "upgradeTo" to upgradeToName, "upgradeUrl" to upgradeUrl,
            "retryable" to false,
        ),
    )

    /** 403 — the plan does not include this feature at all. */
    class PlanFeatureUnavailable(
        featureKey: String,
        featureLabel: String,
        planCode: String,
        planName: String,
        upgradeToName: String?,
        upgradeUrl: String,
    ) : ApiError(
        403, "PLAN_FEATURE_UNAVAILABLE",
        "The $planName plan does not include $featureLabel. " +
            (if (upgradeToName != null) "It is available on $upgradeToName."
             else "Contact us to enable it."),
        mapOf(
            "featureKey" to featureKey, "feature" to featureLabel,
            "plan" to planCode, "planName" to planName,
            "upgradeTo" to upgradeToName, "upgradeUrl" to upgradeUrl,
            "retryable" to false,
        ),
    )

    /**
     * 429 — this MEMBER has spent their share of the workspace.
     *
     * A distinct code from [PlanQuotaExceeded] because the remedy is different
     * and the person who can apply it is different. A quota is the account's
     * problem and upgrading fixes it; this is one member's allowance inside a
     * workspace somebody else pays for, and the fix is for the OWNER to raise
     * that member's budget. Telling a guest to upgrade a plan they do not own
     * sends them to a page they cannot act on.
     *
     * So the message names the owner's action, not a checkout page.
     */
    class MemberSpendCapExceeded(
        limit: Long,
        used: Long,
        planCode: String,
        planName: String,
        upgradeUrl: String,
    ) : ApiError(
        429, "MEMBER_SPEND_CAP_EXCEEDED",
        "You have used $used of your $limit tokens in this workspace this month. " +
            "A workspace owner can raise your budget in Settings, or it resets at the " +
            "start of the next billing period.",
        mapOf(
            "limitKey" to "member_tokens_per_month",
            "limit" to limit, "used" to used,
            "plan" to planCode, "planName" to planName,
            "upgradeUrl" to upgradeUrl,
            "ownerAction" to "raise_member_budget",
            "retryable" to true,
        ),
    )

    /**
     * 401 — the presented API key is missing, unknown, revoked or expired.
     *
     * One code and one sentence for all four, deliberately: distinguishing them
     * tells somebody holding a stolen key which of the four they have.
     */
    class InvalidApiKey :
        ApiError(401, "INVALID_API_KEY",
            "This API key is not valid. It may have been revoked or expired — " +
                "create a new one in Settings under API keys.")

    /** 500 — unexpected server error (message is generic in production) */
    class InternalError(message: String = "An internal error occurred") :
        ApiError(500, "INTERNAL_ERROR", message)

    /** 503 — service temporarily unavailable (e.g. DB not connected) */
    class ServiceUnavailable(message: String = "Service temporarily unavailable") :
        ApiError(503, "SERVICE_UNAVAILABLE", message)
}
