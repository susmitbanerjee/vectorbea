package com.vectorbea.api

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.http.HttpServer
import com.vectorbea.api.http.Router
import com.vectorbea.api.routes.HealthRoutes
import com.vectorbea.api.routes.VersionRoutes
import org.slf4j.LoggerFactory

/**
 * Application entry point.
 *
 * Wiring order:
 *  1. Read config from environment
 *  2. Build router and register all route groups
 *  3. Start HTTP server
 *  4. Register shutdown hook for graceful stop
 *
 * No framework magic — every dependency is explicitly wired here.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.main")

    // 1. Config
    val config = AppConfig.fromEnv()

    // 2. Router
    val router = Router()

    // Register route groups
    HealthRoutes(config).register(router)
    VersionRoutes(config).register(router)

    // 3. HTTP server
    val server = HttpServer(config, router)

    // 4. Graceful shutdown on SIGTERM / SIGINT
    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("Shutdown signal received — stopping server...")
        server.stop(delaySeconds = 5)
    })

    server.start()
    log.info("vectorbea-api running — press Ctrl+C to stop")

    // Keep the main thread alive (server runs on executor threads)
    Thread.currentThread().join()
}
