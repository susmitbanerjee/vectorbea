plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    `java-library`
    id("com.vanniktech.maven.publish") version "0.36.0"
}

group = "com.vectorbea"
version = "0.3.1"

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
    signAllPublications()

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
