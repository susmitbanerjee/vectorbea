package com.vectorbea.api.http

import com.vectorbea.api.config.PublicUrls
import java.net.URI

/**
 * What the PUBLIC API hostname is allowed to reach: running workflows, and nothing else.
 *
 * ── ONE SERVICE, TWO FRONT DOORS ────────────────────────────────────────────
 * The API answers on two kinds of hostname. The platform one (the hosting
 * provider's service domain) is what the web app talks to, and it carries the
 * whole product: builder, settings, connections, members. The public one —
 * `api.vectorbea.com` in production, `devapi.vectorbea.com` elsewhere — is the
 * address printed in curl snippets and webhook URLs, the one customers put in
 * their own code and in third parties' consoles.
 *
 * Those are different promises. Nobody integrating with Vectorbea needs to list
 * a workspace's members through `api.vectorbea.com`, and every route reachable
 * on a published hostname is a route somebody will scan. So a request whose host
 * is a public API host reaches only what the published hostname exists for:
 *
 *   POST /api/workflows/:id/run          start a run (async, sync or stream)
 *   GET  /api/runs/:id                   read its status and output
 *   POST /api/hooks/:token               a webhook trigger — a run, started by a third party
 *   POST /api/tool-callbacks/:token      an async tool finishing, mid-run
 *   GET  /api/delivery-payloads/:token   a large run result, fetched by its receiver
 *   GET  /healthz, /health, /version
 *
 * The last three token routes are here because the worker prints them with the
 * same public base (`PUBLIC_API_BASE_URL`); refusing them would break a run a
 * customer already started. Everything else answers 404 — not 403, which would
 * confirm the route exists.
 *
 * ── IT ONLY EVER NARROWS ────────────────────────────────────────────────────
 * Authentication, plan checks and rate limits are unchanged and still run on the
 * routes this lets through. A request on any other hostname is untouched.
 * Loopback is never a public host, so local development is unaffected.
 *
 * ── AND IT CANNOT BE STEPPED AROUND WITH A HEADER ────────────────────────────
 * The host counts as public if the `Host` header OR any `X-Forwarded-Host`
 * value names a public host. A client adding a forged forwarded host can only
 * restrict itself; it cannot make a public-host request look private.
 */
object PublicHostGate {

    private val ALWAYS_PUBLIC = setOf("api.vectorbea.com", "devapi.vectorbea.com")

    private val ALLOWED: List<Pair<Set<String>, Regex>> = listOf(
        setOf("POST") to Regex("^/api/workflows/[^/]+/run/?$"),
        setOf("GET") to Regex("^/api/runs/[^/]+/?$"),
        setOf("POST") to Regex("^/api/hooks/[^/]+/?$"),
        setOf("POST") to Regex("^/api/tool-callbacks/[^/]+/?$"),
        setOf("GET") to Regex("^/api/delivery-payloads/[^/]+/?$"),
        setOf("GET", "HEAD") to Regex("^/(healthz|health|version)/?$"),
    )

    /** The hostnames treated as public. Computed once; the environment does not change under a process. */
    val publicHosts: Set<String> by lazy { hostsFrom(System::getenv) }

    fun hostsFrom(env: (String) -> String?): Set<String> = buildSet {
        addAll(ALWAYS_PUBLIC)
        hostOfUrl(PublicUrls.apiBase(env))?.let { add(it) }
        env("PUBLIC_API_HOSTS")?.split(',')?.map { it.trim().lowercase() }?.filter { it.isNotEmpty() }?.let { addAll(it) }
    }.filterNot { isLoopback(it) }.toSet()

    /**
     * Whether a request may proceed.
     *
     * [hostHeaders] is every value of `Host` and `X-Forwarded-Host` on the request.
     * OPTIONS is judged by the path it pre-flights, so a browser calling the run
     * endpoint cross-origin still gets its preflight answered.
     */
    fun allows(
        method: String,
        path: String,
        hostHeaders: List<String>,
        hosts: Set<String> = publicHosts,
    ): Boolean {
        val onPublicHost = hostHeaders
            .flatMap { it.split(',') }
            .map { normaliseHost(it) }
            .any { it in hosts }
        if (!onPublicHost) return true
        val m = method.uppercase()
        return ALLOWED.any { (methods, pattern) ->
            (m in methods || m == "OPTIONS") && pattern.matches(path)
        }
    }

    private fun normaliseHost(raw: String): String {
        val h = raw.trim().lowercase()
        return if (h.startsWith("[")) h.substringBefore("]") + "]" else h.substringBefore(':')
    }

    private fun hostOfUrl(url: String): String? = runCatching { URI.create(url).host?.lowercase() }.getOrNull()

    private fun isLoopback(host: String) = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "0.0.0.0"
}
