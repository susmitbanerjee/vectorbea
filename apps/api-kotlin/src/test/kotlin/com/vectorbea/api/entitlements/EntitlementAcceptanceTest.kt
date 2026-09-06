package com.vectorbea.api.entitlements

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.testsupport.Infra
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * S3's acceptance criteria, as tests.
 *
 * ── THE ONE THAT MATTERS ────────────────────────────────────────────────────
 * "A Pro user acting in a Free workspace gets Free limits everywhere. Assert per
 * enforcement point."
 *
 * That is the root of nearly every exploit in this area, so it is not asserted
 * once against the resolver — it is asserted separately at each enforcement
 * point, because the resolver being right does not stop one call site from
 * reading the actor's plan instead of the workspace's. The world below is built
 * to make that mistake visible: the SAME USER owns a Pro account and is an
 * active member of somebody else's Free workspace, so any check that consults
 * "the user's plan" returns Pro's numbers and fails the assertion.
 *
 * Integration, against a real Postgres, because the resolution rule lives in a
 * SQL function and a mocked one would be testing the mock.
 */
@Tag("integration")
class EntitlementAcceptanceTest {

    private val ds: DataSource get() = Infra.postgres

    // ── The world ─────────────────────────────────────────────────────────────

    private class World(
        val proUser: UUID = UUID.randomUUID(),
        val freeOwner: UUID = UUID.randomUUID(),
        val proWorkspace: UUID = UUID.randomUUID(),
        val freeWorkspace: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    ) {
        lateinit var proAccount: UUID
        lateinit var freeAccount: UUID
    }

    private fun seed(): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO app_users (id, supabase_user_id, email) VALUES (?,?,?), (?,?,?)"
            ).use {
                it.setObject(1, w.proUser); it.setString(2, "sub-${w.proUser}")
                it.setString(3, "pro-${w.proUser}@example.test")
                it.setObject(4, w.freeOwner); it.setString(5, "sub-${w.freeOwner}")
                it.setString(6, "free-${w.freeOwner}@example.test")
                it.executeUpdate()
            }

            // The Pro user's own workspace. The BEFORE INSERT trigger mints its
            // billing account; nothing here has to know how.
            c.prepareStatement(
                "INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)"
            ).use {
                it.setObject(1, w.proWorkspace); it.setString(2, "Pro")
                it.setString(3, "pro-${w.proWorkspace}"); it.setObject(4, w.proUser)
                it.executeUpdate()
            }
            // Somebody else's Free workspace.
            c.prepareStatement(
                "INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)"
            ).use {
                it.setObject(1, w.freeWorkspace); it.setString(2, "Free")
                it.setString(3, "free-${w.freeWorkspace}"); it.setObject(4, w.freeOwner)
                it.executeUpdate()
            }

            w.proAccount = accountOf(c, w.proWorkspace)
            w.freeAccount = accountOf(c, w.freeWorkspace)

            c.prepareStatement("UPDATE billing_accounts SET plan_code='pro' WHERE id=?")
                .use { it.setObject(1, w.proAccount); it.executeUpdate() }

            // THE SETUP THE GOVERNING RULE EXISTS FOR: the Pro user is an active
            // member of the Free workspace.
            c.prepareStatement(
                "INSERT INTO workspace_members (workspace_id,user_id,role,status) VALUES " +
                "(?,?,'owner','active'), (?,?,'developer','active'), (?,?,'owner','active')"
            ).use {
                it.setObject(1, w.proWorkspace); it.setObject(2, w.proUser)
                it.setObject(3, w.freeWorkspace); it.setObject(4, w.proUser)
                it.setObject(5, w.freeWorkspace); it.setObject(6, w.freeOwner)
                it.executeUpdate()
            }

            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.freeWorkspace); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.freeWorkspace)
                it.setObject(3, w.environmentId); it.setString(4, "wf-${w.workflowId}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
        }
        return w
    }

    private fun accountOf(c: java.sql.Connection, workspaceId: UUID): UUID =
        c.prepareStatement("SELECT billing_account_id FROM workspaces WHERE id=?").use {
            it.setObject(1, workspaceId)
            it.executeQuery().use { rs -> rs.next(); rs.getObject(1, UUID::class.java) }
        }

    private fun cleanup(w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id IN (?,?)").use {
                    it.setObject(1, w.proWorkspace); it.setObject(2, w.freeWorkspace); it.executeUpdate()
                }
                c.prepareStatement("DELETE FROM billing_accounts WHERE id IN (?,?)").use {
                    it.setObject(1, w.proAccount); it.setObject(2, w.freeAccount); it.executeUpdate()
                }
                c.prepareStatement("DELETE FROM app_users WHERE id IN (?,?)").use {
                    it.setObject(1, w.proUser); it.setObject(2, w.freeOwner); it.executeUpdate()
                }
            }
        }
    }

    private fun exec(sql: String, vararg args: Any?) {
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeUpdate()
            }
        }
    }

    private fun insertRun(w: World, replay: Boolean = false, tokens: Int = 1_000): UUID {
        val id = UUID.randomUUID()
        exec(
            "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id," +
                "status,trigger_type,execution_mode_kind,execution_class,token_count,duration_ms) " +
                "VALUES (?,?,?,?,?,'succeeded','manual',?,'agent',?,120000)",
            id, w.freeWorkspace, w.environmentId, w.workflowId, w.versionId,
            if (replay) "replay" else "live", tokens,
        )
        return id
    }

    /** A resolver with caching effectively off, so a test observes writes at once. */
    private fun freshResolver() = EntitlementResolver(ds, versionPollMs = 0, ttlMs = 0, usageTtlMs = 0)

    /**
     * A guard with enforcement ARMED.
     *
     * `enforcing` defaults to off in production — the standing rule is that a new
     * runtime behaviour ships behind a flag until its phase is signed off, and
     * what is new here is refusing customers. These tests assert the enforcement
     * DECISION, which has to be correct before anybody dares arm it, so they set
     * the flag explicitly rather than depending on an env var that is false
     * everywhere it matters.
     */
    private fun freshGuard() = EntitlementGuard(freshResolver(), ds, enforcing = true)

    // ═════════════════════════════════════════════════════════════════════════
    // 1. A Pro user acting in a Free workspace gets Free limits — per point.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the resolver reads the workspace's account, not the actor's`() {
        val w = seed()
        try {
            val resolver = freshResolver()

            val inPro = resolver.resolve(w.proWorkspace)
            val inFree = resolver.resolve(w.freeWorkspace)

            assertEquals("pro", inPro.plan.code)
            assertEquals("free", inFree.plan.code,
                "the Pro user is a member of this workspace — if the plan followed the " +
                    "actor rather than the account that owns the workspace, this is 'pro'")
            assertEquals(w.freeAccount, inFree.accountId)

            // And the numbers really are Free's, not merely the label.
            assertEquals(500L, inFree.limit(EntitlementKeys.RUNS_PER_MONTH))
            assertEquals(10_000L, inPro.limit(EntitlementKeys.RUNS_PER_MONTH))
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - run admission quota uses the workspace's plan`() {
        val w = seed()
        try {
            val guard = freshGuard()
            // Free allows 500 runs a month. Spend them.
            exec(
                "INSERT INTO usage_records (run_id, metric, billing_account_id, workspace_id, quantity, period_start) " +
                    "SELECT gen_random_uuid(), 'runs', ?, ?, 1, p.period_start " +
                    "FROM account_current_period(?) p, generate_series(1, 500)",
                w.freeAccount, w.freeWorkspace, w.freeAccount,
            )

            val refusal = assertFailsWith<ApiError.PlanQuotaExceeded> {
                guard.requireQuota(guard.resolve(w.freeWorkspace))
            }
            assertEquals("free", refusal.details["plan"])
            assertEquals(500L, refusal.details["limit"])

            // The same user's OWN workspace is unaffected: quotas are per account,
            // and the Pro account has spent nothing.
            guard.requireQuota(guard.resolve(w.proWorkspace))
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - agent limit uses the workspace's plan`() {
        val w = seed()
        try {
            val guard = freshGuard()
            // Free allows 3 agents; Pro allows 25.
            assertEquals(3L, guard.resolve(w.freeWorkspace).limit(EntitlementKeys.MAX_AGENTS))

            guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 2)
            val refusal = assertFailsWith<ApiError.PlanLimitExceeded> {
                guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 3)
            }
            assertEquals("free", refusal.details["plan"])

            // 3 agents is nowhere near Pro's ceiling, in the same user's own space.
            guard.requireLimit(w.proWorkspace, EntitlementKeys.MAX_AGENTS, 3)
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - features use the workspace's plan`() {
        val w = seed()
        try {
            val guard = freshGuard()

            // Delegation is on for Pro and off for Free. The SAME user, in two
            // workspaces, gets two different answers — which is the whole rule.
            assertTrue(guard.hasFeature(w.proWorkspace, EntitlementKeys.DELEGATION))
            assertFalse(guard.hasFeature(w.freeWorkspace, EntitlementKeys.DELEGATION))

            guard.requireFeature(w.proWorkspace, EntitlementKeys.REPLAY)
            val refusal = assertFailsWith<ApiError.PlanFeatureUnavailable> {
                guard.requireFeature(w.freeWorkspace, EntitlementKeys.REPLAY)
            }
            assertEquals("free", refusal.details["plan"])
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - workspace creation counts the owner's own account`() {
        val w = seed()
        try {
            val guard = freshGuard()

            // Free allows 1 workspace. The Pro user is a MEMBER of the Free
            // workspace but owns only the Pro one, so their anchor is Pro (3
            // workspaces) and they may create another.
            guard.requireNewWorkspaceAllowed(w.proUser)

            // The Free owner is at 1 of 1.
            val refusal = assertFailsWith<ApiError.PlanLimitExceeded> {
                guard.requireNewWorkspaceAllowed(w.freeOwner)
            }
            assertEquals(EntitlementKeys.MAX_WORKSPACES, refusal.details["limitKey"])
            assertEquals("free", refusal.details["plan"])
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - member and seat limits use the workspace's plan`() {
        val w = seed()
        try {
            val guard = freshGuard()

            // Free: max_members_per_workspace = 3, max_seats = 1, seats bought = 1.
            // The workspace holds 2 members, so the WORKSPACE ceiling is not the
            // binding one — the SEAT cap is, and it is reached because two
            // distinct people already occupy the account's single seat.
            val refusal = assertFailsWith<ApiError.PlanLimitExceeded> {
                guard.requireNewMemberAllowed(w.freeWorkspace, UUID.randomUUID())
            }
            assertEquals(EntitlementKeys.MAX_SEATS, refusal.details["limitKey"])
            assertEquals("free", refusal.details["plan"])

            // Somebody ALREADY on the account costs no seat: adding the Pro user
            // again is free, because per-seat means per person, not per membership.
            guard.requireNewMemberAllowed(w.freeWorkspace, w.proUser)
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - scheduling weight comes from the workspace's plan`() {
        val w = seed()
        try {
            ds.connection.use { c ->
                fun weight(id: UUID): Double =
                    c.prepareStatement("SELECT workspace_scheduling_weight(?)").use {
                        it.setObject(1, id)
                        it.executeQuery().use { rs -> rs.next(); rs.getDouble(1) }
                    }
                // A paid run does not queue behind a free-tier batch: the Pro
                // workspace's clock advances half as fast per unit of cost.
                assertEquals(1.0, weight(w.freeWorkspace))
                assertEquals(2.0, weight(w.proWorkspace))
            }
        } finally { cleanup(w) }
    }

    @Test
    fun `enforcement point - retention comes from the workspace's plan`() {
        val w = seed()
        try {
            ds.connection.use { c ->
                fun days(id: UUID, surface: String): Int =
                    c.prepareStatement("SELECT workspace_retention_days(?, ?)").use {
                        it.setObject(1, id); it.setString(2, surface)
                        it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                    }
                // 7 on free is the PRE-S3 default, kept deliberately: PayloadStore
                // reads this key now, and seeding a smaller number would have
                // shortened every existing workspace's payload retention the
                // moment the migration applied.
                assertEquals(7, days(w.freeWorkspace, "payloads"))
                assertEquals(14, days(w.proWorkspace, "payloads"))
                assertEquals(7, days(w.freeWorkspace, "runs"))
                assertEquals(30, days(w.proWorkspace, "runs"))
            }
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. Every refusal names the limit, the plan and the upgrade path.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `every refusal names the limit, the plan and the upgrade path`() {
        val w = seed()
        try {
            val guard = freshGuard()

            exec(
                "INSERT INTO usage_records (run_id, metric, billing_account_id, workspace_id, quantity, period_start) " +
                    "SELECT gen_random_uuid(), 'runs', ?, ?, 1, p.period_start " +
                    "FROM account_current_period(?) p, generate_series(1, 500)",
                w.freeAccount, w.freeWorkspace, w.freeAccount,
            )

            val refusals: List<ApiError> = listOf(
                assertFailsWith<ApiError.PlanQuotaExceeded> {
                    guard.requireQuota(guard.resolve(w.freeWorkspace))
                },
                assertFailsWith<ApiError.PlanLimitExceeded> {
                    guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 99)
                },
                assertFailsWith<ApiError.PlanFeatureUnavailable> {
                    guard.requireFeature(w.freeWorkspace, EntitlementKeys.OTEL_EXPORT)
                },
                ApiError.WorkspaceConcurrencyLimit(
                    limit = 2, active = 2, queued = 5,
                    planCode = "free", planName = "Free",
                    upgradeToName = "Pro", upgradeUrl = "/settings/billing",
                ),
            )

            for (refusal in refusals) {
                val details = refusal.details
                assertEquals("free", details["plan"], "${refusal.code} does not name the plan")
                assertEquals("Pro", details["upgradeTo"], "${refusal.code} has no upgrade path")
                // The URL has to be a route that EXISTS. A refusal whose upgrade
                // link 404s tells the reader the product is broken rather than
                // that they need a bigger plan, and the seeded default has been
                // wrong once already.
                assertEquals("/settings/billing", details["upgradeUrl"],
                    "${refusal.code} does not point at the Plan & access screen")
                assertTrue(
                    details.containsKey("limitKey") || details.containsKey("featureKey"),
                    "${refusal.code} does not name what was hit",
                )
                // Not a bare code: the sentence itself has to be usable, because
                // plenty of clients render only the message.
                assertTrue(refusal.message.contains("Free"),
                    "${refusal.code} message does not name the plan: ${refusal.message}")
                assertTrue(refusal.message.contains("Pro"),
                    "${refusal.code} message does not name the upgrade: ${refusal.message}")
            }
        } finally { cleanup(w) }
    }

    @Test
    fun `a refusal on the top plan says contact us rather than naming nothing`() {
        val w = seed()
        try {
            exec("UPDATE billing_accounts SET plan_code='enterprise' WHERE id=?", w.freeAccount)
            val guard = freshGuard()

            val refusal = assertFailsWith<ApiError.PlanLimitExceeded> {
                guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_TEAM_SIZE, 99)
            }
            assertEquals(null, refusal.details["upgradeTo"])
            assertTrue(refusal.message.contains("Contact us"),
                "the top plan has no upgrade path, so the copy has to offer the other door: " +
                    refusal.message)
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3 & 4. Metering: once per run, never for a replay.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a run that resumes four times meters once`() {
        val w = seed()
        try {
            val meter = UsageMeter(ds)
            val runId = insertRun(w)

            // The admission meter, then four resumes each reaching the terminal
            // path again — which is what a redelivered message, a retry and a
            // resume all look like from here.
            assertTrue(meter.meterRunAdmitted(runId))
            repeat(4) {
                meter.meterRunAdmitted(runId)
                meter.meterTokens(runId, 1_000)
            }

            assertEquals(1, ledgerRows(runId, "runs"))
            assertEquals(1L, ledgerQuantity(runId, "runs"))
            assertEquals(1_000L, ledgerQuantity(runId, "tokens"),
                "tokens must be an OVERWRITE of the run's total, not an increment — " +
                    "four resumes of a 1,000-token run is 1,000 tokens, not 4,000")
        } finally { cleanup(w) }
    }

    @Test
    fun `a replayed run meters zero`() {
        val w = seed()
        try {
            val meter = UsageMeter(ds)
            val replayId = insertRun(w, replay = true)

            assertFalse(meter.meterRunAdmitted(replayId))
            assertFalse(meter.meterTokens(replayId, 50_000))

            assertEquals(0, ledgerRows(replayId, "runs"))
            assertEquals(0, ledgerRows(replayId, "tokens"),
                "a replay makes no provider calls; charging one bills a debugging session")
        } finally { cleanup(w) }
    }

    @Test
    fun `usage is counted against the account that owns the workspace`() {
        val w = seed()
        try {
            val meter = UsageMeter(ds)
            meter.meterRunAdmitted(insertRun(w))
            meter.meterRunAdmitted(insertRun(w))

            val resolver = freshResolver()
            // The runs happened in the FREE workspace. They land on the free
            // account's ledger, not on the Pro account of the user who may well
            // have triggered them.
            assertEquals(2L, resolver.usage(w.freeAccount).used("runs"))
            assertEquals(0L, resolver.usage(w.proAccount).used("runs"))
        } finally { cleanup(w) }
    }

    @Test
    fun `the reconcile sweep repairs a lost meter write and never double-counts`() {
        val w = seed()
        try {
            val runId = insertRun(w)          // metered by nobody: the write was "lost"
            val already = insertRun(w)
            UsageMeter(ds).meterRunAdmitted(already)

            ds.connection.use { c ->
                c.prepareStatement("SELECT reconcile_run_usage(now() - interval '1 hour')").use {
                    it.executeQuery().use { rs -> rs.next(); assertTrue(rs.getInt(1) >= 1) }
                }
            }

            assertEquals(1, ledgerRows(runId, "runs"))
            assertEquals(1, ledgerRows(already, "runs"))
            assertEquals(1L, ledgerQuantity(already, "runs"), "reconcile must not add to an existing row")
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5. Changing a limit in the database takes effect without a deploy.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `changing a plan limit in the database takes effect without a deploy`() {
        val w = seed()
        try {
            // A resolver with the PRODUCTION cache settings, not the test ones —
            // the point of this test is that the cache does not defeat the change.
            val resolver = EntitlementResolver(ds, versionPollMs = 0, ttlMs = 600_000)
            val guard = EntitlementGuard(resolver, ds, enforcing = true)

            assertEquals(3L, resolver.resolve(w.freeWorkspace).limit(EntitlementKeys.MAX_AGENTS))
            assertFailsWith<ApiError.PlanLimitExceeded> {
                guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 3)
            }

            // The change a support engineer makes in psql. Nothing calls an
            // invalidation endpoint; the statement-level trigger bumps the
            // catalogue version and the resolver notices on its next probe.
            exec("UPDATE plan_entitlements SET int_value = 50 WHERE plan_code='free' AND key='max_agents'")

            try {
                assertEquals(50L, resolver.resolve(w.freeWorkspace).limit(EntitlementKeys.MAX_AGENTS),
                    "the cached snapshot survived a catalogue change — a limit raised in " +
                        "the database would need a deploy to take effect")
                guard.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 3)
            } finally {
                exec("UPDATE plan_entitlements SET int_value = 3 WHERE plan_code='free' AND key='max_agents'")
            }
        } finally { cleanup(w) }
    }

    @Test
    fun `adding a plan takes effect without a deploy`() {
        val w = seed()
        try {
            exec(
                "INSERT INTO plans (code,name,price_cents,upgrade_to_code,sort_order) " +
                    "VALUES ('scale-test','Scale',19900,'enterprise',35) ON CONFLICT DO NOTHING"
            )
            exec(
                "INSERT INTO plan_entitlements (plan_code,key,kind,scope,int_value) " +
                    "VALUES ('scale-test','max_agents','limit','workspace',400) ON CONFLICT DO NOTHING"
            )
            exec("UPDATE billing_accounts SET plan_code='scale-test' WHERE id=?", w.freeAccount)

            try {
                val eff = freshResolver().resolve(w.freeWorkspace)
                assertEquals("scale-test", eff.plan.code)
                assertEquals(400L, eff.limit(EntitlementKeys.MAX_AGENTS))
                assertEquals("Enterprise", eff.plan.upgradeToName)
            } finally {
                exec("UPDATE billing_accounts SET plan_code='free' WHERE id=?", w.freeAccount)
                exec("DELETE FROM plans WHERE code='scale-test'")
            }
        } finally { cleanup(w) }
    }

    @Test
    fun `an account override beats the plan and is visible as an override`() {
        val w = seed()
        try {
            exec(
                "INSERT INTO account_entitlement_overrides (billing_account_id,key,kind,scope,int_value,reason) " +
                    "VALUES (?, 'max_agents', 'limit', 'workspace', 40, 'test grant')",
                w.freeAccount,
            )
            val eff = freshResolver().resolve(w.freeWorkspace)
            assertEquals(40L, eff.limit(EntitlementKeys.MAX_AGENTS))
            assertEquals("override", eff[EntitlementKeys.MAX_AGENTS]?.source,
                "the settings page shows the source so a negotiated limit does not read as a bug")

            // Still Free's plan, and still Free's other limits: an override is a
            // deviation on one key, not a silent upgrade.
            assertEquals("free", eff.plan.code)
            assertEquals(1L, eff.limit(EntitlementKeys.MAX_WORKSPACES))
        } finally { cleanup(w) }
    }

    @Test
    fun `an expired override stops applying without being deleted`() {
        val w = seed()
        try {
            exec(
                "INSERT INTO account_entitlement_overrides " +
                    "(billing_account_id,key,kind,scope,int_value,reason,expires_at) " +
                    "VALUES (?, 'max_agents', 'limit', 'workspace', 40, 'lapsed trial', now() - interval '1 day')",
                w.freeAccount,
            )
            val eff = freshResolver().resolve(w.freeWorkspace)
            assertEquals(3L, eff.limit(EntitlementKeys.MAX_AGENTS))
            assertEquals("plan", eff[EntitlementKeys.MAX_AGENTS]?.source)
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Shadow mode
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `with enforcement off, nothing is refused and everything is still resolved`() {
        val w = seed()
        try {
            // The production default. Every check that WOULD refuse logs instead.
            val shadow = EntitlementGuard(freshResolver(), ds, enforcing = false)

            exec(
                "INSERT INTO usage_records (run_id, metric, billing_account_id, workspace_id, quantity, period_start) " +
                    "SELECT gen_random_uuid(), 'runs', ?, ?, 1, p.period_start " +
                    "FROM account_current_period(?) p, generate_series(1, 500)",
                w.freeAccount, w.freeWorkspace, w.freeAccount,
            )

            // None of these throws. This is what makes the migration safe to
            // deploy: the model is live, the ledger fills up, and no customer is
            // refused until somebody sets ENTITLEMENTS_ENFORCED.
            shadow.requireQuota(shadow.resolve(w.freeWorkspace))
            shadow.requireLimit(w.freeWorkspace, EntitlementKeys.MAX_AGENTS, 999)
            shadow.requireFeature(w.freeWorkspace, EntitlementKeys.OTEL_EXPORT)
            shadow.requireNewWorkspaceAllowed(w.freeOwner)
            shadow.requireNewMemberAllowed(w.freeWorkspace, UUID.randomUUID())

            // And resolution is unaffected — shadow mode silences the refusal,
            // not the model. A settings page reads the same numbers either way.
            assertEquals("free", shadow.resolve(w.freeWorkspace).plan.code)
            assertFalse(shadow.hasFeature(w.freeWorkspace, EntitlementKeys.OTEL_EXPORT))
        } finally { cleanup(w) }
    }

    @Test
    fun `metering runs regardless of whether enforcement is armed`() {
        // The ledger is what S4 bills from, and it has to be complete for the
        // months BEFORE enforcement is switched on — otherwise the first invoice
        // is drawn from a partial history. Metering is data collection, not a
        // refusal, so it is deliberately not behind the flag.
        val w = seed()
        try {
            val runId = insertRun(w)
            assertTrue(UsageMeter(ds).meterRunAdmitted(runId))
            assertEquals(1L, ledgerQuantity(runId, "runs"))
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Invariants worth pinning
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `every entitlement key the code knows about is seeded for every plan`() {
        // The drift this catches: somebody adds a constant and forgets the seed
        // row. A missing limit resolves to "no opinion", a missing feature
        // resolves to OFF — so the failure is either a free upgrade or a silent
        // outage, and neither shows up until a customer hits it.
        val missing = mutableListOf<String>()
        ds.connection.use { c ->
            for (plan in listOf("free", "pro", "team", "enterprise")) {
                for (key in EntitlementKeys.ALL) {
                    c.prepareStatement(
                        "SELECT 1 FROM plan_entitlements WHERE plan_code=? AND key=?"
                    ).use {
                        it.setString(1, plan); it.setString(2, key)
                        it.executeQuery().use { rs -> if (!rs.next()) missing += "$plan/$key" }
                    }
                }
            }
        }
        assertTrue(missing.isEmpty(), "unseeded entitlements: $missing")
    }

    @Test
    fun `a workspace inserted without a billing account still gets one`() {
        // Schema skew, both directions: an API version that predates V060 inserts
        // a workspace with no billing_account_id. Without the trigger that row is
        // unbillable and its entitlements resolve to nothing — which, with
        // features failing closed, is a tenant who can do nothing at all.
        val id = UUID.randomUUID()
        try {
            exec("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)", id, "orphan", "orphan-$id")
            val eff = freshResolver().resolve(id)
            assertEquals("free", eff.plan.code)
            assertNotNull(eff.accountId)
        } finally {
            runCatching { exec("DELETE FROM workspaces WHERE id=?", id) }
        }
    }

    @Test
    fun `a second workspace joins the owner's existing account rather than minting a new one`() {
        // If it minted one, every Free user could have unlimited Free allowances
        // by creating workspaces, and max_workspaces would never bind.
        val w = seed()
        try {
            val second = UUID.randomUUID()
            exec(
                "INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)",
                second, "Pro Two", "pro-two-$second", w.proUser,
            )
            try {
                ds.connection.use { c ->
                    assertEquals(w.proAccount, accountOf(c, second))
                }
            } finally {
                runCatching { exec("DELETE FROM workspaces WHERE id=?", second) }
            }
        } finally { cleanup(w) }
    }

    // ── Ledger helpers ────────────────────────────────────────────────────────

    private fun ledgerRows(runId: UUID, metric: String): Int =
        ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM usage_records WHERE run_id=? AND metric=?").use {
                it.setObject(1, runId); it.setString(2, metric)
                it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }

    private fun ledgerQuantity(runId: UUID, metric: String): Long =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT COALESCE(SUM(quantity),0) FROM usage_records WHERE run_id=? AND metric=?"
            ).use {
                it.setObject(1, runId); it.setString(2, metric)
                it.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
            }
        }
}
