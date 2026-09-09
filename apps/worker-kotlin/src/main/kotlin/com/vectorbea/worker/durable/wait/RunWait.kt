package com.vectorbea.worker.durable.wait

import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * A run parked on something that has not happened yet.
 *
 * ── WHY THERE IS ONE OF THESE AND NOT THREE ─────────────────────────────────
 * An async tool (a six-minute render), a signal (a second alert for the same
 * incident) and an agent deciding to wait for a person are three features and
 * one sentence: *a run waits for an external event and resumes*. The approval
 * gate has been that sentence since V027.
 *
 * Building a parking mechanism per feature would make five. The reconciler is
 * the standing argument against it — it exists because four independent paths
 * got "change durable state, then best-effort enqueue" wrong in the same way,
 * and one sweep was cheaper than four that drift. Invariant 9: a new pattern is
 * a policy over the existing primitives, never a second runtime.
 */
data class RunWait(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val runId: UUID,
    val workflowId: UUID?,
    val nodeId: String,
    val attemptGroup: Int,
    val kind: WaitKind,
    val waitKey: String,
    val status: Status,
    val label: String?,
    /** For [WaitKind.SIGNAL] and [WaitKind.AGENT_WAIT]: what wakes it. */
    val signalName: String?,
    /** approval → `run_approvals.id`; async tool → the provider's job handle. */
    val externalRef: String?,
    val callbackToken: String?,
    val pollUrl: String?,
    /** The connection whose credential a poll uses. See V065. */
    val pollConnectionId: UUID?,
    val pollNextAt: Instant?,
    val pollIntervalMs: Int?,
    val pollAttempts: Int,
    val pollMaxAttempts: Int?,
    val timeoutAt: Instant?,
    val createdAt: Instant,
    val resolution: Resolution?,
    val resolutionJson: String?,
    val resolvedAt: Instant?,
    val resolvedBy: String?,
) {
    val isWaiting: Boolean get() = status == Status.WAITING

    enum class Status(val wire: String) {
        WAITING("waiting"),
        RESOLVED("resolved"),
        TIMED_OUT("timed_out"),
        CANCELLED("cancelled");

        companion object {
            fun of(wire: String?): Status =
                entries.firstOrNull { it.wire == wire?.lowercase() } ?: WAITING
        }
    }

    /**
     * How a wait ended.
     *
     * `COMPLETED` and `FAILED` are both *the external thing happened* — a render
     * that finished and a render that errored are equally not-waiting-any-more,
     * and the run resumes in both cases with a different result. `TIMEOUT` is the
     * runtime giving up, and is the one an agent must be able to tell apart,
     * because "the provider said no" and "nobody ever answered" need different
     * next actions.
     */
    enum class Resolution(val wire: String) {
        COMPLETED("completed"),
        FAILED("failed"),
        TIMEOUT("timeout"),
        CANCELLED("cancelled"),
        SIGNAL("signal");

        companion object {
            fun of(wire: String?): Resolution? =
                entries.firstOrNull { it.wire == wire?.lowercase() }
        }
    }

    companion object {
        /**
         * The durable key.
         *
         * ── THE SAME DERIVATION AS EVERY OTHER KEY, DELIBERATELY ────────────
         * SHA-256 over `(runId, nodeId, attemptGroup)` — the tuple
         * `SideEffectGuard.keyFor` uses, for the reason invariant 2 gives: a step
         * re-executes from iteration 1 on resume, so any key containing an
         * iteration number, a timestamp or a random id is a *different* key on the
         * second pass, and a different key opens a second wait.
         *
         * Every hard case in the brief falls out of this one property:
         *
         *   · The resumed step recomputes the key, finds its own row, and does not
         *     park twice.
         *   · A redelivered callback carries the same key and hits a CAS on
         *     `status = 'waiting'`, so the second delivery resolves nothing.
         *   · A deliberate re-run bumps `attemptGroup` and therefore *does* wait
         *     again — which is what asking for a re-run means.
         *
         * The `vbw_` prefix distinguishes a wait key from a side-effect key in a
         * log line during an incident, when the two are side by side.
         */
        fun keyFor(runId: UUID, nodeId: String, attemptGroup: Int): String {
            val material = "$runId|$nodeId|$attemptGroup"
            val digest = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
            return "vbw_" + digest.joinToString("") { "%02x".format(it) }.take(40)
        }

        /**
         * The token a provider calls back with.
         *
         * ── DERIVED, NOT RANDOM, AND THAT IS THE POINT ──────────────────────
         * A random token would be simpler and would break re-execution. The step
         * that submitted the job handed the provider a callback URL; when the run
         * resumes and the step re-executes, it has to recognise the URL it already
         * gave out. A random token is not recomputable, so the second pass would
         * mint a different one and the provider's callback would arrive at a token
         * nothing knows about.
         *
         * HMAC over the wait key gives both properties at once: unguessable
         * without the server key, and identical on every re-execution.
         *
         * The key comes from `WAIT_CALLBACK_SECRET`, falling back to
         * `SECRET_ENCRYPTION_KEY` so a deployment that has not set the new
         * variable still gets unguessable tokens rather than predictable ones.
         * With neither — development only — [callbackTokenFor] returns null and
         * the resolver refuses to offer a callback, so a misconfigured process
         * cannot publish a guessable URL.
         */
        fun callbackTokenFor(waitKey: String, secret: ByteArray?): String? {
            if (secret == null || secret.isEmpty()) return null
            return try {
                val mac = Mac.getInstance("HmacSHA256")
                mac.init(SecretKeySpec(secret, "HmacSHA256"))
                "cb_" + mac.doFinal(waitKey.toByteArray())
                    .joinToString("") { "%02x".format(it) }.take(48)
            } catch (_: Exception) {
                null
            }
        }

        /** The configured callback secret, or null when neither variable is set. */
        fun callbackSecret(): ByteArray? {
            val explicit = System.getenv("WAIT_CALLBACK_SECRET")?.takeIf { it.isNotBlank() }
            if (explicit != null) return explicit.toByteArray()
            /* The encryption key is already required in production and already
               secret. Reusing it for a DERIVED, non-reversible token is not
               reusing it as a credential — the HMAC output never allows the key
               to be recovered, and it means one fewer variable that a deployment
               can forget and thereby publish guessable callback URLs. */
            return System.getenv("SECRET_ENCRYPTION_KEY")?.takeIf { it.isNotBlank() }
                ?.let { runCatching { java.util.Base64.getDecoder().decode(it.trim()) }.getOrNull() }
        }
    }
}

/**
 * What sort of event a run is parked on.
 *
 * The KIND, not the status. `agent_runs.status` says `waiting_for_approval` for
 * an approval — unchanged, so the Approvals page and every existing consumer see
 * exactly what they saw — and `waiting_for_event` for the three new ones. This
 * enum says which.
 *
 * ── ENUMERATED HERE BECAUSE THE RECONCILER SWEEPS ALL OF THEM ───────────────
 * The acceptance criterion is "the reconciler recovers every wait kind —
 * enumerate them and test each". This is the enumeration, and
 * `WaitReconciliationTest` walks these entries rather than a hand-written list,
 * so a kind added later without a sweep arm fails the build instead of parking
 * runs forever.
 */
enum class WaitKind(
    val wire: String,
    /**
     * The `agent_runs.status` a run takes while parked on this kind.
     *
     * Approvals keep their own status. The Approvals page, `use-runs-data` and
     * the activity stream all treat `waiting_for_approval` as "a person must
     * decide", and a video render appearing in an approvals queue nobody can
     * action would be a worse bug than the one being fixed.
     */
    val runStatus: String,
) {
    APPROVAL("approval", "waiting_for_approval"),
    ASYNC_TOOL("async_tool", "waiting_for_event"),
    SIGNAL("signal", "waiting_for_event"),
    AGENT_WAIT("agent_wait", "waiting_for_event");

    companion object {
        fun of(wire: String?): WaitKind? = entries.firstOrNull { it.wire == wire?.lowercase() }

        /** Every status a wait can park a run in. Feeds the resume CAS. */
        val PARKED_STATUSES: List<String> = entries.map { it.runStatus }.distinct()
    }
}
