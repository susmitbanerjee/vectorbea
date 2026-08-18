// observability-kotlin — metrics, structured logging, tracing and product analytics.
//
// This was `apps/telemetry`, a fourth deployable unit. Section 4.5 of the backend
// architecture is blunt about why it should not be: for a solo developer a separate
// service is ops burden without payoff at this scale. It is now a library that the
// API and the worker both compile against.
//
// Consumed as a REAL Gradle dependency via `includeBuild`, not vendored the way
// `recovery-kotlin` is. Vendored copies drift, and drift in the observability layer
// is uniquely bad: the whole point is that two services report the same numbers in
// the same shape. See docs/architecture/OBSERVABILITY.md.
plugins {
    kotlin("jvm") version "2.1.20"
    `java-library`
}

group = "com.vectorbea"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    // `api` rather than `implementation` where a consumer touches the type directly:
    // both services construct Jackson trees for log fields and event payloads.
    api("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    api("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")
    api("org.slf4j:slf4j-api:2.0.13")

    // Logback is `api` because the JSON encoder below is a Logback component that
    // consumers reference from their logback.xml.
    api("ch.qos.logback:logback-classic:1.5.8")

    // Analytics storage. The library takes a DataSource from its host rather than
    // opening its own pool - two pools against one Postgres from one process is how
    // you exhaust connections while both halves look innocent.
    implementation("org.postgresql:postgresql:42.7.4")

    // OpenTelemetry. Inert unless OTEL_ENABLED=true.
    api("io.opentelemetry:opentelemetry-api:1.40.0")
    implementation("io.opentelemetry:opentelemetry-sdk:1.40.0")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp:1.40.0")
    implementation("io.opentelemetry:opentelemetry-sdk-extension-autoconfigure:1.40.0")
    implementation("io.opentelemetry:opentelemetry-context:1.40.0")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}

kotlin { jvmToolchain(17) }
tasks.test { useJUnitPlatform() }
