package com.vectorbea.api

import com.vectorbea.api.cache.NoOpCacheService
import com.vectorbea.api.cache.RedisCacheService
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.db.Database
import com.vectorbea.api.db.Migrations
import com.vectorbea.api.events.RedisRunEventBus
import com.vectorbea.api.http.HttpServer
import com.vectorbea.api.http.Router
import com.vectorbea.api.locks.RedisDistributedLock
import com.vectorbea.api.queue.RedisStreamsWorkflowQueue
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.rate.RedisRateLimiter
import com.vectorbea.api.redis.RedisProvider
import com.vectorbea.api.routes.HealthRoutes
import com.vectorbea.api.routes.VersionRoutes
import com.vectorbea.api.workers.WorkerHeartbeatRepository
import org.slf4j.LoggerFactory

/**
 * Application entry point.
 *
 * Wiring order:
 *  1. Read config from environment
 *  2. Initialize database (HikariCP pool + optional Flyway migrations)
 *  3. Initialize Redis (Lettuce client)
 *  4. Wire application services (cache, queue, locks, events)
 *  5. Build router and register all route groups
 *  6. Start HTTP server
 *  7. Register shutdown hook
 *
 * Security:
 *   DATABASE_URL, REDIS_URL, and SECRET_ENCRYPTION_KEY values are NEVER logged.
 *   Only their presence is noted in the startup summary.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.main")

    // 1. Config
    val config = AppConfig.fromEnv()

    // 2. Database
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

    // 3. Redis
    val redis: RedisProvider? = if (config.redis != null) {
        try {
            val r = RedisProvider.create(config.redis)
            val ping = r.pingResult()
            if (ping.ok) {
                log.info("Redis connected (latency={}ms)", ping.latencyMs)
            } else {
                log.error("Redis ping failed on startup: {}", ping.error)
                if (config.isProduction) {
                    r.close()
                    throw IllegalStateException("Redis required in production but ping failed: ${ping.error}")
                } else {
                    log.warn("Redis ping failed in non-production env — continuing with degraded Redis")
                }
            }
            r
        } catch (ex: IllegalStateException) {
            throw ex
        } catch (ex: Exception) {
            if (config.isProduction) {
                log.error("Failed to connect to Redis — aborting startup (production)", ex)
                throw ex
            } else {
                log.warn("Redis not available in local/dev mode — cache disabled, queue will fail: {}", ex.message)
                null
            }
        }
    } else {
        if (config.isProduction) {
            throw IllegalStateException("REDIS_URL is required in production but was not set")
        }
        log.warn("REDIS_URL not set — running without Redis (cache=disabled, queue=unavailable)")
        null
    }

    // 4. Application services
    val cacheService = if (redis != null) {
        RedisCacheService(redis, config.redis!!.cachePrefix)
    } else {
        log.warn("Cache disabled — using NoOpCacheService")
        NoOpCacheService()
    }

    val workflowQueue: WorkflowQueue? = if (redis != null) {
        val queue = RedisStreamsWorkflowQueue(
            redis = redis,
            streamKey = config.redis!!.queueStream,
            consumerGroup = config.redis.queueGroup,
        )
        RedisStreamsWorkflowQueue.verifyStream(redis, config.redis.queueStream)
        queue
    } else {
        log.warn("WorkflowQueue disabled — Redis not available (enqueue calls will fail)")
        null
    }

    val distributedLock = if (redis != null) {
        RedisDistributedLock(redis, config.redis!!.lockPrefix)
    } else null

    val eventBus = if (redis != null) {
        RedisRunEventBus(redis, config.redis!!.eventChannelPrefix)
    } else null

    val rateLimiter = if (redis != null) {
        RedisRateLimiter(redis, config.redis!!.cachePrefix)
    } else null

    val workerHeartbeatRepository = if (redis != null) {
        WorkerHeartbeatRepository(redis, config.redis!!.workerHeartbeatTtlSeconds)
    } else null

    log.info(
        "Services ready — cache={}, queue={}, lock={}, events={}, rateLimit={}",
        if (redis != null) "redis" else "noop",
        if (workflowQueue != null) "redis-streams" else "disabled",
        if (distributedLock != null) "redis" else "disabled",
        if (eventBus != null) "redis-pubsub" else "disabled",
        if (rateLimiter != null) "redis" else "disabled",
    )

    // 5. Router
    val router = Router()
    HealthRoutes(config, database, redis).register(router)
    VersionRoutes(config).register(router)

    // 6. HTTP server
    val server = HttpServer(config, router)

    // 7. Graceful shutdown
    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("Shutdown signal received — stopping server...")
        server.stop(delaySeconds = 5)
        database?.close()
        redis?.close()
        log.info("Shutdown complete")
    })

    server.start()
    log.info("vectorbea-api running on port {} — press Ctrl+C to stop", config.port)

    Thread.currentThread().join()
}
