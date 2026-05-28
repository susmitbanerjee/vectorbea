package com.vectorbea.worker.connector

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.test.assertNotNull

class SsrfGuardTest {

    // ── checkUrl: valid public URLs ───────────────────────────────────────────

    @Test
    fun `public HTTPS URL passes`() {
        SsrfGuard.checkUrl("https://api.openai.com/v1/chat/completions", emptyList())
    }

    @Test
    fun `public HTTP URL passes`() {
        SsrfGuard.checkUrl("http://example.com/webhook", emptyList())
    }

    // ── checkUrl: blocked hosts by name ──────────────────────────────────────

    @Test
    fun `localhost is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://localhost/admin", emptyList())
        }
    }

    @Test
    fun `metadata google internal is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://metadata.google.internal/computeMetadata/v1/", emptyList())
        }
    }

    // ── checkUrl: blocked IPs ─────────────────────────────────────────────────

    @Test
    fun `loopback IP 127_0_0_1 is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://127.0.0.1:8080/secret", emptyList())
        }
    }

    @Test
    fun `RFC1918 10_x is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://10.0.0.1/internal", emptyList())
        }
    }

    @Test
    fun `RFC1918 192_168_x is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://192.168.1.100/", emptyList())
        }
    }

    @Test
    fun `link-local 169_254_x is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://169.254.169.254/latest/meta-data/", emptyList())
        }
    }

    // ── allowedHosts enforcement ──────────────────────────────────────────────

    @Test
    fun `allowed host passes when in allow-list`() {
        SsrfGuard.checkUrl("https://api.openai.com/v1/chat", listOf("api.openai.com"))
    }

    @Test
    fun `subdomain matches parent entry in allow-list`() {
        // Test allow-list logic directly without DNS — "sub.example.com" ends with ".example.com"
        // We verify the allow-list check fires before DNS resolution by using checkHost directly.
        // Use api.openai.com which resolves to a real public IP.
        SsrfGuard.checkHost("api.openai.com", listOf("openai.com"))
    }

    @Test
    fun `host blocked when not in non-empty allow-list`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("https://evil.com/exfil", listOf("api.openai.com"))
        }
    }

    // ── checkUrl: invalid URLs ─────────────────────────────────────────────────

    @Test
    fun `URL without host throws`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("not-a-url", emptyList())
        }
    }

    @Test
    fun `RFC1918 172_16_x is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://172.16.0.1/internal", emptyList())
        }
    }

    @Test
    fun `RFC1918 172_31_x is blocked`() {
        assertThrows<SsrfException> {
            SsrfGuard.checkUrl("http://172.31.255.255/internal", emptyList())
        }
    }

    @Test
    fun `172_32_x is not blocked (outside private range)`() {
        // 172.32.x is outside the 172.16-31 range — should resolve without SSRF block.
        // This test just verifies we don't block the entire 172.x space.
        // It may throw SsrfException if it can't resolve the hostname,
        // but NOT because of the private-range check.
        try {
            SsrfGuard.checkUrl("http://172.32.0.1/api", emptyList())
        } catch (e: SsrfException) {
            // Allowed only if the message is about DNS resolution, not private range
            assert(!e.message!!.contains("RFC1918")) {
                "172.32.x should not be blocked as RFC1918: ${e.message}"
            }
        }
    }
}
