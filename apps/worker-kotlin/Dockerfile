# =============================================================================
# vectorbea-worker — Kotlin workflow worker
# Multi-stage build: Gradle fat-jar → JRE runtime
#
# Build context: REPO ROOT  (Railway Root Directory = / , Dockerfile Path =
#                            apps/worker-kotlin/Dockerfile)
#
# The worker uses packages/observability-kotlin as a Gradle composite build,
# so both directories must be available inside the Docker build context.
# recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/.
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /workspace/apps/worker-kotlin

# Install Gradle (pinned version for reproducible builds)
ARG GRADLE_VERSION=8.10
RUN apk add --no-cache curl unzip && \
    curl -fL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
         -o /tmp/gradle.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    mv /opt/gradle-${GRADLE_VERSION} /opt/gradle && \
    rm /tmp/gradle.zip
ENV PATH="/opt/gradle/bin:${PATH}"

# Limit JVM heap for Gradle + Kotlin compiler to stay within Railway build limits.
ENV GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx512m -Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process -Dkotlin.incremental=false"

# Copy build scripts first — maximises Docker layer cache.
COPY apps/worker-kotlin/settings.gradle.kts apps/worker-kotlin/build.gradle.kts ./
COPY packages/observability-kotlin/settings.gradle.kts packages/observability-kotlin/build.gradle.kts /workspace/packages/observability-kotlin/

# Pre-resolve dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain --max-workers=1 -q 2>/dev/null || true

# Copy source and build fat jar. The included build must be present at the
# exact path declared in settings.gradle.kts before Gradle evaluates it.
# cache-bust: v4
COPY apps/worker-kotlin/src ./src
COPY packages/observability-kotlin/src /workspace/packages/observability-kotlin/src
RUN gradle fatJar --no-daemon --console=plain --max-workers=1 --info --stacktrace 2>&1

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-worker"
LABEL org.opencontainers.image.description="Vectorbea Kotlin workflow worker"
LABEL org.opencontainers.image.source="https://github.com/vectorbea/vectorbea"

# Non-root user for container security
RUN addgroup -S worker && adduser -S worker -G worker

WORKDIR /app

# Copy only the fat jar — no source, no JDK, no Gradle in the final image
COPY --from=builder /workspace/apps/worker-kotlin/build/libs/*-all.jar app.jar

RUN chown worker:worker /app/app.jar
USER worker

EXPOSE 9090

ENV JAVA_OPTS="-Xms64m -Xmx384m -XX:+UseG1GC -XX:+UseContainerSupport"

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD wget -qO- http://localhost:${METRICS_PORT:-9090}/metrics | grep -q "worker_" || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
