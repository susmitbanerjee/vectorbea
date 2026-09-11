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

    // The workflow graph and the one correct reader of `graph_json`.
    // `api` rather than `implementation`: both services expose graph types
    // (nodes, edges) on their own APIs, and a consumer that cannot name the
    // type it is handed has to re-declare it.
    api("com.vectorbea:graph-kotlin:0.1.0")
    api("com.vectorbea:skills-kotlin:0.1.0")
    api("com.vectorbea:mcp-kotlin:0.1.0")

    // JSON — Jackson with Kotlin + JSR-310 (java.time) support
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")

    /*
     * ── YAML, FOR OPENAPI IMPORT ────────────────────────────────────────────
     *
     * Most published OpenAPI documents are YAML — Swagger's own Petstore, and
     * the majority of what a customer will paste a URL to. Supporting only JSON
     * would mean the import feature works on a minority of the documents it
     * exists for.
     *
     * The Jackson dataformat module rather than SnakeYAML directly: it is the
     * same version line as the Jackson already here, produces `JsonNode`
     * (so `$ref` resolution, the operation walk and the schema translation are
     * one implementation over both formats rather than two), and it is where
     * the codebase's existing Jackson pins already point.
     *
     * `OpenApiReader` caps the document size and disables anchor expansion
     * beyond a bounded count before parsing — a YAML bomb is a denial of service
     * against the importer, and the importer takes a URL from a user.
     */
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")

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
    /*
     * ── BROKER CLIENTS, FOR EVENT TRIGGERS ──────────────────────────────────
     * Consuming from a customer's Kafka, SQS or Pub/Sub. Each is the vendor's
     * supported client, chosen over hand-rolled protocol code because the part
     * that matters here is at-least-once semantics under partition rebalance,
     * visibility-timeout expiry and lease extension — three problems with
     * subtle, well-documented answers that these libraries already implement
     * and that a bespoke HTTP client would get wrong quietly.
     *
     * All three are lazily constructed: a deployment with no event triggers
     * never instantiates a client, so the cost is jar size rather than runtime.
     */
    implementation("org.apache.kafka:kafka-clients:3.8.1")
    implementation("software.amazon.awssdk:sqs:2.29.29")
    implementation("com.google.cloud:google-cloud-pubsub:1.149.0")
    /*
     * Pub/Sub's request types are generated protobuf messages, and their
     * supertype has to be on the COMPILE classpath — it arrives transitively at
     * runtime, which is not the same thing, and every reference to a
     * `PullRequest` fails to compile without this line.
     *
     * The version is not free choice. `mysql-connector-j` drags in protobuf 4.x
     * and wins conflict resolution, and protobuf 4 renamed the generated
     * supertype — so a Pub/Sub client built against protobuf 3 compiles here and
     * then throws `NoClassDefFoundError` on its first pull, in production, on a
     * customer's queue. The Pub/Sub version above is chosen to be one built
     * against protobuf 4 for exactly that reason; these two move together.
     */
    implementation("com.google.protobuf:protobuf-java:4.33.2")

    implementation("com.auth0:java-jwt:4.4.0")
    implementation("com.auth0:jwks-rsa:0.22.1")

    // Test
    // ── Testcontainers: the integration tier's infrastructure ────────────────
    // Postgres, Redis and an OTLP collector, started per suite and thrown away.
    //
    // These exist because the alternative was `assumeTrue(reachable) else skip`,
    // and a skipped test reads as green. Five acceptance criteria accumulated
    // behind that pattern before anyone noticed none of them had ever run.
    //
    // Redis and Jaeger use the core GenericContainer rather than a module each:
    // both need one port and a readiness check, and a module per image is three
    // more artifacts to keep in step for no behaviour.
    testImplementation("org.testcontainers:testcontainers:1.20.4")
    testImplementation("org.testcontainers:junit-jupiter:1.20.4")
    testImplementation("org.testcontainers:postgresql:1.20.4")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.11.0")
}

/**
 * FIVE THINGS ARE COMPILED BY BOTH SERVICES, for one reason.
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
 *  · THE WAIT PRIMITIVE. A run parks in the worker and is woken by the API — a
 *    signal POST, or a provider's completion callback. Both sides read and write
 *    `run_waits`, and the CAS on `status = 'waiting'` is what makes a duplicated
 *    callback resolve exactly once. Two implementations of that predicate would
 *    be two opinions about whether a completion had already been applied, and
 *    the failure mode is a run resumed twice from one webhook retry.
 *
 *    Only the STORES travel. `WaitSweeper` is worker-only — it polls providers
 *    and holds the outbound HTTP stack — and is excluded below.
 *
 *  · THE HTTP TOOL SPEC. The API GENERATES these documents from an OpenAPI or
 *    Postman import; the worker EXECUTES them. A second reader would let the
 *    importer emit a body encoding, an auth strategy or a pagination shape the
 *    runtime silently ignores — and the symptom of that is a tool that saves
 *    cleanly, validates cleanly, and sends the wrong request. Only the pure
 *    model and its reader travel; the resolver, the transport and the auth
 *    applier are worker-only and stay there.
 *
 * Sharing the source is deliberate. A common module is more build machinery than
 * these files justify; copying them guarantees they drift.
 */
sourceSets {
    main {
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/crypto")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/dbcatalog")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/contract")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/tools/httpspec")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/durable/wait")
        /* Result delivery. The API reads and writes the same ledger the worker's
           dispatcher does — a redelivery route that reimplemented the claim, the
           backoff or the idempotency key derivation would be a second answer to
           the question a receiver dedupes on. */
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/delivery")
        kotlin.srcDir("../worker-kotlin/src/main/kotlin/com/vectorbea/worker/logging")
        // Only the pure language files travel. ContractValidator is bound to the
        // worker's DataSource and its runtime concerns; the API has no business
        // compiling it, and pulling it in drags worker-only dependencies with it.
        // The pattern is relative to each source root, and the root added above IS
        // .../worker/contract - so the path is the bare filename.
        kotlin.exclude("ContractValidator.kt")
        /* Worker-only: it drives the outbound HTTP stack, resolves connections
           and polls providers on a schedule. The API needs the stores, not the
           sweeper — and compiling it here would drag `OutboundHttp`,
           `ConnectionResolver` and `WorkerMetrics` onto this classpath. */
        kotlin.exclude("WaitSweeper.kt")
        /* Worker-only, for the same reason: it owns an HTTP client, a scheduled
           executor and the worker's SecretService. The API needs the store and
           the signer — the parts a route reads — not the loop. */
        kotlin.exclude("DeliveryDispatcher.kt")
    }
}

kotlin {
    jvmToolchain(17)
}

/*
 * ── TWO TIERS, AND WHY THE DEFAULT IS THE NARROW ONE ────────────────────────
 *
 * `test`            — unit only. No containers, no network, runs everywhere.
 * `integrationTest` — everything, including the container-backed tests.
 *
 * The split is a JUnit TAG rather than a second source set. The container-backed
 * tests sit beside the unit tests they extend — `AgentToolGuardKeyTest` proves
 * the key shape and `AgentToolGuardIntegrationTest` proves the behaviour of that
 * shape in Postgres — and moving one of each pair into `src/integrationTest`
 * would separate things that are read together, for the benefit of a build-file
 * distinction.
 *
 * `integrationTest` runs BOTH tiers deliberately. An integration run that
 * skipped the unit tests would be a second, weaker suite; what is wanted is the
 * full one.
 *
 * Neither task caches its result on a passing run: a container-backed test that
 * passed yesterday against a container that no longer exists is not evidence.
 */
tasks.test {
    useJUnitPlatform { excludeTags("integration", "benchmark") }
}

val integrationTest by tasks.registering(Test::class) {
    group = "verification"
    description = "Runs the whole suite, including tests that require Docker."
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    /* `benchmark` is excluded here too: a measurement is not a pass/fail check,
       and a two-minute load test on every merge is how an integration tier gets
       turned off. `./gradlew benchmark` runs them deliberately. */
    useJUnitPlatform { excludeTags("benchmark") }
    /* Never up-to-date. The inputs a container-backed test really depends on —
       a running daemon, a pulled image — are not on any Gradle input path, so
       Gradle's answer to "has anything changed" is always wrong here. */
    outputs.upToDateWhen { false }
    shouldRunAfter(tasks.test)

    /*
     * Docker Desktop on Windows no longer creates the standard
     * `npipe:////./pipe/docker_engine`; its active context is `desktop-linux`,
     * whose endpoint is `dockerDesktopLinuxEngine`. Testcontainers probes the
     * standard one and reports "Could not find a valid Docker environment",
     * which reads as "Docker is not installed" when it is running fine.
     *
     * Set only on Windows, and only when the developer has not chosen their own
     * DOCKER_HOST. On Linux and macOS the default socket is found without help,
     * so CI is untouched.
     */
    if (System.getProperty("os.name").startsWith("Windows") && System.getenv("DOCKER_HOST") == null) {
        environment("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine")
    }

    /*
     * ── A CALLBACK SECRET, SO THE CALLBACK PATH IS ACTUALLY EXERCISED ───────
     *
     * `RunWait.callbackTokenFor` returns NULL when no secret is configured, and
     * a wait then carries no token — so `withCallback = true` in a test would
     * silently produce a wait the callback route can never find, and the suite
     * would go green while testing nothing. The same value the worker's task
     * uses, and for the same reason: a token is an HMAC over the wait key, so
     * two computations only agree if the key does.
     *
     * Test-only. A worker or API with neither this nor SECRET_ENCRYPTION_KEY
     * refuses to publish a callback URL at all.
     */
    environment("WAIT_CALLBACK_SECRET", "integration-test-callback-secret")

    /*
     * ── THE TEST JVM RUNS IN UTC ────────────────────────────────────────────
     * The Postgres JDBC driver sends the JVM's timezone id at connection time,
     * and a developer machine set to `Asia/Calcutta` — the legacy alias for
     * Asia/Kolkata — is rejected outright by a Postgres image with current
     * tzdata: `FATAL: invalid value for parameter "TimeZone"`. Every
     * container-backed test then fails to connect, which reads as a broken
     * database rather than a locale.
     *
     * Fixing it here rather than asking each developer to change their machine,
     * and UTC rather than any other zone because a test asserting on a timestamp
     * should not produce different answers in different offices. Nothing under
     * test reads the JVM default: schedules carry their own `ZoneId`.
     */
    systemProperty("user.timezone", "UTC")
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

val benchmark by tasks.registering(Test::class) {
    group = "verification"
    description = "Runs the load and throughput measurements. Needs Docker."
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform { includeTags("benchmark") }
    outputs.upToDateWhen { false }
    if (System.getProperty("os.name").startsWith("Windows") && System.getenv("DOCKER_HOST") == null) {
        environment("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine")
    }
}
