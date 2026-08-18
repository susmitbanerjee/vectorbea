package com.vectorbea.worker.confidence

import com.vectorbea.worker.contract.ContractValidator
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Layer 3, wired into the run loop.
 *
 * The scorer, the router and the store are separate objects because each is testable
 * alone and each has a different reason to change. The runtime should not have to know
 * that: it has one question — "may I commit this output, and if not, what do I tell the
 * person?" — so it gets one collaborator.
 *
 * WHERE THIS SITS
 * ---------------
 * After the contract verdict, before `setOutput`. That ordering is the whole point:
 *
 *   - Layer 0/1 (schema, assertions) has already had its say. A schema-invalid output
 *     never reaches here, because it is not committable and the node already failed.
 *   - Nothing durable has been written yet. A gated output is committed deliberately
 *     below, not committed and then retracted.
 *
 * ZERO-COST SUSPENSION
 * --------------------
 * A gate returns [Decision.Gate], which the runtime turns into `WaitingForApproval` —
 * the same mechanism an authored approval node uses. The run releases its permit and
 * its lease. A run waiting three days on a reviewer costs exactly what a finished run
 * costs, which is what makes it reasonable to gate liberally. Holding the slot would
 * make every gate a capacity decision and users would turn gating off.
 */
class ConfidenceGating(
    private val dataSource: DataSource,
    private val store: ConfidenceStore = ConfidenceStore(dataSource),
) {
    private val log = logger<ConfidenceGating>()

    sealed class Decision {
        /** Commit normally. */
        object Commit : Decision()

        /** Commit, but mark the run so it surfaces on Control. */
        data class Flag(val message: String) : Decision()

        /** Suspend the run and wait for a person. */
        data class Gate(val approvalId: UUID, val message: String) : Decision()

        /** Below the floor: fail the node with a specific diagnosis. */
        data class Fail(val message: String) : Decision()
    }

    /**
     * Score this output and decide what happens to it.
     *
     * Returns [Decision.Commit] and does nothing else when there is no contract and no
     * grounding evidence — an ordinary node in an ordinary workflow must not acquire a
     * scoring round trip because this class exists.
     */
    fun evaluate(
        runId: UUID,
        workspaceId: UUID,
        workflowId: UUID,
        nodeId: String,
        environmentId: UUID,
        verdict: ContractValidator.Verdict?,
        metadata: Map<String, Any?>,
        output: Any?,
        downstreamSideEffect: String?,
    ): Decision {
        @Suppress("UNCHECKED_CAST")
        val counts = metadata["groundingCounts"] as? Map<String, Int>
        if (verdict == null && counts == null) return Decision.Commit

        val evidence = ConfidenceScorer.Evidence(
            schemaValid = verdict?.schemaValid ?: true,
            assertionsPassed = verdict?.results?.count { it.passed } ?: 0,
            assertionsTotal = verdict?.results?.size ?: 0,
            citationsVerified = (counts?.get("verified") ?: 0) + (counts?.get("fuzzy") ?: 0),
            citationsFuzzy = counts?.get("fuzzy") ?: 0,
            citationsFabricated = counts?.get("unverified") ?: 0,
            claimsMade = counts?.get("claims") ?: 0,
            unverifiedCitation = metadata["unverifiedCitation"] as? String,
        )

        val score = try {
            ConfidenceScorer.score(evidence)
        } catch (e: Exception) {
            // A scoring failure must not fail the run. Confidence is advisory about an
            // output that already passed its contract; if we cannot measure it, we say
            // so and commit, rather than blocking a correct output on our own bug.
            log.error("[confidence] could not score node {} - committing unscored: {}", nodeId, e.message)
            return Decision.Commit
        }

        val thresholds = store.thresholdsFor(workflowId, nodeId, workspaceId)
        val decision = ConfidenceRouter.route(score, thresholds)

        val scoreId = runCatching {
            store.record(runId, workspaceId, workflowId, nodeId, score, decision, thresholds)
        }.onFailure {
            log.warn("[confidence] could not persist the score for {}: {}", nodeId, it.message)
        }.getOrNull()

        return when (decision.action) {
            ConfidenceRouter.Action.COMMIT -> Decision.Commit

            ConfidenceRouter.Action.COMMIT_FLAGGED -> {
                log.info("[confidence] node {} committed with a flag at {}: {}",
                    nodeId, "%.2f".format(score.value), decision.message)
                Decision.Flag(decision.message)
            }

            ConfidenceRouter.Action.GATE -> {
                @Suppress("UNCHECKED_CAST")
                val evidenceRefs = (metadata["groundingEvidence"] as? Map<String, Any?>) ?: emptyMap()
                val approvalId = runCatching {
                    store.openGate(
                        runId = runId,
                        workspaceId = workspaceId,
                        environmentId = environmentId,
                        nodeId = nodeId,
                        score = score,
                        decision = decision,
                        scoreId = scoreId,
                        output = output,
                        evidenceRefs = evidenceRefs,
                        decisionContext = mapOf(
                            "downstreamSideEffect" to downstreamSideEffect,
                        ),
                    ) ?: error("openGate returned no id")
                }.getOrElse {
                    // If the gate cannot be opened, the safe reading is NOT "commit
                    // anyway". We judged this output as needing a person; failing to
                    // reach the person does not make it trustworthy.
                    log.error("[confidence] could not open the gate for {} - failing the node: {}",
                        nodeId, it.message)
                    return Decision.Fail(
                        "This output needed review (confidence ${pct(score.value)}) and the " +
                            "approval could not be created. The run stopped rather than " +
                            "continuing with an unreviewed value.")
                }
                log.info("[confidence] node {} gated at {} - run suspending [approvalId={}]",
                    nodeId, "%.2f".format(score.value), approvalId)
                Decision.Gate(approvalId, decision.message)
            }

            ConfidenceRouter.Action.FAIL -> {
                log.warn("[confidence] node {} failed the confidence floor at {}: {}",
                    nodeId, "%.2f".format(score.value), decision.message)
                Decision.Fail(decision.message)
            }
        }
    }

    private fun pct(v: Double) = "${Math.round(v * 100)}%"
}
