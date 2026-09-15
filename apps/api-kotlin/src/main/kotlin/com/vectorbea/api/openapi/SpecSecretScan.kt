package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode

/**
 * Refuses to store a credential inside an HTTP tool spec.
 *
 * ── WHY A SPEC IS THE WORST PLACE FOR A SECRET ──────────────────────────────
 * `tools.http_spec_json` is returned by the list endpoint, rendered in a form,
 * written into `tool_versions` on every change, and shown side by side in a
 * re-import diff. A credential placed there is a credential in all four, none of
 * which have any redaction — because none of them were ever meant to carry one.
 *
 * The product already has the right place: the connection, encrypted, referenced
 * by an auth strategy that names a FIELD. This is the guard that keeps people on
 * that path, and it exists because the wrong path is so easy: a Postman
 * collection carries the author's own token in a header, and "just paste the
 * header in" is what somebody will do at 6pm.
 *
 * ── TWO CHECKS, BECAUSE NEITHER IS SUFFICIENT ───────────────────────────────
 *   1. BY KEY. Any field whose name normalises to something credential-shaped —
 *      the same list `Validation.FORBIDDEN_CONFIG_KEYS` uses, so an operator
 *      meets one rule rather than two. Catches the deliberate case.
 *   2. BY VALUE. Recognisable credential formats — provider key prefixes, PEM
 *      blocks, JWTs — wherever they appear. Catches the accidental case, which
 *      is the common one: a value pasted into a header template.
 *
 * Neither is complete and both are cheap. A guard that catches the two ways this
 * actually happens is worth more than an exhaustive one nobody ships.
 */
object SpecSecretScan {

    /**
     * Describe what was found, or null when the document is clean.
     *
     * A DESCRIPTION rather than the value: this string ends up in an API error
     * and a log line, and echoing the credential back to prove we found one
     * would put it in both.
     */
    fun findInlineSecret(node: JsonNode?, path: String = ""): String? {
        if (node == null || node.isNull) return null

        if (node.isObject) {
            for ((key, value) in node.fields().asSequence().toList()) {
                val here = if (path.isEmpty()) key else "$path.$key"

                /*
                 * A `*SecretRef` or `*SecretField` key is a REFERENCE — it names a
                 * row or a bundle field, not a value — and every auth strategy is
                 * built out of them, so `passwordSecretField: "value"` is the
                 * CORRECT shape rather than a leak. Exempt by name, and still
                 * checked by value below, so pasting a PEM into
                 * `clientKeySecretRef` is caught anyway.
                 */
                if (!isReferenceKey(key) &&
                    isCredentialKey(key) && value.isTextual && value.asText().isNotBlank()
                ) {
                    return "a credential-shaped field at `$here`. Store it on the " +
                        "connection and reference it as `secret.$key` instead."
                }
                findInlineSecret(value, here)?.let { return it }
            }
            return null
        }

        if (node.isArray) {
            node.forEachIndexed { i, child ->
                findInlineSecret(child, "$path[$i]")?.let { return it }
            }
            return null
        }

        if (node.isTextual) {
            val text = node.asText()
            credentialShape(text)?.let { shape ->
                return "$shape at `${path.ifEmpty { "the document root" }}`. Store it on " +
                    "the connection and reference it from the auth strategy instead."
            }
        }
        return null
    }

    /** A key that names WHERE a credential lives, rather than holding one. */
    private fun isReferenceKey(key: String): Boolean {
        val normalised = key.lowercase().replace(Regex("""[_\-\s]"""), "")
        return normalised.endsWith("secretref") || normalised.endsWith("secretfield") ||
            normalised.endsWith("tokenfield") || normalised.endsWith("passwordfield") ||
            normalised.endsWith("keyfield") || normalised.endsWith("ref")
    }

    /**
     * Mirrors `Validation.FORBIDDEN_CONFIG_KEYS`, normalised the same way.
     *
     * Normalising before matching is load-bearing: `API-Key`, `api_key` and
     * `apiKey` are one field name written three ways, and a check that missed two
     * of them would be a check people learn to route around by accident.
     */
    private fun isCredentialKey(key: String): Boolean {
        val normalised = key.lowercase().replace(Regex("""[_\-\s]"""), "")
        return CREDENTIAL_KEY_FRAGMENTS.any { normalised.contains(it) }
    }

    /**
     * Recognise a credential by its shape.
     *
     * Every pattern here is a format a provider publishes and documents, which is
     * what makes false positives unlikely: no ordinary configuration value starts
     * with `sk_live_` or `-----BEGIN`.
     */
    fun credentialShape(text: String): String? {
        if (text.length < 16) return null
        return when {
            PEM_BLOCK.containsMatchIn(text) -> "private key material"
            JWT.matches(text.trim()) -> "a JSON Web Token"
            PROVIDER_KEY.containsMatchIn(text) -> "an API key"
            BASIC_HEADER.containsMatchIn(text) -> "a Basic authorization header"
            BEARER_HEADER.containsMatchIn(text) -> "a Bearer token"
            else -> null
        }
    }

    private val CREDENTIAL_KEY_FRAGMENTS = listOf(
        "password", "secret", "apikey", "token", "bearer", "credential",
        "privatekey", "accesskey", "secretkey", "clientsecret", "authtoken",
        "connectionstring", "passphrase",
    )

    /** `-----BEGIN RSA PRIVATE KEY-----` and its relatives. */
    private val PEM_BLOCK = Regex("""-----BEGIN [A-Z ]*PRIVATE KEY-----""")

    /** Three base64url segments separated by dots, with a JWT header. */
    private val JWT = Regex("""eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}""")

    /**
     * Published key prefixes: Stripe, OpenAI, GitHub, Slack, Anthropic, AWS,
     * SendGrid, Twilio, Google.
     */
    private val PROVIDER_KEY = Regex(
        """\b(sk_(live|test)_[A-Za-z0-9]{16,}|rk_(live|test)_[A-Za-z0-9]{16,}""" +
            """|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}""" +
            """|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}""" +
            """|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}""" +
            """|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}""" +
            """|AC[a-f0-9]{32}|AIza[0-9A-Za-z_-]{30,})"""
    )

    private val BASIC_HEADER = Regex("""(?i)\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}""")

    /**
     * `Bearer <something long>`. Deliberately NOT matched against
     * `Bearer {{secret.x}}`, which is the supported form and contains a
     * placeholder rather than a value.
     */
    private val BEARER_HEADER = Regex("""(?i)\bBearer\s+(?!\{\{)[A-Za-z0-9._-]{20,}""")
}
