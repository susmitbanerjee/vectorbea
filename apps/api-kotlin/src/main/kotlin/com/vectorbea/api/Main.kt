package com.vectorbea.api

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.db.Database
import com.vectorbea.api.db.Migrations
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
 *  2. Initialize database (HikariCP pool + optional Flyway migrations)
 *  3. Build router and register all route groups
 *  4. Start HTTP server
 *  5. Register shutdown hook for graceful stop
 *
 * No framework magic — every dependency is explicitly wired here.
 *
 * Security: DATABASE_URL value is NEVER logged — only its presence is noted.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.main")

    // 1. Config
    val config = AppConfig.fromEnv()

    // 2. Database (optional — service can start without DB for local dev)
    val database: Database? = if (config.db != null) {
        log.info("Initialising database connection pool (maxPoolSize={})", config.db.maxPoolSize)
        val db = try {
            Database.create(config.db)
        } catch (ex: Exception) {
            log.error("Failed to initialise database pool — aborting startup", ex)
            throw ex
        }

        if (config.db.runMigrations) {
            log.info("Running Flyway migrations...")
            try {
                Migrations.run(db.dataSource)
                log.info("Flyway migrations complete")
            } catch (ex: Exception) {
                log.error("Flyway migration failed — aborting startup", ex)
                db.close()
                throw ex
            }
        } else {
            // Still validate that the applied migrations match what's on the classpath
            try {
                Migrations.validate(db.dataSource)
            } catch (ex: Exception) {
                log.warn("Flyway validation warning: {}", ex.message)
            }
        }

        db
    } else {
        log.warn("DATABASE_URL not set — starting without database (DB-backed endpoints will fail)")
        null
    }

    // 3. Router
    val router = Router()

    // Register route groups — pass database so /ready can ping it
    HealthRoutes(config, database).register(router)
    VersionRoutes(config).register(router)

    // 4. HTTP server
    val server = HttpServer(config, router)

    // 5. Graceful shutdown on SIGTERM / SIGINT
    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("Shutdown signal received — stopping server...")
        server.stop(delaySeconds = 5)
        database?.close()
        log.info("Shutdown complete")
    })

    server.start()
    log.info("vectorbea-api running on port {} — press Ctrl+C to stop", config.port)

    // Keep the main thread alive (server runs on executor threads)
    Thread.currentThread().join()
}
