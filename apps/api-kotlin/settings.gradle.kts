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
