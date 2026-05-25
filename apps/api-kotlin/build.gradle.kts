plugins {
    kotlin("jvm") version "2.1.20"
    application
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

    // DB connection pool — HikariCP (wired up in Phase 2)
    implementation("com.zaxxer:HikariCP:5.1.0")

    // Postgres JDBC driver
    implementation("org.postgresql:postgresql:42.7.4")

    // Redis client — Lettuce (wired up in Phase 2)
    implementation("io.lettuce:lettuce-core:6.3.2.RELEASE")

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

// ── Fat jar (no Shadow plugin needed) ─────────────────────────────────────────
// Bundles all runtime dependencies into a single executable jar.
// Used by Dockerfile: `java -jar build/libs/vectorbea-api-all.jar`
tasks.register<Jar>("fatJar") {
    group = "build"
    description = "Assembles an executable fat jar with all runtime dependencies"
    archiveClassifier = "all"
    manifest {
        attributes["Main-Class"] = "com.vectorbea.api.MainKt"
    }
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    from(sourceSets.main.get().output)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}

tasks.named("assemble") {
    dependsOn("fatJar")
}

// ── Run task tuning ───────────────────────────────────────────────────────────
tasks.named<JavaExec>("run") {
    jvmArgs("-Xms64m", "-Xmx256m")
}
