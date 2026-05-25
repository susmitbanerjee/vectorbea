package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router

/**
 * Version endpoint.
 *
 * GET /version
 *   Returns service identity and build metadata.
 *   Safe to expose publicly — contains no secrets.
 */
class VersionRoutes(private val config: AppConfig) {

    fun register(router: Router) {
        router.get("/version", ::version)
    }

    private fun version(@Suppress("UNUSED_PARAMETER") req: Request): Response =
        Response.ok(
            VersionResponse(
                service = "vectorbea-api",
                version = config.version,
                commit = config.commit,
                env = config.appEnv,
            )
        )

    data class VersionResponse(
        val service: String,
        val version: String,
        val commit: String?,
        val env: String,
    )
}
