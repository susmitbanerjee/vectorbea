plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    `java-library`
    id("com.vanniktech.maven.publish") version "0.36.0"
}

group = "com.vectorbea"
version = "0.2.1"

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

mavenPublishing {
    coordinates(
        groupId = "com.vectorbea",
        artifactId = "vectorbea-jvm-sdk",
        version = project.version.toString(),
    )

    publishToMavenCentral(automaticRelease = true)

    // Sign only when explicitly requested via -PsignPublication.
    //
    // Calling signAllPublications() registers .asc files as required publication
    // artifacts at configuration time. If signing is configured but the sign task
    // is later skipped (e.g. with -x), Gradle still expects those .asc files and
    // fails. The only safe solution is to never call signAllPublications() unless
    // we actually intend to produce signed artifacts.
    //
    // In the CI workflow:
    //   publishToMavenLocal            → no -PsignPublication  (packaging gate only)
    //   publishAndReleaseToMavenCentral → -PsignPublication     (real publish, must sign)
    val shouldSign = providers.gradleProperty("signPublication").isPresent
    val signingKey = providers.gradleProperty("signingInMemoryKey").orNull
    val signingPassword = providers.gradleProperty("signingInMemoryKeyPassword").orNull
    if (shouldSign && signingKey != null && signingPassword != null) {
        signAllPublications()
    }

    pom {
        name.set("VectorBea JVM SDK")
        description.set("Official Kotlin/JVM SDK for the VectorBea Enterprise AI Infrastructure Platform")
        inceptionYear.set("2026")
        url.set("https://vectorbea.com/docs")

        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
                distribution.set("https://opensource.org/licenses/MIT")
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
            url.set("https://github.com/susmitbanerjee/vectorbea")
            connection.set("scm:git:git://github.com/susmitbanerjee/vectorbea.git")
            developerConnection.set("scm:git:ssh://git@github.com/susmitbanerjee/vectorbea.git")
        }
    }
}
