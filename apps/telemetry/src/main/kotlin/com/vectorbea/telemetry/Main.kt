package com.vectorbea.telemetry

import com.vectorbea.telemetry.analytics.AnalyticsIngestionService
import com.vectorbea.telemetry.analytics.AnalyticsQueryService
import com.vectorbea.telemetry.analytics.AnalyticsRepository
import com.vectorbea.telemetry.auth.JwtVerifier
import com.vectorbea.telemetry.auth.TelemetryAuthMiddleware
import com.vectorbea.telemetry.config.TelemetryConfig
import com.vectorbea.telemetry.dashboards.DashboardRoutes
import com.vectorbea.telemetry.db.Database
import com.vectorbea.telemetry.db.Migrations
import com.vectorbea.telemetry.engineering.EngineeringTelemetryService
import com.vectorbea.telemetry.engineering.OTelConfig
import com.vectorbea.telemetry.http.HealthRoutes
import com.vectorbea.telemetry.http.IngestionRoutes
import com.vectorbea.telemetry.http.Router
import com.vectorbea.telemetry.http.StaticFileHandler
import com.vectorbea.telemetry.http.TelemetryHttpServer
import org.slf4j.LoggerFactory

/**
 * vectorbea-telemetry service entry point.
 *
 * Startup order:
 *  1. Config
 *  2. OpenTelemetry (scaffold — disabled unless OTEL_ENABLED=true)
 *  3. Database (HikariCP + Flyway)
 *  4. Repositories and services
 *  5. Auth middleware
 *  6. Routes
 *  7. HTTP server
 *  8. Shutdown hook
 *
 * Telemetry failure must not break workflow execution in other services.
 * This service is independently deployable to telemetry.vectorbea.com.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.telemetry.main")

    // 1. Config
    val config = TelemetryConfig.fromEnv()
    config.validateForProduction()

    // 2. OpenTelemetry (no-op if disabled)
    val otel = OTelConfig.init(config)

    // 3. Database
    val database: Database? = if (config.db != null) {
        log.info("[startup] initialising database (maxPoolSize={})", config.db.maxPoolSize)
        val db = try {
            Database.create(config.db)
        } catch (ex: Exception) {
            log.error("[startup] database init failed — aborting", ex)
            throw ex
        }
        val ping = db.pingResult()
        if (!ping.ok) {
            if (config.isProduction) throw IllegalStateException("DB not reachable: ${ping.error}")
            log.warn("[startup] DB ping failed in non-prod — continuing degraded: {}", ping.error)
        } else {
            log.info("[startup] DB connected (latency={}ms)", ping.latencyMs)
        }
        if (config.db.runMigrations) {
            log.info("[startup] running Flyway migrations...")
            try { Migrations.run(db.dataSource) }
            catch (ex: Exception) {
                log.error("[startup] migration failed", ex)
                db.close(); throw ex
            }
        }
        db
    } else {
        if (config.isProduction) throw IllegalStateException("DATABASE_URL required in production")
        log.warn("[startup] DATABASE_URL not set — DB-backed routes will fail")
        null
    }

    val ds = database?.dataSource

    // 4. Repositories and services
    val analyticsRepo = ds?.let { AnalyticsRepository(it) }
    val analyticsIngestion = if (analyticsRepo != null) {
        AnalyticsIngestionService(analyticsRepo, config)
    } else null

    val analyticsQuery = analyticsRepo?.let { AnalyticsQueryService(it) }
    val engineeringService = ds?.let { EngineeringTelemetryService(it) }

    // 5. Auth middleware
    val jwtVerifier: JwtVerifier? = if (config.jwtSecret != null) {
        log.info("[startup] JWT auth enabled (HS256)")
        JwtVerifier(config.jwtSecret)
    } else {
        if (config.isProduction) throw IllegalStateException("JWT_SECRET required in production")
        log.warn("[startup] JWT auth DISABLED (dev mode)")
        null
    }

    val auth: TelemetryAuthMiddleware? = jwtVerifier?.let {
        TelemetryAuthMiddleware(it, config)
    }

    // 6. Routes
    val router = Router()

    HealthRoutes(config, database).register(router)
    StaticFileHandler.register(router)

    if (auth != null) {
        if (analyticsIngestion != null) {
            IngestionRoutes(auth, analyticsIngestion).register(router)
            log.info("[startup] Ingestion routes registered")
        } else {
            log.warn("[startup] Ingestion routes disabled — no database")
        }

        if (analyticsQuery != null && engineeringService != null) {
            DashboardRoutes(auth, analyticsQuery, engineeringService).register(router)
            log.info("[startup] Dashboard routes registered")
        } else {
            log.warn("[startup] Dashboard routes disabled — no database")
        }
    } else {
        log.warn("[startup] Auth disabled — ingestion and dashboard routes unavailable")
    }

    // 7. HTTP server
    val server = TelemetryHttpServer(config, router)

    // 8. Shutdown hook
    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("[shutdown] stopping telemetry service...")
        server.stop(delaySeconds = 5)
        database?.close()
        log.info("[shutdown] complete")
    })

    server.start()
    log.info("vectorbea-telemetry running on port {} (env={}, otel={})",
        config.port, config.vectorbeaEnv, config.otelEnabled)
    Thread.currentThread().join()
}
