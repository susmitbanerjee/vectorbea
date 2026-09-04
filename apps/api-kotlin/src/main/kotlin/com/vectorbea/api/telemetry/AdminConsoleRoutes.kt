package com.vectorbea.api.telemetry

import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory

/**
 * The admin analytics console, served from the API's own jar.
 *
 * It moved from `/` on the telemetry host to `/admin/telemetry` here, because `/` on
 * the API is not available and because the console is now one page among many rather
 * than a whole service's reason to exist.
 *
 * NO AUTH ON THE ASSETS, AUTH ON THE DATA
 * ---------------------------------------
 * The HTML, CSS and JavaScript are public; every endpoint they call requires a platform
 * admin. That is the same arrangement as the standalone service and it is the right one:
 * gating static assets behind a bearer token means the page cannot bootstrap far enough
 * to ask for one. There is nothing in these three files worth protecting - the data is
 * what matters, and the data is protected.
 */
class AdminConsoleRoutes {
    private val log = LoggerFactory.getLogger(AdminConsoleRoutes::class.java)

    fun register(router: Router) {
        router.get("/admin/telemetry/styles.css") { asset("styles.css", "text/css") }
        router.get("/admin/telemetry/app.js") { asset("app.js", "application/javascript") }

        // Client-side routing: every console path serves the same shell and the page
        // decides what to render. Enumerated rather than wildcarded so an unknown path
        // still 404s instead of silently returning HTML to a mistyped API call.
        listOf(
            "/admin/telemetry", "/admin/telemetry/", "/admin/telemetry/business",
            "/admin/telemetry/engineering", "/admin/telemetry/users",
            "/admin/telemetry/revenue", "/admin/telemetry/architect",
            "/admin/telemetry/workflows", "/admin/telemetry/environments",
        ).forEach { path ->
            router.get(path) { asset("index.html", "text/html; charset=utf-8") }
        }

        log.info("[telemetry] admin console at /admin/telemetry")
    }

    private fun asset(name: String, contentType: String): Response {
        val bytes = javaClass.getResourceAsStream("/static/admin-telemetry/$name")?.readBytes()
            ?: return Response(404, "Not found")
        return Response(
            status = 200,
            body = String(bytes, Charsets.UTF_8),
            headers = mapOf(
                "Content-Type" to contentType,
                // Short cache: the console ships inside the API jar, so its version is
                // the API's version. A long cache would show yesterday's console after
                // a deploy, which is exactly when someone is looking at it.
                "Cache-Control" to "public, max-age=60",
            ),
        )
    }
}
