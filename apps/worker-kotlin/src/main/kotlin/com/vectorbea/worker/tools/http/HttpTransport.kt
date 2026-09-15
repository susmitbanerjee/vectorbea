package com.vectorbea.worker.tools.http

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import java.io.ByteArrayInputStream
import java.net.InetSocketAddress
import java.net.ProxySelector
import java.net.http.HttpClient
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Duration
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.EncryptedPrivateKeyInfo
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLParameters
import javax.net.ssl.TrustManagerFactory

/**
 * The client a tool call actually goes out on — item 7.
 *
 * ── WHY A SECOND CLIENT AT ALL ──────────────────────────────────────────────
 * `OutboundHttp.client` is one shared, bounded client, and that is deliberate:
 * building one per call leaks a selector thread per call on JDK 17, where
 * `HttpClient` is not `AutoCloseable`. Nothing here changes that rule. What it
 * adds is that a client is a function of its TLS material and its proxy, and
 * those are per-connection facts: a bank that requires a client certificate and
 * a public API cannot share an `SSLContext`.
 *
 * So clients are CACHED BY CONFIGURATION rather than created per call. A
 * workspace with one mTLS integration has exactly two clients for the life of
 * the process — the shared default and its own — and a tool whose transport is
 * the default gets the shared client unchanged, which is the overwhelmingly
 * common case and costs nothing.
 *
 * ── WHAT IS AND IS NOT CONFIGURABLE ─────────────────────────────────────────
 * Client certificate, CA bundle, proxy, SNI and `Host` are configurable because
 * enterprise networks require them and no amount of care makes a request succeed
 * without them. Certificate VERIFICATION is not configurable: there is no
 * `insecureSkipVerify`, and the omission is the feature. Every such flag is
 * added "temporarily" against a staging host and is still there years later, on
 * the production tool, silently accepting any certificate — including the proxy
 * that is reading the traffic. An operator with a private CA has the supported
 * path: give us the CA.
 */
internal object HttpTransport {

    private val log = logger()

    /**
     * Cache key. Certificate MATERIAL is never part of it — only the reference
     * it was loaded from, so a key is safe to hold, log and count.
     */
    private data class ClientKey(
        val certRef: String?,
        val keyRef: String?,
        val caFingerprint: Int?,
        val proxy: String?,
        val protocols: List<String>,
    )

    private val clients = ConcurrentHashMap<ClientKey, HttpClient>()

    /** What a caller needs to send one request under a transport. */
    data class Bound(
        val client: HttpClient,
        /** Applied to the request builder: `Host` override, and nothing else. */
        val hostHeader: String?,
        val sni: String?,
    )

    /** Certificate material, already resolved from secret refs by the caller. */
    data class Material(
        val clientCertPem: String? = null,
        val clientKeyPem: String? = null,
        val keyPassphrase: String? = null,
        val proxyCredential: String? = null,
    )

    class TransportException(message: String, cause: Throwable? = null) : Exception(message, cause)

    /**
     * Resolve the client for [transport].
     *
     * Returns the shared default client — not a copy — when the transport is
     * default. That is what keeps the common path free of the caching, the TLS
     * setup and the extra selector threads.
     */
    fun bind(transport: HttpToolSpec.TransportSpec, material: Material): Bound {
        if (transport.isDefault) {
            return Bound(OutboundHttp.client, transport.hostHeader, null)
        }
        val key = ClientKey(
            certRef = transport.mtls?.clientCertSecretRef,
            keyRef = transport.mtls?.clientKeySecretRef,
            caFingerprint = transport.caBundlePem?.hashCode(),
            proxy = transport.proxy?.let { "${it.scheme}://${it.host}:${it.port}" },
            protocols = transport.tlsProtocols,
        )
        val client = clients.computeIfAbsent(key) { build(transport, material) }
        return Bound(client, transport.hostHeader, transport.sni)
    }

    private fun build(
        transport: HttpToolSpec.TransportSpec,
        material: Material,
    ): HttpClient {
        val builder = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(OutboundHttp.policy().httpConnectTimeoutMs))
            .followRedirects(HttpClient.Redirect.NORMAL)

        val needsTls = transport.mtls != null || transport.caBundlePem != null ||
            transport.tlsProtocols.isNotEmpty()
        if (needsTls) {
            builder.sslContext(sslContext(transport, material))
            if (transport.tlsProtocols.isNotEmpty() || transport.sni != null) {
                builder.sslParameters(sslParameters(transport))
            }
        }

        transport.proxy?.let { p ->
            builder.proxy(ProxySelector.of(InetSocketAddress(p.host, p.port)))
            material.proxyCredential?.let { cred ->
                /*
                 * `Proxy-Authorization` cannot be set as an ordinary request
                 * header: the JDK's client strips restricted headers, and this is
                 * one of them. An `Authenticator` is the supported route, and it
                 * is scoped to this client, which is scoped to this transport —
                 * so a proxy credential is never offered to a host reached
                 * through a different transport.
                 */
                val user = cred.substringBefore(':')
                val pass = cred.substringAfter(':', "")
                builder.authenticator(object : java.net.Authenticator() {
                    override fun getPasswordAuthentication(): java.net.PasswordAuthentication? =
                        if (requestorType == RequestorType.PROXY)
                            java.net.PasswordAuthentication(user, pass.toCharArray())
                        else null
                })
            }
        }

        log.info(
            "[http-transport] built client [mtls={}, customCa={}, proxy={}, protocols={}]",
            transport.mtls != null, transport.caBundlePem != null,
            transport.proxy?.let { "${it.host}:${it.port}" } ?: "none",
            transport.tlsProtocols.ifEmpty { listOf("default") },
        )
        return builder.build()
    }

    private fun sslContext(
        transport: HttpToolSpec.TransportSpec,
        material: Material,
    ): SSLContext = try {
        val ctx = SSLContext.getInstance("TLS")

        val keyManagers = transport.mtls?.let {
            val certPem = material.clientCertPem
                ?: throw TransportException("The client certificate for this tool could not be read.")
            val keyPem = material.clientKeyPem
                ?: throw TransportException("The client private key for this tool could not be read.")
            keyManagers(certPem, keyPem, material.keyPassphrase)
        }

        val trustManagers = transport.caBundlePem?.let { pem ->
            val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
            parseCertificates(pem).forEachIndexed { i, cert -> ks.setCertificateEntry("ca-$i", cert) }
            TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
                .apply { init(ks) }.trustManagers
        }

        ctx.init(keyManagers, trustManagers, java.security.SecureRandom())
        ctx
    } catch (e: TransportException) {
        throw e
    } catch (e: Exception) {
        /*
         * The exception text from JSSE names an ASN.1 structure, not a mistake
         * anybody made. What an operator can act on is which piece of material
         * failed to load, and that is knowable here.
         */
        throw TransportException(
            "The TLS material for this tool could not be loaded: ${e.javaClass.simpleName}. " +
                "Check that the certificate is PEM, the key is PKCS#8, and the passphrase is correct.",
            e,
        )
    }

    private fun keyManagers(certPem: String, keyPem: String, passphrase: String?) = run {
        val chain = parseCertificates(certPem).toTypedArray()
        if (chain.isEmpty()) throw TransportException("The client certificate contains no certificate.")
        val privateKey = parsePrivateKey(keyPem, passphrase)
        val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            /*
             * The keystore password is a local artefact — the store exists for the
             * lifetime of this SSLContext and is never written anywhere — so it is
             * random rather than derived from anything the operator supplied.
             */
            setKeyEntry("client", privateKey, EPHEMERAL_STORE_PASSWORD, chain)
        }
        KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
            .apply { init(ks, EPHEMERAL_STORE_PASSWORD) }.keyManagers
    }

    private fun parseCertificates(pem: String): List<X509Certificate> {
        val factory = CertificateFactory.getInstance("X.509")
        return ByteArrayInputStream(pem.toByteArray()).use { input ->
            @Suppress("UNCHECKED_CAST")
            (factory.generateCertificates(input) as Collection<X509Certificate>).toList()
        }
    }

    private fun parsePrivateKey(pem: String, passphrase: String?): java.security.PrivateKey {
        val body = pem
            .replace(Regex("-----BEGIN [A-Z ]*PRIVATE KEY-----"), "")
            .replace(Regex("-----END [A-Z ]*PRIVATE KEY-----"), "")
            .replace(Regex("\\s"), "")
        val der = Base64.getDecoder().decode(body)

        if (passphrase.isNullOrEmpty()) {
            return keyFactoryFor(der).generatePrivate(PKCS8EncodedKeySpec(der))
        }
        val encrypted = EncryptedPrivateKeyInfo(der)
        val secret = SecretKeyFactory.getInstance(encrypted.algName)
            .generateSecret(PBEKeySpec(passphrase.toCharArray()))
        val spec = encrypted.getKeySpec(secret)
        return keyFactoryFor(spec.encoded).generatePrivate(spec)
    }

    /**
     * RSA or EC, decided by trying rather than by parsing the OID.
     *
     * A PKCS#8 blob names its own algorithm, and reading that name means writing
     * an ASN.1 parser for two cases. Both key types are supported by asking the
     * JDK, which already has the parser.
     */
    private fun keyFactoryFor(der: ByteArray): KeyFactory {
        for (algorithm in listOf("RSA", "EC", "Ed25519")) {
            try {
                val kf = KeyFactory.getInstance(algorithm)
                kf.generatePrivate(PKCS8EncodedKeySpec(der))
                return kf
            } catch (_: Exception) {
                // Try the next.
            }
        }
        throw TransportException(
            "The client private key is not an RSA, EC or Ed25519 key in PKCS#8 form. " +
                "Convert it with: openssl pkcs8 -topk8 -in key.pem -out key-pkcs8.pem"
        )
    }

    private fun sslParameters(transport: HttpToolSpec.TransportSpec): SSLParameters =
        SSLParameters().apply {
            if (transport.tlsProtocols.isNotEmpty()) protocols = transport.tlsProtocols.toTypedArray()
            transport.sni?.let {
                /*
                 * SNI and `Host` are two different names and both are needed when
                 * they differ. SNI selects the certificate the server presents;
                 * `Host` selects the virtual host it routes to. An appliance
                 * fronting several internal services distinguishes them by the
                 * first and the second, and setting only one produces either a
                 * certificate mismatch or a 404 — errors that name neither cause.
                 */
                serverNames = listOf(javax.net.ssl.SNIHostName(it))
            }
            /* Explicit: endpoint identification stays on. See the class comment. */
            endpointIdentificationAlgorithm = "HTTPS"
        }

    private val EPHEMERAL_STORE_PASSWORD: CharArray =
        java.util.UUID.randomUUID().toString().toCharArray()

    /** Test seam — drops cached clients so a test can change TLS material. */
    fun clearCacheForTests() = clients.clear()
}
