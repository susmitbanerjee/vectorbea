package com.vectorbea.api.entitlements

import org.slf4j.LoggerFactory
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.sql.DataSource

/**
 * The one place a plan is read.
 *
 * ── THE GOVERNING RULE, AS A SIGNATURE ──────────────────────────────────────
 * [resolve] takes a WORKSPACE id. It has no parameter for a user, and neither
 * does the SQL function it calls. A Pro member acting inside a Free workspace
 * gets Free limits because there is no argument by which they could get
 * anything else — not because every call site remembered to pass the right
 * thing.
 *
 * No surface reads `plans` or `plan_entitlements` directly. Every enforcement
 * point in this service goes through here, and the Next.js settings routes go
 * through the same `resolve_entitlements()` function from the other side. Two
 * implementations of "which plan governs this workspace" is how the rule gets
 * broken in one language and not the other — and the broken one is the one
 * nobody tests.
 *
 * ── THE CACHE, AND WHY IT IS INVALIDATED BY THE DATABASE ────────────────────
 * A resolve is three joins and runs on every triggered run, every agent save
 * and every feature gate, so it is cached. The requirement it has to satisfy is
 * "changing a limit in the database takes effect without a deploy" — including
 * a change made in psql by somebody who has never heard of this class.
 *
 * So invalidation is not a method anybody calls. `entitlement_catalog_version`
 * is a single row that STATEMENT-LEVEL TRIGGERS bump on `plans`,
 * `plan_entitlements`, `account_entitlement_overrides` and `billing_accounts`.
 * This class reads that row at most once per [versionPollMs] — one indexed
 * single-row read, cheap enough to do on the hot path — and drops the whole
 * cache when the number moves. A hand-written UPDATE therefore takes effect
 * within the poll interval, with nobody having to remember anything.
 *
 * [invalidateAll] exists as well, for the in-process write paths that already
 * know they changed something and should not wait out the poll.
 *
 * ── WHAT HAPPENS WHEN THE DATABASE IS UNREACHABLE ───────────────────────────
 * It throws. Deliberately, and this is the one place in the codebase where
 * failing open would be wrong: an unresolvable entitlement set that defaulted to
 * "allow" is an unlimited plan for the duration of the incident, and the ledger
 * would have no record of what was consumed under it. Every caller here is about
 * to do a database write anyway — create a run, save an agent, add a member — so
 * a failure surfaces as the 503 that operation was going to produce regardless.
 * `AdmissionControl` fails open on its own queue snapshot for a different and
 * better reason: the worker's claim still enforces concurrency atomically, so
 * nothing is unbounded there.
 */
class EntitlementResolver(
    private val dataSource: DataSource,
    /** How long a resolved snapshot may be reused without re-reading the version row. */
    private val versionPollMs: Long = env("ENTITLEMENT_VERSION_POLL_MS", 5_000L),
    /** Backstop TTL, in case a trigger is ever dropped. Belt and braces. */
    private val ttlMs: Long = env("ENTITLEMENT_CACHE_TTL_MS", 60_000L),
    /**
     * Usage is cached far more briefly than entitlements: it changes on every
     * run, and a stale read at a quota boundary lets a handful of extra runs in.
     * That overshoot is exactly what the grace model already tolerates — a run
     * admitted is a run that completes — so a few seconds of staleness buys a
     * large reduction in aggregate queries for no behaviour anybody can observe.
     */
    private val usageTtlMs: Long = env("ENTITLEMENT_USAGE_TTL_MS", 5_000L),
) {
    private val log = LoggerFactory.getLogger(EntitlementResolver::class.java)

    private class Cached<T>(val value: T, val expiresAt: Long)

    private val entitlementCache = ConcurrentHashMap<UUID, Cached<Effective>>()
    private val usageCache = ConcurrentHashMap<UUID, Cached<UsageSnapshot>>()

    private val knownVersion = AtomicLong(-1)
    @Volatile private var versionCheckedAt = 0L

    // ── Resolution ────────────────────────────────────────────────────────────

    /**
     * The effective entitlements for [workspaceId], resolved through the
     * workspace's billing account.
     *
     * @throws IllegalStateException if the workspace does not exist. Callers hold
     *   a [com.vectorbea.api.api.RequestContext], which has already verified the
     *   workspace against the caller's memberships, so reaching this means the
     *   workspace was deleted mid-request.
     */
    fun resolve(workspaceId: UUID): Effective {
        val version = currentCatalogVersion()
        val now = System.currentTimeMillis()

        entitlementCache[workspaceId]?.let { hit ->
            if (hit.expiresAt > now && hit.value.catalogVersion == version) return hit.value
        }

        val fresh = load(workspaceId, version)
        entitlementCache[workspaceId] = Cached(fresh, now + ttlMs)
        return fresh
    }

    /** Metered consumption for the account's current period. */
    fun usage(accountId: UUID): UsageSnapshot {
        val now = System.currentTimeMillis()
        usageCache[accountId]?.let { if (it.expiresAt > now) return it.value }
        val fresh = loadUsage(accountId)
        usageCache[accountId] = Cached(fresh, now + usageTtlMs)
        return fresh
    }

    /** Seats consumed: one person, counted once across the account's workspaces. */
    fun seatsUsed(accountId: UUID): Int =
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT account_seats_used(?)").use { st ->
                st.setObject(1, accountId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
            }
        }

    /**
     * Drop everything. For an in-process write that has just changed a plan and
     * should not wait out the poll interval — the database triggers cover every
     * other writer, including psql.
     */
    fun invalidateAll() {
        entitlementCache.clear()
        usageCache.clear()
        versionCheckedAt = 0L
    }

    /** Drop one account's cached usage, after metering a run against it. */
    fun invalidateUsage(accountId: UUID) {
        usageCache.remove(accountId)
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /**
     * The catalogue version, re-read at most once per [versionPollMs].
     *
     * On a read failure the last known version is kept rather than treated as a
     * change: a blip that flushed the cache on every request would turn a
     * degraded database into a hammered one.
     */
    private fun currentCatalogVersion(): Long {
        val now = System.currentTimeMillis()
        if (now - versionCheckedAt < versionPollMs && knownVersion.get() >= 0) return knownVersion.get()

        val read = try {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT version FROM entitlement_catalog_version").use { st ->
                    st.queryTimeout = 2
                    st.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L }
                }
            }
        } catch (e: Exception) {
            log.debug("[entitlements] version probe failed, keeping cache: {}", e.message)
            versionCheckedAt = now
            return knownVersion.get().coerceAtLeast(0L)
        }

        versionCheckedAt = now
        val previous = knownVersion.getAndSet(read)
        if (previous >= 0 && previous != read) {
            log.info("[entitlements] catalogue changed v{} -> v{} — cache flushed", previous, read)
            entitlementCache.clear()
        }
        return read
    }

    private fun load(workspaceId: UUID, version: Long): Effective =
        dataSource.connection.use { conn ->
            val header = conn.prepareStatement(ACCOUNT_SQL).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) throw IllegalStateException("workspace $workspaceId has no billing account")
                    AccountHeader(
                        accountId = rs.getObject("account_id", UUID::class.java),
                        seats = rs.getInt("seats"),
                        graceUntil = rs.getTimestamp("grace_until")?.toInstant(),
                        plan = PlanSummary(
                            code = rs.getString("plan_code"),
                            name = rs.getString("plan_name"),
                            priceCents = rs.getObject("price_cents") as? Int,
                            currency = rs.getString("currency"),
                            billingInterval = rs.getString("billing_interval"),
                            priceModel = rs.getString("price_model"),
                            upgradeToCode = rs.getString("upgrade_to_code"),
                            upgradeToName = rs.getString("upgrade_to_name"),
                            upgradeUrl = rs.getString("upgrade_url"),
                            status = rs.getString("plan_status"),
                        ),
                    )
                }
            }

            val byKey = conn.prepareStatement(
                """SELECT key, kind, scope, period, int_value, bool_value, num_value, text_value, source
                     FROM resolve_entitlements(?)"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    buildMap { while (rs.next()) { val e = mapEntitlement(rs); put(e.key, e) } }
                }
            }

            Effective(
                workspaceId = workspaceId,
                accountId = header.accountId,
                plan = header.plan,
                seatsPurchased = header.seats,
                graceUntil = header.graceUntil,
                byKey = byKey,
                catalogVersion = version,
            )
        }

    private fun loadUsage(accountId: UUID): UsageSnapshot =
        dataSource.connection.use { conn ->
            val (start, end) = conn.prepareStatement(
                "SELECT period_start, period_end FROM account_current_period(?)"
            ).use { st ->
                st.setObject(1, accountId)
                st.executeQuery().use { rs ->
                    if (rs.next()) rs.getTimestamp(1).toInstant() to rs.getTimestamp(2).toInstant()
                    else Instant.EPOCH to Instant.EPOCH
                }
            }

            val metrics = conn.prepareStatement("SELECT metric, used FROM account_usage(?)").use { st ->
                st.setObject(1, accountId)
                st.executeQuery().use { rs ->
                    buildMap<String, Long> {
                        // Rounded toward the customer's benefit is the wrong
                        // instinct here: a quota compared against a truncated
                        // figure lets the last fractional minute through free
                        // every month. Ceiling, so the ledger and the check
                        // agree on whole units.
                        while (rs.next()) put(rs.getString("metric"), Math.ceil(rs.getDouble("used")).toLong())
                    }
                }
            }

            UsageSnapshot(periodStart = start, periodEnd = end, byMetric = metrics)
        }

    private fun mapEntitlement(rs: ResultSet) = Entitlement(
        key = rs.getString("key"),
        kind = EntitlementKind.from(rs.getString("kind")),
        scope = EntitlementScope.from(rs.getString("scope")),
        period = rs.getString("period"),
        intValue = rs.getObject("int_value")?.let { (it as Number).toLong() },
        boolValue = rs.getObject("bool_value") as? Boolean,
        numValue = rs.getObject("num_value")?.let { (it as Number).toDouble() },
        textValue = rs.getString("text_value"),
        source = rs.getString("source") ?: "plan",
    )

    private data class AccountHeader(
        val accountId: UUID,
        val seats: Int,
        val graceUntil: Instant?,
        val plan: PlanSummary,
    )

    companion object {
        private fun env(name: String, default: Long): Long =
            System.getenv(name)?.toLongOrNull() ?: default

        /**
         * The account header and the plan it is on, plus the name of the plan a
         * refusal should point at.
         *
         * The self-join on `plans` is what lets a refusal say "Team" rather than
         * "team" without a second query or a lookup table in Kotlin — the
         * upgrade path is data, and this is the join that reads it.
         */
        private val ACCOUNT_SQL = """
            SELECT b.id                AS account_id,
                   b.seats             AS seats,
                   b.grace_until       AS grace_until,
                   b.plan_status       AS plan_status,
                   p.code              AS plan_code,
                   p.name              AS plan_name,
                   p.price_cents       AS price_cents,
                   p.currency          AS currency,
                   p.billing_interval  AS billing_interval,
                   p.price_model       AS price_model,
                   p.upgrade_to_code   AS upgrade_to_code,
                   up.name             AS upgrade_to_name,
                   p.upgrade_url       AS upgrade_url
              FROM workspaces w
              JOIN billing_accounts b ON b.id = w.billing_account_id
              JOIN plans p            ON p.code = b.plan_code
              LEFT JOIN plans up      ON up.code = p.upgrade_to_code
             WHERE w.id = ?
        """.trimIndent()
    }
}
