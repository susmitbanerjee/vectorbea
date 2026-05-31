# =============================================================================
# vectorbea-worker — Kotlin workflow worker
# Multi-stage build: Gradle fat-jar → JRE runtime
#
# Build context: apps/worker-kotlin/  (Railway Root Directory = apps/worker-kotlin)
# recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/
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
COPY settings.gradle.kts build.gradle.kts ./

# Pre-resolve dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain -q 2>/dev/null || true

# Copy source and build fat jar
COPY src ./src
RUN gradle fatJar --no-daemon --console=plain

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-worker"
LABEL org.opencontainers.image.description="Vectorbea Kotlin workflow worker"
LABEL org.opencontainers.image.source="https://github.com/vectorbea/vectorbea"

# Non-root user for container security
RUN addgroup -S worker && adduser -S worker -G worker

WORKDIR /app

# Copy only the fat jar — no source, no JDK, no Gradle in the final image
COPY --from=builder /build/build/libs/*-all.jar app.jar

RUN chown worker:worker /app/app.jar
USER worker

EXPOSE 9090

ENV JAVA_OPTS="-Xms64m -Xmx384m -XX:+UseG1GC -XX:+UseContainerSupport"

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD wget -qO- http://localhost:${METRICS_PORT:-9090}/metrics | grep -q "worker_" || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
