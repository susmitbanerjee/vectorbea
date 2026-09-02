rootProject.name = "vectorbea-api"

// recovery-kotlin sources are vendored into src/main/kotlin/com/vectorbea/recovery/
// (copied from packages/recovery-kotlin — see repo root Makefile for sync instructions)
// No composite build needed; sources compile as part of this project.

// observability-kotlin is a REAL composite build, not vendored.
//
// `recovery-kotlin` is copied into src/ and drifts from its source; the contract
// language is shared by srcDir, which works but only because it is two dependency-free
// files. The observability library has its own dependencies (OpenTelemetry, Logback
// encoders) and must be byte-identical in both services, so it is included properly and
// depended on as `implementation("com.vectorbea:observability-kotlin")`.
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
