package com.vectorbee.api.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object ApiKeyHasher {
    private val secureRandom = SecureRandom()

    const val KEY_PREFIX: String = "vb_"

    fun generateRawKey(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return KEY_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
