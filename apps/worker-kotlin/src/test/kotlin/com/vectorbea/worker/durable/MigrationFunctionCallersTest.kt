package com.vectorbea.worker.durable

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Every SQL function a migration defines must have a caller, or be listed here.
 *
 * ── WHY THIS IS A TEST AND NOT A CODE REVIEW HABIT ──────────────────────────
 * It has happened three times.
 *
 *   • V028 shipped `run_events_ensure_partition()` and
 *     `run_events_drop_expired_partitions()`. Nothing called either for months.
 *     `run_events` has no DEFAULT partition, so when the last pre-created month
 *     elapsed every event write in the system would have started failing —
 *     discovered by reading the migration, not by anything going red.
 *   • V046 shipped `run_event_seq_prune()` the same way, AND its table comment
 *     claimed the table was pruned. The claim was false the day it was written.
 *
 * Twice is a coincidence; three times is a pattern, and the pattern is that
 * writing a function feels like finishing the work. Nothing in review catches it
 * because the migration is self-consistent and the Kotlin is untouched — the
 * defect lives in the gap between two files nobody diffs together.
 *
 * So: parse every `CREATE FUNCTION` out of the migration directory, and demand a
 * Kotlin call site for each. The allowlist below is for functions genuinely
 * called only from SQL, and every entry has to say by what.
 */
class MigrationFunctionCallersTest {

    /**
     * Functions with no Kotlin caller, and the SQL that calls them instead.
     *
     * Adding a name here is a claim that something else invokes it. If that
     * claim is wrong the function is dead code, which is the same bug wearing a
     * different hat — so each entry names its caller and can be checked.
     */
    private val calledOnlyFromSql: Map<String, String> = mapOf(
        // Trigger functions are NOT listed here — they are derived, see
        // [triggerFunctions]. An allowlist entry is a human claim that can go
        // stale; `EXECUTE FUNCTION` in the migration is the fact itself.
        //
        // What remains is the genuinely dynamic case: PartitionMaintenance builds
        // these names by interpolating the table (`"${table}_ensure_partition"`),
        // so no substring search can find them.
        "run_events_ensure_partition" to "PartitionMaintenance builds the name dynamically",
        "run_spans_ensure_partition" to "PartitionMaintenance builds the name dynamically",
        "run_events_drop_expired_partitions" to "PartitionMaintenance builds the name dynamically",
        "run_spans_drop_expired_partitions" to "PartitionMaintenance builds the name dynamically",
        "run_events_default_partition_rows" to "PartitionMaintenance builds the name dynamically",
        "run_spans_default_partition_rows" to "PartitionMaintenance builds the name dynamically",
    )

    private fun repoRoot(): File {
        var d: File? = File("").absoluteFile
        while (d != null) {
            if (File(d, "apps/api-kotlin/src/main/resources/db/migration").isDirectory) return d
            d = d.parentFile
        }
        error("could not find the repo root from ${File("").absolutePath}")
    }

    /** `CREATE [OR REPLACE] FUNCTION name(` — the only shape these migrations use. */
    private val declaration = Regex(
        """CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(""",
        RegexOption.IGNORE_CASE,
    )

    /** `EXECUTE FUNCTION name(` / `EXECUTE PROCEDURE name(` — a trigger's caller. */
    private val triggerBinding = Regex(
        """EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(""",
        RegexOption.IGNORE_CASE,
    )

    /**
     * Functions a `CREATE TRIGGER` invokes, derived rather than listed.
     *
     * A trigger function has a caller — the trigger — and it is written in the
     * same file. Requiring a human to also write it in an allowlist would be
     * asking them to restate a fact the file already contains, and the restated
     * copy is the one that goes stale.
     */
    private fun triggerFunctions(root: File): Set<String> =
        migrationFiles(root)
            .flatMap { f -> triggerBinding.findAll(f.readText()).map { it.groupValues[1] } }
            .toSet()

    private fun migrationFiles(root: File): List<File> =
        File(root, "apps/api-kotlin/src/main/resources/db/migration")
            .listFiles { f: File -> f.name.endsWith(".sql") }.orEmpty().toList()

    private fun declaredFunctions(root: File): Set<String> =
        File(root, "apps/api-kotlin/src/main/resources/db/migration")
            .listFiles { f: File -> f.name.endsWith(".sql") }.orEmpty()
            .flatMap { f -> declaration.findAll(f.readText()).map { it.groupValues[1] } }
            .toSet()

    /**
     * Kotlin source of both services, as one string.
     *
     * A substring search, not a parse. `PartitionMaintenance` calls its functions
     * through an interpolated table name (`"SELECT ${table}_ensure_partition(...)"`)
     * so no parser would find them either — which is what the allowlist is for.
     */
    private fun kotlinSources(root: File): String =
        listOf("apps/worker-kotlin/src/main", "apps/api-kotlin/src/main")
            .map { File(root, it) }
            .filter { it.isDirectory }
            .flatMap { it.walkTopDown().filter { f -> f.extension == "kt" }.toList() }
            .joinToString("\n") { it.readText() }

    @Test
    fun `every function a migration defines has a caller`() {
        val root = repoRoot()
        val declared = declaredFunctions(root)
        assertTrue(declared.size > 5, "found only ${declared.size} functions — the parser is wrong")

        val kotlin = kotlinSources(root)
        val triggers = triggerFunctions(root)
        val orphans = declared
            .filter { it !in calledOnlyFromSql }
            .filter { it !in triggers }
            .filterNot { kotlin.contains(it) }

        assertTrue(orphans.isEmpty(), """
            |These SQL functions are defined by a migration and called by nothing:
            |
            |${orphans.sorted().joinToString("\n") { "  • $it" }}
            |
            |This has shipped three times (V028 twice, V046 once) and each time the
            |migration looked complete on its own. Either call it from Kotlin, or add
            |it to `calledOnlyFromSql` with the name of what actually invokes it. A
            |trigger function needs no entry — its CREATE TRIGGER is found automatically.
            |
            |An uncalled maintenance function is not inert: V028's uncalled
            |partition-creator would have stopped every event write in the system
            |the month its pre-created partitions ran out.
        """.trimMargin())
    }

    /**
     * The allowlist has to stay honest too.
     *
     * An entry for a function that no longer exists is a stale exemption, and the
     * next function to take that name inherits it silently.
     */
    @Test
    fun `the allowlist has no entries for functions that no longer exist`() {
        val declared = declaredFunctions(repoRoot())
        val stale = calledOnlyFromSql.keys.filterNot { it in declared }
        assertTrue(stale.isEmpty(),
            "allowlist exempts functions no migration defines: ${stale.sorted()}")
    }
}
