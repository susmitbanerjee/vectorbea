package com.vectorbea.api.testsupport

import org.postgresql.ds.PGSimpleDataSource
import org.testcontainers.DockerClientFactory
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.utility.DockerImageName
import java.io.File
import javax.sql.DataSource

/**
 * The infrastructure an integration test is allowed to assume, and what happens
 * when it is missing.
 *
 * ── WHY THIS REPLACES `assumeTrue(reachable)` ───────────────────────────────
 * Every container-backed test in this repo used to open with
 * `assumeTrue(dataSourceOrNull() != null, "no database — skipping")`. On a
 * machine without Postgres that is a PASS. In CI, where nothing provisions
 * Postgres at all, the whole class was a pass, forever, silently.
 *
 * Five acceptance criteria accumulated behind that: real OTLP ingestion, the
 * Redis Lua parity check, worker-kill recovery, fan-out starvation, replay
 * fidelity. Nobody was ignoring failures — there were no failures to ignore.
 *
 * So this object does not return null and it does not skip. It either hands back
 * working infrastructure or it throws, and the test goes RED. A red test gets
 * fixed; a green one that never ran does not.
 *
 * ── THREE WAYS TO GET INFRASTRUCTURE, IN ORDER ──────────────────────────────
 *   1. An env var (`TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_OTLP_ENDPOINT`).
 *      This is how `docker compose up postgres redis` and CI `services:` supply
 *      it, and it matches how the repo already provisions local dev — the same
 *      images, the same credentials as `docker-compose.yml`.
 *   2. Testcontainers, which starts those same images itself.
 *   3. Nothing — and then a thrown exception that names what is missing and how
 *      to get it.
 *
 * ── A SECOND COPY, DELIBERATELY ─────────────────────────────────────────────
 * The worker has its own. Gradle test fixtures are not configured between
 * these modules, and the alternative — a shared module existing only to hold
 * this — is more build surface than the duplication costs. The repo already
 * vendors `RecoverySanitizer` across the same boundary for the same reason.
 * This copy carries only Postgres: no API test needs Redis or a collector.
 *
 * ── ONE SET OF CONTAINERS FOR THE WHOLE JVM ─────────────────────────────────
 * Started lazily on first use and never stopped: Testcontainers' Ryuk reaper
 * removes them when the JVM exits. A container per test class would add ~3s per
 * class and turn a two-minute suite into a twenty-minute one, which is how an
 * integration tier stops being run.
 */
object Infra {

    /** Same images the repo's `docker-compose.yml` uses, so local and CI agree. */
    private const val POSTGRES_IMAGE = "postgres:16-alpine"

    // ── Docker availability ───────────────────────────────────────────────────

    /**
     * Whether a Docker daemon is reachable, cached because the probe is slow.
     *
     * Only ever used to build a good error message. Nothing branches on it to
     * decide whether to run — that decision belongs to the Gradle tier.
     */
    private val dockerAvailable: Boolean by lazy {
        runCatching { DockerClientFactory.instance().isDockerAvailable }.getOrDefault(false)
    }

    private fun demand(what: String, envVar: String, compose: String, cause: Throwable? = null): Nothing =
        throw IllegalStateException(
        """
        Integration test needs $what and could not get it.

          • No $envVar is set, and
          • ${if (dockerAvailable) "Docker is running but the container failed to start."
             else "no Docker daemon is reachable."}
          • Cause: ${cause?.let { "${it::class.simpleName}: ${it.message}" } ?: "none reported"}

        Fix the environment, not the test. Either:
          docker compose up -d $compose
          export $envVar=...
        or start Docker and let Testcontainers do it.

        This is deliberately a FAILURE and not a skip: a skipped integration test
        reads as green, and that is how five unverified acceptance criteria
        accumulated in this repo.
        """.trimIndent(),
        cause,
    )

    // ── Postgres ──────────────────────────────────────────────────────────────

    private val pgContainer: PostgreSQLContainer<*>? by lazy {
        if (System.getenv("TEST_DATABASE_URL") != null) null
        else runCatching {
            PostgreSQLContainer(DockerImageName.parse(POSTGRES_IMAGE))
                .withDatabaseName("vectorbea")
                .withUsername("vectorbea")
                .withPassword("vectorbea")
                .also { it.start() }
        }.getOrElse { e -> demand("Postgres", "TEST_DATABASE_URL", "postgres", e) }
    }

    /** JDBC URL for a database with every migration applied. */
    val postgresUrl: String by lazy {
        val url = System.getenv("TEST_DATABASE_URL")
            ?: pgContainer!!.let {
                "${it.jdbcUrl}&user=${it.username}&password=${it.password}"
                    .replace("?loggerLevel=OFF&", "?")
            }
        migrate(url)
        url
    }

    val postgres: DataSource by lazy {
        PGSimpleDataSource().apply { setURL(postgresUrl); connectTimeout = 5; socketTimeout = 60 }
    }

    /**
     * Apply every Flyway migration, in order, once.
     *
     * Executed as whole files rather than split on `;`: several migrations define
     * functions whose `$$` bodies contain semicolons, and a naive splitter cuts
     * them in half. The JDBC driver runs a multi-statement string the way `psql
     * -f` does, which is what these files were written for.
     *
     * Flyway itself is not used because it is not a dependency of this module and
     * adding one to run 49 files in lexical order would be a poor trade. The
     * ordering rule is the file name, which is Flyway's rule too.
     *
     * ── WHY THERE IS A LEDGER AND NOT A "DOES agent_runs EXIST" CHECK ───────
     * That was the first attempt and it was wrong: "has a table" is not "is
     * migrated". A `docker compose` Postgres keeps a NAMED VOLUME, so the
     * database a developer gets is whatever schema they last left behind — here,
     * 66 tables stopping around V040. The check saw `agent_runs`, concluded the
     * work was done, and every test that needed a newer table failed with
     * "relation does not exist" pointing at the test rather than at the schema.
     *
     * `_test_migrations` is the same idea as `flyway_schema_history` and for the
     * same reason: the only reliable record of what has been applied is one that
     * lists what has been applied.
     */
    private fun migrate(url: String) {
        val files = migrationsDir()
            .listFiles { f: File -> f.name.matches(Regex("""^V\d+__.*\.sql$""")) }
            ?.sortedBy { it.name.substringBefore("__").removePrefix("V").toInt() }
            ?: error("no migrations found in ${migrationsDir()}")

        PGSimpleDataSource().apply { setURL(url); connectTimeout = 5; socketTimeout = 180 }
            .connection.use { c ->
                c.createStatement().use { st ->
                    st.execute(
                        "CREATE TABLE IF NOT EXISTS _test_migrations (" +
                        "  version INT PRIMARY KEY, name TEXT NOT NULL, " +
                        "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                    )
                }

                val applied = c.prepareStatement("SELECT version FROM _test_migrations")
                    .use { st -> st.executeQuery().use { rs ->
                        buildSet<Int> { while (rs.next()) add(rs.getInt(1)) } } }

                files.forEach { f ->
                    val version = f.name.substringBefore("__").removePrefix("V").toInt()
                    if (version in applied) return@forEach
                    c.createStatement().use { st ->
                        runCatching { st.execute(f.readText()) }.onFailure { e ->
                            error("migration ${f.name} failed against $url: ${e.message}")
                        }
                    }
                    c.prepareStatement(
                        "INSERT INTO _test_migrations (version, name) VALUES (?, ?) " +
                        "ON CONFLICT (version) DO NOTHING"
                    ).use { st -> st.setInt(1, version); st.setString(2, f.name); st.executeUpdate() }
                }
            }
    }

    /**
     * The migrations live in the API module; this is the worker's test.
     *
     * Walked up from the working directory rather than hard-coded as `../`,
     * because Gradle sets the test working directory to the module dir and an
     * IDE does not always agree.
     */
    private fun migrationsDir(): File {
        var d: File? = File("").absoluteFile
        while (d != null) {
            val candidate = File(d, "apps/api-kotlin/src/main/resources/db/migration")
            if (candidate.isDirectory) return candidate
            d = d.parentFile
        }
        error("could not find db/migration by walking up from ${File("").absolutePath}")
    }
}
