rootProject.name = "worker-kotlin"

// recovery-kotlin sources are vendored into src/main/kotlin/com/vectorbea/recovery/
// (copied from packages/recovery-kotlin — see repo root Makefile for sync instructions)
// No composite build needed; sources compile as part of this project.

// observability-kotlin is a REAL composite build, not vendored. The worker and the API
// must render identical metric shapes; a copied library is a shape that drifts.
includeBuild("../../packages/observability-kotlin")

/*
 * The workflow graph and its `graph_json` parser.
 *
 * Shared because BOTH services now read a stored graph: the worker executes
 * it, and the API resolves it to answer "one card per graph node" for the
 * Debug tab. `graph_json` has two historical shapes and `WorkflowGraph.parse`
 * is the only thing that reads both — a second implementation would diverge
 * the first time a third shape appears.
 */
includeBuild("../../packages/graph-kotlin")
