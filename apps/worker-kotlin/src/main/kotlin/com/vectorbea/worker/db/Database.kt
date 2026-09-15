package com.vectorbea.worker.db

import com.vectorbea.worker.config.OutboundTimeouts
import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.logging.logger
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.sql.Connection
import javax.sql.DataSource

/**
 * HikariCP Postgres connection pool for the worker.
 *
 * SECURITY: DATABASE_URL is NEVER logged — only pool metadata is shown.
 *
 * Lifecycle:
 *   val db = Database.create(config)
 *   db.ping()         // verify connectivity on startup
 *   db.dataSource     // raw DataSource for all DB operations
 *   db.close()        // called in shutdown hook
 */
class Database private constructor(
    /**
     * The Hikari pool itself. Only `close()` needs it; everything else takes
     * [dataSource], which is the metered wrapper.
     */
    private val pool: HikariDataSource,
) {
    /**
     * The DataSource every caller uses, wrapped so `db_pool_wait_seconds` sees every
     * connection acquisition rather than the subset someone remembered to instrument.
     */
    val dataSource: javax.sql.DataSource = com.vectorbea.observability.db.TimedDataSource(
        pool, "platform") { s, p -> com.vectorbea.worker.metrics.WorkerMetrics.dbPoolWaitSeconds.observeSeconds(s, p) }


    private val log = logger()

    /**
     * Verifies connectivity by running SELECT 1.
     * Returns round-trip latency in milliseconds, or throws on failure.
     */
    fun ping(): Long {
        val start = System.currentTimeMillis()
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT 1").use { it.executeQuery() }
        }
        return System.currentTimeMillis() - start
    }

    fun close() {
        pool.close()
        log.info("[db] connection pool closed")
    }

    companion object {
        private val log = logger("com.vectorbea.worker.db.Database")

        fun create(config: WorkerConfig, timeouts: OutboundTimeouts = OutboundTimeouts.fromEnv()): Database {
            log.info("[db] initialising HikariCP pool (maxPoolSize={})", config.dbMaxPoolSize)

            // Determine JDBC URL: postgres:// → jdbc:postgresql://
            val rawUrl = when {
                config.dbUrl.startsWith("jdbc:") -> config.dbUrl
                config.dbUrl.startsWith("postgresql://") ->
                    "jdbc:postgresql://" + config.dbUrl.removePrefix("postgresql://")
                config.dbUrl.startsWith("postgres://") ->
                    "jdbc:postgresql://" + config.dbUrl.removePrefix("postgres://")
                else -> config.dbUrl
            }

            // The platform DB is managed, but it is still reached over the network.
            // Every worker thread touches it (status transitions, run_events, lease
            // renewal), so an unbounded read here stalls the whole process — the
            // same failure mode as a hung tenant DB, with a wider blast radius.
            val jdbcUrl = JdbcTimeouts.applyTo(rawUrl, "postgresql", timeouts)

            val hk = HikariConfig().apply {
                // jdbcUrl is the secret — not logged by HikariCP when set via property
                this.jdbcUrl = jdbcUrl
                driverClassName = "org.postgresql.Driver"
                poolName = "vectorbea-worker"
                maximumPoolSize = config.dbMaxPoolSize
                keepaliveTime = timeouts.platformPoolKeepaliveMs
                // connectionTestQuery is intentionally unset — see JdbcTimeouts.applyPoolBounds.
            }
            JdbcTimeouts.applyPoolBounds(
                cfg = hk,
                t = timeouts,
                connectionTimeoutMs = config.dbConnectionTimeoutMs,
                idleTimeoutMs = 600_000L,
                maxLifetimeMs = 1_800_000L,
                validationTimeoutMs = timeouts.platformPoolValidationTimeoutMs,
                leakDetectionMs = 60_000L,
            )

            val ds = HikariDataSource(hk)
            log.info(
                "[db] HikariCP pool ready — driver: {} | hikari: connectionTimeout={}ms validationTimeout={}ms " +
                    "keepalive={}ms maxLifetime={}ms leakDetection={}ms",
                JdbcTimeouts.paramsFor("postgresql", timeouts).entries.joinToString(" ") { (k, v) -> "$k=$v" },
                config.dbConnectionTimeoutMs, hk.validationTimeout,
                timeouts.platformPoolKeepaliveMs, 1_800_000L, 60_000L,
            )
            return Database(ds)
        }

        /**
         * The runtime tables that do not exist yet, by `to_regclass` — a lookup that
         * needs no privilege beyond connecting, so it answers before any DDL is tried.
         */
        fun missingRuntimeTables(ds: DataSource): List<String> =
            ds.connection.use { conn ->
                RUNTIME_TABLES.filter { table ->
                    conn.prepareStatement("SELECT to_regclass(?) IS NULL").use { st ->
                        st.setString(1, table)
                        st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
                    }
                }
            }

        private val RUNTIME_TABLES = listOf("workers", "run_approvals", "step_outputs", "connection_secrets")

        /**
         * Ensure the `step_outputs` table exists (idempotent).
         * Stores raw/extracted/validated output tiers for each node execution.
         */
        fun ensureStepOutputsTable(ds: DataSource) {
            ds.connection.use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.execute("""
                        CREATE TABLE IF NOT EXISTS step_outputs (
                            id                              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
                            run_id                          UUID        NOT NULL,
                            workspace_id                    UUID        NOT NULL,
                            environment_id                  UUID        NOT NULL,
                            node_id                         TEXT        NOT NULL,
                            node_type                       TEXT        NOT NULL,
                            raw_output_json_sanitized       JSONB,
                            extracted_output_json_sanitized JSONB,
                            validated_output_json_sanitized JSONB,
                            validation_errors_json          JSONB,
                            created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
                            updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
                            UNIQUE (run_id, node_id)
                        )
                    """.trimIndent())
                    stmt.execute("""
                        CREATE INDEX IF NOT EXISTS idx_step_outputs_run_id
                            ON step_outputs (run_id)
                    """.trimIndent())
                }
            }
        }

        /**
         * `run_checkpoints` is owned by Flyway. There is nothing to ensure.
         *
         * ── WHAT THIS USED TO DO, AND WHY IT WAS WORSE THAN NOTHING ───────
         * It ran `CREATE TABLE IF NOT EXISTS run_checkpoints (...)` with a shape
         * that differed from V001's — `workspace_id`, `environment_id`,
         * `node_id`, `snapshot_json` against `workflow_id`, `step_id`,
         * `state_json_sanitized`. `IF NOT EXISTS` made it a no-op in every
         * environment where Flyway had run, which is all of them, so the table
         * kept V001's shape while `CheckpointStore` wrote the other one.
         *
         * Every checkpoint write therefore threw, and
         * `WorkflowRuntime.writeCheckpoint` swallowed it into a warning — so
         * every parked run resumed by REPLAYING FROM ITS FIRST NODE, for as long
         * as the feature has existed, with nothing failing to say so.
         *
         * The lesson is the deletion, not the migration: a table with two
         * definitions has one that is never exercised, and it will be the one
         * the code was written against. V069 reconciled the schema; this is the
         * second definition going away so it cannot drift again.
         */
        @Deprecated(
            "run_checkpoints is a Flyway-managed table (V001, reconciled in V069). " +
                "This is a no-op kept only so a partially-deployed worker still starts.",
            level = DeprecationLevel.WARNING,
        )
        fun ensureCheckpointsTable(@Suppress("UNUSED_PARAMETER") ds: DataSource) {
            // Intentionally empty. See above.
        }

        /**
         * Ensure the `run_approvals` table exists (idempotent).
         * Called once at startup before the workflow runtime starts.
         */
        fun ensureApprovalsTable(ds: DataSource) {
            ds.connection.use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.execute("""
                        CREATE TABLE IF NOT EXISTS run_approvals (
                            id               UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
                            run_id           UUID        NOT NULL,
                            workspace_id     UUID        NOT NULL,
                            environment_id   UUID        NOT NULL,
                            node_id          TEXT        NOT NULL,
                            status           TEXT        NOT NULL DEFAULT 'PENDING',
                            message          TEXT,
                            metadata_json    JSONB,
                            resolved_by      TEXT,
                            resolved_at      TIMESTAMPTZ,
                            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                    """.trimIndent())
                    stmt.execute("""
                        CREATE INDEX IF NOT EXISTS idx_run_approvals_run_status
                            ON run_approvals (run_id, status)
                    """.trimIndent())
                }
            }
        }

        /**
         * Ensure the `connection_secrets` table exists (idempotent).
         * Used by [SecretService] for table-lookup secret refs.
         * Columns: ref (text PK), encrypted_value (text), created_at.
         */
        fun ensureConnectionSecretsTable(ds: DataSource) {
            ds.connection.use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.execute("""
                        CREATE TABLE IF NOT EXISTS connection_secrets (
                            ref             TEXT        NOT NULL PRIMARY KEY,
                            encrypted_value TEXT        NOT NULL,
                            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                    """.trimIndent())
                }
            }
        }

        /**
         * Ensure the `workers` table exists (idempotent).
         * Called once at startup before the heartbeat starts.
         * The table is also defined in V001 migration; this is a safety fallback.
         */
        fun ensureWorkersTable(ds: DataSource) {
            ds.connection.use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.execute("""
                        CREATE TABLE IF NOT EXISTS workers (
                            id                TEXT        NOT NULL PRIMARY KEY,
                            workspace_id      UUID,
                            environment_id    UUID,
                            name              TEXT        NOT NULL,
                            status            TEXT        NOT NULL DEFAULT 'idle',
                            queue             TEXT        NOT NULL,
                            capacity          INTEGER     NOT NULL DEFAULT 4,
                            active_tasks      INTEGER     NOT NULL DEFAULT 0,
                            last_heartbeat_at TIMESTAMPTZ,
                            version           TEXT,
                            region            TEXT,
                            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                    """.trimIndent())
                }
            }
        }
    }
}

/** Convenience: borrow a connection from the pool without a transaction. */
fun <T> DataSource.withConnection(block: (Connection) -> T): T = connection.use(block)
