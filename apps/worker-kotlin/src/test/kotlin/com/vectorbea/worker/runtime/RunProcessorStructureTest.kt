package com.vectorbea.worker.runtime

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The terminal path must not call out while holding a pooled connection.
 *
 * ── WHY A SOURCE-LEVEL TEST, AND WHY IT IS THE RIGHT SHAPE HERE ─────────────
 * `TerminalCompletionPoolTest` proves the sequence is safe to run at concurrency,
 * and measures that nothing nests. What neither of its assertions can see is the
 * one edit that reintroduces the bug: moving `onTerminalTransition(...)` back
 * inside `updateRunCompleted`'s `dataSource.connection.use { ... }` block.
 *
 * That edit is a two-line diff. It looks tidier than the current code — the CAS
 * result is right there, the call reads naturally beside it — and it passes every
 * behavioural test in the suite, because they all terminalise one run at a time
 * against a pool with room to spare. It only fails in production, at a burst,
 * with no error message that names the cause.
 *
 * Same reasoning as `MigrationFunctionCallersTest` next door: when the defect
 * lives in the RELATIONSHIP between two pieces of code rather than in either one,
 * a structural check over the source is the thing that catches it. The comment
 * explaining why the call sits outside the block is not enforcement; this is.
 *
 * ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────────
 * This is a brace-counting check over one function in one file. It is not a
 * general "no nested connections" rule for the codebase, and it will not notice a
 * nested acquisition reached through a helper that is itself called from inside a
 * `use`. It guards the specific edit that this specific incident was, which is
 * what a regression test is for.
 */
class RunProcessorStructureTest {

    private fun repoRoot(): File {
        var d: File? = File("").absoluteFile
        while (d != null) {
            if (File(d, "apps/worker-kotlin/src/main/kotlin").isDirectory) return d
            d = d.parentFile
        }
        error("could not find the repo root from ${File("").absolutePath}")
    }

    private fun source(): String =
        File(repoRoot(),
            "apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/RunProcessor.kt")
            .also { assertTrue(it.isFile, "RunProcessor.kt not found at ${it.path}") }
            .readText()

    /**
     * Character ranges covered by a `dataSource.connection.use { ... }` block.
     *
     * Braces are counted with string and comment literals removed first. Without
     * that, a `{` inside a SQL string or a KDoc example shifts every subsequent
     * range and the check silently starts reporting on the wrong region of the
     * file — a structural test that has quietly stopped testing anything is worse
     * than no test, because it still reports a pass.
     */
    private fun connectionUseRanges(src: String): List<IntRange> {
        val stripped = stripLiteralsAndComments(src)
        val out = mutableListOf<IntRange>()
        Regex("""dataSource\.connection\.use\s*\{""").findAll(stripped).forEach { m ->
            var depth = 0
            var i = m.range.last          // the opening brace
            while (i < stripped.length) {
                when (stripped[i]) {
                    '{' -> depth++
                    '}' -> { depth--; if (depth == 0) { out += m.range.first..i; break } }
                }
                i++
            }
        }
        return out
    }

    /**
     * Blank out string literals and comments, preserving every character offset.
     *
     * Offsets have to survive so a range computed here still indexes the original
     * source; replacing rather than deleting is what keeps the two in step.
     */
    private fun stripLiteralsAndComments(src: String): String {
        val b = StringBuilder(src)
        var i = 0
        fun blankTo(end: Int) { while (i < end && i < b.length) { if (b[i] != '\n') b[i] = ' '; i++ } }
        while (i < b.length) {
            when {
                b.startsWith("\"\"\"", i) -> {
                    val end = b.indexOf("\"\"\"", i + 3).let { if (it < 0) b.length else it + 3 }
                    blankTo(end)
                }
                b[i] == '"' -> {
                    var j = i + 1
                    while (j < b.length && b[j] != '"') { if (b[j] == '\\') j++; j++ }
                    blankTo(minOf(j + 1, b.length))
                }
                b.startsWith("/*", i) -> {
                    val end = b.indexOf("*/", i + 2).let { if (it < 0) b.length else it + 2 }
                    blankTo(end)
                }
                b.startsWith("//", i) -> {
                    val end = b.indexOf("\n", i).let { if (it < 0) b.length else it }
                    blankTo(end)
                }
                else -> i++
            }
        }
        return b.toString()
    }

    @Test
    fun `onTerminalTransition is never called while a connection is held`() {
        val src = source()
        val stripped = stripLiteralsAndComments(src)

        val calls = Regex("""onTerminalTransition\s*\(""").findAll(stripped)
            .map { it.range.first }
            .filter { at ->
                /* The declaration is not a call site. */
                !stripped.substring(maxOf(0, at - 40), at).contains("fun ")
            }
            .toList()

        assertTrue(calls.isNotEmpty(),
            "no call to onTerminalTransition found in RunProcessor.kt — the terminal path " +
            "was renamed or removed, and this guard is now testing nothing. Re-point it at " +
            "whatever replaced it rather than deleting it.")

        val ranges = connectionUseRanges(src)
        assertTrue(ranges.isNotEmpty(),
            "no dataSource.connection.use block found — the brace scan is broken, not the code")

        calls.forEach { at ->
            val enclosing = ranges.firstOrNull { at in it }
            if (enclosing != null) {
                val line = src.take(at).count { it == '\n' } + 1
                fail(
                    "RunProcessor.kt:$line calls onTerminalTransition inside a " +
                    "dataSource.connection.use block.\n\n" +
                    "That reintroduces hold-and-wait: the post-terminal steps acquire " +
                    "connections of their own, so the thread holds one pooled connection " +
                    "while waiting for another. At P concurrently terminalising runs against " +
                    "a pool of P, every thread owns one and needs a second, and none can " +
                    "release — a fleet-wide stall whenever a burst of runs finishes " +
                    "together, with no error that names the cause.\n\n" +
                    "Call it after the `use` block returns, on the boolean the CAS produced. " +
                    "See TerminalCompletionPoolTest."
                )
            }
        }
    }

    /**
     * The CAS itself must stay inside the connection.
     *
     * The mirror of the test above, and worth stating: "release the connection
     * earlier" taken one step too far would move the UPDATE out of the block it
     * needs. The guard against a deadlock must not become a route to a broken
     * terminal transition.
     */
    @Test
    fun `the terminal CAS is still inside a connection block`() {
        val src = source()
        val stripped = stripLiteralsAndComments(src)
        /* The literal is blanked, so anchor on the statement that executes it. */
        val exec = stripped.indexOf("val updated = stmt.executeUpdate() > 0")
        assertTrue(exec > 0, "the terminal CAS statement was renamed — re-point this guard")
        assertTrue(connectionUseRanges(src).any { exec in it },
            "the terminal CAS is no longer inside a dataSource.connection.use block")
    }
}
