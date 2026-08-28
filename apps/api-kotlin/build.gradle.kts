// api-kotlin service (VB-113)
plugins {
    kotlin("jvm") version "2.1.20"
    application
    id("com.gradleup.shadow") version "8.3.6"
}

group = "com.vectorbea"
version = "0.1.0"

application {
    mainClass.set("com.vectorbea.api.MainKt")
}

repositories {
    mavenCentral()
}

dependencies {
    // Metrics, structured logging, tracing and product analytics - formerly the
    // separate `apps/telemetry` service. See docs/architecture/OBSERVABILITY.md.
    implementation("com.vectorbea:observability-kotlin:0.1.0")

    // JSON — Jackson with Kotlin + JSR-310 (java.time) support
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")

    // Logging — SLF4J + Logback
    implementation("org.slf4j:slf4j-api:2.0.13")
    implementation("ch.qos.logback:logback-classic:1.5.8")

    // DB connection pool — HikariCP
    // Note: recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/
    implementation("com.zaxxer:HikariCP:5.1.0")

    // Postgres JDBC driver
    implementation("org.postgresql:postgresql:42.7.4")
    // MySQL is exposed in the integrations catalogue, so its test path must be
    // backed by a real driver rather than failing with "No suitable driver".
    implementation("com.mysql:mysql-connector-j:9.0.0")

    // DB migrations — Flyway (core only, no Spring)
    implementation("org.flywaydb:flyway-core:10.20.1")
    implementation("org.flywaydb:flyway-database-postgresql:10.20.1")

    // Redis client — Lettuce (wired up in Phase 2)
    implementation("io.lettuce:lettuce-core:6.3.2.RELEASE")

    // JWT verification — Auth0 java-jwt + JWKS provider
    // Used to verify Supabase-issued JWTs (RS256 via JWKS, HS256 legacy fallback)
    implementation("com.auth0:java-jwt:4.4.0")
    implementation("com.auth0:jwks-rsa:0.22.1")

    // Test
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.11.0")
}

/**
 * THREE THINGS ARE COMPILED BY BOTH SERVICES, for one reason.
 *
 * Each is a contract between what the API writes and what the worker later
 * reads. A second implementation of any of them is a second opinion, and every
 * one of these has the same failure mode: the API reports success, and the
 * failure surfaces only when a run reaches it — long after whoever set it up has
 * stopped looking.
 *
 *  · CONTRACT LANGUAGE. The API lints expressions at publish time; the worker
 *    enforces them at run time. An expression that lints clean in the editor and
 *    then fails to parse in the worker is the worst outcome, because the author
 *    has already shipped.
 *
 *  · SECRET ENCRYPTION. The API writes the ciphertext; the worker decrypts it
 *    when a run needs the credential. Disagreeing about the wire format makes
 *    EVERY credential in the product undecryptable at run time, while the
 *    connection page goes on reporting them healthy — the API can read its own
 *    output perfectly well.
 *
 *  · DATABASE PROVIDER CATALOGUE. The API decides whether a connection works;
 *    the worker decides how to open it. While each kept its own idea of what
 *    `provider = "supabase"` meant, a connection could test green and then be
 *    handed the wrong JDBC driver, or no timeouts at all. See the header of
 *    DbProviders.kt for the three copies that had already drifted apart.
 *
 * Sharing the source is deliberate. A common module is more build machinery than
 * these files justify; copying them guarantees they drift.
 */
sourceSets {
    main {
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/crypto")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/dbcatalog")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/contract")
        // Only the pure language files travel. ContractValidator is bound to the
        // worker's DataSource and its runtime concerns; the API has no business
        // compiling it, and pulling it in drags worker-only dependencies with it.
        // The pattern is relative to each source root, and the root added above IS
        // .../worker/contract - so the path is the bare filename.
        kotlin.exclude("ContractValidator.kt")
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

// ── Fat jar via Shadow — merges META-INF/services/* correctly ─────────────────
// DuplicatesStrategy.INCLUDE silently overwrites service-loader files, which
// causes Flyway's PostgreSQL database-type provider to disappear and Flyway to
// report "Unsupported Database" even for well-supported PostgreSQL versions.
// Shadow's mergeServiceFiles() appends all service declarations correctly.
tasks.named<com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar>("shadowJar") {
    archiveClassifier.set("all")
    mergeServiceFiles()
}

// Keep a "fatJar" alias so the Dockerfile's `gradle fatJar` command still works
tasks.register("fatJar") {
    group = "build"
    description = "Alias for shadowJar — assembles fat jar with merged service files"
    dependsOn("shadowJar")
}

tasks.named("assemble") {
    dependsOn("shadowJar")
}

// ── Run task tuning ───────────────────────────────────────────────────────────
tasks.named<JavaExec>("run") {
    jvmArgs("-Xms64m", "-Xmx256m")
}
