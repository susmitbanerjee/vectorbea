package com.vectorbee.api.db

import java.nio.charset.StandardCharsets
import java.sql.Connection

class SchemaMigrator(private val database: Database) {
    fun migrate() {
        database.transaction { connection ->
            ensureMigrationsTable(connection)
            lockMigrations(connection)
            try {
                val appliedMigrations = loadAppliedMigrations(connection)
                for (migration in MIGRATIONS) {
                    if (migration.filename in appliedMigrations) {
                        continue
                    }

                    executeMigration(connection, migration)
                    connection.prepareStatement(
                        """
                        insert into public.schema_migrations (filename)
                        values (?)
                        """.trimIndent()
                    ).use { statement ->
                        statement.setString(1, migration.filename)
                        statement.executeUpdate()
                    }
                    println("Applied database migration ${migration.filename}")
                }
            } finally {
                unlockMigrations(connection)
            }
        }
    }

    private fun ensureMigrationsTable(connection: Connection) {
        connection.createStatement().use { statement ->
            statement.execute(
                """
                create table if not exists public.schema_migrations (
                    filename text primary key,
                    applied_at timestamptz not null default now()
                )
                """.trimIndent()
            )
        }
    }

    private fun lockMigrations(connection: Connection) {
        connection.prepareStatement("select pg_advisory_lock(?)").use { statement ->
            statement.setLong(1, MIGRATION_LOCK_ID)
            statement.execute()
        }
    }

    private fun unlockMigrations(connection: Connection) {
        connection.prepareStatement("select pg_advisory_unlock(?)").use { statement ->
            statement.setLong(1, MIGRATION_LOCK_ID)
            statement.execute()
        }
    }

    private fun loadAppliedMigrations(connection: Connection): Set<String> =
        connection.prepareStatement(
            """
            select filename
            from public.schema_migrations
            """.trimIndent()
        ).use { statement ->
            statement.executeQuery().use { rs ->
                buildSet {
                    while (rs.next()) {
                        add(rs.getString("filename"))
                    }
                }
            }
        }

    private fun executeMigration(connection: Connection, migration: Migration) {
        val sql = javaClass.classLoader.getResourceAsStream(migration.resourcePath)?.use { input ->
            input.readBytes().toString(StandardCharsets.UTF_8)
        } ?: error("Missing migration resource: ${migration.resourcePath}")

        connection.createStatement().use { statement ->
            statement.execute(sql)
        }
    }

    private data class Migration(
        val filename: String,
        val resourcePath: String,
    )

    companion object {
        private const val MIGRATION_LOCK_ID = 541_220_041L

        private val MIGRATIONS = listOf(
            Migration(
                filename = "20260405_000001_mvp_schema.sql",
                resourcePath = "migrations/20260405_000001_mvp_schema.sql",
            ),
            Migration(
                filename = "20260405_000002_prompt_publish_status.sql",
                resourcePath = "migrations/20260405_000002_prompt_publish_status.sql",
            ),
            Migration(
                filename = "20260408_000001_audit_split_latency.sql",
                resourcePath = "migrations/20260408_000001_audit_split_latency.sql",
            ),
            Migration(
                filename = "20260408_000002_api_key_last_four.sql",
                resourcePath = "migrations/20260408_000002_api_key_last_four.sql",
            ),
            Migration(
                filename = "20260409_000001_api_key_name.sql",
                resourcePath = "migrations/20260409_000001_api_key_name.sql",
            ),
            Migration(
                filename = "20260409_000002_enterprise_hierarchy_rbac.sql",
                resourcePath = "migrations/20260409_000002_enterprise_hierarchy_rbac.sql",
            ),
            Migration(
                filename = "20260409_000003_api_key_role.sql",
                resourcePath = "migrations/20260409_000003_api_key_role.sql",
            ),
        )
    }
}
