package com.vectorbea.api.entitlements

/**
 * The entitlement vocabulary, and the resolved answer for one workspace.
 *
 * ── THE GOVERNING RULE ──────────────────────────────────────────────────────
 * ENTITLEMENTS RESOLVE FROM THE WORKSPACE'S BILLING ACCOUNT, NEVER FROM THE
 * REQUESTING USER'S PLAN.
 *
 * A Pro member acting inside a Free workspace gets Free limits. Every type in
 * this file is shaped to make the wrong thing unsayable: [Effective] is built
 * from a workspace id, carries the account id it resolved through, and has no
 * field for the actor. There is no accessor a caller could reach for that would
 * quietly consult the wrong plan.
 *
 * ── THREE KINDS, BECAUSE THEY ENFORCE DIFFERENTLY ───────────────────────────
 *   QUOTA    consumption over a period, compared against metered usage. Checked
 *            at admission only, and resets at the period boundary.
 *   LIMIT    a ceiling at any instant, compared against a live count. Never
 *            resets. Checked wherever the thing is created or configured.
 *   FEATURE  on/off. Checked by presence.
 *   SETTING  neither enforced nor counted — read as a parameter (the fair-queue
 *            weight, the support tier). Named separately because calling it a
 *            limit would be a lie, and a lie in a name costs an afternoon.
 */

/** How an entitlement is enforced. Mirrors `plan_entitlements.kind`. */
enum class EntitlementKind {
    QUOTA, LIMIT, FEATURE, SETTING;

    companion object {
        fun from(wire: String?): EntitlementKind = when (wire?.lowercase()) {
            "quota" -> QUOTA
            "limit" -> LIMIT
            "feature" -> FEATURE
            else -> SETTING
        }
    }
}

/** Whether a number is one allowance for the account, or one per workspace. */
enum class EntitlementScope {
    ACCOUNT, WORKSPACE;

    companion object {
        fun from(wire: String?): EntitlementScope =
            if (wire?.lowercase() == "workspace") WORKSPACE else ACCOUNT
    }
}

/**
 * The keys.
 *
 * Constants rather than free strings because a typo in a key name resolves to
 * "no entitlement", and a missing entitlement is a FREE UPGRADE for whoever
 * trips it. [ALL] exists so a test can assert that every key the code knows
 * about is actually seeded for every plan — the drift this catches is a plan
 * that silently grants everything because somebody added a key and forgot a row.
 */
object EntitlementKeys {
    // Quotas — consumption, account-wide, monthly.
    const val RUNS_PER_MONTH = "runs_per_month"

    /**
     * The second, tighter bound (V062 §2).
     *
     * Account quotas already stop fifty workspaces being fifty allowances — they
     * share one pool. This is the other direction: one workspace draining the
     * account's whole month before anybody else gets a run. Both are checked,
     * and the workspace one is checked SECOND so the account message wins when
     * both are spent — "your account is out of runs" is the actionable one.
     */
    const val RUNS_PER_MONTH_PER_WORKSPACE = "runs_per_month_per_workspace"

    /** Per-member token cap inside one workspace (V062 §4). */
    const val MEMBER_TOKENS_PER_MONTH = "member_tokens_per_month"
    const val AGENT_MINUTES_PER_MONTH = "agent_minutes_per_month"
    const val TOKENS_PER_MONTH = "tokens_per_month"

    // Limits — ceilings.
    const val MAX_WORKSPACES = "max_workspaces"
    const val MAX_SEATS = "max_seats"
    const val MAX_MEMBERS_PER_WORKSPACE = "max_members_per_workspace"
    const val MAX_CONCURRENT_RUNS = "max_concurrent_runs"
    const val MAX_AGENTS = "max_agents"
    const val MAX_TEAM_SIZE = "max_team_size"
    const val MAX_DELEGATION_DEPTH = "max_delegation_depth"

    /** Concurrent dispatched children across the whole workspace (P10, V062 §7). */
    const val MAX_ACTIVATIONS_PER_WORKSPACE = "max_activations_per_workspace"

    /** How many live API keys a workspace may hold (V062 §8). */
    const val MAX_API_KEYS = "max_api_keys"

    // Retention — a limit per surface, because they cost different amounts to
    // keep. One number for all four would price the cheapest at the rate of the
    // most expensive.
    const val RETENTION_DAYS_RUNS = "retention_days_runs"
    const val RETENTION_DAYS_EVENTS = "retention_days_events"
    const val RETENTION_DAYS_TRACES = "retention_days_traces"
    const val RETENTION_DAYS_PAYLOADS = "retention_days_payloads"

    // Features.
    const val TEAMS = "teams"
    const val DELEGATION = "delegation"
    const val REPLAY = "replay"
    const val OTEL_EXPORT = "otel_export"
    const val MCP_TOOLS = "mcp_tools"
    const val API_ACCESS = "api_access"

    // Settings.
    const val SCHEDULING_PRIORITY = "scheduling_priority"
    const val SUPPORT_TIER = "support_tier"

    /** Requests per minute for an API key. Zero means the plan has no API. */
    const val API_RATE_LIMIT_PER_MINUTE = "api_rate_limit_per_minute"

    /** Length of a trial on this plan, in days. Zero means the plan is not one. */
    const val TRIAL_DAYS = "trial_days"

    /**
     * The ACCOUNT-scoped quotas, checked together at admission.
     *
     * `runs_per_month_per_workspace` and `member_tokens_per_month` are
     * deliberately NOT in this list: they are checked against different subjects
     * (a workspace, a member) and folding them in would make `requireQuota`
     * compare an account's usage against a workspace's limit.
     */
    val QUOTAS = listOf(RUNS_PER_MONTH, AGENT_MINUTES_PER_MONTH, TOKENS_PER_MONTH)

    val LIMITS = listOf(
        MAX_WORKSPACES, MAX_SEATS, MAX_MEMBERS_PER_WORKSPACE, MAX_CONCURRENT_RUNS,
        MAX_AGENTS, MAX_TEAM_SIZE, MAX_DELEGATION_DEPTH,
        MAX_ACTIVATIONS_PER_WORKSPACE, MAX_API_KEYS,
        RETENTION_DAYS_RUNS, RETENTION_DAYS_EVENTS, RETENTION_DAYS_TRACES, RETENTION_DAYS_PAYLOADS,
    )

    val FEATURES = listOf(TEAMS, DELEGATION, REPLAY, OTEL_EXPORT, MCP_TOOLS, API_ACCESS)

    val SETTINGS = listOf(SCHEDULING_PRIORITY, SUPPORT_TIER, API_RATE_LIMIT_PER_MINUTE, TRIAL_DAYS)

    /** Quotas whose subject is a workspace rather than the account. */
    val WORKSPACE_QUOTAS = listOf(RUNS_PER_MONTH_PER_WORKSPACE)

    val ALL: List<String> =
        QUOTAS + WORKSPACE_QUOTAS + listOf(MEMBER_TOKENS_PER_MONTH) + LIMITS + FEATURES + SETTINGS

    /**
     * The metric in `usage_records` a quota is measured against.
     *
     * The quota key and the metric name are deliberately different strings:
     * `runs_per_month` is a plan concept that could become `runs_per_day`
     * without the ledger changing, and `runs` is a ledger concept that outlives
     * any particular packaging.
     */
    fun metricFor(quotaKey: String): String? = when (quotaKey) {
        RUNS_PER_MONTH, RUNS_PER_MONTH_PER_WORKSPACE -> "runs"
        MEMBER_TOKENS_PER_MONTH -> "tokens"
        AGENT_MINUTES_PER_MONTH -> "agent_minutes"
        TOKENS_PER_MONTH -> "tokens"
        else -> null
    }

    /** Human wording for a refusal. The key is a column name; this is a sentence. */
    fun label(key: String): String = when (key) {
        RUNS_PER_MONTH -> "runs per month"
        RUNS_PER_MONTH_PER_WORKSPACE -> "runs per month in this workspace"
        MEMBER_TOKENS_PER_MONTH -> "tokens per month for one member"
        MAX_ACTIVATIONS_PER_WORKSPACE -> "concurrent agent activations"
        MAX_API_KEYS -> "API keys"
        AGENT_MINUTES_PER_MONTH -> "agent minutes per month"
        TOKENS_PER_MONTH -> "tokens per month"
        MAX_WORKSPACES -> "workspaces"
        MAX_SEATS -> "seats"
        MAX_MEMBERS_PER_WORKSPACE -> "members per workspace"
        MAX_CONCURRENT_RUNS -> "concurrent runs"
        MAX_AGENTS -> "agents"
        MAX_TEAM_SIZE -> "agents in a team"
        MAX_DELEGATION_DEPTH -> "levels of delegation"
        RETENTION_DAYS_RUNS -> "days of run history"
        RETENTION_DAYS_EVENTS -> "days of event history"
        RETENTION_DAYS_TRACES -> "days of trace history"
        RETENTION_DAYS_PAYLOADS -> "days of payload history"
        TEAMS -> "agent teams"
        DELEGATION -> "delegation"
        REPLAY -> "replay"
        OTEL_EXPORT -> "OpenTelemetry export"
        MCP_TOOLS -> "MCP tools"
        API_ACCESS -> "API access"
        else -> key.replace('_', ' ')
    }
}

/** One resolved entitlement, with where its value came from. */
data class Entitlement(
    val key: String,
    val kind: EntitlementKind,
    val scope: EntitlementScope,
    val period: String?,
    val intValue: Long?,
    val boolValue: Boolean?,
    val numValue: Double?,
    val textValue: String?,
    /** "plan" or "override". Rendered in the settings UI so a deviation is visible. */
    val source: String,
) {
    /** `-1` is the catalogue's unlimited. Zero is zero, and means zero. */
    val unlimited: Boolean get() = intValue != null && intValue < 0

    fun toMap(): Map<String, Any?> = buildMap {
        put("key", key)
        put("kind", kind.name.lowercase())
        put("scope", scope.name.lowercase())
        put("source", source)
        if (period != null) put("period", period)
        when (kind) {
            EntitlementKind.QUOTA, EntitlementKind.LIMIT -> {
                put("value", intValue)
                put("unlimited", unlimited)
            }
            EntitlementKind.FEATURE -> put("value", boolValue == true)
            EntitlementKind.SETTING -> put("value", numValue ?: textValue)
        }
    }
}

/** The plan a workspace's account is on, and where a refusal should point. */
data class PlanSummary(
    val code: String,
    val name: String,
    val priceCents: Int?,
    val currency: String,
    val billingInterval: String,
    val priceModel: String,
    val upgradeToCode: String?,
    val upgradeToName: String?,
    val upgradeUrl: String,
    val status: String,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "code" to code,
        "name" to name,
        "priceCents" to priceCents,
        "currency" to currency,
        "billingInterval" to billingInterval,
        "priceModel" to priceModel,
        "status" to status,
        "upgradeTo" to upgradeToCode,
        "upgradeToName" to upgradeToName,
        "upgradeUrl" to upgradeUrl,
    )
}

/**
 * Everything one workspace is entitled to, resolved through its billing account.
 *
 * [accountId] is carried rather than dropped so a caller can log or meter
 * against the account without a second lookup — and so a test can assert that
 * two workspaces on the same account really did resolve through one row.
 */
data class Effective(
    val workspaceId: java.util.UUID,
    val accountId: java.util.UUID,
    val plan: PlanSummary,
    val seatsPurchased: Int,
    /** Non-null while support has granted a stay of execution on quota refusals. */
    val graceUntil: java.time.Instant?,
    val byKey: Map<String, Entitlement>,
    /** Catalogue version this snapshot was built at; the cache's freshness test. */
    val catalogVersion: Long,
) {
    operator fun get(key: String): Entitlement? = byKey[key]

    /**
     * A ceiling, or null for "no opinion".
     *
     * Null and unlimited are different answers and must not collapse: null means
     * the catalogue has nothing to say and the caller should fall back to its
     * pre-S3 default, while unlimited means the plan deliberately grants
     * everything. Collapsing them turns a seeding mistake into a free upgrade.
     */
    fun limit(key: String): Long? = byKey[key]?.takeIf { !it.unlimited }?.intValue

    fun isUnlimited(key: String): Boolean = byKey[key]?.unlimited == true

    /**
     * Features FAIL CLOSED. A key that is absent — because the plan predates it,
     * or because a seed row was missed — is OFF, not on. The opposite default
     * would hand every tenant every unshipped feature the first time somebody
     * added a constant without a migration.
     */
    fun feature(key: String): Boolean = byKey[key]?.boolValue == true

    fun setting(key: String): Double? = byKey[key]?.numValue
    fun settingText(key: String): String? = byKey[key]?.textValue

    val schedulingPriority: Double get() = setting(EntitlementKeys.SCHEDULING_PRIORITY) ?: 1.0
    val supportTier: String get() = settingText(EntitlementKeys.SUPPORT_TIER) ?: "community"

    fun toMap(): Map<String, Any?> = mapOf(
        "workspaceId" to workspaceId.toString(),
        "accountId" to accountId.toString(),
        "plan" to plan.toMap(),
        "seatsPurchased" to seatsPurchased,
        "graceUntil" to graceUntil?.toString(),
        "entitlements" to byKey.values.sortedBy { it.key }.map { it.toMap() },
    )
}

/** Metered consumption for the account's current period. */
data class UsageSnapshot(
    val periodStart: java.time.Instant,
    val periodEnd: java.time.Instant,
    val byMetric: Map<String, Long>,
) {
    fun used(metric: String): Long = byMetric[metric] ?: 0L

    fun toMap(): Map<String, Any?> = mapOf(
        "periodStart" to periodStart.toString(),
        "periodEnd" to periodEnd.toString(),
        "metrics" to byMetric,
    )
}
