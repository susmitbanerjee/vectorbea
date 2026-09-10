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
     * How far this connection is allowed to reach.
     *
     * ── WHY THIS EXISTS AT ALL ───────────────────────────────────
     * `HttpTransport` has always been able to present a client certificate to a
     * service on an internal network. It has never been able to REACH one,
     * because everything private was blocked here — so the mTLS path terminated
     * at a guard that refused precisely the hosts it existed for.
     *
     * The fix is not to relax the guard. It is to let one connection, named
     * explicitly by an operator, be exempt from the ADDRESS-RANGE checks while
     * every other protection stays exactly where it was.
     */
    enum class EgressPolicy(val wire: String) {
        /** The guard applies in full. What every connection is until changed. */
        PUBLIC("public"),

        /**
         * RFC1918 and loopback are reachable — for the named hosts only.
         *
         * Useless on its own, deliberately: [checkHost] refuses this policy
         * unless the connection also names the hosts it may reach, and the
         * schema refuses to store it that way (V071). "Allow private" and "these
         * three internal hostnames" are one decision; splitting them is how a
         * temporary allowance becomes a permanent hole.
         */
        PRIVATE_ALLOWED("private_allowed");

        companion object {
            fun of(wire: String?): EgressPolicy =
                entries.firstOrNull { it.wire == wire?.lowercase()?.trim() } ?: PUBLIC
        }
    }

    /**
     * Hosts exempted from the private/loopback checks, for load testing against
     * a local mock upstream. Comma-separated, from `SSRF_ALLOWED_TEST_HOSTS`.
     *
     * DELIBERATELY NARROW:
     *  - Ignored entirely when `APP_ENV=production`, so a stray env var on a
     *    production worker cannot open an egress path to the metadata service.
     *  - Exact host matches only — no suffix or wildcard matching, unlike the
     *    per-connection [allowedHosts] list.
     *  - It exempts a host from the *address-range* checks only. The
     *    `localhost` / `metadata.google.internal` name block and the
     *    per-connection allow-list are still applied first.
     *
     * Without this, the load harness cannot exercise HTTP tool nodes at all:
     * every mock upstream necessarily lives on a loopback or private address.
     */
    private val testHostExemptions: Set<String> by lazy {
        if (System.getenv("APP_ENV")?.lowercase() == "production") return@lazy emptySet()
        (System.getenv("SSRF_ALLOWED_TEST_HOSTS") ?: "")
            .split(',')
            .map { it.trim().lowercase() }
            .filter { it.isNotBlank() }
            .toSet()
    }

    /**
     * Validate [url] against SSRF rules and optional [allowedHosts].
     * Throws [SsrfException] if the request should be blocked.
     */
    fun checkUrl(
        url: String,
        allowedHosts: List<String>,
        /* Defaulted, so every existing call site keeps the behaviour it had. */
        policy: EgressPolicy = EgressPolicy.PUBLIC,
    ) {
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            throw SsrfException("Invalid URL: ${url.take(100)}")
        }

        val host = uri.host?.lowercase()?.trim()
            ?: throw SsrfException("URL has no host: ${url.take(100)}")

        checkHost(host, allowedHosts, policy)
    }

    /**
     * Validate [host] (hostname or IP string).
     * Throws [SsrfException] if the host should be blocked.
     */
    fun checkHost(
        host: String,
        allowedHosts: List<String>,
        policy: EgressPolicy = EgressPolicy.PUBLIC,
    ) {
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

        // Load-test exemption — checked AFTER the name block and the
        // per-connection allow-list, and only ever populated outside production.
        if (normalised in testHostExemptions) return

        // Resolve to IP and check
        val addr = try {
            InetAddress.getByName(normalised)
        } catch (e: Exception) {
            /*
             * ── A SUBTYPE, BECAUSE THIS IS NOT THE SAME EVENT ──────────────
             * A name that does not resolve reaches nothing — there is no address
             * to connect to, private or otherwise — so it is a configuration or
             * DNS problem wearing an SSRF error message. Callers that want to
             * treat it as one still can: it extends [SsrfException], so every
             * existing `catch` behaves exactly as it did.
             *
             * The distinction matters most on the LLM path, which runs this
             * check once per node and twenty times in an agent loop. Reporting a
             * resolver blip there as "SSRF blocked" sends the reader looking for
             * a security misconfiguration that does not exist.
             */
            throw UnresolvableHostException(
                "Cannot resolve host '$normalised'. Check the spelling of the base URL, and " +
                    "that this worker's DNS can see it.")
        }

        /*
         * ── PRIVATE EGRESS IS AN EXEMPTION FROM THE RANGES, NOTHING MORE ────
         *
         * Two conditions, and BOTH are required. The policy alone is not enough:
         * without a host allow-list, `private_allowed` would mean "reach any
         * internal address", which is the hole this is shaped to avoid. The
         * schema refuses to store that combination and this refuses to act on
         * it, because there is more than one writer and a check in one of them
         * is a check the others do not have.
         */
        if (policy == EgressPolicy.PRIVATE_ALLOWED) {
            if (allowedHosts.isEmpty()) {
                throw SsrfException(
                    "SSRF blocked: this connection allows private egress but names no allowed " +
                        "hosts, so there is nothing it is allowed to reach. Add the internal " +
                        "hostnames it should be able to call.")
            }
            /* Still not everything: a metadata address is refused whatever the
               policy says. That block is not a policy anyone can turn off, and
               it is the reason this is an exemption from the RANGES rather than
               a bypass of the guard. */
            checkMetadataOnly(addr)
            return
        }

        checkAddress(addr)
    }

    /**
     * The part of [checkAddress] that no policy can waive.
     *
     * A cloud metadata endpoint hands out the platform's own credentials to
     * anything that can reach it. "The customer asked us to allow their private
     * network" is not a reason to allow that one, and an operator who genuinely
     * needs to call `169.254.169.254` does not exist.
     */
    fun checkMetadataOnly(addr: InetAddress) {
        if (addr.isLinkLocalAddress) {
            throw SsrfException("SSRF blocked: link-local address ${addr.hostAddress} " +
                "(possible metadata endpoint) — not reachable under any egress policy")
        }
        if (addr.isMulticastAddress) {
            throw SsrfException("SSRF blocked: multicast address ${addr.hostAddress}")
        }
        if (addr.isAnyLocalAddress) {
            throw SsrfException("SSRF blocked: wildcard address ${addr.hostAddress}")
        }
        val raw = addr.hostAddress
        if (raw == "169.254.169.254" || raw == "100.100.100.200") {
            throw SsrfException("SSRF blocked: cloud metadata IP $raw — not reachable under " +
                "any egress policy")
        }
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

open class SsrfException(message: String) : Exception(message)

/**
 * The host could not be resolved, so nothing was reached.
 *
 * A subtype rather than a separate exception so that every `catch
 * (e: SsrfException)` written before this existed keeps the behaviour it had.
 * What it adds is the ability to tell a DNS problem from a blocked address,
 * which are different faults with different fixes and only one of which is
 * about security.
 */
class UnresolvableHostException(message: String) : SsrfException(message)
