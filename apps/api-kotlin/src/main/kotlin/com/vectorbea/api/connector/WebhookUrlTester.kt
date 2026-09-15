package com.vectorbea.api.connector

import com.vectorbea.api.security.SsrfGuard
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Testing a channel's incoming webhook — Microsoft Teams, Google Chat, Discord —
 * without posting to the channel.
 *
 * ── THE URL IS THE CREDENTIAL ───────────────────────────────────────────────
 * These services hand out one URL per channel, and anyone holding it can post
 * there: Discord's token is the last path segment, Teams' Workflows URL and
 * Google Chat's URL are signed in the query string. So the URL is stored the way
 * every credential is — encrypted, as the connection's secret, `auth_type =
 * 'webhook_url'` — and never in `config_json`, which the list endpoint returns.
 *
 * ── WHY "TESTED" MOSTLY MEANS "WELL-FORMED" ─────────────────────────────────
 * The only way to prove a Teams or Google Chat webhook works is to post a message
 * into somebody's channel, and a connection test that announces itself to a team
 * is not a test anybody wants to press twice. So those two are checked for shape
 * — https, the provider's own host, the path that host uses for webhooks — and the
 * result SAYS that nothing was posted. Discord answers a GET on a webhook URL with
 * the webhook's details and posts nothing, so Discord is genuinely verified.
 *
 * Messages never include the URL. A test result is shown on a screen and written
 * to `last_test_error_message_sanitized`.
 */
object WebhookUrlTester {

    private data class Rule(val label: String, val hosts: (String) -> Boolean, val path: (String) -> Boolean, val example: String)

    private val RULES: Map<String, Rule> = mapOf(
        "teams" to Rule(
            "Microsoft Teams",
            hosts = { h ->
                h.endsWith(".logic.azure.com") || h.endsWith(".powerplatform.com") ||
                    h.endsWith(".webhook.office.com") || h == "outlook.office.com"
            },
            path = { p -> p.contains("/workflows/") || p.contains("/webhookb2/") || p.contains("/powerautomate/") },
            example = "the URL from the Teams channel's Workflows > \"Post to a channel when a webhook request is received\"",
        ),
        "google-chat" to Rule(
            "Google Chat",
            hosts = { h -> h == "chat.googleapis.com" },
            path = { p -> p.startsWith("/v1/spaces/") && p.contains("/messages") },
            example = "the URL from the space's Apps & integrations > Webhooks",
        ),
        "discord" to Rule(
            "Discord",
            hosts = { h -> h == "discord.com" || h == "discordapp.com" || h == "canary.discord.com" || h == "ptb.discord.com" },
            path = { p -> p.startsWith("/api/webhooks/") },
            example = "the URL from the channel's Edit Channel > Integrations > Webhooks",
        ),
    )

    /** Providers that connect with a webhook URL. */
    val providers: Set<String> get() = RULES.keys

    private fun normalise(provider: String) = provider.trim().lowercase().replace('_', '-')

    /**
     * Why [url] is not a webhook for [provider], or null when it is well-formed.
     * Pure, so the rules can be tested without a network.
     */
    fun problem(provider: String, url: String?): String? {
        val rule = RULES[normalise(provider)]
        val raw = url?.trim().orEmpty()
        if (raw.isEmpty()) return "Paste the channel's webhook URL."
        val uri = runCatching { URI.create(raw) }.getOrNull()
        if (uri?.scheme == null || uri.host == null) return "That is not a URL. Paste the full webhook URL, starting https://."
        if (!uri.scheme.equals("https", ignoreCase = true)) return "Webhook URLs must use https."
        if (rule == null) return null
        val host = uri.host.lowercase()
        val path = uri.rawPath.orEmpty()
        if (!rule.hosts(host) || !rule.path(path)) {
            return "That doesn't look like a ${rule.label} webhook URL. Use ${rule.example}."
        }
        return null
    }

    fun test(provider: String, url: String?): ConnectionTestResult {
        val start = System.currentTimeMillis()
        problem(provider, url)?.let { return ConnectionTestResult.failed(0, "INVALID_WEBHOOK_URL", it) }
        try {
            SsrfGuard.validate(url!!.trim())
        } catch (_: Exception) {
            return ConnectionTestResult.failed(0, "INVALID_WEBHOOK_URL", "That webhook URL points at an address Vectorbea will not call.")
        }

        if (normalise(provider) != "discord") {
            val label = RULES[normalise(provider)]?.label ?: "webhook"
            return ConnectionTestResult.connected(
                System.currentTimeMillis() - start,
                "This is a well-formed $label webhook URL. Nothing was posted — send a test message from a tool to see it arrive.",
                details = mapOf("verified" to false),
            )
        }

        return try {
            val response = client.send(
                HttpRequest.newBuilder(URI.create(url.trim())).timeout(Duration.ofSeconds(8)).GET().build(),
                HttpResponse.BodyHandlers.discarding(),
            )
            val latency = System.currentTimeMillis() - start
            when (response.statusCode()) {
                in 200..299 -> ConnectionTestResult.connected(latency,
                    "Discord accepted the webhook. Nothing was posted.", details = mapOf("verified" to true))
                401, 403, 404 -> ConnectionTestResult.failed(latency, "WEBHOOK_REVOKED",
                    "Discord doesn't recognise this webhook. It may have been deleted — create a new one in the channel's settings.")
                else -> ConnectionTestResult.failed(latency, "WEBHOOK_UNEXPECTED",
                    "Discord answered HTTP ${response.statusCode()}. Try again in a moment.")
            }
        } catch (e: Exception) {
            ConnectionTestResult.failed(System.currentTimeMillis() - start, "WEBHOOK_UNREACHABLE",
                "Discord could not be reached (${e.javaClass.simpleName}). Try again in a moment.")
        }
    }

    private val client: HttpClient by lazy {
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build()
    }
}
