package com.vectorbea.api.entitlements

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Every enforcement point, in one class.
 *
 * ── WHY THEY LIVE TOGETHER ──────────────────────────────────────────────────
 * Six surfaces enforce plans: run admission, workspace creation, member
 * creation, agent/team/depth configuration, feature gates, retention. Written
 * separately they would drift — each would grow its own idea of what "at the
 * limit" means, its own off-by-one on `>=` versus `>`, and its own refusal
 * sentence. Two of those three would be caught in review. The off-by-one would
 * not, and an off-by-one on a ceiling is either a free upgrade or a customer
 * locked out one short of what they paid for.
 *
 * So the comparison happens once, in [requireLimit], and every surface passes it
 * a key and a count.
 *
 * ── THE GOVERNING RULE ──────────────────────────────────────────────────────
 * Every method here takes a WORKSPACE id and resolves through
 * [EntitlementResolver]. None takes a user. A Pro member acting inside a Free
 * workspace is refused with Free's numbers, and the refusal names Free — because
 * naming the reader's own plan while refusing them makes a correct decision read
 * as a bug.
 *
 * ── THE GRACE MODEL ─────────────────────────────────────────────────────────
 * Quotas are checked at ADMISSION and nowhere else. A run that has been admitted
 * completes, however far past the quota the account travels while it runs.
 * Killing a run at 90% to save the last 10% of a quota throws away everything
 * already spent on it — the provider calls are billed, the side effects have
 * happened, and the customer gets nothing. The next admission is refused
 * instead, which costs nobody anything.
 *
 * `billing_accounts.grace_until` is the manual form of the same idea: support
 * can hand an account a stay of execution without editing its plan, and the stay
 * expires by itself.
 */
class EntitlementGuard(
    private val resolver: EntitlementResolver,
    private val dataSource: DataSource,
    /**
     * Whether a refusal is actually thrown, or only logged.
     *
     * OFF BY DEFAULT, and this is the repo's standing rule rather than timidity:
     * every new runtime behaviour ships behind an env-var flag, defaulting to
     * off, until its phase is signed off. What is new here is the REFUSING. The
     * resolution, the metering and the ledger all run either way, so S4 has real
     * data from the day this deploys.
     *
     * SHADOW MODE IS THE POINT, not a consolation. Turning enforcement straight
     * on for a system that can refuse a customer's runs means finding out about
     * a mis-seeded limit from a support ticket. With this off, every check that
     * WOULD have refused logs `[entitlements] WOULD REFUSE ...` with the key, the
     * numbers and the workspace — so the first question ("who does this break?")
     * is answered from a log query before anybody is broken by it.
     *
     * Set `ENTITLEMENTS_ENFORCED=true` to arm it.
     */
    private val enforcing: Boolean =
        System.getenv("ENTITLEMENTS_ENFORCED")?.lowercase() == "true",
) {
    private val log = LoggerFactory.getLogger(EntitlementGuard::class.java)

    /**
     * Throw, or log what would have been thrown.
     *
     * ONE function, so shadow mode cannot be honoured at five call sites and
     * forgotten at the sixth — which would be the worst outcome available: a
     * flag that is off, and one surface refusing customers anyway.
     */
    private fun refuse(error: ApiError): Nothing? {
        if (enforcing) throw error
        log.info("[entitlements] WOULD REFUSE ({}): {} | {}", error.code, error.message, error.details)
        return null
    }

    fun resolve(workspaceId: UUID): Effective = resolver.resolve(workspaceId)

    // ── Features ──────────────────────────────────────────────────────────────

    /**
     * Refuse unless the workspace's plan includes [key].
     *
     * Fails closed: a key with no row is OFF. The opposite default would hand
     * every tenant every unshipped feature the first time somebody added a
     * constant without a seed row.
     */
    fun requireFeature(workspaceId: UUID, key: String) {
        val eff = resolver.resolve(workspaceId)
        if (eff.feature(key)) return
        refuse(ApiError.PlanFeatureUnavailable(
            featureKey = key,
            featureLabel = EntitlementKeys.label(key),
            planCode = eff.plan.code,
            planName = eff.plan.name,
            upgradeToName = eff.plan.upgradeToName,
            upgradeUrl = eff.plan.upgradeUrl,
        ))
    }

    /** For a UI gate or a conditional code path — a question, not a refusal. */
    fun hasFeature(workspaceId: UUID, key: String): Boolean = resolver.resolve(workspaceId).feature(key)

    // ── Limits ────────────────────────────────────────────────────────────────

    /**
     * Refuse when [currentCount] is already at the ceiling for [key].
     *
     * `>=` and not `>`, because callers pass the count BEFORE the thing they are
     * about to create. A workspace with 3 of 3 agents must be refused the
     * fourth, and the only way to get that right at every call site is for no
     * call site to write the comparison.
     *
     * A key with no entitlement returns without refusing. Null is not zero: the
     * catalogue having no opinion means the caller's pre-S3 default stands, and
     * treating a missing row as a limit of zero would lock every tenant out of a
     * surface the moment somebody added a constant ahead of its seed row.
     */
    fun requireLimit(workspaceId: UUID, key: String, currentCount: Long) {
        val eff = resolver.resolve(workspaceId)
        requireLimit(eff, key, currentCount)
    }

    /** As [requireLimit], for a caller that has already resolved. */
    fun requireLimit(eff: Effective, key: String, currentCount: Long) {
        if (eff.isUnlimited(key)) return
        val limit = eff.limit(key) ?: return
        if (currentCount < limit) return

        refuse(ApiError.PlanLimitExceeded(
            limitKey = key,
            limitLabel = EntitlementKeys.label(key),
            limit = limit,
            current = currentCount,
            planCode = eff.plan.code,
            planName = eff.plan.name,
            upgradeToName = eff.plan.upgradeToName,
            upgradeUrl = eff.plan.upgradeUrl,
        ))
    }

    /**
     * Refuse a configured VALUE above the ceiling — a team of 12 on a plan that
     * allows 8, a delegation chain 4 deep on a plan that allows 3.
     *
     * Distinct from [requireLimit] because the comparison is `>` rather than
     * `>=`: here the number IS the thing being configured, not a count of things
     * that exist before adding one more. Getting these two confused is precisely
     * the off-by-one this class exists to have in one place.
     */
    fun requireConfiguredValue(eff: Effective, key: String, configured: Long) {
        if (eff.isUnlimited(key)) return
        val limit = eff.limit(key) ?: return
        if (configured <= limit) return

        refuse(ApiError.PlanLimitExceeded(
            limitKey = key,
            limitLabel = EntitlementKeys.label(key),
            limit = limit,
            current = configured,
            planCode = eff.plan.code,
            planName = eff.plan.name,
            upgradeToName = eff.plan.upgradeToName,
            upgradeUrl = eff.plan.upgradeUrl,
        ))
    }

    /**
     * Refuse a new workspace when the owner's account is already at
     * `max_workspaces`.
     *
     * ── WHY THIS TAKES A USER WHEN NOTHING ELSE DOES ────────────────────────
     * Because there is no workspace to resolve from yet, and the governing rule
     * has to be preserved rather than waived. It is preserved by resolving
     * through an ANCHOR: any workspace the owner already owns identifies the
     * account the new one will join — the same account
     * `assign_billing_account()` will pick when the row is inserted — and every
     * workspace on an account resolves identically, because the plan is on the
     * account.
     *
     * So this is still "resolve from the account", reached by a different route.
     * What it is NOT is "resolve from the user's plan": the anchor is a workspace
     * the user OWNS, never one they were merely invited to, so being a member of
     * somebody else's Team workspace grants no headroom on their own Free
     * account.
     *
     * No anchor means this is the user's first workspace. Always allowed —
     * refusing a brand-new user their first workspace because a plan says "1"
     * would lock them out of the product on the way in.
     */
    fun requireNewWorkspaceAllowed(ownerUserId: UUID) {
        val anchor = anchorWorkspaceForOwner(ownerUserId) ?: return
        val eff = resolver.resolve(anchor)
        requireLimit(eff, EntitlementKeys.MAX_WORKSPACES, workspaceCount(eff.accountId))
    }

    /**
     * Refuse a new member when the workspace is full, or when the account has no
     * seat left for a person who is not already on it.
     *
     * TWO CHECKS, BECAUSE THEY MEAN DIFFERENT THINGS UNDER PER-SEAT PRICING:
     *
     *   max_members_per_workspace  a workspace ceiling. Plan policy about how
     *                              big one workspace may get.
     *   max_seats                  a BILLING quantity. A person already on the
     *                              account costs nothing to add to a second
     *                              workspace — that DISTINCT is the per-seat
     *                              model — so this is checked only when the
     *                              invitee is new to the account.
     *
     * Collapsing them would either bill for a colleague twice or let an account
     * add unlimited people by spreading them across workspaces.
     *
     * [inviteeUserId] is null for an invitation to an address that has no account
     * yet, which is conservatively treated as a new seat.
     */
    fun requireNewMemberAllowed(workspaceId: UUID, inviteeUserId: UUID?) {
        val eff = resolver.resolve(workspaceId)

        requireLimit(eff, EntitlementKeys.MAX_MEMBERS_PER_WORKSPACE, memberCount(workspaceId))

        val alreadyOnAccount = inviteeUserId != null && isOnAccount(eff.accountId, inviteeUserId)
        if (alreadyOnAccount) return

        // The purchased quantity is the real cap; the plan's max_seats caps what
        // may be purchased. The tighter of the two binds, and -1 on either means
        // "whatever was bought".
        val planMax = eff[EntitlementKeys.MAX_SEATS]?.takeIf { !it.unlimited }?.intValue
        val cap = listOfNotNull(planMax, eff.seatsPurchased.toLong()).minOrNull() ?: return
        val used = seatsUsed(eff.accountId)
        if (used < cap) return

        refuse(ApiError.PlanLimitExceeded(
            limitKey = EntitlementKeys.MAX_SEATS,
            limitLabel = EntitlementKeys.label(EntitlementKeys.MAX_SEATS),
            limit = cap,
            current = used,
            planCode = eff.plan.code,
            planName = eff.plan.name,
            upgradeToName = eff.plan.upgradeToName,
            upgradeUrl = eff.plan.upgradeUrl,
        ))
    }

    // ── Quotas ────────────────────────────────────────────────────────────────

    /**
     * Refuse the NEXT admission when a metered quota is spent.
     *
     * Called at run admission and nowhere else — see the grace model above.
     * Checks every quota key and refuses on the first one that is spent, so the
     * message names the constraint the customer actually hit rather than the
     * first one in an arbitrary order.
     */
    fun requireQuota(eff: Effective) {
        // A stay of execution granted by support. Logged, because an account
        // running on grace is a thing somebody should be able to notice.
        val grace = eff.graceUntil
        if (grace != null && grace.isAfter(Instant.now())) {
            log.debug("[entitlements] account {} in grace until {} — quota checks skipped", eff.accountId, grace)
            return
        }

        val usage = resolver.usage(eff.accountId)

        for (key in EntitlementKeys.QUOTAS) {
            val ent = eff[key] ?: continue
            if (ent.unlimited) continue
            val limit = ent.intValue ?: continue
            val metric = EntitlementKeys.metricFor(key) ?: continue
            val used = usage.used(metric)
            if (used < limit) continue

            refuse(ApiError.PlanQuotaExceeded(
                limitKey = key,
                limitLabel = EntitlementKeys.label(key),
                limit = limit,
                used = used,
                planCode = eff.plan.code,
                planName = eff.plan.name,
                upgradeToName = eff.plan.upgradeToName,
                upgradeUrl = eff.plan.upgradeUrl,
                periodEnd = usage.periodEnd.toString(),
            ))
            // In shadow mode, keep checking the remaining quotas: the log should
            // name every limit this account is over, not only the first.
        }
    }

    /**
     * The per-WORKSPACE quota, checked after the account one.
     *
     * ── WHY BOTH, AND WHY IN THIS ORDER ─────────────────────────────────────
     * The account quota stops fifty workspaces being fifty allowances: they
     * share one pool. This stops the opposite — one workspace, or one guest
     * inside it, draining the account's whole month before anybody else gets a
     * run. Neither bound implies the other, so both exist.
     *
     * The account is checked FIRST ([requireQuota]) because when both are spent
     * "your account is out of runs" is the message somebody can act on;
     * "this workspace is out of runs" would send an admin looking for a
     * workspace setting that will not help them.
     */
    fun requireWorkspaceQuota(eff: Effective) {
        if (inGrace(eff)) return

        val usage = workspaceUsage(eff.workspaceId)
        for (key in EntitlementKeys.WORKSPACE_QUOTAS) {
            val ent = eff[key] ?: continue
            if (ent.unlimited) continue
            val limit = ent.intValue ?: continue
            val metric = EntitlementKeys.metricFor(key) ?: continue
            val used = usage[metric] ?: 0L
            if (used < limit) continue

            refuse(ApiError.PlanQuotaExceeded(
                limitKey = key,
                limitLabel = EntitlementKeys.label(key),
                limit = limit,
                used = used,
                planCode = eff.plan.code,
                planName = eff.plan.name,
                upgradeToName = eff.plan.upgradeToName,
                upgradeUrl = eff.plan.upgradeUrl,
                periodEnd = resolver.usage(eff.accountId).periodEnd.toString(),
            ))
        }
    }

    /**
     * Refuse when this MEMBER has spent their share of the workspace.
     *
     * ── THE EXPLOIT ─────────────────────────────────────────────────────────
     * A workspace is shareable, so a guest invited to help can burn the host's
     * tokens — the account pays, the guest spends, and every existing limit is
     * satisfied right up until the host's month is gone. The account quota is
     * not a defence: it is exactly what is being consumed.
     *
     * ── WHY TOKENS AND NOT MONEY ────────────────────────────────────────────
     * docs/COST-ATTRIBUTION-FINDINGS.md: the displayed cost figure is wrong by
     * between 1.8x and 29x depending on the model string, and the SIGN of the
     * error changes with the model. A cap denominated in that would cut off the
     * wrong people and let the expensive ones through. Tokens are counted.
     *
     * ── AND WHY IT READS THE BILLING LEDGER ─────────────────────────────────
     * `member_usage` aggregates `usage_records`, so a member's spend is exactly
     * as idempotent as the invoice: a resumed run counts once, a replay counts
     * zero. Deriving it from `agent_runs` would work until retention deleted the
     * run row, at which point a guest's spend would silently reset.
     *
     * [actorUserId] is null for a schedule, a webhook or system work. Those are
     * charged to the workspace and to nobody's cap, which is correct — an
     * owner's cron job is not a guest's spend.
     */
    fun requireMemberSpend(eff: Effective, actorUserId: UUID?) {
        if (actorUserId == null || inGrace(eff)) return

        val cap = memberTokenCap(eff.workspaceId, actorUserId)
        if (cap < 0) return   // -1: not separately capped

        val used = memberUsage(eff.workspaceId, actorUserId, "tokens")
        if (used < cap) return

        log.info("[entitlements] refused member spend: user {} used {} of {} tokens in workspace {}",
            actorUserId, used, cap, eff.workspaceId)
        refuse(ApiError.MemberSpendCapExceeded(
            limit = cap,
            used = used,
            planCode = eff.plan.code,
            planName = eff.plan.name,
            upgradeUrl = eff.plan.upgradeUrl,
        ))
    }

    /** Refuse a new API key when the workspace is at its plan's ceiling. */
    fun requireApiKeyAllowed(workspaceId: UUID) {
        requireFeature(workspaceId, EntitlementKeys.API_ACCESS)
        val eff = resolver.resolve(workspaceId)
        requireLimit(eff, EntitlementKeys.MAX_API_KEYS, apiKeyCount(workspaceId))
    }

    /**
     * A stay of execution, shared by every quota check.
     *
     * Extracted so the three of them cannot disagree about whether grace applies
     * — a member cap that ignored grace would keep refusing a guest while the
     * account itself had been forgiven.
     */
    private fun inGrace(eff: Effective): Boolean {
        val grace = eff.graceUntil ?: return false
        return grace.isAfter(Instant.now())
    }

    // ── The counts each limit is compared against ─────────────────────────────
    //
    // Deliberately here rather than in the route: a limit and the query that
    // measures it have to agree about what is being counted, and separating them
    // is how "max_agents" comes to mean "including archived ones" at one call
    // site and "excluding" at another.

    /** Workspaces on the account. The count `max_workspaces` is compared against. */
    fun workspaceCount(accountId: UUID): Long = scalar(
        "SELECT count(*) FROM workspaces WHERE billing_account_id = ?", accountId)

    /** Active members of one workspace. */
    fun memberCount(workspaceId: UUID): Long = scalar(
        "SELECT count(*) FROM workspace_members WHERE workspace_id = ? AND status = 'active'", workspaceId)

    /**
     * Agents in a workspace, excluding archived ones.
     *
     * Archived agents are excluded because a customer who archived an agent has
     * done the thing the refusal asked them to do. Counting them would leave
     * them at the ceiling with no way down that does not involve deletion.
     */
    fun agentCount(workspaceId: UUID): Long = scalar(
        "SELECT count(*) FROM agents WHERE workspace_id = ? AND COALESCE(status,'active') <> 'archived'",
        workspaceId)

    /**
     * Seats consumed across the account: one person, counted once.
     *
     * This DISTINCT is the per-seat pricing model. A user in four of the
     * account's workspaces is one seat, and adding them to a fifth costs
     * nothing — which is the behaviour that makes "invite your colleague to the
     * project workspace" a free action rather than a billing event.
     */
    fun seatsUsed(accountId: UUID): Long = resolver.seatsUsed(accountId).toLong()

    /**
     * A workspace this user OWNS, used only to identify their billing account.
     *
     * Ownership and not membership: a workspace somebody invited them to belongs
     * to a different account, and using it as the anchor would be the governing
     * rule broken in the one place it is hardest to see.
     */
    private fun anchorWorkspaceForOwner(ownerUserId: UUID): UUID? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1"
            ).use { st ->
                st.setObject(1, ownerUserId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
            }
        }

    /** Whether this person already occupies a seat on the account. */
    private fun isOnAccount(accountId: UUID, userId: UUID): Boolean =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT 1 FROM workspace_members m
                     JOIN workspaces w ON w.id = m.workspace_id
                    WHERE w.billing_account_id = ? AND m.user_id = ? AND m.status = 'active'
                    LIMIT 1"""
            ).use { st ->
                st.setObject(1, accountId)
                st.setObject(2, userId)
                st.executeQuery().use { rs -> rs.next() }
            }
        }

    /** Live (unrevoked) API keys in a workspace. */
    fun apiKeyCount(workspaceId: UUID): Long = scalar(
        "SELECT count(*) FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL", workspaceId)

    /** Consumption for one workspace this period, by metric. */
    fun workspaceUsage(workspaceId: UUID): Map<String, Long> =
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT metric, used FROM workspace_usage(?)").use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    buildMap { while (rs.next()) put(rs.getString(1), Math.ceil(rs.getDouble(2)).toLong()) }
                }
            }
        }

    /** What one member has spent in one workspace this period. */
    fun memberUsage(workspaceId: UUID, userId: UUID, metric: String = "tokens"): Long =
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT member_usage(?, ?, ?)").use { st ->
                st.setObject(1, workspaceId); st.setObject(2, userId); st.setString(3, metric)
                st.executeQuery().use { rs ->
                    if (rs.next()) Math.ceil(rs.getDouble(1)).toLong() else 0L
                }
            }
        }

    /** The member's own override, else the plan default. -1 means uncapped. */
    fun memberTokenCap(workspaceId: UUID, userId: UUID): Long =
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT member_token_cap(?, ?)").use { st ->
                st.setObject(1, workspaceId); st.setObject(2, userId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else -1L }
            }
        }

    private fun scalar(sql: String, id: UUID): Long =
        dataSource.connection.use { conn ->
            conn.prepareStatement(sql).use { st ->
                st.setObject(1, id)
                st.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L }
            }
        }
}
