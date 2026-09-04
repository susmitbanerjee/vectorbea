package com.vectorbea.worker.confidence

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Confidence scoring and routing.
 *
 * The tests that matter most are about **absent signals**. Most nodes have no
 * logprobs, no self-consistency and no critic; if absence scored as zero, every
 * ordinary node would land in the gate band and reviewers would drown in decisions
 * the model got right. That failure would be invisible in a unit test that only
 * checked the happy path, so it is checked directly here.
 */
class ConfidenceScorerTest {

    private fun perfect() = ConfidenceScorer.Evidence(
        schemaValid = true,
        assertionsPassed = 4, assertionsTotal = 4,
        citationsVerified = 3, claimsMade = 3,
    )

    // ── Absent signals must not be scored as zero ───────────────────────────

    @Test
    fun `a node with only schema, assertions and citations scores at full scale`() {
        // No logprobs, no self-consistency, no critic — the common case. If their
        // weight were counted as zero this would score ~0.55 and be gated.
        val s = ConfidenceScorer.score(perfect())
        assertTrue(s.value >= 0.99,
            "an ordinary node with everything passing must score near 1.0, got ${s.value}")
        assertEquals(ConfidenceRouter.Action.COMMIT, ConfidenceRouter.route(s).action)
    }

    @Test
    fun `absent signals are marked not present and contribute nothing`() {
        val s = ConfidenceScorer.score(perfect())
        val logprob = s.components.first { it.name == ConfidenceScorer.LOGPROB }
        assertFalse(logprob.present)
        assertEquals(0.0, logprob.contribution)
        // …but the present ones still sum to the full score.
        assertEquals(s.value, s.components.sumOf { it.contribution }, 0.0001)
    }

    @Test
    fun `enabling an optional layer does not penalise a node that was already good`() {
        val without = ConfidenceScorer.score(perfect())
        val with = ConfidenceScorer.score(perfect().copy(criticVerdict = 1.0))
        assertTrue(with.value >= without.value - 0.0001,
            "turning on a passing critic must not lower the score: $without -> $with")
    }

    // ── The hard gate ───────────────────────────────────────────────────────

    @Test
    fun `invalid schema forces zero and reports as structural, not low confidence`() {
        val s = ConfidenceScorer.score(perfect().copy(schemaValid = false))
        assertEquals(0.0, s.value)
        assertTrue(s.hardGated)

        val d = ConfidenceRouter.route(s)
        assertEquals(ConfidenceRouter.Action.FAIL, d.action)
        // Must not be presented as "0% confidence" — that sends the user looking for
        // a prompt problem when the problem is structural.
        assertTrue(d.message.contains("did not match the declared schema"), d.message)
        assertFalse(d.message.contains("0% confidence"), d.message)
    }

    @Test
    fun `a hard gate is not averaged away by strong other signals`() {
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = false,
            assertionsPassed = 4, assertionsTotal = 4,
            citationsVerified = 3, claimsMade = 3,
            criticVerdict = 1.0,
        ))
        assertEquals(0.0, s.value, "strong signals must not rescue invalid structure")
    }

    // ── Routing bands ───────────────────────────────────────────────────────

    @Test
    fun `each band routes as section 6 specifies`() {
        fun at(v: Double) = ConfidenceRouter.route(
            ConfidenceScorer.Score(v, emptyList(), null, "test", hardGated = false))

        assertEquals(ConfidenceRouter.Action.COMMIT, at(0.95).action)
        assertEquals(ConfidenceRouter.Action.COMMIT, at(0.90).action)
        assertEquals(ConfidenceRouter.Action.COMMIT_FLAGGED, at(0.89).action)
        assertEquals(ConfidenceRouter.Action.COMMIT_FLAGGED, at(0.70).action)
        assertEquals(ConfidenceRouter.Action.GATE, at(0.69).action)
        assertEquals(ConfidenceRouter.Action.GATE, at(0.50).action)
        assertEquals(ConfidenceRouter.Action.FAIL, at(0.49).action)
    }

    @Test
    fun `only the gate band suspends`() {
        fun at(v: Double) = ConfidenceRouter.route(
            ConfidenceScorer.Score(v, emptyList(), null, "test", hardGated = false))

        // A run waiting at a gate must hold no worker slot. Everything else runs to
        // completion or fails, and suspending those would be pure overhead.
        assertFalse(at(0.95).suspends)
        assertFalse(at(0.80).suspends)
        assertTrue(at(0.60).suspends)
        assertFalse(at(0.20).suspends)
    }

    @Test
    fun `thresholds are configurable per node`() {
        val strict = ConfidenceRouter.Thresholds(commitAbove = 0.98, flagAbove = 0.90, gateAbove = 0.80)
        val s = ConfidenceScorer.Score(0.92, emptyList(), null, "t", hardGated = false)
        // 0.92 commits under the defaults; under a stricter policy the same output is
        // only good enough to commit-and-flag.
        assertEquals(ConfidenceRouter.Action.COMMIT, ConfidenceRouter.route(s).action)
        assertEquals(ConfidenceRouter.Action.COMMIT_FLAGGED, ConfidenceRouter.route(s, strict).action)

        // And a policy strict enough to gate it does exactly that - the same score
        // routes three different ways depending on how much the node is trusted.
        val paranoid = ConfidenceRouter.Thresholds(commitAbove = 0.99, flagAbove = 0.95, gateAbove = 0.80)
        assertEquals(ConfidenceRouter.Action.GATE, ConfidenceRouter.route(s, paranoid).action)
    }

    @Test
    fun `partial threshold config keeps the other defaults`() {
        val t = ConfidenceRouter.Thresholds.from(mapOf("gate" to 0.4))
        assertEquals(0.4, t.gateAbove)
        assertEquals(ConfidenceRouter.Thresholds.DEFAULT.commitAbove, t.commitAbove)
    }

    // ── The breakdown — "why 0.62?" ─────────────────────────────────────────

    @Test
    fun `the weakest signal is the one that cost most, not the lowest value`() {
        // Citations 0.5 at weight 0.30 costs 0.15; distribution 0.4 at weight 0.05
        // costs 0.02. The reviewer must be pointed at citations.
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 4, assertionsTotal = 4,
            citationsVerified = 1, claimsMade = 2,
            distributionalZScore = 2.4,
        ))
        assertNotNull(s.weakest)
        assertEquals(ConfidenceScorer.CITATIONS, s.weakest!!.name,
            "weakest must weigh impact, not raw value: ${s.components}")
    }

    @Test
    fun `the explanation names the specific failure, not the number`() {
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 1, assertionsTotal = 2,
            citationsVerified = 2, claimsMade = 2,
            failedAssertion = "score_matches_recommendation",
        ))
        assertTrue(s.explanation.contains("score_matches_recommendation"),
            "a reviewer needs the rule name, not a score: ${s.explanation}")
    }

    @Test
    fun `every component is stored so the score can be explained`() {
        val s = ConfidenceScorer.score(perfect().copy(
            selfConsistencyAgreement = 0.8, criticVerdict = 0.9))
        // All six soft signals appear, present or not — a breakdown that silently
        // omits absent signals cannot answer "why was logprob not used?".
        assertEquals(6, s.components.size)
        assertTrue(s.components.all { it.description.isNotBlank() })
    }

    // ── Component maths ─────────────────────────────────────────────────────

    @Test
    fun `fuzzy citations count at half weight`() {
        val allStrong = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true, citationsVerified = 2, claimsMade = 2))
        val halfFuzzy = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true, citationsVerified = 2, claimsMade = 2, citationsFuzzy = 2))
        assertTrue(halfFuzzy.value < allStrong.value,
            "fuzzy evidence is weaker and must score lower: $halfFuzzy vs $allStrong")
    }

    @Test
    fun `a node that legitimately found nothing is not punished`() {
        // claimsMade == 0 means the model correctly declined to answer. Scoring that
        // as zero citations would punish the honest "not present" answer Layer 2
        // exists to encourage.
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true, assertionsPassed = 2, assertionsTotal = 2,
            citationsVerified = 0, claimsMade = 0))
        assertTrue(s.value >= 0.99, "declining to answer must not lower confidence: ${s.value}")
        assertFalse(s.components.first { it.name == ConfidenceScorer.CITATIONS }.present)
    }

    @Test
    fun `no measurable signals reports honestly rather than guessing`() {
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(schemaValid = true))
        assertEquals(ConfidenceScorer.UNMEASURED, s.value)
        assertTrue(s.explanation.contains("No confidence signals"), s.explanation)
    }

    @Test
    fun `logprob certainty falls as the model hesitates`() {
        // ln(0.99) — near-certain. ln(0.5) — a coin flip.
        val certain = ConfidenceScorer.certaintyFromLogprobs(listOf(Math.log(0.99), Math.log(0.98)))!!
        val hesitant = ConfidenceScorer.certaintyFromLogprobs(listOf(Math.log(0.5), Math.log(0.45)))!!
        assertTrue(certain > hesitant, "certain=$certain hesitant=$hesitant")
        assertTrue(certain > 0.85 && hesitant < 0.35)
    }

    @Test
    fun `distributional distance is symmetric and curved`() {
        assertEquals(1.0, ConfidenceScorer.distributionMatch(0.0))
        assertEquals(
            ConfidenceScorer.distributionMatch(2.0),
            ConfidenceScorer.distributionMatch(-2.0),
            "unusually high and unusually low are equally worth noticing")
        assertTrue(ConfidenceScorer.distributionMatch(2.0) in 0.4..0.6)
        assertEquals(0.0, ConfidenceScorer.distributionMatch(8.0))
    }

    // ── The demo path ───────────────────────────────────────────────────────

    @Test
    fun `an unverified citation routes to a gate with an actionable explanation`() {
        // This is the scenario the demo walks through: the output is well-formed and
        // the rules hold, but one value could not be traced to the source. Not wrong
        // enough to fail, not safe enough to commit — exactly what a human should see.
        val s = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 2, assertionsTotal = 2,
            citationsVerified = 1, claimsMade = 3,
            unverifiedCitation = "account_owner",
        ))
        val d = ConfidenceRouter.route(s)

        assertEquals(ConfidenceRouter.Action.GATE, d.action,
            "score ${s.value} should land in the gate band")
        assertTrue(d.suspends, "a gated run must release its worker slot")
        assertTrue(d.message.contains("account_owner"),
            "the reviewer must be told which value is doubtful: ${d.message}")
    }

    @Test
    fun `a proven fabrication is scored harder than the same ratio of missing citations`() {
        // Both outputs cite 2 of 3 fields successfully. The difference is what happened
        // to the third: one model declined to cite it, the other cited text that is not
        // in the source. The second is evidence about the model, not a gap in the data.
        val declined = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 2, assertionsTotal = 2,
            citationsVerified = 2, claimsMade = 3,
        ))
        val invented = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 2, assertionsTotal = 2,
            citationsVerified = 2, claimsMade = 3,
            citationsFabricated = 1, unverifiedCitation = "support_contact",
        ))

        assertTrue(invented.value < declined.value,
            "a fabricated citation must score below a merely missing one: " +
                "invented=${invented.value} declined=${declined.value}")

        // And the penalty must be large enough to change the outcome, not just the
        // number. Found by running the demo: without it, an output containing a known
        // invention scored 0.82 and committed with a flag.
        assertEquals(ConfidenceRouter.Action.COMMIT_FLAGGED, ConfidenceRouter.route(declined).action)
        assertEquals(ConfidenceRouter.Action.GATE, ConfidenceRouter.route(invented).action,
            "an output with a proven invention belongs in front of a person")
        assertTrue(ConfidenceRouter.route(invented).suspends)
    }

    @Test
    fun `the fabrication penalty does not fire when every citation checks out`() {
        val clean = ConfidenceScorer.score(ConfidenceScorer.Evidence(
            schemaValid = true,
            assertionsPassed = 2, assertionsTotal = 2,
            citationsVerified = 3, claimsMade = 3,
        ))
        assertEquals(ConfidenceRouter.Action.COMMIT, ConfidenceRouter.route(clean).action)
    }
}
