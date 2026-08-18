rootProject.name = "worker-kotlin"

// recovery-kotlin sources are vendored into src/main/kotlin/com/vectorbea/recovery/
// (copied from packages/recovery-kotlin — see repo root Makefile for sync instructions)
// No composite build needed; sources compile as part of this project.

// observability-kotlin is a REAL composite build, not vendored. The worker and the API
// must render identical metric shapes; a copied library is a shape that drifts.
includeBuild("../../packages/observability-kotlin")
