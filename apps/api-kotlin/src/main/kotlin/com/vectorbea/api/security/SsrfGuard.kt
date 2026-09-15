package com.vectorbea.api.security

import java.net.InetAddress
import java.net.URI

/**
 * SSRF (Server-Side Request Forgery) protection.
 *
 * Validates that a URL target is not a private, loopback, link-local,
 * or metadata endpoint before an outbound HTTP request is made.
 *
 * IMPORTANT: DNS must be resolved and the *resolved IP* must be checked,
 * not just the hostname — DNS rebinding attacks bypass hostname-only checks.
 *
 * Blocked categories:
 *   - Loopback:          127.0.0.0/8, ::1
 *   - Private (RFC1918): 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - Link-local:        169.254.0.0/16, fe80::/10
 *   - Metadata services: 169.254.169.254 (AWS/GCP/Azure IMDS)
 *   - Internal TLDs:     *.internal, *.local, *.localhost, *.corp, *.home
 */
object SsrfGuard {

    /**
     * Thrown when a URL fails SSRF validation.
     * The [errorCode] is safe to include in API responses; [message] is sanitized.
     */
    class SsrfBlockedException(
        val errorCode: String,
        override val message: String,
    ) : Exception(message)

    /** Private runner mode — set to true to skip SSRF checks (controlled flag only). */
    @Volatile
    var privateRunnerMode: Boolean = false

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Validate [urlString] for SSRF risk.
     * Resolves DNS and checks every resulting IP address.
     *
     * @throws SsrfBlockedException if the URL targets a private/internal resource.
     * @throws IllegalArgumentException if the URL is malformed.
     */
    fun validate(urlString: String) {
        if (privateRunnerMode) return

        val uri = try {
            URI(urlString)
        } catch (e: Exception) {
            throw IllegalArgumentException("Malformed URL: ${e.message}")
        }

        val scheme = uri.scheme?.lowercase()
            ?: throw IllegalArgumentException("URL has no scheme")

        if (scheme !in setOf("http", "https")) {
            throw SsrfBlockedException("INVALID_SCHEME", "Only http/https URLs are allowed")
        }

        val host = uri.host?.lowercase()?.trimEnd('.')
            ?: throw IllegalArgumentException("URL has no host")

        // Block internal TLDs / hostnames before DNS lookup
        checkHostname(host)

        // Resolve and check every IP
        val addresses = try {
            InetAddress.getAllByName(host).toList()
        } catch (e: Exception) {
            throw SsrfBlockedException("DNS_FAILED", "DNS resolution failed for host")
        }

        if (addresses.isEmpty()) {
            throw SsrfBlockedException("DNS_FAILED", "No addresses resolved")
        }

        for (addr in addresses) {
            checkAddress(addr)
        }
    }

    /**
     * Returns true if the URL is safe (no exception), false if it would be blocked.
     * Convenience wrapper for non-throwing callers.
     */
    fun isSafe(urlString: String): Boolean = try {
        validate(urlString)
        true
    } catch (_: Exception) {
        false
    }

    /** Used by clients at connection time so the checked DNS answer is the one dialled. */
    fun resolvePublic(host: String): List<InetAddress> {
        checkHostname(host)
        val addresses = InetAddress.getAllByName(host).toList()
        require(addresses.isNotEmpty()) { "No addresses resolved" }
        addresses.forEach { checkAddress(it) }
        return addresses
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun checkHostname(host: String) {
        // Block obvious internal hostnames without DNS lookup
        val lower = host.lowercase()

        if (lower == "localhost" || lower.endsWith(".localhost")) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to localhost are not allowed")
        }
        if (lower.endsWith(".internal") || lower.endsWith(".local") ||
            lower.endsWith(".corp") || lower.endsWith(".home") ||
            lower.endsWith(".intranet") || lower.endsWith(".lan")) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to internal hostnames are not allowed")
        }
    }

    private fun checkAddress(addr: InetAddress) {
        val raw = addr.address
        if (raw.size == 16 && (raw[0].toInt() and 0xfe) == 0xfc) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to unique-local addresses are not allowed")
        }
        if (raw.size == 4) {
            val a = raw[0].toInt() and 255
            val b = raw[1].toInt() and 255
            if (a == 0 || (a == 100 && b in 64..127) || (a == 198 && b in 18..19) || (a == 192 && b == 0)) {
                throw SsrfBlockedException("PRIVATE_HOST", "Requests to reserved network addresses are not allowed")
            }
        }

        if (addr.isLoopbackAddress) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to loopback addresses are not allowed")
        }
        if (addr.isSiteLocalAddress) {
            // RFC1918: 10/8, 172.16/12, 192.168/16 + others
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to private network addresses are not allowed")
        }
        if (addr.isLinkLocalAddress) {
            // 169.254.x.x / fe80::
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to link-local addresses are not allowed")
        }
        if (addr.isAnyLocalAddress) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to unspecified addresses are not allowed")
        }
        if (addr.isMulticastAddress) {
            throw SsrfBlockedException("PRIVATE_HOST", "Requests to multicast addresses are not allowed")
        }

        // Extra explicit check: AWS/GCP/Azure metadata IP
        if (raw.size == 4) {
            // 169.254.169.254
            if (raw[0] == 169.toByte() && raw[1] == 254.toByte() &&
                raw[2] == 169.toByte() && raw[3] == 254.toByte()) {
                throw SsrfBlockedException("METADATA_ENDPOINT", "Requests to metadata endpoints are not allowed")
            }
            // 100.100.100.200 (Alibaba metadata)
            if (raw[0] == 100.toByte() && raw[1] == 100.toByte() &&
                raw[2] == 100.toByte() && raw[3] == 200.toByte()) {
                throw SsrfBlockedException("METADATA_ENDPOINT", "Requests to metadata endpoints are not allowed")
            }
        }
    }
}
