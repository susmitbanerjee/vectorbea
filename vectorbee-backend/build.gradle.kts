plugins {
    kotlin("jvm") version "2.0.21"
    application
}

group = "com.vectorbee"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation(kotlin("stdlib"))
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("org.postgresql:postgresql:42.7.4")
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("com.vectorbee.api.ApplicationKt")
}

tasks {
    jar {
        enabled = false
    }

    register<Jar>("fatJar") {
        archiveClassifier.set("all")
        duplicatesStrategy = DuplicatesStrategy.EXCLUDE
        manifest {
            attributes["Main-Class"] = application.mainClass.get()
        }
        from(sourceSets.main.get().output)
        dependsOn(configurations.runtimeClasspath)
        from({
            configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }
        })
    }

    build {
        dependsOn("fatJar")
    }
}
