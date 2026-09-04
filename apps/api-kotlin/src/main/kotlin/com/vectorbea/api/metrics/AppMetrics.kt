package com.vectorbea.api.metrics

// ─────────────────────────────────────────────────────────────────────────────
// Application-level metric definitions.
//
// All metrics are created once at class-load time via the top-level
// counter() / gauge() / histogram() convenience functions which auto-register
// them in MetricsRegistry.
//
// Usage:
//   AppMetrics.requestCount.inc("GET", "200")
//   AppMetrics.dbQueryDuration.observe(42L, "runs", "findById")
//
// SECURITY: label values must never contain secrets, IDs should be anonymised
// (path parameters replaced with placeholders) before passing here.
// ─────────────────────────────────────────────────────────────────────────────
object AppMetrics {

    // ── HTTP request metrics ──────────────────────────────────────────────────

    /** Total HTTP requests received. Labels: method, status_class (2xx/4xx/5xx), path_pattern */
    val requestCount: Counter = counter(
        "api_requests_total",
        "Total number of HTTP requests received",
        "method", "status_class", "path_pattern",
    )

    /** Request duration in milliseconds. Labels: method, path_pattern */
    val requestDuration: Histogram = histogram(
        "api_request_duration_ms",
        "HTTP request duration in milliseconds",
        "method", "path_pattern",
    )

    // ── Database metrics ──────────────────────────────────────────────────────

    /** DB query duration in milliseconds. Labels: operation (query/execute/returning), table_hint */
    val dbQueryDuration: Histogram = histogram(
        "api_db_query_duration_ms",
        "Database query duration in milliseconds",
        "operation",
    )

    /**
     * §5.4: `db_pool_wait_seconds`. Registered in the SHARED registry, not this one.
     *
     * The API's local Counter/Gauge/Histogram predate observability-kotlin and are still
     * what the rest of this file uses. New metrics go to the shared registry so the API
     * and the worker render them identically - in particular in seconds, where the local
     * histogram is in milliseconds. Both registries are rendered by MetricsRoutes.
     *
     * The remaining local metrics are a migration, not a design; see D35.
     */
    val dbPoolWaitSeconds = com.vectorbea.observability.metrics.secondsHistogram(
        "db_pool_wait_seconds", "Time waiting to acquire a pooled connection", "pool")

    // ── Redis metrics ─────────────────────────────────────────────────────────

    /** Redis command duration in milliseconds. Labels: command */
    val redisCommandDuration: Histogram = histogram(
        "api_redis_command_duration_ms",
        "Redis command duration in milliseconds",
        "command",
    )

    // ── Workflow queue (Redis Streams producer) ───────────────────────────────

    /** XADD writes to the workflow-runs stream. Labels: job_type */
    val redisStreamXadd: Counter = counter(
        "api_redis_stream_xadd_total",
        "Total XADD writes to the workflow run stream",
        "job_type",
    )

    /** Total bytes of queue message payloads written (sum). Labels: job_type */
    val redisStreamPayloadBytes: Counter = counter(
        "api_redis_stream_payload_bytes_total",
        "Total workflow queue message payload bytes written to Redis",
        "job_type",
    )

    /** Messages whose input was omitted from Redis because it exceeded the size guard. */
    val redisStreamInputOmitted: Counter = counter(
        "api_redis_stream_input_omitted_total",
        "Queue messages where oversized inputJson was omitted (worker loads it from DB)",
        "job_type",
    )

    /**
     * Enqueues by typed stream. Labels: execution_class, job_type.
     *
     * This is the producer half of the typed-queue contract, and the series to
     * compare against the worker's per-class consumption: a class whose enqueue
     * rate consistently exceeds its completion rate is a pool that needs slots,
     * and now that is visible without inferring it from an untyped backlog.
     */
    val enqueuedByClass: Counter = counter(
        "api_runs_enqueued_by_class_total",
        "Runs enqueued, by execution class and job type",
        "execution_class", "job_type",
    )

    // ── Workflow run state gauges ─────────────────────────────────────────────

    /** Runs currently in 'queued' state (approximate point-in-time). */
    val workflowRunsQueued: Gauge = gauge(
        "api_workflow_runs_queued",
        "Number of workflow runs currently queued",
    )

    /** Runs currently in 'running' state (approximate point-in-time). */
    val workflowRunsRunning: Gauge = gauge(
        "api_workflow_runs_running",
        "Number of workflow runs currently running",
    )

    // ── Workflow run outcome counters ─────────────────────────────────────────

    /** Runs that completed with status 'succeeded'. */
    val workflowRunsSucceeded: Counter = counter(
        "api_workflow_runs_succeeded_total",
        "Total workflow runs that succeeded",
    )

    /** Runs that completed with status 'failed'. */
    val workflowRunsFailed: Counter = counter(
        "api_workflow_runs_failed_total",
        "Total workflow runs that failed",
    )

    // ── Connector / tool metrics ──────────────────────────────────────────────

    /** LLM call latency recorded by the API connection-test path. Labels: provider */
    val llmCallDuration: Histogram = histogram(
        "api_llm_call_duration_ms",
        "LLM connection test duration in milliseconds",
        "provider",
    )

    /** HTTP tool call latency recorded during connection tests. Labels: method */
    val httpToolDuration: Histogram = histogram(
        "api_http_tool_duration_ms",
        "HTTP connector test duration in milliseconds",
        "method",
    )

    /** DB tool call latency recorded during connection tests. */
    val dbToolDuration: Histogram = histogram(
        "api_db_tool_duration_ms",
        "DB connector test duration in milliseconds",
    )

    /** Connector test or live call failures. Labels: connector_type */
    val connectorFailures: Counter = counter(
        "api_connector_failures_total",
        "Total connector failures (connection tests and live calls)",
        "connector_type",
    )

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns the status class string for an HTTP status code.
     * e.g. 200 → "2xx", 404 → "4xx", 500 → "5xx"
     */
    fun statusClass(status: Int): String = "${status / 100}xx"

    /**
     * Normalises a request path by replacing UUIDs, numeric IDs, and other
     * variable segments with placeholders so cardinality stays bounded.
     *
     * Examples:
     *   /api/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890 → /api/runs/:id
     *   /api/workspaces/42/agents                       → /api/workspaces/:id/agents
     *   /api/runs/abc123/events                         → /api/runs/:id/events
     */
    fun normalisePath(path: String): String {
        return path
            // UUID
            .replace(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", RegexOption.IGNORE_CASE), ":id")
            // Pure numeric IDs
            .replace(Regex("/\\d+(?=/|$)"), "/:id")
            // Short hex IDs (16+ chars)
            .replace(Regex("/[0-9a-f]{16,}(?=/|$)", RegexOption.IGNORE_CASE), "/:id")
    }
}
