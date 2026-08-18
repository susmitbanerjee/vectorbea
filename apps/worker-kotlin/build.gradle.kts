// Worker service — Kotlin workflow execution engine (email-template-v2)
plugins {
    kotlin("jvm") version "2.1.20"
    application
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

    // Redis client — Lettuce
    implementation("io.lettuce:lettuce-core:6.3.2.RELEASE")

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

// ── Fat jar ───────────────────────────────────────────────────────────────────
tasks.register<Jar>("fatJar") {
    group = "build"
    description = "Assembles an executable fat jar with all runtime dependencies"
    archiveClassifier = "all"
    manifest {
        attributes["Main-Class"] = "com.vectorbea.worker.MainKt"
    }
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    from(sourceSets.main.get().output)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}

tasks.named("assemble") {
    dependsOn("fatJar")
}

tasks.named<JavaExec>("run") {
    jvmArgs("-Xms64m", "-Xmx512m")
}
