package com.vectorbea.worker.connector

import java.net.InetAddress
import java.net.URI

/**
 * SSRF (Server-Side Request Forgery) protection guard.
 *
 * Blocks requests to:
 *   - Loopback addresses: 127.0.0.0/8, ::1
 *   - Private RFC 1918 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - Link-local: 169.254.0.0/16 (includes AWS/GCP metadata endpoints)
 *   - "localhost" by name
 *   - Cloud metadata service IPs (169.254.169.254, metadata.google.internal)
 *
 * Also enforces the connection's [allowedHosts] allow-list if non-empty.
 *
 * SECURITY: DNS resolution is performed to check the resolved IP, not just
 * the hostname string, to prevent DNS rebinding attacks where possible.
 * Note: for production deployments, egress firewall rules should be the
 * primary defense; this guard is a defense-in-depth layer.
 */
object SsrfGuard {

    /**
     * Validate [url] against SSRF rules and optional [allowedHosts].
     * Throws [SsrfException] if the request should be blocked.
     */
    fun checkUrl(url: String, allowedHosts: List<String>) {
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            throw SsrfException("Invalid URL: ${url.take(100)}")
        }

        val host = uri.host?.lowercase()?.trim()
            ?: throw SsrfException("URL has no host: ${url.take(100)}")

        checkHost(host, allowedHosts)
    }

    /**
     * Validate [host] (hostname or IP string).
     * Throws [SsrfException] if the host should be blocked.
     */
    fun checkHost(host: String, allowedHosts: List<String>) {
        val normalised = host.lowercase().trim().trimEnd('.')

        // Block by name
        if (normalised == "localhost" || normalised == "metadata.google.internal") {
            throw SsrfException("SSRF blocked: host '$normalised' is not allowed")
        }

        // Allowed-hosts allow-list: if non-empty, only these hosts pass
        if (allowedHosts.isNotEmpty()) {
            val allowed = allowedHosts.any { pattern ->
                val p = pattern.lowercase().trim()
                normalised == p || normalised.endsWith(".$p")
            }
            if (!allowed) {
                throw SsrfException("SSRF blocked: host '$normalised' is not in the connection's allowed hosts list")
            }
        }

        // Resolve to IP and check
        val addr = try {
            InetAddress.getByName(normalised)
        } catch (e: Exception) {
            throw SsrfException("SSRF blocked: cannot resolve host '$normalised'")
        }

        checkAddress(addr)
    }

    /** Check a resolved [InetAddress] against blocked ranges. Throws [SsrfException] if blocked. */
    fun checkAddress(addr: InetAddress) {
        if (addr.isLoopbackAddress) {
            throw SsrfException("SSRF blocked: loopback address ${addr.hostAddress}")
        }
        if (addr.isSiteLocalAddress) {
            throw SsrfException("SSRF blocked: private/site-local address ${addr.hostAddress}")
        }
        if (addr.isLinkLocalAddress) {
            throw SsrfException("SSRF blocked: link-local address ${addr.hostAddress} (possible metadata endpoint)")
        }
        if (addr.isAnyLocalAddress) {
            throw SsrfException("SSRF blocked: wildcard address ${addr.hostAddress}")
        }
        if (addr.isMulticastAddress) {
            throw SsrfException("SSRF blocked: multicast address ${addr.hostAddress}")
        }

        // Explicitly block known cloud metadata IPs
        val raw = addr.hostAddress
        if (raw == "169.254.169.254" || raw == "100.100.100.200") {
            throw SsrfException("SSRF blocked: cloud metadata IP $raw")
        }

        // Additional IPv4 check for 10.x, 172.16-31.x, 192.168.x — belt-and-suspenders
        val bytes = addr.address
        if (bytes.size == 4) {
            val b0 = bytes[0].toInt() and 0xFF
            val b1 = bytes[1].toInt() and 0xFF
            when {
                b0 == 10                     -> throw SsrfException("SSRF blocked: RFC1918 10.x.x.x")
                b0 == 172 && b1 in 16..31    -> throw SsrfException("SSRF blocked: RFC1918 172.16-31.x.x")
                b0 == 192 && b1 == 168       -> throw SsrfException("SSRF blocked: RFC1918 192.168.x.x")
                b0 == 127                    -> throw SsrfException("SSRF blocked: loopback 127.x.x.x")
                b0 == 0                      -> throw SsrfException("SSRF blocked: unspecified address 0.x.x.x")
            }
        }
    }
}

class SsrfException(message: String) : Exception(message)
