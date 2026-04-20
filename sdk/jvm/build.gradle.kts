plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    `java-library`
    `maven-publish`
}

group   = "com.vectorbea"
version = "0.2.0"

repositories {
    mavenCentral()
}

dependencies {
    // ── Networking ────────────────────────────────────────────────────────────
    // OkHttp 4.x is a stable, battle-tested HTTP client with connection pooling,
    // automatic retries on connection failures, and configurable timeouts.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // ── JSON serialisation ────────────────────────────────────────────────────
    // kotlinx.serialization uses compile-time code generation (no reflection)
    // so it is safe under ProGuard obfuscation and performs well at runtime.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // ── Coroutines ────────────────────────────────────────────────────────────
    // Core + JVM dispatcher — required for `suspend` functions and
    // `Dispatchers.IO` used in the HTTP bridge.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // ── Test ──────────────────────────────────────────────────────────────────
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

kotlin {
    jvmToolchain(17)
}

java {
    withSourcesJar()
    withJavadocJar()
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
            pom {
                name.set("VectorBea JVM SDK")
                description.set("Official Kotlin/JVM SDK for the VectorBea prompt management platform")
                url.set("https://vectorbea.com/docs")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("vectorbea")
                        name.set("VectorBea")
                        email.set("support@vectorbea.com")
                    }
                }
                scm {
                    url.set("https://github.com/susmitbanerjee/vectorbea")
                }
            }
        }
    }
}
