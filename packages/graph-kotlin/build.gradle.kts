// graph-kotlin — the workflow graph, and the one correct reader of `graph_json`.
//
// ── WHY THIS IS A MODULE AND NOT A COPY ─────────────────────────────────────
// `graph_json` has TWO shapes on disk: the React Flow nested form the builder
// writes (`{nodes:[{id, data:{...}}]}`) and the flat form older versions wrote.
// `WorkflowGraph.parse` handles both, and it is the only thing that does.
//
// The API needs to resolve a run's graph to answer "one card per graph node".
// The two ways to give it that were to re-implement the parser in TypeScript or
// in the API module; both are the same mistake, because the shapes are historical
// accidents and a second reader diverges the first time a third accident lands.
//
// Extracted rather than duplicated, following `observability-kotlin`: a real
// Gradle dependency through `includeBuild`, so there is one parser and both
// services compile against it.
//
// Deliberately has NO dependency beyond Jackson. The graph is a data structure;
// anything that executes it stays in the worker.
plugins {
    kotlin("jvm") version "2.1.20"
    `java-library`
}

group = "com.vectorbea"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    api("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}

kotlin { jvmToolchain(17) }
tasks.test { useJUnitPlatform() }
