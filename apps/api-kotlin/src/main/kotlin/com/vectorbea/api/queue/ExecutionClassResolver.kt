package com.vectorbea.api.queue

import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Resolves the [ExecutionClass] for a workflow version, once.
 *
 * THE CACHE IS PERMANENT, NOT A TTL CACHE
 * ---------------------------------------
 * `workflow_versions` rows are immutable: publishing a change creates a new
 * version with a new id. A version's graph therefore never changes, so its
 * classification never changes either, and there is nothing for an expiry to
 * protect against. Adding a TTL would only buy repeated parsing.
 *
 * Two tiers, in order:
 *
 *   1. **In-process map**, keyed by `workflow_version_id`. Unbounded is correct
 *      here for the same reason: entries are immutable facts, one small enum per
 *      version the instance has actually triggered. A [SAFETY_LIMIT] exists only
 *      so a pathological workspace cannot grow it without bound.
 *
 *   2. **`workflow_versions.execution_class`**, written on first computation.
 *      This is what stops a cold API instance from re-parsing every graph it has
 *      not seen — the memo survives restarts and is shared across instances.
 *
 * Only when both miss is `graph_json` parsed.
 */
class ExecutionClassResolver(
    private val workflowRepo: WorkflowRepository,
    private val longNodeThreshold: Int =
        System.getenv("WORKFLOW_LONG_NODE_THRESHOLD")?.toIntOrNull()
            ?: GraphClassifier.DEFAULT_LONG_NODE_THRESHOLD,
    private val maxParallelBranches: Int =
        System.getenv("WORKFLOW_MAX_PARALLEL_BRANCHES")?.toIntOrNull()
            ?: GraphClassifier.DEFAULT_MAX_PARALLEL_BRANCHES,
) {
    private val log = LoggerFactory.getLogger(ExecutionClassResolver::class.java)

    private val cache = ConcurrentHashMap<UUID, ExecutionClass>()

    companion object {
        /** Not an eviction policy — a bound against unbounded growth. */
        private const val SAFETY_LIMIT = 50_000
    }

    /**
     * The class for [workflowVersionId].
     *
     * Never throws. A classification failure must not be able to block a run:
     * on any error this returns [ExecutionClass.SHORT] and logs, because the
     * cost of a misfiled short run is throughput, while the cost of a failed
     * trigger is a user who cannot run their workflow.
     */
    fun resolve(workflowVersionId: UUID): ExecutionClass {
        cache[workflowVersionId]?.let { return it }

        return try {
            val version = workflowRepo.findVersionById(workflowVersionId)
            if (version == null) {
                log.warn("[class] workflow version {} not found — defaulting to short", workflowVersionId)
                return ExecutionClass.SHORT
            }

            // Tier 2: the memo written by whichever instance saw this version first.
            val persisted = workflowRepo.findVersionExecutionClass(workflowVersionId)
            if (persisted != null) {
                val cls = ExecutionClass.fromWire(persisted)
                remember(workflowVersionId, cls)
                return cls
            }

            // Tier 3: parse, then memoise for everyone.
            val cls = GraphClassifier.classify(
                graphJson = version.graphJson,
                longNodeThreshold = longNodeThreshold,
                maxParallelBranches = maxParallelBranches,
            )
            remember(workflowVersionId, cls)

            // Best-effort: a failed write costs one re-parse on the next cold
            // read, never correctness, so it must not fail the trigger.
            runCatching { workflowRepo.setVersionExecutionClass(workflowVersionId, cls.wire) }
                .onFailure { log.warn("[class] could not persist class for version {}: {}", workflowVersionId, it.message) }

            log.info("[class] classified version {} as {}", workflowVersionId, cls.wire)
            cls
        } catch (e: Exception) {
            log.warn("[class] classification failed for version {} — defaulting to short: {}",
                workflowVersionId, e.message)
            ExecutionClass.SHORT
        }
    }

    private fun remember(versionId: UUID, cls: ExecutionClass) {
        if (cache.size >= SAFETY_LIMIT) cache.clear()
        cache[versionId] = cls
    }

    /** Cache size, for the metrics endpoint. */
    fun cachedVersions(): Int = cache.size
}
