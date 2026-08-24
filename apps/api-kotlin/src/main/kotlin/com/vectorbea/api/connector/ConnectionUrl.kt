package com.vectorbea.api.connector

import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * A tolerant parser for `postgresql://` and `mysql://` connection strings.
 *
 * WHY NOT `java.net.URI`. Because it is a URI parser, and a database connection
 * string as people actually hold it is not a valid URI. `URI` is correct and
 * useless here: a password containing `#` makes it read a fragment, `?` a
 * query, `/` the end of the authority — in each case `uri.host` silently
 * becomes null and the caller reports "URL must include a host" about a URL
 * that plainly has one. `%`, `[`, `]` and spaces throw outright. Measured
 * against the shapes Supabase hands out, SEVEN of nine realistic passwords
 * failed to parse, and a trailing newline from a copy-paste failed too.
 *
 * Those failures do not surface as "your password needs encoding". They surface
 * as INVALID_CONNECTION_STRING, or — when the mangling happens to leave
 * something parseable — as AUTH_FAILED against credentials the user can see are
 * correct. Which is the bug this exists to end.
 *
 * WHAT IT DOES INSTEAD. Splits the string by structure rather than by grammar:
 * scheme, then authority up to the first `/` that follows it, then the LAST `@`
 * inside that authority (a password may contain `@`; a host may not), then the
 * FIRST `:` of the userinfo (a password may contain `:`; a username may not).
 * That ordering is what makes unencoded passwords work, and it is the same
 * ordering libpq uses.
 */
internal object ConnectionUrl {

    data class Parsed(
        /** Everything after the scheme, with credentials removed. Ready for JDBC. */
        val hostAndPath: String,
        val username: String?,
        val password: String?,
        /**
         * The credentials exactly as they appeared, before any percent-decoding.
         *
         * Kept because whether `%2F` in a password is an escape or four literal
         * characters is not decidable from the string. [DbTester] retries with
         * this reading when the decoded one is rejected, which is the only way
         * to be right for both populations without asking the user to know
         * which one they are in.
         */
        val rawUsername: String? = username,
        val rawPassword: String? = password,
    )

    /** Schemes this understands, mapped to nothing — the caller owns the JDBC prefix. */
    private val SCHEME = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://")

    /**
     * Parse, or return null when the string carries no scheme this recognises.
     *
     * Never throws. A connection string is user input; failing to parse one is
     * an outcome to report, not an exception to unwind through.
     */
    fun parse(raw: String): Parsed? {
        // Copy-paste brings whitespace, and a trailing newline alone was enough
        // to make the previous parser throw.
        val trimmed = raw.trim()
        val scheme = SCHEME.find(trimmed) ?: return null
        val rest = trimmed.substring(scheme.value.length)

        // The authority ends at the first `/`, `?` or `#` AFTER it. Anything of
        // those inside the password is therefore still part of the authority,
        // which is precisely what `URI` gets wrong — but only once the userinfo
        // has been split off, so find the credential boundary first.
        val at = rest.lastIndexOf('@')
        val authorityEnd = rest.indexOfFirst(after = maxOf(at, 0)) { it == '/' || it == '?' || it == '#' }

        val authority = if (authorityEnd == -1) rest else rest.substring(0, authorityEnd)
        val remainder = if (authorityEnd == -1) "" else rest.substring(authorityEnd)

        if (at == -1 || at > authority.length) {
            return Parsed(hostAndPath = authority + remainder, username = null, password = null)
        }

        val userInfo = authority.substring(0, at)
        val hostPort = authority.substring(at + 1)
        val colon = userInfo.indexOf(':')
        val rawUser = if (colon == -1) userInfo else userInfo.substring(0, colon)
        val rawPassword = if (colon == -1) null else userInfo.substring(colon + 1)

        return Parsed(
            hostAndPath = hostPort + remainder,
            username = rawUser.takeIf { it.isNotEmpty() }?.let { decodeIfEncoded(it) },
            password = rawPassword?.takeIf { it.isNotEmpty() }?.let { decodeIfEncoded(it) },
            rawUsername = rawUser.takeIf { it.isNotEmpty() },
            rawPassword = rawPassword?.takeIf { it.isNotEmpty() },
        )
    }

    private inline fun String.indexOfFirst(after: Int, predicate: (Char) -> Boolean): Int {
        for (i in after until length) if (predicate(this[i])) return i
        return -1
    }

    private val NEEDS_ENCODING = Regex("[@/?#\\[\\] ]")
    private val VALID_ESCAPE = Regex("%[0-9a-fA-F]{2}")

    /**
     * Percent-decode, but only when the value can plausibly BE percent-encoded.
     *
     * Two populations paste into this field: people copying an already-encoded
     * URL out of a tool, and people typing their password in raw. Decoding
     * unconditionally corrupts the second group's password — `%2F` in a typed
     * password silently becomes `/` and authentication fails against
     * credentials that look right on screen, with nothing on the failure path
     * to suggest why.
     *
     * So: a value containing a character that percent-encoding would have
     * escaped cannot be encoded output, and is taken literally. Otherwise a
     * valid escape sequence is treated as one. The remaining ambiguity — a
     * typed password that happens to look exactly like encoded text — is
     * unresolvable from the string alone, and is what
     * [DbTester.credentialGuidance] warns about when authentication fails.
     */
    fun decodeIfEncoded(value: String): String {
        if (NEEDS_ENCODING.containsMatchIn(value)) return value
        if (!VALID_ESCAPE.containsMatchIn(value)) return value
        return try {
            // `+` means "plus" in a password, never "space": this is a URL path
            // component, not a form body.
            URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            value
        }
    }

    /** True when a credential contains characters that a strict URI parser would reject. */
    fun containsUnencodedReserved(value: String?): Boolean =
        value != null && NEEDS_ENCODING.containsMatchIn(value)
}
