package com.vectorbea.worker.agents.skills

import com.vectorbea.skills.SkillComposer
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Writes what was actually composed into this activation's prompt.
 *
 * ── WHY A ROW WHEN THERE IS ALREADY A SPAN ATTRIBUTE ────────────────────────
 * The span attribute is the answer for a TRACE — it is what makes "this agent
 * behaved differently on Tuesday" attributable to `video-production@v3` rather
 * than to the agent. It is the wrong answer for the Debug tab, for one reason
 * that matters: invariant 7 says spans may DROP under back-pressure and events
 * may not, because a dropped span is a degraded trace. A skills panel that is
 * empty because a span was dropped reads as a product that lost your data.
 *
 * And for a second reason: "which runs used research@v3" is a row scan here and
 * a trace-store scan there.
 *
 * So both, written from the same composition result at the same moment. The row
 * is authoritative for the UI; the span is authoritative for the trace.
 *
 * ── THE KEY SURVIVES RE-EXECUTION ───────────────────────────────────────────
 * Invariant 2. A step re-executes from iteration 1 on resume, so the key is
 * (run, step, activation, skill) — no iteration number, no attempt, no
 * timestamp — and the write is an UPSERT. A resumed run overwrites its own row
 * with the same facts rather than accumulating one per attempt, and a reader
 * counting rows is counting skills rather than retries.
 */
class ActivationSkillRecorder(private val dataSource: DataSource?) {

    private val log = logger()

    /**
     * Record [composed] for this activation.
     *
     * Never throws. Invariant 7's distinction applies in spirit: this is
     * observability, and observability must not be able to fail a run that was
     * otherwise going to succeed. Unlike an event, nothing pages on its absence
     * — a missing row degrades one panel — so it neither retries nor applies
     * back-pressure, it logs and moves on.
     */
    fun record(
        runId: UUID,
        workspaceId: UUID,
        agentId: UUID,
        stepId: String,
        activationId: UUID?,
        composed: SkillComposer.Composed,
    ) {
        val ds = dataSource ?: return
        if (composed.outcomes.isEmpty()) return
        try {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_activation_skills
                         (run_id, workspace_id, step_id, activation_id, agent_id,
                          skill_id, skill_version_id, slug, version, provenance, position,
                          included, truncated, examples_dropped, chars)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT (run_id, step_id,
                                    COALESCE(activation_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                    skill_id)
                       DO UPDATE SET skill_version_id = EXCLUDED.skill_version_id,
                                     version = EXCLUDED.version,
                                     position = EXCLUDED.position,
                                     included = EXCLUDED.included,
                                     truncated = EXCLUDED.truncated,
                                     examples_dropped = EXCLUDED.examples_dropped,
                                     chars = EXCLUDED.chars"""
                ).use { st ->
                    composed.outcomes.forEachIndexed { i, o ->
                        st.setObject(1, runId)
                        st.setObject(2, workspaceId)
                        st.setString(3, stepId)
                        if (activationId != null) st.setObject(4, activationId)
                        else st.setNull(4, java.sql.Types.OTHER)
                        st.setObject(5, agentId)
                        st.setObject(6, o.skillId)
                        st.setObject(7, o.versionId)
                        st.setString(8, o.slug)
                        st.setInt(9, o.version)
                        st.setString(10, o.provenance.name.lowercase())
                        st.setInt(11, i)
                        st.setBoolean(12, o.included)
                        st.setBoolean(13, o.truncated)
                        st.setBoolean(14, o.examplesDropped)
                        st.setInt(15, o.chars)
                        st.addBatch()
                    }
                    st.executeBatch()
                }
            }
        } catch (e: Exception) {
            /* One panel degrades. The run does not. */
            log.warn("[skills] could not record activation skills for run={}: {}", runId, e.message)
        }
    }
}
