import com.google.protobuf.gradle.id

plugins {
    kotlin("jvm") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    application
    id("org.graalvm.buildtools.native") version "0.10.6"
    id("com.google.protobuf") version "0.9.4"
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
        }
    }
    metadataRepository {
        enabled.set(true)
    }
}
