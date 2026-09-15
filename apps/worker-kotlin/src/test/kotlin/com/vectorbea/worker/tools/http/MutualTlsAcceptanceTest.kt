package com.vectorbea.worker.tools.http

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import com.vectorbea.worker.connector.SsrfGuard
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import java.io.File
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.security.KeyStore
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.TrustManagerFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A tool reaching a service that is only accessible through mTLS.
 *
 * ── WHY A REAL HANDSHAKE ────────────────────────────────────────────────────
 * The claim is that a client certificate we hold is presented to, and accepted
 * by, a server that refuses connections without one. There is no way to
 * establish that without both halves being real: a stubbed HTTP client asserts
 * that the code I wrote matches the code I wrote, and a server that does not
 * actually demand a certificate would pass whether or not one was sent.
 *
 * So this generates a CA, a server certificate and a client certificate with
 * `keytool` — present in every JDK, so no dependency is added — stands up an
 * `HttpsServer` with `needClientAuth`, and drives `HttpTransport`.
 *
 * ── WHAT IT ESTABLISHES, IN ORDER ───────────────────────────────────────────
 *   1. Without a client certificate the server refuses. If this passed, the
 *      test below would prove nothing.
 *   2. With the certificate the call succeeds.
 *   3. Certificate verification is not optional: an untrusted server is
 *      refused, and there is no flag that changes that.
 *   4. The service is on loopback, which the egress guard blocks by default —
 *      because a service requiring a client certificate is, almost by
 *      definition, not on a public address.
 */
class MutualTlsAcceptanceTest {

    private lateinit var dir: File
    private lateinit var server: HttpsServer
    private lateinit var url: String

    private lateinit var caPem: String
    private lateinit var clientCertPem: String
    private lateinit var clientKeyPem: String

    private val storePass = "changeit"

    @BeforeEach
    fun setUp() {
        HttpTransport.clearCacheForTests()
        dir = Files.createTempDirectory("mtls-acceptance").toFile()
        generateMaterial()
        startServer()
    }

    @AfterEach
    fun tearDown() {
        runCatching { server.stop(0) }
        HttpTransport.clearCacheForTests()
        dir.deleteRecursively()
    }

    // ── Certificate material, generated per run ──────────────────────────────

    private fun keytool(vararg args: String) {
        val home = System.getProperty("java.home")
        val exe = File(File(home, "bin"), if (isWindows()) "keytool.exe" else "keytool")
        val p = ProcessBuilder(listOf(exe.absolutePath) + args)
            .directory(dir).redirectErrorStream(true).start()
        val out = p.inputStream.readBytes().toString(Charsets.UTF_8)
        val code = p.waitFor()
        if (code != 0) fail("keytool ${args.joinToString(" ")} failed ($code):\n$out")
    }

    private fun isWindows() = System.getProperty("os.name").lowercase().contains("win")

    /**
     * A CA, a server certificate signed by it, and a client certificate.
     *
     * Self-signed for the CA; the server and client are issued from it, so the
     * server can be configured to trust exactly one client and nothing else —
     * which is what makes "refuses connections without a certificate" a real
     * property of this server rather than a claim.
     */
    private fun generateMaterial() {
        // The CA.
        keytool("-genkeypair", "-alias", "ca", "-keyalg", "RSA", "-keysize", "2048",
            "-dname", "CN=Test CA", "-ext", "bc:c", "-validity", "1",
            "-keystore", "ca.p12", "-storetype", "PKCS12",
            "-storepass", storePass, "-keypass", storePass)
        keytool("-exportcert", "-alias", "ca", "-rfc", "-file", "ca.pem",
            "-keystore", "ca.p12", "-storepass", storePass)

        // The server, signed by the CA, valid for 127.0.0.1.
        keytool("-genkeypair", "-alias", "server", "-keyalg", "RSA", "-keysize", "2048",
            "-dname", "CN=localhost", "-ext", "san=ip:127.0.0.1,dns:localhost",
            "-validity", "1", "-keystore", "server.p12", "-storetype", "PKCS12",
            "-storepass", storePass, "-keypass", storePass)
        keytool("-certreq", "-alias", "server", "-file", "server.csr",
            "-keystore", "server.p12", "-storepass", storePass)
        keytool("-gencert", "-alias", "ca", "-infile", "server.csr", "-outfile", "server.crt",
            "-ext", "san=ip:127.0.0.1,dns:localhost", "-rfc", "-validity", "1",
            "-keystore", "ca.p12", "-storepass", storePass)
        keytool("-importcert", "-alias", "ca", "-file", "ca.pem", "-noprompt",
            "-keystore", "server.p12", "-storepass", storePass)
        keytool("-importcert", "-alias", "server", "-file", "server.crt",
            "-keystore", "server.p12", "-storepass", storePass)

        // The client, signed by the same CA.
        keytool("-genkeypair", "-alias", "client", "-keyalg", "RSA", "-keysize", "2048",
            "-dname", "CN=vectorbea-worker", "-validity", "1",
            "-keystore", "client.p12", "-storetype", "PKCS12",
            "-storepass", storePass, "-keypass", storePass)
        keytool("-certreq", "-alias", "client", "-file", "client.csr",
            "-keystore", "client.p12", "-storepass", storePass)
        keytool("-gencert", "-alias", "ca", "-infile", "client.csr", "-outfile", "client.crt",
            "-rfc", "-validity", "1", "-keystore", "ca.p12", "-storepass", storePass)

        caPem = File(dir, "ca.pem").readText()
        clientCertPem = File(dir, "client.crt").readText().let { pem ->
            /* keytool -gencert emits the issuer chain too; the leaf is first and
               is what a KeyManager needs. */
            val blocks = Regex(
                "-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
                RegexOption.DOT_MATCHES_ALL,
            ).findAll(pem).map { it.value }.toList()
            blocks.joinToString("\n")
        }
        clientKeyPem = exportPkcs8("client.p12", "client")
    }

    /** The private key as PKCS#8 PEM, which is what `HttpTransport` parses. */
    private fun exportPkcs8(store: String, alias: String): String {
        val ks = KeyStore.getInstance("PKCS12")
        File(dir, store).inputStream().use { ks.load(it, storePass.toCharArray()) }
        val key = ks.getKey(alias, storePass.toCharArray())
        val der = key.encoded   // PKCS#8 for a PKCS12-held private key
        val b64 = java.util.Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(der)
        return "-----BEGIN PRIVATE KEY-----\n$b64\n-----END PRIVATE KEY-----\n"
    }

    // ── The server that will not talk to an anonymous client ─────────────────

    private fun startServer() {
        val ks = KeyStore.getInstance("PKCS12")
        File(dir, "server.p12").inputStream().use { ks.load(it, storePass.toCharArray()) }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, storePass.toCharArray())

        /* Trusts the CA, and only the CA. A client certificate from anywhere
           else is refused, which is what makes this a real mTLS endpoint. */
        val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
        trust.setCertificateEntry("ca", ks.getCertificate("ca"))
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        tmf.init(trust)

        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, tmf.trustManagers, null)

        server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.httpsConfigurator = object : HttpsConfigurator(ctx) {
            override fun configure(params: com.sun.net.httpserver.HttpsParameters) {
                val engine = sslContext.createSSLEngine()
                params.cipherSuites = engine.enabledCipherSuites
                params.protocols = engine.enabledProtocols
                params.setSSLParameters(sslContext.defaultSSLParameters.also {
                    /* The whole point: a connection without a client certificate
                       is refused at the handshake. */
                    it.needClientAuth = true
                })
            }
        }
        server.createContext("/internal/accounts") { exchange ->
            val body = """{"ok":true,"caller":"mtls"}""".toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        server.start()
        url = "https://127.0.0.1:${server.address.port}/internal/accounts"
    }

    private fun get(client: java.net.http.HttpClient): HttpResponse<String> =
        client.send(
            HttpRequest.newBuilder(URI.create(url)).GET()
                .timeout(java.time.Duration.ofSeconds(15)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a tool reaches a service that is only accessible through mTLS
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `the service refuses a client that presents no certificate`() {
        /*
         * Established FIRST, deliberately. If this passed — if the server were
         * happy to talk to anyone — the test below would succeed whether or not
         * a certificate had been presented, and would prove nothing at all.
         */
        val trustOnly = HttpTransport.bind(
            HttpToolSpec.TransportSpec(caBundlePem = caPem),
            HttpTransport.Material(),
        )
        val e = runCatching { get(trustOnly.client) }.exceptionOrNull()
        assertNotNull(e, "the server accepted an anonymous client, so it is not an mTLS endpoint")
        assertTrue(
            generateSequence(e) { it.cause }.any { it is SSLHandshakeException || it is java.io.IOException },
            "expected the handshake to fail; got ${e::class.simpleName}: ${e.message}")
    }

    @Test
    fun `a tool with a client certificate reaches the service`() {
        HttpTransport.clearCacheForTests()
        val bound = HttpTransport.bind(
            HttpToolSpec.TransportSpec(
                mtls = HttpToolSpec.TransportSpec.Mtls(
                    clientCertSecretRef = "secret://client-cert",
                    clientKeySecretRef = "secret://client-key",
                ),
                caBundlePem = caPem,
            ),
            /* Resolved from the secret store in production — the transport is
               handed material, never a reference it could read itself. */
            HttpTransport.Material(
                clientCertPem = clientCertPem,
                clientKeyPem = clientKeyPem,
            ),
        )

        val response = get(bound.client)
        assertEquals(200, response.statusCode(),
            "the mTLS call did not reach the service")
        assertTrue(response.body().contains("\"ok\":true"))
    }

    @Test
    fun `a server we do not trust is refused, and there is no flag that changes it`() {
        /*
         * ── THE OMISSION IS THE FEATURE ─────────────────────────────────────
         * There is no `insecureSkipVerify` on `TransportSpec`, and this asserts
         * the absence behaves. Every such flag is added "temporarily" against a
         * staging host and is still there years later, on the production tool,
         * silently accepting any certificate — including the proxy that is
         * reading the traffic. An operator with a private CA has the supported
         * path, and it is the one exercised above.
         */
        HttpTransport.clearCacheForTests()
        val noCa = HttpTransport.bind(
            HttpToolSpec.TransportSpec(
                mtls = HttpToolSpec.TransportSpec.Mtls(
                    clientCertSecretRef = "secret://client-cert",
                    clientKeySecretRef = "secret://client-key",
                ),
                /* No CA bundle: the server's certificate is signed by a CA the
                   JDK's default trust store has never heard of. */
                tlsProtocols = listOf("TLSv1.3", "TLSv1.2"),
            ),
            HttpTransport.Material(clientCertPem = clientCertPem, clientKeyPem = clientKeyPem),
        )
        val e = runCatching { get(noCa.client) }.exceptionOrNull()
        assertNotNull(e, "an untrusted server certificate was accepted")
    }

    @Test
    fun `an internal service is unreachable until the connection allows private egress`() {
        /*
         * The other half of reaching an internal service, and the half that was
         * actually missing: `HttpTransport` could always present a certificate,
         * and `SsrfGuard` refused every RFC1918 and loopback address, so the
         * transport terminated at a guard that blocked precisely the hosts it
         * existed for.
         */
        val blocked = runCatching {
            SsrfGuard.checkUrl(url, listOf("127.0.0.1"), SsrfGuard.EgressPolicy.PUBLIC)
        }.exceptionOrNull()
        assertNotNull(blocked, "a loopback service was reachable under the default policy")

        /* Allowed once the connection says so — and only for the named host. */
        SsrfGuard.checkUrl(url, listOf("127.0.0.1"), SsrfGuard.EgressPolicy.PRIVATE_ALLOWED)

        val elsewhere = runCatching {
            SsrfGuard.checkHost("10.1.2.3", listOf("127.0.0.1"), SsrfGuard.EgressPolicy.PRIVATE_ALLOWED)
        }.exceptionOrNull()
        assertNotNull(elsewhere,
            "private egress reached a host outside the allow-list, which makes the allow-list " +
                "decorative")
    }

    @Test
    fun `two transports with different material do not share a client`() {
        /*
         * The cache is keyed by configuration, and a bank that requires a client
         * certificate must not end up on the same `SSLContext` as a public API.
         * If they collided, the first transport bound would silently decide the
         * TLS identity of every later one.
         */
        HttpTransport.clearCacheForTests()
        val withCert = HttpTransport.bind(
            HttpToolSpec.TransportSpec(
                mtls = HttpToolSpec.TransportSpec.Mtls("secret://a", "secret://b"),
                caBundlePem = caPem,
            ),
            HttpTransport.Material(clientCertPem = clientCertPem, clientKeyPem = clientKeyPem),
        )
        val withoutCert = HttpTransport.bind(
            HttpToolSpec.TransportSpec(caBundlePem = caPem),
            HttpTransport.Material(),
        )
        assertTrue(withCert.client !== withoutCert.client,
            "an mTLS transport and a plain one shared a client, so the certificate would be " +
                "presented to hosts that never asked for it")

        /* And the same configuration reuses one, because building a client per
           call leaks a selector thread per call on JDK 17. */
        val again = HttpTransport.bind(
            HttpToolSpec.TransportSpec(
                mtls = HttpToolSpec.TransportSpec.Mtls("secret://a", "secret://b"),
                caBundlePem = caPem,
            ),
            HttpTransport.Material(clientCertPem = clientCertPem, clientKeyPem = clientKeyPem),
        )
        assertTrue(withCert.client === again.client,
            "the same transport built a second client, which leaks a selector thread per bind")
    }
}
