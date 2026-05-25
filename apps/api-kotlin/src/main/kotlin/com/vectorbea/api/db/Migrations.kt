package com.vectorbea.api.db

import org.flywaydb.core.Flyway
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * Flyway-based schema migration runner.
 *
 * Migration SQL files live in `src/main/resources/db/migration/`
 * and are versioned as V001__description.sql, V002__description.sql, etc.
 *
 * Controlled by the `RUN_MIGRATIONS` environment variable:
 *   RUN_MIGRATIONS=true  → runs all pending migrations on startup
 *   RUN_MIGRATIONS=false → skips (use in read-only replicas or if migrations
 *                           are managed externally via CI/CD)
 *
 * In production, migrations should be run separately (e.g., as a one-off job)
 * before rolling out new API instances.  Setting RUN_MIGRATIONS=true is
 * convenient for development and staging.
 */
object Migrations {
    private val log = LoggerFactory.getLogger(Migrations::class.java)

    /**
     * Runs pending Flyway migrations against [dataSource].
     * Logs how many migrations were applied.
     * Throws on failure — startup is aborted if migrations can't complete.
     */
    fun run(dataSource: DataSource) {
        log.info("[migrations] scanning for pending migrations...")

        val flyway = Flyway.configure()
            .dataSource(dataSource)
            // Migration SQL lives in resources/db/migration/
            .locations("classpath:db/migration")
            // Flyway stores its version table in the public schema
            .table("flyway_schema_history")
            // Fail if migrations are out of order (detects regressions)
            .outOfOrder(false)
            // Validate applied migrations against classpath (detects drift)
            .validateOnMigrate(true)
            // Baseline on migrate if the schema already has tables (useful
            // when taking over an existing DB without Flyway history)
            .baselineOnMigrate(false)
            .load()

        val result = flyway.migrate()

        if (result.migrationsExecuted == 0) {
            log.info("[migrations] schema is up-to-date (no migrations needed)")
        } else {
            log.info("[migrations] applied ${result.migrationsExecuted} migration(s)")
            result.migrations.forEach { m ->
                log.info("[migrations]   ✓ ${m.version} — ${m.description} (${m.executionTime}ms)")
            }
        }
    }

    /**
     * Validates that the current schema matches the migration history.
     * Call this in development or CI to detect schema drift without applying changes.
     */
    fun validate(dataSource: DataSource) {
        log.info("[migrations] validating schema...")
        Flyway.configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .table("flyway_schema_history")
            .load()
            .validate()
        log.info("[migrations] schema validation passed")
    }
}
