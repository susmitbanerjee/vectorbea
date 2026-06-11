plugins {
    kotlin("jvm") version "2.1.20"
    `java-library`
}

group = "com.vectorbea"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")
    implementation("org.slf4j:slf4j-api:2.0.13")
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}

kotlin { jvmToolchain(17) }
tasks.test { useJUnitPlatform() }
