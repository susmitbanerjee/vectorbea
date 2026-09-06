package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.entitlements.EntitlementKeys
import com.vectorbea.api.entitlements.EntitlementResolver
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * What this workspace is entitled to, and what it has used.
 *
 * ── WHY THE UI GETS THIS RATHER THAN A PLAN NAME ────────────────────────────
 * A settings page that renders from a plan CODE has to keep its own copy of what
 * each plan includes, and that copy is wrong the first time somebody raises a
 * limit in the database — which is the entire point of making plans data. So the
 * response carries the resolved entitlements themselves, with each one's source
 * ("plan" or "override"), and the page renders whatever it is handed.
 *
 * It is also what makes a UI feature gate agree with the API's. Both read this;
 * neither has a list.
 *
 * ── THE WORKSPACE IS THE SUBJECT, NOT THE READER ────────────────────────────
 * Scoped through `req.context()`, which has already verified the workspace
 * against the caller's memberships. A Pro user reading this inside a Free
 * workspace sees FREE — the same answer every enforcement point will give them,
 * which is what stops the UI promising something the API then refuses.
 */
class EntitlementRoutes(
    private val ds: DataSource,
    private val resolver: EntitlementResolver,
    private val guard: EntitlementGuard,
) {
    private val log = LoggerFactory.getLogger(EntitlementRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/entitlements") { req -> entitlements(req) }
        router.get("/api/plans") { _ -> plans() }
    }

    private fun entitlements(req: Request): Response {
        val ctx = req.context()
        val eff = resolver.resolve(ctx.workspaceId)
        val usage = resolver.usage(eff.accountId)

        // The live counts every LIMIT is compared against, returned alongside the
        // limits themselves. Without them the page can show "5 agents allowed"
        // but not "3 of 5", and "3 of 5" is the only version anybody can act on.
        val counts = mapOf(
            EntitlementKeys.MAX_WORKSPACES to guard.workspaceCount(eff.accountId),
            EntitlementKeys.MAX_MEMBERS_PER_WORKSPACE to guard.memberCount(ctx.workspaceId),
            EntitlementKeys.MAX_AGENTS to guard.agentCount(ctx.workspaceId),
            EntitlementKeys.MAX_SEATS to guard.seatsUsed(eff.accountId),
        )

        return Response.ok(
            eff.toMap() + mapOf(
                "usage" to usage.toMap(),
                "counts" to counts,
                // Seats are the billed quantity under per-seat pricing, so the
                // page shows purchased and used side by side rather than making
                // the reader work out which number the invoice follows.
                "seats" to mapOf(
                    "purchased" to eff.seatsPurchased,
                    "used" to guard.seatsUsed(eff.accountId),
                    "max" to eff[EntitlementKeys.MAX_SEATS]?.intValue,
                ),
            )
        )
    }

    /**
     * The public catalogue, with each plan's entitlements.
     *
     * Read straight from the tables so a plan added in psql appears on the
     * pricing page without a deploy — which is the acceptance criterion this
     * endpoint exists to make true end to end rather than only in the resolver.
     */
    private fun plans(): Response {
        val rows = ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT p.code, p.name, p.description, p.price_cents, p.currency,
                          p.billing_interval, p.price_model, p.upgrade_to_code, p.upgrade_url,
                          p.sort_order,
                          e.key, e.kind, e.scope, e.period,
                          e.int_value, e.bool_value, e.num_value, e.text_value
                     FROM plans p
                     LEFT JOIN plan_entitlements e ON e.plan_code = p.code
                    WHERE p.is_public AND p.archived_at IS NULL
                    ORDER BY p.sort_order, e.key"""
            ).use { st ->
                st.executeQuery().use { rs ->
                    val byCode = LinkedHashMap<String, MutableMap<String, Any?>>()
                    while (rs.next()) {
                        val code = rs.getString("code")
                        val plan = byCode.getOrPut(code) {
                            mutableMapOf(
                                "code" to code,
                                "name" to rs.getString("name"),
                                "description" to rs.getString("description"),
                                "priceCents" to (rs.getObject("price_cents") as? Int),
                                "currency" to rs.getString("currency"),
                                "billingInterval" to rs.getString("billing_interval"),
                                "priceModel" to rs.getString("price_model"),
                                "upgradeTo" to rs.getString("upgrade_to_code"),
                                "upgradeUrl" to rs.getString("upgrade_url"),
                                "sortOrder" to rs.getInt("sort_order"),
                                "entitlements" to mutableListOf<Map<String, Any?>>(),
                            )
                        }
                        val key = rs.getString("key") ?: continue
                        @Suppress("UNCHECKED_CAST")
                        (plan["entitlements"] as MutableList<Map<String, Any?>>).add(
                            mapOf(
                                "key" to key,
                                "kind" to rs.getString("kind"),
                                "scope" to rs.getString("scope"),
                                "period" to rs.getString("period"),
                                "label" to EntitlementKeys.label(key),
                                "value" to when (rs.getString("kind")) {
                                    "feature" -> rs.getObject("bool_value") as? Boolean
                                    "setting" -> rs.getObject("num_value") ?: rs.getString("text_value")
                                    else -> rs.getObject("int_value")?.let { (it as Number).toLong() }
                                },
                            )
                        )
                    }
                    byCode.values.toList()
                }
            }
        }
        return Response.ok(mapOf("plans" to rows))
    }
}
