// Worker service — Kotlin workflow execution engine (email-template-v2)
import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar

plugins {
    kotlin("jvm") version "2.1.20"
    application
    id("com.gradleup.shadow") version "8.3.6"
}

group = "com.vectorbea"
version = "0.1.0"

application {
    mainClass.set("com.vectorbea.worker.MainKt")
}

repositories {
    mavenCentral()
}

dependencies {
    // Metrics, structured logging and tracing - shared with api-kotlin, formerly the
    // separate `apps/telemetry` service. See docs/architecture/OBSERVABILITY.md.
    implementation("com.vectorbea:observability-kotlin:0.1.0")

    // JSON — Jackson with Kotlin module
    // Note: recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")

    // Logging — SLF4J + Logback
    implementation("org.slf4j:slf4j-api:2.0.13")
    implementation("ch.qos.logback:logback-classic:1.5.8")

    // DB connection pool — HikariCP
    implementation("com.zaxxer:HikariCP:5.1.0")

    // Postgres JDBC driver
    implementation("org.postgresql:postgresql:42.7.4")

    // MySQL JDBC driver — the same version the API tests connections with.
    //
    // THE BUG THIS FIXES. MySQL is in the integrations catalogue and the API has
    // shipped mysql-connector-j since MySQL testing was added, so a MySQL
    // connection tests green and saves. The worker did not have the driver at
    // all: ClientDbPoolManager.driverFor("mysql") names com.mysql.cj.jdbc.Driver,
    // HikariCP fails to load the class, and EVERY MySQL tool call died at
    // execution with a ClassNotFoundException wrapped in "Cannot create pool for
    // connection". Nothing in that message points at a missing dependency, and
    // the connection page kept reporting the database reachable — because from
    // the API, it was.
    //
    // Keep this pinned to the same version as api-kotlin. A tenant URL that the
    // API parses and the worker does not is the same class of bug one layer down.
    implementation("com.mysql:mysql-connector-j:9.0.0")

    // Redis client — Lettuce
    implementation("io.lettuce:lettuce-core:6.3.2.RELEASE")

    // ── OpenTelemetry SDK, for the run-trace EXPORTER ────────────────────────
    // NOT a new dependency: `observability-kotlin` already resolves these exact
    // artifacts at these exact versions, and they are already on this module's
    // runtime classpath through it. It declares them `implementation`, so they
    // are invisible at compile time here — which is right for a consumer that
    // only uses `Tracing`, and wrong for one that builds `SpanData` itself.
    //
    // Declared here rather than promoted to `api` over there so `api-kotlin`,
    // which genuinely only needs the `Tracing` facade, does not gain the whole
    // SDK on its compile classpath as a side effect.
    //
    // Keep the versions pinned to observability-kotlin's. Two OTel versions on
    // one classpath is a NoSuchMethodError at export time, hours after start-up.
    implementation("io.opentelemetry:opentelemetry-sdk:1.40.0")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp:1.40.0")

    // ── Coroutines: slots become permits, not threads ────────────────────────
    // An agent run spends 2-30s parked on an LLM socket doing nothing. While a
    // slot is a thread, that wait costs a thread; once it is a permit, waiting
    // is free and concurrency is bounded by memory and provider rate limits
    // instead. See docs/architecture/09-EXECUTION-ARCHITECTURE-REVISED.md 2.3.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-jdk8:1.9.0")

    // ── Ktor: suspending HTTP for LLM and tool calls ─────────────────────────
    // CIO is a pure-Kotlin non-blocking engine, so an in-flight request holds a
    // continuation rather than a thread.
    implementation("io.ktor:ktor-client-core:2.3.12")
    implementation("io.ktor:ktor-client-cio:2.3.12")

    // Test
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.11.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")

    // BlockHound: fails a test the moment a blocking call runs on a coroutine
    // dispatcher. One such call serialises everything behind it and is otherwise
    // invisible — the system just quietly stops scaling.
    testImplementation("io.projectreactor.tools:blockhound:1.0.9.RELEASE")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

// ── Fat jar via Shadow — merges service files correctly ───────────────────────
//
// WHY SHADOW RATHER THAN A HAND-ROLLED Jar TASK.
//
// The previous task copied every dependency in with DuplicatesStrategy.INCLUDE,
// which writes two entries at the same path and lets the zip index decide which
// one a reader gets. That is survivable while exactly one dependency declares a
// given service file, and silently fatal the moment two do.
//
// Adding the MySQL driver made two of them declare the JDBC service file,
// META-INF/services/java.sql.Driver. The loser simply disappears — and
// ClaimWakeup opens the worker's own LISTEN/NOTIFY connection through
// DriverManager, which resolves drivers from precisely that file. So the coin
// toss was between "MySQL tools cannot run" and "the worker's queue wakeup
// cannot reach its own database". api-kotlin's build already carries this scar,
// from Flyway's PostgreSQL provider vanishing the same way.
//
// mergeServiceFiles() appends both declarations instead of picking one. The
// fatJar alias below keeps `gradle fatJar` working for the Dockerfile, and the
// "all" classifier keeps its build/libs/[name]-all.jar COPY matching.
//
// EVERY COMMENT IN THIS REGION IS A LINE COMMENT ON PURPOSE. Kotlin block
// comments NEST, so a `/` immediately followed by a `*` inside one — which is
// what writing a jar glob like libs/[star]-all.jar produces — opens a second
// comment that the next `*/` only half closes. The outer comment then runs to
// end of file and silently swallows every declaration after it. That is exactly
// what happened here: `fatJar` vanished, `gradle fatJar` failed with "task not
// found", and nothing in the build output said why, because a comment is not an
// error.
tasks.named<ShadowJar>("shadowJar") {
    // Gradle's composite dependency substitution puts the observability JAR on
    // runtimeClasspath, but the jar task of an included build is not inferred as
    // a prerequisite of expanding that file.
    dependsOn(gradle.includedBuild("observability-kotlin").task(":jar"))
    archiveClassifier.set("all")
    mergeServiceFiles()
}

tasks.register("fatJar") {
    group = "build"
    description = "Alias for shadowJar — assembles the fat jar with merged service files"
    dependsOn("shadowJar")
}

tasks.named("assemble") {
    dependsOn("shadowJar")
}

tasks.named<JavaExec>("run") {
    jvmArgs("-Xms64m", "-Xmx512m")
}
