# syntax=docker/dockerfile:1.7

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM gradle:8.10.2-jdk21 AS builder

WORKDIR /workspace

# Copy build files first so Gradle's layer cache survives source-only changes.
COPY build.gradle.kts settings.gradle.kts ./
COPY src ./src

# generateProto must run before compileKotlin; fatJar triggers both.
RUN gradle --no-daemon fatJar

# ── Stage 2: runtime ────────────────────────────────────────────────────────
# IMPORTANT: use Debian/glibc, NOT Alpine/musl.
# netty-transport-native-epoll bundles a glibc-linked .so.
# It silently fails (Epoll.isAvailable() == false) on Alpine and the
# GrpcServer startup assertion will abort the process.
FROM eclipse-temurin:21-jre-jammy AS runner

WORKDIR /app

# Dedicated non-root OS user. The proxy writes a socket file to the
# shared volume, which the compose file pre-creates with 0777 mode via
# an init container — so no root needed at runtime.
RUN groupadd -r vectorbea && useradd -r -g vectorbea vectorbea

COPY --from=builder /workspace/build/libs/*-all.jar /app/vectorbea-proxy.jar

# The socket directory is provided at runtime via a Docker named volume.
# We create the mount-point here so the OS path exists before the volume
# is attached; actual socket creation is handled by GrpcServer.kt.
RUN mkdir -p /run/vectorbea && chown vectorbea:vectorbea /run/vectorbea

USER vectorbea

# No EXPOSE — the proxy is UDS-only. All data-plane traffic travels
# through /run/vectorbea/vectorbea.sock inside the shared volume.

ENTRYPOINT ["java", "-jar", "/app/vectorbea-proxy.jar"]
