// skills-kotlin — what a skill IS, and the three answers both services must give
// identically.
//
// ── WHY THIS IS A MODULE AND NOT A COPY ─────────────────────────────────────
// A skill is granted in the API and composed in the worker, and the two have to
// agree on three things:
//
//   · which required tools are MISSING from an agent's grant (the save-time
//     refusal, and the run-time fail-closed check);
//   · what the composed prompt block LOOKS like, down to its length;
//   · which text is safe to put in a prompt at all.
//
// The whole point of refusing at save time is that the author learns at save
// time what the runtime will do. A second implementation of any of the three
// makes that promise false the first time one of them changes — which is
// exactly how `RunIngress` came to exist (invariant 16): a sequence that lived
// in a route handler, reimplemented from memory by the scheduler, and scheduled
// runs skipped every plan check in the product until somebody read the two
// functions side by side.
//
// Extracted rather than duplicated, following `graph-kotlin`: a real Gradle
// dependency through `includeBuild`, so there is one composer and both services
// compile against it.
//
// Deliberately has NO dependency beyond Jackson, and no I/O. Loading a skill
// from Postgres is each service's own business; deciding what it composes to is
// shared, pure, and exhaustively testable without a database.
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
