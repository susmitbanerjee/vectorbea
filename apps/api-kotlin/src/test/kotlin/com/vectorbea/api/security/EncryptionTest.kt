package com.vectorbea.api.security

import com.vectorbea.crypto.Encryption
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

    /* ── Binding a ciphertext to the row it lives in ──────────────────────────
       GCM's tag proves a blob was not ALTERED. On its own it says nothing about
       where the blob belongs, so every ciphertext under one master key was
       portable: anyone able to WRITE the table could copy tenant A's encrypted
       OpenAI key into tenant B's row and it would decrypt perfectly. The
       workspace-scoped SELECT stops tenant B ASKING for tenant A's secret by id;
       it cannot stop a blob already sitting in tenant B's own row.

       Binding the workspace id as associated data is what closes that. */

    private val workspaceA = "894a49a6-a91e-4349-8bf9-4ea4634e63b7".toByteArray()
    private val workspaceB = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0".toByteArray()

    @Test
    fun `a bound ciphertext round-trips with the same associated data`() {
        val token = Encryption.encrypt("sk-live-abc", key32, "1", workspaceA)
        assertEquals("sk-live-abc", Encryption.decrypt(token, key32, workspaceA))
    }

    @Test
    fun `a ciphertext moved into another workspace's row does not decrypt`() {
        // THE ATTACK. Same key, same untampered bytes, different row.
        val token = Encryption.encrypt("sk-live-abc", key32, "1", workspaceA)
        assertFailsWith<Exception> {
            Encryption.decrypt(token, key32, workspaceB)
        }
    }

    @Test
    fun `a bound ciphertext refuses to decrypt with no associated data at all`() {
        /* Not retried unbound on failure: a decrypt that quietly succeeds
           without the binding is a decrypt that never had one. */
        val token = Encryption.encrypt("sk-live-abc", key32, "1", workspaceA)
        assertFailsWith<Exception> { Encryption.decrypt(token, key32, null) }
    }

    @Test
    fun `bound tokens are marked, and unbound ones are not`() {
        assertTrue(Encryption.isBound(Encryption.encrypt("x", key32, "1", workspaceA)))
        assertTrue(!Encryption.isBound(Encryption.encrypt("x", key32, "1")))
        assertTrue(Encryption.encrypt("x", key32, "7", workspaceA).startsWith("v7:a:"))
    }

    @Test
    fun `secrets written before the binding existed still decrypt`() {
        /* The compatibility guarantee. Refusing format 1 would make every
           credential saved before this change unreadable — an outage dressed as
           a security improvement. Passing associated data alongside a legacy
           token is harmless: the token says it has none. */
        val legacy = Encryption.encrypt("older-secret", key32, "1")
        assertEquals("older-secret", Encryption.decrypt(legacy, key32))
        assertEquals("older-secret", Encryption.decrypt(legacy, key32, workspaceA))
    }

    @Test
    fun `the key version is readable from the token without decrypting it`() {
        assertEquals("1", Encryption.keyVersionOf(Encryption.encrypt("x", key32, "1")))
        assertEquals("42", Encryption.keyVersionOf(Encryption.encrypt("x", key32, "42", workspaceA)))
    }

    @Test
    fun `a malformed token is rejected rather than half-parsed`() {
        assertFailsWith<IllegalArgumentException> { Encryption.decrypt("nocolon", key32) }
        assertFailsWith<IllegalArgumentException> { Encryption.decrypt("v1:b:abcd", key32, workspaceA) }
    }
}
