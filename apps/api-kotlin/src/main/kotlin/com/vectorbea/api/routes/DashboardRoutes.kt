package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.DashboardRepository

/**
 * GET /api/dashboard/summary
 *
 * Returns all overview metrics in one call.
 * Cached for 20 seconds per workspace+environment to keep the dashboard snappy
 * without hammering the DB on every page refresh.
 *
 * Response shape:
 * {
 *   "activeWorkflows": 12,
 *   "runningNow": 3,
 *   "failedLast24h": 2,
 *   "succeededLast24h": 47,
 *   "pendingApprovals": 1,
 *   "usageLast24h": { "tokens": 124300, "estimatedCost": 1.42 },
 *   "recentRunsTotal": 132
 * }
 */
class DashboardRoutes(
    private val repo: DashboardRepository,
    private val cache: CacheService,
) {
    fun register(router: Router) {
        router.get("/api/dashboard/summary", ::summary)
    }

    private fun summary(req: Request): Response {
        val ctx = req.context()

        val cacheKey = "dashboard:summary:${ctx.workspaceId}:${ctx.environmentId ?: "all"}"

        val data = cache.getOrSet(cacheKey, ttlSeconds = 20L) {
            repo.getSummary(ctx.workspaceId, ctx.environmentId)
        }

        return Response.ok(mapOf(
            "activeWorkflows"  to data.activeWorkflows,
            "runningNow"       to data.runningNow,
            "failedLast24h"    to data.failedLast24h,
            "succeededLast24h" to data.succeededLast24h,
            "pendingApprovals" to data.pendingApprovals,
            "usageLast24h"     to mapOf(
                "tokens"        to data.tokensLast24h,
                "estimatedCost" to data.estimatedCostLast24h,
            ),
            "recentRunsTotal"  to data.recentRunsTotal,
        ))
    }
}
