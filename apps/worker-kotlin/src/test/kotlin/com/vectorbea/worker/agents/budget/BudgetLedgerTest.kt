package com.vectorbea.worker.agents.budget

import com.vectorbea.worker.runtime.budget.RunCeilings
import java.util.UUID
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The budget tree's three invariants, and the arithmetic that has to hold for
 * them to mean anything.
 *
 * ── WHY A PROPERTY TEST AND NOT ONLY EXAMPLES ───────────────────────────────
 * The failure this class prevents is quantitative, not structural: nothing
 * throws, nothing looks wrong, the run just costs four times what it was allowed
 * to. Hand-written examples catch the shapes you thought of. The shape that
 * actually overspends in production is a fan-out that allocates all eight
 * children before any of them consumes — which reads as obviously fine until you
 * write down the arithmetic.
 */
class BudgetLedgerTest {

    private fun v(iterations: Int = 0, toolCalls: Int = 0, tokens: Long = 0, cents: Double = 0.0) =
        BudgetVector(iterations, toolCalls, tokens, BudgetVector.ofCents(cents))

    /** No completion margin, so the arithmetic in these cases is the plain kind. */
    private fun ledger(margin: Double = 0.0, ceilings: RunCeilings? = null) =
        BudgetLedger(ceilings, margin)

    // ═════════════════════════════════════════════════════════════════════════
    // Invariant 1 — a child never exceeds its parent's remaining
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a root allocation is granted in full`() {
        val l = ledger()
        val root = UUID.randomUUID()
        val a = l.allocate(root, null, v(iterations = 10, tokens = 1000, cents = 50.0))

        assertFalse(a.clamped, "the root IS the ceiling — there is nothing above it to clamp against")
        assertEquals(v(iterations = 10, tokens = 1000, cents = 50.0), a.granted)
    }

    @Test
    fun `an over-request is clamped, not refused`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(iterations = 10, tokens = 1000, cents = 50.0))

        val a = l.allocate(child, root, v(iterations = 99, tokens = 9999, cents = 500.0))

        /* Clamped, not refused. A worker told it has less budget usually adapts —
           shorter answer, fewer tool calls. One refused outright fails, and takes
           the run with it. */
        assertTrue(a.clamped)
        assertEquals(v(iterations = 10, tokens = 1000, cents = 50.0), a.granted)
        assertEquals(listOf("iterations", "tokens", "costCents"), a.clampedDimensions)
    }

    @Test
    fun `a leaf three levels down is clamped by the root, and the clamp is a span attribute`() {
        val l = ledger()
        val root = UUID.randomUUID(); val mid = UUID.randomUUID(); val leaf = UUID.randomUUID()

        l.allocate(root, null, v(iterations = 12, tokens = 900, cents = 30.0))
        l.allocate(mid, root, v(iterations = 6, tokens = 400, cents = 10.0))

        /* The leaf asks for more than the WHOLE ROOT has, let alone its parent. */
        val a = l.allocate(leaf, mid, v(iterations = 100, tokens = 100_000, cents = 999.0))

        assertTrue(a.clamped)
        assertEquals(6, a.granted.iterations, "bounded by the parent, which is bounded by the root")
        assertEquals(400L, a.granted.tokens)
        assertEquals(10.0, a.granted.costCents, 1e-9)

        /* The clamp has to be VISIBLE. An agent that produced a thin answer because
           it was handed a fraction of what it asked for looks, in the trace, in the
           events and in the output, exactly like an agent that is bad at its job. */
        val attrs = l.spanAttributes(leaf)
        assertEquals(true, attrs["budget_clamped"])
        @Suppress("UNCHECKED_CAST")
        val dims = attrs["budget_clamped_dimensions"] as List<String>
        assertContains(dims, "tokens")
        assertContains(dims, "costCents")
        assertContains(dims, "iterations")
    }

    @Test
    fun `an under-request is granted untouched and records no clamp`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 50.0))

        val a = l.allocate(child, root, v(tokens = 100, cents = 5.0))
        assertFalse(a.clamped)
        assertEquals(false, l.spanAttributes(child)["budget_clamped"])
    }

    @Test
    fun `siblings allocated before anyone consumes cannot together exceed the parent`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 100, cents = 10.0))

        /*
         * THE BUG THIS CATCHES, AND WHY INVARIANT 2 DOES NOT COVER IT.
         *
         * Propagating consumption upward is useless here: nothing has been
         * consumed yet. Eight children allocated back to back against a parent's
         * "remaining" all see the full 100 unless the allocation itself debits the
         * pool. That is what the reservation is for.
         */
        val grants = (1..8).map { l.allocate(UUID.randomUUID(), root, v(tokens = 100, cents = 10.0)) }

        assertEquals(100L, grants.sumOf { it.granted.tokens },
            "eight children were each handed the parent's whole budget")
        assertEquals(100L, grants.first().granted.tokens, "the first one takes it all")
        assertTrue(grants.drop(1).all { it.granted.tokens == 0L })
    }

    @Test
    fun `an unknown parent allocates nothing rather than everything`() {
        val l = ledger()
        val a = l.allocate(UUID.randomUUID(), UUID.randomUUID(), v(tokens = 1000, cents = 50.0))

        /* A tree that was not hydrated must fail closed. Granting the request in
           full would silently un-bound the whole subtree, which is the one
           direction a budget must never fail. */
        assertTrue(a.clamped)
        assertEquals(BudgetVector.ZERO, a.granted)
    }

    @Test
    fun `re-allocating an activation returns what it already has`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        val first = l.allocate(child, root, v(tokens = 400))
        val again = l.allocate(child, root, v(tokens = 400))

        assertEquals(first.granted, again.granted)
        /* A resumed tick re-derives the whole tree. A second allocation that
           debited the parent again would shrink the pool on every resume. */
        assertEquals(400L, l.remaining(root)!!.reservedToChildren.tokens)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Invariant 2 — consumption propagates upward, synchronously
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a leaf's spend debits every ancestor before consume returns`() {
        val l = ledger()
        val root = UUID.randomUUID(); val mid = UUID.randomUUID(); val leaf = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 100.0))
        l.allocate(mid, root, v(tokens = 500, cents = 50.0))
        l.allocate(leaf, mid, v(tokens = 200, cents = 20.0))

        l.consume(leaf, v(tokens = 60, cents = 6.0))

        assertEquals(60L, l.remaining(leaf)!!.consumedSubtree.tokens)
        assertEquals(60L, l.remaining(mid)!!.consumedSubtree.tokens)
        assertEquals(60L, l.remaining(root)!!.consumedSubtree.tokens,
            "the root has to know before the next sibling is allocated — deferring " +
            "this is exactly how a fan-out overspends")

        /* Only the leaf spent it. The ancestors carry a subtree total, not a
           self total, and confusing the two double-counts every level. */
        assertEquals(0L, l.remaining(mid)!!.consumedSelf.tokens)
        assertEquals(60L, l.remaining(leaf)!!.consumedSelf.tokens)
    }

    @Test
    fun `settling returns a cheap child's unspent budget to its parent`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        l.allocate(child, root, v(tokens = 800))
        l.consume(child, v(tokens = 50))

        assertEquals(200L, l.remaining(root)!!.availableToChildren.tokens,
            "before settling, the child holds its whole reservation")

        l.settle(child)

        assertEquals(950L, l.remaining(root)!!.availableToChildren.tokens,
            "a finished child that used a twentieth of its budget must not hold the " +
            "rest hostage for the remainder of the run")
    }

    @Test
    fun `settling twice does not credit the parent twice`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        l.allocate(child, root, v(tokens = 800))
        l.settle(child); l.settle(child)

        assertEquals(1000L, l.remaining(root)!!.availableToChildren.tokens)
    }

    @Test
    fun `a settled activation cannot delegate`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID(); val grandchild = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        l.allocate(child, root, v(tokens = 800))
        l.consume(child, v(tokens = 100))
        l.settle(child)

        /*
         * ── THE HOLE THE PROPERTY TEST FOUND, PINNED DOWN ──────────────────
         *
         * Settling handed back 700 of the child's 800, so the root's books now
         * say the child holds 100 — the amount it actually spent. Allocating a
         * grandchild under it after that would spend against the child's ORIGINAL
         * 800 a second time, invisibly to the root: nothing goes negative,
         * nothing throws, and the tree quietly costs more than it was allowed.
         *
         * It cannot happen through the intended sequence, because settling
         * follows a terminal activation and a terminal activation does not
         * delegate. That is precisely why it is enforced rather than assumed.
         */
        val g = l.allocate(grandchild, child, v(tokens = 500))
        assertEquals(BudgetVector.ZERO, g.granted)
        assertTrue(g.clamped)

        assertEquals(100L, l.remaining(root)!!.consumedSubtree.tokens)
        assertEquals(900L, l.remaining(root)!!.availableToChildren.tokens)
    }

    @Test
    fun `a late spend on a settled activation is re-debited to its parent`() {
        val l = ledger()
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        l.allocate(child, root, v(tokens = 800))
        l.consume(child, v(tokens = 100))
        l.settle(child)
        assertEquals(900L, l.remaining(root)!!.availableToChildren.tokens)

        /* A straggling tool result lands after the activation was settled. The
           parent must not go on believing it has budget that is already gone. */
        l.consume(child, v(tokens = 50))

        assertEquals(150L, l.remaining(root)!!.consumedSubtree.tokens)
        assertEquals(850L, l.remaining(root)!!.availableToChildren.tokens,
            "accounting must never lie in the direction of 'you have more than you do'")
    }

    @Test
    fun `spending past an allocation is reported`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 100))
        val r = l.consume(root, v(tokens = 150))

        /* Reported, not prevented: a model call that came back with more tokens
           than budgeted has already happened and already been paid for. The
           ledger's job is to say so, in time for the next allocation. */
        val over = assertIs<BudgetLedger.ConsumeResult.OverAllocation>(r)
        assertEquals(listOf("tokens"), over.dimensions)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Invariant 3 — run ceilings still win, and stay distinct
    // ═════════════════════════════════════════════════════════════════════════

    private fun ceilings(maxCostCents: Int = 0, maxTokens: Int = 0) = RunCeilings(
        maxSteps = 0, maxActiveMs = 0,
        maxCostCents = maxCostCents, maxTokens = maxTokens, maxNodePayloadBytes = 0,
    )

    @Test
    fun `a run ceiling is a CeilingExceeded, not a failure`() {
        val l = ledger(ceilings = ceilings(maxTokens = 500))
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 10_000))
        l.allocate(child, root, v(tokens = 10_000))

        assertIs<BudgetLedger.ConsumeResult.Ok>(l.consume(child, v(tokens = 100)))

        val r = l.consume(child, v(tokens = 600))
        val breach = assertIs<BudgetLedger.ConsumeResult.CeilingExceeded>(r).breach

        /* Nothing went wrong. A limit was reached, and the user has to be told
           WHICH — "your run failed" is a support ticket, "your run used its
           500-token limit" is an answer. */
        assertEquals("tokens", breach.dimension)
        assertEquals("token_limit_exceeded", breach.status)
        assertEquals(500L, breach.limit)
        assertTrue(breach.message.contains("500"))
    }

    @Test
    fun `the ceiling is checked against the whole tree, not one activation`() {
        val l = ledger(ceilings = ceilings(maxCostCents = 10))
        val root = UUID.randomUUID()
        l.allocate(root, null, v(cents = 1000.0))

        /* Twenty cheap leaves, none of which comes near the ceiling alone. */
        val leaves = (1..20).map { UUID.randomUUID() }
        leaves.forEach { l.allocate(it, root, v(cents = 50.0)) }

        var breached: RunCeilings.Breach? = null
        for (leaf in leaves) {
            val r = l.consume(leaf, v(cents = 1.0))
            if (r is BudgetLedger.ConsumeResult.CeilingExceeded) { breached = r.breach; break }
        }

        assertTrue(breached != null,
            "checking a leaf against a run ceiling lets a thousand cheap leaves pass " +
            "while the run blows through it")
        assertEquals("cost", breached.dimension)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Completion margin
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the margin is withheld from children and available to the parent`() {
        val l = ledger(margin = 0.10)
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 100.0))

        val snap = l.remaining(root)!!
        assertEquals(100L, snap.completionReserve.tokens)
        assertEquals(900L, snap.availableToChildren.tokens,
            "children may not have the reserve")
        assertEquals(1000L, snap.availableToSelf.tokens,
            "the parent may spend it — that is the entire point of holding it back")
    }

    @Test
    fun `a supervisor whose workers spent everything can still produce a partial final`() {
        val l = ledger(margin = 0.10)
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 100.0))

        /* One greedy worker asks for the lot. */
        val worker = UUID.randomUUID()
        val w = l.allocate(worker, root, v(tokens = 1000, cents = 100.0))
        assertEquals(900L, w.granted.tokens, "it cannot be given the reserve")

        l.consume(worker, w.granted)

        /* The supervisor is not dead. It has the margin, which is enough to write
           down what its worker found — a partial answer with a stated shortfall
           beats a failed run holding a complete set of results it cannot summarise. */
        assertEquals(100L, l.remaining(root)!!.availableToSelf.tokens)
    }

    @Test
    fun `the margin rounds up so a tiny budget still reserves something`() {
        val l = ledger(margin = 0.10)
        val root = UUID.randomUUID()
        l.allocate(root, null, v(iterations = 3, tokens = 5))

        val snap = l.remaining(root)!!
        assertEquals(1, snap.completionReserve.iterations,
            "rounding down would reserve zero on every small budget, which is every " +
            "budget that actually needs the reserve")
        assertEquals(1L, snap.completionReserve.tokens)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Preflight
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `an affordable fan-out is allowed`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 100.0))

        assertIs<BudgetLedger.FanOutVerdict.Affordable>(
            l.preflightFanOut(root, 4, v(tokens = 200, cents = 20.0)))
    }

    @Test
    fun `an unaffordable fan-out is refused before any child is created`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000, cents = 100.0))

        val verdict = l.preflightFanOut(root, 8, v(tokens = 200, cents = 20.0))
        val no = assertIs<BudgetLedger.FanOutVerdict.Unaffordable>(verdict)

        /* All or nothing. Half a fan-out is usually worth nothing — the pattern
           exists because the results are combined, and three of eight findings is
           not three-eighths of an answer. */
        assertEquals("tokens", no.dimension)
        assertEquals(5, no.affordableChildren,
            "telling the caller how many WOULD fit is what lets it narrow the plan " +
            "instead of failing")

        /* And nothing was spent. The parent's pool is exactly as it was. */
        assertEquals(1000L, l.remaining(root)!!.availableToChildren.tokens)
    }

    @Test
    fun `the tightest dimension decides affordability`() {
        val l = ledger()
        val root = UUID.randomUUID()
        /* Plenty of tokens, almost no money. */
        l.allocate(root, null, v(tokens = 1_000_000, cents = 3.0))

        val no = assertIs<BudgetLedger.FanOutVerdict.Unaffordable>(
            l.preflightFanOut(root, 4, v(tokens = 100, cents = 1.0)))
        assertEquals("costCents", no.dimension)
        assertEquals(3, no.affordableChildren)
    }

    @Test
    fun `preflight accounts for what siblings already hold`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))
        l.allocate(UUID.randomUUID(), root, v(tokens = 800))

        val no = assertIs<BudgetLedger.FanOutVerdict.Unaffordable>(
            l.preflightFanOut(root, 4, v(tokens = 100)))
        assertEquals(2, no.affordableChildren)
    }

    @Test
    fun `a fan-out wide enough to overflow is refused rather than wrapping`() {
        val l = ledger()
        val root = UUID.randomUUID()
        l.allocate(root, null, v(tokens = 1000))

        /* The width comes from a MODEL. An overflow that wraps negative makes the
           check pass, which is the one way a preflight is worse than none. */
        val no = assertIs<BudgetLedger.FanOutVerdict.Unaffordable>(
            l.preflightFanOut(root, Int.MAX_VALUE, v(tokens = 1000)))
        assertEquals(1, no.affordableChildren)
    }

    @Test
    fun `an unknown parent cannot fan out`() {
        val l = ledger()
        assertIs<BudgetLedger.FanOutVerdict.Unaffordable>(
            l.preflightFanOut(UUID.randomUUID(), 2, v(tokens = 1)))
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Hydration
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a rehydrated tree continues against the same pool`() {
        val root = UUID.randomUUID(); val child = UUID.randomUUID()

        val l = ledger()
        l.hydrate(listOf(
            BudgetLedger.HydratedActivation(root, null, v(tokens = 1000), v(tokens = 100), terminal = false),
            BudgetLedger.HydratedActivation(child, root, v(tokens = 400), v(tokens = 250), terminal = false),
        ))

        /* Subtree totals are DERIVED, never restored from a stored field — a stored
           total that disagrees with the sum of its parts is a budget that is wrong
           in a way nothing detects. */
        assertEquals(350L, l.remaining(root)!!.consumedSubtree.tokens)
        assertEquals(250L, l.remaining(child)!!.consumedSubtree.tokens)

        /* And the reservation survived, so the resumed run continues against the
           same pool rather than a fresh one. */
        assertEquals(500L, l.remaining(root)!!.availableToChildren.tokens)
    }

    @Test
    fun `hydration settles activations that already finished`() {
        val root = UUID.randomUUID(); val child = UUID.randomUUID()
        val l = ledger()
        l.hydrate(listOf(
            BudgetLedger.HydratedActivation(root, null, v(tokens = 1000), v(tokens = 0), terminal = false),
            BudgetLedger.HydratedActivation(child, root, v(tokens = 400), v(tokens = 40), terminal = true),
        ))

        assertEquals(960L, l.remaining(root)!!.availableToChildren.tokens,
            "a child that finished cheaply before the resume must not still be " +
            "holding its whole allocation afterwards")
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The property: a tree can never spend more than its root was given
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `total consumption across a randomised tree never exceeds the root allocation`() {
        /* Fixed seed: a property test that fails once a fortnight on CI and passes
           when you rerun it is worse than no test, because it teaches people to
           rerun. The seed is part of the assertion — change it deliberately, and
           note what it found. */
        val rng = Random(20260830)

        repeat(300) { trial ->
            val margin = listOf(0.0, 0.10, 0.25).random(rng)
            val l = BudgetLedger(null, margin)

            val root = UUID.randomUUID()
            val rootBudget = v(
                iterations = rng.nextInt(1, 50),
                toolCalls = rng.nextInt(1, 50),
                tokens = rng.nextLong(1, 100_000),
                cents = rng.nextInt(1, 10_000) / 100.0,
            )
            l.allocate(root, null, rootBudget)

            val all = mutableListOf(root)
            val consumed = mutableMapOf<UUID, BudgetVector>()

            repeat(rng.nextInt(1, 40)) {
                val parent = all.random(rng)
                val id = UUID.randomUUID()

                /* Ask for something arbitrary, frequently far more than exists —
                   the clamp is what has to hold, not the caller's restraint. */
                val granted = l.allocate(id, parent, v(
                    iterations = rng.nextInt(0, 60),
                    toolCalls = rng.nextInt(0, 60),
                    tokens = rng.nextLong(0, 120_000),
                    cents = rng.nextInt(0, 12_000) / 100.0,
                )).granted
                all += id

                /* Every activation stays inside its OWN allocation, which is what
                   AgentBudget enforces in the loop. The question this test asks is
                   whether that local discipline adds up to a global bound. */
                fun part(v: Long) = if (v <= 0) 0L else rng.nextLong(0, v + 1)
                val spend = BudgetVector(
                    iterations = if (granted.iterations <= 0) 0 else rng.nextInt(0, granted.iterations + 1),
                    toolCalls = if (granted.toolCalls <= 0) 0 else rng.nextInt(0, granted.toolCalls + 1),
                    tokens = part(granted.tokens),
                    costMicroCents = part(granted.costMicroCents),
                )
                l.consume(id, spend)
                consumed[id] = spend

                if (rng.nextBoolean()) l.settle(id)
            }

            val rootSnap = l.remaining(root)!!
            val summed = consumed.values.fold(BudgetVector.ZERO) { a, b -> a + b }

            assertEquals(summed, rootSnap.consumedSubtree,
                "trial $trial: the root's subtree total must equal the sum of every " +
                "activation's own spend — a propagation that misses a path is a " +
                "budget that under-reports")

            assertTrue(summed.tokens <= rootBudget.tokens,
                "trial $trial: tree spent ${summed.tokens} tokens of ${rootBudget.tokens}")
            assertTrue(summed.costMicroCents <= rootBudget.costMicroCents,
                "trial $trial: tree spent ${summed.costCents} cents of ${rootBudget.costCents}")
            assertTrue(summed.iterations <= rootBudget.iterations, "trial $trial: iterations")
            assertTrue(summed.toolCalls <= rootBudget.toolCalls, "trial $trial: toolCalls")
        }
    }
}
