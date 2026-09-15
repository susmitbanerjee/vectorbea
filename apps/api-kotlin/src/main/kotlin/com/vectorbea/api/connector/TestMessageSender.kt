package com.vectorbea.api.connector

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.security.SsrfGuard
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Send one real message through a messaging connection, so the person
 * registering a tool can see it arrive before any workflow depends on it.
 *
 * ── WHY THIS EXISTS BESIDE A SIDE-EFFECT-FREE VALIDATE ──────────────────────
 * `POST /api/tools/test-unsaved` is side-effect free by contract, and that is
 * right for it: validating a DELETE must never delete. But for a message tool
 * "valid" proves almost nothing. The failures people actually hit — the bot was
 * never invited to the channel, the channel ID was copied wrong, the token lacks
 * `chat:write`, the webhook was deleted — are only reported by the provider, and
 * only when something is posted. So this is a SEPARATE, explicitly-named action
 * that the dialog labels "Send test message", not a mode of Validate.
 *
 * ── WHAT IT WILL SEND ───────────────────────────────────────────────────────
 * Only the four catalogue post operations, with a body built HERE rather than
 * taken from the client — the client supplies the channel and the text, never
 * the request. The Teams card and the Discord/Google Chat bodies mirror the
 * `bodyTemplate`s in `apps/web/src/content/integrations.ts`; change both
 * together.
 *
 * ── WHAT IT WILL NOT SAY ────────────────────────────────────────────────────
 * The outcome carries the provider's error CODE (`not_in_channel`) and a
 * sentence saying how to fix it. Never a webhook URL (the URL is the credential),
 * never a raw response body, never an exception message (an HTTP client's can
 * contain the URI).
 */
class TestMessageSender(
    private val post: (url: String, headers: Map<String, String>, body: String) -> Pair<Int, String> = ::httpPost,
    private val webhooksEnabled: Boolean = MESSAGING_WEBHOOKS_ENABLED,
    private val checkUrl: (String) -> Unit = { SsrfGuard.validate(it) },
) {
    data class Outcome(
        val delivered: Boolean,
        val errorCode: String?,
        val message: String,
        val latencyMs: Long,
    ) {
        fun toResponse(): Map<String, Any?> = mapOf(
            "delivered" to delivered,
            "errorCode" to errorCode,
            "message" to message,
            "latencyMs" to latencyMs,
        )
    }

    fun send(
        provider: String,
        authType: String,
        secret: String?,
        operationId: String,
        parameters: Map<String, String>,
    ): Outcome {
        val start = System.currentTimeMillis()
        fun failed(code: String, message: String) = Outcome(false, code, message, System.currentTimeMillis() - start)

        val normalised = normalise(provider)
        val operationProvider = operationId.substringBeforeLast('.')
        if (operationId !in OPERATIONS) {
            return failed("UNSUPPORTED_OPERATION", "Test messages can be sent for Slack, Microsoft Teams, Google Chat and Discord posts.")
        }
        if (normalise(operationProvider) != normalised) {
            return failed("PROVIDER_MISMATCH", "This connection is not a ${label(operationProvider)} connection. Pick the right connection and try again.")
        }
        if (secret.isNullOrBlank()) {
            return failed("SECRET_MISSING", "This connection has no credential stored. Add it on the connection, then try again.")
        }

        val text = (parameters["text"] ?: parameters["content"])?.trim().orEmpty()
        if (text.isEmpty()) return failed("TEXT_MISSING", "Write the test message first.")
        if (text.length > MAX_TEXT) return failed("TEXT_TOO_LONG", "Keep the test message under $MAX_TEXT characters.")

        return if (normalised == "slack") sendSlack(authType, secret, parameters, text, ::failed, start)
        else sendWebhook(normalised, authType, secret, parameters, text, ::failed, start)
    }

    // ── Slack ────────────────────────────────────────────────────────────────

    private fun sendSlack(
        authType: String,
        token: String,
        parameters: Map<String, String>,
        text: String,
        failed: (String, String) -> Outcome,
        start: Long,
    ): Outcome {
        if (authType.equals("webhook_url", ignoreCase = true)) {
            return failed("UNSUPPORTED_AUTH", "This Slack connection has no bot token. Reconnect Slack with its xoxb- bot token.")
        }
        val channel = parameters["channel"]?.trim().orEmpty()
        if (channel.isEmpty()) return failed("CHANNEL_MISSING", "Enter the channel to send the test to — its ID (starts with C) or its #name.")

        val body = buildMap<String, Any> {
            put("channel", channel)
            put("text", text)
            parameters["thread_ts"]?.trim()?.takeIf { it.isNotEmpty() }?.let { put("thread_ts", it) }
        }
        val (status, response) = try {
            post(
                "https://slack.com/api/chat.postMessage",
                mapOf("Authorization" to "Bearer $token", "Content-Type" to "application/json; charset=utf-8"),
                mapper.writeValueAsString(body),
            )
        } catch (e: Exception) {
            return failed("UNREACHABLE", "Slack could not be reached (${e.javaClass.simpleName}). Try again in a moment.")
        }
        if (status == 429) return failed("ratelimited", "Slack is rate limiting this bot. Wait a minute and send again.")
        if (status !in 200..299) return failed("HTTP_$status", "Slack answered HTTP $status. Try again in a moment.")

        val parsed = runCatching { mapper.readTree(response) }.getOrNull()
        if (parsed?.path("ok")?.asBoolean(false) == true) {
            return Outcome(true, null, "Sent. Check the channel in Slack — the test message is there now.", System.currentTimeMillis() - start)
        }
        val error = parsed?.path("error")?.asText()?.takeIf { it.isNotBlank() && SLACK_CODE.matches(it) } ?: "unknown_error"
        return failed(error, slackGuidance(error))
    }

    private fun slackGuidance(error: String): String = when (error) {
        "not_in_channel" ->
            "The bot isn't in that channel. In Slack, open the channel and type /invite @your-bot, then send again."
        "channel_not_found" ->
            "Slack can't find that channel. Use the channel ID from the channel's details (it starts with C), and for a private channel invite the bot first."
        "is_archived" -> "That channel is archived. Pick a channel that is still in use."
        "invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive" ->
            "Slack rejected the bot token. Copy the Bot User OAuth Token (starts with xoxb-) from your Slack app and update the connection."
        "missing_scope" ->
            "The Slack app can't post messages. Add the chat:write scope under OAuth & Permissions, reinstall the app, and update the token on the connection."
        "restricted_action", "ekm_access_denied" ->
            "Your Slack workspace doesn't allow this bot to post there. Ask a Slack admin to allow it."
        "msg_too_long" -> "That message is too long for Slack. Shorten it and send again."
        "ratelimited", "rate_limited" -> "Slack is rate limiting this bot. Wait a minute and send again."
        else -> "Slack refused the message ($error)."
    }

    // ── Channel webhooks ─────────────────────────────────────────────────────

    private fun sendWebhook(
        provider: String,
        authType: String,
        url: String,
        parameters: Map<String, String>,
        text: String,
        failed: (String, String) -> Outcome,
        start: Long,
    ): Outcome {
        val name = label(provider)
        if (!authType.equals("webhook_url", ignoreCase = true)) {
            return failed("UNSUPPORTED_AUTH", "This $name connection has no webhook URL. Reconnect $name with the channel's webhook URL.")
        }
        if (!webhooksEnabled) {
            return failed("WEBHOOKS_DISABLED",
                "Posting to $name is switched off on this deployment. Set MESSAGING_WEBHOOKS_ENABLED=true on the API and worker services.")
        }
        WebhookUrlTester.problem(provider, url)?.let {
            return failed("INVALID_WEBHOOK_URL", "The webhook URL stored on this connection isn't a valid $name webhook. Paste it again on the connection.")
        }
        try {
            checkUrl(url.trim())
        } catch (_: Exception) {
            return failed("INVALID_WEBHOOK_URL", "The webhook URL stored on this connection points at an address Vectorbea will not call.")
        }

        val body: Map<String, Any> = when (provider) {
            "teams" -> mapOf(
                "type" to "message",
                "attachments" to listOf(mapOf(
                    "contentType" to "application/vnd.microsoft.card.adaptive",
                    "content" to mapOf(
                        "\$schema" to "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type" to "AdaptiveCard",
                        "version" to "1.4",
                        "body" to listOf(mapOf("type" to "TextBlock", "text" to text, "wrap" to true)),
                    ),
                )),
            )
            "google-chat" -> mapOf("text" to text)
            else -> buildMap {
                put("content", text)
                parameters["username"]?.trim()?.takeIf { it.isNotEmpty() }?.let { put("username", it.take(80)) }
            }
        }

        val (status, _) = try {
            post(url.trim(), mapOf("Content-Type" to "application/json; charset=utf-8"), mapper.writeValueAsString(body))
        } catch (e: Exception) {
            return failed("UNREACHABLE", "$name could not be reached (${e.javaClass.simpleName}). Try again in a moment.")
        }
        return when (status) {
            in 200..299 -> Outcome(true, null, "Sent. Check the channel in $name — the test message is there now.", System.currentTimeMillis() - start)
            400 -> failed("HTTP_400", "$name refused the message. If this is a Teams Workflows webhook, check the flow is turned on and still posts to a channel.")
            401, 403, 404, 410 -> failed("WEBHOOK_GONE", "$name doesn't recognise this webhook any more — it may have been deleted or turned off. Create a new one and update the connection.")
            429 -> failed("HTTP_429", "$name is rate limiting this webhook. Wait a minute and send again.")
            else -> failed("HTTP_$status", "$name answered HTTP $status. Try again in a moment.")
        }
    }

    companion object {
        val OPERATIONS = setOf("slack.post", "teams.post", "google-chat.post", "discord.post")
        const val MAX_TEXT = 2000

        private val mapper = jacksonObjectMapper()
        /** Slack error codes are short snake_case words; anything else is not echoed. */
        private val SLACK_CODE = Regex("^[a-z_]{2,64}$")

        private fun normalise(provider: String) = provider.trim().lowercase().replace('_', '-')

        private fun label(provider: String) = when (normalise(provider)) {
            "slack" -> "Slack"
            "teams" -> "Microsoft Teams"
            "google-chat" -> "Google Chat"
            "discord" -> "Discord"
            else -> provider
        }

        /** Same variable the worker reads, so a test cannot succeed where a run would be refused. */
        val MESSAGING_WEBHOOKS_ENABLED: Boolean =
            System.getenv("MESSAGING_WEBHOOKS_ENABLED")?.lowercase() in setOf("true", "1", "yes")

        private val client: HttpClient by lazy {
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build()
        }

        private fun httpPost(url: String, headers: Map<String, String>, body: String): Pair<Int, String> {
            val builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(body))
            headers.forEach { (k, v) -> builder.header(k, v) }
            val response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
            return response.statusCode() to response.body().take(64_000)
        }
    }
}
