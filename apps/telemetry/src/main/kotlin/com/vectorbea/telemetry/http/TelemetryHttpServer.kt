package com.vectorbea.telemetry.http

import com.sun.net.httpserver.HttpServer
import com.vectorbea.telemetry.config.TelemetryConfig
import org.slf4j.LoggerFactory
import java.net.InetSocketAddress
import java.util.concurrent.Executors

class TelemetryHttpServer(
    private val config: TelemetryConfig,
    private val router: Router,
) {
    private val log = LoggerFactory.getLogger(TelemetryHttpServer::class.java)
    private lateinit var server: HttpServer

    fun start() {
        server = HttpServer.create(InetSocketAddress(config.port), 0)
        server.executor = Executors.newCachedThreadPool()

        server.createContext("/") { exchange ->
            addCorsHeaders(exchange)
            router.dispatch(exchange)
        }

        server.start()
        log.info("vectorbea-telemetry listening on port {}", config.port)
    }

    fun stop(delaySeconds: Int = 5) {
        if (::server.isInitialized) {
            server.stop(delaySeconds)
            log.info("HTTP server stopped")
        }
    }

    private fun addCorsHeaders(exchange: com.sun.net.httpserver.HttpExchange) {
        val origin = exchange.requestHeaders.getFirst("Origin") ?: return
        val allowed = config.corsAllowedOrigins
        val allowedOrigin = when {
            "*" in allowed -> "*"
            origin in allowed -> origin
            else -> return
        }
        exchange.responseHeaders.apply {
            set("Access-Control-Allow-Origin", allowedOrigin)
            set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Telemetry-Token")
            set("Access-Control-Max-Age", "86400")
        }
    }
}
