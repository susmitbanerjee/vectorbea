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
    /*
     * Pay the first-HTTPS-call cost here rather than inside the first agent
     * node of the first run after a deploy. See OutboundHttp.prewarm — the JVM
     * TLS stack, SecureRandom seeding and the shared client's threads all cost
     * real time exactly once, and charging that to a user's run is what makes
     * the first agent execution fail and the retry succeed.
     */
    com.vectorbea.worker.net.OutboundHttp.prewarm()

    // ── 2. Database ───────────────────────────────────────────────────────────
    val database = try {
        val db = Database.create(config, timeouts)
        val latency = db.ping()
        log.info("[startup] DB connected (latency={}ms)", latency)
        //check
        db
    } catch (e: Exception) {
        log.error("[startup] Failed to connect to database — aborting: {}", e.message)
        exitProcess(2)
    }

    // Ensure runtime tables exist (idempotent DDL)
    /* Only when one is actually missing. `CREATE TABLE IF NOT EXISTS` still needs
       CREATE on the schema — Postgres checks the privilege before it checks the
       table — so a least-privilege worker role logged "permission denied for
       schema public" on every boot for tables Flyway had already made. */
    val missingTables = runCatching { Database.missingRuntimeTables(database.dataSource) }.getOrDefault(listOf("unknown"))
    if (missingTables.isEmpty()) log.info("[startup] runtime tables ready")
    else try {
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
    eventStore.start()   // no-op unless AGENT_EVENT_BATCH_ENABLED
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

    /*
     * Trace span writer. Bounded buffer, dedicated thread, drops under pressure —
     * it can make a trace incomplete but can never make a run slower or fail.
     * TRACE_SPANS_ENABLED=false turns it off with no effect on any run outcome.
     */
    val spanWriter = com.vectorbea.worker.events.SpanWriter(
        database.dataSource, redis.pubSubConnection)
    spanWriter.start()

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

    // Per-connection circuit breaker. Shared by every executor that makes outbound
    // calls, and published to `connections` so the Connections page can show which
    // integration is unhealthy rather than leaving the customer to guess.
    val connectionCircuit = com.vectorbea.worker.net.ConnectionCircuit(database.dataSource)

    // Set once the timer scheduler exists — see RunProcessor.timerScheduler for
    // why this is deferred rather than injected.
    var timerSchedulerRef: TimerScheduler? = null

    // Records every provider call completely enough to replay it later. Without
    // this a run is not replayable, so it is wired unconditionally.
    val modelCallRecorder = com.vectorbea.worker.replay.ModelCallRecorder(database.dataSource)

    // Tracing, and the process identity every log line carries. Inert unless
    // OTEL_ENABLED=true; never throws.
    com.vectorbea.observability.logging.LogContext.identify("worker", config.workerId)
    com.vectorbea.observability.tracing.Tracing.init(
        serviceName = System.getenv("OTEL_SERVICE_NAME") ?: "vectorbea-worker",
        endpoint = System.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
        enabledFlag = System.getenv("OTEL_ENABLED")?.lowercase() == "true",
        resourceAttributes = System.getenv("OTEL_RESOURCE_ATTRIBUTES"),
    )

    // Output contracts - Layers 0 and 1 of the reliability defence. Wired
    // unconditionally: a node without a contract behaves exactly as before, and one
    // with a contract gets constrained decoding and validation before commit.
    val contractValidator = com.vectorbea.worker.contract.ContractValidator(database.dataSource)

    // Layer 3 - confidence routing. Also unconditional, and also inert on a node with
    // no contract and no citations: with nothing to score it returns "commit" without
    // touching the database.
    val confidenceGating = com.vectorbea.worker.confidence.ConfidenceGating(database.dataSource)

    // Resolves a run's stored execution class — for continuation routing, and for
    // telling the capacity bucket which runs may draw below the interactive floor.
    val runClassLookup = com.vectorbea.worker.queue.RunClassLookup(database.dataSource)

    /*
     * §12.4 — the shared provider token bucket.
     *
     * Wired unconditionally and INERT unless PROVIDER_CAPACITY_ENABLED is set: a
     * disabled bucket returns NotApplicable without touching Redis, so this costs
     * one object and changes nothing until an operator turns it on. It sits in
     * front of the existing circuit breaker and 429 handling rather than replacing
     * either — those stay the backstop for a limit this does not know about.
     */
    val providerCapacity = com.vectorbea.worker.net.ProviderCapacityBucket(redis.commands)

    /*
     * ── ONE PARKING PRIMITIVE, THREE CONSUMERS ──────────────────────────────
     *
     * `WaitStore` is where an async tool, a signal and an agent's own WAIT all
     * park; `SignalStore` is what delivers information into a live run. Built
     * once here and shared, because two instances would be two caches of nothing
     * and one more thing to wire.
     */
    val waitStore = com.vectorbea.worker.durable.wait.WaitStore(database.dataSource)
    val signalStore = com.vectorbea.worker.durable.wait.SignalStore(database.dataSource)

    val workflowRuntime = WorkflowRuntime(
        dataSource         = database.dataSource,
        eventStore         = eventStore,
        checkpointStore    = checkpointStore,
        approvalStore      = approvalStore,
        stepOutputStore    = stepOutputStore,
        workerId           = config.workerId,
        connectionResolver = connectionResolver,
        secretService      = secretService,
        signals            = signalStore,
        dbPoolManager      = dbPoolManager,
        debugWriter        = com.vectorbea.worker.runtime.debug.DebugSnapshotWriter(database.dataSource),
        stepGuard          = stepGuard,
        spanWriter         = spanWriter,
        historyChecker     = historyChecker,
        executionBudget    = executionBudget,
        tenantDbDispatcher = tenantDbDispatcher,
        sideEffects        = sideEffectGuard,
        circuit            = connectionCircuit,
        recorder           = modelCallRecorder,
        contracts          = contractValidator,
        confidence         = confidenceGating,
        capacity           = providerCapacity,
        runClassLookup     = runClassLookup,
    )

    /**
     * A runtime wired for replay against one specific recording.
     *
     * Built per replay rather than once, because the context holds that run's
     * cursors. Note what is NOT passed: no side-effect guard, because a replay
     * must not perform side effects at all — omitting it means an executor that
     * tried would have nothing to record against, on top of the ReplayContext
     * refusing the call.
     */
    val replayRuntimeFactory: (com.vectorbea.worker.replay.ReplayContext) -> WorkflowRuntime = { ctx ->
        WorkflowRuntime(
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
        spanWriter         = spanWriter,
            historyChecker     = historyChecker,
            executionBudget    = executionBudget,
            tenantDbDispatcher = tenantDbDispatcher,
            sideEffects        = null,
            circuit            = connectionCircuit,
            recorder           = null,
            replay             = ctx,
            // The same contracts apply on replay. Without this a replayed run would
            // skip validation and could appear to succeed where the original failed,
            // which would make replay useless for debugging a contract violation -
            // the most likely reason to open one.
            contracts          = contractValidator,
            // Deliberately absent. A replay reproduces what happened; it must not open
            // a NEW approval gate against a run that was already decided, and a person
            // being asked to review a replay of an output they already approved is a
            // confusing thing to do to them.
            confidence         = null,
        )
    }

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

    /*

     * The dispatched-child transport. §11.

     *

     * Enqueues onto the CHILD lane specifically, not the run's own class: a child

     * is `execution_class = 'agent.child'` by construction, and putting it on the

     * plain agent lane would undo the split — a parked supervisor's children would

     * queue behind the cold backlog of top-level runs the lane exists to separate

     * them from.

     */

    val childRunDispatcher = com.vectorbea.worker.agents.orchestration.ChildRunDispatcher(

        dataSource = database.dataSource,

        enqueue = { job ->

            val stream = com.vectorbea.worker.queue.TypedStreamConsumer.streamKeyFor(

                if (job.jobType == com.vectorbea.worker.queue.WorkflowRunJob.JobType.RESUME_RUN)

                    runClassLookup.classOf(job.runId)

                else com.vectorbea.worker.queue.WorkerJobType.AGENT_CHILD)

            redis.commands.xadd(stream, job.toStreamFields())

                ?: throw IllegalStateException("XADD returned null for stream=" + stream)

            WorkerMetrics.redisXadd.inc()

        },

    )


    /*
     * §9 — per-workspace OTLP export of finished run traces.
     *
     * Inert unless OTEL_TRACE_EXPORT_ENABLED=true AND the workspace has an enabled
     * `workspace_otel_exports` row. Distinct from `Tracing.init` above, which
     * instruments this worker for OUR observability: these spans go to the
     * customer's stack, and mixing the two destinations would leak our
     * infrastructure spans into their Tempo and their run ids into ours.
     */
    val traceExportConfig = com.vectorbea.worker.events.otel.TraceExportConfig(
        database.dataSource, secretService)
    val runTraceExporter = com.vectorbea.worker.events.otel.RunTraceExporter(
        dataSource = database.dataSource,
        config = traceExportConfig,
        sampler = com.vectorbea.worker.events.otel.RunTraceExporter
            .samplerForExport(database.dataSource),
        events = eventStore,
    )

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
        timerScheduler  = { timerSchedulerRef },
        replayRuntimeFactory = replayRuntimeFactory,
        spanWriter         = spanWriter,
        rootCause          = com.vectorbea.worker.events.RootCauseAttribution(database.dataSource),
        traceExporter      = runTraceExporter,
        childDispatcher = childRunDispatcher,
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
        agentChildPermits = config.agentChildConcurrency,
        agentInteractivePermits = config.agentInteractiveConcurrency,
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
    //
    // Skipped entirely in claim mode "postgres": the streams are then dead and a
    // consumer on them would sit blocked on XREADGROUP forever.
    val redisConsumeEnabled = config.claimMode != "postgres"
    val typedConsumers = if (!redisConsumeEnabled) emptyList() else
      com.vectorbea.worker.queue.WorkerJobType.entries.map { type ->
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
    val legacyConsumer = if (config.legacyStreamEnabled && redisConsumeEnabled) {
        WorkflowQueueConsumer(
            config, redis.dedicatedConnection("legacy-stream"), processor,
            router = poolRouter,
            classifier = jobClassifier,
            tenantLimiter = tenantLimiter,
        )
    } else null

    // ── 7d. Postgres claim ───────────────────────────────────────────
    //
    // WORKER_CLAIM_MODE:
    //   redis    — streams only. The default, so deploying this changes nothing.
    //   dual     — both. Runs enqueued before the cutover drain from the streams
    //              while new ones are claimed from Postgres. Safe because a run
    //              can only be claimed once: the stream path takes the lease and
    //              the claim path takes the row, and each is an atomic
    //              compare-and-set on the same run.
    //   postgres — claim only. Streams are dead; Redis keeps its real jobs.
    val claimEnabled = config.claimMode == "postgres" || config.claimMode == "dual"
    val postgresClaim = if (claimEnabled)
        com.vectorbea.worker.queue.PostgresClaim(database.dataSource, config.workerId) else null

    val claimConsumers: Map<com.vectorbea.worker.queue.WorkerJobType, com.vectorbea.worker.queue.ClaimConsumer> =
        if (postgresClaim == null) emptyMap() else
            com.vectorbea.worker.queue.WorkerJobType.entries.associateWith { type ->
                com.vectorbea.worker.queue.ClaimConsumer(
                    config = config,
                    claim = postgresClaim,
                    processor = processor,
                    slots = poolRouter,
                    jobType = type,
                )
            }

    // The listener needs a direct, non-pooled connection: PgBouncer in transaction
    // mode silently drops LISTEN registrations. ClaimWakeup logs at ERROR if the URL
    // it is handed looks pooled, because the failure mode is a queue that only
    // drains on the 2 s safety poll — slower, but never visibly broken.
    val claimWakeup = if (postgresClaim == null) null else com.vectorbea.worker.queue.ClaimWakeup(
        directUrl = com.vectorbea.worker.queue.ClaimWakeup.resolveDirectUrl() ?: config.dbUrl,
        onWakeup = { cls ->
            if (cls == null) claimConsumers.values.forEach { it.wakeup() }
            else claimConsumers[com.vectorbea.worker.queue.WorkerJobType.fromLabel(cls)]?.wakeup()
        },
    )

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
    claimConsumers.values.forEach { it.start() }
    claimWakeup?.start()

    // Reclaim rows a dead worker left in `claimed`. Cheap, and the only recovery
    // path the claim model needs — there is no PEL to sweep.
    val claimReclaimer = if (postgresClaim == null) null else
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "claim-reclaimer").also { it.isDaemon = true }
        }.also { sched ->
            sched.scheduleWithFixedDelay({
                runCatching {
                    val n = postgresClaim.reclaimStale()
                    if (n > 0) log.warn("[claim] reclaimed {} stale claims", n)
                }.onFailure { log.warn("[claim] reclaim sweep failed: {}", it.message) }
            }, 0L, 30L, java.util.concurrent.TimeUnit.SECONDS)
        }

    // SYSTEM work synthesized by this worker (timers, crash recovery) is placed
    // straight onto the system pool — it is already durable in Postgres, so a
    // round trip through Redis would only add a hop.
    val systemConsumer = typedConsumers.firstOrNull { it.streamKey.endsWith(".system") }

    // Timers and crash recovery synthesise SYSTEM work locally. In Redis mode that
    // goes straight onto the system pool; in Postgres mode the run row is already
    // `queued` in the database, so the claim loop picks it up on the next NOTIFY
    // and this is a no-op. Either way it never round-trips through the queue.
    val enqueueSystemJob: (com.vectorbea.worker.queue.WorkflowRunJob) -> Unit = { job ->
        val consumer = systemConsumer
        if (consumer != null) consumer.enqueueLocal(job)
        else claimConsumers[com.vectorbea.worker.queue.WorkerJobType.SYSTEM]?.wakeup()
    }

    log.info("[startup] consumers ready — typed={} legacy={}",
        typedConsumers.map { it.streamKey }, legacyConsumer?.let { config.queueStream } ?: "disabled")

    // ── Durable execution services ────────────────────────────────────────────
    // Timer scheduler — fires durable timers without blocking workers
    val timerScheduler = TimerScheduler(
        dataSource = database.dataSource,
        enqueueJob = { job -> try { enqueueSystemJob(job) } catch (e: Exception) { log.warn("[timers] enqueue failed: {}", e.message) } },
        redisCommands = redis.commands,
    )
    timerSchedulerRef = timerScheduler
    timerScheduler.start()

    // Crash recovery loop — detects stale leases and re-enqueues runs
    val crashRecovery = CrashRecoveryLoop(
        dataSource = database.dataSource,
        eventStore = eventStore,
        leaseManager = leaseManager,
        enqueueJob = { job -> try { enqueueSystemJob(job) } catch (e: Exception) { log.warn("[crash-recovery] enqueue failed: {}", e.message) } },
    )
    crashRecovery.start()

    /*
     * ── THE RESUME RECONCILER ────────────────────────────────────────────────
     *
     * Started right after crash recovery because it covers the runs crash
     * recovery structurally cannot see: `findStaleRuns` scans
     * ('running','yielded'), so every PARKED run — waiting on an approval, on
     * children, on a timer, or stuck mid-recovery — is invisible to it.
     *
     * All four of those park by changing durable state and THEN enqueueing
     * best-effort, so a Redis hiccup at the wrong moment strands the run with
     * the decision already recorded and the caller already told it worked.
     *
     * Deliberately NOT routed through `enqueueSystemJob`: a resume must go back
     * to the run's OWN class stream, or a recovered agent run would execute on
     * the system pool and take a slot that timer resumes and cancellations need
     * to stay unstarvable. Same reasoning, and the same lookup, as the
     * continuation re-enqueue above.
     */
    val resumeReconciler = com.vectorbea.worker.durable.ResumeReconciler(
        dataSource = database.dataSource,
        enqueue = { job ->
            val cls = runClassLookup.classOf(job.runId)
            val stream = com.vectorbea.worker.queue.TypedStreamConsumer.streamKeyFor(cls)
            redis.commands.xadd(stream, job.toStreamFields())
                ?: throw IllegalStateException("XADD returned null for stream=$stream")
            WorkerMetrics.redisXadd.inc()
        },
    )
    resumeReconciler.start()

    /*
     * ── THE THING THAT NOTICES A CALLBACK THAT NEVER CAME ───────────────────
     *
     * Polls what declares a poll, and times out what has run out of time. It is
     * the only component that can produce the second of those: a callback that
     * did not arrive is, by definition, not an event anything else observes.
     *
     * Enqueues onto the run's own class stream, exactly as the reconciler above
     * does — a resume from a wait must not land on the system pool and take a
     * slot that timer resumes and cancellations need.
     */
    val waitSweeper = com.vectorbea.worker.durable.wait.WaitSweeper(
        dataSource = database.dataSource,
        waits = waitStore,
        connectionResolver = connectionResolver,
        enqueue = { job ->
            val cls = runClassLookup.classOf(job.runId)
            val stream = com.vectorbea.worker.queue.TypedStreamConsumer.streamKeyFor(cls)
            redis.commands.xadd(stream, job.toStreamFields())
                ?: throw IllegalStateException("XADD returned null for stream=$stream")
            WorkerMetrics.redisXadd.inc()
        },
    )
    waitSweeper.start()

    /*
     * ── RESULT DELIVERY ─────────────────────────────────────────────────────
     * Everything that happens AFTER a run is terminal: calling a customer's
     * endpoint, pushing to a destination, backing off, dead-lettering.
     *
     * In the worker rather than the API because it is a background loop with a
     * long, durable retry schedule, and because the API's instances are sized
     * for request latency — a fleet of them each holding HTTP connections open
     * to somebody's slow endpoint is a worse place for this than the pool that
     * already exists for long work.
     */
    val deliveryDispatcher = com.vectorbea.worker.delivery.DeliveryDispatcher(
        dataSource = database.dataSource,
        store = com.vectorbea.worker.delivery.DeliveryStore(database.dataSource),
        secrets = secretService,
        events = eventStore,
    )
    deliveryDispatcher.start()

    /*
     * Partition maintenance — creates next month's partitions before anything needs
     * to write into them, for BOTH run_events and run_spans.
     *
     * run_events has needed this since V028: that migration shipped the ensure/drop
     * functions and nothing ever called them, and the table has no DEFAULT partition,
     * so an insert past the last pre-created month errors rather than degrading.
     *
     * Dropping expired partitions is OFF unless PARTITION_DROP_ENABLED=true — the
     * job logs what it would drop first, so a cycle can be read before anything is
     * destroyed.
     */
    val partitionMaintenance = com.vectorbea.worker.durable.PartitionMaintenance(
        dataSource = database.dataSource,
        redisCommands = redis.commands,
        /* The warm tier. Null unless TRACE_ARCHIVE_DIR names somewhere to write,
           and when it is null the drop behaves exactly as it did before §12.1 —
           a deployment without object storage still needs its retention job. */
        archiver = com.vectorbea.worker.durable.archive.archiveStoreFromEnv()
            .takeIf { it !is com.vectorbea.worker.durable.archive.UnconfiguredArchiveStore }
            ?.let { com.vectorbea.worker.durable.archive.TraceArchiver(
                database.dataSource, it,
                /* Sampling is a warm-tier decision, made once the run has finished
                   and every fact about it is known. See TraceSampler for why it is
                   not done at write time. Keeps everything until an operator lowers
                   `trace_sample_rate` for a workspace. */
                sampler = com.vectorbea.worker.durable.archive.TraceSampler
                    .fromDatabase(database.dataSource)) },
    )
    partitionMaintenance.start()

    // ── Retention sweeper ─────────────────────────────────────────────────────
    //
    // Per-workspace, per-entity deletion of data past its plan's window. Its own
    // scheduler rather than another phase of `PartitionMaintenance`, because the
    // two answer different questions and must be able to fail separately: one
    // keeps the PLATFORM's partitions healthy, the other enforces a CUSTOMER's
    // policy. Folding them together would mean an archive export that is behind —
    // which correctly blocks a partition drop — also silently stops enforcing
    // retention on every workspace.
    //
    // It shares the export store with the archiver and takes its own Redis lock,
    // so exactly one worker sweeps at a time however many replicas are running.
    val retentionSweeper = com.vectorbea.worker.retention.RetentionSweeper(
        dataSource = database.dataSource,
        redisCommands = redis.commands,
        exporter = com.vectorbea.worker.retention.WorkspaceExporter(database.dataSource),
    )
    retentionSweeper.start()

    // ── Metrics server ────────────────────────────────────────────────────────
    // §5.4: `job_queue_depth{workspace, priority}`. Sampled on scrape rather than
    // counted in-process, because the queue is a Postgres table that every replica and
    // the API also write - a local counter would be wrong within seconds.
    //
    // One indexed aggregate per scrape, capped at the busiest 200 workspaces so a
    // pathological tenant count cannot turn the metrics endpoint into a table scan or
    // the exposition into a cardinality bomb.
    WorkerMetrics.queueDepthSource = {
        database.dataSource.connection.use { conn ->
            conn.prepareStatement(
                // `priority` is a SMALLINT (0 ordinary, 100 demo lane). Bucketed into a
                // label here rather than exposed raw: a numeric label value would make
                // the dashboard legend read "0" and "100", and would grow a new series
                // the day someone introduces priority 50.
                """SELECT workspace_id::text,
                          CASE WHEN priority >= 100 THEN 'priority' ELSE 'normal' END AS priority,
                          COUNT(*) AS depth
                     FROM agent_runs
                    WHERE status = 'queued'
                    GROUP BY 1, 2
                    ORDER BY depth DESC
                    LIMIT 200"""
            ).use { stmt ->
                stmt.queryTimeout = 2
                stmt.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(Triple(rs.getString(1), rs.getString(2), rs.getLong(3)))
                    }
                }
            }
        }
    }

    val metricsPort = System.getenv("METRICS_PORT")?.toIntOrNull() ?: 9090
    WorkerMetrics.startServer(metricsPort)

    log.info("=== vectorbea-worker ready [workerId={}] ===", config.workerId)

    // ── 8. Shutdown hook (SIGTERM / SIGINT) ───────────────────────────────────
    Runtime.getRuntime().addShutdownHook(Thread({
        log.info("[shutdown] signal received — beginning graceful shutdown…")

        // Stop accepting new jobs
        heartbeat.drain()
        timerScheduler.stop()
        waitSweeper.stop()
        /* Before the pool closes. A dispatcher mid-attempt would otherwise write
           its outcome against a closing datasource and leave the row `delivering`
           until the claim TTL — a five-minute delay on every deploy. */
        deliveryDispatcher.stop()
        resumeReconciler.stop()
        crashRecovery.stop()
        /* Stopped early and without waiting: a sweep interrupted mid-batch loses
           nothing — every batch has already committed and the next pass recomputes
           what is left — so there is no reason to hold a shutdown open for it. */
        retentionSweeper.stop()
        typedConsumers.forEach { it.stop(drainTimeoutMs = 30_000L) }
        legacyConsumer?.stop(drainTimeoutSeconds = 30L)
        claimWakeup?.close()
        claimReclaimer?.shutdownNow()
        claimConsumers.values.forEach { it.stop(drainTimeoutMs = 30_000L) }
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

        /* Drain in-flight exports first, THEN close the pools they are writing
           to — the other order aborts a request that was about to succeed. */
        runCatching { runTraceExporter.stop() }

        /* Close the OTLP exporters' HTTP pools. Each holds a connection pool and
           daemon threads; leaving them open delays the JVM's exit for no benefit. */
        runCatching { traceExportConfig.close() }

        /* Flush buffered events BEFORE Redis and the pool close. A batched
           event still in the deque at this point is one the timeline will never
           show, and the last events before a deploy are the interesting ones. */
        runCatching { eventStore.stop() }

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
