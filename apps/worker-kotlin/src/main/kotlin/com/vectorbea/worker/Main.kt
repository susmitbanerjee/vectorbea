package com.vectorbea.worker

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.db.Database
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.heartbeat.WorkerHeartbeat
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.queue.WorkflowQueueConsumer
import com.vectorbea.worker.redis.RedisProvider
import com.vectorbea.worker.runtime.RunProcessor
import com.vectorbea.worker.runtime.StepOutputStore
import com.vectorbea.worker.runtime.WorkflowRuntime
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.durable.CrashRecoveryLoop
import com.vectorbea.worker.durable.HistoryLimitChecker
import com.vectorbea.worker.durable.RunLeaseManager
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.durable.TimerScheduler
import java.util.concurrent.CountDownLatch
import kotlin.system.exitProcess

/**
 * Worker entry point.
 *
 * Startup order:
 *  1. Config (from env vars)
 *  2. Database (HikariCP)
 *  3. Redis (Lettuce)
 *  4. Event store
 *  5. Heartbeat
 *  6. Run processor
 *  7. Queue consumer (ensureConsumerGroup → start)
 *  8. Shutdown hook (SIGTERM/SIGINT)
 *  9. Block main thread until signal
 *
 * Security: DATABASE_URL, REDIS_URL, SECRET_ENCRYPTION_KEY never logged.
 */
fun main() {
    val log = logger("com.vectorbea.worker.main")
    val shutdownLatch = CountDownLatch(1)

    log.info("=== vectorbea-worker starting ===")

    // ── 1. Config ─────────────────────────────────────────────────────────────
    val config = try {
        WorkerConfig.fromEnv()
    } catch (e: Exception) {
        log.error("Configuration error — aborting: {}", e.message)
        exitProcess(1)
    }

    // ── 2. Database ───────────────────────────────────────────────────────────
    val database = try {
        val db = Database.create(config)
        val latency = db.ping()
        log.info("[startup] DB connected (latency={}ms)", latency)
        db
    } catch (e: Exception) {
        log.error("[startup] Failed to connect to database — aborting: {}", e.message)
        exitProcess(2)
    }

    // Ensure runtime tables exist (idempotent DDL)
    try {
        Database.ensureWorkersTable(database.dataSource)
        Database.ensureCheckpointsTable(database.dataSource)
        Database.ensureApprovalsTable(database.dataSource)
        Database.ensureStepOutputsTable(database.dataSource)
        Database.ensureConnectionSecretsTable(database.dataSource)
        log.info("[startup] runtime tables ready")
    } catch (e: Exception) {
        // Non-fatal if the tables already exist via Flyway migrations
        log.warn("[startup] Could not ensure runtime tables: {}", e.message)
    }

    // ── 3. Redis ──────────────────────────────────────────────────────────────
    val redis = try {
        val r = RedisProvider.create(config)
        val latency = r.ping()
        log.info("[startup] Redis connected (latency={}ms)", latency)
        r
    } catch (e: Exception) {
        log.error("[startup] Failed to connect to Redis — aborting: {}", e.message)
        database.close()
        exitProcess(3)
    }

    // ── 4. Event store ────────────────────────────────────────────────────────
    val eventStore = RunEventStore(database.dataSource, redis.pubSubConnection)
    log.info("[startup] event store ready")

    // ── 5. Heartbeat ──────────────────────────────────────────────────────────
    val heartbeat = WorkerHeartbeat(config, redis.commands, database.dataSource)
    heartbeat.start()
    log.info("[startup] heartbeat started")

    // ── 6. Run processor ──────────────────────────────────────────────────────
    val checkpointStore    = CheckpointStore(database.dataSource)
    val approvalStore      = ApprovalStore(database.dataSource)
    val stepOutputStore    = StepOutputStore(database.dataSource)
    val secretService      = SecretService(
        keyBase64  = System.getenv("SECRET_ENCRYPTION_KEY"),
        dataSource = database.dataSource,
    )
    val connectionResolver = ConnectionResolver(
        dataSource    = database.dataSource,
        secretService = secretService,
    )
    val dbPoolManager      = ClientDbPoolManager(
        maxConnectionsPerPool = 3,
        connectionTimeoutMs   = 10_000L,
    )
    log.info("[startup] connector infrastructure ready")

    val workflowRuntime = WorkflowRuntime(
        dataSource         = database.dataSource,
        eventStore         = eventStore,
        checkpointStore    = checkpointStore,
        approvalStore      = approvalStore,
        stepOutputStore    = stepOutputStore,
        workerId           = config.workerId,
        connectionResolver = connectionResolver,
        dbPoolManager      = dbPoolManager,
    )
    val processor = RunProcessor(
        dataSource      = database.dataSource,
        eventStore      = eventStore,
        heartbeat       = heartbeat,
        workerId        = config.workerId,
        runtime         = workflowRuntime,
        checkpointStore = checkpointStore,
    )
    log.info("[startup] run processor ready")

    // ── 7. Queue consumer ─────────────────────────────────────────────────────
    val consumer = WorkflowQueueConsumer(config, redis.commands, processor)
    try {
        consumer.ensureConsumerGroup()
    } catch (e: Exception) {
        log.error("[startup] Failed to ensure consumer group — aborting: {}", e.message)
        heartbeat.stop()
        redis.close()
        database.close()
        exitProcess(4)
    }
    consumer.start()

    // ── Durable execution services ────────────────────────────────────────────
    val leaseManager = RunLeaseManager(database.dataSource)
    val historyChecker = HistoryLimitChecker(database.dataSource)
    val stepGuard = StepExecutionGuard(database.dataSource)

    // Timer scheduler — fires durable timers without blocking workers
    val timerScheduler = TimerScheduler(
        dataSource = database.dataSource,
        enqueueJob = { job -> try { consumer.enqueueRecovery(job) } catch (e: Exception) { log.warn("[timers] enqueue failed: {}", e.message) } },
        redisCommands = redis.commands,
    )
    timerScheduler.start()

    // Crash recovery loop — detects stale leases and re-enqueues runs
    val crashRecovery = CrashRecoveryLoop(
        dataSource = database.dataSource,
        eventStore = eventStore,
        leaseManager = leaseManager,
        enqueueJob = { job -> try { consumer.enqueueRecovery(job) } catch (e: Exception) { log.warn("[crash-recovery] enqueue failed: {}", e.message) } },
    )
    crashRecovery.start()

    // ── Metrics server ────────────────────────────────────────────────────────
    val metricsPort = System.getenv("METRICS_PORT")?.toIntOrNull() ?: 9090
    WorkerMetrics.startServer(metricsPort)

    log.info("=== vectorbea-worker ready [workerId={}] ===", config.workerId)

    // ── 8. Shutdown hook (SIGTERM / SIGINT) ───────────────────────────────────
    Runtime.getRuntime().addShutdownHook(Thread({
        log.info("[shutdown] signal received — beginning graceful shutdown…")

        // Stop accepting new jobs
        heartbeat.drain()
        timerScheduler.stop()
        crashRecovery.stop()
        consumer.stop(drainTimeoutSeconds = 30L)

        // Final heartbeat as stopped
        heartbeat.stop()

        // Close client DB pools (tenant connections)
        dbPoolManager.close()

        // Close infrastructure
        WorkerMetrics.stopServer()
        redis.close()
        database.close()

        log.info("[shutdown] complete")
        shutdownLatch.countDown()
    }, "shutdown-hook"))

    // ── 9. Block main thread ──────────────────────────────────────────────────
    try {
        // Keep the process alive until SIGTERM/SIGINT
        shutdownLatch.await()
    } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
    }
}
