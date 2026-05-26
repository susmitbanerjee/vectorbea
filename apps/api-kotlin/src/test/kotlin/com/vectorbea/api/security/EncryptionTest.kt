package com.vectorbea.api.security

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class EncryptionTest {

    private val key32 = ByteArray(32) { it.toByte() }  // deterministic test key

    @Test
    fun `roundtrip encrypt then decrypt returns original`() {
        val plaintext = "sk-test-api-key-1234567890"
        val token = Encryption.encrypt(plaintext, key32, "1")
        val result = Encryption.decrypt(token, key32)
        assertEquals(plaintext, result)
    }

    @Test
    fun `encrypt produces versioned token format`() {
        val token = Encryption.encrypt("secret", key32, "42")
        assertTrue(token.startsWith("v42:"), "Token should start with v42:")
    }

    @Test
    fun `encrypt is non-deterministic - two encryptions differ`() {
        val plaintext = "same-secret"
        val t1 = Encryption.encrypt(plaintext, key32, "1")
        val t2 = Encryption.encrypt(plaintext, key32, "1")
        assertNotEquals(t1, t2, "Two encryptions of the same plaintext must produce different ciphertext (random IV)")
    }

    @Test
    fun `decrypt fails on tampered ciphertext`() {
        val token = Encryption.encrypt("secret", key32, "1")
        val tampered = token.dropLast(4) + "XXXX"
        assertFailsWith<Exception> {
            Encryption.decrypt(tampered, key32)
        }
    }

    @Test
    fun `decrypt fails with wrong key`() {
        val token = Encryption.encrypt("secret", key32, "1")
        val wrongKey = ByteArray(32) { (it + 1).toByte() }
        assertFailsWith<Exception> {
            Encryption.decrypt(token, wrongKey)
        }
    }

    @Test
    fun `decodeKey accepts base64 encoded 32-byte key`() {
        val bytes = ByteArray(32) { 0xAB.toByte() }
        val b64 = java.util.Base64.getEncoder().encodeToString(bytes)
        val decoded = Encryption.decodeKey(b64)
        assertEquals(32, decoded.size)
    }

    @Test
    fun `decodeKey rejects non-32-byte keys`() {
        val short = java.util.Base64.getEncoder().encodeToString(ByteArray(16))
        assertFailsWith<IllegalArgumentException> {
            Encryption.decodeKey(short)
        }
    }

    @Test
    fun `encrypt handles empty string`() {
        val token = Encryption.encrypt("", key32, "1")
        val result = Encryption.decrypt(token, key32)
        assertEquals("", result)
    }

    @Test
    fun `encrypt handles unicode content`() {
        val plaintext = "pässwörd-🔑-密码"
        val token = Encryption.encrypt(plaintext, key32, "1")
        assertEquals(plaintext, Encryption.decrypt(token, key32))
    }
}
