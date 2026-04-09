plugins {
    kotlin("jvm") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    application
    id("org.graalvm.buildtools.native") version "0.10.6"
}

group = "com.vectorbee"
version = "0.1.0"

val ktorVersion = "3.2.0"
val coroutinesVersion = "1.10.2"

repositories {
    mavenCentral()
}

dependencies {
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
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("com.vectorbee.proxy.MainKt")
}

graalvmNative {
    binaries {
        named("main") {
            imageName.set("vectorbee-proxy")
            mainClass.set(application.mainClass)
            buildArgs.add("--no-fallback")
            buildArgs.add("--install-exit-handlers")
        }
    }
    metadataRepository {
        enabled.set(true)
    }
}
