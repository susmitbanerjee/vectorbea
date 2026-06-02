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
