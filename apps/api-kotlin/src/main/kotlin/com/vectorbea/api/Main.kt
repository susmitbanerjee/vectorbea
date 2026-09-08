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
import com.vectorbea.api.repository.DashboardRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.api.repository.WorkflowRepository
import com.vectorbea.api.architect.WorkflowArchitectRepository
import com.vectorbea.api.architect.WorkflowArchitectRoutes
import com.vectorbea.api.architect.WorkflowArchitectService
import com.vectorbea.api.routes.AgentRoutes
import com.vectorbea.api.routes.DashboardRoutes
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
import com.vectorbea.api.beta.BetaAccessRepository
import com.vectorbea.api.beta.BetaRoutes
import com.vectorbea.api.routes.WorkflowRoutes
import com.vectorbea.api.telemetry.TelemetryClient
import com.vectorbea.api.secrets.EncryptedSecretService
import com.vectorbea.api.secrets.NoOpSecretService
import com.vectorbea.api.secrets.SecretRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.crypto.Encryption
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
 *  9. Shutdown hook.
 *
 * Security: DATABASE_URL, REDIS_URL, and SECRET_ENCRYPTION_KEY values are NEVER logged.
 */
fun main() {
    val log = LoggerFactory.getLogger("vectorbea.main")

    // 1. Config
    val config = AppConfig.fromEnv()
    // Analytics is constructed after the database below and `telemetry` is rebound to
    // the in-process client then. `fromEnv()` is the fallback for a deployment that
    // still points at a remote collector.
    var telemetry = TelemetryClient.fromEnv()

    // Tracing, and the process identity every log line carries.
    //
    // Both are set before anything else runs so that a failure during startup is
    // already attributable. Tracing is inert unless OTEL_ENABLED=true and never throws
    // — an observability layer that prevents the service from starting has inverted its
    // own purpose. check
    com.vectorbea.observability.logging.LogContext.identify("api")
    com.vectorbea.observability.tracing.Tracing.init(
        serviceName = System.getenv("OTEL_SERVICE_NAME") ?: "vectorbea-api",
        endpoint = System.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
        enabledFlag = System.getenv("OTEL_ENABLED")?.lowercase() == "true",
        resourceAttributes = System.getenv("OTEL_RESOURCE_ATTRIBUTES"),
    )

    // Production startup validation — fail closed if critical config is missing
    config.validateForProduction()
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

    // Typed streams: runs.short / runs.long / runs.agent / runs.system, routed by
    // the execution class materialised at trigger. REDIS_LEGACY_QUEUE_STREAM is
    // the migration mirror — while set, every enqueue is ALSO written to the old
    // single stream so a not-yet-upgraded worker still sees it. Unset it once
    // every worker consumes typed streams; see TYPED-QUEUE-MIGRATION.md.
    val legacyMirrorStream: String? = System.getenv("REDIS_LEGACY_QUEUE_STREAM")?.takeIf { it.isNotBlank() }
    //
    // QUEUE_MODE selects the transport. The default is unchanged, so this deploys
    // as a no-op; see docs/architecture/POSTGRES-CLAIM.md for the ordered cutover.
    val queueMode = com.vectorbea.api.queue.PostgresClaimQueue.mode()
    val streamQueue: WorkflowQueue? = if (redis != null) {
        val q = com.vectorbea.api.queue.TypedStreamsWorkflowQueue(
            redis = redis,
            legacyStreamKey = legacyMirrorStream,
        )
        com.vectorbea.api.queue.TypedStreamsWorkflowQueue.verifyStreams(redis, legacyMirrorStream)
        q
    } else null
    val workflowQueue: WorkflowQueue? = when (queueMode) {
        "postgres" -> com.vectorbea.api.queue.PostgresClaimQueue()
        "dual"     -> com.vectorbea.api.queue.PostgresClaimQueue(mirror = streamQueue)
        else       -> streamQueue
    }
    log.info("[startup] queue mode = {} ({})", queueMode, when (queueMode) {
        "postgres" -> "Postgres claim only — no XADD"
        "dual"     -> "Postgres claim + typed-stream mirror"
        else       -> "typed Redis streams"
    })

    val distributedLock = if (redis != null) RedisDistributedLock(redis, config.redis!!.lockPrefix) else null
    val eventBus = if (redis != null) RedisRunEventBus(redis, config.redis!!.eventChannelPrefix) else null
    val rateLimiter = if (redis != null) RedisRateLimiter(redis, config.redis!!.cachePrefix) else null
    // Token buckets — continuous refill with a burst allowance, unlike the fixed
    // window above. See TokenBucket for why the boundary burst matters under load.
    val tokenBucket = if (redis != null)
        com.vectorbea.api.rate.TokenBucket(redis, config.redis!!.cachePrefix) else null
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

    // ── Analytics, formerly apps/telemetry ────────────────────────────────────
    // Same DataSource as everything else: one pool per process, so analytics writes
    // are visibly charged against the connection budget rather than hidden in a second
    // pool that only shows up when Postgres starts refusing connections.
    val analyticsConfig = com.vectorbea.observability.analytics.AnalyticsConfig.fromEnv()
    val analyticsRepo = ds?.let { com.vectorbea.observability.analytics.AnalyticsRepository(it) }
    val analyticsIngestion = analyticsRepo?.let {
        com.vectorbea.observability.analytics.AnalyticsIngestionService(it, analyticsConfig)
    }
    val analyticsQuery = analyticsRepo?.let {
        com.vectorbea.observability.analytics.AnalyticsQueryService(it)
    }
    val engineeringTelemetry = ds?.let {
        com.vectorbea.observability.engineering.EngineeringTelemetryService(it)
    }
    if (analyticsIngestion != null) {
        telemetry = TelemetryClient.local(analyticsIngestion, analyticsConfig.vectorbeaEnv)
    }

    // Append-only governance trail (P20). Constructed even without a database so
    // call sites need no null dance; it no-ops when there is nowhere to write.
    val auditLog = com.vectorbea.api.audit.AuditLog(ds)

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

    // ── S3: plans and entitlements ───────────────────────────────────────────
    //
    // Built once and shared by every enforcement point. One resolver means one
    // cache, one catalogue-version probe, and — the part that matters — one
    // implementation of "which plan governs this workspace". A second one would
    // eventually disagree with this one, and the disagreement would be a tenant
    // getting somebody else's limits.
    //
    // Constructed HERE, above `AuthMiddleware`, because the middleware needs
    // `ApiKeyService` to authenticate `vb_` keys — and a key must resolve its
    // workspace before any route runs, or the request would reach an enforcement
    // point with no principal and be treated as dev-mode.
    val entitlementResolver = ds?.let { com.vectorbea.api.entitlements.EntitlementResolver(it) }
    val entitlementGuard = if (ds != null && entitlementResolver != null)
        com.vectorbea.api.entitlements.EntitlementGuard(entitlementResolver, ds) else null
    val usageMeter = if (ds != null)
        com.vectorbea.api.entitlements.UsageMeter(ds, entitlementResolver) else null
    val apiKeyService = if (ds != null)
        com.vectorbea.api.entitlements.ApiKeyService(ds, entitlementGuard) else null

    // ── S4: billing, built and switched off ──────────────────────────────────
    //
    // `BillingProviderRegistry.fromEnv()` returns a registry with no live
    // provider unless credentials are present, so every call runs against the
    // noop provider: our schema moves, nothing is charged, and the whole domain
    // is exercisable before there is a bank account.
    //
    // Nothing on the entitlement path touches any of this. A provider outage
    // cannot reach a quota check, because a quota check reads
    // `billing_accounts.plan_code` and billing only ever WRITES it.
    val billingProviders = com.vectorbea.api.billing.BillingProviderRegistry.fromEnv()
    val billingRepo = ds?.let { com.vectorbea.api.billing.BillingRepository(it) }
    val billingService = if (ds != null && billingRepo != null)
        com.vectorbea.api.billing.BillingService(ds, billingRepo, billingProviders) else null
    val webhookProcessor = if (ds != null && billingRepo != null)
        com.vectorbea.api.billing.WebhookProcessor(ds, billingRepo) else null
    val usageReporter = if (ds != null && billingRepo != null)
        com.vectorbea.api.billing.UsageReporter(ds, billingRepo, billingProviders) else null
    /* Settles ended subscriptions, applies the dunning schedule, reports usage
       and reconciles it. Inert on a deployment with no subscriptions, which is
       why it is not behind a second flag — see BillingScheduler's header. */
    val billingScheduler = if (ds != null && usageReporter != null)
        com.vectorbea.api.billing.BillingScheduler(ds, usageReporter, billingProviders) else null
    if (entitlementGuard == null) log.warn("Entitlements disabled — no database; plan limits are NOT enforced")

    val authMiddleware = if (jwtVerifier != null && appUserRepo != null) {
        AuthMiddleware(jwtVerifier = jwtVerifier, userRepo = appUserRepo, config = config,
            apiKeys = apiKeyService)
    } else {
        log.warn("AuthMiddleware: disabled (dev mode)")
        null
    }

    // 6b. Repositories (require DB) — ds already declared above
    val connectionRepo = ds?.let { ConnectionRepository(it) }
    val agentRepo = ds?.let { AgentRepository(it) }
    val toolRepo = ds?.let { ToolRepository(it) }
    val workflowRepo = ds?.let { WorkflowRepository(it) }

    // Classification happens here, once per workflow version, and is memoised on
    // the version row. Every enqueue path shares this instance so a version is
    // parsed at most once per process — and, thanks to the row memo, usually
    // never again after the first trigger anywhere in the fleet.
    val executionClassResolver = workflowRepo?.let {
        com.vectorbea.api.queue.ExecutionClassResolver(it)
    }
    val runRepo = ds?.let { RunRepository(it) }
    val runEventRepo = ds?.let { RunEventRepository(it) }
    val approvalRepo = ds?.let { ApprovalRepository(it) }
    val scheduleRepo = ds?.let { com.vectorbea.api.schedule.ScheduleRepository(it) }
    val environmentRepo = ds?.let { com.vectorbea.api.repository.EnvironmentRepository(it) }

    /*
     * 6c. Workspace-scoped environment resolution.
     *
     * `requireEnvironmentId()` used to take `X-Environment-Id` on trust, and the
     * only endpoint that ever gave a client one handed out the oldest
     * workspace's environment to everybody. So a write either landed in another
     * tenant or was refused outright, and the UI refused — which is why creating
     * a tool reported that it might be registered in a different workspace.
     *
     * Environment is now an internal storage partition only. Requests are
     * workspace-scoped, RBAC is evaluated from that verified workspace, and
     * every write resolves the workspace's internal partition here. A stale
     * client header therefore cannot select, authorize, or reject a workspace.
     */
    if (environmentRepo != null) {
        com.vectorbea.api.api.EnvironmentScope.resolver = { workspaceId, _ ->
            (environmentRepo.firstByWorkspace(workspaceId)
                ?: environmentRepo.findOrCreate(workspaceId, BootstrapRoutes.DEFAULT_SLUG)).id
        }
        log.info("EnvironmentScope: workspace-owned storage partition resolution enabled")
    }

    // 7. Router + routes
    val router = Router()
    // Role enforcement, installed once for every route on this router. See
    // RbacGuard: membership alone was previously checked, so a viewer could
    // create and delete workflows, agents and tools.
    router.authorize = { req, method, pattern ->
        com.vectorbea.api.auth.RbacGuard.check(req, method, pattern)
    }
    HealthRoutes(config, database, redis).register(router)
    VersionRoutes(config).register(router)
    NetworkRoutes().register(router)
    MetricsRoutes().register(router)
    com.vectorbea.api.telemetry.TelemetryRoutes(
        analyticsIngestion, analyticsQuery, engineeringTelemetry, config).register(router)
    com.vectorbea.api.telemetry.AdminConsoleRoutes().register(router)

    if (connectionRepo != null) {
        ConnectionRoutes(
            connectionRepo, cacheService, secretService, telemetry, auditLog,
            environmentRepo,
        ).register(router)
        ConnectionTestRoutes(connectionRepo, secretService, cacheService).register(router)
        SchemaPreviewRoutes(connectionRepo, secretService).register(router)
    } else log.warn("ConnectionRoutes disabled — no database")

    if (agentRepo != null && connectionRepo != null) {
        AgentRoutes(agentRepo, connectionRepo, cacheService, entitlementGuard).register(router)
    } else log.warn("AgentRoutes disabled — no database")

    /*
     * ── TOOLS, THEIR VERSIONS, AND THE SPEC IMPORTS THAT PROPOSE THEM ───────
     *
     * One `ToolVersionRepository` shared by all three, because they are three
     * views of one rule: a tool's definition changes only through a version.
     * `ToolRoutes` writes an `applied` one (a person edited their own tool);
     * `ApiSpecRoutes` writes a `pending` one (nobody has read what a re-import
     * changed); `ToolVersionRoutes` is the only thing that makes a pending one
     * live. See V064.
     */
    val toolVersionRepo = ds?.let { com.vectorbea.api.repository.ToolVersionRepository(it) }

    if (toolRepo != null && connectionRepo != null) {
        ToolRoutes(toolRepo, connectionRepo, cacheService, toolVersionRepo).register(router)
    } else log.warn("ToolRoutes disabled — no database")

    if (toolRepo != null && connectionRepo != null && toolVersionRepo != null && ds != null) {
        com.vectorbea.api.routes.ApiSpecRoutes(
            imports = com.vectorbea.api.repository.SpecImportRepository(ds),
            tools = toolRepo,
            versions = toolVersionRepo,
            connections = connectionRepo,
            dataSource = ds,
        ).register(router)
        com.vectorbea.api.routes.ToolVersionRoutes(toolVersionRepo, toolRepo).register(router)
    } else log.warn("Spec import and tool versioning disabled — no database")

    if (workflowRepo != null) {
        WorkflowRoutes(workflowRepo, cacheService, telemetry, scheduleRepo, entitlementGuard).register(router)
    } else log.warn("WorkflowRoutes disabled — no database")

    // Cron schedules: read API + the firing loop (see WorkflowScheduler).
    if (scheduleRepo != null) {
        com.vectorbea.api.routes.ScheduleRoutes(scheduleRepo).register(router)
    } else log.warn("ScheduleRoutes disabled — no database")

    // Dashboard summary — requires DB for metric queries
    if (ds != null) {
        DashboardRoutes(DashboardRepository(ds), cacheService).register(router)

    // AI Workflow Architect (requires workflow, tool, agent, connection repos)
    if (workflowRepo != null && toolRepo != null && agentRepo != null && connectionRepo != null) {
        val architectRepo    = WorkflowArchitectRepository(ds)
        val architectService = WorkflowArchitectService(architectRepo, workflowRepo, toolRepo, agentRepo, connectionRepo, ds, config)
        WorkflowArchitectRoutes(architectService, connectionRepo, secretService).register(router)
        log.info("AI Workflow Architect: enabled={} model={}", config.architectEnabled, config.architectModel)
    } else log.warn("WorkflowArchitectRoutes disabled — no database")
    } else log.warn("DashboardRoutes disabled — no database")

    if (runRepo != null && runEventRepo != null) {
        val betaRepoForRuns = ds?.let { com.vectorbea.api.beta.BetaAccessRepository(it) }
        RunRoutes(
            classResolver = executionClassResolver,
            dataSource = ds,
            runRepo = runRepo,
            eventRepo = runEventRepo,
            workflowRepo = workflowRepo,
            queue = workflowQueue,
            eventBus = eventBus,
            lock = distributedLock,
            redis = redis,
            betaRepo = betaRepoForRuns,
            appConfig = config,
            telemetry = telemetry,
            admission = ds?.let { com.vectorbea.api.admission.AdmissionControl(it) },
            runRateLimiter = tokenBucket,
            entitlements = entitlementGuard,
            usageMeter = usageMeter,
        ).register(router)

        com.vectorbea.api.routes.DebugRoutes(
            runRepo = runRepo,
            debugRepo = com.vectorbea.api.repository.DebugSnapshotRepository(ds!!),
            workflowRepo = workflowRepo,
            queue = workflowQueue,
            classResolver = executionClassResolver,
        ).register(router)
    } else log.warn("RunRoutes disabled — no database")

    if (approvalRepo != null) {
        ApprovalRoutes(
            repo      = approvalRepo,
            runRepo   = runRepo,
            eventRepo = runEventRepo,
            queue     = workflowQueue,
            audit     = auditLog,
        ).register(router)
    } else log.warn("ApprovalRoutes disabled — no database")

    if (ds != null) {
        WorkerRoutes(ds).register(router)
        // Fleet health for the Control page — liveness, load, headroom.
        com.vectorbea.api.routes.FleetStatusRoutes(ds).register(router)
        // The Control page reads the same definitions the dashboards do — see the
        // class doc for why this queries Postgres rather than proxying Prometheus.
        com.vectorbea.api.routes.ControlMetricsRoutes(ds).register(router)
        // One workspace-wide event tail for Control; avoids polling every run.
        com.vectorbea.api.routes.ControlActivityRoutes(ds).register(router)
        // Dead-lettered jobs — the most actionable failure the platform emits.
        com.vectorbea.api.routes.DeadLetterRoutes(ds).register(router)
        // Queue position + wait reason — only answerable now the claim lives in
        // Postgres. A visible position is patience; an unexplained 'queued' is a
        // bug report.
        com.vectorbea.api.routes.QueuePositionRoutes(ds).register(router)
        // A continuation chain presented as one logical run. Without this the Runs
        // page shows Temporal-style history truncation as two unrelated rows, and
        // the feature reads as a bug.
        com.vectorbea.api.routes.ContinuationRoutes(ds).register(router)
        // Output contracts: CRUD, draft inference, live testing, and the publish
        // gate that refuses a schema the provider cannot enforce.
        com.vectorbea.api.contract.ContractRoutes(ds, auditLog).register(router)
        // Confidence: the gate payload, the four reviewer actions, and calibration.
        com.vectorbea.api.confidence.ConfidenceRoutes(ds, auditLog).register(router)
        BootstrapRoutes(ds, environmentRepo!!).register(router)
    } else log.warn("WorkerRoutes/BootstrapRoutes disabled — no database")

    if (appUserRepo != null) {
        MeRoutes(appUserRepo, entitlementGuard).register(router)
    } else log.warn("MeRoutes disabled — no database")

    // Beta access + admin routes
    if (ds != null && appUserRepo != null) {
        val betaRepo = BetaAccessRepository(ds)
        BetaRoutes(betaRepo, appUserRepo, config, telemetry).register(router)
        log.info("BetaRoutes registered")
    }

    if (ds != null) {
        FailureIncidentRoutes(FailureIncidentRepository(ds)).register(router)
        DurableRunRoutes(ds, workflowQueue).register(router)
        AgentIterationRoutes(ds).register(router)
        /* The read side of the trace: span tree, root cause, critical path, live
           stream. Read-only and workspace-scoped; nothing here can affect a run.
           Registered only when the run repository is available — every endpoint
           resolves the run through it to enforce workspace scoping, so without it
           the routes could not fail closed and must not exist at all. */
        runRepo?.let { com.vectorbea.api.routes.TraceRoutes(ds, it, redis).register(router) }
        /* The debugger's v2 reads: the constellation, the burn-down and compare.
           Separate from TraceRoutes because they answer a different question —
           "who asked whom, and why" lives in agent_handoffs, not in the span tree. */
        runRepo?.let { com.vectorbea.api.routes.ConstellationRoutes(ds, it).register(router) }
        /* The failures roll-up. Workspace-scoped rather than run-scoped, so it
           takes no run repository — it checks the path id against the caller's
           own workspace itself, because a workspace id in a URL is not an
           authorisation and this endpoint aggregates everything that workspace
           ever did. */
        com.vectorbea.api.routes.FailureRoutes(ds).register(router)

        // Retention: what this workspace keeps and until when, the deletion
        // audit, on-demand export, and the sweeper's heartbeat. The heartbeat is
        // served by the API rather than the worker because an alert needs one
        // stable URL, and the worker fleet is many processes that come and go.
        com.vectorbea.api.routes.RetentionRoutes(ds).register(router)

        // API keys, and the spend-by-member view an owner needs once a workspace
        // is shared. Both require the guard: a key is created against a plan
        // ceiling, and a member budget is compared against the plan's default.
        if (apiKeyService != null && entitlementGuard != null) {
            com.vectorbea.api.routes.ApiKeyRoutes(ds, apiKeyService, entitlementGuard).register(router)
        }

        // Billing. Registered unconditionally when there is a database — an
        // endpoint that only exists once a flag is on is an endpoint nobody
        // tests. What is gated is the UI; the API runs on noop until a provider
        // is configured.
        if (billingRepo != null && billingService != null && webhookProcessor != null) {
            com.vectorbea.api.routes.BillingRoutes(
                billingRepo, billingService, billingProviders, webhookProcessor,
            ).register(router)
        }

        // What this workspace is entitled to, and the public plan catalogue. The
        // settings page and every UI feature gate read the resolved entitlements
        // rather than a plan code, so a limit raised in the database changes what
        // the page says without a deploy — and so a UI gate cannot promise
        // something the API will refuse.
        if (entitlementResolver != null && entitlementGuard != null) {
            com.vectorbea.api.routes.EntitlementRoutes(ds, entitlementResolver, entitlementGuard)
                .register(router)
        }
    } else log.warn("FailureIncidentRoutes/DurableRunRoutes/AgentIterationRoutes disabled — no database")

    // 7b. Cron scheduler — fires due workflow schedules onto the queue
    val workflowScheduler = if (scheduleRepo != null && workflowRepo != null &&
        runRepo != null && runEventRepo != null && workflowQueue != null) {
        com.vectorbea.api.schedule.WorkflowScheduler(
            schedules = scheduleRepo,
            workflowRepo = workflowRepo,
            runRepo = runRepo,
            eventRepo = runEventRepo,
            queue = workflowQueue,
            classResolver = executionClassResolver,
            dataSource = ds,
        ).also { it.start() }
    } else {
        log.warn("WorkflowScheduler disabled — requires database + queue")
        null
    }

    // 8. HTTP server
    val server = HttpServer(config, router, authMiddleware, requestRateLimiter = tokenBucket)

    // 9. Graceful shutdown
    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("Shutdown signal received — stopping server...")
        workflowScheduler?.stop()
        billingScheduler?.stop()
        server.stop(delaySeconds = 5)
        database?.close()
        redis?.close()
        log.info("Shutdown complete")
    })

    billingScheduler?.start()

    server.start()
    log.info("vectorbea-api running on port {} — press Ctrl+C to stop", config.port)
    Thread.currentThread().join()
}
