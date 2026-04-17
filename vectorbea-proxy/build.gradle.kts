import com.google.protobuf.gradle.id
import proguard.gradle.ProGuardTask

buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        classpath("com.guardsquare:proguard-gradle:7.5.0")
    }
}

plugins {
    kotlin("jvm") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    application
    id("org.graalvm.buildtools.native") version "0.10.6"
    id("com.google.protobuf") version "0.9.4"
    // ProGuard — bytecode shrinking and obfuscation applied to the fat jar.
    // Applied ONLY to the JVM/Docker path; the GraalVM native-image path is
    // unaffected because it has its own dead-code elimination pipeline.
}

group = "com.vectorbea"
version = "0.1.0"

val ktorVersion = "3.2.0"
val coroutinesVersion = "1.10.2"

// gRPC / protobuf toolchain
val grpcVersion = "1.68.1"
val grpcKotlinVersion = "1.4.1"
val protobufVersion = "4.28.3"
val nettyVersion = "4.1.115.Final"

repositories {
    mavenCentral()
}

dependencies {
    // ── Ktor REST (control plane to the Next.js hub) ────────────────────────
    implementation("io.ktor:ktor-server-core-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-cio-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation-jvm:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-call-logging-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages-jvm:$ktorVersion")

    implementation("io.ktor:ktor-client-core-jvm:$ktorVersion")
    implementation("io.ktor:ktor-client-cio-jvm:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation-jvm:$ktorVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:$coroutinesVersion")
    implementation("ch.qos.logback:logback-classic:1.5.18")

    // ── gRPC data plane (UDS, sub-millisecond) ──────────────────────────────
    implementation("io.grpc:grpc-stub:$grpcVersion")
    implementation("io.grpc:grpc-protobuf:$grpcVersion")
    implementation("io.grpc:grpc-netty:$grpcVersion")
    implementation("io.grpc:grpc-kotlin-stub:$grpcKotlinVersion")
    implementation("com.google.protobuf:protobuf-kotlin:$protobufVersion")
    implementation("com.google.protobuf:protobuf-java:$protobufVersion")

    // Native epoll transport — required to bind a Netty server to a Unix
    // Domain Socket on Linux. The classifier pins the prebuilt JNI binary.
    implementation("io.netty:netty-transport-native-epoll:$nettyVersion:linux-x86_64")
    implementation("io.netty:netty-transport-native-unix-common:$nettyVersion")
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
    plugins {
        id("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion"
        }
        id("grpckt") {
            artifact = "io.grpc:protoc-gen-grpc-kotlin:$grpcKotlinVersion:jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach { task ->
            task.plugins {
                id("grpc")
                id("grpckt")
            }
            task.builtins {
                id("kotlin")
            }
        }
    }
}

// Make sure IntelliJ + the Kotlin compiler pick up generated sources.
sourceSets {
    main {
        java {
            srcDirs(
                "build/generated/source/proto/main/java",
                "build/generated/source/proto/main/grpc",
                "build/generated/source/proto/main/grpckt",
                "build/generated/source/proto/main/kotlin"
            )
        }
    }
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("com.vectorbea.proxy.MainKt")
}

// Produces a single executable "fat jar" used by the Docker image.
// Usage: ./gradlew fatJar  →  build/libs/vectorbea-proxy-all.jar
tasks.register<Jar>("fatJar") {
    group = "build"
    description = "Assembles all runtime dependencies into a single executable JAR."
    archiveClassifier.set("all")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    manifest {
        attributes["Main-Class"] = application.mainClass.get()
    }
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    with(tasks.jar.get() as CopySpec)
    // Exclude signature files that would break JAR verification.
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA")
}

graalvmNative {
    binaries {
        named("main") {
            imageName.set("vectorbea-proxy")
            mainClass.set(application.mainClass)
            buildArgs.add("--no-fallback")
            buildArgs.add("--install-exit-handlers")

            // ── Kotlin stdlib: safe to initialise at build time ───────────────
            // GraalVM's bundled reachability-metadata marks some kotlin.* classes
            // as run-time-init, but the Kotlin stdlib has no runtime-specific
            // static state. The conflict causes the build to abort with:
            //   "kotlin.DeprecationLevel was unintentionally initialized at build time"
            // Declaring the whole kotlin package as build-time-safe overrides the
            // metadata entry and resolves the conflict.
            buildArgs.add("--initialize-at-build-time=kotlin")

            // kotlinx.serialization also has static state that is safe to bake
            // into the image (descriptor registries, primitive serializers, etc.).
            buildArgs.add("--initialize-at-build-time=kotlinx.serialization")

            // ── Netty / gRPC: must stay run-time-init ─────────────────────────
            // Netty's internal resource-leak detector and platform detection read
            // system properties that are only available at JVM startup.
            // gRPC's service registry and channel state machines are also
            // runtime-scoped.  Forcing these to run-time prevents subtle
            // image-time NPEs if the metadata repo omits them.
            buildArgs.add("--initialize-at-run-time=io.netty")
            buildArgs.add("--initialize-at-run-time=io.grpc.netty")
        }
    }
    metadataRepository {
        enabled.set(true)
    }
}

// ── ProGuard obfuscation ──────────────────────────────────────────────────────
//
// Produces build/libs/vectorbea-proxy-obfuscated.jar from the fat jar.
// The Dockerfile uses THIS output for the runtime image, not the raw fat jar.
//
// Pipeline
// ────────
//   fatJar            →  build/libs/vectorbea-proxy-0.1.0-all.jar   (all deps bundled)
//   proguardJar       →  build/libs/vectorbea-proxy-obfuscated.jar  (shrunk + obfuscated)
//
// The fat jar is kept in build/libs for local debugging; only the obfuscated
// jar is shipped into Docker.

val proguardJar by tasks.registering(ProGuardTask::class) {
    description = "Shrinks and obfuscates the fat jar with ProGuard."
    group = "build"

    dependsOn(tasks.named("fatJar"))

    // ── Input / output ────────────────────────────────────────────────────
    // Reference the fat jar by its deterministic path so Gradle can track the
    // input correctly without needing to resolve the task provider at
    // configuration time.
    injars(layout.buildDirectory.file("libs/${project.name}-${project.version}-all.jar"))
    outjars(layout.buildDirectory.file("libs/${project.name}-obfuscated.jar"))

    // ── JDK 21 library jars (module system) ──────────────────────────────
    // ProGuard needs the JDK class hierarchy to analyse the bytecode.
    // On JDK 9+ there is no rt.jar — classes live in jmod archives.
    // We enumerate every .jmod so ProGuard can resolve all JDK references
    // present in Ktor, Netty, coroutines, and our own code.
    val javaHome = System.getProperty("java.home")
    val jmodsPath = "$javaHome/jmods"
    fileTree(jmodsPath) { include("*.jmod") }.forEach { jmod ->
        libraryjars(
            // jarfilter  — skip nested jars inside the jmod (not relevant here)
            // filter     — skip module-info.class which ProGuard can't process
            mapOf("jarfilter" to "!**.jar", "filter" to "!module-info.class"),
            jmod,
        )
    }

    // ── Rules file ────────────────────────────────────────────────────────
    configuration("proguard-rules.pro")
}

// Wire into the standard Gradle lifecycle so `./gradlew build` produces
// the obfuscated jar automatically.
tasks.named("assemble") {
    dependsOn(proguardJar)
}
