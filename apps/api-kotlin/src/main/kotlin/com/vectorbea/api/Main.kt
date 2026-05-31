package com.vectorbea.api

import com.vectorbea.api.auth.AuthMiddleware
import com.vectorbea.api.recovery.FailureIncidentRepository
import com.vectorbea.api.recovery.FailureIncidentRoutes
import com.vectorbea.api.auth.JwtVerifier
import com.vectorbea.api.cache.NoOpCacheService
import com.vectorbea.api.users.AppUserRepository
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
import com.vectorbea.api.repository.AgentRepository
import com.vectorbea.api.repository.ApprovalRepository
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.api.repository.WorkflowRepository
import com.vectorbea.api.routes.AgentRoutes
import com.vectorbea.api.routes.ApprovalRoutes
import com.vectorbea.api.routes.ConnectionRoutes
import com.vectorbea.api.routes.ConnectionTestRoutes
import com.vectorbea.api.routes.HealthRoutes
import com.vectorbea.api.routes.MetricsRoutes
import com.vectorbea.api.routes.NetworkRoutes
import com.vectorbea.api.routes.RunRoutes
import com.vectorbea.api.routes.ToolRoutes
import com.vectorbea.api.routes.VersionRoutes
import com.vectorbea.api.routes.BootstrapRoutes
import com.vectorbea.api.routes.SchemaPreviewRoutes
import com.vectorbea.api.routes.WorkerRoutes
import com.vectorbea.api.routes.AgentIterationRoutes
import com.vectorbea.api.routes.DurableRunRoutes
import com.vectorbea.api.routes.MeRoutes
import com.vectorbea.api.routes.WorkflowRoutes
import com.vectorbea.api.secrets.EncryptedSecretService
import com.vectorbea.api.secrets.NoOpSecretService
import com.vectorbea.api.secrets.SecretRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.security.Encryption
import com.vectorbea.api.workers.WorkerHeartbeatRepository
import org.slf4j.LoggerFactory

/**
 * Application entry point.
 *
 * Wiring order:
 *  1. Config
 *  2. Database (HikariCP + Flyway)
 *  3. Redis (Lettuce)
 *  4. Application services (cache, queue, locks, events)
 *  5. Secret service (AES-256-GCM — required for connection secrets)
 *  6. Repositories
 *  7. Routes
 *  8. HTTP server
 *  9. Shutdown hook
 *
 * Security: DATABASE_URL, REDIS_URL, and SECRET_ENCRYPTION_KEY values are NEVER logged.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.main")

    // 1. Config
    val config = AppConfig.fromEnv()

    // Production guard
    if (config.isProduction && !config.secretEncryptionKeyPresent) {
        throw IllegalStateException("SECRET_ENCRYPTION_KEY is required in production")
    }

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
            try { Migrations.validate(db.dataSource) } catch (ex: Exception) {
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
                if (config.isProduction) {
                    r.close()
                    throw IllegalStateException("Redis required in production but ping failed: ${ping.error}")
                }
                log.warn("Redis ping failed in non-production env — degraded mode")
            }
            r
        } catch (ex: IllegalStateException) {
            throw ex
        } catch (ex: Exception) {
            if (config.isProduction) throw ex
            log.warn("Redis not available in local/dev mode: {}", ex.message)
            null
        }
    } else {
        if (config.isProduction) throw IllegalStateException("REDIS_URL is required in production")
        log.warn("REDIS_URL not set — running without Redis")
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
        val q = RedisStreamsWorkflowQueue(redis, config.redis!!.queueStream, config.redis.queueGroup)
        RedisStreamsWorkflowQueue.verifyStream(redis, config.redis.queueStream)
        q
    } else null

    val distributedLock = if (redis != null) RedisDistributedLock(redis, config.redis!!.lockPrefix) else null
    val eventBus = if (redis != null) RedisRunEventBus(redis, config.redis!!.eventChannelPrefix) else null
    val rateLimiter = if (redis != null) RedisRateLimiter(redis, config.redis!!.cachePrefix) else null
    val workerHeartbeatRepository = if (redis != null)
        WorkerHeartbeatRepository(redis, config.redis!!.workerHeartbeatTtlSeconds) else null

    log.info("Services ready — cache={}, queue={}, lock={}, events={}",
        if (redis != null) "redis" else "noop",
        if (workflowQueue != null) "redis-streams" else "disabled",
        if (distributedLock != null) "redis" else "disabled",
        if (eventBus != null) "redis-pubsub" else "disabled",
    )

    // 5. Secret service
    // SECURITY: keyBytes decoded from env — NEVER logged or serialized
    val secretService: SecretService = if (config.secretEncryptionKey != null && database != null) {
        val keyBytes = try {
            Encryption.decodeKey(config.secretEncryptionKey)
        } catch (ex: Exception) {
            log.error("SECRET_ENCRYPTION_KEY is invalid: {} — aborting", ex.message)
            throw ex
        }
        val secretRepo = SecretRepository(database.dataSource)
        log.info("Secret service: AES-256-GCM (keyVersion={})", config.secretKeyVersion)
        EncryptedSecretService(secretRepo, keyBytes, config.secretKeyVersion)
    } else {
        if (config.secretEncryptionKey == null) {
            log.warn("Secret service: NoOp — SECRET_ENCRYPTION_KEY not set (secrets unavailable)")
        } else {
            log.warn("Secret service: NoOp — database not available")
        }
        NoOpSecretService()
    }

    // 6. Repositories (require DB)
    val ds = database?.dataSource

    // 6a. Authentication — HS256 JWT verifier + user repository
    // JWT_SECRET is the shared secret used by Next.js to sign tokens.
    // Null = open/dev mode: workspace headers are trusted without a JWT.
    val jwtVerifier: JwtVerifier? = if (config.jwtSecret != null) {
        log.info("JWT auth: enabled (HS256)")
        JwtVerifier(secret = config.jwtSecret)
    } else {
        if (config.isProduction) {
            throw IllegalStateException("JWT_SECRET is required in production")
        }
        log.warn("JWT auth: DISABLED — JWT_SECRET not set. Running in open/dev mode.")
        null
    }

    val appUserRepo: AppUserRepository? = ds?.let { AppUserRepository(it) }

    val authMiddleware = if (jwtVerifier != null && appUserRepo != null) {
        AuthMiddleware(jwtVerifier = jwtVerifier, userRepo = appUserRepo)
    } else {
        log.warn("AuthMiddleware: disabled (dev mode)")
        null
    }

    // 6b. Repositories (require DB) — ds already declared above
    val connectionRepo = ds?.let { ConnectionRepository(it) }
    val agentRepo = ds?.let { AgentRepository(it) }
    val toolRepo = ds?.let { ToolRepository(it) }
    val workflowRepo = ds?.let { WorkflowRepository(it) }
    val runRepo = ds?.let { RunRepository(it) }
    val runEventRepo = ds?.let { RunEventRepository(it) }
    val approvalRepo = ds?.let { ApprovalRepository(it) }

    // 7. Router + routes
    val router = Router()
    HealthRoutes(config, database, redis).register(router)
    VersionRoutes(config).register(router)
    NetworkRoutes().register(router)
    MetricsRoutes().register(router)

    if (connectionRepo != null) {
        ConnectionRoutes(connectionRepo, cacheService, secretService).register(router)
        ConnectionTestRoutes(connectionRepo, secretService, cacheService).register(router)
        SchemaPreviewRoutes(connectionRepo, secretService).register(router)
    } else log.warn("ConnectionRoutes disabled — no database")

    if (agentRepo != null && connectionRepo != null) {
        AgentRoutes(agentRepo, connectionRepo, cacheService).register(router)
    } else log.warn("AgentRoutes disabled — no database")

    if (toolRepo != null && connectionRepo != null) {
        ToolRoutes(toolRepo, connectionRepo, cacheService).register(router)
    } else log.warn("ToolRoutes disabled — no database")

    if (workflowRepo != null) {
        WorkflowRoutes(workflowRepo, cacheService).register(router)
    } else log.warn("WorkflowRoutes disabled — no database")

    if (runRepo != null && runEventRepo != null) {
        RunRoutes(
            runRepo = runRepo,
            eventRepo = runEventRepo,
            workflowRepo = workflowRepo,
            queue = workflowQueue,
            eventBus = eventBus,
            lock = distributedLock,
            redis = redis,
        ).register(router)
    } else log.warn("RunRoutes disabled — no database")

    if (approvalRepo != null) {
        ApprovalRoutes(
            repo      = approvalRepo,
            runRepo   = runRepo,
            eventRepo = runEventRepo,
            queue     = workflowQueue,
        ).register(router)
    } else log.warn("ApprovalRoutes disabled — no database")

    if (ds != null) {
        WorkerRoutes(ds).register(router)
        BootstrapRoutes(ds).register(router)
    } else log.warn("WorkerRoutes/BootstrapRoutes disabled — no database")

    if (appUserRepo != null) {
        MeRoutes(appUserRepo).register(router)
    } else log.warn("MeRoutes disabled — no database")

    if (ds != null) {
        FailureIncidentRoutes(FailureIncidentRepository(ds)).register(router)
        DurableRunRoutes(ds, workflowQueue).register(router)
        AgentIterationRoutes(ds).register(router)
    } else log.warn("FailureIncidentRoutes/DurableRunRoutes/AgentIterationRoutes disabled — no database")

    // 8. HTTP server
    val server = HttpServer(config, router, authMiddleware)

    // 9. Graceful shutdown
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
