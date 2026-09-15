package com.vectorbea.api.connector

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TestMessageSenderTest {

    private class Sent { var url: String? = null; var headers: Map<String, String> = emptyMap(); var body: String = "" }

    private fun sender(sent: Sent, status: Int, response: String, webhooks: Boolean = true) = TestMessageSender(
        post = { url, headers, body -> sent.url = url; sent.headers = headers; sent.body = body; status to response },
        webhooksEnabled = webhooks,
        checkUrl = {},
    )

    @Test
    fun `a Slack test posts the channel and text with the bot token as Bearer`() {
        val sent = Sent()
        val outcome = sender(sent, 200, """{"ok":true,"channel":"C1"}""")
            .send("slack", "api_key", "xoxb-1", "slack.post", mapOf("channel" to "C0OPS", "text" to "hello \"team\""))
        assertTrue(outcome.delivered)
        assertEquals("https://slack.com/api/chat.postMessage", sent.url)
        assertEquals("Bearer xoxb-1", sent.headers["Authorization"])
        assertTrue(sent.body.contains("\"channel\":\"C0OPS\"") && sent.body.contains("hello \\\"team\\\""))
    }

    @Test
    fun `Slack's refusal comes back as its code and a fix, not as a success`() {
        val outcome = sender(Sent(), 200, """{"ok":false,"error":"not_in_channel"}""")
            .send("slack", "api_key", "xoxb-1", "slack.post", mapOf("channel" to "C0OPS", "text" to "hi"))
        assertFalse(outcome.delivered)
        assertEquals("not_in_channel", outcome.errorCode)
        assertTrue(outcome.message.contains("/invite"))
    }

    @Test
    fun `a Slack test without a channel sends nothing`() {
        val sent = Sent()
        val outcome = sender(sent, 200, """{"ok":true}""").send("slack", "api_key", "xoxb-1", "slack.post", mapOf("text" to "hi"))
        assertEquals("CHANNEL_MISSING", outcome.errorCode)
        assertNull(sent.url)
    }

    @Test
    fun `a Teams test posts a card to the stored URL and never repeats the URL`() {
        val sent = Sent()
        val url = "https://prod-1.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SECRET"
        val ok = sender(sent, 202, "").send("teams", "webhook_url", url, "teams.post", mapOf("text" to "hi"))
        assertTrue(ok.delivered)
        assertEquals(url, sent.url)
        assertTrue(sent.body.contains("AdaptiveCard") && sent.body.contains("\"text\":\"hi\""))

        val gone = sender(Sent(), 404, "").send("teams", "webhook_url", url, "teams.post", mapOf("text" to "hi"))
        assertEquals("WEBHOOK_GONE", gone.errorCode)
        assertFalse(gone.message.contains("SECRET") || gone.message.contains("logic.azure.com"))
    }

    @Test
    fun `webhook tests follow the worker's flag, so a test cannot pass where a run is refused`() {
        val sent = Sent()
        val outcome = sender(sent, 204, "", webhooks = false)
            .send("discord", "webhook_url", "https://discord.com/api/webhooks/1/t", "discord.post", mapOf("content" to "hi"))
        assertEquals("WEBHOOKS_DISABLED", outcome.errorCode)
        assertTrue(outcome.message.contains("MESSAGING_WEBHOOKS_ENABLED"))
        assertNull(sent.url)
    }

    @Test
    fun `only the four post operations, on their own provider`() {
        val s = sender(Sent(), 200, """{"ok":true}""")
        assertEquals("UNSUPPORTED_OPERATION", s.send("slack", "api_key", "x", "slack.read", mapOf("text" to "hi")).errorCode)
        assertEquals("PROVIDER_MISMATCH", s.send("slack", "api_key", "x", "discord.post", mapOf("content" to "hi")).errorCode)
        assertEquals("SECRET_MISSING", s.send("slack", "api_key", null, "slack.post", mapOf("channel" to "C", "text" to "hi")).errorCode)
    }
}
