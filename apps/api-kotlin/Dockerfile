# =============================================================================
# vectorbea-api — Kotlin API service
# Multi-stage build: Gradle fat-jar → JRE runtime
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /build

# Install Gradle (pinned version for reproducible builds)
ARG GRADLE_VERSION=8.10
RUN apk add --no-cache curl unzip && \
    curl -fL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
         -o /tmp/gradle.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    mv /opt/gradle-${GRADLE_VERSION} /opt/gradle && \
    rm /tmp/gradle.zip
ENV PATH="/opt/gradle/bin:${PATH}"

# Copy build scripts first — maximises Docker layer cache.
# Source code changes won't invalidate the dependency resolution layer.
COPY settings.gradle.kts build.gradle.kts ./

# Pre-resolve Gradle dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain -q 2>/dev/null || true

# Copy source and build fat jar
COPY src ./src
RUN gradle fatJar --no-daemon --console=plain -q

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-api"
LABEL org.opencontainers.image.description="Vectorbea Kotlin API service"
LABEL org.opencontainers.image.source="https://github.com/vectorbea/vectorbea"

# Non-root user for container security
RUN addgroup -S vectorbea && adduser -S vectorbea -G vectorbea

WORKDIR /app

# Copy fat jar from build stage — no source, no JDK, no Gradle in the image
COPY --from=builder /build/build/libs/*-all.jar app.jar

RUN chown vectorbea:vectorbea /app/app.jar
USER vectorbea

# API port (overridable via PORT env var)
EXPOSE 8080

# JVM flags:
#   UseContainerSupport  — respect cgroup memory/CPU limits (JDK 8u191+)
#   MaxRAMPercentage=75  — use up to 75 % of container RAM for heap
#   UseZGC               — low-latency GC, good for API latency
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UseZGC -Xlog:gc:stderr"

# Liveness probe: GET /health returns 200 when the JVM is up.
# Readiness probe: GET /ready returns 200 when DB + Redis are reachable.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
