package com.vectorbea.worker.agents.budget

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.budget.RunCeilings
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The budget of a TREE of agents, rather than of one agent at a time.
 *
 * ── THE ARITHMETIC THAT MOTIVATES IT ────────────────────────────────────────
 * A supervisor with `maxCostCents = 50` that spawns eight workers each with
 * `maxCostCents = 50` costs 450 cents, and nothing in a flat per-agent budget
 * says no — every individual agent stayed inside its limit. Flat budgets bound
 * an agent; they do not bound a subtree, and a subtree is what a team is.
 *
 * ── THE THREE INVARIANTS, AND WHERE EACH IS ENFORCED ────────────────────────
 *
 * 1. **A child's allocation never exceeds its parent's remaining.** [allocate]
 *    clamps rather than refuses, and records the clamp. A worker told it has
 *    less budget usually adapts — shorter answer, fewer tool calls; one refused
 *    outright fails, and takes the run with it.
 *
 * 2. **Consumption propagates upward synchronously.** [consume] debits every
 *    ancestor before it returns, so the next [allocate] sees the true remaining.
 *    Deferred accounting is exactly how a fan-out overspends: eight children are
 *    each allocated against a parent that has not yet been told about the first
 *    seven.
 *
 * 3. **Run ceilings still win.** [consume] checks them and returns
 *    [ConsumeResult.CeilingExceeded], which stays distinct from a failure. A
 *    ceiling breach is not something going wrong — it is a limit being reached,
 *    and the user needs to be told WHICH one.
 *
 * ── RESERVATION, NOT JUST ACCOUNTING ────────────────────────────────────────
 * The subtle half. Allocating a child DEBITS the parent's pool immediately, at
 * allocation time, before the child has spent anything. Without that, a fan-out
 * that allocates eight children before any of them runs sees the parent's full
 * remaining eight times and hands out 8× the budget — invariant 2 does not help,
 * because there is nothing to propagate yet. [settle] returns whatever a
 * finished child did not spend.
 *
 * ── DURABILITY ──────────────────────────────────────────────────────────────
 * In memory, per tick, and rebuilt by [hydrate] from `agent_activations`
 * (`budget_allocated_json` / `budget_consumed_json`). There is deliberately no
 * ledger table: the activation rows already are the durable record, and a second
 * one could disagree with them — which, for a limit, means either a run that
 * overspends or one that is refused budget it has.
 */
class BudgetLedger(
    private val ceilings: RunCeilings? = null,
    /**
     * The share of a parent's allocation held back for the parent itself.
     *
     * Workers that spend everything leave a supervisor unable to write down what
     * they found: the run dies at `BUDGET_EXCEEDED` holding a complete set of
     * results it cannot summarise. A partial answer with a stated shortfall is
     * worth more than a failed run, and this reserve is what buys it.
     *
     * It bounds only what may be given to CHILDREN. The parent may spend into it
     * — that is the entire point.
     */
    private val completionMarginFraction: Double = DEFAULT_COMPLETION_MARGIN,
) {
    private val log = logger()

    companion object {
        val DEFAULT_COMPLETION_MARGIN: Double =
            System.getenv("AGENT_COMPLETION_MARGIN")?.toDoubleOrNull()?.coerceIn(0.0, 0.9) ?: 0.10
    }

    // ── Results ──────────────────────────────────────────────────────────────

    data class BudgetAllocation(
        val activationId: UUID,
        /** What the caller asked for. */
        val requested: BudgetVector,
        /** What it actually got. Equal to [requested] when nothing was clamped. */
        val granted: BudgetVector,
        /** Dimensions reduced to fit the parent, named. Empty when unclamped. */
        val clampedDimensions: List<String>,
        /** The reserve withheld from this activation's own children. */
        val completionReserve: BudgetVector,
    ) {
        val clamped: Boolean get() = clampedDimensions.isNotEmpty()

        /**
         * What the activation span records.
         *
         * A clamp is the single most useful thing to see on a trace when a
         * subtree underperforms: an agent that produced a thin answer because it
         * was handed a tenth of what it asked for looks, in every other artefact,
         * exactly like an agent that is bad at its job.
         */
        fun spanAttributes(): Map<String, Any> = buildMap {
            put("budget_clamped", clamped)
            if (clamped) {
                put("budget_clamped_dimensions", clampedDimensions)
                put("budget_requested", requested.toMap())
                put("budget_granted", granted.toMap())
            }
        }
    }

    sealed class ConsumeResult {
        object Ok : ConsumeResult()

        /**
         * A RUN ceiling was reached. Distinct from a failure, and stays distinct
         * all the way to the terminal state: nothing went wrong, a limit was hit,
         * and the message names which.
         */
        data class CeilingExceeded(val breach: RunCeilings.Breach) : ConsumeResult()

        /** This activation has spent more than it was allocated. Reported, not enforced —
         *  a model call that returns more tokens than budgeted has already happened. */
        data class OverAllocation(val dimensions: List<String>) : ConsumeResult()
    }

    data class BudgetSnapshot(
        val allocated: BudgetVector,
        /** This activation's own spend, excluding its children. */
        val consumedSelf: BudgetVector,
        /** This activation and everything beneath it. */
        val consumedSubtree: BudgetVector,
        /** Currently held by unsettled children. */
        val reservedToChildren: BudgetVector,
        /** What this activation may still spend on itself, reserve included. */
        val availableToSelf: BudgetVector,
        /** What it may still hand to a child. Excludes the completion reserve. */
        val availableToChildren: BudgetVector,
        val completionReserve: BudgetVector,
    )

    /** The answer to "can this fan-out be afforded", before any child exists. */
    sealed class FanOutVerdict {
        object Affordable : FanOutVerdict()

        /**
         * Refused, with the reason and how many children WOULD fit.
         *
         * [affordableChildren] is not decoration. Discovering the ceiling after
         * three of eight children have run wastes the spend on all three; being
         * told "you can afford three" up front lets the caller narrow the fan-out
         * and get an answer, which is the outcome the whole check exists for.
         */
        data class Unaffordable(
            val dimension: String,
            val requested: BudgetVector,
            val available: BudgetVector,
            val affordableChildren: Int,
        ) : FanOutVerdict()
    }

    // ── State ────────────────────────────────────────────────────────────────

    private class Node(
        val id: UUID,
        val parent: UUID?,
        val allocated: BudgetVector,
        val completionReserve: BudgetVector,
    ) {
        var consumedSelf: BudgetVector = BudgetVector.ZERO
        var consumedSubtree: BudgetVector = BudgetVector.ZERO
        var reservedToChildren: BudgetVector = BudgetVector.ZERO
        var settled: Boolean = false
        var clampedDimensions: List<String> = emptyList()

        /**
         * What this node may still spend ON ITSELF.
         *
         * The reserve is NOT subtracted: it exists so the parent can finish, and
         * withholding it from the parent would mean nobody could ever spend it.
         */
        val availableToSelf: BudgetVector
            get() = allocated - consumedSelf - reservedToChildren

        /** What it may still hand to a child. The reserve IS subtracted. */
        val availableToChildren: BudgetVector
            get() = allocated - consumedSelf - reservedToChildren - completionReserve
    }

    private val nodes = ConcurrentHashMap<UUID, Node>()

    /**
     * One lock over the whole ledger.
     *
     * Allocation reads a parent's remaining and then writes it; consumption walks
     * a path to the root and writes every node on it. Both are multi-step, and
     * per-node locking would let a fan-out interleave two allocations against the
     * same parent's pre-read remaining — the exact overspend this class exists to
     * prevent. The critical sections are arithmetic over a handful of longs, and
     * one tick has one tree.
     */
    private val lock = Any()

    // ── Allocation ───────────────────────────────────────────────────────────

    /**
     * Give [activationId] a budget, clamped to what [parent] can still afford.
     *
     * A root allocation ([parent] null) is granted in full: it is the ceiling for
     * everything beneath it, and the run ceilings bound it from above.
     */
    fun allocate(
        activationId: UUID,
        parent: UUID?,
        request: BudgetVector,
    ): BudgetAllocation = synchronized(lock) {
        /* Re-allocating an existing activation returns what it already has. A
           resumed tick re-derives the whole tree, and a second allocation would
           debit the parent twice for one child. */
        nodes[activationId]?.let { existing ->
            return BudgetAllocation(
                activationId, request, existing.allocated,
                existing.clampedDimensions, existing.completionReserve)
        }

        val parentNode = parent?.let { nodes[it] }
        if (parent != null && parentNode == null) {
            /* An unknown parent means the tree was not hydrated. Granting the
               request in full here would silently un-bound the subtree, so it is
               treated as having nothing to give: the child is clamped to zero,
               which fails loudly and immediately rather than overspending. */
            log.warn("[budget] parent {} not in the ledger — allocating nothing to {}", parent, activationId)
            val node = Node(activationId, parent, BudgetVector.ZERO, BudgetVector.ZERO)
            node.clampedDimensions = BudgetVector.DIMENSIONS
            nodes[activationId] = node
            return BudgetAllocation(activationId, request, BudgetVector.ZERO,
                BudgetVector.DIMENSIONS, BudgetVector.ZERO)
        }

        /*
         * ── A SETTLED PARENT CANNOT DELEGATE, AND THE PROPERTY TEST FOUND IT ──
         *
         * [settle] hands a finished child's unspent reservation back, which means
         * the grandparent's books now say this node holds only what it actually
         * spent. Allocating a NEW child from it after that spends against its
         * original allocation a second time, invisibly to every ancestor — the
         * tree overspends and nothing anywhere is negative or throws.
         *
         * A randomised tree found this in the second trial. It cannot happen
         * through the intended call sequence, because settling follows a terminal
         * activation and a terminal activation does not delegate. That is exactly
         * why it has to be enforced here rather than assumed: the invariant this
         * class exists for must not depend on its caller being well behaved.
         */
        if (parentNode != null && parentNode.settled) {
            log.warn("[budget] activation {} is settled and cannot delegate to {}", parent, activationId)
            val node = Node(activationId, parent, BudgetVector.ZERO, BudgetVector.ZERO)
            node.clampedDimensions = BudgetVector.DIMENSIONS
            nodes[activationId] = node
            return BudgetAllocation(activationId, request, BudgetVector.ZERO,
                BudgetVector.DIMENSIONS, BudgetVector.ZERO)
        }

        val cap = parentNode?.availableToChildren
        val granted = if (cap == null) request else request.coerceAtMost(cap)
        val clamped = if (cap == null) emptyList() else request.dimensionsExceeding(cap)

        val node = Node(
            id = activationId,
            parent = parent,
            allocated = granted,
            completionReserve = granted.fraction(completionMarginFraction),
        )
        node.clampedDimensions = clamped
        nodes[activationId] = node

        /* THE RESERVATION. The parent's pool is debited NOW, not when the child
           spends. Without this, N children allocated before any of them runs each
           see the parent's full remaining. */
        parentNode?.let { it.reservedToChildren = it.reservedToChildren + granted }

        if (clamped.isNotEmpty()) {
            log.info("[budget] clamped {} for activation {} (parent {} could not afford it)",
                clamped, activationId, parent)
        }

        BudgetAllocation(activationId, request, granted, clamped, node.completionReserve)
    }

    /**
     * Return a finished activation's unspent reservation to its parent.
     *
     * Without it a cheap child holds its whole allocation hostage for the rest of
     * the run, and a supervisor that fanned out to eight workers who each used a
     * tenth of their budget is left unable to afford a ninth.
     */
    fun settle(activationId: UUID) = synchronized(lock) {
        val node = nodes[activationId] ?: return
        if (node.settled) return
        node.settled = true
        val parent = node.parent?.let { nodes[it] } ?: return
        val unspent = node.allocated - node.consumedSubtree
        parent.reservedToChildren = parent.reservedToChildren - unspent
    }

    // ── Consumption ──────────────────────────────────────────────────────────

    /**
     * Record spend, and debit every ancestor before returning.
     *
     * SYNCHRONOUS on purpose. The alternative — batching the propagation, or doing
     * it when the child completes — means the next sibling is allocated against a
     * parent that does not yet know what the previous one spent.
     */
    fun consume(activationId: UUID, usage: BudgetVector): ConsumeResult = synchronized(lock) {
        val node = nodes[activationId] ?: run {
            log.warn("[budget] consume for unknown activation {} — dropped", activationId)
            return ConsumeResult.Ok
        }

        node.consumedSelf = node.consumedSelf + usage

        /* Walk to the root. Depth-bounded by the delegation depth guard, and the
           visited set makes a cycle in the parent chain terminate rather than
           hang — a hang here would stall a worker thread. */
        var cursor: Node? = node
        val seen = HashSet<UUID>()
        var root: Node? = null
        while (cursor != null && seen.add(cursor.id)) {
            cursor.consumedSubtree = cursor.consumedSubtree + usage
            /*
             * A settled node's remaining reservation was reduced to exactly what
             * it had spent at the moment it settled. Spending more after that —
             * a late tool result, a straggling child — would leave the parent
             * believing it has budget that is already gone, so the parent is
             * re-debited by the same amount. Accounting must not lie in the
             * direction of "you have more than you do".
             */
            if (cursor.settled) {
                cursor.parent?.let { nodes[it] }?.let { p ->
                    p.reservedToChildren = p.reservedToChildren + usage
                }
            }
            root = cursor
            cursor = cursor.parent?.let { nodes[it] }
        }

        ceilingBreach(root)?.let { return ConsumeResult.CeilingExceeded(it) }

        val over = node.consumedSelf.dimensionsExceeding(node.allocated)
        if (over.isNotEmpty()) return ConsumeResult.OverAllocation(over)

        ConsumeResult.Ok
    }

    /**
     * The run ceiling check, against the ROOT's subtree total.
     *
     * The root's subtree is the whole run's agent spend, which is the quantity a
     * run ceiling is about. Checking a leaf against a run ceiling would let a
     * thousand cheap leaves pass while the run as a whole blew through it.
     *
     * Only the dimensions a ceiling actually covers are checked here — iterations
     * and tool calls are per-agent limits and are enforced by `AgentBudgetGuard`
     * inside the loop, where the agent can be told about them.
     */
    private fun ceilingBreach(root: Node?): RunCeilings.Breach? {
        val c = ceilings ?: return null
        val used = root?.consumedSubtree ?: return null

        val usedCents = Math.ceil(used.costCents).toLong()
        if (c.maxCostCents > 0 && usedCents >= c.maxCostCents) return RunCeilings.Breach(
            dimension = "cost",
            status = "cost_limit_exceeded",
            message = "This run reached its cost limit of ${c.maxCostCents} cents across its " +
                "agents. Raise the limit on your plan, or reduce how many agents this " +
                "workflow delegates to.",
            used = usedCents, limit = c.maxCostCents.toLong(),
        )
        if (c.maxTokens > 0 && used.tokens >= c.maxTokens) return RunCeilings.Breach(
            dimension = "tokens",
            status = "token_limit_exceeded",
            message = "This run used ${c.maxTokens} tokens across its agents, its maximum. " +
                "Shorten the context each agent carries, delegate to fewer agents, or raise " +
                "the limit on your plan.",
            used = used.tokens, limit = c.maxTokens.toLong(),
        )
        return null
    }

    // ── Preflight ────────────────────────────────────────────────────────────

    /**
     * Can [parent] afford [childCount] children of [perChild]? Asked BEFORE any
     * of them is created.
     *
     * All or nothing, deliberately. Half a fan-out is usually worth nothing: the
     * pattern exists because the results are combined, and three of eight
     * findings is not three-eighths of an answer. Refusing up front leaves the
     * budget intact for a narrower plan; discovering the ceiling at child four
     * has already spent it on three results nobody can use.
     */
    fun preflightFanOut(parent: UUID, childCount: Int, perChild: BudgetVector): FanOutVerdict =
        synchronized(lock) {
            if (childCount <= 0) return FanOutVerdict.Affordable
            val node = nodes[parent] ?: return FanOutVerdict.Unaffordable(
                dimension = "unknown-parent",
                requested = perChild.times(childCount),
                available = BudgetVector.ZERO,
                affordableChildren = 0,
            )

            val available = node.availableToChildren
            val needed = perChild.times(childCount)
            val exceeding = needed.dimensionsExceeding(available)
            if (exceeding.isEmpty()) return FanOutVerdict.Affordable

            FanOutVerdict.Unaffordable(
                /* The FIRST dimension that fails, in the declared order, so the
                   message is stable rather than dependent on map iteration. */
                dimension = exceeding.first(),
                requested = needed,
                available = available,
                affordableChildren = available.countOf(perChild),
            )
        }

    // ── Reads ────────────────────────────────────────────────────────────────

    fun remaining(activationId: UUID): BudgetSnapshot? = synchronized(lock) {
        val n = nodes[activationId] ?: return null
        BudgetSnapshot(
            allocated = n.allocated,
            consumedSelf = n.consumedSelf,
            consumedSubtree = n.consumedSubtree,
            reservedToChildren = n.reservedToChildren,
            availableToSelf = n.availableToSelf,
            availableToChildren = n.availableToChildren,
            completionReserve = n.completionReserve,
        )
    }

    /** The clamp record for an activation, for whoever opens its span. */
    fun spanAttributes(activationId: UUID): Map<String, Any> = synchronized(lock) {
        val n = nodes[activationId] ?: return emptyMap()
        buildMap {
            put("budget_clamped", n.clampedDimensions.isNotEmpty())
            if (n.clampedDimensions.isNotEmpty())
                put("budget_clamped_dimensions", n.clampedDimensions)
            put("budget_allocated", n.allocated.toMap())
        }
    }

    fun knows(activationId: UUID): Boolean = nodes.containsKey(activationId)

    /**
     * Rebuild the tree from persisted activation rows, oldest first.
     *
     * A resumed tick has no ledger. Reconstructing it from `agent_activations` —
     * which is where the allocations and consumption already are — means the
     * resumed run continues against the SAME pool rather than a fresh one, which
     * is the difference between a budget and a suggestion.
     *
     * Rows must arrive parent-before-child; `ORDER BY sequence` gives that, since
     * a child cannot be created before its parent.
     */
    fun hydrate(rows: List<HydratedActivation>) = synchronized(lock) {
        for (r in rows) {
            if (nodes.containsKey(r.id)) continue
            val node = Node(r.id, r.parentId, r.allocated, r.allocated.fraction(completionMarginFraction))
            node.consumedSelf = r.consumedSelf
            nodes[r.id] = node
            r.parentId?.let { p -> nodes[p]?.let { it.reservedToChildren = it.reservedToChildren + r.allocated } }
        }
        /* Subtree totals are DERIVED, never restored from a stored field: a stored
           total that disagrees with the sum of its parts is a budget that is wrong
           in a way nothing detects. Recomputed bottom-up on every hydrate. */
        for (n in nodes.values) n.consumedSubtree = BudgetVector.ZERO
        for (n in nodes.values) {
            var cursor: Node? = n
            val seen = HashSet<UUID>()
            while (cursor != null && seen.add(cursor.id)) {
                cursor.consumedSubtree = cursor.consumedSubtree + n.consumedSelf
                cursor = cursor.parent?.let { nodes[it] }
            }
        }
        for (r in rows) if (r.terminal) settleLocked(r.id)
    }

    private fun settleLocked(activationId: UUID) {
        val node = nodes[activationId] ?: return
        if (node.settled) return
        node.settled = true
        val parent = node.parent?.let { nodes[it] } ?: return
        parent.reservedToChildren = parent.reservedToChildren - (node.allocated - node.consumedSubtree)
    }

    /** One `agent_activations` row, as far as the ledger is concerned. */
    data class HydratedActivation(
        val id: UUID,
        val parentId: UUID?,
        val allocated: BudgetVector,
        val consumedSelf: BudgetVector,
        val terminal: Boolean,
    )
}
