# =============================================================================
# vectorbea-api — Kotlin API service
# Multi-stage build: Gradle fat-jar → JRE runtime
#
# Build context: apps/api-kotlin/   (Railway Root Directory = apps/api-kotlin)
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
# Source code changes won't invalidate the dependency resolution layer.
COPY settings.gradle.kts build.gradle.kts ./

# Pre-resolve Gradle dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain -q 2>/dev/null || true

# Copy source and build fat jar
COPY src ./src
RUN gradle fatJar --no-daemon --console=plain

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

ENV JAVA_OPTS="-Xms64m -Xmx256m -XX:+UseG1GC -XX:+UseContainerSupport"

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
