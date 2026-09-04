package com.vectorbea.api.routes

import com.vectorbea.api.routes.BurndownReader.Ceiling
import com.vectorbea.api.routes.BurndownReader.Member
import com.vectorbea.api.routes.BurndownReader.Sample
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The burn-down's arithmetic.
 *
 * ── WHY THE RECONCILIATION IS THE TEST THAT MATTERS ─────────────────────────
 * A run's cost is written twice, by two paths, in two units: `run_spans.cost_cents`
 * in CENTS by the agent brain, and `agent_runs.estimated_cost` in USD summed from
 * `run_events`, which only the model-call executor writes. They are not derived
 * from each other.
 *
 * A chart that silently rescales one to match the other looks correct and hides a
 * real instrumentation gap. "The sum of the bands equals the run's total,
 * exactly" is only true if whatever does not fit is given a name.
 */
class BurndownReaderTest {

    private val T0 = Instant.parse("2026-08-31T10:00:00Z")

    private fun sample(activation: String?, atMs: Long, cost: Double, tokens: Long = 0, iters: Int = 0) =
        Sample(activation, T0.plusMillis(atMs), tokens, cost, iters)

    private val team = listOf(
        Member("sup", "supervisor", "supervisor", 0),
        Member("res", "researcher", "worker", 1),
    )

    // ── ACCEPTANCE: the bands sum to the total, exactly ──────────────────────

    /**
     * ACCEPTANCE: sum of bands equals the run's total cost, exactly.
     *
     * Exact means exact: cent arithmetic, no tolerance, and the run row's figure
     * converted from dollars once.
     */
    @Test
    fun `the bands sum to the run's recorded total, to the cent`() {
        val b = BurndownReader.build(
            samples = listOf(
                sample("sup", 0, 4.25),
                sample("res", 1_000, 18.50),
                sample("res", 2_000, 8.25),
            ),
            members = team,
            ceilings = emptyList(), markers = emptyList(),
            /* 31 cents, as the run row stores it: DOLLARS. */
            recordedTotalUsd = 0.31,
        )

        assertEquals(31.0, b.bands.sumOf { it.costCents })
        assertEquals(31.0, b.reconciliation.attributedCents)
        assertEquals(31.0, b.reconciliation.recordedTotalCents)
        assertEquals(0.0, b.reconciliation.unattributedCents)
        assertTrue(b.reconciliation.agrees)
        assertNull(b.reconciliation.note, "agreement has nothing to explain")
    }

    /**
     * When they disagree, the gap is NAMED rather than absorbed.
     *
     * This is the live case: the run row is summed from run events, which only
     * the model-call executor writes, while agent spend reaches spans by another
     * path. Rescaling the bands to match would draw a chart that adds up and
     * lies about where the money went.
     */
    @Test
    fun `a disagreement is reported, not rescaled`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 12.0)),
            members = team,
            ceilings = emptyList(), markers = emptyList(),
            recordedTotalUsd = 0.20,          // 20¢ recorded, 12¢ on spans
        )

        assertEquals(12.0, b.reconciliation.attributedCents, "the bands are untouched")
        assertEquals(8.0, b.reconciliation.unattributedCents)
        assertFalse(b.reconciliation.agrees)
        assertTrue(b.reconciliation.note!!.contains("more than the spans account for"))
    }

    /** And the other direction, which means the run row is the one missing spend. */
    @Test
    fun `spans exceeding the run row are explained the other way round`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 40.0)),
            members = team,
            ceilings = emptyList(), markers = emptyList(),
            recordedTotalUsd = 0.10,
        )
        assertTrue(b.reconciliation.unattributedCents < 0)
        assertTrue(b.reconciliation.note!!.contains("run events"),
            "the note must name which write path is short, not just that they differ")
    }

    /**
     * A span with no activation gets its OWN band, named.
     *
     * Dropping it would make the bands sum to less than the run and still look
     * correct — spend nobody can attribute is exactly what this view exists to
     * surface.
     */
    @Test
    fun `spend with no activation becomes a named band, not a silent omission`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 10.0), sample(null, 500, 5.0)),
            members = team,
            ceilings = emptyList(), markers = emptyList(),
            recordedTotalUsd = 0.15,
        )
        val orphan = b.bands.single { it.activationId == null }
        assertEquals("Unattributed", orphan.agentName)
        assertEquals(5.0, orphan.costCents)
        assertTrue(b.reconciliation.agrees, "it still adds up, because nothing was dropped")
    }

    /** An activation with no matching row is named by its id, never left blank. */
    @Test
    fun `an unknown activation is labelled by its id`() {
        val b = BurndownReader.build(
            samples = listOf(sample("deadbeef-1234", 0, 3.0)),
            members = emptyList(),
            ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = null,
        )
        assertEquals("agent deadbeef", b.bands.single().agentName)
    }

    // ── Bands ───────────────────────────────────────────────────────────────

    /** Each band is CUMULATIVE, which is what makes the stack readable. */
    @Test
    fun `a band accumulates over the run`() {
        val b = BurndownReader.build(
            samples = listOf(
                sample("res", 0, 2.0, tokens = 100),
                sample("res", 1_000, 3.0, tokens = 150),
                sample("res", 2_000, 5.0, tokens = 200),
            ),
            members = team, ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = null,
        )
        val pts = b.bands.single().points
        assertEquals(listOf(2.0, 5.0, 10.0), pts.map { it.costCents })
        assertEquals(listOf(100L, 250L, 450L), pts.map { it.tokens })
        /* Relative to the run's start, so two bands share one axis. */
        assertEquals(listOf(0L, 1_000L, 2_000L), pts.map { it.atMs })
    }

    /** Share of total, so the table can answer "who spent it" without arithmetic. */
    @Test
    fun `each band reports its share of the attributed total`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 25.0), sample("res", 0, 75.0)),
            members = team, ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = null,
        )
        assertEquals(0.25, b.bands.single { it.activationId == "sup" }.shareOfCost)
        assertEquals(0.75, b.bands.single { it.activationId == "res" }.shareOfCost)
        assertEquals(1.0, b.bands.sumOf { it.shareOfCost })
    }

    /** Supervisors sit under their children, so the stack reads in delegation order. */
    @Test
    fun `bands are ordered by depth`() {
        val b = BurndownReader.build(
            samples = listOf(sample("res", 0, 5.0), sample("sup", 0, 5.0)),
            members = team, ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = null,
        )
        assertEquals(listOf("supervisor", "researcher"), b.bands.map { it.agentName })
    }

    // ── ACCEPTANCE: the ceiling crossing ─────────────────────────────────────

    /**
     * ACCEPTANCE: a run that hit its ceiling shows the crossing point and names
     * the limit.
     *
     * The crossing is where the STACK passed the line, not where any one band
     * did — a run of two agents at 30¢ each crosses a 40¢ ceiling that neither
     * of them approached alone.
     */
    @Test
    fun `the crossing point is where the stack passed the line, not one band`() {
        val b = BurndownReader.build(
            samples = listOf(
                sample("sup", 0, 30.0),
                sample("res", 5_000, 30.0),
            ),
            members = team,
            ceilings = listOf(Ceiling("cost", 40.0, "team budget", null)),
            markers = emptyList(), recordedTotalUsd = null,
        )
        val c = b.ceilings.single()
        assertEquals(5_000L, c.crossedAtMs, "crossed when the second agent's spend landed")
        assertEquals("team budget", c.source, "the limit is named, not just drawn")
    }

    /** A ceiling that was never reached says so, rather than drawing a crossing. */
    @Test
    fun `an unreached ceiling has no crossing point`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 5.0)),
            members = team,
            ceilings = listOf(Ceiling("cost", 100.0, "workspace", null)),
            markers = emptyList(), recordedTotalUsd = null,
        )
        assertNull(b.ceilings.single().crossedAtMs)
    }

    /** Each dimension crosses on its own numbers. */
    @Test
    fun `a token ceiling is measured in tokens, not cost`() {
        val b = BurndownReader.build(
            samples = listOf(
                sample("sup", 0, 1.0, tokens = 4_000),
                sample("sup", 1_000, 1.0, tokens = 4_000),
            ),
            members = team,
            ceilings = listOf(
                Ceiling("tokens", 6_000.0, "team budget", null),
                Ceiling("cost", 100.0, "workspace", null),
            ),
            markers = emptyList(), recordedTotalUsd = null,
        )
        assertEquals(1_000L, b.ceilings.single { it.dimension == "tokens" }.crossedAtMs)
        assertNull(b.ceilings.single { it.dimension == "cost" }.crossedAtMs)
    }

    // ── Degenerate inputs ───────────────────────────────────────────────────

    /**
     * ACCEPTANCE: a single-agent run degrades to one band and is still useful.
     *
     * "Why did this cost 31 cents" has an answer either way.
     */
    @Test
    fun `a single-agent run is one band`() {
        val b = BurndownReader.build(
            samples = listOf(sample("solo", 0, 12.0), sample("solo", 900, 19.0)),
            members = listOf(Member("solo", "triage", "worker", 0)),
            ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = 0.31,
        )
        assertEquals(1, b.bands.size)
        assertEquals("triage", b.bands.single().agentName)
        assertEquals(31.0, b.bands.single().costCents)
        assertTrue(b.reconciliation.agrees)
    }

    /**
     * A run that recorded a cost but metered no spans is NOT silently empty.
     *
     * That is the shape of a run whose spans were dropped, and an empty chart
     * beside a non-zero total is the most confusing possible rendering.
     */
    @Test
    fun `a cost with no spans is reported as entirely unattributed`() {
        val b = BurndownReader.build(
            samples = emptyList(), members = team,
            ceilings = emptyList(), markers = emptyList(), recordedTotalUsd = 0.31,
        )
        assertTrue(b.bands.isEmpty())
        assertEquals(31.0, b.reconciliation.unattributedCents)
        assertFalse(b.reconciliation.agrees)
        assertNotNull(b.reconciliation.note)
    }

    /** A run with nothing at all agrees with itself and says nothing. */
    @Test
    fun `an empty run reports nothing rather than dividing by zero`() {
        val b = BurndownReader.build(
            emptyList(), emptyList(), emptyList(), emptyList(), null)
        assertTrue(b.reconciliation.agrees)
        assertEquals(0.0, b.reconciliation.attributedCents)
        assertNull(b.reconciliation.note)
    }

    /** Float noise below a hundredth of a cent is agreement, not a finding. */
    @Test
    fun `sub-cent float noise still agrees`() {
        val b = BurndownReader.build(
            samples = listOf(sample("sup", 0, 10.0), sample("res", 0, 20.0)),
            members = team, ceilings = emptyList(), markers = emptyList(),
            recordedTotalUsd = 0.30000001,
        )
        assertTrue(b.reconciliation.agrees)
    }
}
