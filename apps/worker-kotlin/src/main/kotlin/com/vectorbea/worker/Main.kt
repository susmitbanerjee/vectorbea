package com.vectorbea.worker

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.db.Database
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.heartbeat.WorkerHeartbeat
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.fairness.SharedTenantAdmission
import com.vectorbea.worker.fairness.WorkspaceLimits
import com.vectorbea.worker.fairness.WorkspaceLimitsProvider
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.queue.JobClassifier
import com.vectorbea.worker.queue.WorkflowQueueConsumer
import com.vectorbea.worker.redis.RedisProvider
import com.vectorbea.worker.runtime.RunProcessor
import com.vectorbea.worker.runtime.StepOutputStore
import com.vectorbea.worker.runtime.WorkflowRuntime
import com.vectorbea.worker.runtime.budget.ExecutionBudget
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.durable.CrashRecoveryLoop
import com.vectorbea.worker.durable.HistoryLimitChecker
import com.vectorbea.worker.durable.RunLeaseManager
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.durable.TimerScheduler
import com.vectorbea.worker.telemetry.TelemetryClient
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

    // ── 1b. Outbound timeout policy ───────────────────────────────────────────
    // Installed BEFORE any pool or HTTP client is built: the JDBC URLs are
    // rewritten from it and the shared HttpClient reads it once, at construction.
    val timeouts = com.vectorbea.worker.config.OutboundTimeouts.fromEnv()
    com.vectorbea.worker.net.OutboundHttp.configure(timeouts)
    timeouts.logEffectiveValues()

    // ── 2. Database ───────────────────────────────────────────────────────────
    val database = try {
        val db = Database.create(config, timeouts)
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
        maxConnectionsPerPool = timeouts.tenantPoolMaxSize,
        connectionTimeoutMs   = timeouts.tenantPoolConnectionTimeoutMs,
        idleTimeoutMs         = timeouts.tenantPoolIdleTimeoutMs,
        timeouts              = timeouts,
    )
    log.info("[startup] connector infrastructure ready")

    // Durable execution primitives — wired INTO the runtime/processor:
    //  - leaseManager:  exclusive run ownership (acquired per job, renewed, released)
    //  - stepGuard:     node-level idempotency across crash recovery / redelivery
    //  - historyChecker: event-history growth watchdog
    val leaseManager   = RunLeaseManager(database.dataSource)
    val historyChecker = HistoryLimitChecker(database.dataSource)
    val stepGuard      = StepExecutionGuard(database.dataSource)

    // Per-tick cooperative-yield budget — bounds how much work a run does per
    // worker thread before it checkpoints and re-enqueues a RESUME_RUN.
    val executionBudget = ExecutionBudget.fromEnv()

    // Tenant-database node execution is isolated here, not on the class pools.
    // Blast-radius containment: a hanging tenant database exhausts this and
    // nothing else. Must be created before the runtime that uses it.
    val tenantDbDispatcher = com.vectorbea.worker.runtime.TenantDbDispatcher(
        maxThreads = config.tenantDbConcurrency,
    )
    tenantDbDispatcher.logConfiguration()

    // Exactly-once guard: records the intent of every external side effect
    // BEFORE it happens and the response after, keyed deterministically, so an
    // at-least-once redelivery replays the stored answer instead of the call.
    val sideEffectGuard = com.vectorbea.worker.durable.SideEffectGuard(
        dataSource = database.dataSource,
        workerId = config.workerId,
    )

    val workflowRuntime = WorkflowRuntime(
        dataSource         = database.dataSource,
        eventStore         = eventStore,
        checkpointStore    = checkpointStore,
        approvalStore      = approvalStore,
        stepOutputStore    = stepOutputStore,
        workerId           = config.workerId,
        connectionResolver = connectionResolver,
        dbPoolManager      = dbPoolManager,
        debugWriter        = com.vectorbea.worker.runtime.debug.DebugSnapshotWriter(database.dataSource),
        stepGuard          = stepGuard,
        historyChecker     = historyChecker,
        executionBudget    = executionBudget,
        tenantDbDispatcher = tenantDbDispatcher,
        sideEffects        = sideEffectGuard,
    )
    val telemetry = TelemetryClient.fromEnv()

    // Per-tenant admission now reads shared state (run_leases), so limits are
    // enforced platform-wide and are independent of the replica count. The env
    // constants below survive only as the fallback for a workspace with no
    // usage-policy row.
    val limitsProvider = WorkspaceLimitsProvider(
        dataSource = database.dataSource,
        defaults = WorkspaceLimits(
            maxTotal = config.maxActiveRunsPerTenant,
            maxAgent = config.maxActiveAgentRunsPerTenant,
            maxLong  = config.maxActiveLongRunsPerTenant,
            maxShort = config.maxActiveShortRunsPerTenant,
        ),
    )
    val tenantLimiter = SharedTenantAdmission(
        dataSource = database.dataSource,
        limitsProvider = limitsProvider,
    )
    tenantLimiter.logConfiguration()

    // Poison-job protection: a job that crashes its worker is redelivered and
    // crashes the next one. Past max_attempts it lands in dead_letters instead.
    val deadLetterStore = com.vectorbea.worker.durable.DeadLetterStore(
        dataSource = database.dataSource,
        workerId = config.workerId,
    )

    // Resolves a run's stored execution class for continuation routing.
    val runClassLookup = com.vectorbea.worker.queue.RunClassLookup(database.dataSource)

    val processor = RunProcessor(
        dataSource      = database.dataSource,
        eventStore      = eventStore,
        heartbeat       = heartbeat,
        workerId        = config.workerId,
        runtime         = workflowRuntime,
        checkpointStore = checkpointStore,
        telemetry       = telemetry,
        leaseManager    = leaseManager,
        tenantAdmission = tenantLimiter,
        runClassLookup  = runClassLookup,
        deadLetters     = deadLetterStore,
        // Durably re-enqueue continuation jobs after a yield (survives crash).
        // Routed to the run's OWN class stream, read from agent_runs — a
        // continuation must resume in the pool its first half occupied.
        reEnqueue       = { job ->
            val cls = runClassLookup.classOf(job.runId)
            val stream = com.vectorbea.worker.queue.TypedStreamConsumer.streamKeyFor(cls)
            redis.commands.xadd(stream, job.toStreamFields())
            WorkerMetrics.redisXadd.inc()
            log.debug("[queue] re-enqueued continuation runId={} class={} stream={}",
                job.runId, cls, stream)
        },
    )
    log.info("[startup] run processor ready (lease + idempotency guards + cooperative yield active)")

    // ── 7. Execution pools, classifier, tenant fairness, queue consumer ───────
    // Slots are permits now, not threads. Waiting on I/O costs a continuation on
    // the heap instead of a parked thread, so these numbers are an order of
    // magnitude larger than the old pool sizes and are bounded by memory and
    // provider rate limits rather than by the thread budget (§2.3).
    val poolRouter = com.vectorbea.worker.queue.ExecutionSlots(
        shortPermits  = config.shortConcurrency,
        longPermits   = config.longConcurrency,
        agentPermits  = config.agentConcurrency,
        systemPermits = config.systemConcurrency,
    )
    poolRouter.logConfiguration()
    val jobClassifier = JobClassifier(database.dataSource)
    // ── 7b. Typed stream consumers — one per class, one per pool ─────────────
    //
    // Each consumer reads ONLY its own stream and asks for at most as many
    // messages as its pool has FREE slots, so a worker can never claim work it
    // cannot start. That is what removes PEL hoarding: not a mitigation, an
    // impossibility.
    //
    // Each gets a dedicated Redis connection because XREADGROUP BLOCK holds the
    // connection for the whole block window — sharing one would serialise all
    // four behind whichever happened to be waiting.
    val typedConsumers = com.vectorbea.worker.queue.WorkerJobType.entries.map { type ->
        com.vectorbea.worker.queue.TypedStreamConsumer(
            config = config,
            redis = redis.dedicatedConnection("stream-${type.name.lowercase()}"),
            processor = processor,
            router = poolRouter,
            tenantLimiter = tenantLimiter,
            jobType = type,
        )
    }

    // ── 7c. Legacy consumer — migration only ─────────────────────────────────
    //
    // Dual-consume: while a not-yet-upgraded API may still be writing to the old
    // untyped stream, keep serving it so no run is stranded. It classifies the
    // old way (read, then probe). Disabled with WORKER_LEGACY_STREAM_ENABLED=false
    // once the legacy stream is drained — see TYPED-QUEUE-MIGRATION.md.
    val legacyConsumer = if (config.legacyStreamEnabled) {
        WorkflowQueueConsumer(
            config, redis.dedicatedConnection("legacy-stream"), processor,
            router = poolRouter,
            classifier = jobClassifier,
            tenantLimiter = tenantLimiter,
        )
    } else null

    try {
        typedConsumers.forEach { it.ensureConsumerGroup() }
        legacyConsumer?.ensureConsumerGroup()
    } catch (e: Exception) {
        log.error("[startup] Failed to ensure consumer group — aborting: {}", e.message)
        heartbeat.stop()
        redis.close()
        database.close()
        exitProcess(4)
    }
    typedConsumers.forEach { it.start() }
    legacyConsumer?.start()

    // SYSTEM work synthesized by this worker (timers, crash recovery) is placed
    // straight onto the system pool — it is already durable in Postgres, so a
    // round trip through Redis would only add a hop.
    val systemConsumer = typedConsumers.first { it.streamKey.endsWith(".system") }

    log.info("[startup] consumers ready — typed={} legacy={}",
        typedConsumers.map { it.streamKey }, legacyConsumer?.let { config.queueStream } ?: "disabled")

    // ── Durable execution services ────────────────────────────────────────────
    // Timer scheduler — fires durable timers without blocking workers
    val timerScheduler = TimerScheduler(
        dataSource = database.dataSource,
        enqueueJob = { job -> try { systemConsumer.enqueueLocal(job) } catch (e: Exception) { log.warn("[timers] enqueue failed: {}", e.message) } },
        redisCommands = redis.commands,
    )
    timerScheduler.start()

    // Crash recovery loop — detects stale leases and re-enqueues runs
    val crashRecovery = CrashRecoveryLoop(
        dataSource = database.dataSource,
        eventStore = eventStore,
        leaseManager = leaseManager,
        enqueueJob = { job -> try { systemConsumer.enqueueLocal(job) } catch (e: Exception) { log.warn("[crash-recovery] enqueue failed: {}", e.message) } },
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
        typedConsumers.forEach { it.stop(drainTimeoutMs = 30_000L) }
        legacyConsumer?.stop(drainTimeoutSeconds = 30L)
        poolRouter.shutdown(config.shutdownTimeoutMs)

        // Release leases explicitly rather than letting them expire.
        //
        // Pools have drained, so anything still leased belongs to a run this
        // worker will not finish. Leaving those rows to time out would keep the
        // work invisible to crash recovery AND keep it counted against the
        // tenant's concurrency limit for the full lease TTL — during a rolling
        // deploy, that is a tenant held at its cap long after its work stopped.
        val released = runCatching { leaseManager.releaseAllForWorker(config.workerId) }.getOrDefault(0)
        if (released > 0) {
            log.info("[shutdown] released {} run lease(s) — capacity freed immediately, not on expiry", released)
        }

        // Final heartbeat as stopped
        heartbeat.stop()

        // Close client DB pools (tenant connections). The dispatcher goes first:
        // its threads are the ones that might be parked on a tenant socket, and
        // they are daemons precisely so a wedged tenant cannot block the deploy.
        tenantLimiter.close()
        tenantDbDispatcher.close()
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
