package com.vectorbea.api.connector

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WebhookUrlTesterTest {

    @Test
    fun `each provider accepts the URL its own settings screen hands out`() {
        assertNull(WebhookUrlTester.problem("teams",
            "https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sig=s"))
        assertNull(WebhookUrlTester.problem("teams",
            "https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=s"))
        assertNull(WebhookUrlTester.problem("teams", "https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/x/y"))
        assertNull(WebhookUrlTester.problem("google_chat",
            "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t"))
        assertNull(WebhookUrlTester.problem("discord", "https://discord.com/api/webhooks/123/token"))
    }

    @Test
    fun `a URL for somewhere else is refused with where to find the right one`() {
        val wrongHost = WebhookUrlTester.problem("teams", "https://discord.com/api/webhooks/123/token")
        assertNotNull(wrongHost)
        assertTrue(wrongHost.contains("Microsoft Teams") && wrongHost.contains("Workflows"))
        assertNotNull(WebhookUrlTester.problem("discord", "https://discord.com/channels/1/2"))
        assertNotNull(WebhookUrlTester.problem("google-chat", "https://chat.google.com/room/AAAA"))
        assertEquals("Webhook URLs must use https.", WebhookUrlTester.problem("discord", "http://discord.com/api/webhooks/1/t"))
        assertNotNull(WebhookUrlTester.problem("discord", ""))
        assertNotNull(WebhookUrlTester.problem("discord", "not a url"))
    }

    @Test
    fun `a failure never repeats the URL, which is the credential`() {
        val secret = "https://evil.example/api/webhooks/123/SUPER-SECRET"
        val result = WebhookUrlTester.test("discord", secret)
        assertEquals(ConnectionTestResult.TestStatus.FAILED, result.status)
        assertFalse(result.message.contains("SUPER-SECRET"))
    }
}
