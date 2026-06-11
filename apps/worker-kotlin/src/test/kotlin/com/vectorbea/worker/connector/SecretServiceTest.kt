package com.vectorbea.worker.connector

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Tests for [SecretService].
 * All tests use in-memory DataSource stubs — no real DB required.
 */
class SecretServiceTest {

    companion object {
        // 32-byte key for AES-256
        private val KEY_BYTES = ByteArray(32) { it.toByte() }
        private val KEY_BASE64 = Base64.getEncoder().encodeToString(KEY_BYTES)
        private const val ALGORITHM = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12
        private const val GCM_TAG_BITS = 128
    }

    private fun serviceWithKey() = SecretService(KEY_BASE64, NoOpDataSource)
    private fun serviceNoKey()   = SecretService(null, NoOpDataSource)

    // ── No key (dev mode) ─────────────────────────────────────────────────────

    @Test
    fun `resolve with no key returns secretRef as plaintext`() {
        val svc = serviceNoKey()
        val result = svc.resolve("my-plaintext-secret")
        assertNotNull(result)
        result.useOnce { plain -> assertEquals("my-plaintext-secret", plain) }
    }

    @Test
    fun `resolve null returns null`() {
        val svc = serviceNoKey()
        assertNull(svc.resolve(null))
    }

    @Test
    fun `resolve blank string returns null`() {
        val svc = serviceNoKey()
        assertNull(svc.resolve("   "))
    }

    // ── Direct aes256gcm: prefix ──────────────────────────────────────────────

    @Test
    fun `encrypt then resolve roundtrip`() {
        val svc = serviceWithKey()
        val plaintext = "super-secret-api-key-12345"
        val ref = svc.encrypt(plaintext)

        assert(ref.startsWith("aes256gcm:")) { "Encrypted ref should start with aes256gcm: but got: $ref" }

        val resolved = svc.resolve(ref)
        assertNotNull(resolved)
        resolved.useOnce { plain -> assertEquals(plaintext, plain) }
    }

    @Test
    fun `each encrypt produces different ciphertext (random IV)`() {
        val svc = serviceWithKey()
        val ref1 = svc.encrypt("same-plaintext")
        val ref2 = svc.encrypt("same-plaintext")
        assert(ref1 != ref2) { "Two encryptions of same plaintext should differ due to random IV" }
    }

    @Test
    fun `tampered ciphertext throws SecretException`() {
        val svc = serviceWithKey()
        val ref = svc.encrypt("some-value")
        val tampered = ref.dropLast(4) + "XXXX"
        assertThrows<SecretException> { svc.resolve(tampered) }
    }

    // ── SecretValue lifecycle ─────────────────────────────────────────────────

    @Test
    fun `useOnce clears the value after block`() {
        val svc = serviceWithKey()
        val ref = svc.encrypt("clear-me")
        val sv = svc.resolve(ref)!!
        sv.useOnce { /* consume */ }
        assert(sv.isCleared()) { "SecretValue should be cleared after useOnce" }
    }

    @Test
    fun `useOnce throws when already cleared`() {
        val svc = serviceWithKey()
        val ref = svc.encrypt("once-only")
        val sv = svc.resolve(ref)!!
        sv.useOnce { /* first use */ }
        assertThrows<IllegalStateException> { sv.useOnce { } }
    }

    // ── Encrypt requires key ──────────────────────────────────────────────────

    @Test
    fun `encrypt without key throws SecretException`() {
        val svc = serviceNoKey()
        assertThrows<SecretException> { svc.encrypt("should-fail") }
    }
}

/** Minimal DataSource that always throws — only for SecretService tests that use direct refs. */
private object NoOpDataSource : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException()
    override fun getConnection(u: String?, p: String?): java.sql.Connection = throw UnsupportedOperationException()
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout(): Int = 0
    override fun getParentLogger(): java.util.logging.Logger = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?): Boolean = false
}
