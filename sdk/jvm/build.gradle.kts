import org.gradle.api.tasks.bundling.Jar

plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    `java-library`
    `maven-publish`
    signing
    id("com.gradleup.nmcp") version "0.1.5"
}

// ── Coordinates ───────────────────────────────────────────────────────────────
group   = "com.vectorbea"
version = "0.2.1"

// Explicit artifactId — overrides the rootProject.name default
val sdkArtifactId = "vectorbea-jvm-sdk"

repositories {
    mavenCentral()
}

// ── Dependencies ──────────────────────────────────────────────────────────────
dependencies {
    // OkHttp 4.x — battle-tested HTTP client with connection pooling
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // kotlinx.serialization — compile-time codegen, ProGuard-safe
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // kotlinx.coroutines — required for suspend functions and Dispatchers.IO
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // ── Test ──────────────────────────────────────────────────────────────────
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// ── Toolchain ─────────────────────────────────────────────────────────────────
kotlin {
    jvmToolchain(17)
}

// ── Jar configuration ─────────────────────────────────────────────────────────
java {
    withSourcesJar()
    withJavadocJar()
}

tasks.test {
    useJUnitPlatform()
}

// ── Publishing ────────────────────────────────────────────────────────────────
publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            artifactId = sdkArtifactId
            from(components["java"])

            pom {
                name.set("VectorBea JVM SDK")
                description.set(
                    "Official Kotlin/JVM SDK for the VectorBea prompt management platform"
                )
                url.set("https://vectorbea.com/docs")

                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                        distribution.set("repo")
                    }
                }

                developers {
                    developer {
                        id.set("vectorbea")
                        name.set("VectorBea")
                        email.set("support@vectorbea.com")
                        url.set("https://vectorbea.com")
                    }
                }

                scm {
                    connection.set("scm:git:git://github.com/susmitbanerjee/vectorbea.git")
                    developerConnection.set("scm:git:ssh://github.com/susmitbanerjee/vectorbea.git")
                    url.set("https://github.com/susmitbanerjee/vectorbea/tree/main/sdk/jvm")
                    tag.set("HEAD")
                }

                issueManagement {
                    system.set("GitHub Issues")
                    url.set("https://github.com/susmitbanerjee/vectorbea/issues")
                }
            }
        }
    }
}

// ── Signing ───────────────────────────────────────────────────────────────────
// Signs the main jar, sources jar, javadoc jar, and POM.
// In CI, pass GPG_PRIVATE_KEY (armored key block) and GPG_PASSPHRASE as env vars.
// Locally, signing can be configured via ~/.gradle/gradle.properties with
// signing.keyId / signing.password / signing.secretKeyRingFile.
signing {
    val signingKey: String? = System.getenv("GPG_PRIVATE_KEY")
    val signingPassphrase: String? = System.getenv("GPG_PASSPHRASE")

    if (signingKey != null && signingPassphrase != null) {
        // CI path: key injected from GitHub secret
        useInMemoryPgpKeys(signingKey, signingPassphrase)
    }
    // Local path: falls back to ~/.gradle/gradle.properties signing.* properties

    sign(publishing.publications["mavenJava"])
}

// ── Maven Central Portal publish (nmcp) ───────────────────────────────────────
// Uses the Sonatype Central Portal REST API (portal.central.sonatype.com).
// Set MAVEN_CENTRAL_USERNAME and MAVEN_CENTRAL_PASSWORD in GitHub Secrets.
nmcp {
    publishAllPublicationsToCentralPortal {
        username = System.getenv("MAVEN_CENTRAL_USERNAME") ?: ""
        password = System.getenv("MAVEN_CENTRAL_PASSWORD") ?: ""
        // AUTOMATIC: promotes directly to Central without manual review.
        // Change to "USER_MANAGED" while still testing the pipeline.
        publicationType = "AUTOMATIC"
    }
}
