# syntax=docker/dockerfile:1.7

# ── Multi-architecture JVM image ─────────────────────────────────────────────
#
# Produces a linux/amd64 + linux/arm64 image from a single `docker buildx build`
# invocation. Both base images have native amd64 and arm64 layers on Docker Hub,
# so no QEMU emulation is needed at runtime.
#
# Cross-compilation strategy
# ──────────────────────────
# The build stage is pinned to $BUILDPLATFORM (the machine running the build).
# Gradle produces platform-neutral JVM bytecode, so the same obfuscated JAR runs
# on every target architecture. Only the lightweight runtime stage executes under
# the target platform — the heavy dependency download and compilation steps always
# run at native speed regardless of which platform is being targeted.
#
# Build pipeline inside the builder stage:
#   1. generateProto     — compiles vectorbee.proto → Java + Kotlin gRPC stubs
#   2. compileKotlin     — compiles all Kotlin sources (including generated stubs)
#   3. fatJar            — bundles all runtime deps into one executable JAR
#   4. proguardJar       — shrinks dead code and obfuscates class/method names
#
# Only the obfuscated JAR is copied into the runtime stage.

# ── Stage 1: build + obfuscate ───────────────────────────────────────────────
#
# --platform=$BUILDPLATFORM: always runs on the host machine's native arch.
# Gradle and the JDK are heavy tools; emulating them under QEMU for a cross-
# platform build wastes 10-20 minutes and often OOMs on 7 GB GitHub runners.
# Because the output is a JVM JAR (platform-neutral bytecode) we can safely build
# on amd64 and copy the result into an arm64 runtime image.

FROM --platform=$BUILDPLATFORM gradle:8.10.2-jdk21 AS builder

WORKDIR /workspace

# Copy build configuration files first.
# Docker layer-caches this step independently from the source tree, so a
# source-only change does NOT invalidate the dependency download layer.
COPY build.gradle.kts settings.gradle.kts proguard-rules.pro ./

# Copy application sources (includes src/main/proto for protobuf generation).
COPY src ./src

# Run the full obfuscation pipeline in a single Gradle invocation.
# proguardJar depends on fatJar which depends on generateProto + compileKotlin,
# so one task drives the entire build.
RUN gradle --no-daemon proguardJar


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
#
# eclipse-temurin:21-jre-jammy ships native layers for both linux/amd64 and
# linux/arm64. Docker Hub selects the correct layer automatically based on
# TARGETPLATFORM — no explicit --platform flag or TARGETARCH handling required.
#
# Debian/glibc (jammy) is intentional — NOT Alpine/musl.
# netty-transport-native-epoll bundles a glibc-linked .so. On Alpine/musl the
# .so fails to load silently (Epoll.isAvailable() == false) and the GrpcServer
# startup assertion aborts the process.

FROM eclipse-temurin:21-jre-jammy AS runner

WORKDIR /app

# Dedicated non-root OS user. The proxy writes socket files to a shared volume
# that the compose file pre-creates with 0777 mode via an init container, so
# no root privileges are needed at runtime.
RUN groupadd -r vectorbea && useradd -r -g vectorbea vectorbea

# Copy ONLY the obfuscated JAR — the fat jar, build metadata, and all
# intermediate compilation artefacts are left behind in the builder stage.
COPY --from=builder /workspace/build/libs/vectorbea-proxy-obfuscated.jar \
                    /app/vectorbea-proxy.jar

# Pre-create the socket directory. The actual socket files are created at
# runtime by GrpcServer.kt and SocketPermissions.kt; the directory just needs
# to exist before the volume is mounted.
RUN mkdir -p /run/vectorbea && chown vectorbea:vectorbea /run/vectorbea

USER vectorbea

# No EXPOSE — all data-plane traffic travels through the Unix Domain Sockets
# inside the shared Docker volume. The HTTP port (8080) is opened by the
# embeddedServer in Main.kt and mapped by the compose file at runtime.

ENTRYPOINT ["java", "-jar", "/app/vectorbea-proxy.jar"]
