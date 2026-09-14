package com.vectorbea.api.config

import java.net.URI

/**
 * The addresses we give OUT — to customers, to third parties, to an OAuth
 * provider's consent screen.
 *
 * ── NOT THE ADDRESS WE RUN AT ───────────────────────────────────────────────
 * The API is hosted on a platform provider and reachable at that provider's
 * hostname. That hostname is an implementation detail: printing it in a webhook
 * URL, a curl snippet or an OAuth `redirect_uri` hands out a way to address the
 * API past whatever fronts the vanity domain, and makes a provider we may leave
 * something every integration depends on. A `redirect_uri` is worse than the
 * rest — it is registered with the authorization server and shown to the person
 * signing in.
 *
 * ── THE DEFAULTS FOLLOW THE ENVIRONMENT ─────────────────────────────────────
 * `VECTORBEA_ENV` already segments prod from non-prod (docs/deployment). So:
 *
 *   prod                → https://api.vectorbea.com
 *   dev / stage / other → https://devapi.vectorbea.com
 *   local (no env set, loopback PORT) → http://localhost:<PORT>
 *
 * `PUBLIC_API_BASE_URL` overrides all of it, for a deployment that fronts the
 * API somewhere else. The web app derives the same answer from
 * `NEXT_PUBLIC_VECTORBEA_ENV`, so a webhook URL and a curl snippet cannot name
 * two different hosts.
 */
object PublicUrls {

    const val PROD_API = "https://api.vectorbea.com"
    const val DEV_API = "https://devapi.vectorbea.com"
    const val PROD_APP = "https://app.vectorbea.com"
    const val DEV_APP = "https://dev.vectorbea.com"

    fun apiBase(env: (String) -> String? = System::getenv): String {
        env("PUBLIC_API_BASE_URL")?.trim()?.trimEnd('/')?.takeIf { it.startsWith("http") }?.let { return it }
        return when (environment(env)) {
            "prod", "production" -> PROD_API
            null -> if (env("APP_ENV")?.lowercase() in setOf(null, "development", "local"))
                "http://localhost:${env("PORT") ?: "8080"}" else DEV_API
            else -> DEV_API
        }
    }

    /**
     * The web app's origin, for sending a browser back after a redirect.
     *
     * Only hosts we own are accepted from configuration — this value becomes the
     * destination of a 302 from an unauthenticated endpoint, and an open
     * redirect there is a phishing link with our domain on it.
     */
    fun appBase(env: (String) -> String? = System::getenv): String =
        sequenceOf(env("APP_URL"), env("NEXT_PUBLIC_APP_URL"))
            .mapNotNull { canonicalOwnedOrigin(it) }
            .firstOrNull()
            ?: when (environment(env)) {
                "prod", "production" -> PROD_APP
                null -> if (env("APP_ENV")?.lowercase() in setOf(null, "development", "local"))
                    "http://localhost:3000" else PROD_APP
                else -> DEV_APP
            }

    /**
     * `VECTORBEA_ENV`, or — when a deployment forgot to set it — the hosting
     * platform's own environment name. Falling through to "local" on a hosted
     * environment would print `localhost` into a customer's webhook URL, which
     * is the one wrong answer worse than a dev host.
     */
    private fun environment(env: (String) -> String?): String? =
        env("VECTORBEA_ENV")?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
            ?: env("RAILWAY_ENVIRONMENT_NAME")?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
                ?.let { if (it == "production" || it == "prod") "prod" else "dev" }

    fun canonicalOwnedOrigin(raw: String?): String? {
        val value = raw?.trim()?.trimEnd('/')?.takeIf { it.isNotBlank() } ?: return null
        val uri = runCatching { URI.create(if ("://" in value) value else "https://$value") }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()?.takeIf { it == "https" || it == "http" } ?: return null
        val host = uri.host?.lowercase() ?: return null
        val owned = host == "localhost" || host == "127.0.0.1" ||
            host == "vectorbea.com" || host.endsWith(".vectorbea.com") ||
            host == "vectorbea.app" || host.endsWith(".vectorbea.app")
        if (!owned) return null
        val port = uri.port
        val portPart = if (port > 0 && !((scheme == "https" && port == 443) || (scheme == "http" && port == 80))) ":$port" else ""
        return "$scheme://$host$portPart"
    }
}
