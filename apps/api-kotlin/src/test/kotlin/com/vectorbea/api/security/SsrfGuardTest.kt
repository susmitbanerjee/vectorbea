package com.vectorbea.api.security

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SsrfGuardTest {

    @BeforeEach
    fun setUp() {
        SsrfGuard.privateRunnerMode = false
    }

    @AfterEach
    fun tearDown() {
        SsrfGuard.privateRunnerMode = false
    }

    // ── Blocked targets ───────────────────────────────────────────────────────

    @Test
    fun `blocks localhost`() {
        assertFailsWith<SsrfGuard.SsrfBlockedException> {
            SsrfGuard.validate("http://localhost/api")
        }
    }

    @Test
    fun `blocks loopback IP 127-0-0-1`() {
        assertFailsWith<SsrfGuard.SsrfBlockedException> {
            SsrfGuard.validate("http://127.0.0.1:8080/health")
        }
    }

    @Test
    fun `blocks internal TLD`() {
        assertFailsWith<SsrfGuard.SsrfBlockedException> {
            SsrfGuard.validate("http://service.internal/api")
        }
    }

    @Test
    fun `blocks dot-local TLD`() {
        assertFailsWith<SsrfGuard.SsrfBlockedException> {
            SsrfGuard.validate("http://myhost.local/api")
        }
    }

    @Test
    fun `blocks non-http scheme`() {
        assertFailsWith<SsrfGuard.SsrfBlockedException> {
            SsrfGuard.validate("ftp://example.com/file")
        }
    }

    @Test
    fun `isSafe returns false for localhost`() {
        assertFalse(SsrfGuard.isSafe("http://localhost/api"))
    }

    @Test
    fun `isSafe returns false for internal-tld hostname`() {
        assertFalse(SsrfGuard.isSafe("http://myservice.internal/health"))
    }

    // ── Private runner mode bypass ────────────────────────────────────────────

    @Test
    fun `private runner mode skips SSRF checks`() {
        SsrfGuard.privateRunnerMode = true
        // Should not throw even for localhost
        SsrfGuard.validate("http://localhost/api")
    }

    // ── Safe external URLs ────────────────────────────────────────────────────

    @Test
    fun `allows valid public URL`() {
        // Note: this test does DNS resolution — may fail in offline CI.
        // The key assertion is that non-private hosts are allowed through.
        assertTrue(SsrfGuard.isSafe("https://api.openai.com/v1/models"))
    }

    @Test
    fun `rejects malformed URL`() {
        assertFailsWith<IllegalArgumentException> {
            SsrfGuard.validate("not-a-url")
        }
    }
}
